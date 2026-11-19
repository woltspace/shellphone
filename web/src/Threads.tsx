// Thread pieces, borrowed from Slack: the replies line under a message, the list of every thread, and what you've seen.
// Each thread gets a short title and its own color, so with many of them you can still tell them apart at a glance.
import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight, MessagesSquare } from "lucide-react";
import { mix, woltColor, type Ctx, woltFace } from "./Message";
import type { Msg, Wolt } from "./room";
import { personAvatar, woltAvatar } from "./sprites";
import { HATS, hatSize, hatSrc, worn } from "./hats";

export function ago(at: number) {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const COLORS = ["#c4531e", "#2e7d9d", "#7a4fb5", "#2e9d57", "#b58a1f", "#c2417a"];
export const threadColor = (id: string) => COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
// and a bit of nature, so a thread is "the mushroom one" before you've read a word of it
const EMOJI = ["🌲", "🍄", "🌿", "🌾", "🌻", "🍁", "🌊", "🪨", "🌙", "⭐", "🔥", "🌵", "🐚", "🪶", "🌸", "🍂", "❄️", "🌈", "🌰", "🪵", "💧", "☀️", "⛰️", "🍀", "🌷", "🪺"];
export const threadEmoji = (id: string) => EMOJI[[...id].reduce((h, c) => (h * 131 + c.charCodeAt(0)) >>> 0, 11) % EMOJI.length];
// Behind a thread, like Instagram's emoji wallpaper: its one emoji scattered and tilted, faint, over a wash of its color.
// The sheet stays see-through.
// each thread wears one of the Hat Shop's pixel hats: the wallpaper is that hat, scattered and tilted
export const threadHat = (id: string) => HATS[[...id].reduce((h, c) => (h * 131 + c.charCodeAt(0)) >>> 0, 11) % HATS.length].id;
export function threadWallpaper(id: string, wash = true, strong = false) {  // no wash on a bubble: it keeps its own color; strong on home's rows
  const hat = threadHat(id), src = hatSrc(hat)!, { w, h } = hatSize(hat), color = threadColor(id);
  const k = 30 / Math.max(w, h), iw = Math.round(w * k), ih = Math.round(h * k);
  const spots: [number, number, number][] = [[24, 34, -18], [104, 22, 14], [64, 88, 8], [150, 78, -12], [22, 146, 20], [116, 150, -8]];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><g opacity="${strong ? ".42" : ".26"}" style="image-rendering:pixelated">${
    spots.map(([x, y, r]) => `<image href="${src}" x="${x - iw / 2}" y="${y - ih / 2}" width="${iw}" height="${ih}" transform="rotate(${r} ${x} ${y})"/>`).join("")}</g></svg>`;
  const tile = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return wash ? { backgroundImage: `${tile}, linear-gradient(${color}${strong ? "24" : "12"}, ${color}${strong ? "24" : "12"})`, backgroundSize: "180px 180px, auto" } : { backgroundImage: tile, backgroundSize: "180px 180px" };
}
// the thread's hat, small, as its badge in the header
export function ThreadHat({ id, className = "" }: { id: string; className?: string }) {
  return <img src={hatSrc(threadHat(id))} alt="" className={`pixel inline-block align-[-3px] object-contain ${className}`} />;
}
// chats renamed after they started, from the room's state (App fills it on every update, like the hats)
export const named: Record<string, string> = {};
export function nameChats(names: Record<string, string> = {}) { for (const k in named) delete named[k]; Object.assign(named, names); }
// the first few words of the message it hangs off, without the @tags in front
export function threadTitle(m?: Msg) {
  if (!m) return "thread";
  if (named[m.id]) return named[m.id];  // renamed since
  if (m.title) return m.title;  // named when it was started
  const words = (m.text || "").replace(/\s+/g, " ").replace(/^(@[\w-]+[\s,:]*)+/, "").trim().split(" ").filter(Boolean);
  if (!words.length) return m.files?.length ? m.files[0].name : "Voice note";
  return words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
}

// who replied, latest first, one face each
function faces(list: Msg[], ctx: Ctx, most = 3) {
  const out: { key: string; src: string }[] = [];
  for (const m of [...list].reverse()) {
    const key = m.kind === "human" ? m.email! : "wolt:" + m.wolt;
    if (out.some((f) => f.key === key)) continue;
    const who = ctx.person(m.kind === "human" ? m.email : m.owner);
    out.push({ key, src: m.kind === "human" ? personAvatar(who.name, who.color, worn.people[m.email!]) : woltFace(m.wolt, m.creature) });
  }
  return out.slice(0, most);
}

// Home is the list of chats: there is no main chat to talk in (every message said there is a chat of its own).
export const useChatsHome = () => true;

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
// A chat's first message is new too, until you open the chat (or, from before chats, read it in the main chat).
export const rootFresh = (r: Msg, seen: Record<string, number>, me: string) => r.n > Math.max(seen[r.id] || 0, seen.main || 0) && !(r.kind === "human" && r.email === me);

// A message's thread, as a bar along the bottom of its bubble: who replied, how many, a dot when there's something new.
// It's part of the message, so it reads as "tap to open".
// a wolt working in a thread: its face chews right on the thread's row, so you see it from outside without opening it
export function Busy({ wolts, ctx }: { wolts?: Wolt[]; ctx: Ctx }) {
  if (!wolts?.length) return null;
  return <span className="flex flex-none items-center gap-1 font-mono text-[11px] text-acc" aria-label={`${wolts.map((w) => w.wolt).join(", ")} working here`}>
    {wolts.slice(0, 3).map((w) => <img key={w.wolt} src={woltFace(w.wolt, w.creature)} alt="" className="gnaw-img pixel w-5 h-5" />)}
    working…</span>;
}

export function ThreadFooter({ id, list, fresh, ctx, onOpen, busy }: { id: string; list: Msg[]; fresh: boolean; ctx: Ctx; onOpen: () => void; busy?: Wolt[] }) {
  const faces: Msg[] = [];
  for (const m of [...list].reverse()) if (faces.length < 3 && !faces.some((f) => (f.wolt || f.email) === (m.wolt || m.email))) faces.push(m);
  const face = (m: Msg) => { const p = ctx.person(m.kind === "human" ? m.email : m.owner);
    return m.kind === "human" ? personAvatar(p.name, p.color, worn.people[m.email!]) : woltFace(m.wolt, m.creature); };
  return <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={`Open the thread, ${list.length} ${list.length === 1 ? "reply" : "replies"}`}
    className={`flex w-[calc(100%+20px)] -mx-2.5 -mb-1.5 mt-1.5 items-center gap-2 border-0 border-t border-line rounded-b-xl px-2.5 py-1.5 cursor-pointer text-left active:opacity-60 ${fresh ? "bg-[#c4531e14]" : "bg-[#18100a06]"}`}>
    <span className="flex flex-none">{faces.map((m, i) => <img key={m.id} src={face(m)} alt="" className={`pixel w-5 h-5 rounded-full border-2 border-panel bg-panel ${i ? "-ml-1.5" : ""}`} />)}</span>
    <b className="text-[13.5px]" style={{ color: threadColor(id) }}>{list.length} {list.length === 1 ? "reply" : "replies"}</b>
    {fresh && <i className="flex-none w-[7px] h-[7px] rounded-full bg-acc" aria-label="new replies" />}
    <span className="flex-1" />
    {busy?.length ? <Busy wolts={busy} ctx={ctx} /> : <span className="flex-none font-mono text-[11px] text-dim">{ago(list.at(-1)!.at)}</span>}
    <ChevronRight className="flex-none text-dim" size={16} />
  </button>;
}

const preview = (m: Msg) => ((m.text && m.text.replace(/\*\*|`/g, "")) || (m.files?.length ? "📎 " + m.files.map((f) => f.name).join(", ") : m.audio ? "🎤 voice note" : "")).replace(/\s+/g, " ");

