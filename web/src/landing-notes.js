// The notes tapped notifications leave in the "landing" cache (see sw.js): one per tap, at landing-note/<tap>, so landing
// on one tap never removes a newer one. Kept apart from the page so it can be tested with a stand-in cache.
//   pending(cache) → the newest note from the last minute, { url, tap, key }, or null. Stale notes and ones the newest has
//     superseded (older taps) are cleared on the way, so landing on the newest never lets an older one come back after it
//   forget(cache, key, at) → once the app has landed on a tap, its note is gone, and so is any older one it supersedes
//     (however the tap arrived: as a note, or straight from the worker); a newer one stays
const FRESH = 60_000;

export async function pending(cache, now = Date.now()) {
  let best = null; const fresh = [];
  for (const req of await cache.keys()) {
    const key = typeof req === "string" ? req : req.url;
    if (!/\/landing-note(\/[^/]+)?$/.test(new URL(key).pathname)) continue;  // (a bare landing-note is from before taps had ids)
    const r = await cache.match(key); if (!r) continue;
    let n = null; try { n = await r.json(); } catch { /* unreadable: dropped below */ }
    if (!n || typeof n.url !== "string" || !(now - n.at < FRESH)) { await cache.delete(key); continue; }
    fresh.push({ key, at: n.at });
    if (!best || n.at > best.at) best = { url: n.url, tap: n.tap, at: n.at, key };
  }
  // only what was already there and older: a tap written while this looked is newer, and stays
  for (const f of fresh) if (best && f.key !== best.key && f.at <= best.at) await cache.delete(f.key);
  return best && { url: best.url, tap: best.tap, key: best.key, at: best.at };
}

export async function forget(cache, key, at) {
  if (!key) return;
  if (typeof at !== "number") { try { at = (await (await cache.match(key))?.json())?.at; } catch { /* unreadable */ } }
  await cache.delete(key);
  if (typeof at !== "number") return;
  for (const req of await cache.keys()) {
    const k = typeof req === "string" ? req : req.url;
    if (!/\/landing-note(\/[^/]+)?$/.test(new URL(k).pathname)) continue;
    let n = null; try { n = await (await cache.match(k))?.json(); } catch { /* unreadable: pending() drops it */ }
    if (n && typeof n.at === "number" && n.at <= at) await cache.delete(k);
  }
}
