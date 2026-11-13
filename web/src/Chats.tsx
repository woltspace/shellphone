// Wolts as contacts, like a messaging app: home lists your wolts, a wolt has its chats, ＋ starts a new one, and a chat
// is a plain conversation. Underneath, a chat is a thread the room marked as standing on its own (state.sessions), so
// messages, voice, files and the hold menu work as everywhere else. "Everyone" is the room's shared chat, as before.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, Monitor, Plus, ChevronDown, Settings, SquareTerminal } from "lucide-react";
import { woltColor, type Ctx } from "./Message";
import type { Msg, State, Wolt } from "./room";
import { LORE, personAvatar } from "./sprites";
import { LookCanvas, normalizeLook } from "./CardLook";
import { SKY, Squad } from "./Scene";
import { SettingsPop } from "./Settings";

export type Chat = { id: string; title: string; wolts: string[]; at: number; last?: { text: string; who: string }; fresh: number };
// where you are: the list of wolts, one wolt's chats, a new chat being addressed, a chat, or the room's shared chat
export type Nav = { at: "home" } | { at: "wolt"; wolt: string } | { at: "new"; wolts: string[]; wolt?: string } | { at: "chat"; id: string; wolt?: string } | { at: "everyone" };

const preview = (m: Msg) => (m.text || (m.files?.length ? "📎 " + m.files.map((f) => f.name).join(", ") : m.audio ? "🎤 voice note" : m.page ? "📄 " + m.page.title : "")).replace(/\s+/g, " ");
const mine = (m: Msg, me: string) => m.kind === "human" && m.email === me;
// 21:52 today, Tue this week, 3 Nov before that
export function when(at?: number) {
  if (!at) return "";
  const d = new Date(at * 1000), days = (Date.now() - d.getTime()) / 86400_000;
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return days < 6 ? d.toLocaleDateString([], { weekday: "short" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// The room's chats with what this phone knows about each: its last line and how much of it you haven't read.
export function chatsOf(state: State, msgs: Msg[], replies: Map<string, Msg[]>, seen: Record<string, number>): Chat[] {
  const name = (m: Msg) => (m.kind === "human" ? (mine(m, state.me) ? "you" : state.members.people.find((p) => p.email === m.email)?.name || "someone") : m.wolt || "");
  return (state.sessions || []).map((s) => {
    const root = msgs.find((m) => m.id === s.id), all = [...(root ? [root] : []), ...(replies.get(s.id) || [])], last = all.at(-1);
    return {
      id: s.id, title: s.title || "New chat", wolts: s.wolts || [], at: last?.at || s.last_at || s.at,
      last: last ? { text: preview(last), who: name(last) } : s.last_text ? { text: s.last_text, who: s.last_by || "" } : undefined,
      fresh: all.filter((m) => m.n > (seen[s.id] || 0) && !mine(m, state.me)).length,
    };
  }).sort((a, b) => b.at - a.at);
}

// how a wolt is doing right now, in a word
function mood(w: Wolt, state: State): { awake: boolean; busy: boolean; word: string } {
  const busy = state.working_in ? (state.working_in[w.wolt] || []).length > 0 : !!state.working?.[w.wolt];
  if (w.paused) return { awake: false, busy: false, word: "paused" };
  if (state.unreachable?.[w.wolt]) return { awake: false, busy: false, word: "napping" };
  return { awake: true, busy, word: busy ? "gnawing…" : "" };
}
// A wolt's face, in the look its human gave it (CardLook.tsx), on a soft circle of its human's colour.
export function Face({ w, ctx, size = 46, bare, className = "" }: { w?: Wolt; ctx: Ctx; size?: number; bare?: boolean; className?: string }) {
  const look = normalizeLook(w ? ctx.looks?.[w.wolt] : undefined, w?.creature);
  if (bare) return <LookCanvas look={look} size={size} label={w?.wolt} className={className} />;
  return <span className={`flex-none grid place-items-center rounded-full ${className}`} style={{ width: size, height: size, background: woltColor(w?.wolt, ctx.wolts) + "30" }}>
    <LookCanvas look={look} size={Math.round(size * 0.8)} label={w?.wolt} /></span>;
}
const SEC = "px-4 pt-3.5 pb-1.5 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
const ROW = "flex w-full items-center gap-3 px-4 py-2.5 border-0 border-b border-[#ece4d6] text-left cursor-pointer active:opacity-70";
const Badge = ({ n }: { n: number }) => n > 0 ? <span className="inline-block min-w-5 h-5 px-1.5 rounded-full bg-acc text-white font-sans font-bold text-[11px] leading-5 text-center">{n}</span> : null;
export const PlusButton = ({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) =>
  <button type="button" aria-label={label} title={label} onClick={onClick}
    className={`flex-none ${small ? "w-9 h-9" : "w-10 h-10"} grid place-items-center rounded-full border-0 bg-acc text-white cursor-pointer shadow-[0_2px_8px_#c4531e66] active:scale-95 transition-transform`}>
    <Plus size={small ? 20 : 22} strokeWidth={2.6} /></button>;
// two or three faces, overlapping: a group
const Stack = ({ names, ctx, size = 32 }: { names: string[]; ctx: Ctx; size?: number }) =>
  <span className="flex flex-none">{names.slice(0, 3).map((n, i) => <span key={n} className={`rounded-full border-2 border-panel bg-panel ${i ? "-ml-3" : ""}`}><Face w={ctx.wolts.find((w) => w.wolt === n)} ctx={ctx} size={size} /></span>)}</span>;

function ChatRow({ c, ctx, here, group, onOpen }: { c: Chat; ctx: Ctx; here?: boolean; group?: boolean; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className={`${ROW} ${here ? "bg-[#f6e2d6]" : "bg-panel"}`}>
    {group && <Stack names={c.wolts} ctx={ctx} />}
    <span className="min-w-0 flex-1">
      <span className="block font-mono font-semibold text-[15px] truncate">{group && c.title === "New chat" ? c.wolts.join(", ") : c.title}</span>
      <span className={`block text-[13px] truncate ${c.fresh ? "text-ink font-semibold" : "text-dim"}`}>
        {c.last ? (group && c.last.who ? `${c.last.who}: ` : "") + c.last.text : "No messages yet"}</span>
    </span>
    <span className="flex-none text-right text-xs text-dim">{when(c.at)}{c.fresh > 0 && <><br /><Badge n={c.fresh} /></>}</span>
  </button>;
}

// The top of home: the wolts standing together at the campfire (Scene.tsx), under the phone's status strip, with the
// room's name over the sky and the ＋ floating at the top right.
function Hero({ state, ctx, onNew, onMenu, dot }: { state: State; ctx: Ctx; onNew: () => void; onMenu: () => void; dot?: boolean }) {
  const h = new Date().getHours(), hello = h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const moods = state.members.wolts.map((w) => ({ w, m: mood(w, state) })), awake = moods.filter((x) => x.m.awake).length;
  return <div className="relative flex-none overflow-hidden pt-[env(safe-area-inset-top)]" style={{ background: SKY }}>
    <Squad wolts={moods.slice(0, 6).map(({ w, m }) => ({ name: w.wolt, look: normalizeLook(ctx.looks?.[w.wolt], w.creature), busy: m.busy, away: !m.awake }))} />
    <div className="absolute inset-x-0 top-[env(safe-area-inset-top)] flex items-start gap-2 px-4 pt-3">
      <div className="min-w-0 flex-1 text-white">
        <h1 className="m-0 font-mono font-bold text-[22px] [text-shadow:0_2px_0_#0006]"><button type="button" onClick={onMenu} aria-label="Your rooms and settings" className="max-w-full flex items-center gap-1.5 border-0 bg-transparent p-0 text-inherit font-[inherit] cursor-pointer">
          <span className="truncate">{state.title && state.title !== "shell" ? state.title : "shellphone"}</span><ChevronDown size={18} strokeWidth={3} className="flex-none" /></button></h1>
        <p className="mt-0.5 mb-0 text-[13px] opacity-85 truncate">{hello}, {ctx.person(state.me).name} · {awake} {awake === 1 ? "wolt" : "wolts"} awake</p>
      </div>
      <button type="button" aria-label="Settings" title="Settings" onClick={onMenu} className="relative flex-none w-10 h-10 grid place-items-center rounded-full border-0 bg-[#ffffff22] text-white cursor-pointer">
        <Settings size={20} />{dot && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-acc" />}</button>
      <PlusButton label="New chat" onClick={onNew} />
    </div>
  </div>;
}

// Home: your wolts like contacts, then the groups, then everyone. On a computer it is the left column, without the scene.
export function HomeList({ state, ctx, chats, everyone, compact, sel, here, dot, onWolt, onChat, onEveryone, onNew, push, onDesk, onAgent }: {
  state: State; ctx: Ctx; chats: Chat[]; everyone: { at?: number; fresh: number }; compact?: boolean; sel?: string; here?: string; dot?: boolean;
  onWolt: (w: string) => void; onChat: (id: string) => void; onEveryone: () => void; onNew: () => void; push: { state: "ask" | "on" | "off"; turnOn: () => void }; onDesk?: () => void; onAgent?: () => void;
}) {
  const [gear, setGear] = useState(false), onMenu = () => setGear(true);
  const yours = state.members.wolts.filter((w) => w.owner === state.me), others = state.members.wolts.filter((w) => w.owner !== state.me);
  const groups = chats.filter((c) => c.wolts.length > 1);
  const row = (w: Wolt) => {
    const own = chats.filter((c) => c.wolts.length === 1 && c.wolts[0] === w.wolt), top = own[0], fresh = own.reduce((n, c) => n + c.fresh, 0), m = mood(w, state);
    // no chat with it yet: the last thing it said in the room
    const said = top ? undefined : [...ctx.all].reverse().find((x) => x.kind === "wolt" && x.wolt === w.wolt);
    return <button key={w.wolt} type="button" onClick={() => onWolt(w.wolt)} className={`${ROW} ${sel === w.wolt ? "bg-[#f6e2d6]" : "bg-panel"}`}>
      <span className="relative flex-none"><Face w={w} ctx={ctx} />
        <i className={`absolute right-px bottom-px w-3 h-3 rounded-full border-2 border-panel ${m.awake ? "bg-go" : "bg-[#c9bfae]"}`} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 font-mono font-semibold text-[15px]"><span className="truncate">{w.wolt}</span>
          {m.word && (m.awake ? <span className="flex-none font-normal text-[11px] text-go">{m.word}</span>
            : <span className="flex-none font-normal text-[11px] text-dim bg-[#efe8da] rounded-lg px-[7px] py-px">{m.word}</span>)}</span>
        <span className={`block text-[13px] truncate ${fresh ? "text-ink font-semibold" : "text-dim"}`}>{top?.last?.text || (said ? preview(said) : w.owner === state.me ? "Say hi" : `${ctx.person(w.owner).name}'s ${w.creature}`)}</span>
      </span>
      <span className="flex-none text-right text-xs text-dim">{when(top?.at || said?.at)}{fresh > 0 && <><br /><Badge n={fresh} /></>}</span>
    </button>;
  };
  return <div className="relative h-full flex flex-col bg-paper">
    {gear && <SettingsPop state={state} ctx={ctx} push={push} compact={compact} onClose={() => setGear(false)} />}
    {compact ? <header className="flex-none flex items-center gap-2 pl-2 pr-3 h-[60px] border-b border-line">
      <button type="button" aria-label="Settings" title="Settings" onClick={onMenu} className="relative flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer">
        <Settings size={20} />{dot && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-acc" />}</button>
      <h1 className="m-0 flex-1 min-w-0 truncate font-mono font-bold text-lg">{state.title && state.title !== "shell" ? state.title : "shellphone"}</h1>
      {onDesk && <button type="button" aria-label="Show the terminals" title="desk: your wolts' terminals" onClick={onDesk} className="flex-none w-9 h-9 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><Monitor size={19} /></button>}
      <PlusButton small label="New chat" onClick={onNew} /></header>
      : <Hero state={state} ctx={ctx} onNew={onNew} onMenu={onMenu} dot={dot} />}
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[calc(16px+env(safe-area-inset-bottom))]">
      {yours.length > 0 && <div className={SEC}>Your wolts</div>}
      {yours.map(row)}
      {onAgent && <button type="button" onClick={onAgent} className={`${ROW} bg-panel`}>
        <span className="flex-none w-[46px] h-[46px] rounded-full border-2 border-dashed border-acc grid place-items-center text-acc"><Plus size={20} /></span>
        <span className="min-w-0 flex-1 font-mono font-semibold text-[15px] text-acc">Add an agent</span>
      </button>}
      {others.length > 0 && <div className={SEC}>{yours.length ? "Other wolts here" : "Wolts"}</div>}
      {others.map(row)}
      <div className={SEC}>Groups</div>
      {groups.map((c) => <ChatRow key={c.id} c={c} ctx={ctx} group here={here === c.id} onOpen={() => onChat(c.id)} />)}
      <button type="button" onClick={onEveryone} className={`${ROW} ${here === "everyone" ? "bg-[#f6e2d6]" : "bg-panel"}`}>
        <span className="flex-none w-[46px] h-[46px] rounded-full bg-[#efe8da] grid place-items-center text-2xl">🐚</span>
        <span className="min-w-0 flex-1"><span className="block font-mono font-semibold text-[15px]">Everyone</span>
          <span className="block text-[13px] text-dim truncate">the whole room, wolts and people</span></span>
        <span className="flex-none text-right text-xs text-dim">{when(everyone.at)}{everyone.fresh > 0 && <><br /><Badge n={everyone.fresh} /></>}</span>
      </button>
    </div>
  </div>;
}

// One wolt: its chats, and the groups it is in. Its face and name open its contact card; ＋ starts a new chat with it.
export function WoltChats({ w, state, ctx, chats, compact, here, onBack, onChat, onNew, onCard }: {
  w: Wolt; state: State; ctx: Ctx; chats: Chat[]; compact?: boolean; here?: string; onBack: () => void; onChat: (id: string) => void; onNew: () => void; onCard?: (wolt: string) => void;
}) {
  const own = chats.filter((c) => c.wolts.length === 1 && c.wolts[0] === w.wolt), groups = chats.filter((c) => c.wolts.length > 1 && c.wolts.includes(w.wolt)), m = mood(w, state);
  return <div className="h-full flex flex-col bg-paper">
    <header className={`flex-none flex items-center gap-2 pl-1 pr-3 border-b border-line ${compact ? "h-[60px]" : "pt-[calc(8px+env(safe-area-inset-top))] pb-2"}`}>
      {!compact && <button type="button" aria-label="Back" onClick={onBack} className="flex-none w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={26} /></button>}
      <button type="button" onClick={() => onCard?.(w.wolt)} aria-label={`${w.wolt}'s contact card`} className={`min-w-0 flex-1 flex items-center gap-2.5 border-0 bg-transparent p-0 text-left cursor-pointer ${compact ? "pl-3" : ""}`}>
        {!compact && <Face w={w} ctx={ctx} size={40} />}
        <span className="min-w-0">
          <span className="flex items-center gap-1 font-mono font-bold text-[17px] text-ink"><span className="truncate">{compact ? `${w.wolt}'s chats` : w.wolt}</span>{!compact && <ChevronRight size={15} className="flex-none text-dim" />}</span>
          {!compact && m.word && <span className={`block font-mono text-[11px] ${m.awake ? "text-go" : "text-dim"}`}>{m.word}</span>}
        </span>
      </button>
      <PlusButton small={compact} label={`New chat with ${w.wolt}`} onClick={onNew} />
    </header>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[calc(16px+env(safe-area-inset-bottom))]">
      {!compact && <div className={SEC}>Chats</div>}
      {own.map((c) => <ChatRow key={c.id} c={c} ctx={ctx} here={here === c.id} onOpen={() => onChat(c.id)} />)}
      {own.length === 0 && <p className="text-center text-dim font-mono text-xs my-8 px-6">No chats with {w.wolt} yet. Tap ＋ to start one.</p>}
      {groups.length > 0 && <div className={SEC}>Groups with {w.wolt}</div>}
      {groups.map((c) => <ChatRow key={c.id} c={c} ctx={ctx} group here={here === c.id} onOpen={() => onChat(c.id)} />)}
    </div>
  </div>;
}

// A new chat, like iMessage: who it's to on top (faces, then "To:" with a pill each), type a name to add one more,
// and your first message starts it. One wolt makes a chat with it, several make a group.
export function NewChat({ state, ctx, start, onBack, onStart }: {
  state: State; ctx: Ctx; start: string[]; onBack: () => void; onStart: (wolts: string[], text: string) => Promise<string | null>;
}) {
  const [to, setTo] = useState(start), [find, setFind] = useState(""), [text, setText] = useState(""), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  const name = useRef<HTMLInputElement>(null), box = useRef<HTMLInputElement>(null);
  useEffect(() => { (start.length ? box : name).current?.focus(); }, []);
  const f = find.trim().toLowerCase();
  const wolts = state.members.wolts.filter((w) => !to.includes(w.wolt) && !w.paused && w.wolt.toLowerCase().includes(f));
  const people = f ? state.members.people.filter((p) => p.email !== state.me && p.name.toLowerCase().includes(f)) : [];
  const add = (w: string) => { setTo([...to, w]); setFind(""); name.current?.focus(); };
  const go = async () => {
    if (!to.length || !text.trim() || busy) return;
    setBusy(true); setProblem(""); const p = await onStart(to, text.trim()); setBusy(false); if (p) setProblem(p);
  };
  const list = to.length ? to.join(to.length === 2 ? " and " : ", ") : "";
  return <div className="h-full flex flex-col bg-paper">
    <header className="relative flex-none flex flex-col items-center border-b border-line pt-[calc(8px+env(safe-area-inset-top))] pb-2 min-h-[60px] justify-center">
      <button type="button" aria-label="Back" onClick={onBack} className="absolute left-1 top-[calc(10px+env(safe-area-inset-top))] w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={26} /></button>
      {to.length ? <><Stack names={to} ctx={ctx} size={38} /><span className="mt-0.5 font-mono font-semibold text-[13px]">{to.join(", ")}</span></>
        : <span className="font-mono font-semibold text-[15px]">New chat</span>}
    </header>
    <div className="flex-none flex flex-wrap items-center gap-1.5 px-4 py-2.5 bg-panel border-b border-line" onClick={() => name.current?.focus()}>
      <span className="text-dim text-[15px]">To:</span>
      {to.map((w) => <button key={w} type="button" aria-label={`Take ${w} out`} onClick={(e) => { e.stopPropagation(); setTo(to.filter((x) => x !== w)); }}
        className="border-0 bg-acc text-white rounded-[14px] px-2.5 py-1 font-mono font-semibold text-[13px] cursor-pointer">{w}</button>)}
      <input ref={name} value={find} onChange={(e) => setFind(e.target.value)} aria-label="Add a wolt" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onKeyDown={(e) => { if (e.key === "Enter" && wolts.length && f) { e.preventDefault(); add(wolts[0].wolt); } if (e.key === "Backspace" && !find && to.length) setTo(to.slice(0, -1)); }}
        className="flex-1 min-w-[80px] border-0 bg-transparent outline-none font-mono text-base py-1" />
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      {(f || !to.length) && wolts.map((w) => <button key={w.wolt} type="button" onClick={() => add(w.wolt)} className={`${ROW} bg-panel`}>
        <Face w={w} ctx={ctx} />
        <span className="min-w-0"><span className="block font-mono font-semibold text-[15px]">{w.wolt}</span>
          <span className="block text-[13px] text-dim truncate">{w.owner === state.me ? `your ${w.creature}` : `${ctx.person(w.owner).name}'s ${w.creature}`}</span></span>
      </button>)}
      {/* people are in "Everyone"; a chat is with wolts */}
      {people.map((p) => <div key={p.email} className={`${ROW} bg-[#faf7ef] opacity-60 cursor-default`}>
        <img src={personAvatar(p.name, p.color)} alt="" className="flex-none w-[46px] h-[46px] rounded-full" />
        <span className="min-w-0"><span className="block font-mono font-semibold text-[15px]">{p.name}</span><span className="block text-[13px] text-dim">a person in this room</span></span>
      </div>)}
      {f && !wolts.length && !people.length && <p className="text-center text-dim font-mono text-xs my-8 px-6">No wolt here by that name.</p>}
      {problem && <p className="text-center text-acc font-mono text-xs my-4 px-6">&gt; {problem}</p>}
    </div>
    <form data-composer onSubmit={(e) => { e.preventDefault(); go(); }} className="flex-none flex items-center gap-2 bg-[#efe8da] border-t border-line px-2.5 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))]">
      <input ref={box} value={text} onChange={(e) => setText(e.target.value)} placeholder={list ? `message ${list}…` : "pick a wolt first"} disabled={!to.length} enterKeyHint="send"
        className="flex-1 min-w-0 bg-panel border border-line rounded-[22px] px-3.5 py-2.5 font-mono text-base outline-none focus:shadow-[0_0_0_1px_var(--color-acc)] disabled:opacity-50" />
      <button type="submit" aria-label="Send" disabled={!to.length || !text.trim() || busy} className="flex-none w-11 h-11 grid place-items-center rounded-full border-0 bg-acc text-white cursor-pointer disabled:opacity-40"><ArrowUp size={20} /></button>
    </form>
  </div>;
}

// The top of a chat: back, who it's with (the face opens the contact card), its name, and its terminal at the top right.
export function ChatHeader({ chat, ctx, compact, onBack, onCard }: { chat: Chat; ctx: Ctx; compact?: boolean; onBack: () => void; onCard?: (wolt: string) => void }) {
  const names = chat.wolts, one = names.length === 1, title = !one && chat.title === "New chat" ? "" : chat.title;
  // the terminal of the first wolt here that you may open (the desk's tile on a computer, its lodge session on a phone)
  const term = names.find((n) => ctx.showTerminal || ctx.terminals?.[n]), link = term && !ctx.showTerminal ? ctx.terminals?.[term] : undefined;
  const termBtn = term && <a href={link} target="_blank" rel="noopener" aria-label={`${term}'s terminal`} title={`${term}'s terminal`}
    onClick={(e) => { if (!link) { e.preventDefault(); ctx.showTerminal?.(term); } }}
    className="flex-none w-10 h-8 grid place-items-center rounded-[9px] border-2 border-acc text-acc cursor-pointer"><SquareTerminal size={18} /></a>;
  if (compact) return <header className="flex-none flex items-center gap-2.5 px-4 h-[60px] border-b border-line bg-paper">
    <button type="button" onClick={() => onCard?.(names[0])} aria-label="Contact card" className="flex-none border-0 bg-transparent p-0 cursor-pointer"><Stack names={names} ctx={ctx} size={38} /></button>
    <div className="min-w-0 flex-1"><div className="font-mono font-bold text-[15px] truncate">{title || names.join(", ")}</div>
      <div className="text-xs text-dim truncate">with {names.join(", ")}</div></div>
    {termBtn}
  </header>;
  return <header className="relative flex-none flex flex-col items-center border-b border-line bg-paper pt-[calc(6px+env(safe-area-inset-top))] pb-1.5">
    <button type="button" aria-label="Back" onClick={onBack} className="absolute left-1 top-[calc(10px+env(safe-area-inset-top))] w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={26} /></button>
    <button type="button" onClick={() => onCard?.(names[0])} aria-label="Contact card" className="flex flex-col items-center border-0 bg-transparent p-0 cursor-pointer max-w-[60%]">
      <Stack names={names} ctx={ctx} size={40} />
      <span className="mt-0.5 flex items-center gap-0.5 max-w-full font-mono font-semibold text-[13px] text-ink"><span className="truncate">{names.join(", ")}</span><ChevronRight size={13} className="flex-none text-dim" /></span>
    </button>
    {title && <div className="max-w-[70%] text-xs text-dim truncate">{title}</div>}
    <div className="absolute right-3 top-[calc(12px+env(safe-area-inset-top))]">{termBtn}</div>
  </header>;
}

// On a computer, before you pick anything: the wolts, standing by.
export function Standby({ state }: { state: State }) {
  const w = state.members.wolts[0], lines = LORE[w?.creature] || LORE.raccoon;
  return <div className="h-full grid place-items-center bg-paper text-center px-8">
    <div>{w && <div className="grid place-items-center mb-3 opacity-80"><LookCanvas look={normalizeLook(state.looks?.[w.wolt], w.creature)} size={96} label={w.wolt} /></div>}
      <div className="font-mono font-semibold text-acc">Pick a wolt, or tap ＋ for a new chat</div>
      <p className="text-sm text-dim mt-1">{lines[new Date().getMinutes() % lines.length]}</p></div>
  </div>;
}
