// The shellphone relay. One Durable Object per live room passes frames between that room's one host and its
// clients. Frames are sealed by the two ends (shellphone/seal.py, web/src/seal.js): this code can't read them and
// keeps none of them. A room's object stores one thing: when to next tell the desk it is still open.
//
// The desk (one object for the whole relay) keeps count: which rooms are open, so there can't be more than
// MAX_ROOMS at once, and a few totals per day. It knows a room by its object's id, never by its address.
//
//   client -> relay   {"data": "..."}
//   relay  -> host    {"from": cid, "data": "..."}   also {"join": cid} and {"leave": cid}
//   host   -> relay   {"to": cid | "*", "data": "..."}   also {"drop": cid}
//   relay  -> client  {"data": "..."}
//
// Sockets use the hibernation API: an idle room costs nothing and its sockets survive the object being put to sleep.
import { DurableObject } from "cloudflare:workers";

// A client sends requests; a host answers every client, sometimes in many parts, so it may send far more.
export const LIMITS = { frame: 64 * 1024, clients: 10, perSecond: 40, hostPerSecond: 400 };
const number = (text, otherwise) => (/^\d+$/.test(text || "") ? Number(text) : otherwise);
const beat = (env) => number(env.BEAT_SECONDS, 30 * 60) * 1000;  // an open room tells the desk so this often, with its counts
const stale = (env) => 3 * beat(env);  // a room the desk hasn't heard from for this long has gone without saying: its place is free
const REOPEN = 10 * 60 * 1000;         // a host back within this long is the same room coming back, not a new one
const ROOM = /^\/r\/([A-Za-z0-9_-]{22})(\/(host|ws|up))?$/;
const PAGES = { "/": "/index.html", "/start": "/start.html" };  // everything else that's a file (scripts, icons, skill.md) is served as it is

function same(a, b) {  // compare without leaking where two strings differ
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i % (y.length || 1)];
  return diff === 0;
}

const off = (env) => env.RELAY_OFF === "1";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default {
  async fetch(request, env) {
    if (off(env)) return new Response("shellphone is switched off for now", { status: 503 });
    const url = new URL(request.url), m = url.pathname.match(ROOM);
    const page = (file) => env.ASSETS.fetch(new Request(new URL(file, url), { method: "GET", headers: request.headers }));
    if (url.pathname === "/stats") {  // the relay's counts, for whoever holds the host key
      if (!env.HOST_KEY || !same(request.headers.get("Authorization") || "", "Bearer " + env.HOST_KEY)) return new Response("not found", { status: 404 });
      return json(200, await desk(env).stats());
    }
    if (!m) return PAGES[url.pathname] && request.method === "GET" ? page(PAGES[url.pathname]) : new Response("not found", { status: 404 });
    const [, room, , what] = m;
    if (!what) return page("/room.html");  // the chat page, at the room's own address: it reads the key from the link itself
    const stub = env.ROOM.get(env.ROOM.idFromName(room));
    if (what === "up") return stub.fetch(request);
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    if (what === "host" && env.OPEN_HOSTING !== "1") {
      // Only hosts that know the key can open rooms. With no key set, nobody can: opening the relay to every host
      // is a decision of its own (OPEN_HOSTING), never what a missing setting gives you.
      if (!env.HOST_KEY || !same(request.headers.get("Authorization") || "", "Bearer " + env.HOST_KEY)) return new Response("this relay isn't open to new rooms yet", { status: 401 });
    }
    return stub.fetch(request);
  },
};

const desk = (env) => env.DESK.get(env.DESK.idFromName("desk"));

