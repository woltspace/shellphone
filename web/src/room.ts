// The room's log, as the page sees it. The room server is the only truth: this file only reads /api/state and posts back.
import { useEffect, useRef, useState } from "react";

export type Person = { email: string; name: string; color: string };
export type Wolt = { wolt: string; owner: string; creature: string; voice?: string | null };
export type FileInfo = { name: string; type: string; url: string; size: number };
export type CardNode = { type: string; props?: Record<string, any>; children?: CardNode[] };
export type Msg = {
  n: number; id: string; cid?: string; at: number; kind: "human" | "wolt" | "patch";
  email?: string; wolt?: string; owner?: string; creature?: string;
  text?: string; audio?: string; seconds?: number; file?: FileInfo; card?: CardNode; of?: string;
  localUrl?: string; pending?: boolean; failed?: boolean; thread?: string;
};
export type Tab = { slug: string; title: string; v: number };
export type State = {
  version?: string; title: string; me: string;
  members: { people: Person[]; wolts: Wolt[] };
  working: Record<string, unknown>; seen: Record<string, string[]>; tabs: Tab[];
};

// How many sends are on their way. The page doesn't reload itself for a new version while one is.
export const sending = { n: 0 };
export async function send(url: string, init: RequestInit) {
  sending.n++;
  try { return await fetch(url, init).catch(() => null); } finally { sending.n--; }
}
export async function say(url: string, init: RequestInit): Promise<string | null> {
  const r = await send(url, init);
  if (!r) return "Can't reach the room.";
  if (!r.ok) return ((await r.json().catch(() => ({}))) as { error?: string }).error || "That didn't send.";
  return null;
}
export const sendText = (text: string, thread?: string) =>
  say("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, ...(thread ? { thread } : {}) }) });

export function useRoom() {
  const [state, setState] = useState<State>({ title: "shell", me: "", members: { people: [], wolts: [] }, working: {}, seen: {}, tabs: [] });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<Msg[]>([]);  // wolt voice notes that arrived while open, to play in turn
  const after = useRef(0), first = useRef(true), version = useRef<string | undefined>(undefined);

  useEffect(() => {
    let stop = false, timer = 0;
    async function poll() {
      try {
        const r = await fetch(`/api/state?after=${after.current}${document.visibilityState === "visible" ? "&here=1" : ""}`, { cache: "no-store" });
        if (r.status === 403) { setError("You're not on this room's list."); return; }
        const s = (await r.json()) as State & { messages: Msg[] };
        // a new version of the page: reload, but not in the middle of recording, typing or sending (it waits, then reloads)
        if (version.current && s.version && s.version !== version.current) { if (!document.querySelector("[data-busy]") && !sending.n) return location.reload(); }
        else version.current = s.version;
        const { messages, ...rest } = s;
        setState(rest);
        const patches = messages.filter((m) => m.kind === "patch");
        const added = messages.filter((m) => m.kind === "human" || m.kind === "wolt");
        for (const m of added) if (m.file && !/^(\/|https?:)/.test(m.file.url)) m.file.url = "/" + m.file.url;  // the room gives addresses relative to its root
        for (const m of messages) after.current = Math.max(after.current, m.n);
        if (messages.length) {
          setMsgs((old) => {
            // the room's copy of a voice note replaces the one shown while sending, keeping the recording already loaded
            const real = new Map(added.filter((m) => m.cid).map((m) => [m.cid, m]));
            const kept = old.filter((m) => {
              const r = (m.pending || m.failed) && m.cid ? real.get(m.cid) : undefined;
              if (r) r.localUrl = m.localUrl;
              return !r;
            });
            const have = new Set(kept.map((m) => m.id));  // your own text is already shown from when you sent it
            // in the room's order, whatever order they reached this phone in (a message still sending sits last)
            const all = [...kept, ...added.filter((m) => !have.has(m.id))].sort((a, b) => a.n - b.n);
            for (const p of patches) { const t = all.find((m) => m.id === p.of); if (t) t.audio = p.audio; }
            return patches.length ? all.map((m) => ({ ...m })) : all;
          });
          if (!first.current) {
            const voiced = patches.filter((p) => p.audio).map((p) => p.of);
            if (voiced.length) setFresh((f) => [...f, ...voiced.map((id) => ({ id } as Msg))]);
          }
        }
        first.current = false;
        setError("");
      } catch { setError("Can't reach the room, trying again…"); }
      if (!stop) timer = window.setTimeout(poll, 2000);
    }
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  const person = (email?: string): Person => state.members.people.find((p) => p.email === email) || { email: email || "", name: email || "?", color: "#8a6a52" };
  return { state, msgs, setMsgs, error, setError, person, fresh, setFresh, after };
}
