// Wolts as contacts, like a messaging app: home lists your wolts, a wolt has its chats, ＋ starts a new one, and a chat
// is a plain conversation. Underneath, a chat is a thread the room marked as standing on its own (state.sessions), so
// messages, voice, files and the hold menu work as everywhere else. "Everyone" is the room's shared chat, as before.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, Monitor, Plus, Bell, Moon, Pencil, SquareTerminal, Sun } from "lucide-react";
import { woltColor, type Ctx } from "./Message";
import type { Msg, State, Wolt } from "./room";
import { LORE, personAvatar } from "./sprites";
import { LookCanvas, normalizeLook } from "./CardLook";
import { hatUrl, SKIES, Squad, useSky } from "./Scene";
import { choices } from "./CardLook";

export type Chat = { id: string; title: string; wolts: string[]; by?: string; at: number; last?: { text: string; who: string }; fresh: number };
// where you are: the list of wolts, one wolt's chats, a new chat being addressed, a chat, or the room's shared chat
export type Nav = { at: "home" } | { at: "wolt"; wolt: string } | { at: "new"; wolts: string[]; wolt?: string } | { at: "chat"; id: string; wolt?: string } | { at: "everyone" } | { at: "bell" } | { at: "all"; what: "wolts" | "people" | "groups" };

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
      // a group nobody named goes by its members, like iMessage ("New chat" is how the screens say "no name")
      id: s.id, title: (s.named === false && (s.wolts || []).length > 1 ? "" : s.title) || "New chat", wolts: s.wolts || [], by: s.by, at: last?.at || s.last_at || s.at,
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
const SEC = "px-4 pt-2.5 pb-1 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
const ROW = "flex w-full items-center gap-3 px-4 py-2 border-0 border-b border-[#ece4d6] text-left cursor-pointer active:opacity-70";
const HEAD = "flex items-center px-4 pt-2.5 pb-1 font-mono font-bold text-[15px] text-ink";
const AddButton = ({ label, onClick }: { label: string; onClick: () => void }) =>
  <button type="button" onClick={onClick} className="flex-none flex items-center gap-1 -my-1 py-1 border-0 bg-transparent font-sans font-semibold text-[15px] tracking-normal normal-case text-acc cursor-pointer active:opacity-60">
    <Plus size={15} strokeWidth={3} />{label}</button>;
const Badge = ({ n }: { n: number }) => n > 0 ? <span className="inline-block min-w-5 h-5 px-1.5 rounded-full bg-acc text-white font-sans font-bold text-[11px] leading-5 text-center">{n}</span> : null;
export const PlusButton = ({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) =>
  <button type="button" aria-label={label} title={label} onClick={onClick}
    className={`flex-none ${small ? "w-9 h-9" : "w-10 h-10"} grid place-items-center rounded-full border-0 bg-acc text-white cursor-pointer shadow-[0_2px_8px_#c4531e66] active:scale-95 transition-transform`}>
    <Plus size={small ? 20 : 22} strokeWidth={2.6} /></button>;
// two or three faces, overlapping: a group
const Stack = ({ names, ctx, size = 32 }: { names: string[]; ctx: Ctx; size?: number }) =>
  <span className="flex flex-none">{names.slice(0, 3).map((n, i) => <span key={n} className={`rounded-full border-2 border-panel bg-panel ${i ? "-ml-3" : ""}`}><Face w={ctx.wolts.find((w) => w.wolt === n)} ctx={ctx} size={size} /></span>)}</span>;

function ChatRow({ c, ctx, here, group, onOpen, onRename }: { c: Chat; ctx: Ctx; here?: boolean; group?: boolean; onOpen: () => void; onRename?: (title: string) => Promise<string | null> }) {
  // the pencil at the right renames the chat right in its row
  const [naming, setNaming] = useState<string | null>(null), [problem, setProblem] = useState("");
  const save = async () => {
    const t = (naming || "").trim(); if (!t || t === c.title || !onRename) return setNaming(null);
    const e = await onRename(t); if (e) setProblem(e); else { setNaming(null); setProblem(""); }
  };
  return <div role="button" tabIndex={0} onClick={() => { if (naming === null) onOpen(); }} onKeyDown={(e) => { if (e.key === "Enter" && naming === null) onOpen(); }} className={`${ROW} ${here ? "bg-[#f6e2d6]" : "bg-panel"}`}>
    {group && <Stack names={c.wolts} ctx={ctx} />}
    <span className="min-w-0 flex-1">
      {naming !== null ? <form onSubmit={(e) => { e.preventDefault(); save(); }} onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} onBlur={save} aria-label="Name of this chat" enterKeyHint="done" placeholder="Name this chat"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { setNaming(null); setProblem(""); } }}
          className="block w-full bg-paper border border-acc rounded-lg px-1.5 py-0.5 font-mono font-semibold text-base outline-none" />
        {problem && <small className="block text-[11px] text-acc">{problem}</small>}</form>
      : <span className="block font-mono font-semibold text-[15px] truncate">{group && c.title === "New chat" ? c.wolts.join(", ") : c.title}</span>}
      <span className={`block text-[13px] truncate ${c.fresh ? "text-ink font-semibold" : "text-dim"}`}>
        {c.last ? (group && c.last.who ? `${c.last.who}: ` : "") + c.last.text : "No messages yet"}</span>
    </span>
    <span className="flex-none text-right text-xs text-dim">{when(c.at)}{c.fresh > 0 && <><br /><Badge n={c.fresh} /></>}</span>
    {onRename && <button type="button" aria-label="Rename this chat" title="Rename" onClick={(e) => { e.stopPropagation(); setNaming(naming === null ? (c.title === "New chat" ? "" : c.title) : null); }}
      className="flex-none -mr-1.5 w-7 h-7 grid place-items-center rounded-full border-0 bg-[#f6e2d6] text-acc cursor-pointer"><Pencil size={13} /></button>}
  </div>;
}

