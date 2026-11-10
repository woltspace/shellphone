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
const DESK_WAIT = 10 * 1000;           // how long a room waits for the desk's answer to a report before counting it as not given
const ROOM = /^\/r\/([A-Za-z0-9_-]{22})(\/(host|ws|up))?$/;
const LIVE_FOR = 30;  // seconds the public count of live rooms is kept before the desk is asked again
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
  async fetch(request, env, ctx) {
    if (off(env)) return new Response("shellphone is switched off for now", { status: 503 });
    const url = new URL(request.url), m = url.pathname.match(ROOM);
    const page = (file) => env.ASSETS.fetch(new Request(new URL(file, url), { method: "GET", headers: request.headers }));
    if (url.pathname === "/live") {
      // For everyone, and so only one number: how many rooms are up right now. Nothing about which, whose or where.
      // Kept for half a minute in Cloudflare's cache, which spares the desk most of the asking but not all of it:
      // the cache is one per data centre, and requests that miss it at the same moment each ask. So the desk's
      // side of this only reads: asked a thousand times, it writes nothing.
      if (request.method !== "GET") return new Response("not found", { status: 404 });
      const kept = new Request(url.origin + "/live"), cache = caches.default;
      let answer = await cache.match(kept);
      if (!answer) {
        answer = new Response(JSON.stringify({ rooms: await desk(env).live() }), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${LIVE_FOR}` } });
        ctx.waitUntil(cache.put(kept, answer.clone()));
      }
      return answer;
    }
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
//   frames         sealed frames that came in, from either side: several per request, so this is not chat messages
//                  (one thrown away for coming too fast is counted too: it is what the relay had to handle)
//   refused        hosts turned away because the relay was full, or had opened all the rooms it may that day
//
// A place is a lease. Every admission of a host gets a number (gen) that is never given twice, whatever the desk
// has forgotten since, and an open room must report in time to keep its place: one that didn't is forgotten
// here, and is told so when it next reports (see Room.alarm).
export class Desk extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("create table if not exists rooms (id text primary key, open integer not null, at integer not null, gen integer not null)");
    this.sql.exec("create table if not exists counters (name text primary key, n integer not null)");
    this.sql.exec("create table if not exists days (day text primary key, rooms_opened integer not null default 0, connections integer not null default 0, frames integer not null default 0, refused integer not null default 0)");
  }

  day(now) { return new Date(now).toISOString().slice(0, 10); }
  add(now, what, n) {
    if (!(n > 0)) return;
    this.sql.exec(`insert into days (day, ${what}) values (?, ?) on conflict (day) do update set ${what} = ${what} + ?`, this.day(now), n, n);
  }
  tidy(now) {
    this.sql.exec("delete from rooms where (open = 1 and at < ?) or (open = 0 and at < ?)", now - stale(this.env), now - REOPEN);
    this.sql.exec("delete from days where day < ?", this.day(now - 90 * 86400 * 1000));
  }
  count() { return this.sql.exec("select count(*) as n from rooms where open = 1").one().n; }
  full() { return this.count() >= number(this.env.MAX_ROOMS, 20); }

  // A room's host is connecting: may it? { ok, gen } or { ok: false, why }.
  open(id) {
    const now = Date.now();
    this.tidy(now);
    const known = this.sql.exec("select open from rooms where id = ?", id).toArray()[0];
    if ((!known || !known.open) && this.full()) {  // it needs a place, and there is none
      this.add(now, "refused", 1);
      return { ok: false, why: "the relay is carrying all the rooms it can right now" };
    }
    if (!known) {  // a new room, not one coming back
      const today = this.sql.exec("select rooms_opened as n from days where day = ?", this.day(now)).toArray()[0];
      if ((today ? today.n : 0) >= number(this.env.MAX_ROOMS_PER_DAY, 200)) { this.add(now, "refused", 1); return { ok: false, why: "the relay has opened all the rooms it may today" }; }
      this.add(now, "rooms_opened", 1);
    }
    this.sql.exec("insert into counters (name, n) values ('gen', 1) on conflict (name) do update set n = n + 1");
    const gen = this.sql.exec("select n from counters where name = 'gen'").one().n;  // the desk's own count: a forgotten room's number never comes round again
    this.sql.exec("insert into rooms (id, open, at, gen) values (?, 1, ?, ?) on conflict (id) do update set open = 1, at = ?, gen = ?", id, now, gen, now, gen);
    return { ok: true, gen };
  }

  // An open room reports: what it carried since it last said, and does it still hold its place? { ok }.
  // A room the desk forgot (it reported too late) gets its place back only if one is free.
  report(id, gen, connections, frames) {
    const now = Date.now();
    this.tidy(now);
    this.add(now, "connections", connections);
    this.add(now, "frames", frames);
    const known = this.sql.exec("select open, gen from rooms where id = ?", id).toArray()[0];
    if (known && known.gen !== gen) return { ok: false };  // a later host of this room was let in: this one is not the room any more
    if (!known || !known.open) {
      if (this.full()) return { ok: false };
      this.sql.exec("insert into rooms (id, open, at, gen) values (?, 1, ?, ?) on conflict (id) do update set open = 1, at = ?", id, now, gen, now);
      return { ok: true };
    }
    this.sql.exec("update rooms set at = ? where id = ?", now, id);
    return { ok: true };
  }

  // A room's host has gone: its last counts, and its place is free. Only for the admission that is leaving: a
  // goodbye that arrives after the room's next host was let in changes nothing.
  leave(id, gen, connections, frames) {
    const now = Date.now();
    this.add(now, "connections", connections);
    this.add(now, "frames", frames);
    this.sql.exec("update rooms set open = 0, at = ? where id = ? and gen = ?", now, id, gen);
  }

  live() {  // the one number anyone may have. It only reads: a room that went silent isn't counted, and is cleared away by the next host or report
    return this.sql.exec("select count(*) as n from rooms where open = 1 and at >= ?", Date.now() - stale(this.env)).one().n;
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

  // What this room carried that the desk hasn't been told. The numbers live on the sockets, so they survive the
  // object being put to sleep; a client's are moved to the host's socket when the client leaves.
  untold(host) {
    const who = host.deserializeAttachment();
    const frames = (who.total || 0) + (who.left || 0) + this.clients().reduce((n, c) => n + (c.deserializeAttachment().total || 0), 0);
    return { connections: (who.joined || 0) - (who.toldJoined || 0), frames: frames - (who.toldFrames || 0) };
  }

  // Every so often an open room reports to the desk, and learns whether it still holds its place. One that lost
  // it, or couldn't reach the desk for two reports running (the desk forgets a room after three), stops serving:
  // its host is closed and has to ask for a place again.
  async alarm() {
    const host = this.host();
    if (!host) return;
    const gen = host.deserializeAttachment().gen, said = this.untold(host), every = beat(this.env);
    let held = null;  // true: still ours. false: lost. null: the desk couldn't be asked
    let timer;
    try {  // an answer that doesn't come is no answer: the room doesn't wait on the desk for ever
      const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error("the desk didn't answer")), DESK_WAIT); });
      held = (await Promise.race([desk(this.env).report(this.ctx.id.toString(), gen, said.connections, said.frames), late])).ok === true;
    } catch { /* asked again sooner, below */ } finally { clearTimeout(timer); }
    const now = this.host();
    if (!now || now.deserializeAttachment().gen !== gen) return;  // this host left while the desk was asked: whoever came next has its own alarm
    const who = now.deserializeAttachment();
    if (held) {
      who.toldJoined = (who.toldJoined || 0) + said.connections; who.toldFrames = (who.toldFrames || 0) + said.frames;  // told, so not told again
      who.lease = Date.now();
      now.serializeAttachment(who);
      return this.ctx.storage.setAlarm(Date.now() + every);
    }
    if (held === false || this.lapsed(now)) return this.stop(now);
    return this.ctx.storage.setAlarm(Date.now() + Math.ceil(every / 3));
  }

  // The place is held until two report times after the desk last confirmed it. Past that, nothing is carried:
  // checked on every frame too, so it holds even while a report to the desk is still waiting for its answer.
  lapsed(host) { return Date.now() - (host.deserializeAttachment().lease || 0) >= 2 * beat(this.env); }
  stop(host) {
    const keeps = host.deserializeAttachment();
    for (const c of this.clients()) {  // what each client sent goes on the host's socket first, so the goodbye still counts it (once)
      const who = c.deserializeAttachment();
      keeps.left = (keeps.left || 0) + (who.total || 0);
      c.serializeAttachment({ ...who, total: 0 });
      c.close(4404, "room is offline");
    }
    host.serializeAttachment(keeps);
    host.close(4429, "this room lost its place on the relay");
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
    let place = null;
    if (role === "host") {
      if (this.admitting) return new Response("this room already has a host", { status: 409 });  // one host at a time asks the desk
      this.admitting = true;
      try { place = await desk(this.env).open(this.ctx.id.toString()); } catch { place = null; } finally { this.admitting = false; }
      if (!place) return new Response("the relay can't open rooms right now", { status: 503 });
      if (!place.ok) return new Response(place.why, { status: 429 });
      await this.ctx.storage.setAlarm(Date.now() + beat(this.env));
    }
    const pair = new WebSocketPair();
    const id = role === "host" ? "host" : crypto.randomUUID().replaceAll("-", "").slice(0, 16);  // the relay names clients; they can't
    this.ctx.acceptWebSocket(pair[1], [role]);
    pair[1].serializeAttachment(role === "host" ? { role, id, at: 0, n: 0, gen: place.gen, lease: Date.now() } : { role, id, at: 0, n: 0 });
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
    const who = ws.deserializeAttachment(), holder = who.role === "host" ? ws : this.host();
    if (holder && this.lapsed(holder)) return this.stop(holder);
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
      const said = this.untold(ws);  // counted while the clients are still here
      // Everything of this room's is put away before anything is awaited: once this waits for the desk, the room's
      // next host may already be coming in, and nothing below may touch what is theirs.
      const next = this.ctx.getWebSockets("host").some((h) => h !== ws && h.deserializeAttachment().gen !== who.gen);
      if (!next) {
        for (const c of this.clients()) c.close(4404, "room is offline");
        await this.ctx.storage.deleteAlarm();  // nothing else runs in this room during a storage call
      }
      try { await desk(this.env).leave(this.ctx.id.toString(), who.gen, said.connections, said.frames); } catch { /* the desk forgets a silent room by itself */ }
      return;
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
