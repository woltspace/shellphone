// A tapped notification reaches the page two ways (see sw.js): a message from the service worker, and a note it leaves
// in the cache. Both carry the tap's note key, so the same tap arriving twice lands once, and a second tap on the same
// message still lands.
//
// The message can come before the app has drawn: the page starts taking them once its document has loaded, and one
// with nobody listening is gone. So this listens from the moment the code loads and keeps any early one for the app.
import * as notes from "./landing-notes.js";
import { trace } from "./trace";

export type Tap = { url: string; key?: string };
const early: Tap[] = [];
let handler: ((t: Tap) => void) | null = null;
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type !== "open" || typeof e.data.url !== "string") return;
  const t = { url: e.data.url, key: typeof e.data.key === "string" ? e.data.key : undefined };
  trace("tap heard: message", { early: !handler });
  if (handler) handler(t); else early.push(t);
});
navigator.serviceWorker?.startMessages?.();

export function onTap(f: (t: Tap) => void) {
  handler = f;
  early.splice(0).forEach(f);
  return () => { if (handler === f) handler = null; };
}

// The newest tap's note, if one is waiting. It stays until the app has landed on it (forget), so a page frozen on the
// way finds it again next time.
export async function pendingTap(): Promise<Tap | null> {
  try { return await notes.pending(await caches.open("landing")); } catch { return null; }  // no caches: the address and the message still work
}
export async function forget(key?: string) {
  try { await notes.forget(await caches.open("landing"), key); } catch { /* nothing to forget */ }
}
