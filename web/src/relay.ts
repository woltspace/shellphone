// A room reached through the relay, at shellphone.woltspace.app/r/<room>#<secret>.<token>. The room itself runs on its
// host's computer; this page talks to it only through one sealed pipe, and every call the page makes goes through it.
// Elsewhere (a room served straight from its host, like today's rooms) none of this runs and the page uses fetch.
export type PipeState = "connecting" | "open" | "offline";
export type Pipe = {
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  onState(cb: (s: PipeState) => void): void;
  close(): void;
};

// the room's id is in the address; its secret and token come after the # once, then live in this browser only
export const relayRoom = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{22})\/?$/)?.[1] || null;

function saved(): string | null {
  if (!relayRoom) return null;
  const store = `sp-room-${relayRoom}`, hash = location.hash.slice(1);
  try {
    if (/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/.test(hash)) {
      localStorage.setItem(store, hash);  // a home-screen app opens the bare address later: keep the key for it
      history.replaceState(null, "", location.pathname);  // and keep it out of the address bar and screenshots
      return hash;
    }
    return localStorage.getItem(store);
  } catch {
    return /^[A-Za-z0-9_-]{43}\./.test(hash) ? hash : null;  // no storage (private mode): this visit only
  }
}
const key = saved();
export const relayKeyMissing = !!relayRoom && !key;

// the pipe module is the relay's own code; the page only needs open(link) from it
const opener = Object.values(import.meta.glob<{ open: (link: string) => Pipe }>("./pipe.{js,ts}"))[0];
let pipe: Promise<Pipe> | null = null;
const listeners = new Set<(s: PipeState) => void>();
let state: PipeState = "connecting";

function connect(): Promise<Pipe> {
  if (!pipe) {
    if (!key) return Promise.reject(new Error("This room's link is missing its key. Open the full link you were sent."));
    if (!opener) return Promise.reject(new Error("This page can't reach rooms through the relay yet."));
    pipe = opener().then((m) => {
      const p = m.open(`${location.origin}${location.pathname}#${key}`);
      p.onState((s) => { state = s; listeners.forEach((f) => f(s)); });
      return p;
    });
  }
  return pipe;
}

export function onRelayState(f: (s: PipeState) => void) {
  listeners.add(f); f(state);
  return () => { listeners.delete(f); };
}

// fetch's shape, so the rest of the page doesn't change: text calls go through the pipe; pictures and voice notes
// aren't carried by relay rooms yet, and say so
export async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (init.body && typeof init.body !== "string") return json(501, { error: "Pictures, files and voice notes don't work in this room yet: text only for now." });
  const p = await connect();
  const got = await p.request((init.method || "GET").toUpperCase(), url, init.body ? JSON.parse(init.body as string) : undefined);
  return json(got.status, got.body);
}
