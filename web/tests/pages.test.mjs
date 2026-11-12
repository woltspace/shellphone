// A page's frame document and the order of its board's changes.
//   node --test web/tests/pages.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { POLICY, after, sealed } from "../src/pages.js";

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
