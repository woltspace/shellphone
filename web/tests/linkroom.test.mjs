// The link switch in a local room's menu: what it says when linking fails, and that the host can try again.
//   node --test web/tests/linkroom.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { after, answered, unlinkedWords } from "../src/linkwords.js";

const local = { linked: false, relay: "relay.example" };

test("a room that isn't shared says what sharing does", () => {
  const w = unlinkedWords(local, "", "");
  assert.match(w.text, /shared through relay\.example first/);
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
  let { info, note } = after(local, { linked: false, error: "couldn't share the room through relay.example: it isn't reachable" });
  assert.match(unlinkedWords(info, note, "").text, /isn't reachable/);
  assert.equal(unlinkedWords(info, note, "link").text, "Sharing the room…");  // trying again
  ({ info, note } = after(info, { linked: true, relay: "relay.example", invite: "https://relay.example/r/x#i.y.z" }));
  assert.equal(info.linked, true);
  assert.equal(info.error, undefined);
  assert.equal(note, "");
});

test("an unlink the site hasn't been told about yet is shown as a warning, for as long as the room says so", () => {
  const said = "relay.example couldn't be told yet that this room isn't shared any more: until it is, the old link shows the room as offline. Telling it again every minute.";
  const { info, note } = after({ linked: true, relay: "relay.example" }, { linked: false, relay: "relay.example", note: said });
  assert.equal(info.linked, false);
  assert.deepEqual(unlinkedWords(info, note, ""), { text: said, warn: true });
  assert.deepEqual(unlinkedWords({ linked: false, relay: "relay.example", note: said }, "", ""), { text: said, warn: true });  // the menu opened again later: the room still says it
  assert.equal(unlinkedWords({ linked: false, relay: "relay.example" }, "", "").warn, false);  // told meanwhile: back to the plain words
  assert.equal(unlinkedWords({ linked: false, relay: "relay.example", note: said }, "", "link").text, "Sharing the room…");
});

test("an unlink whose keys couldn't be removed shows the room's own words", () => {
  const { info, note } = after({ linked: true, relay: "relay.example" }, { linked: false, error: "the tunnel is closed and nobody outside can come in, but the room's keys couldn't be removed from /x/outside.json (read-only): delete that file yourself, or the room is shared again at its next start" });
  assert.match(unlinkedWords(info, note, "").text, /delete that file yourself/);
  assert.equal(unlinkedWords(info, note, "").warn, true);
});

test("an old failure doesn't outlive a try the room never answered", () => {
  const { info, note } = after({ ...local, error: "old reason" }, null);
  assert.equal(unlinkedWords(info, note, "").text, "Couldn't reach the room. Try again.");
});

test("a stop that failed is not shown as done, and its reason is shown while the room is still shared", () => {
  const shared = { linked: true, relay: "relay.example", invite: "https://relay.example/r/x#i.y.z" };
  const { info, note } = after(shared, { linked: true, error: "couldn't stop sharing through a tunnel of its own (read-only)" });
  assert.equal(info.linked, true);
  assert.equal(info.invite, shared.invite);
  assert.deepEqual(unlinkedWords(info, note, ""), { text: "couldn't stop sharing through a tunnel of its own (read-only)", warn: true });
  const unsure = after(shared, { error: "the room answered 500" });  // it didn't say what it is now: as it was, with the reason
  assert.equal(unsure.info.linked, true);
  assert.equal(unlinkedWords(unsure.info, unsure.note, "").warn, true);
  const nothing = after(shared, null);  // no answer at all
  assert.equal(nothing.info.linked, true);
  assert.equal(unlinkedWords(nothing.info, nothing.note, "").warn, true);
});

test("a read that failed is unknown, never Private", () => {
  for (const [status, body] of [[500, { error: "boom" }], [500, null], [200, null], [200, {}], [200, { linked: "no" }], [200, []], [502, "bad gateway"]]) {
    assert.deepEqual(answered(true, status, body), { linked: false, unknown: true }, JSON.stringify([status, body]));
  }
  assert.equal(answered(true, 403, { error: "only the room's host can do that" }), null);  // not the host here: nothing is drawn
  assert.equal(answered(true, 404, null), null);
  assert.deepEqual(answered(true, 200, { linked: false, relay: "relay.example" }), { linked: false, relay: "relay.example" });
});

test("a switch that failed keeps the room's own words", () => {
  assert.deepEqual(answered(false, 409, { error: "already shared another way", linked: true }), { error: "already shared another way", linked: true });
  assert.deepEqual(answered(false, 403, { error: "only the room's host can do that" }), { error: "only the room's host can do that" });
  assert.equal(answered(false, 500, null), null);
  assert.equal(answered(false, 200, { ok: true }), null);  // says nothing about the room: treated as no answer
  assert.deepEqual(answered(false, 200, { linked: true, relay: "relay.example" }), { linked: true, relay: "relay.example" });
});
