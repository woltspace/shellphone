// A page an agent posted, made ready for its sealed frame (see Page.tsx). Kept apart from the app so it can be tested.
//   sealed(html) → the frame's whole document: the policy that keeps it off the internet first, then the small helper a
//     page talks to the room through (window.shellphone), then the agent's own HTML
//   after(have, got) → the room's changes not seen yet, in order (a refetch can repeat some)

// Nothing from outside: no scripts, styles, pictures, fonts or forms from any address; only what's written in the page.
export const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

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
    + `<meta name="viewport" content="width=device-width,initial-scale=1">${HELPER}${body}`;
}

export function after(have, got) {
  const last = have.length ? have[have.length - 1].n : 0;
  return (got || []).filter((c) => c && typeof c.n === "number" && c.n > last).sort((a, b) => a.n - b.n)
    .filter((c, i, all) => i === 0 || c.n !== all[i - 1].n);
}
