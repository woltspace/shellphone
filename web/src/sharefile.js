// Share a file from the room the way the phone shares things: the share sheet with the file itself (Save Image,
// Save Video, AirDrop, Messages…). Where the browser can't share files (most computers), it downloads it instead.
//
// A phone only opens the share sheet straight from a tap. Fetching a big video first can take long enough that the
// tap no longer counts; then the file is kept ready and the button asks for one more tap, which shares at once.
//   node --test web/tests/share.test.mjs

const ready = new Map();  // url -> File, fetched already

export function fileName(url, name) {
  if (name) return name;
  const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i) || [])[1];
  return ext ? `shellphone.${ext.toLowerCase()}` : "shellphone-file";
}

// The room sends some files as plain bytes; the share sheet offers the right apps only if it knows the kind.
const KINDS = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mp3: "audio/mpeg",
  m4a: "audio/mp4", txt: "text/plain", csv: "text/csv", zip: "application/zip" };
export function kind(name, type) {
  if (type && type !== "application/octet-stream") return type;
  return KINDS[(name.match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase()] || "application/octet-stream";
}

export async function load(url, name, env = globalThis) {
  if (ready.has(url)) return ready.get(url);
  const r = await env.fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`couldn't get the file (${r.status})`);
  const blob = await r.blob();
  const n = fileName(url, name), file = new env.File([blob], n, { type: kind(n, blob.type) });
  ready.set(url, file);
  return file;
}

export function canShareFiles(env = globalThis) {
  return typeof env.navigator?.canShare === "function";
}

// "shared", "cancelled", "downloaded", or "again" (the file is ready now: share on the next tap)
export async function share(url, name, env = globalThis) {
  const nav = env.navigator, wasReady = ready.has(url);
  const file = await load(url, name, env);
  if (!(typeof nav?.canShare === "function" && nav.canShare({ files: [file] }))) { download(file, env); return "downloaded"; }
  try { await nav.share({ files: [file] }); return "shared"; }
  catch (e) {
    if (e?.name === "AbortError") return "cancelled";
    if (e?.name === "NotAllowedError" && !wasReady) return "again";
    throw e;
  }
}

function download(file, env) {
  const a = env.document.createElement("a"), href = env.URL.createObjectURL(file);
  a.href = href; a.download = file.name; a.rel = "noopener";
  env.document.body.appendChild(a); a.click(); a.remove();
  const t = setTimeout(() => env.URL.revokeObjectURL(href), 60_000); t?.unref?.();
}

export function forget() { ready.clear(); }  // tests
