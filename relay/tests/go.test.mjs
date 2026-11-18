// The page at a room's lasting address (public/go.html), run in a small stand-in for a browser: where it sends a
// visitor, what it keeps of their key and for how long, and what Forget and the home-screen page leave behind.
//   node --test relay/tests/go.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const script = fs.readFileSync(new URL("../public/go.html", import.meta.url), "utf8").split("<script>")[1].split("</script>")[0];
const map = () => { const m = new Map(); return { getItem: (k) => m.get(k), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
async function run({ hash = "", search = "", standalone = false, online = true, hold = false }) {
  const els = {}, forwarded = [], fetched = [], replaced = [];
  let release = null;
  const state = { online };
  const ctx = { URLSearchParams, navigator: { standalone }, document: { getElementById: (id) => (els[id] ??= { style: {} }) },
    location: { pathname: "/t/synthetic-room", search, hash, hostname: "site.example", replace: (v) => forwarded.push(v) }, history: { replaceState(a, b, u) { replaced.push(u); } },
    sessionStorage: map(), localStorage: map(), setTimeout: () => 0,
    fetch: async (u) => { fetched.push(u); if (hold && state.online) await new Promise((r) => (release = r)); return { ok: true, json: async () => ({ known: true, url: state.online ? "https://synthetic.trycloudflare.com" : null }) }; } };
  vm.createContext(ctx); vm.runInContext(script, ctx); await new Promise((r) => setImmediate(r));
  return { ctx, els, forwarded, fetched, replaced, state, release: () => release() };
}
const tick = () => new Promise((r) => setImmediate(r));
const TO = "https://synthetic.trycloudflare.com/enter", AT = "room:synthetic-room";

test("a plain visit with one's own key: sent on with it, kept for the tab only, gone from the address bar", async () => {
  let r = await run({ hash: '#k.synthetic-key' });
  assert.equal(r.forwarded[0], TO + '#k.synthetic-key'); assert.equal(r.ctx.sessionStorage.getItem(AT), 'synthetic-key'); assert.equal(r.ctx.localStorage.getItem(AT), undefined); assert.deepEqual(r.replaced, ['/t/synthetic-room']);
});

test('asked to be remembered (.r): kept on the device too', async () => {
  let r = await run({ hash: '#k.synthetic-key.r' }); assert.equal(r.ctx.localStorage.getItem(AT), 'synthetic-key'); assert.equal(r.forwarded[0], TO + '#k.synthetic-key');
});

test('the invite, with nothing kept: passed on as it is', async () => {
  let r = await run({ hash: '#i.synthetic-invite' }); assert.equal(r.forwarded[0], TO + '#i.synthetic-invite');
});

test("an agent's link: passed on untouched, nothing kept", async () => {
  let r = await run({ hash: '#a.synthetic-code' }); assert.equal(r.forwarded[0], TO + '#a.synthetic-code'); assert.equal(r.ctx.sessionStorage.getItem(AT), undefined);
});

test('Forget, while the room is offline: a later retry carries no key', async () => {
  let r = await run({ hash: '#k.synthetic-key.r', online: false }); r.els.gone.onclick({ preventDefault() {} }); r.state.online = true; await vm.runInContext('look()', r.ctx);
  assert.equal(r.forwarded.length, 1); assert.ok(!r.forwarded[0].includes('synthetic-key')); assert.equal(r.ctx.localStorage.getItem(AT), undefined);
});

test('Forget, while a lookup is under way: that lookup takes nobody anywhere', async () => {
  let r = await run({ hash: '#k.synthetic-key', online: false, hold: true }); r.state.online = true; let p = vm.runInContext('look()', r.ctx); await tick(); r.els.gone.onclick({ preventDefault() {} }); r.release(); await p; assert.deepEqual(r.forwarded, []);
});

test('Forget keeps the invite the link came with', async () => {
  let r = await run({ hash: '#k.synthetic-key.i.synthetic-invite', online: false }); r.els.gone.onclick({ preventDefault() {} }); r.state.online = true; await vm.runInContext('look()', r.ctx); assert.equal(r.forwarded[0], TO + '#i.synthetic-invite');
});

test('?install, in a browser: the page stays, the key stays in its address, nothing is asked, and nothing is kept anywhere', async () => {
  let r = await run({ hash: '#k.synthetic-key.r', search: '?install' });
  assert.deepEqual([r.fetched.length, r.forwarded.length, r.replaced.length], [0, 0, 0]); assert.equal(r.els.head.textContent, 'Add this room to your home screen');
  assert.equal(r.ctx.sessionStorage.getItem(AT), undefined); assert.equal(r.ctx.localStorage.getItem(AT), undefined);
  assert.ok(r.els.say.textContent.includes('copy of your own key') && r.els.say.textContent.includes('delete the icon'));
});

test('"Open the room now": an ordinary visit for this tab; the key leaves the address, and is not kept on the device', async () => {
  let r = await run({ hash: '#k.synthetic-key.r', search: '?install' });
  r.els.again.onclick(); await tick(); assert.equal(r.forwarded[0], TO + '#k.synthetic-key');
  assert.deepEqual(r.replaced, ['/t/synthetic-room']); assert.equal(r.ctx.sessionStorage.getItem(AT), 'synthetic-key'); assert.equal(r.ctx.localStorage.getItem(AT), undefined);
});

test('install -> open now -> room offline -> Forget: nothing left in storage, in the page, or in the address', async () => {
  let r = await run({ hash: '#k.synthetic-key.r', search: '?install', online: false });
  r.els.again.onclick(); await tick(); r.els.gone.onclick({ preventDefault() {} });
  assert.equal(r.replaced.at(-1), '/t/synthetic-room'); assert.equal(r.ctx.sessionStorage.getItem(AT), undefined); assert.equal(r.ctx.localStorage.getItem(AT), undefined);
  r.state.online = true; await vm.runInContext('look()', r.ctx); assert.ok(r.forwarded.length === 1 && !r.forwarded[0].includes('synthetic-key'));
});

test('Forget on an ordinary visit clears the address too', async () => {
  let r = await run({ hash: '#k.synthetic-key', online: false }); r.els.gone.onclick({ preventDefault() {} }); assert.equal(r.replaced.at(-1), '/t/synthetic-room');
  r = await run({ hash: '', search: '?install' }); assert.ok(r.els.say.textContent.startsWith('Open this page with your own link'));
});

test('?install, opened from the home screen: an ordinary visit that keeps the key on the device', async () => {
  let r = await run({ hash: '#k.synthetic-key.r', search: '?install', standalone: true });
  assert.equal(r.forwarded[0], TO + '#k.synthetic-key'); assert.equal(r.ctx.localStorage.getItem(AT), 'synthetic-key'); assert.deepEqual(r.replaced, ['/t/synthetic-room?install']);
});
