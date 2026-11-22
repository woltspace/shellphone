// shellphone's service worker: shows a notification for each push, and opens the room on that message when you tap it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || "shellphone", { body: d.body || "", tag: d.tag, renotify: true, icon: "icon-180.png", data: { url: d.url || "./" } }));
});
// Tapping a notification lands on its message: an open app is told where to go, otherwise one opens there.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url, self.registration.scope).href;
  // Also leave a note the page reads when it starts or comes back: a phone opening the app from closed may drop the
  // address's #m=…, and a suspended page may miss the message below.
  const note = caches.open("landing").then((c) => c.put(new URL("landing-note", self.registration.scope).href, new Response(JSON.stringify({ url, at: Date.now() })))).catch(() => {});
  e.waitUntil(note.then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then(async (open) => {
    // the chat page knows how to land on a message; any other page (like the invite one) is sent to the chat
    const chat = open.find((c) => new URL(c.url).pathname === new URL(self.registration.scope).pathname);
    if (chat) { chat.postMessage({ type: "open", url }); return chat.focus(); }
    if (open.length) { const c = await open[0].navigate(url).catch(() => null); if (c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
// A room at a fixed address of its host's own (`shellphone room --hostname`): while the host's computer sleeps or is
// off, its tunnel answers with an error page of the tunnel's (Cloudflare's 530, or a 502/503/504). The app shows a page
// of its own instead, and comes back by itself when the room does. A quick tunnel's address never comes back: not there.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>shellphone</title><style>
body{margin:0;background:#f5f1e8;color:#18100a;font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
main{max-width:420px;margin:auto;padding:56px 20px}h1{color:#c4531e;font:600 20px ui-monospace,Menlo,monospace;margin:0 0 12px}
p{color:#5c4d3c;margin:8px 0}button{font:600 16px -apple-system,system-ui,sans-serif;padding:12px 18px;border-radius:12px;border:1px solid #c4531e;background:#c4531e;color:#fff}
@media (prefers-color-scheme:dark){body{background:#17130f;color:#f1e9dc}p{color:#b9ab97}}
</style></head><body><main><h1>&gt; shellphone</h1>
<p><b>This room is offline.</b></p><p>It runs on its host's computer, which is asleep or off right now. It comes back here by itself when that computer is back.</p>
<p><button id="again">Try again</button></p>
<script>
const back = async () => { try { const r = await fetch(location.href, { cache: "no-store" }); if (r.status < 500) location.reload(); } catch {} };
document.getElementById("again").onclick = back;
setInterval(back, 15000);
addEventListener("online", back);
document.addEventListener("visibilitychange", () => { if (!document.hidden) back(); });
</script></main></body></html>`;
const offline = () => new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate" || /\.trycloudflare\.com$/.test(self.location.hostname) || ["127.0.0.1", "localhost"].includes(self.location.hostname)) return;
  e.respondWith(fetch(e.request).then((res) => ([502, 503, 504, 521, 522, 523, 524, 530].includes(res.status) ? offline() : res), () => offline()));
});
