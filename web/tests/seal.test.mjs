// The browser's sealing code against the shared vectors, and its own replay and handshake rules.
//   node --test web/tests/seal.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { b64d, b64e, Client, Host, MAX_SEQ, rootKeys, SealError, Session, sessionKeys } from "../src/seal.js";

const V = JSON.parse(readFileSync(new URL("../../tests/seal_vectors.json", import.meta.url), "utf8"));
const SECRET = b64d(V.secret), ROOM = b64d(V.room), CN = b64d(V.cn), SID = b64d(V.sid);
const INVITE = Uint8Array.from({ length: 32 }, (_, i) => i + 32);
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const refused = (p) => assert.rejects(p, SealError);

async function pair(kind = "h") {
  const secrets = { h: SECRET, i: INVITE };
  const client = new Client(ROOM, secrets[kind], kind), host = new Host(ROOM, secrets);
  const hi = await client.hi();
  const [hello, hs, got] = await host.hi(hi);
  return { client, host, cs: await client.hello(hello), hs, hi, hello, got };
}

test("the browser reproduces the vectors", async () => {
  const root = await rootKeys(SECRET, ROOM), sess = await sessionKeys(SECRET, ROOM, SID, CN);
  assert.deepEqual({ c2h: hex(root.c2h), h2c: hex(root.h2c) }, V.root);
  assert.deepEqual({ c2h: hex(sess.c2h), h2c: hex(sess.h2c) }, V.session);
  const client = new Client(ROOM, SECRET), host = new Host(ROOM, { h: SECRET });
  const hi = await client.hi(CN, b64d(V.hi.nonce));
  assert.equal(hi, V.hi.frame);
  const [hello, hs] = await host.hi(hi, SID, b64d(V.hello.nonce));
  assert.equal(hello, V.hello.frame);
  const cs = await client.hello(hello);
  assert.equal(await cs.seal(V.frames[0].obj, b64d(V.frames[0].nonce)), V.frames[0].frame);
  assert.equal(await hs.seal(V.frames[1].obj, b64d(V.frames[1].nonce)), V.frames[1].frame);
});

test("the browser opens what Python sealed", async () => {
  const keys = await sessionKeys(SECRET, ROOM, SID, CN);
  assert.deepEqual(await new Session(ROOM, keys, "h2c", "c2h").open(V.frames[0].frame), V.frames[0].obj);
  assert.deepEqual(await new Session(ROOM, keys, "c2h", "h2c").open(V.frames[1].frame), V.frames[1].obj);
});

test("both directions, and a frame can't be turned around", async () => {
  const { cs, hs } = await pair();
  assert.deepEqual(await hs.open(await cs.seal({ n: 1 })), { n: 1 });
  assert.deepEqual(await cs.open(await hs.seal({ n: 2 })), { n: 2 });
  await refused(cs.open(await cs.seal({ t: "req" })));
  await refused(hs.open(await hs.seal({ t: "res" })));
});

test("a frame opens once, also when copies arrive together", async () => {
  const { cs, hs } = await pair();
  const first = await cs.seal({ n: 1 }), second = await cs.seal({ n: 2 });
  assert.deepEqual(await hs.open(second), { n: 2 });
  await refused(hs.open(second));
  await refused(hs.open(first));
  const frame = await cs.seal({ n: 3 });
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => hs.open(frame)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("two seals started together get different counters", async () => {
  const { cs, hs } = await pair();
  const frames = await Promise.all([cs.seal({ n: 1 }), cs.seal({ n: 2 }), cs.seal({ n: 3 })]);
  assert.equal(new Set(frames.map((f) => hex(b64d(f).subarray(0, 8)))).size, 3);
  for (const f of frames) await hs.open(f);
});

test("tampering and bad counters are caught", async () => {
  const { cs, hs } = await pair();
  const raw = b64d(await cs.seal({ n: 1 }));
  for (const at of [7, 8, 20, raw.length - 1]) {
    const bent = raw.slice(); bent[at] ^= 1;
    await refused(hs.open(b64e(bent)));
  }
  for (const seq of [0, MAX_SEQ + 1]) {
    const bad = raw.slice(); new DataView(bad.buffer).setUint32(4, seq);
    await refused(hs.open(b64e(bad)));
  }
  const high = raw.slice(); high[0] = 1;
  await refused(hs.open(b64e(high)));
  for (const junk of ["", "AAAA", "not base64!", null, 5]) await refused(hs.open(junk));
  assert.deepEqual(await hs.open(b64e(raw)), { n: 1 });
});

test("a replayed hello changes nothing", async () => {
  const { client, cs, hs, hello } = await pair();
  assert.deepEqual(await hs.open(await cs.seal({ n: 1 })), { n: 1 });
  await refused(client.hello(hello));
  assert.deepEqual(await hs.open(await cs.seal({ n: 2 })), { n: 2 });
  await refused(client.hi());
});

test("two hellos arriving together establish one session", async () => {
  const client = new Client(ROOM, SECRET), host = new Host(ROOM, { h: SECRET });
  const [hello] = await host.hi(await client.hi());
  const results = await Promise.allSettled([client.hello(hello), client.hello(hello)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("a hello from another connection is refused, and the real one still works", async () => {
  const client = new Client(ROOM, SECRET), host = new Host(ROOM, { h: SECRET });
  const hi = await client.hi();
  await refused(client.hello((await pair()).hello));
  const [hello, hs] = await host.hi(hi);
  assert.deepEqual(await hs.open(await (await client.hello(hello)).seal({ ok: 1 })), { ok: 1 });
  await refused(new Client(ROOM, SECRET).hello(hello)); // and never before hi
});

test("a new connection doesn't open the old one's frames", async () => {
  const old = await pair();
  const c2h = await old.cs.seal({ n: 1 }), h2c = await old.hs.seal({ n: 1 });
  const { cs, hs } = await pair();
  await refused(hs.open(c2h));
  await refused(cs.open(h2c));
  const [, replayed] = await new Host(ROOM, { h: SECRET, i: INVITE }).hi(old.hi);
  await refused(replayed.open(c2h));
  await refused(old.host.hi(old.hi)); // and a connection is established once
});

test("the invite link can't pass as the host's link", async () => {
  assert.equal((await pair("i")).got, "i");
  await refused(new Host(ROOM, { h: SECRET, i: INVITE }).hi(await new Client(ROOM, INVITE, "h").hi()));
  await refused(new Host(ROOM, { h: SECRET }).hi(await new Client(ROOM, INVITE, "i").hi()));
  const mine = await pair("h");
  const guest = new Client(ROOM, INVITE, "i"); await guest.hi();
  await refused(guest.hello(mine.hello));
  for (const junk of ["x.AAAA", "hAAAA", "", "h.", null]) await refused(new Host(ROOM, { h: SECRET }).hi(junk));
});
