// The link switch in a local room's menu: what it says when linking fails, and that the host can try again.
//   node --test web/tests/linkroom.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { after, unlinkedWords } from "../src/linkwords.js";

const local = { linked: false, relay: "relay.example" };

test("an unlinked room says what linking does", () => {
  const w = unlinkedWords(local, "", "");
  assert.match(w.text, /linked to relay\.example first/);
  assert.equal(w.warn, false);
});

test("a room that didn't answer says so, where the host is looking", () => {
  const { info, note } = after(local, null);
  assert.equal(info.linked, false);
  const w = unlinkedWords(info, note, "");
  assert.equal(w.text, "Couldn't reach the room. Try again.");
  assert.equal(w.warn, true);
});

test("the room's own reason is shown, and a second try that works clears it", () => {
  let { info, note } = after(local, { linked: false, error: "couldn't link the room through relay.example: it isn't reachable" });
  assert.match(unlinkedWords(info, note, "").text, /isn't reachable/);
  assert.equal(unlinkedWords(info, note, "link").text, "Linking the room…");  // trying again
  ({ info, note } = after(info, { linked: true, relay: "relay.example", invite: "https://relay.example/r/x#i.y.z" }));
  assert.equal(info.linked, true);
  assert.equal(info.error, undefined);
  assert.equal(note, "");
});

test("an old failure doesn't outlive a try the room never answered", () => {
  const { info, note } = after({ ...local, error: "old reason" }, null);
  assert.equal(unlinkedWords(info, note, "").text, "Couldn't reach the room. Try again.");
});