// The desk: how many rooms are open, and a few totals per day (UTC). One object, so two rooms asking at the same
// moment are answered one after the other and can't both take the last place.
//   rooms_opened   rooms that came up (a host coming back within ten minutes is the same room)
//   connections    client sockets accepted: a page that reconnects counts again, so this is not people
//   frames         sealed frames carried, both ways: several per request, so this is not chat messages
//   refused        hosts turned away because the relay was full, or had opened all the rooms it may that day
export class Desk extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("create table if not exists rooms (id text primary key, open integer not null, at integer not null)");
    this.sql.exec("create table if not exists days (day text primary key, rooms_opened integer not null default 0, connections integer not null default 0, frames integer not null default 0, refused integer not null default 0)");
  }

  day(now) { return new Date(now).toISOString().slice(0, 10); }
  add(now, what, n) {
    if (!n) return;
    this.sql.exec(`insert into days (day, ${what}) values (?, ?) on conflict (day) do update set ${what} = ${what} + ?`, this.day(now), n, n);
  }
  tidy(now) {
    this.sql.exec("delete from rooms where (open = 1 and at < ?) or (open = 0 and at < ?)", now - stale(this.env), now - REOPEN);
    this.sql.exec("delete from days where day < ?", this.day(now - 90 * 86400 * 1000));
  }
  count() { return this.sql.exec("select count(*) as n from rooms where open = 1").one().n; }

  // A room's host is connecting: may it? { ok } or { ok: false, why }.
  open(id) {
    const now = Date.now();
    this.tidy(now);
    const known = this.sql.exec("select open from rooms where id = ?", id).toArray()[0];
    if (!known || !known.open) {  // it needs a place
      if (this.count() >= number(this.env.MAX_ROOMS, 20)) { this.add(now, "refused", 1); return { ok: false, why: "the relay is carrying all the rooms it can right now" }; }
    }
    if (!known) {  // and it is a new room, not one coming back
      const today = this.sql.exec("select rooms_opened as n from days where day = ?", this.day(now)).toArray()[0];
      if ((today ? today.n : 0) >= number(this.env.MAX_ROOMS_PER_DAY, 200)) { this.add(now, "refused", 1); return { ok: false, why: "the relay has opened all the rooms it may today" }; }
      this.add(now, "rooms_opened", 1);
    }
    this.sql.exec("insert into rooms (id, open, at) values (?, 1, ?) on conflict (id) do update set open = 1, at = ?", id, now, now);
    return { ok: true };
  }

  // Still open, or (open = false) its host has gone. Either way, what it carried since it last said.
  tell(id, open, connections, frames) {
    const now = Date.now();
    this.sql.exec("update rooms set open = ?, at = ? where id = ?", open ? 1 : 0, now, id);
    this.add(now, "connections", connections);
    this.add(now, "frames", frames);
  }

  stats() {
    this.tidy(Date.now());
    return { open_rooms: this.count(), max_rooms: number(this.env.MAX_ROOMS, 20), max_rooms_per_day: number(this.env.MAX_ROOMS_PER_DAY, 200),
      days: this.sql.exec("select * from days order by day desc limit 30").toArray() };
  }
}

export class Room extends DurableObject {
  host() { return this.ctx.getWebSockets("host")[0]; }
  clients() { return this.ctx.getWebSockets("client"); }

  // What this room carried since it last told the desk. The numbers live on the sockets, so they survive the
  // object being put to sleep; a client's are moved to the host's socket when the client leaves.
  async tell(open, host = this.host()) {
    if (!host) return;
    const who = host.deserializeAttachment();
    const frames = (who.total || 0) + (who.left || 0) + this.clients().reduce((n, c) => n + (c.deserializeAttachment().total || 0), 0);
    const joined = who.joined || 0;
    const news = [joined - (who.toldJoined || 0), frames - (who.toldFrames || 0)];
    who.toldJoined = joined; who.toldFrames = frames;
    try { host.serializeAttachment(who); } catch { /* the socket is gone: this was its last word */ }
    try { await desk(this.env).tell(this.ctx.id.toString(), open, ...news); } catch { /* the counts are a courtesy: the room goes on without them */ }
  }

  async alarm() {
    if (!this.host()) return;
    await this.tell(true);
    await this.ctx.storage.setAlarm(Date.now() + beat(this.env));
  }

