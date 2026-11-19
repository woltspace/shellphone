// The chats on a computer screen: one column on the left, like Slack or Messages. Your wolts on top (gnawing as they do
// everywhere), then the chats sorted by what they need from you: the ones waiting on you, the ones a wolt is working in,
// then the rest. The phone keeps its own home; this only shows at 900px and wider.
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu as MenuIcon, Monitor, Search } from "lucide-react";
import { mix, woltColor, woltFace, type Ctx } from "./Message";
import type { Msg, State } from "./room";
import { personAvatar, verbs, woltAvatar } from "./sprites";
import { worn } from "./hats";
import { mood, type Who } from "./WoltStrip";
import { Busy, ThreadHat, ago, rootFresh, threadColor, threadTitle } from "./Threads";

type Filter = "needs" | "all" | "agents" | "unread";
type Item = { id: string; r: Msg; list: Msg[]; last: Msg; n: number; why: string; busy: boolean };

const preview = (m: Msg) => ((m.text && m.text.replace(/\*\*|`/g, "")) || (m.files?.length ? "📎 " + m.files.map((f) => f.name).join(", ") : m.audio ? "🎤 voice note" : "")).replace(/\s+/g, " ");
const short = (s: string) => s.replace(/ ago$/, "").replace("just now", "now");

export function Sidebar({ state, ctx, roots, replies, seen, current, title, menu, desk, onMenu, onDesk, onOpen, onNew, onPick, onAgent }: {
  state: State; ctx: Ctx; roots: Msg[]; replies: Map<string, Msg[]>; seen: Record<string, number>; current: string; title: string;
  menu: boolean; desk?: boolean; onMenu: () => void; onDesk?: () => void; onOpen: (id: string) => void; onNew: () => void; onPick: (who: Who) => void; onAgent: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all"), [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);
  // a busy wolt chews through its lines of lore, a new one every few seconds, as in the strip
  const [tick, setTick] = useState(0);
  const wolts = state.members.wolts;
  const anyBusy = wolts.some((w) => mood(w, state).busy);
  useEffect(() => { if (!anyBusy) return; const t = setInterval(() => setTick((x) => x + 1), 2400); return () => clearInterval(t); }, [anyBusy]);

  const me = state.me, myName = ctx.person(me).name.toLowerCase();
  const items: Item[] = useMemo(() => roots.map((r) => {
    const rs = replies.get(r.id) || [], list = [r, ...rs], last = list.at(-1)!;
    const fresh = rs.filter((m) => m.n > (seen[r.id] || 0) && !(m.kind === "human" && m.email === me));
    if (rootFresh(r, seen, me)) fresh.unshift(r);
    // waiting on you, guessed from what's there: someone tagged you, or someone answered in a chat you're part of
    const tagged = fresh.some((m) => new RegExp(`@${myName.replace(/[^\w-]/g, "")}\\b`, "i").test(m.text || ""));
    const why = tagged ? "mentions you" : "";
    return { id: r.id, r, list, last, n: fresh.length, why, busy: (ctx.busy?.(r.id) || []).length > 0 };
  }).sort((a, b) => b.last.at - a.last.at), [roots, replies, seen, me, myName, state.working, state.working_in]);

  const found = q.trim() ? items.filter((i) => threadTitle(i.r).toLowerCase().includes(q.trim().toLowerCase())) : items;
  const needs = found.filter((i) => i.why), working = found.filter((i) => !i.why && i.busy), rest = found.filter((i) => !i.why && !i.busy);
  const name = (m: Msg) => (m.kind === "human" ? (m.email === me ? "you" : ctx.person(m.email).name) : m.wolt!);
  const face = (m: Msg) => { const p = ctx.person(m.kind === "human" ? m.email : m.owner);
    return m.kind === "human" ? personAvatar(p.name, p.color, worn.people[m.email!]) : woltFace(m.wolt, m.creature); };

  const row = (i: Item) => {
    const here = i.id === current, busy = ctx.busy?.(i.id) || [], color = threadColor(i.id);
    return <button key={i.id} type="button" onClick={() => onOpen(i.id)} aria-current={here || undefined}
      className={`relative flex w-[calc(100%-12px)] mx-1.5 my-px items-center gap-2.5 px-2.5 py-[7px] rounded-[10px] border-0 text-left cursor-pointer ${here ? "shadow-[0_1px_3px_#18100a1a]" : "bg-transparent hover:bg-[#ffffff80]"}`} style={here ? { background: mix(color, "#ffffff", 0.9) } : undefined}>
      <i className={`absolute left-0 top-1.5 bottom-1.5 rounded-full ${here ? "w-[4px]" : "w-[3px] opacity-70"}`} style={{ background: color }} />
      <img src={face(i.last)} alt="" className="pixel flex-none w-9 h-9" />
      <span className="flex-1 min-w-0">
        <span className={`flex items-center gap-1 truncate text-[13.5px] ${i.n ? "font-bold" : "font-medium"}`} style={{ color }}><ThreadHat id={i.id} className="w-4 h-4 flex-none" /><span className="truncate">{threadTitle(i.r)}</span></span>
        {busy.length && !i.why ? <span className="flex mt-px"><Busy wolts={busy} ctx={ctx} /></span>
          : <span className={`block truncate text-[12.5px] ${i.n ? "text-[#4a4038]" : "text-dim"}`}>
            {i.why && <b className="text-acc font-semibold">{i.why === "mentions you" ? "mentions you: " : "replied: "}</b>}{name(i.last)}: {preview(i.last)}</span>}
      </span>
      <span className="flex-none flex flex-col items-end gap-1 font-mono text-[10.5px] text-dim">
        {short(ago(i.last.at))}
        {i.n > 0 && <span className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-white font-semibold text-[10.5px] leading-[18px] text-center ${i.why ? "bg-acc" : "bg-[#bdb3a4]"}`}>{i.why === "mentions you" ? "@" : i.n}</span>}
      </span>
    </button>;
  };
  const section = (label: string, list: Item[]) => list.length > 0 && <>
    <div className="px-3.5 pt-3 pb-1 font-mono text-[10.5px] font-semibold tracking-[.07em] uppercase text-dim">{label}</div>{list.map(row)}</>;
  const shown = filter === "needs" ? needs : filter === "agents" ? found.filter((i) => i.busy) : filter === "unread" ? found.filter((i) => i.n) : null;
  const chip = (f: Filter, label: string, n?: number) => <button type="button" onClick={() => setFilter(f)}
    className={`flex-none px-2.5 py-[3px] rounded-full border font-mono text-[11.5px] cursor-pointer ${filter === f ? "bg-ink text-white border-ink" : "bg-white text-dim border-line hover:text-ink"}`}>
    {label}{n ? <b className={`ml-1 ${filter === f ? "text-[#ffb38a]" : "text-acc"}`}>{n}</b> : null}</button>;

  return <aside aria-label="Chats" className="w-[300px] flex-none h-full flex flex-col bg-[#efe9de] border-r border-line">
    <div className="flex-none flex items-center gap-2 pl-1.5 pr-2 pt-2.5 pb-2">
      <button type="button" aria-label={menu ? "Close menu" : "Menu"} onClick={onMenu} className={`relative ${menu ? "z-[1720]" : ""} w-9 h-9 grid place-items-center border-0 bg-transparent text-acc cursor-pointer rounded-lg hover:bg-[#ffffff80]`}><MenuIcon size={20} /></button>
      <img src="/room-icon.png" alt="" className="w-8 h-8 rounded-full ring-1 ring-line bg-[#f5f1e8]" />
      <div className="flex-1 min-w-0 font-mono font-semibold text-acc truncate"><span className="text-dim">~/</span>{title}</div>
      {onDesk && <button type="button" aria-label={desk ? "Hide the terminals" : "Show the terminals"} title="desk: your wolts' terminals" onClick={onDesk}
        className={`w-9 h-9 grid place-items-center border-0 cursor-pointer rounded-lg ${desk ? "bg-acc text-white" : "bg-transparent text-acc hover:bg-[#ffffff80]"}`}><Monitor size={18} /></button>}
    </div>
    <label className="flex-none mx-3 mb-2.5 flex items-center gap-2 px-2.5 py-1.5 rounded-[9px] bg-white border border-line text-dim focus-within:border-acc">
      <Search size={14} />
      <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } if (e.key === "Enter" && found[0]) { onOpen(found[0].id); setQ(""); e.currentTarget.blur(); } }}
        placeholder="Jump to a chat…" className="flex-1 min-w-0 border-0 outline-none bg-transparent text-[13px] text-ink" />
    </label>
    {/* your wolts, faces with their hats: gnawing when they're on something, tap one for its card */}
    <div className="flex-none flex gap-0.5 px-2 pt-1.5 pb-2.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] border-b border-line">
      {[...wolts].sort((a, b) => Number(b.wolt === state.main) - Number(a.wolt === state.main)).map((w, i) => {
        const m = mood(w, state), color = woltColor(w.wolt, wolts), v = verbs(w.creature);
        return <button key={w.wolt} type="button" onClick={() => onPick("w:" + w.wolt)} aria-label={`${w.wolt}: ${m.word}`}
          className={`flex-none w-[56px] flex flex-col items-center p-0 border-0 bg-transparent cursor-pointer ${m.awake ? "" : "opacity-60"}`}>
          <span className={`relative block ${m.busy ? "" : m.awake ? "idle-bob" : ""}`} style={{ animationDelay: `${(i % 5) * -0.6}s` }}>
            <img src={woltAvatar(w.creature, color, worn.wolts[w.wolt], mix(color, "#ffffff", 0.78))} alt="" className={`pixel block w-11 h-11 ${m.busy ? "gnaw-img" : ""}`} />
            <i className={`absolute right-0.5 bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#efe9de] ${m.busy ? "bg-acc" : m.awake ? "bg-go" : "bg-[#c9bfae]"}`} />
          </span>
          <span className="max-w-full truncate font-mono text-[10.5px] font-semibold" style={{ color }}>{w.wolt}{state.main === w.wolt && <span className="text-acc">★</span>}</span>
          {m.busy ? <span key={tick} className="lore new max-w-full truncate font-mono font-semibold text-[9.5px]">{v[(tick + w.wolt.length) % v.length]}</span>
            : <span className="font-mono text-[9.5px] text-dim">{m.word}</span>}
        </button>;
      })}
      <button type="button" onClick={onAgent} aria-label="Add an agent" className="flex-none w-[56px] flex flex-col items-center p-0 border-0 bg-transparent cursor-pointer text-dim">
        <span className="w-11 h-11 rounded-full border-[1.5px] border-dashed border-line grid place-items-center text-lg">＋</span>
        <span className="font-mono text-[10.5px]">add</span>
      </button>
    </div>
    <div className="flex-none flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
      {chip("all", "All")}{chip("needs", "Needs you", needs.length)}{chip("agents", "Agents", found.filter((i) => i.busy).length)}{chip("unread", "Unread", found.filter((i) => i.n).length)}
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-2">
      {shown ? (shown.length ? shown.map(row) : <p className="text-center text-dim font-mono text-xs mt-6 px-6">{filter === "needs" ? "Nothing waiting on you 👍" : "Nothing here"}</p>)
        : <>{section("Needs you", needs)}{section("Working", working)}{section(needs.length || working.length ? "Recent" : "Chats", rest)}</>}
      {!found.length && <p className="text-center text-dim font-mono text-xs mt-6 px-6">{q ? "No chat by that name" : "No chats yet. Start one below."}</p>}
    </div>
    <button type="button" onClick={onNew} className="flex-none m-3 mt-1 flex items-center justify-center gap-2 py-2.5 rounded-[10px] border-0 bg-acc text-white font-mono font-bold text-[14px] cursor-pointer shadow-[0_2px_8px_#18100a30] active:scale-[.98]">
      ＋ New chat
    </button>
  </aside>;
}
