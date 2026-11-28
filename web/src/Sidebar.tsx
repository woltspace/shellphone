// The chats on a computer screen: one column on the left, like Slack or Messages. Your wolts on top (gnawing as they do
// everywhere), then the chats sorted by what they need from you: the ones waiting on you, the ones a wolt is working in,
// then the rest. The phone keeps its own home; this only shows at 900px and wider.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";  // home: a lodge phone's home (Home.tsx), in place of the room's lists
import { Menu as MenuIcon, Monitor, Plus, Search } from "lucide-react";
import { mix, woltColor, woltFace, type Ctx } from "./Message";
import type { Msg, State } from "./room";
import { personAvatar, verbs, woltAvatar } from "./sprites";
import { worn } from "./hats";
import { mood, type Who } from "./WoltStrip";
import { handle } from "./mentions.js";
import { Busy, ThreadHat, ago, rootFresh, threadColor, threadTitle } from "./Threads";

type Item = { id: string; r: Msg; list: Msg[]; last: Msg; n: number; why: string; busy: boolean };

const preview = (m: Msg) => ((m.text && m.text.replace(/\*\*|`/g, "")) || (m.files?.length ? "📎 " + m.files.map((f) => f.name).join(", ") : m.audio ? "🎤 voice note" : "")).replace(/\s+/g, " ");
const short = (s: string) => s.replace(/ ago$/, "").replace("just now", "now");

export function Sidebar({ full, home, onInvite, state, ctx, roots, replies, seen, current, title, menu, desk, onMenu, onDesk, onOpen, onNew, onPick, onAgent }: {
  full?: boolean; home?: ReactNode; onInvite: () => void; state: State; ctx: Ctx; roots: Msg[]; replies: Map<string, Msg[]>; seen: Record<string, number>; current: string; title: string;
  menu: boolean; desk?: boolean; onMenu: () => void; onDesk?: () => void; onOpen: (id: string) => void; onNew: () => void; onPick: (who: Who) => void; onAgent: () => void;
}) {
  const [q, setQ] = useState("");
  const [crowd, setCrowd] = useState<"humans" | "agents">(() => { try { return localStorage.getItem("crowd") === "agents" ? "agents" : "humans"; } catch { return "humans"; } });
  const pickCrowd = (c: "humans" | "agents") => { setCrowd(c); try { localStorage.setItem("crowd", c); } catch { /* fine */ } };
  const box = useRef<HTMLInputElement>(null);
  // a busy wolt chews through its lines of lore, a new one every few seconds, as in the strip
  const [tick, setTick] = useState(0);
  const wolts = state.members.wolts;
  const anyBusy = wolts.some((w) => mood(w, state).busy);
  useEffect(() => { if (!anyBusy) return; const t = setInterval(() => setTick((x) => x + 1), 2400); return () => clearInterval(t); }, [anyBusy]);

  const me = state.me, myTag = handle(ctx.person(me).name).toLowerCase();  // how an @ names you: the composer's rule (mentions.js)
  const items: Item[] = useMemo(() => roots.map((r) => {
    const rs = replies.get(r.id) || [], list = [r, ...rs], last = list.at(-1)!;
    const fresh = rs.filter((m) => m.n > (seen[r.id] || 0) && !(m.kind === "human" && m.email === me));
    if (rootFresh(r, seen, me)) fresh.unshift(r);
    // waiting on you, guessed from what's there: someone tagged you, or someone answered in a chat you're part of
    const tagged = !!myTag && fresh.some((m) => new RegExp(`(^|[^\\w-])@${myTag}(?![\\w-])`, "i").test(m.text || ""));
    const why = tagged ? "mentions you" : "";
    return { id: r.id, r, list, last, n: fresh.length, why, busy: (ctx.busy?.(r.id) || []).length > 0 };
  }).sort((a, b) => b.last.at - a.last.at), [roots, replies, seen, me, myTag, state.working, state.working_in]);

  const found = q.trim() ? items.filter((i) => threadTitle(i.r).toLowerCase().includes(q.trim().toLowerCase())) : items;
  const needs = found.filter((i) => i.why);
  const name = (m: Msg) => (m.kind === "human" ? (m.email === me ? "you" : ctx.person(m.email).name) : m.wolt!);
  const face = (m: Msg) => { const p = ctx.person(m.kind === "human" ? m.email : m.owner);
    return m.kind === "human" ? personAvatar(p.name, p.color, worn.people[m.email!]) : woltFace(m.wolt, m.creature); };

  // one quiet line per chat: its colour, its name, and only what matters: @ when someone tagged you, a gnawing face while a
  // wolt works in it, otherwise when it last moved. Unread is just bold.
  // who's in a chat, at a glance: the humans and agents who wrote there, and agents switched on in it, newest voice first
  const crew = (i: Item) => {
    const out: { key: string; src: string; name: string; busy?: boolean }[] = [], seenKey = new Set<string>();
    const working = new Set((ctx.busy?.(i.id) || []).map((w) => w.wolt));
    const add = (key: string, src: string, name: string) => { if (!seenKey.has(key)) { seenKey.add(key); out.push({ key, src, name, busy: key.startsWith("w:") && working.has(name) }); } };
    for (const m of [...i.list].reverse()) {
      if (m.kind === "human") { const p = ctx.person(m.email); add("p:" + m.email, personAvatar(p.name, p.color, worn.people[m.email!]), p.name); }
      else if (m.kind === "wolt") add("w:" + m.wolt, woltFace(m.wolt, m.creature), m.wolt!);
    }
    for (const [w, st] of Object.entries(state.who?.[i.id] || {})) if (st === "in") { const x = wolts.find((y) => y.wolt === w); if (x) add("w:" + w, woltFace(w, x.creature), w); }
    return out.sort((a, b) => Number(!!b.busy) - Number(!!a.busy));  // whoever is working here first, gnawing
  };
  const row = (i: Item) => {
    const here = i.id === current, busy = ctx.busy?.(i.id) || [], color = threadColor(i.id), who = crew(i);
    return <button key={i.id} type="button" onClick={() => onOpen(i.id)} aria-current={here || undefined} title={`${name(i.last)}: ${preview(i.last)}`}
      className={`flex w-[calc(100%-12px)] mx-1.5 items-start gap-2.5 py-3 px-2.5 my-0.5 rounded-xl border-0 text-left cursor-pointer ${here ? "" : "bg-transparent hover:bg-[#ffffff90]"}`}
      style={here ? { background: mix(color, "#ffffff", 0.82) } : undefined}>
      <i className="flex-none w-2.5 h-2.5 mt-[6px] rounded-full" style={{ background: color }} />
      <span className="flex-1 min-w-0">
        <span className={`block truncate text-[14px] leading-[22px] ${i.n ? "font-bold text-ink" : "text-[#5a5047]"}`}>{threadTitle(i.r)}</span>
        <span className={`block truncate mt-0.5 text-[13px] leading-[18px] ${i.n ? "text-[#4a4038]" : "text-dim"}`}>{name(i.last)}: {preview(i.last)}</span>
      </span>
      <span className="flex-none flex items-center pl-2 h-[24px]" title={who.map((f) => f.name).join(", ")}>
        {who.slice(0, 3).map((f) => <img key={f.key} src={f.src} alt="" className={`pixel w-[26px] h-[26px] -ml-2 rounded-full ${f.busy ? "gnaw-img" : ""}`} style={{ filter: "drop-shadow(0 0 1px #efe9de)" }} />)}
        {who.length > 3 && <span className="ml-0.5 font-mono text-[10px] text-dim">+{who.length - 3}</span>}</span>
      {i.why ? <span className="flex-none mt-0.5 w-[18px] h-[18px] rounded-full bg-acc text-white text-[11px] font-bold leading-[18px] text-center" title="someone tagged you">@</span>
        : <span className="flex-none font-mono text-[10.5px] leading-[22px] text-dim">{short(ago(i.last.at))}</span>}
    </button>;
  };
  const list = [...needs, ...found.filter((i) => !i.why)];
  return <aside aria-label="Chats" className={`${full ? "w-full min-w-0 flex-1" : "w-[300px] flex-none border-r border-line"} h-full relative flex flex-col bg-[#efe9de]`}>
      <button type="button" aria-label="New chat" title="New chat" onClick={onNew}
        className="absolute right-3 bottom-[calc(14px+env(safe-area-inset-bottom))] z-10 flex items-center gap-1 h-10 pl-3 pr-4 rounded-full border-0 bg-acc text-white font-semibold text-[14px] cursor-pointer shadow-[0_3px_10px_#18100a40] hover:brightness-110 active:scale-95 transition"><Plus size={18} strokeWidth={2.6} />Chat</button>
    <div className="flex-none flex items-center gap-2 pl-1.5 pr-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2">
      <button type="button" aria-label={menu ? "Close menu" : "Menu"} onClick={onMenu} className={`relative ${menu ? "z-[1720]" : ""} w-9 h-9 grid place-items-center border-0 bg-transparent text-acc cursor-pointer rounded-lg hover:bg-[#ffffff80]`}><MenuIcon size={20} /></button>
      <img src="/room-icon.png" alt="" className="w-8 h-8 rounded-full ring-1 ring-line bg-[#f5f1e8]" />
      <div className="flex-1 min-w-0 font-mono font-semibold text-acc truncate"><span className="text-dim">~/</span>{title}</div>
      {onDesk && <button type="button" aria-label={desk ? "Hide the terminals" : "Show the terminals"} title="desk: your wolts' terminals" onClick={onDesk}
        className={`w-9 h-9 grid place-items-center border-0 cursor-pointer rounded-lg ${desk ? "bg-acc text-white" : "bg-transparent text-acc hover:bg-[#ffffff80]"}`}><Monitor size={18} /></button>}
    </div>
    {home ? <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{home}</div> : <>
    <label className="flex-none mx-3 mb-2.5 flex items-center gap-2 px-2.5 py-1.5 rounded-[9px] bg-white border border-line text-dim focus-within:border-acc">
      <Search size={14} />
      <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); } if (e.key === "Enter" && found[0]) { onOpen(found[0].id); setQ(""); e.currentTarget.blur(); } }}
        placeholder="Jump to a chat…" className="flex-1 min-w-0 border-0 outline-none bg-transparent text-[13px] text-ink" />
    </label>
    {/* who's here, in a slider: Humans | Agents. The switch slides, and the row slides with it. Faces with their hats,
        agents gnawing when they're on something; tap one for its card */}
    <div className="flex-none pb-2 border-b border-line overflow-hidden">
      <div className="relative mx-3 mb-1.5 grid grid-cols-2 p-[3px] rounded-[10px] bg-[#e3dacb]">
        <i className="absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] rounded-[8px] bg-white shadow-[0_1px_3px_#18100a26] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ transform: crowd === "agents" ? "translateX(100%)" : "none" }} />
        {(["humans", "agents"] as const).map((c) => <button key={c} type="button" onClick={() => pickCrowd(c)} aria-pressed={crowd === c}
          className={`relative z-[1] py-1 border-0 bg-transparent font-mono text-[11.5px] font-semibold cursor-pointer transition-colors ${crowd === c ? "text-ink" : "text-dim"}`}>
          {c === "humans" ? `Humans · ${state.members.people.length}` : `Agents · ${wolts.length}`}</button>)}
      </div>
      <div className="flex w-[200%] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ transform: crowd === "agents" ? "translateX(-50%)" : "none" }}>
        <div className="w-1/2 flex gap-0.5 px-2 pt-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]" aria-hidden={crowd !== "humans"}>
      <button type="button" onClick={onInvite} aria-label="Invite humans" className="flex-none w-[56px] flex flex-col items-center p-0 border-0 bg-transparent cursor-pointer text-dim">
        <span className="w-11 h-11 rounded-full border-[1.5px] border-dashed border-line grid place-items-center text-lg">＋</span>
        <span className="font-mono text-[10.5px]">invite</span>
      </button>
      {state.members.people.map((h, i) => { const p = ctx.person(h.email);
        return <button key={h.email} type="button" onClick={() => onPick("p:" + h.email)} aria-label={p.name}
          className="flex-none w-[56px] flex flex-col items-center p-0 border-0 bg-transparent cursor-pointer">
          <span className="relative block idle-bob" style={{ animationDelay: `${(i % 5) * -0.6}s` }}>
            <img src={personAvatar(p.name, p.color, worn.people[h.email])} alt="" className="pixel block w-11 h-11" /></span>
          <span className="max-w-full truncate font-mono text-[10.5px] font-semibold" style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono text-[9.5px] text-dim">{h.email === state.me ? "you" : state.host === h.email ? "host" : (h as { guest?: boolean }).guest ? "guest" : "human"}</span>
        </button>; })}
        </div>
        <div className="w-1/2 flex gap-0.5 px-2 pt-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]" aria-hidden={crowd !== "agents"}>
      <button type="button" onClick={onAgent} aria-label="Add an agent" className="flex-none w-[56px] flex flex-col items-center p-0 border-0 bg-transparent cursor-pointer text-dim">
        <span className="w-11 h-11 rounded-full border-[1.5px] border-dashed border-line grid place-items-center text-lg">＋</span>
        <span className="font-mono text-[10.5px]">add</span>
      </button>
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
        </div>
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2 pb-[calc(64px+env(safe-area-inset-bottom))]">
      {list.map(row)}
      {!found.length && <p className="text-center text-dim font-mono text-xs mt-6 px-6">{q ? "No chat by that name" : "No chats yet. Start one with +."}</p>}
    </div></>}
  </aside>;
}