  shut() {  // the relay was switched off: nothing is carried any more, for sockets that were already open too
    if (!off(this.env)) return false;
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1013, "shellphone is switched off for now"); } catch { /* already closed */ } }
    return true;
  }

  async fetch(request) {
    if (this.shut()) return new Response("shellphone is switched off for now", { status: 503 });
    const what = new URL(request.url).pathname.split("/").pop();
    if (what === "up") return json(200, { up: !!this.host() });
    const role = what === "host" ? "host" : "client";
    if (role === "host" && this.host()) return new Response("this room already has a host", { status: 409 });
    if (role === "client" && !this.host()) return new Response("room is offline", { status: 404 });
    if (role === "client" && this.clients().length >= LIMITS.clients) return new Response("room is full", { status: 429 });
    if (role === "host") {
      const place = await desk(this.env).open(this.ctx.id.toString());
      if (!place.ok) return new Response(place.why, { status: 429 });
      if (this.host()) return new Response("this room already has a host", { status: 409 });  // another got in while the desk was asked
      await this.ctx.storage.setAlarm(Date.now() + beat(this.env));
    }
    const pair = new WebSocketPair();
    const id = role === "host" ? "host" : crypto.randomUUID().replaceAll("-", "").slice(0, 16);  // the relay names clients; they can't
    this.ctx.acceptWebSocket(pair[1], [role]);
    pair[1].serializeAttachment({ role, id, at: 0, n: 0 });
    if (role === "client") {
      const host = this.host(), who = host.deserializeAttachment();
      who.joined = (who.joined || 0) + 1;
      host.serializeAttachment(who);
      host.send(JSON.stringify({ join: id }));
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, data) {
    if (this.shut()) return;
    const who = ws.deserializeAttachment();
    if (typeof data !== "string" || data.length > LIMITS.frame) {
      // A client that sends too much is dropped. The host's socket is the whole room, so its frame is only thrown away.
      return who.role === "host" ? undefined : ws.close(1009, "frame too big or not text");
    }
    const now = Math.floor(Date.now() / 1000);  // a simple cap per socket: so many frames in any one second
    who.n = who.at === now ? who.n + 1 : 1; who.at = now;
    who.total = (who.total || 0) + 1;
    ws.serializeAttachment(who);
    if (who.role === "host") { if (who.n > LIMITS.hostPerSecond) return; }  // over its allowance, a host's frame is thrown away: closing it would close the room
    else if (who.n > LIMITS.perSecond) return ws.close(1008, "too many frames");
    let frame;
    try { frame = JSON.parse(data); } catch { return ws.close(1007, "not json"); }
    if (who.role === "client") {  // a client only ever talks to the host
      if (typeof frame.data !== "string") return ws.close(1007, "no data");
      const host = this.host();
      return host ? host.send(JSON.stringify({ from: who.id, data: frame.data })) : ws.close(4404, "room is offline");
    }
    if (typeof frame.drop === "string") {  // the host turns a client away
      for (const c of this.clients()) if (c.deserializeAttachment().id === frame.drop) c.close(4403, "turned away");
      return;
    }
    if (typeof frame.data !== "string") return;
    for (const c of this.clients()) {  // the host talks to one client, or to all
      if (frame.to === "*" || c.deserializeAttachment().id === frame.to) c.send(JSON.stringify({ data: frame.data }));
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch { /* already closed */ }  // finish the closing handshake
    const who = ws.deserializeAttachment();
    if (who.role === "host") {
      await this.tell(false, ws);  // counted while the clients are still here, and the room's place given back
      for (const c of this.clients()) c.close(4404, "room is offline");
      return this.ctx.storage.deleteAlarm();
    }
    const host = this.host();
    if (!host) return;
    const keeps = host.deserializeAttachment();
    keeps.left = (keeps.left || 0) + (who.total || 0);  // what this client sent stays in the room's count
    host.serializeAttachment(keeps);
    host.send(JSON.stringify({ leave: who.id }));
  }

  webSocketError(ws) { return this.webSocketClose(ws); }
}
