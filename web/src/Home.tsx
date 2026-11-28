// A lodge phone's home: your wolts, not a room. It's drawn from a layout (blocks, in order) that the room keeps and any
// of your wolts can rearrange (room.py layout set FILE). A block is data: its type picks one of the drawings below, and
// nothing a wolt writes is ever drawn as HTML. Tap a wolt: its DM (its own chat with you), or a new one.
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { woltColor, woltFace, type Ctx } from "./Message";
import type { Msg, State } from "./room";
import { rootFresh } from "./Threads";

export type Block = { type: "search" | "waiting" | "working" | "grid" | "chats"; title?: string; wolts?: string[]; limit?: number };
type Chat = { id: string; root: Msg; last: Msg; wolt: string; fresh: boolean };

const ago = (t: number) => {
  const s = Date.now() / 1000 - t;
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : new Date(t * 1000).toLocaleDateString(undefined, { weekday: "short" });
};
const preview = (m: Msg) => (m.text || (m.audio ? "🎤 voice note" : m.files?.length ? "📎 file" : m.page ? "📄 " + m.page.title : "")).replace(/\s+/g, " ");

// Whose chat each one is: a chat hanging off a wolt's message is that wolt's; one you started is the wolt alone in it.
export function chatsByWolt(roots: Msg[], replies: Map<string, Msg[]>, state: State, seen: Record<string, number>): Chat[] {
  const out: Chat[] = [];
  for (const r of roots) {
    const list = [r, ...(replies.get(r.id) || [])], last = list.at(-1)!;
    let wolt = r.kind === "wolt" ? r.wolt || "" : "";
    if (!wolt) {
      const inThere = Object.entries(state.who?.[r.id] || {}).filter(([, s]) => s === "in").map(([w]) => w);
      wolt = inThere.length === 1 ? inThere[0] : (list.find((m) => m.kind === "wolt")?.wolt || "");
    }
    if (!wolt) continue;
    const mine = (m: Msg) => m.kind === "human" && m.email === state.me;
    const fresh = list.some((m) => m.n > (seen[r.id] || 0) && !mine(m)) || rootFresh(r, seen, state.me);
    out.push({ id: r.id, root: r, last, wolt, fresh });
  }
  return out.sort((a, b) => b.last.at - a.last.at);
}

