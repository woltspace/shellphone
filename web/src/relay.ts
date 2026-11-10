// A room reached through the relay, at shellphone.woltspace.app/r/<room>#<kind>.<secret>.<token> (kind h: the host's link, i: an invite). The room itself runs on its
// host's computer; this page talks to it only through one sealed pipe, and every call the page makes goes through it.
// Elsewhere (a room served straight from its host, like today's rooms) none of this runs and the page uses fetch.
export type PipeState = "connecting" | "open" | "offline" | "refused";  // refused: this link's key doesn't open this room
export type Pipe = {
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  onState(cb: (s: PipeState) => void): void;
  onNews?(cb: () => void): () => void;  // the room says something changed: the page asks for it then, not on a timer
  close(): void;
};

// the room's id is in the address; its secret and token come after the # once, then live in this browser only
export const relayRoom = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{22})\/?$/)?.[1] || null;

function saved(): string | null {
  if (!relayRoom) return null;
  const store = `sp-room-${relayRoom}`, hash = location.hash.slice(1);
  try {
    if (/^[hi]\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/.test(hash)) {
      history.replaceState(null, "", location.pathname);  // out of the address bar and screenshots, whatever happens next
      try {
        // the same invite opened again by someone who already joined with it: they stay who they are
        const mine = localStorage.getItem(`sp-guest-${relayRoom}`);
        if (hash.startsWith("i.") && mine && mine.split(".")[1] === hash.split(".")[1]) return mine;
        localStorage.setItem(store, hash);
      } catch { /* no storage (private mode): kept for this visit only */ }
      return hash;  // a home-screen app opens the bare address later: storage keeps the key for it
    }
    return localStorage.getItem(store);
  } catch {
    return null;
  }
}
let key = saved();
export const relayKeyMissing = !!relayRoom && !key;
export const relayHost = key?.startsWith("h.") || false;  // the host's own link (an invite link starts with i.)
let joined = false;  // this browser became a guest during this visit (kept here too: storage may be blocked)
const named = () => { try { return localStorage.getItem(`sp-guest-${relayRoom}`) === key; } catch { return false; } };
export const needsName = () => !!key && key.startsWith("i.") && !joined && !named();  // an invite not yet turned into this guest's own

// A guest names themselves once: the room gives back their own token, kept here in place of the invite's, and from
// then on this browser is that guest
export async function becomeGuest(name: string): Promise<string | null> {
  const r = await call("/api/guest", { method: "POST", body: JSON.stringify({ name }) }).catch(() => null);
  const got = r && (await r.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!r || !r.ok || !got?.token) return got?.error || "Couldn't reach the room. Try again.";
  key = key!.split(".").slice(0, 2).concat(got.token).join(".");
  joined = true;
  try { localStorage.setItem(`sp-room-${relayRoom}`, key); localStorage.setItem(`sp-guest-${relayRoom}`, key); } catch { /* this visit only */ }
  const old = pipe; pipe = null;  // the next call opens a new pipe as that guest; no reload, so nothing kept in memory is lost
  old?.then((p) => p.close()).catch(() => {});
  return null;
}

// The host's invite: a link for people, made from the key the room keeps for it
export async function inviteLink(): Promise<string | null> {
  const r = await call("/api/invite").catch(() => null);
  const got = r && r.ok && (await r.json().catch(() => ({}))) as { key?: string };
  return got && got.key ? `${location.origin}${location.pathname}#${got.key}` : null;
}

// the pipe module is the relay's own code; the page only needs open(link) from it
const opener = Object.values(import.meta.glob<{ open: (link: string) => Pipe }>("./pipe.{js,ts}"))[0];
let pipe: Promise<Pipe> | null = null;
const listeners = new Set<(s: PipeState) => void>();
let state: PipeState = "connecting";

const tell = (s: PipeState) => { state = s; listeners.forEach((f) => f(s)); if (s === "open") heard(); };  // (re)connected: anything may have changed meanwhile
const news = new Set<() => void>();
const heard = () => news.forEach((f) => f());

function connect(): Promise<Pipe> {
  if (!pipe) {
    if (!key) return Promise.reject(new Error("This room's link is missing its key. Open the full link you were sent."));
    // a pipe that can't even start (no pipe module, a failed load, open() throwing) shows as offline, with its retry,
    // and the next call tries again from scratch rather than waiting on the failed attempt
    pipe = (opener ? opener() : Promise.reject(new Error("This page can't reach rooms through the relay yet."))).then((m) => {
      const p = m.open(`${location.origin}${location.pathname}#${key}`);
      p.onState(tell);
      p.onNews?.(heard);
      return p;
    }).catch((e) => { pipe = null; tell("offline"); throw e; });
  }
  return pipe;
}

export function onRelayNews(f: () => void) {
  news.add(f);
  return () => { news.delete(f); };
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
