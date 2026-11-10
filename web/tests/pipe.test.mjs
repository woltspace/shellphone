// The page's pipe against a pretend relay and a pretend host (the real sealing code on both ends).
//   node --test web/tests/pipe.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { b64e, Host } from "../src/seal.js";
import { open, parseLink, PipeError } from "../src/pipe.js";

const ROOM = Uint8Array.from({ length: 16 }, (_, i) => i + 1), SECRET = Uint8Array.from({ length: 32 }, (_, i) => i + 7);
const OTHER = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
const LINK = `https://relay.example/r/${b64e(ROOM)}#h.${b64e(SECRET)}.the-host-token-0123456789`;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const FAST = { waits: [5], helloWait: 30, timeout: 400 };

// A relay with one room. `answer(req)` is the room; return undefined to say nothing.
function world({ secret = SECRET, answer = (req) => ({ status: 200, body: { echo: req.path } }) } = {}) {
  const w = { up: true, sockets: [], wire: [], requests: [], answer, opened: 0 };
  w.WebSocket = class {
    constructor(url) {
      this.url = url; w.sockets.push(this); w.opened++;
      this.host = new Host(ROOM, { h: secret }); this.session = null; this.open = false; this.queue = Promise.resolve();
      queueMicrotask(() => { if (w.up) { this.open = true; this.onopen?.(); } else this.onclose?.({ code: 1006 }); });
    }
    send(text) {
      w.wire.push(text);
      this.queue = this.queue.then(async () => {
        if (!this.open) return;
        const { data } = JSON.parse(text);
        if (!this.session) {
          let got;
          try { got = await this.host.hi(data); } catch { return; }  // a key this room doesn't know: no answer
          this.session = got[1];
          return this.deliver(got[0]);
        }
        const req = await this.session.open(data);
        w.requests.push(req);
        const out = await w.answer(req, this);
        if (out) this.deliver(await this.session.seal({ t: "res", id: req.id, ...out }));
      });
    }
    deliver(data) { const text = JSON.stringify({ data }); w.wire.push(text); if (this.open) this.onmessage?.({ data: text }); return text; }
    close(code = 1000) { if (!this.open) return; this.open = false; queueMicrotask(() => this.onclose?.({ code })); }
    drop() { this.close(1006); }  // as when the host or the network goes away
  };
  return w;
}

test("a link gives the relay, the room and the key to save", () => {
  assert.deepEqual(parseLink(LINK), { origin: "https://relay.example", room: b64e(ROOM), key: `h.${b64e(SECRET)}.the-host-token-0123456789` });
  assert.throws(() => parseLink("https://relay.example/somewhere"), PipeError);
  assert.throws(() => open("https://relay.example/r/" + b64e(ROOM), { WebSocket: world().WebSocket }), PipeError);
});

test("a request goes out sealed and its answer comes back", async () => {
  const w = world({ answer: (req) => ({ status: 200, body: { you: req.auth, got: req.body } }) });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST }), states = [pipe.state];
  pipe.onState((s) => states.push(s));
  const res = await pipe.request("POST", "/api/messages", { text: "secret words 🐚", cid: "c1" });
  assert.deepEqual(res, { status: 200, body: { you: "the-host-token-0123456789", got: { text: "secret words 🐚", cid: "c1" } } });
  assert.deepEqual(states, ["connecting", "open"]);
  assert.equal(w.sockets[0].url, `wss://relay.example/r/${b64e(ROOM)}/ws`);
  for (const frame of w.wire) for (const plain of ["secret words", "the-host-token", "/api/messages", b64e(SECRET)]) assert.ok(!frame.includes(plain), plain);
  pipe.close();
});

test("the same saved pieces open the pipe without the link", async () => {
  const w = world();
  const pipe = open(parseLink(LINK), { WebSocket: w.WebSocket, ...FAST });
  assert.equal((await pipe.request("GET", "/api/state?after=3")).body.echo, "/api/state?after=3");
  pipe.close();
});

test("requests keep their order and their own answers", async () => {
  const w = world({ answer: async (req) => { await tick(req.path === "/slow" ? 20 : 1); return { status: 200, body: req.path }; } });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST });
  const got = await Promise.all([pipe.request("GET", "/slow"), pipe.request("GET", "/b"), pipe.request("GET", "/c")]);
  assert.deepEqual(got.map((r) => r.body), ["/slow", "/b", "/c"]);
  assert.deepEqual(w.requests.map((r) => r.id), [1, 2, 3]);
  pipe.close();
});

test("an answer counts once, and only for a request still waiting", async () => {
  let again;
  const w = world({ answer: async (req, sock) => { again = () => sock.deliver(again.frame); return { status: 200, body: "first" }; } });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST });
  assert.equal((await pipe.request("GET", "/a")).body, "first");
  again.frame = JSON.parse(w.wire.at(-1)).data;
  w.sockets[0].deliver(again.frame);  // the relay repeats the answer
  await tick();
  assert.equal((await pipe.request("GET", "/b")).body, "first");  // and the pipe carries on unharmed
  pipe.close();
});

