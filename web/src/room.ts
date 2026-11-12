// The room's log, as the page sees it. The room server is the only truth: this file only reads /api/state and posts back.
import { useEffect, useRef, useState } from "react";
import { call, needsName, onRelayNews, relayRoom } from "./relay";

export type Person = { email: string; name: string; color: string; guest?: boolean };  // guest: came in with the invite link, name not checked
export type Wolt = { wolt: string; owner: string; creature: string; voice?: string | null; paused?: boolean };  // paused: off, the room hands it nothing
export type FileInfo = { name: string; type: string; url: string; size: number };
export type CardNode = { type: string; props?: Record<string, any>; children?: CardNode[] };
export type PageRef = { id: string; title: string; line?: string; v: number };  // a page an agent posted (Page.tsx)
export type Activity = { page: string; title: string; by: { kind: string; name: string; count: number }[]; from: number; to: number };
export type Msg = {
  n: number; id: string; cid?: string; at: number; kind: "human" | "wolt" | "patch" | "activity";  // activity: "maya made 3 changes to …", said by the room
  email?: string; wolt?: string; owner?: string; creature?: string;
  text?: string; audio?: string; seconds?: number; files?: FileInfo[]; file?: FileInfo; card?: CardNode; of?: string; page?: PageRef; activity?: Activity;
  localUrl?: string; pending?: boolean; failed?: boolean; thread?: string;
};
export type Tab = { slug: string; title: string; v: number };
export type State = {
  version?: string; title: string; me: string; host?: string;  // host: the person who can pause or remove any agent
  members: { people: Person[]; wolts: Wolt[] };
  working: Record<string, unknown>; unreachable?: Record<string, number>; seen: Record<string, string[]>; tabs: Tab[];
  pages?: Record<string, { v: number; n: number }>;  // where each page stands: its version and its last change
};

// How many sends are on their way. The page doesn't reload itself for a new version while one is.
export const sending = { n: 0 };
export async function send(url: string, init: RequestInit) {
  sending.n++;
  try { return await (relayRoom ? call(url, init) : fetch(url, init)).catch(() => null); } finally { sending.n--; }
}
export async function say(url: string, init: RequestInit): Promise<string | null> {
  const r = await send(url, init);
  if (!r) return "Can't reach the room.";
  if (!r.ok) return ((await r.json().catch(() => ({}))) as { error?: string }).error || "That didn't send.";
  return null;
}
export const sendText = (text: string, thread?: string) =>
  say("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, cid: Math.random().toString(36).slice(2, 12), ...(thread ? { thread } : {}) }) });  // a cid: sent twice, it lands once

export function useRoom() {
  const [state, setState] = useState<State>({ title: "shell", me: "", members: { people: [], wolts: [] }, working: {}, seen: {}, tabs: [] });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<Msg[]>([]);  // wolt voice notes that arrived while open, to play in turn
  const after = useRef(0), first = useRef(true), version = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Through a host that says when something changed (its state answer carries news: true), the page asks only then (and when it reconnects or comes back on
    // screen), with a slow check as a safety net: much less polling while a room is quiet. Elsewhere, every 2 s.
    let stop = false, timer = 0, busy = false, again = false, pushes = false, failed = false;
    const kick = () => { if (busy) again = true; else { clearTimeout(timer); poll(); } };
    const off = relayRoom ? onRelayNews(kick) : () => {};
    const shown = () => { if (document.visibilityState === "visible") kick(); };
    if (relayRoom) document.addEventListener("visibilitychange", shown);
    async function poll() {
      if (needsName()) { timer = window.setTimeout(poll, 500); return; }
      busy = true;  // a guest picks a name first; until then the room has nothing for them
      try {
        const url = `/api/state?after=${after.current}${document.visibilityState === "visible" ? "&here=1" : ""}`;
        const r = await (relayRoom ? call(url) : fetch(url, { cache: "no-store" }));
        if (r.status === 403) { busy = false; setError("You're not on this room's list."); return; }
        const s = (await r.json()) as State & { messages: Msg[]; news?: boolean };
        pushes = !!relayRoom && s.news === true;  // an older host never sends news: keep asking every 2 s
        // a new version of the page: reload, but not in the middle of recording, typing or sending (it waits, then reloads)
        // (through the relay the page comes from the relay, not the room: the room's version says nothing about it)
        if (!relayRoom && version.current && s.version && s.version !== version.current) { if (!document.querySelector("[data-busy]") && !sending.n) return location.reload(); }
        else version.current = s.version;
        const { messages, news: _, ...rest } = s;
        setState(rest);
        const patches = messages.filter((m) => m.kind === "patch");
        const added = messages.filter((m) => m.kind === "human" || m.kind === "wolt" || (m.kind === "activity" && !!m.activity));
        for (const m of added) {
          if (m.file && !m.files) m.files = [m.file];  // older messages carry one file
          for (const f of m.files || []) if (!/^(\/|https?:)/.test(f.url)) f.url = "/" + f.url;  // the room gives addresses relative to its root
        }
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
        setError(""); failed = false;
      } catch { setError("Can't reach the room, trying again…"); failed = true; }
      busy = false;
      if (stop) return;
      if (again) { again = false; return kick(); }  // news while asking: what came back may already be old
      timer = window.setTimeout(poll, pushes && !failed ? 30000 : 2000);  // after a failed fetch, try again soon
    }
    poll();
    return () => { stop = true; clearTimeout(timer); off(); document.removeEventListener("visibilitychange", shown); };
  }, []);

  const person = (email?: string): Person => state.members.people.find((p) => p.email === email) || { email: email || "", name: email || "?", color: "#8a6a52" };
  return { state, msgs, setMsgs, error, setError, person, fresh, setFresh, after };
}
