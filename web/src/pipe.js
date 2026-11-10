// The page's end of the pipe: requests to a room that lives on someone's computer, sealed, through the relay.
//
//   const pipe = open(link);                          // the page's own address, or { origin, room, key } saved earlier
//   const { status, body } = await pipe.request("GET", "/api/state?after=0");
//   pipe.onState((state) => …);                      // "connecting" | "open" | "offline" | "refused"
//   pipe.close();
//
// It reconnects by itself. After a reconnect, a request whose answer never came is sent again only if repeating it
// is safe: a GET, or a POST whose body carries the room's own name for it (cid). Any other fails with code "unknown".
// "refused" means this link doesn't open this room: wrong or old key. It doesn't retry.
import { b64d, Client, SealError } from "./seal.js";

export class PipeError extends Error {
  constructor(message, code) { super(message); this.code = code; }  // "unknown" | "timeout" | "closed" | "refused"
}

// https://RELAY/r/ROOM#h.SECRET.TOKEN  ->  what open() needs. `key` is the part after the #, the thing to save.
export function parseLink(link) {
  const url = new URL(link), m = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{22})$/);
  if (!m) throw new PipeError("not a room link", "refused");
  return { origin: url.origin, room: m[1], key: url.hash.replace(/^#/, "") };
}

function parseKey(key) {
  const parts = String(key || "").split(".");
  if (parts.length !== 3 || !["h", "i"].includes(parts[0]) || !parts[2]) throw new PipeError("this link has no key for the room", "refused");
  try { return { kind: parts[0], secret: b64d(parts[1], 32), token: parts[2] }; } catch { throw new PipeError("this link's key is damaged", "refused"); }
}

const repeatable = (r) => r.method === "GET" || (r.body && typeof r.body === "object" && typeof r.body.cid === "string" && r.body.cid !== "");

export function open(link, options = {}) {
  const { origin, room, key } = typeof link === "string" ? parseLink(link) : link;
  const { kind, secret, token } = parseKey(key);
  const WS = options.WebSocket || globalThis.WebSocket;
  const timeout = options.timeout ?? 20000, waits = options.waits || [1000, 2000, 4000, 8000, 15000];
  const helloWait = options.helloWait ?? 8000;  // how long the host gets to answer the handshake
  const address = origin.replace(/^http/, "ws") + `/r/${room}/ws`, roomBytes = b64d(room, 16);

  let state = "connecting", ws = null, session = null, tries = 0, refusals = 0, nextId = 0, timer = null;
  let chain = Promise.resolve();          // seals and opens happen one after the other, in order
  const waiting = [], sent = new Map(), listeners = new Set();

  function setState(next) {
    if (state === next || state === "closed") return;
    state = next;
    for (const l of listeners) { try { l(state); } catch { /* a listener's own problem */ } }
  }

  function fail(entry, error) { clearTimeout(entry.timer); entry.reject(error); }

  function flush() {
    while (session && waiting.length) {
      const entry = waiting.shift(), mine = session, sock = ws;
      entry.id = ++nextId;
      sent.set(entry.id, entry);
      chain = chain.then(async () => {
        if (mine !== session) return;  // the connection changed while this waited its turn; drop() already dealt with it
        try {
          sock.send(JSON.stringify({ data: await mine.seal({ t: "req", id: entry.id, method: entry.method, path: entry.path, body: entry.body ?? null, auth: token }) }));
        } catch (e) {
          if (e instanceof SealError) sock.close(4000, "new keys");  // this session has sealed all it may: reconnect
        }
      });
    }
  }

  function drop() {  // the connection is gone: decide what happens to requests that were on their way
    session = null;
    for (const [id, entry] of sent) {
      sent.delete(id);
      entry.parts = null;
      if (repeatable(entry)) waiting.unshift(entry);
      else fail(entry, new PipeError("the connection dropped before the room answered: it may or may not have gone through", "unknown"));
    }
    waiting.sort((a, b) => a.order - b.order);
  }

  function connect() {
    if (state === "closed" || state === "refused") return;
    const sock = ws = new WS(address);
    let client = null, established = false, hello = null;
    sock.onopen = () => {
      client = new Client(roomBytes, secret, kind);
      hello = setTimeout(() => {  // no answer to the handshake: give up on this socket now, without waiting for it to close politely
        if (established || sock !== ws) return;
        gone();
        try { sock.close(4001, "no answer to the handshake"); } catch { /* already closing */ }
      }, helloWait);
      chain = chain.then(async () => { if (sock === ws) sock.send(JSON.stringify({ data: await client.hi() })); }).catch(() => {});
    };
    sock.onmessage = (event) => {
      chain = chain.then(async () => {
        if (sock !== ws) return;
        let frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        if (typeof frame.data !== "string") return;
        if (!established) {
          try { session = await client.hello(frame.data); } catch { return; }  // not the answer to this connection: keep waiting
          established = true; tries = 0; refusals = 0;
          clearTimeout(hello);
          setState("open");
          return flush();
        }
        let msg;
        try { msg = await session.open(frame.data); } catch { return; }  // doesn't open, or seen before: dropped
        const entry = msg && msg.t === "res" ? sent.get(msg.id) : null;
        if (!entry) return;  // only an answer to a request still waiting counts, and only once
        let answer = msg;
        if (typeof msg.chunk === "string") {  // a long answer comes in numbered parts, in order
          entry.parts = entry.parts || [];
          if (msg.part !== entry.parts.length || !Number.isInteger(msg.of) || msg.of < 2 || msg.of > 4096 || msg.part >= msg.of) return;
          entry.parts.push(msg.chunk);
          if (entry.parts.length < msg.of) return;
          try { answer = JSON.parse(entry.parts.join("")); } catch { return; }
        }
        sent.delete(msg.id);
        clearTimeout(entry.timer);
        entry.resolve({ status: answer.status, body: answer.body });
      }).catch(() => {});
    };
    const gone = () => {
      clearTimeout(hello);
      if (sock !== ws) return;
      ws = null;
      const wasOpen = established;
      drop();
      if (state === "closed") return;
      // The host answers a real client's hi at once. A socket that opened, got no usable answer and was closed
      // several times in a row is a key the room doesn't know.
      if (!wasOpen && client && ++refusals >= 3) {
        setState("refused");
        for (const entry of waiting.splice(0)) fail(entry, new PipeError("this link doesn't open this room", "refused"));
        return;
      }
      setState("offline");
      timer = setTimeout(connect, waits[Math.min(tries++, waits.length - 1)]);
    };
    sock.onclose = gone;
    sock.onerror = () => {};  // a close always follows
  }

  let order = 0;
  connect();
  return {
    get state() { return state; },
    request(method, path, body) {
      return new Promise((resolve, reject) => {
        if (state === "closed") return reject(new PipeError("the pipe is closed", "closed"));
        if (state === "refused") return reject(new PipeError("this link doesn't open this room", "refused"));
        const entry = { method, path, body, resolve, reject, order: order++ };
        entry.timer = setTimeout(() => {
          const at = waiting.indexOf(entry);
          if (at >= 0) waiting.splice(at, 1);
          for (const [id, e] of sent) if (e === entry) sent.delete(id);
          reject(new PipeError("the room didn't answer in time", "timeout"));
        }, timeout);
        waiting.push(entry);
        flush();
      });
    },
    onState(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() {
      setState("closed"); state = "closed";
      clearTimeout(timer);
      for (const entry of [...waiting.splice(0), ...sent.values()]) fail(entry, new PipeError("the pipe is closed", "closed"));
      sent.clear();
      if (ws) ws.close(1000, "bye");
    },
  };
}
