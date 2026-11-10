// The shellphone relay. One Durable Object per live room passes frames between that room's one host and its
// clients. Frames are sealed by the two ends (shellphone/seal.py, web/src/seal.js): this code can't read them and
// stores nothing. There are no storage calls in this file.
//
//   client -> relay   {"data": "..."}
//   relay  -> host    {"from": cid, "data": "..."}   also {"join": cid} and {"leave": cid}
//   host   -> relay   {"to": cid | "*", "data": "..."}   also {"drop": cid}
//   relay  -> client  {"data": "..."}
//
// Sockets use the hibernation API: an idle room costs nothing and its sockets survive the object being put to sleep.
import { DurableObject } from "cloudflare:workers";

export const LIMITS = { frame: 64 * 1024, clients: 10, perSecond: 40 };
const ROOM = /^\/r\/([A-Za-z0-9_-]{22})(\/(host|ws|up))?$/;

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
    if (!m) return new Response("not found", { status: 404 });  // the pages themselves are static files, served before this runs
    const [, room, , what] = m;
    if (!what) return env.ASSETS.fetch(new Request(new URL("/room.html", url), request));  // the room page; it reads the link itself
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

export class Room extends DurableObject {
  host() { return this.ctx.getWebSockets("host")[0]; }
  clients() { return this.ctx.getWebSockets("client"); }

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
    const pair = new WebSocketPair();
    const id = role === "host" ? "host" : crypto.randomUUID().replaceAll("-", "").slice(0, 16);  // the relay names clients; they can't
    this.ctx.acceptWebSocket(pair[1], [role]);
    pair[1].serializeAttachment({ role, id, at: 0, n: 0 });
    if (role === "client") this.host().send(JSON.stringify({ join: id }));
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
    ws.serializeAttachment(who);
    if (who.n > LIMITS.perSecond) return ws.close(1008, "too many frames");
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

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch { /* already closed */ }  // finish the closing handshake
    const who = ws.deserializeAttachment();
    if (who.role === "host") { for (const c of this.clients()) c.close(4404, "room is offline"); }
    else this.host()?.send(JSON.stringify({ leave: who.id }));
  }

  webSocketError(ws) { this.webSocketClose(ws); }
}
