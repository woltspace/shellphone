// The notes tapped notifications leave for the page: one per tap, the newest wins, landing on one leaves newer ones.
//   node --test web/tests/landing.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { forget, pending } from "../src/landing-notes.js";

const S = "https://room.test/";
// a stand-in for the Cache API: an ordered map of URL → body, each step async like the real one
function store() {
  const m = new Map(), tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    m,
    put: async (k, v) => { await tick(); m.set(k, JSON.stringify(v)); },
    keys: async () => { await tick(); return [...m.keys()].map((url) => ({ url })); },
    match: async (k) => { await tick(); return m.has(k) ? new Response(m.get(k)) : undefined; },
    delete: async (k) => { await tick(); return m.delete(k); },
  };
}
const note = (tap, at, m = tap) => ({ url: `${S}#m=${m}&t=th`, tap, at });

test("the newest fresh note is the one to land on", async () => {
  const c = store(), now = Date.now();
  await c.put(S + "landing-note/a", note("a", now - 5000));
  await c.put(S + "landing-note/b", note("b", now - 1000));
  const n = await pending(c, now);
  assert.equal(n.tap, "b");
  assert.equal(n.key, S + "landing-note/b");
});

test("a note stays until the app has landed on it", async () => {
  const c = store(), now = Date.now();
  await c.put(S + "landing-note/a", note("a", now));
  assert.equal((await pending(c, now)).tap, "a");
  assert.equal((await pending(c, now)).tap, "a", "reading it doesn't use it up");
  await forget(c, S + "landing-note/a");
  assert.equal(await pending(c, now), null);
});

test("landing on an older tap never removes a newer one written meanwhile", async () => {
  const c = store(), now = Date.now();
  await c.put(S + "landing-note/a", note("a", now));
  const a = await pending(c, now);
  // tap B arrives while the app is still landing on A, and the acknowledgement of A races its write
  await Promise.all([c.put(S + "landing-note/b", note("b", now + 1)), forget(c, a.key)]);
  const n = await pending(c, now + 1);
  assert.ok(n, "B's note survived");
  assert.equal(n.tap, "b");
});

test("old, unreadable and unrelated entries are cleared or left alone", async () => {
  const c = store(), now = Date.now();
  await c.put(S + "landing-note/old", note("old", now - 120_000));
  c.m.set(S + "landing-note/bad", "{not json");
  await c.put(S + "something-else", { url: "x", at: now });
  assert.equal(await pending(c, now), null);
  assert.deepEqual([...c.m.keys()], [S + "something-else"]);
});

test("a note from before taps had ids still lands once", async () => {
  const c = store(), now = Date.now();
  await c.put(S + "landing-note", { url: `${S}#m=x`, at: now });
  const n = await pending(c, now);
  assert.equal(n.url, `${S}#m=x`);
  await forget(c, n.key);
  assert.equal(await pending(c, now), null);
});

test("after the newest lands, an older tap doesn't come back on the next look", async () => {
  const c = store(), now = Date.now();
  await c.put(S + "landing-note/a", note("a", now - 2000));
  await c.put(S + "landing-note/b", note("b", now - 1000));
  const n = await pending(c, now);
  assert.equal(n.tap, "b");
  await forget(c, n.key);  // landed on B
  assert.equal(await pending(c, now + 300), null, "the 300ms check finds nothing, not A");
});

test("a tap written while the notes are being read survives the clean-up of older ones", async () => {
  const c = store(), now = Date.now();
  await c.put(S + "landing-note/a", note("a", now - 2000));
  await c.put(S + "landing-note/b", note("b", now - 1000));
  const [n] = await Promise.all([pending(c, now), c.put(S + "landing-note/c", note("c", now))]);
  const next = await pending(c, now);
  assert.ok(next, "something is still waiting");
  if (n.tap === "b") assert.equal(next.tap, "c", "C, newer than B, stays");
  assert.ok(!c.m.has(S + "landing-note/a"), "A, older than both, is gone");
});
