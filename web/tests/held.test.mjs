// A held message and its menu stay on screen, whatever the message's size and wherever it was.
//   node --test web/tests/held.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { heldLayout } from "../src/held.js";

const fits = (l, vh) => l.top >= 0 && l.menuTop + l.menuH <= vh;

test("a tall message is cut short so the actions stay reachable", () => {
  const l = heldLayout({ top: -100, height: 900 }, 3, 700);
  assert.ok(fits(l, 700), JSON.stringify(l));
  assert.ok(l.cut);
  assert.ok(l.height < 900);
});

test("a short message stays where it was, whole", () => {
  const l = heldLayout({ top: 200, height: 60 }, 3, 700);
  assert.deepEqual([l.top, l.height, l.cut], [200, 60, false]);
});

test("a message near the bottom moves up for its menu", () => {
  const l = heldLayout({ top: 640, height: 50 }, 3, 700);
  assert.ok(fits(l, 700));
  assert.equal(l.height, 50);
});

test("even a tiny screen keeps the menu on it", () => {
  for (const vh of [320, 400, 568]) for (const h of [40, 300, 2000]) for (const n of [1, 2, 3]) {
    const l = heldLayout({ top: 100, height: h }, n, vh);
    assert.ok(l.menuTop + l.menuH <= vh || l.height === 48, JSON.stringify({ vh, h, n, l }));
  }
});
