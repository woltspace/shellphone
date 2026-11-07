// Shell Phone's service worker: shows a notification for each push, and opens the room when you tap it.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || "Shell Phone", { body: d.body || "", tag: d.tag, renotify: true, icon: "icon-180.png", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => {
    if (open.length) return open[0].focus();
    return self.clients.openWindow(e.notification.data.url);
  }));
});
