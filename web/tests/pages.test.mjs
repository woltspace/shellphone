// A page's frame document and the order of its board's changes.
//   node --test web/tests/pages.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { POLICY, after, look, sealed } from "../src/pages.js";

test("the policy comes first, before the helper and the agent's own markup", () => {
  const doc = sealed("<!DOCTYPE html><html><head><script>evil()</script></head><body>hi</body></html>");
  assert.ok(doc.startsWith("<!doctype html>"), "our doctype, not the page's");
  const csp = doc.indexOf("Content-Security-Policy"), helper = doc.indexOf("window.shellphone"), page = doc.indexOf("evil()");
  assert.ok(csp > 0 && csp < helper && helper < page);
  assert.equal(doc.match(/<!doctype/gi).length, 1, "the page's own doctype is dropped");
});

test("the policy shuts every way out: no addresses for scripts, fetches, pictures, fonts or forms", () => {
  assert.match(POLICY, /default-src 'none'/);
  assert.match(POLICY, /form-action 'none'/);
  assert.match(POLICY, /base-uri 'none'/);
  for (const part of POLICY.split(";")) assert.doesNotMatch(part, /https?:|\*/, part);
});

test("a page without markup still gets a working frame", () => {
  assert.match(sealed(""), /window\.shellphone/);
  assert.match(sealed(undefined), /window\.shellphone/);
});

test("only changes not seen yet, in the room's order, once each", () => {
  const have = [{ n: 1, op: "a" }, { n: 2, op: "b" }];
  const got = [{ n: 4, op: "d" }, { n: 2, op: "b" }, { n: 3, op: "c" }, { n: 4, op: "d" }, null, { op: "no n" }];
  assert.deepEqual(after(have, got).map((c) => c.n), [3, 4]);
  assert.deepEqual(after([], undefined), []);
});

test("WebRTC is closed both ways, before the helper and the page", () => {
  assert.match(POLICY, /webrtc 'block'/);
  const doc = sealed("<script>page()</script>");
  const lock = doc.indexOf("RTCPeerConnection"), csp = doc.indexOf("Content-Security-Policy");
  assert.ok(csp < lock && lock < doc.indexOf("window.shellphone") && doc.indexOf("window.shellphone") < doc.indexOf("page()"));
  assert.match(doc, /x-dns-prefetch-control" content="off"/);
});

const page = (v, n, extra = {}) => ({ v, title: "Plan", by: "becky", html: `<p>v${v}</p>`, changes: Array.from({ length: n }, (_, i) => ({ n: i + 1, op: i })), ...extra });
const room = (answers) => { const asked = []; return { asked, get: async (after, v) => { asked.push([after, v]); return answers.shift(); } }; };

test("first look: the page and its whole board", async () => {
  const r = room([page(1, 2)]);
  const out = await look({ v: 0, changes: [] }, r.get);
  assert.equal(out.page.v, 1); assert.equal(out.page.changes.length, 2); assert.deepEqual(r.asked, [[0, 0]]);
});

test("the room out of reach is not the page gone, and nothing is lost", async () => {
  assert.deepEqual(await look({ v: 0, changes: [] }, room([null]).get), { error: "unreachable" });
  assert.deepEqual(await look({ v: 0, changes: [] }, room(["missing"]).get), { error: "missing" });
});

test("a new version swaps in only with its whole board: a failed second look keeps the old one", async () => {
  const cur = { v: 1, html: "<p>v1</p>", changes: page(1, 3).changes };
  const failed = room([{ ...page(2, 0), changes: [] }, null]);
  assert.deepEqual(await look(cur, failed.get), { error: "unreachable" });
  assert.deepEqual(failed.asked, [[3, 1], [0, 2]], "asked from the old board, then the whole new one");
  const ok = await look(cur, room([{ ...page(2, 0), changes: [] }, page(2, 4)]).get);
  assert.equal(ok.page.v, 2); assert.equal(ok.page.changes.length, 4, "the whole board, not just what came after the old one");
});

test("same version: only the changes not seen yet", async () => {
  const cur = { v: 1, changes: page(1, 2).changes };
  const r = room([{ v: 1, changes: [{ n: 2, op: 1 }, { n: 3, op: 2 }] }]);
  const out = await look(cur, r.get);
  assert.deepEqual(out.fresh.map((c) => c.n), [3]); assert.deepEqual(r.asked, [[2, 1]]);
});