export function Home({ layout, state, ctx, chats, onWolt, onOpen }: {
  layout: Block[]; state: State; ctx: Ctx; chats: Chat[];
  onWolt: (wolt: string) => void; onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState(""), [all, setAll] = useState(false);
  const wolts = state.members.wolts.filter((w) => !w.paused);
  // most recently talked to first, then the rest by name
  const recent = useMemo(() => {
    const at = new Map<string, number>();
    for (const c of chats) if (!at.has(c.wolt)) at.set(c.wolt, c.last.at);
    return [...wolts].sort((a, b) => (at.get(b.wolt) || 0) - (at.get(a.wolt) || 0) || a.wolt.localeCompare(b.wolt)).map((w) => w.wolt);
  }, [chats, wolts]);
  const working = (w: string) => !!state.working?.[w];
  const waiting = chats.filter((c) => c.fresh && c.last.kind === "wolt");
  const face = (w: string, ring?: "work" | "wait", size = "w-12 h-12") => <span className={`relative flex-none ${size} rounded-full ${ring === "work" ? "ring-[3px] ring-[#2f9e5b] ring-offset-2 ring-offset-paper" : ring === "wait" ? "ring-[3px] ring-[#d99a1e] ring-offset-2 ring-offset-paper" : ""}`}>
    <img src={woltFace(w)} alt="" className={`pixel ${size}`} /></span>;
  const sec = (t?: string) => t ? <div className="px-4 pt-4 pb-1.5 font-mono font-semibold text-[11px] tracking-[.08em] uppercase text-dim">{t}</div> : null;
  const row = (c: Chat, note?: string) => <button key={c.id} type="button" onClick={() => onOpen(c.id)}
    className="w-full flex items-center gap-3 px-4 py-2.5 border-0 border-b border-line bg-transparent text-left cursor-pointer active:bg-[#18100a0d]">
    {face(c.wolt, working(c.wolt) ? "work" : undefined)}
    <span className="flex-1 min-w-0">
      <span className="flex items-baseline gap-2"><b className="font-mono text-[15px] truncate" style={{ color: woltColor(c.wolt, ctx.wolts) }}>{c.wolt}</b>
        <small className="ml-auto flex-none text-dim text-[12px]">{ago(c.last.at)}</small></span>
      <span className={`block truncate text-[14px] ${c.fresh ? "text-ink font-medium" : "text-dim"}`}>
        {note ? <span className="text-[#b9800f]">{note} · </span> : working(c.wolt) ? <span className="text-[#2f9e5b]">working · </span> : null}
        {c.last.kind === "human" ? "You: " : ""}{preview(c.last)}</span>
    </span>
    {c.fresh && <span className="flex-none w-2.5 h-2.5 rounded-full bg-acc" />}
  </button>;
  const cell = (w: string) => <button key={w} type="button" onClick={() => onWolt(w)} className="flex flex-col items-center gap-1 border-0 bg-transparent cursor-pointer min-w-0 active:scale-95 transition-transform">
    {face(w, working(w) ? "work" : waiting.some((c) => c.wolt === w) ? "wait" : undefined, "w-14 h-14")}
    <span className="max-w-full truncate font-mono text-[11.5px]">{w}</span></button>;

  const draw = (b: Block, i: number) => {
    if (b.type === "search") return <div key={i} className="px-3 pt-3 pb-1">
      <label className="flex items-center gap-2 h-11 px-3 rounded-xl bg-white border border-line">
        <Search size={17} className="text-dim flex-none" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={b.title || "Search your wolts"} className="flex-1 min-w-0 border-0 outline-0 bg-transparent text-[16px]" />
        {query && <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="border-0 bg-transparent text-dim cursor-pointer"><X size={17} /></button>}
      </label></div>;
    if (query) return null;  // searching: only the search and its results
    if (b.type === "waiting") return waiting.length ? <div key={i}>{sec(`${b.title || "Waiting on you"} · ${waiting.length}`)}{waiting.slice(0, b.limit || 5).map((c) => row(c, "waiting on you"))}</div> : null;
    if (b.type === "working") {
      const busy = recent.filter(working);
      return busy.length ? <div key={i}>{sec(b.title || "Working now")}<div className="flex gap-3 px-4 pb-1 overflow-x-auto">{busy.map(cell)}</div></div> : null;
    }
    if (b.type === "grid") {
      const list = (b.wolts?.length ? b.wolts.filter((w) => wolts.some((x) => x.wolt === w)) : recent);
      const cap = all ? list.length : b.limit || 8, more = list.length - cap;
      return <div key={i}>{sec(b.title || "Your wolts")}<div className="grid grid-cols-4 gap-x-2 gap-y-3 px-3">
        {list.slice(0, cap).map(cell)}
        {more > 0 && <button type="button" onClick={() => setAll(true)} className="flex flex-col items-center gap-1 border-0 bg-transparent cursor-pointer">
          <span className="w-14 h-14 rounded-full grid place-items-center bg-[#18100a0f] font-mono text-[14px] text-dim">+{more}</span>
          <span className="font-mono text-[11.5px] text-dim">all</span></button>}
      </div></div>;
    }
    if (b.type === "chats") return chats.length ? <div key={i}>{sec(b.title || "Recent")}{chats.slice(0, b.limit || 30).map((c) => row(c))}</div> : null;
    return null;
  };
  const found = query ? recent.filter((w) => w.toLowerCase().includes(query.trim().toLowerCase())) : [];
  return <div className="pb-28">
    {layout.map(draw)}
    {query && (found.length
      ? found.map((w) => { const c = chats.find((x) => x.wolt === w); return c ? row(c) : <button key={w} type="button" onClick={() => onWolt(w)}
          className="w-full flex items-center gap-3 px-4 py-2.5 border-0 border-b border-line bg-transparent text-left cursor-pointer active:bg-[#18100a0d]">
          {face(w)}<span className="flex-1 min-w-0"><b className="font-mono text-[15px]" style={{ color: woltColor(w, ctx.wolts) }}>{w}</b>
          <span className="block text-[14px] text-dim">Start a chat</span></span></button>; })
      : <p className="text-center text-dim font-mono text-xs mt-6">No wolt called “{query}”.</p>)}
  </div>;
}
