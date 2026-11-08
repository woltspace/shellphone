// Notifications: the home-screen app registers a service worker; "notify me" asks once, then the room pushes new
// messages to this phone whenever the room isn't on screen.
import { useEffect, useState } from "react";

const b64key = (k: string) => Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(-k.length & 3)), (c) => c.charCodeAt(0));

async function setup(ask: boolean): Promise<"ask" | "on" | "off"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.Notification) return "off";
  const { key } = (await (await fetch("/api/push")).json().catch(() => ({}))) as { key?: string };
  if (!key) return "off";  // this room can't send notifications
  const reg = await navigator.serviceWorker.register("/sw.js");
  if (Notification.permission === "default" && !ask) return "ask";
  if (Notification.permission === "default" && (await Notification.requestPermission()) !== "granted") return "off";
  if (Notification.permission !== "granted") return "off";
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(key) }));
  await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  return "on";
}

// "ask" while this phone could turn notifications on; turnOn() is what the bell does.
export function usePush(report: (e: string) => void) {
  const [state, setState] = useState<"ask" | "on" | "off">("off");
  useEffect(() => { setup(false).then(setState).catch(() => {}); }, []);
  const turnOn = () => setup(true).then((s) => { setState(s); if (s === "on") report("Notifications on for this phone."); })
    .catch((e) => report("Couldn't turn on notifications: " + e.message));
  return { ask: state === "ask", turnOn };
}
