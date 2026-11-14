// Sharing a file: the share sheet with the file where the browser can, a download where it can't.
//   node --test web/tests/share.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { fileName, kind, share, forget } from "../src/sharefile.js";

function env({ canShare = true, shareErr = null, status = 200 } = {}) {
  const log = { fetched: 0, shared: [], clicked: [] };
  const e = {
    log, File,
    fetch: async () => { log.fetched++; return { ok: status === 200, status, blob: async () => new Blob(["x"], { type: "video/mp4" }) }; },
    navigator: canShare === null ? {} : {
      canShare: () => canShare,
      share: async (d) => { if (shareErr) { const name = shareErr; shareErr = null; throw Object.assign(new Error(name), { name }); } log.shared.push(d.files[0]); },
    },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    document: { body: { appendChild: () => {} }, createElement: () => { const a = { click: () => log.clicked.push(a), remove: () => {} }; return a; } },
  };
  return e;
}

test("a file's own name is kept; a picture without one gets a plain name with its kind", () => {
  assert.equal(fileName("/files/ab.mp4", "beach.mp4"), "beach.mp4");
  assert.equal(fileName("/files/0123abcd.JPG"), "shellphone.jpg");
  assert.equal(fileName("/files/x?v=1"), "shellphone-file");
});

test("where files can be shared, the share sheet gets the file with its name and type", async () => {
  forget(); const e = env();
  assert.equal(await share("/files/a.mp4", "clip.mp4", e), "shared");
  assert.equal(e.log.shared[0].name, "clip.mp4");
  assert.equal(e.log.shared[0].type, "video/mp4");
});

test("where they can't (a computer), it downloads under the file's name", async () => {
  forget(); const e = env({ canShare: null });
  assert.equal(await share("/files/b.pdf", "notes.pdf", e), "downloaded");
  assert.equal(e.log.clicked[0].download, "notes.pdf");
});

test("closing the share sheet is not an error", async () => {
  forget(); const e = env({ shareErr: "AbortError" });
  assert.equal(await share("/files/c.mp4", "c.mp4", e), "cancelled");
});

test("if the tap ran out while fetching, the next tap shares the ready file without fetching again", async () => {
  forget(); const e = env({ shareErr: "NotAllowedError" });
  assert.equal(await share("/files/d.mp4", "d.mp4", e), "again");
  assert.equal(await share("/files/d.mp4", "d.mp4", e), "shared");
  assert.equal(e.log.fetched, 1);
});

test("a file that can't be fetched says so", async () => {
  forget(); const e = env({ status: 404 });
  await assert.rejects(share("/files/e.mp4", "e.mp4", e), /404/);
});

test("a file sent as plain bytes gets its kind from its name, so the share sheet offers the right apps", () => {
  assert.equal(kind("notes.pdf", "application/octet-stream"), "application/pdf");
  assert.equal(kind("clip.MOV", ""), "video/quicktime");
  assert.equal(kind("clip.mp4", "video/mp4"), "video/mp4");
  assert.equal(kind("thing.xyz", ""), "application/octet-stream");
});