// Every thread in the room: ones with replies you haven't seen first, then the most recently active.
export function ThreadList({ roots, replies, ctx, seen, onOpen, onClose }: {
  roots: Msg[]; replies: Map<string, Msg[]>; ctx: Ctx; seen: Record<string, number>; onOpen: (id: string) => void; onClose: () => void;
}) {
  const items = roots.map((r) => { const list = replies.get(r.id) || []; return { r, list, last: list.at(-1) || r, fresh: unread(list, seen[r.id], ctx.me) }; })
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

// One inbox for the room: every thread, one row each, the one that moved last on top. A row is the thread's title, its
// latest message, and who's in it. What you haven't seen shows as a count; it never reorders the list.
// It slides up over wherever you are; tap a row to go there, tap outside (or swipe it down) to stay.
// The rows of every chat (thread), the one that moved last on top, and the main chat as one more row ("lobby" when home is
// the chats). Used by the inbox sheet and by home in the chats layout.
type RowsProps = { main: Msg[]; all: Msg[]; roots: Msg[]; replies: Map<string, Msg[]>; ctx: Ctx; seen: Record<string, number>; current: string;
  onMain: () => void; onOpen: (id: string) => void; lobby?: boolean };
export function chatRows({ main, all, roots, replies, ctx, seen, current, onMain, onOpen, lobby }: RowsProps) {
  const newCount = (list: Msg[], id: string) => list.filter((m) => m.n > (seen[id] || 0) && !(m.kind === "human" && m.email === ctx.me)).length;
  const items = roots.map((r) => { const rs = replies.get(r.id) || [], list = [r, ...rs]; return { id: r.id, r, list, last: list.at(-1)!, n: newCount(rs, r.id) + (rootFresh(r, seen, ctx.me) ? 1 : 0) }; });
  if (all.length) items.push({ id: "", r: all[0], list: all, last: all.at(-1)!, n: main.length });
  items.sort((a, b) => b.last.at - a.last.at);
  const unreadRows = items.filter((i) => i.n).length;
  const name = (m: Msg) => (m.kind === "human" ? ctx.person(m.email).name : m.wolt!);
  // the latest message's bubble is in the colour of whoever said it, as in the chat
  const voice = (m: Msg) => m.kind === "human" ? ctx.person(m.email).color : woltColor(m.wolt, ctx.wolts);
  const ink = (m: Msg) => m.kind === "human" ? mix(ctx.person(m.email).color, "#ffffff", 0.82) : mix(woltColor(m.wolt, ctx.wolts), "#ffffff", 0.9);
  const count = (n: number) => <span className="flex-none min-w-[18px] h-[18px] px-1.5 rounded-full bg-acc text-white font-mono font-semibold text-[10.5px] leading-[18px] text-center">{n}</span>;
  const busyAt = (key: string) => ctx.busy?.(key) || [];
  const row = ({ id, r, list, last, n }: typeof items[number]) => {
    const color = id ? threadColor(id) : "#c4531e", who = faces(list, ctx, 6), here = id === current;
    const names = [...new Set([...list].reverse().map(name))];
    return <button key={id || "main"} type="button" onClick={() => (id ? onOpen(id) : onMain())} style={id ? threadWallpaper(id, true, true) : undefined}
      className={`flex w-full text-left bg-transparent border-0 border-b-2 border-line px-3 py-4 cursor-pointer active:opacity-70 ${here ? "bg-[#c4531e0d]" : ""}`}>
      {/* the wallpaper shows around it; what you read sits on solid ground: the title in its own band, then the latest message
          in the colour of whoever said it */}
      <span className="flex-1 min-w-0 rounded-2xl border-2 overflow-hidden shadow-[0_2px_8px_#18100a24]" style={{ borderColor: here ? color : color + "99", boxShadow: here ? `0 0 0 3px ${color}66, 0 2px 8px #18100a24` : undefined }}>
        <span className="flex items-center gap-2 px-3.5 py-2 border-b-2 font-mono text-[14px] font-bold" style={{ borderColor: color + "55", background: mix(color, "#ffffff", 0.9) }}>
          <span className="flex-1 min-w-0 truncate" style={{ color }}>{id ? threadTitle(r) : lobby ? "# lobby" : "# main chat"}</span>
          {n > 0 && count(n)}
          {busyAt(id).length ? <Busy wolts={busyAt(id)} ctx={ctx} /> : <span className="flex-none text-[11px] font-normal text-dim">{ago(last.at)}</span>}
        </span>
        <span className="block px-3.5 pt-2.5 pb-2.5 bg-[#fffdf8]">
          {/* who spoke last, up front: their face and name in their colour, then what they said in a bubble of that colour */}
          <span className={`flex items-start gap-2.5 text-[15px] leading-snug ${n ? "text-ink" : "text-[#4a4038]"}`}>
            <img src={faces([last], ctx)[0].src} alt="" className="pixel flex-none w-12 h-12 -mt-1" />{/* the face draws its own circle, with the hat over it */}
            <span className="flex-1 min-w-0">
              <b className="block font-mono text-[13px] font-bold mb-1" style={{ color: voice(last) }}>{name(last)}</b>
              <span className="block rounded-xl rounded-tl-sm border px-2.5 py-1.5" style={{ background: ink(last), borderColor: mix(voice(last), "#ffffff", 0.6) }}><span className="line-clamp-2">{preview(last)}</span></span>
            </span></span>
        </span>
        <span className="flex items-center gap-2 px-3.5 py-1.5 border-t-2 bg-white font-mono text-[11px] text-dim" style={{ borderColor: color + "44" }}>
            <span className="flex-none inline-flex -space-x-1.5">{who.slice(0, 5).map((f) => <img key={f.key} src={f.src} alt="" className="pixel w-6 h-6" />)}</span>
            <span className="flex-1 min-w-0 truncate">{names.slice(0, 4).join(", ")}{names.length > 4 ? ` +${names.length - 4}` : ""}</span>
            <span className="flex-none">{list.length} msgs</span>
        </span>
      </span>
    </button>;
  };
  return { count: items.length, unreadRows, rows: items.map(row) };
}

// The inbox: those rows in a sheet that slides up over wherever you are; tap a row to go there, tap outside (or swipe it down) to stay.
export function InboxSheet({ onClose, ...p }: RowsProps & { top: number; onClose: () => void }) {
  const { count: n, unreadRows, rows } = chatRows(p);
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
          <span className="font-mono text-[11px] text-dim">{n} {n === 1 ? "thread" : "threads"} · {unreadRows ? `${unreadRows} with new` : "all caught up 👍"}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain pb-[calc(16px+env(safe-area-inset-bottom))]">
        {rows}
        {!p.roots.length && <p className="text-center text-dim font-mono text-xs mt-4 px-6">No threads yet. Tap any message to start one.</p>}
      </div>
    </div>
  </div>;
}
