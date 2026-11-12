// A page an agent posted, made ready for its sealed frame (see Page.tsx). Kept apart from the app so it can be tested.
//   sealed(html) → the frame's whole document: the policy that keeps it off the internet first, the lock, then the small helper a
//     page talks to the room through (window.shellphone), then the agent's own HTML
//   after(have, got) → the room's changes not seen yet, in order (a refetch can repeat some)

// Nothing from outside: no scripts, styles, pictures, fonts or forms from any address; only what's written in the page.
export const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'; webrtc 'block'";

// Before anything of the page's runs: no address lookups ahead of time, and no WebRTC (Safari's engine ignores the
// policy's webrtc rule, so the browser's own calls are taken away). From softie's seal test, contract section 4.
const LOCK = `<meta http-equiv="x-dns-prefetch-control" content="off">`
  + `<script>(()=>{for(const k of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCSessionDescription','RTCIceCandidate','mozRTCPeerConnection'])try{Object.defineProperty(window,k,{value:undefined,writable:false,configurable:false})}catch(e){}})()</script>`;

// What a page sees: shellphone.me, shellphone.changes, shellphone.change(op), shellphone.onChange(fn). It draws only
// what the room confirmed, in the room's order, so everyone ends with the same board.
const HELPER = `<script>
window.shellphone = (() => {
  let seen = 0, on = () => {}; const all = [];
  addEventListener("message", (e) => {
    const d = e.data; if (e.source !== parent || !d || d.shellphone !== 1) return;
    if (d.type === "init") api.me = d.me;
    if (d.type === "init" || d.type === "changes") for (const c of d.changes) if (c.n > seen) { seen = c.n; all.push(c); on(c, all); }
  });
  const api = { me: null, changes: all, change: (op) => parent.postMessage({ shellphone: 1, type: "change", op }, "*"),
                onChange: (fn) => { on = fn; all.forEach((c) => fn(c, all)); } };
  addEventListener("DOMContentLoaded", () => parent.postMessage({ shellphone: 1, type: "ready" }, "*"));
  return api;
})();
</script>`;

export function sealed(html) {
  const body = String(html || "").replace(/^﻿?\s*<!doctype[^>]*>/i, "");  // ours goes first, or the page is drawn in quirks mode
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}">`
    + `${LOCK}<meta name="viewport" content="width=device-width,initial-scale=1">${HELPER}${body}`;
}

export function after(have, got) {
  const last = have.length ? have[have.length - 1].n : 0;
  return (got || []).filter((c) => c && typeof c.n === "number" && c.n > last).sort((a, b) => a.n - b.n)
    .filter((c, i, all) => i === 0 || c.n !== all[i - 1].n);
}

// One look at the room for an open page. cur: what the viewer has ({v, title, by, html, changes}, v 0 before the first
// load). get(after, v) asks GET /api/page and gives its answer, "missing" (the room has no such page), or null (couldn't
// reach the room). Gives back { page } (the new whole state: a new version comes with its whole board, swapped in only
// once both are in hand), { fresh } (new changes for the same version), or { error: "missing" | "unreachable" }, with
// cur left as it was so the next look starts from the same place.
export async function look(cur, get) {
  const last = cur.v && cur.changes.length ? cur.changes[cur.changes.length - 1].n : 0;
  const got = await get(last, cur.v);
  if (got === "missing") return { error: "missing" };
  if (!got || typeof got !== "object") return { error: "unreachable" };
  if (typeof got.html === "string" && got.v !== cur.v) {
    let all = got.changes;
    if (last) {  // what came back starts after the old board; the new version needs all of it
      const whole = await get(0, got.v);
      if (whole === "missing") return { error: "missing" };
      if (!whole || typeof whole !== "object") return { error: "unreachable" };
      all = whole.changes;
    }
    return { page: { v: got.v, title: got.title, by: got.by, html: got.html, changes: after([], all) } };
  }
  return { fresh: after(cur.changes, got.changes) };
}
