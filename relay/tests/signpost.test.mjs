// A room's lasting address (/t/ID): what the desk keeps about it, run under node with a stand-in for its storage.
//   node --test relay/tests/signpost.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const line = 'import { DurableObject } from "cloudflare:workers";';
assert.ok(source.includes(line));
const file = join(mkdtempSync(join(tmpdir(), "relay-")), "index.mjs");
writeFileSync(file, source.replace(line, "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
const { Desk } = await import(pathToFileURL(file).href);

function newDesk(vars = {}) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...p) { const st = db.prepare(q); const rows = st.columns().length ? st.all(...p) : (st.run(...p), []); return { toArray: () => rows, one: () => rows[0] }; } };
  return new Desk({ storage: { sql } }, vars);
}
const A = "https://a-b.trycloudflare.com", B = "https://c-d.trycloudflare.com";

test("a room points its address, moves it, closes it, and only its own secret may", () => {
  const d = newDesk();
  assert.equal(d.point("r", "claim", "check", A, false, 1).ok, true);
  assert.deepEqual(d.where("r"), { known: true, url: A, check: "check" });
  assert.equal(d.point("r", "other", "check", B, false, 2).status, 403);
  assert.equal(d.point("r", "claim", "check", B, false, 2).ok, true);
  assert.equal(d.where("r").url, B);
  assert.equal(d.point("r", "claim", "check", "", false, 3).ok, true);
  assert.deepEqual([d.where("r").known, d.where("r").url], [true, ""]);
  assert.equal(d.where("nobody").known, false);
});

test("a message that arrives late changes nothing", () => {
  const d = newDesk();
  d.point("r", "c", "p", A, false, 10);
  assert.equal(d.point("r", "c", "p", B, false, 10).status, 409);
  assert.equal(d.point("r", "c", "p", B, false, 9).status, 409);
  assert.equal(d.where("r").url, A);
});

test("unlinked is for good, even when the unlink arrives before the room was ever heard of", () => {
  let d = newDesk();
  d.point("r", "c", "p", A, false, 1);
  assert.equal(d.point("r", "c", "p", "", true, 2).ok, true);
  assert.equal(d.where("r").known, false);
  assert.equal(d.point("r", "c", "p", A, false, 3).status, 410);
  assert.equal(d.point("r", "other", "p", A, false, 9).status, 403);
  assert.equal(d.point("r", "c", "p", "", true, 4).ok, true);  // saying it again is fine
  d = newDesk();
  assert.equal(d.point("r", "c", "p", "", true, 2).ok, true);
  assert.equal(d.point("r", "c", "p", A, false, 1).status, 410);  // its first message, still on its way when it unlinked
  assert.equal(d.where("r").known, false);
});

test("an address is never given to anyone else, however long ago it was last used", () => {
  const d = newDesk(), real = Date.now;
  let now = real();
  Date.now = () => now;
  try {
    d.point("gone", "c", "p", A, false, 1); d.point("gone", "c", "p", "", true, 2);
    d.point("idle", "c2", "p", A, false, 1);
    now += 3 * 366 * 86400000;
    assert.equal(d.point("gone", "other", "p", B, false, 1).status, 403);
    assert.equal(d.point("idle", "other", "p", B, false, 1).status, 403);
    assert.equal(d.point("idle", "c2", "p", B, false, 2).ok, true);  // its own room still may
  } finally { Date.now = real; }
});

test("a room that closes before it was ever open leaves nothing behind", () => {
  const d = newDesk();
  assert.equal(d.point("r", "c", "p", "", false, 1).ok, true);
  assert.equal(d.where("r").known, false);
  assert.equal(d.stats().signs, 0);
});

test("the caps: addresses in use, and new ones in a day (unlinked ones count for the day)", () => {
  let d = newDesk({ MAX_SIGNS_PER_DAY: "2" });
  d.point("1", "c", "p", A, false, 1); d.point("2", "c", "p", "", true, 1);
  assert.equal(d.point("3", "c", "p", A, false, 1).status, 429);
  d = newDesk({ MAX_SIGNS: "1" });
  d.point("1", "c", "p", A, false, 1);
  assert.equal(d.point("2", "c", "p", A, false, 1).status, 429);
  d.point("1", "c", "p", "", true, 2);  // unlinked: its place is free again, its id is not
  assert.equal(d.point("2", "c", "p", A, false, 1).ok, true);
});

test("the counts say how many were made, moved and looked up, and nothing about which", () => {
  const d = newDesk();
  d.point("r", "c", "p", A, false, 1); d.point("r", "c", "p", B, false, 2); d.point("r", "c", "p", B, false, 3);
  d.where("r"); d.where("r"); d.where("nobody");
  const s = d.stats();
  assert.deepEqual([s.signs, s.signs_unlinked], [1, 0]);
  assert.deepEqual([s.sign_days[0].made, s.sign_days[0].moved, s.sign_days[0].lookups], [1, 1, 3]);
  assert.ok(!JSON.stringify(s).includes("trycloudflare"));
});
