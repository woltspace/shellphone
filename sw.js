// Shell Phone's service worker: shows a notification for each push, and opens the room on that message when you tap it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || "Shell Phone", { body: d.body || "", tag: d.tag, renotify: true, icon: "icon-180.png", data: { url: d.url || "./" } }));
});
// Tapping a notification lands on its message: an open app is told where to go, otherwise one opens there.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url, self.registration.scope).href;
  const tap = Math.random().toString(36).slice(2) + Date.now().toString(36);  // this tap, so arriving both ways it lands once
  const key = new URL("landing-note/" + tap, self.registration.scope).href;  // its own note: landing on it never removes a newer one
  // Also leave a note the page reads when it starts or comes back: a phone opening the app from closed may drop the
  // address's #m=…, and a suspended or still-starting page may miss the message below. The page removes it once it lands.
  const note = caches.open("landing").then((c) => c.put(key, new Response(JSON.stringify({ url, tap, at: Date.now() })))).catch(() => {});
  e.waitUntil(note.then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then(async (open) => {
    // the chat page knows how to land on a message; any other page (like the invite one) is sent to the chat
    const chat = open.find((c) => new URL(c.url).pathname === new URL(self.registration.scope).pathname);
    if (chat) {
      chat.postMessage({ type: "open", url, key });
      if (await chat.focus().catch(() => null)) return;  // it couldn't be brought up: open one on the message instead
    } else if (open.length) {
      const c = await open[0].navigate(url).catch(() => null); if (c && (await c.focus().catch(() => null))) return;
    }
    return self.clients.openWindow(url);
  }));
});
