// Thread pieces, borrowed from Slack: the replies line under a message, the list of every thread, and what you've seen.
import { useCallback, useState } from "react";
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

export function ThreadLine({ list, ctx, fresh, onOpen }: { list: Msg[]; ctx: Ctx; fresh: boolean; onOpen: () => void }) {
  const last = list.at(-1)!;
  return <button type="button" onClick={onOpen}
    className={`mt-1 inline-flex items-center gap-1.5 font-mono text-xs bg-transparent border-0 p-0 cursor-pointer ${fresh ? "font-semibold text-acc" : "text-acc"}`}>
    <span className="inline-flex -space-x-1.5">{faces(list, ctx).map((f) => <img key={f.key} src={f.src} alt="" className="pixel w-[18px] h-[18px] rounded-full ring-2 ring-paper" />)}</span>
    <span className="font-semibold">{list.length} {list.length === 1 ? "reply" : "replies"}</span>
    <span className="text-dim font-normal">· {ago(last.at)}</span>
    {fresh && <i className="w-2 h-2 rounded-full bg-acc" aria-label="new replies" />}
    <span>›</span>
  </button>;
}

const preview = (m: Msg) => (m.text || (m.file ? "📎 " + m.file.name : m.audio ? "🎤 voice note" : "")).replace(/\s+/g, " ");

// Every thread in the room: ones with replies you haven't seen first, then the most recently active.
export function ThreadList({ roots, replies, ctx, seen, onOpen, onClose }: {
  roots: Msg[]; replies: Map<string, Msg[]>; ctx: Ctx; seen: Record<string, number>; onOpen: (id: string) => void; onClose: () => void;
}) {
  const items = roots.map((r) => { const list = replies.get(r.id)!; return { r, list, last: list.at(-1)!, fresh: unread(list, seen[r.id], ctx.me) }; })
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.last.at - a.last.at);
  const name = (m: Msg) => (m.kind === "human" ? ctx.person(m.email).name : m.wolt!);
  return <div className="absolute inset-0 z-[1500] bg-paper flex flex-col animate-[fadein_.18s_ease-out]">
    <header className="flex-none flex items-center gap-2 px-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-panel border-b border-line">
      <button type="button" aria-label="Back" onClick={onClose} className="w-10 h-10 border-0 bg-transparent text-acc text-[28px] leading-none cursor-pointer">‹</button>
      <div className="font-mono font-semibold text-acc">🧵 threads</div>
    </header>
    <div className="flex-1 overflow-y-auto overscroll-contain">
      {items.length === 0 && <p className="text-center text-dim font-mono text-xs mt-10 px-6">No threads yet. Tap any message to start one.</p>}
      {items.map(({ r, list, last, fresh }) => (
        <button key={r.id} type="button" onClick={() => onOpen(r.id)}
          className="block w-full text-left px-4 py-3 border-0 border-b border-line bg-transparent cursor-pointer active:bg-panel">
          <div className="flex items-center gap-2 font-mono text-[11px] text-dim">
            <span className="lowercase">[{name(r)}]</span><span className="flex-1" /><span>{ago(last.at)}</span>
            {fresh && <i className="w-2 h-2 rounded-full bg-acc" />}
          </div>
          <div className={`mt-0.5 text-[15px] leading-snug line-clamp-2 ${fresh ? "font-semibold" : ""}`}>{preview(r)}</div>
          <div className="mt-1 text-[13px] text-dim truncate"><span className="font-mono text-acc">{list.length} {list.length === 1 ? "reply" : "replies"}</span> · {name(last)}: {preview(last)}</div>
        </button>))}
    </div>
  </div>;
}
