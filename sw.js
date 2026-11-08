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
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (open) => {
    // the chat page knows how to land on a message; any other page (like the invite one) is sent to the chat
    const chat = open.find((c) => new URL(c.url).pathname === new URL(self.registration.scope).pathname);
    if (chat) { chat.postMessage({ type: "open", url }); return chat.focus(); }
    if (open.length) { const c = await open[0].navigate(url).catch(() => null); if (c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
