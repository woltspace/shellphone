// A small on-phone log of how a tapped notification lands (heard the tap? which thread? did it open? found the message?),
// kept in this browser only, so a flaky landing can be seen instead of guessed. Read it from the menu: Landing trace.
const KEY = "landing-trace", MOST = 60;
export type TraceEntry = { at: number; step: string; data?: unknown };

export function trace(step: string, data?: unknown) {
  try {
    const all: TraceEntry[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    all.push({ at: Date.now(), step, data });
    localStorage.setItem(KEY, JSON.stringify(all.slice(-MOST)));
  } catch { /* private mode or full: the app works the same without it */ }
}
export function readTrace(): TraceEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function clearTrace() { try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ } }
export function traceText(all = readTrace()) {
  return all.map((e) => `${new Date(e.at).toLocaleTimeString([], { hour12: false })}.${String(e.at % 1000).padStart(3, "0")} ${e.step}${e.data === undefined ? "" : " " + JSON.stringify(e.data)}`).join("\n");
}
