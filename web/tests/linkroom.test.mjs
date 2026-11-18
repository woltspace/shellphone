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

test("an unlink the site hasn't been told about yet is shown as a warning, for as long as the room says so", () => {
  const said = "relay.example couldn't be told yet that this room is unlinked: until it is, the old link shows the room as offline. Telling it again every minute.";
  const { info, note } = after({ linked: true, relay: "relay.example" }, { linked: false, relay: "relay.example", note: said });
  assert.equal(info.linked, false);
  assert.deepEqual(unlinkedWords(info, note, ""), { text: said, warn: true });
  assert.deepEqual(unlinkedWords({ linked: false, relay: "relay.example", note: said }, "", ""), { text: said, warn: true });  // the menu opened again later: the room still says it
  assert.equal(unlinkedWords({ linked: false, relay: "relay.example" }, "", "").warn, false);  // told meanwhile: back to the plain words
  assert.equal(unlinkedWords({ linked: false, relay: "relay.example", note: said }, "", "link").text, "Linking the room…");
});

test("an unlink whose keys couldn't be removed shows the room's own words", () => {
  const { info, note } = after({ linked: true, relay: "relay.example" }, { linked: false, error: "the tunnel is closed and nobody outside can come in, but the room's keys couldn't be removed from /x/outside.json (read-only): delete that file yourself, or the room is linked again at its next start" });
  assert.match(unlinkedWords(info, note, "").text, /delete that file yourself/);
  assert.equal(unlinkedWords(info, note, "").warn, true);
});

test("an old failure doesn't outlive a try the room never answered", () => {
  const { info, note } = after({ ...local, error: "old reason" }, null);
  assert.equal(unlinkedWords(info, note, "").text, "Couldn't reach the room. Try again.");
});