// A person: the same soft circle the wolts stand on, their letter in their colour, and the Hat Shop hat they picked.
const hatOf = (face?: string) => (face?.startsWith("hat-") && hatUrl(face.slice(4)) ? face.slice(4) : "");
export function PersonFace({ p, hat, size = 38 }: { p: { name: string; color: string }; hat?: string; size?: number }) {
  return <span className="relative block mx-auto" style={{ width: size, height: size, marginTop: Math.round(size * 0.34) }}>
    <span className="grid place-items-center w-full h-full rounded-full font-mono font-bold" style={{ background: p.color + "30", color: p.color, fontSize: Math.round(size * 0.45), paddingTop: hat ? Math.round(size * 0.16) : 0 }}>{(p.name || "?").trim()[0]?.toUpperCase()}</span>
    {hat && <img src={hatUrl(hat)} alt="" className="pixel absolute left-1/2 pointer-events-none" style={{ width: Math.round(size * 0.64), bottom: Math.round(size * 0.62), transform: "translateX(-50%) rotate(-8deg)" }} />}
  </span>;
}
// Pick the hat you wear in this room: everyone sees it on your circle.
function HatPicker({ now, onPick, onClose }: { now: string; onPick: (hat: string) => Promise<string | null>; onClose: () => void }) {
  const [problem, setProblem] = useState("");
  const pick = async (h: string) => setProblem((await onPick(h)) || "");
  return <div className="absolute inset-0 z-[1550]">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
    <div role="dialog" aria-label="Pick your hat" className="absolute inset-x-0 bottom-0 max-h-[70%] flex flex-col bg-paper rounded-t-[18px] shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]">
      <div className="flex-none flex items-center px-4 pt-3 pb-2"><b className="flex-1 font-mono text-[15px]">Your hat</b>
        <button type="button" onClick={onClose} className="border-0 bg-transparent font-mono font-semibold text-[13px] text-acc cursor-pointer">Done</button></div>
      <div className="flex-1 overflow-y-auto grid grid-cols-5 gap-2 px-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
        {choices.hat.map((h) => <button key={h || "none"} type="button" onClick={() => pick(h)} aria-label={h ? h.replaceAll("-", " ") : "No hat"} aria-pressed={now === h}
          className={`aspect-square grid place-items-center rounded-[12px] border cursor-pointer ${now === h ? "border-acc bg-[#f6e2d6]" : "border-line bg-panel"}`}>
          {h ? <img src={hatUrl(h)} alt="" className="pixel w-[60%]" /> : <span className="font-mono text-[11px] text-dim">none</span>}</button>)}
      </div>
      {problem && <p className="flex-none m-0 px-4 pb-3 font-mono text-xs text-acc">&gt; {problem}</p>}
    </div>
  </div>;
}

