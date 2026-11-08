// Thread pieces, borrowed from Slack: the replies line under a message, the list of every thread, and what you've seen.
// Each thread gets a short title and its own color, so with many of them you can still tell them apart at a glance.
import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, MessagesSquare } from "lucide-react";
import type { Ctx } from "./Message";
import type { Msg } from "./room";
import { personAvatar, woltAvatar } from "./sprites";

export function ago(at: number) {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const COLORS = ["#c4531e", "#2e7d9d", "#7a4fb5", "#2e9d57", "#b58a1f", "#c2417a"];
export const threadColor = (id: string) => COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
// the first few words of the message it hangs off, without the @tags in front
export function threadTitle(m?: Msg) {
  if (!m) return "thread";
  const words = (m.text || "").replace(/\s+/g, " ").replace(/^(@[\w-]+[\s,:]*)+/, "").trim().split(" ").filter(Boolean);
  if (!words.length) return m.file ? m.file.name : "Voice note";
  return words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
}

// The threads you opened lately, newest first, kept on this phone: the strip at the top of a thread.
export function useRecent() {
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("threads-recent") || "[]"); } catch { return []; } });
  const touch = useCallback((id: string) => setRecent((r) => {
    const next = [id, ...r.filter((x) => x !== id)].slice(0, 8);
    try { localStorage.setItem("threads-recent", JSON.stringify(next)); } catch { /* fine without */ }
    return next;
  }), []);
  return { recent, touch };
}

// who replied, latest first, one face each
function faces(list: Msg[], ctx: Ctx) {
  const out: { key: string; src: string }[] = [];
  for (const m of [...list].reverse()) {
    const key = m.kind === "human" ? m.email! : "wolt:" + m.wolt;
    if (out.some((f) => f.key === key)) continue;
    const who = ctx.person(m.kind === "human" ? m.email : m.owner);
    out.push({ key, src: m.kind === "human" ? personAvatar(who.name, who.color) : woltAvatar(m.creature || "raccoon", who.color) });
  }
  return out.slice(0, 3);
}

// What you've read in each thread lives on this phone only: the last message number you saw there.
export function useSeen() {
  const [seen, setSeen] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem("threads-seen") || "{}"); } catch { return {}; } });
  const mark = useCallback((id: string, n: number) => setSeen((s) => {
    if ((s[id] || 0) >= n) return s;
    const next = { ...s, [id]: n };
    try { localStorage.setItem("threads-seen", JSON.stringify(next)); } catch { /* fine without */ }
    return next;
  }), []);
  return { seen, mark };
}
export const unread = (list: Msg[], seen: number | undefined, me: string) => list.some((m) => m.n > (seen || 0) && !(m.kind === "human" && m.email === me));

export function ThreadLine({ root, list, fresh, onOpen }: { root: Msg; list: Msg[]; fresh: boolean; onOpen: () => void }) {
  const color = threadColor(root.id);
  return <button type="button" onClick={onOpen} style={{ color }}
    className="mt-1 inline-flex max-w-full items-center gap-1.5 font-mono text-xs bg-transparent border-0 p-0 cursor-pointer text-left">
    <i className="flex-none w-2 h-2 rounded-full" style={{ background: color }} />
    <span className={`min-w-0 truncate ${fresh ? "font-bold" : "font-semibold"}`}>{threadTitle(root)}</span>
    <span className="flex-none text-dim">· {list.length} {list.length === 1 ? "reply" : "replies"} · {ago(list.at(-1)!.at)}</span>
    {fresh && <i className="flex-none w-2 h-2 rounded-full bg-acc" aria-label="new replies" />}
    <ChevronRight className="flex-none" size={15} />
  </button>;
}

