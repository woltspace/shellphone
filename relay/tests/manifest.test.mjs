// A room added to a home screen: its page names a manifest of its own, which opens the room again (not the front page).
//   node --test relay/tests/manifest.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const line = 'import { DurableObject } from "cloudflare:workers";';
const file = join(mkdtempSync(join(tmpdir(), "relay-")), "index.mjs");
writeFileSync(file, source.replace(line, "class DurableObject {}"));
const { roomManifest, roomPage } = await import(pathToFileURL(file).href);
const shared = readFileSync(new URL("../../manifest.webmanifest", import.meta.url), "utf8");
const page = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
const ROOM = "AbCdEfGhIjKlMnOpQrStUv";

test("a room's manifest starts and stays at the room, and keeps the site's icons", async () => {
  const r = await roomManifest(new Response(shared), ROOM);
  assert.equal(r.headers.get("content-type"), "application/manifest+json");
  const m = await r.json();
  assert.equal(m.start_url, `/r/${ROOM}`); assert.equal(m.scope, `/r/${ROOM}`); assert.equal(m.id, `/r/${ROOM}`);
  assert.equal(m.name, "shellphone"); assert.equal(m.display, "standalone");
  for (const i of m.icons) assert.ok(i.src.startsWith("/icon-"), i.src);
});

test("the room's page points at that manifest", async () => {
  const r = await roomPage(new Response(page), ROOM);
  const html = await r.text();
  assert.ok(html.includes(`<link rel="manifest" href="/r/${ROOM}/manifest.webmanifest"`));
  assert.ok(!html.includes('href="/manifest.webmanifest"'));
  assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
});

test("a missing file stays missing", async () => {
  assert.equal((await roomManifest(new Response("", { status: 404 }), ROOM)).status, 404);
  assert.equal((await roomPage(new Response("", { status: 404 }), ROOM)).status, 404);
});
