// A tapped notification reaches the page two ways (see sw.js): a message from the service worker, and a note it leaves
// in the cache. Both carry the tap's own id, so the same tap arriving twice lands once, and a second tap on the same
// message still lands.
//
// The message can come before the app has drawn: the page starts taking them once its document has loaded, and one
// with nobody listening is gone. So this listens from the moment the code loads and keeps any early one for the app.
export type Tap = { url: string; tap?: string };
const early: Tap[] = [];
let handler: ((t: Tap) => void) | null = null;
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type !== "open" || typeof e.data.url !== "string") return;
  const t = { url: e.data.url, tap: e.data.tap };
  if (handler) handler(t); else early.push(t);
});
navigator.serviceWorker?.startMessages?.();

export function onTap(f: (t: Tap) => void) {
  handler = f;
  early.splice(0).forEach(f);
  return () => { if (handler === f) handler = null; };
}

// The note, if a tap left one in the last minute. It stays until the app says it landed (forget), so a page that reads it
// and is frozen before it gets there still finds it next time.
const KEY = () => new URL("landing-note", location.href).href;
export async function pendingTap(): Promise<Tap | null> {
  try {
    const r = await (await caches.open("landing")).match(KEY()); if (!r) return null;
    const n = await r.json() as Tap & { at: number };
    if (Date.now() - n.at < 60_000) return n;
    forget(n.tap);
  } catch { /* no caches here: the address and the message still work */ }
  return null;
}
export async function forget(tap?: string) {
  try {
    const c = await caches.open("landing"), r = await c.match(KEY()); if (!r) return;
    if (!tap || (await r.json()).tap === tap) await c.delete(KEY());  // a newer tap's note stays
  } catch { /* nothing to forget */ }
}