// Recent threads side by side under a thread's header: hop between them without going back to the list.
export function RecentStrip({ ids, current, roots, replies, seen, me, onOpen, onAll }: {
  ids: string[]; current: string; roots: Map<string, Msg>; replies: Map<string, Msg[]>; seen: Record<string, number>; me: string;
  onOpen: (id: string) => void; onAll: () => void;
}) {
  const shown = ids.filter((id) => roots.has(id));
  if (shown.length < 2) return null;
  return <div className="flex-none flex gap-1.5 overflow-x-auto px-2.5 py-2 bg-panel border-b border-line [scrollbar-width:none]">
    {shown.map((id) => { const c = threadColor(id), on = id === current, fresh = !on && unread(replies.get(id) || [], seen[id], me);
      return <button key={id} type="button" onClick={() => onOpen(id)} style={on ? { color: c, borderColor: c, boxShadow: `0 0 0 1px ${c}` } : undefined}
        className={`flex-none max-w-[190px] inline-flex items-center gap-1.5 font-mono font-semibold text-[11.5px] rounded-full border border-line px-2.5 py-1 cursor-pointer ${on ? "bg-white" : "bg-paper text-ink"}`}>
        <i className="flex-none w-2 h-2 rounded-full" style={{ background: c }} /><span className="truncate">{threadTitle(roots.get(id))}</span>
        {fresh && <i className="flex-none w-1.5 h-1.5 rounded-full bg-acc" />}
      </button>; })}
    <button type="button" onClick={onAll} className="flex-none font-mono font-semibold text-[11.5px] text-acc bg-transparent border-0 px-1.5 cursor-pointer">all ›</button>
  </div>;
}

const preview = (m: Msg) => (m.text || (m.file ? "📎 " + m.file.name : m.audio ? "🎤 voice note" : "")).replace(/\s+/g, " ");

// Every thread in the room: ones with replies you haven't seen first, then the most recently active.
export function ThreadList({ roots, replies, ctx, seen, onOpen, onClose }: {
  roots: Msg[]; replies: Map<string, Msg[]>; ctx: Ctx; seen: Record<string, number>; onOpen: (id: string) => void; onClose: () => void;
}) {
  const items = roots.map((r) => { const list = replies.get(r.id)!; return { r, list, last: list.at(-1)!, fresh: unread(list, seen[r.id], ctx.me) }; })
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.last.at - a.last.at);
  const name = (m: Msg) => (m.kind === "human" ? ctx.person(m.email).name : m.wolt!);
  const freshCount = items.filter((i) => i.fresh).length;
  return <div className="absolute inset-0 z-[1500] bg-paper flex flex-col animate-[fadein_.18s_ease-out]">
    <header className="flex-none flex items-center gap-2 px-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-panel border-b border-line">
      <button type="button" aria-label="Back" onClick={onClose} className="w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={24} /></button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-mono font-semibold text-acc"><MessagesSquare size={18} /> threads</div>
        <div className="font-mono text-[11px] text-dim truncate">{items.length} here{freshCount ? ` · ${freshCount} with new replies` : ""}</div>
      </div>
    </header>
    <div className="flex-1 overflow-y-auto overscroll-contain p-2.5 flex flex-col gap-2">
      {items.length === 0 && <p className="text-center text-dim font-mono text-xs mt-10 px-6">No threads yet. Tap any message to start one.</p>}
      {items.map(({ r, list, last, fresh }) => { const c = threadColor(r.id); return (
        <button key={r.id} type="button" onClick={() => onOpen(r.id)} style={{ borderLeft: `4px solid ${c}` }}
          className="block w-full text-left bg-panel border border-line rounded-[10px] px-3 py-2.5 cursor-pointer active:opacity-70">
          <div className="flex items-center gap-2 font-mono text-[13px] font-semibold">
            <span className="flex-1 min-w-0 truncate" style={{ color: c }}>{threadTitle(r)}</span>
            <span className="flex-none text-[11px] font-normal text-dim">{ago(last.at)}</span>
            {fresh && <i className="flex-none w-2 h-2 rounded-full bg-acc" />}
          </div>
          <div className={`mt-0.5 text-sm truncate ${fresh ? "text-ink font-semibold" : "text-dim"}`}>{name(last)}: {preview(last)}</div>
          <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-dim">
            <span className="inline-flex -space-x-1.5">{faces(list, ctx).map((f) => <img key={f.key} src={f.src} alt="" className="pixel w-[18px] h-[18px] rounded-full ring-2 ring-panel" />)}</span>
            {list.length} {list.length === 1 ? "reply" : "replies"}
          </div>
        </button>); })}
    </div>
  </div>;
}