// A group on home: a small card. Whoever may rename it gets a pencil in its top right corner, and types the name right there.
function GroupCard({ c, ctx, here, onOpen, onRename }: { c: Chat; ctx: Ctx; here?: boolean; onOpen: () => void; onRename?: (title: string) => Promise<string | null> }) {
  const [naming, setNaming] = useState<string | null>(null), [problem, setProblem] = useState("");
  const save = async () => {
    const t = (naming || "").trim(); if (!t || t === c.title || !onRename) return setNaming(null);
    const e = await onRename(t); if (e) setProblem(e); else { setNaming(null); setProblem(""); }
  };
  return <div role="button" tabIndex={0} onClick={() => { if (naming === null) onOpen(); }} onKeyDown={(e) => { if (e.key === "Enter" && naming === null) onOpen(); }}
    className={`relative min-w-0 text-left rounded-[14px] border border-line px-3 py-1.5 cursor-pointer active:opacity-70 ${here ? "bg-[#f6e2d6]" : "bg-transparent"}`}>
    <span className="flex items-center gap-1.5"><Stack names={c.wolts} ctx={ctx} size={24} /><span className="flex-1" />{c.fresh > 0 && <Badge n={c.fresh} />}
      {onRename && <button type="button" aria-label="Rename this group" title="Rename" onClick={(e) => { e.stopPropagation(); setNaming(naming === null ? (c.title === "New chat" ? "" : c.title) : null); }}
        className="flex-none -mr-1 w-7 h-7 grid place-items-center rounded-full border-0 bg-[#f6e2d6] text-acc cursor-pointer"><Pencil size={13} /></button>}</span>
    {naming !== null ? <form onSubmit={(e) => { e.preventDefault(); save(); }} onClick={(e) => e.stopPropagation()}>
      <input autoFocus value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} onBlur={save} aria-label="Name of this group" enterKeyHint="done" placeholder="Name this group"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { setNaming(null); setProblem(""); } }}
        className="block w-full bg-panel border border-acc rounded-lg px-1.5 py-0.5 font-mono font-semibold text-base outline-none" />
      {problem && <small className="block text-[11px] text-acc">{problem}</small>}</form>
    : <span className="block font-mono font-semibold text-[13.5px] truncate">{c.title === "New chat" ? c.wolts.join(", ") : c.title}</span>}
    <span className={`block text-xs truncate ${c.fresh ? "text-ink font-semibold" : "text-dim"}`}>{c.last ? c.last.text : c.wolts.join(", ")}</span>
  </div>;
}

