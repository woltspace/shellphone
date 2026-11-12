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
  if (!words.length) return m.files?.length ? m.files[0].name : "Voice note";
  return words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
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

// A message's thread, as a bar along the bottom of its bubble: who replied, how many, a dot when there's something new.
// It's part of the message, so it reads as "tap to open".
export function ThreadFooter({ list, fresh, ctx, onOpen }: { list: Msg[]; fresh: boolean; ctx: Ctx; onOpen: () => void }) {
  const faces: Msg[] = [];
  for (const m of [...list].reverse()) if (faces.length < 3 && !faces.some((f) => (f.wolt || f.email) === (m.wolt || m.email))) faces.push(m);
  const face = (m: Msg) => { const p = ctx.person(m.kind === "human" ? m.email : m.owner);
    return m.kind === "human" ? personAvatar(p.name, p.color) : woltAvatar(m.creature || "raccoon", p.color); };
  return <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={`Open the thread, ${list.length} ${list.length === 1 ? "reply" : "replies"}`}
    className={`flex w-[calc(100%+20px)] -mx-2.5 -mb-1.5 mt-1.5 items-center gap-2 border-0 border-t border-line rounded-b-xl px-2.5 py-1.5 cursor-pointer text-left active:opacity-60 ${fresh ? "bg-[#c4531e14]" : "bg-[#18100a06]"}`}>
    <span className="flex flex-none">{faces.map((m, i) => <img key={m.id} src={face(m)} alt="" className={`pixel w-5 h-5 rounded-full border-2 border-panel bg-panel ${i ? "-ml-1.5" : ""}`} />)}</span>
    <b className={`text-[13.5px] ${fresh ? "text-acc" : "text-ink"}`}>{list.length} {list.length === 1 ? "reply" : "replies"}</b>
    {fresh && <i className="flex-none w-[7px] h-[7px] rounded-full bg-acc" aria-label="new replies" />}
    <span className="flex-1" />
    <span className="flex-none font-mono text-[11px] text-dim">{ago(list.at(-1)!.at)}</span>
    <ChevronRight className="flex-none text-dim" size={16} />
  </button>;
}

const preview = (m: Msg) => (m.text || (m.files?.length ? "📎 " + m.files.map((f) => f.name).join(", ") : m.audio ? "🎤 voice note" : "")).replace(/\s+/g, " ");

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

// One inbox for the room: new main-chat messages and threads with new replies on top, then earlier threads.
// It slides up over wherever you are; tap a row to go there, tap outside (or swipe it down) to stay.
export function InboxSheet({ top, main, roots, replies, ctx, seen, current, onMain, onOpen, onClose }: {
  top: number; main: Msg[]; roots: Msg[]; replies: Map<string, Msg[]>; ctx: Ctx; seen: Record<string, number>; current: string;
  onMain: () => void; onOpen: (id: string) => void; onClose: () => void;
}) {
  const items = roots.map((r) => { const list = replies.get(r.id)!; return { r, list, last: list.at(-1)!, fresh: unread(list, seen[r.id], ctx.me) }; })
    .sort((a, b) => b.last.at - a.last.at);
  const fresh = items.filter((i) => i.fresh), earlier = items.filter((i) => !i.fresh);
  const name = (m: Msg) => (m.kind === "human" ? ctx.person(m.email).name : m.wolt!);
  const count = (n: number) => <span className="flex-none min-w-[18px] h-[18px] px-1.5 rounded-full bg-acc text-white font-mono font-semibold text-[10.5px] leading-[18px] text-center">{n}</span>;
  const newCount = (list: Msg[], id: string) => list.filter((m) => m.n > (seen[id] || 0) && !(m.kind === "human" && m.email === ctx.me)).length;
  const sec = "px-4 pt-3.5 pb-1.5 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
  const row = (key: string, color: string, title: React.ReactNode, line: string, when: number, n: number, here: boolean, go: () => void) =>
    <button key={key} type="button" onClick={go} style={{ borderLeft: `4px solid ${color}` }}
      className={`block w-[calc(100%-20px)] mx-2.5 mb-2 text-left bg-panel border border-line rounded-[10px] px-3 py-2.5 cursor-pointer active:opacity-70 ${here ? "ring-2 ring-[#c4531e44]" : ""}`}>
      <div className="flex items-center gap-2 font-mono text-[13px] font-semibold">
        <span className="flex-1 min-w-0 truncate" style={{ color }}>{title}</span>
        {n > 0 && count(n)}
        <span className="flex-none text-[11px] font-normal text-dim">{ago(when)}</span>
      </div>
      <div className={`mt-0.5 text-sm truncate ${n ? "text-ink font-semibold" : "text-dim"}`}>{line}</div>
    </button>;
  const from = useState<{ y: number; dy: number } | null>(null), [drag, setDrag] = from;
  return <div className="absolute inset-x-0 bottom-0 z-[1600]" style={{ top: 0 }}>
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
    <div className="absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+96px)] bg-paper rounded-t-[18px] flex flex-col shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]"
      style={drag ? { transform: `translateY(${Math.max(0, drag.dy)}px)` } : undefined}>
      <div className="flex-none touch-none cursor-grab"
        onTouchStart={(e) => setDrag({ y: e.touches[0].clientY, dy: 0 })}
        onTouchMove={(e) => drag && setDrag({ ...drag, dy: e.touches[0].clientY - drag.y })}
        onTouchEnd={() => { if (drag && drag.dy > 80) onClose(); setDrag(null); }}>
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mt-2 mb-1.5" />
        <div className="flex items-baseline gap-2 px-4 pb-2.5 border-b border-line">
          <b className="font-mono font-semibold text-acc text-base">inbox</b>
          <span className="font-mono text-[11px] text-dim">{main.length + fresh.length ? `${main.length + fresh.length} unread` : "all caught up 👍"}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain pb-[calc(16px+env(safe-area-inset-bottom))]">
        {(main.length > 0 || fresh.length > 0) && <div className={sec}>New</div>}
        {main.length > 0 && row("main", "#c4531e", "# main chat", `${name(main.at(-1)!)}: ${preview(main.at(-1)!)}`, main.at(-1)!.at, main.length, false, onMain)}
        {fresh.map(({ r, list, last }) => row(r.id, threadColor(r.id), threadTitle(r), `${name(last)}: ${preview(last)}`, last.at, newCount(list, r.id), r.id === current, () => onOpen(r.id)))}
        {!main.length && !fresh.length && <p className="text-center text-dim font-mono text-xs my-5 px-6">Nothing new. You're all caught up.</p>}
        {current && row("main-back", "#c4531e", "# main chat", "back to the main chat", Date.now() / 1000, 0, false, onMain)}
        {earlier.length > 0 && <div className={sec}>Earlier threads</div>}
        {earlier.map(({ r, last }) => row(r.id, threadColor(r.id), threadTitle(r), `${name(last)}: ${preview(last)}`, last.at, 0, r.id === current, () => onOpen(r.id)))}
        {!items.length && <p className="text-center text-dim font-mono text-xs mt-2 px-6">No threads yet. Tap any message to start one.</p>}
      </div>
    </div>
  </div>;
}