test("the room's news reaches the page, and only the room can send it", async () => {
  const w = world();
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST });
  let news = 0;
  const off = pipe.onNews(() => news++);
  await pipe.request("GET", "/a");
  const sock = w.sockets[0], note = await sock.session.seal({ t: "news" });
  sock.deliver(note);
  await tick();
  assert.equal(news, 1);
  sock.deliver(note);  // the relay repeats it: dropped, like any frame seen before
  sock.deliver(JSON.stringify({ t: "news" }));  // or makes one up
  sock.deliver("news");
  await tick();
  assert.equal(news, 1);
  assert.equal((await pipe.request("GET", "/b")).body.echo, "/b");  // answers still find their requests around a note
  off();
  sock.deliver(await sock.session.seal({ t: "news" }));
  await tick();
  assert.equal(news, 1);  // no longer listening
  pipe.close();
});

test("a long answer arrives in parts and is put back together", async () => {
  const big = { messages: Array.from({ length: 5 }, (_, i) => ({ n: i, text: "héllo 🐚 ".repeat(900) })) };
  const bytes = new TextEncoder().encode(JSON.stringify({ status: 200, body: big })), parts = [];
  for (let at = 0; at < bytes.length; at += 9000) parts.push(Buffer.from(bytes.subarray(at, at + 9000)).toString("base64"));
  const w = world({ answer: async (req, sock) => {
    for (const [i, chunk] of parts.entries()) sock.deliver(await sock.session.seal({ t: "res", id: req.id, part: i, of: parts.length, chunk }));
  } });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST });
  assert.ok(parts.length > 2);
  assert.deepEqual(await pipe.request("GET", "/api/state"), { status: 200, body: big });
  assert.deepEqual((await pipe.request("GET", "/again")).body, big);
  pipe.close();
});

test("parts out of order or left unfinished never become an answer", async () => {
  const w = world({ answer: async (req, sock) => {
    const b64 = (s) => Buffer.from(s).toString("base64");
    sock.deliver(await sock.session.seal({ t: "res", id: req.id, part: 1, of: 2, chunk: b64('"x"}') }));  // the second part first
    sock.deliver(await sock.session.seal({ t: "res", id: req.id, part: 0, of: 2, chunk: b64('{"status":200,"body":') }));
  } });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST, timeout: 60 });
  await assert.rejects(pipe.request("GET", "/api/state"), (e) => e.code === "timeout");
  pipe.close();
});

test("after the connection drops: a GET and a named POST go again, an unnamed POST doesn't", async () => {
  let dropped = false;
  const w = world({ answer: (req, sock) => { if (!dropped) { dropped = req.path === "/third"; if (dropped) sock.drop(); return; } return { status: 200, body: req.path }; } });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST }), states = [];
  pipe.onState((s) => states.push(s));
  const get = pipe.request("GET", "/api/state"), named = pipe.request("POST", "/api/messages", { text: "hi", cid: "abc" });
  const plain = pipe.request("POST", "/third", { text: "no name" });
  await assert.rejects(plain, (e) => e instanceof PipeError && e.code === "unknown");
  assert.deepEqual([(await get).body, (await named).body], ["/api/state", "/api/messages"]);
  assert.deepEqual(states, ["open", "offline", "open"]);
  assert.equal(w.requests.filter((r) => r.path === "/third").length, 1);  // never sent a second time
  assert.equal(w.requests.filter((r) => r.path === "/api/messages").length, 2);
  assert.equal(w.opened, 2);
  pipe.close();
});

test("a room that's offline is waited for", async () => {
  const w = world(); w.up = false;
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST }), states = [];
  pipe.onState((s) => states.push(s));
  const asked = pipe.request("GET", "/api/state");
  await tick(30);
  assert.equal(pipe.state, "offline");
  w.up = true;
  assert.equal((await asked).status, 200);
  assert.deepEqual(states, ["offline", "open"]);
  pipe.close();
});

test("a key the room doesn't know is refused, not retried forever", async () => {
  const w = world({ secret: OTHER });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST });
  await assert.rejects(pipe.request("GET", "/api/state"), (e) => e.code === "refused");
  assert.equal(pipe.state, "refused");
  assert.equal(w.opened, 3);
  await tick(60);
  assert.equal(w.opened, 3);
  await assert.rejects(pipe.request("GET", "/again"), (e) => e.code === "refused");
});

test("a room that never answers times the request out", async () => {
  const w = world({ answer: () => undefined });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST, timeout: 40 });
  await assert.rejects(pipe.request("GET", "/api/state"), (e) => e.code === "timeout");
  pipe.close();
});

test("closing ends what was waiting and stops reconnecting", async () => {
  const w = world({ answer: () => undefined });
  const pipe = open(LINK, { WebSocket: w.WebSocket, ...FAST });
  const asked = pipe.request("GET", "/api/state");
  await tick(10);
  pipe.close();
  await assert.rejects(asked, (e) => e.code === "closed");
  await assert.rejects(pipe.request("GET", "/x"), (e) => e.code === "closed");
  await tick(40);
  assert.equal(w.opened, 1);
});