// The top of home: the wolts standing together at the campfire (Scene.tsx), under the phone's status strip, with the
// room's name over the sky and the ＋ floating at the top right.
const BellButton = ({ n, onClick, dark }: { n: number; onClick: () => void; dark?: boolean }) =>
  <button type="button" aria-label={n ? `Notifications, ${n} new` : "Notifications"} title="Notifications" onClick={onClick}
    className={`relative flex-none w-10 h-10 grid place-items-center rounded-full border-0 cursor-pointer ${dark ? "bg-[#ffffff22] text-white" : "bg-transparent text-acc"}`}>
    <Bell size={20} />{n > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-acc text-white font-sans font-bold text-[10.5px] leading-[18px] text-center ring-2 ring-[#2a1f38]">{n > 99 ? "99+" : n}</span>}</button>;
function Hero({ state, ctx, onNew, onBell, bell }: { state: State; ctx: Ctx; onNew: () => void; onBell: () => void; bell: number }) {
  const h = new Date().getHours(), hello = h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const moods = state.members.wolts.map((w) => ({ w, m: mood(w, state) })), awake = moods.filter((x) => x.m.awake).length;
  const [sky, flipSky] = useSky();
  return <div className="relative flex-none overflow-hidden pt-[env(safe-area-inset-top)]" style={{ background: SKIES[sky].top }}>
    {/* a short band that ends on a clean line: the scene keeps its size and loses only the strip of ground under the wolts' feet */}
    <div className="max-h-[188px] overflow-hidden"><Squad sky={sky} wolts={moods.slice(0, 6).map(({ w, m }) => ({ name: w.wolt, look: normalizeLook(ctx.looks?.[w.wolt], w.creature), busy: m.busy, away: !m.awake }))} /></div>
    <div className="absolute inset-x-0 top-[env(safe-area-inset-top)] flex items-start gap-2 px-4 pt-3">
      <div className="min-w-0 flex-1 text-white">
        <h1 className="m-0 font-mono font-bold text-[22px] truncate [text-shadow:0_2px_0_#0006]">{state.title && state.title !== "shell" ? state.title : "shellphone"}</h1>
        <p className="mt-0.5 mb-0 text-[13px] opacity-85 truncate">{hello}, {ctx.person(state.me).name} · {awake} {awake === 1 ? "wolt" : "wolts"} awake</p>
      </div>
      {/* the sun by day, the moon by night: tap it for the other one */}
      <button type="button" onClick={flipSky} aria-label={sky === "day" ? "Day. Switch to night" : "Night. Switch to day"} title={sky === "day" ? "Switch to night" : "Switch to day"}
        className="flex-none w-10 h-10 grid place-items-center rounded-full border-0 bg-[#ffffff22] text-white cursor-pointer">{sky === "day" ? <Sun size={20} /> : <Moon size={19} />}</button>
      <BellButton n={bell} onClick={onBell} dark />
      <PlusButton label="New chat" onClick={onNew} />
    </div>
  </div>;
}

// Home: your wolts like contacts, then the groups, then everyone. On a computer it is the left column, without the scene.
export function HomeList({ state, ctx, chats, everyone, compact, sel, here, onWolt, onChat, onEveryone, onNew, bell, onBell, onInvite, onDesk, onAgent, onRename, onHat, only, onAll, onBack }: {
  state: State; ctx: Ctx; chats: Chat[]; everyone: { at?: number; fresh: number }; compact?: boolean; sel?: string; here?: string;
  only?: "wolts" | "people" | "groups"; onAll?: (what: "wolts" | "people" | "groups") => void; onBack?: () => void;
  onWolt: (w: string) => void; onChat: (id: string) => void; onEveryone: () => void; onNew: () => void; bell: number; onBell: () => void; onInvite?: () => void; onDesk?: () => void; onAgent?: () => void; onRename?: (id: string, title: string) => Promise<string | null>; onHat?: (face: string) => Promise<string | null>;
}) {
  const [hats, setHats] = useState(false);
  const yours = state.members.wolts.filter((w) => w.owner === state.me), others = state.members.wolts.filter((w) => w.owner !== state.me);
  const groups = chats.filter((c) => c.wolts.length > 1);
  const row = (w: Wolt) => {
    const own = chats.filter((c) => c.wolts.length === 1 && c.wolts[0] === w.wolt), top = own[0], fresh = own.reduce((n, c) => n + c.fresh, 0), m = mood(w, state);
    // no chat with it yet: the last thing it said in the room
    const said = top ? undefined : [...ctx.all].reverse().find((x) => x.kind === "wolt" && x.wolt === w.wolt);
    return <button key={w.wolt} type="button" onClick={() => onWolt(w.wolt)} className={`${ROW} !py-[7px] ${sel === w.wolt ? "bg-[#f6e2d6]" : "bg-transparent"}`}>
      <span className="relative flex-none"><Face w={w} ctx={ctx} size={44} />
        <i className={`absolute right-px bottom-px w-3 h-3 rounded-full border-2 border-paper ${m.awake ? "bg-go" : "bg-[#c9bfae]"}`} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5 font-mono font-semibold text-[16px]"><span className="truncate">{w.wolt}</span>
          {m.word && (m.awake ? <span className="lore flex-none font-semibold text-[11px]">{m.word}</span>
            : <span className="flex-none font-normal text-[11px] text-dim bg-[#efe8da] rounded-lg px-[7px] py-px">{m.word}</span>)}</span>
        <span className={`block text-[13px] truncate ${fresh ? "text-ink font-semibold" : "text-dim"}`}>{top?.last?.text || (said ? preview(said) : w.owner === state.me ? "Say hi" : `${ctx.person(w.owner).name}'s ${w.creature}`)}</span>
      </span>
      <span className="flex-none text-right text-xs text-dim">{when(top?.at || said?.at)}{fresh > 0 && <><br /><Badge n={fresh} /></>}</span>
    </button>;
  };
  // On a phone home is one fixed screen: a few of each, and "See all" opens the whole list on a page of its own.
  // That page (only = which list) and the computer's side column show everything.
  const all = !!only || !!compact, wolts = [...yours, ...others], people = state.members.people;
  // as many wolt rows as the phone has room for, so the page never needs to scroll
  const tall = typeof window === "undefined" ? 844 : window.innerHeight;
  const WOLTS = tall >= 800 ? 5 : tall >= 720 ? 4 : 3, PEOPLE = 5, GROUPS = 1;
  const titles = { wolts: "Wolts", people: "People", groups: "Groups" };
  // a section's title with a small arrow opens its whole list
  const title = (what: "wolts" | "people" | "groups") => !all && onAll
    ? <span className="flex-1 min-w-0"><button type="button" onClick={() => onAll(what)} aria-label={`All ${what}`} className="flex items-center gap-0.5 border-0 bg-transparent p-0 font-[inherit] text-inherit cursor-pointer active:opacity-60">{titles[what]}<ChevronRight size={17} strokeWidth={2.6} className="text-dim" /></button></span>
    : <span className="flex-1">{titles[what]}</span>;
  const show = (what: "wolts" | "people" | "groups") => !only || only === what;
  return <div className="relative h-full flex flex-col bg-paper">
    {hats && onHat && <HatPicker now={hatOf(state.faces?.[state.me])} onPick={async (h) => { const e = await onHat(h ? "hat-" + h : ""); if (!e) setHats(false); return e; }} onClose={() => setHats(false)} />}
    {only ? <header className="relative flex-none grid place-items-center border-b border-line pt-[calc(8px+env(safe-area-inset-top))] pb-2 min-h-[52px]">
      <button type="button" aria-label="Back" onClick={onBack} className="absolute left-1 top-[calc(6px+env(safe-area-inset-top))] w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={26} /></button>
      <h1 className="m-0 font-mono font-bold text-[17px]">{titles[only]}</h1>
      <span className="absolute right-4 top-[calc(14px+env(safe-area-inset-top))]">
        {only === "wolts" && onAgent && <AddButton label="Add" onClick={onAgent} />}{only === "people" && onInvite && <AddButton label="Invite" onClick={onInvite} />}{only === "groups" && <AddButton label="New group" onClick={onNew} />}</span>
    </header>
    : compact ? <header className="flex-none flex items-center gap-2 pl-2 pr-3 h-[60px] border-b border-line">
      <h1 className="m-0 pl-2 flex-1 min-w-0 truncate font-mono font-bold text-lg">{state.title && state.title !== "shell" ? state.title : "shellphone"}</h1>
      {onDesk && <button type="button" aria-label="Show the terminals" title="desk: your wolts' terminals" onClick={onDesk} className="flex-none w-9 h-9 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><Monitor size={19} /></button>}
      <BellButton n={bell} onClick={onBell} />
      <PlusButton small label="New chat" onClick={onNew} /></header>
      : <Hero state={state} ctx={ctx} onNew={onNew} onBell={onBell} bell={bell} />}
    <div className={`flex-1 min-h-0 overscroll-contain pb-[calc(16px+env(safe-area-inset-bottom))] ${all ? "overflow-y-auto" : "overflow-hidden"}`}>
      {show("wolts") && <>
        {!only && <div className={HEAD}>{title("wolts")}
          {onAgent && <AddButton label="Add" onClick={onAgent} />}</div>}
        {(all ? wolts : wolts.slice(0, WOLTS)).map(row)}
      </>}
      {show("people") && <>
        {!only && <div className={HEAD}>{title("people")}
          {onInvite && <AddButton label="Invite" onClick={onInvite} />}</div>}
        {only === "people"
          // the whole list: a row each, with who they are here
          ? people.map((p) => { const mine = p.email === state.me && !!onHat;
            return <div key={p.email} role={mine ? "button" : undefined} tabIndex={mine ? 0 : undefined} aria-label={mine ? "Pick your hat" : undefined} onClick={mine ? () => setHats(true) : undefined}
              className={`${ROW} bg-transparent ${mine ? "" : "cursor-default active:opacity-100"}`}>
              <span className="flex-none w-[52px]"><PersonFace p={p} hat={hatOf(state.faces?.[p.email])} size={44} /></span>
              <span className="min-w-0 flex-1"><span className="block font-mono font-semibold text-[16px] truncate">{p.name}</span>
                <span className="block text-[13px] text-dim">{[p.email === state.me ? "you" : "", p.email === state.host ? "host" : "", p.guest ? "guest" : ""].filter(Boolean).join(" · ") || "in this room"}{mine ? " · tap to pick your hat" : ""}</span></span>
            </div>; })
          // side by side: they are who's here, not chats to open
          : <div className={`flex items-end gap-3 px-4 pt-1.5 pb-1 ${all ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "overflow-hidden"}`}>
            {(all ? people : people.slice(0, PEOPLE)).map((p) => { const mine = p.email === state.me && !!onHat;
              return <div key={p.email} role={mine ? "button" : undefined} tabIndex={mine ? 0 : undefined} aria-label={mine ? "Pick your hat" : undefined} onClick={mine ? () => setHats(true) : undefined}
                className={`flex-none w-[62px] text-center ${mine ? "cursor-pointer active:opacity-70" : ""}`}>
                <PersonFace p={p} hat={hatOf(state.faces?.[p.email])} size={52} />
                <span className="block mt-1 font-mono font-semibold text-[12.5px] truncate">{p.email === state.me ? "you" : p.name}</span>
              </div>; })}
          </div>}
      </>}
      {show("groups") && <>
        {!only && <div className={HEAD}>{title("groups")}<AddButton label="New group" onClick={onNew} /></div>}
        <div className={`grid grid-cols-2 gap-2 px-3 pb-2 ${only ? "pt-3" : "pt-1"}`}>
          <button type="button" onClick={onEveryone} className={`relative min-w-0 text-left rounded-[14px] border border-line px-3 py-1.5 cursor-pointer active:opacity-70 ${here === "everyone" ? "bg-[#f6e2d6]" : "bg-transparent"}`}>
            <span className="block h-7 text-[20px] leading-7">🐚</span>
            <span className="block font-mono font-semibold text-[13.5px]">Everyone</span>
            <span className="block text-xs text-dim truncate">the whole room</span>
            {everyone.fresh > 0 && <span className="absolute top-2 right-2"><Badge n={everyone.fresh} /></span>}
          </button>
          {(all ? groups : groups.slice(0, GROUPS)).map((c) => <GroupCard key={c.id} c={c} ctx={ctx} here={here === c.id} onOpen={() => onChat(c.id)}
            onRename={onRename ? (t) => onRename(c.id, t) : undefined} />)}
        </div>
      </>}
    </div>
  </div>;
}

// One wolt: its chats, and the groups it is in. Its face and name open its contact card; ＋ starts a new chat with it.
export function WoltChats({ w, state, ctx, chats, compact, here, onBack, onChat, onNew, onCard, onRename }: {
  w: Wolt; state: State; ctx: Ctx; chats: Chat[]; compact?: boolean; here?: string; onBack: () => void; onChat: (id: string) => void; onNew: () => void; onCard?: (wolt: string) => void; onRename?: (id: string, title: string) => Promise<string | null>;
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
      {own.map((c) => <ChatRow key={c.id} c={c} ctx={ctx} here={here === c.id} onOpen={() => onChat(c.id)} onRename={onRename ? (t) => onRename(c.id, t) : undefined} />)}
      {own.length === 0 && <p className="text-center text-dim font-mono text-xs my-8 px-6">No chats with {w.wolt} yet. Tap ＋ to start one.</p>}
      {groups.length > 0 && <div className={SEC}>Groups with {w.wolt}</div>}
      {groups.map((c) => <ChatRow key={c.id} c={c} ctx={ctx} group here={here === c.id} onOpen={() => onChat(c.id)} onRename={onRename ? (t) => onRename(c.id, t) : undefined} />)}
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
export function ChatHeader({ chat, ctx, compact, onBack, onCard, onRename }: {
  chat: Chat; ctx: Ctx; compact?: boolean; onBack: () => void; onCard?: (wolt: string) => void; onRename?: (title: string) => Promise<string | null>;
}) {
  const names = chat.wolts, one = names.length === 1, title = !one && chat.title === "New chat" ? "" : chat.title;
  // tap the chat's name to give it another: saved in the room, so everyone in it sees the new one
  const [naming, setNaming] = useState<string | null>(null), [problem, setProblem] = useState("");
  const save = async () => {
    const t = (naming || "").trim(); if (!t || t === chat.title || !onRename) return setNaming(null);
    const e = await onRename(t); if (e) setProblem(e); else { setNaming(null); setProblem(""); }
  };
  const name = (cls: string, shown: string) => naming !== null
    ? <form onSubmit={(e) => { e.preventDefault(); save(); }} className="min-w-0 max-w-full"><input autoFocus value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} onBlur={save} aria-label="Name of this chat" enterKeyHint="done"
        onKeyDown={(e) => { if (e.key === "Escape") { setNaming(null); setProblem(""); } }}
        className="w-[220px] max-w-full bg-panel border border-acc rounded-lg px-2 py-0.5 text-[15px] text-center outline-none" />{problem && <small className="block text-[11px] text-acc text-center">{problem}</small>}</form>
    : <button type="button" onClick={onRename ? () => setNaming(chat.title === "New chat" ? "" : chat.title) : undefined} title={onRename ? "Rename" : undefined}
        className={`max-w-full border-0 bg-transparent p-0 truncate ${onRename ? "cursor-pointer" : "cursor-default"} ${cls}`}>{shown}</button>;
  // the terminal of the first wolt here that you may open (the desk's tile on a computer, its lodge session on a phone)
  const term = names.find((n) => ctx.showTerminal || ctx.terminals?.[n]), link = term && !ctx.showTerminal ? ctx.terminals?.[term] : undefined;
  const termBtn = term && <a href={link} target="_blank" rel="noopener" aria-label={`${term}'s terminal`} title={`${term}'s terminal`}
    onClick={(e) => { if (!link) { e.preventDefault(); ctx.showTerminal?.(term); } }}
    className="flex-none w-10 h-8 grid place-items-center rounded-[9px] border-2 border-acc text-acc cursor-pointer"><SquareTerminal size={18} /></a>;
  if (compact) return <header className="flex-none flex items-center gap-2.5 px-4 h-[60px] border-b border-line bg-paper">
    <button type="button" onClick={() => onCard?.(names[0])} aria-label="Contact card" className="flex-none border-0 bg-transparent p-0 cursor-pointer"><Stack names={names} ctx={ctx} size={38} /></button>
    <div className="min-w-0 flex-1"><div className="flex">{name("font-mono font-bold text-[15px] text-ink text-left", title || names.join(", "))}</div>
      <div className="text-xs text-dim truncate">with {names.join(", ")}</div></div>
    {termBtn}
  </header>;
  return <header className="relative flex-none flex flex-col items-center border-b border-line bg-paper pt-[calc(6px+env(safe-area-inset-top))] pb-1.5">
    <button type="button" aria-label="Back" onClick={onBack} className="absolute left-1 top-[calc(10px+env(safe-area-inset-top))] w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={26} /></button>
    <button type="button" onClick={() => onCard?.(names[0])} aria-label="Contact card" className="flex flex-col items-center border-0 bg-transparent p-0 cursor-pointer max-w-[60%]">
      <Stack names={names} ctx={ctx} size={40} />
      <span className="mt-0.5 flex items-center gap-0.5 max-w-full font-mono font-semibold text-[13px] text-ink"><span className="truncate">{names.join(", ")}</span><ChevronRight size={13} className="flex-none text-dim" /></span>
    </button>
    <div className="max-w-[70%] flex justify-center">{name("text-xs text-dim", title || (one ? "" : "Name this group"))}</div>
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
