// Agents talking among themselves fold away: three or more agent messages in a row, with nobody stepping in, become one row
// that says who spoke and how many times. Up to five show a line of each; more than that fold to the row alone.
// The row's button stays where it is when you open or close it, and it stays in view while you read the run.
// Folding is a switch in the menu, on unless you turn it off; it's kept in this browser.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Msg } from "./room";
import type { Ctx } from "./Message";
import { woltAvatar } from "./sprites";
import { worn } from "./hats";

export const FOLD_AT = 3;

const KEY = "shellphone.fold", listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export function setFolding(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private window: on for this visit only */ }
  listeners.forEach((f) => f());
}
export const useFolding = () => useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, read);

// The list cut into what to draw: single messages, and runs of agent messages long enough to fold.
export type Piece = { one: Msg } | { run: Msg[] };
export function pieces(list: Msg[], folding: boolean): Piece[] {
  if (!folding) return list.map((one) => ({ one }));
  const out: Piece[] = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    while (j < list.length && list[j].kind === "wolt" && !list[j].pending) j++;
    if (j - i >= FOLD_AT) { out.push({ run: list.slice(i, j) }); i = j; continue; }
    for (const one of list.slice(i, Math.max(j, i + 1))) out.push({ one });
    i = Math.max(j, i + 1);
  }
  return out;
}

const firstLine = (m: Msg) => (m.text || (m.files?.length ? "[a file]" : m.card ? "[a card]" : "")).replace(/\*\*|`/g, "").split("\n").find((l) => l.trim()) || "";

export function Fold({ run, ctx, children }: { run: Msg[]; ctx: Ctx; children: React.ReactNode[] }) {
  const [open, setOpen] = useState(false), [at, setAt] = useState(0);
  const head = useRef<HTMLDivElement>(null), strip = useRef<HTMLDivElement>(null), before = useRef<number | null>(null);
  const counts = new Map<string, number>();
  for (const m of run) counts.set(m.wolt!, (counts.get(m.wolt!) || 0) + 1);
  const toggle = () => { before.current = head.current?.getBoundingClientRect().top ?? null; setOpen(!open); setAt(0); };
  // the chat is anchored at the bottom, so opening a run would push its row up the screen: scroll it back under the finger
  useLayoutEffect(() => {
    if (before.current === null || !head.current) return;
    const feed = head.current.closest("[data-feed]") as HTMLElement | null;
    const moved = head.current.getBoundingClientRect().top - before.current;
    before.current = null;
    if (feed && moved) feed.scrollTop += moved;
  }, [open]);
  const go = (i: number) => { const el = strip.current; if (el) el.scrollTo({ left: Math.max(0, Math.min(run.length - 1, i)) * el.clientWidth, behavior: "smooth" }); };
  const avatar = (name: string, cls: string) => {
    const w = ctx.wolts.find((x) => x.wolt === name);
    return w ? <img key={name} src={woltAvatar(w.creature, ctx.person(w.owner).color, worn.wolts[w.wolt])} alt="" className={`pixel rounded-full bg-panel border border-line ${cls}`} />
      : <span key={name} className={`rounded-full bg-line grid place-items-center font-mono text-[9px] border border-panel ${cls}`}>{name[0]?.toUpperCase()}</span>;
  };
  // closed: one slim line. open: the run as cards side by side, one whole message each; swipe through, tap the line to close.
  return <div className={open ? "ml-11 mr-6 my-2 rounded-2xl border-2 border-line bg-panel/70 shadow-[0_1px_6px_#18100a14]" : "mx-2.5 my-1"} data-fold={run.length}>
    <div ref={head} className={open ? "sticky top-0 z-[5] bg-panel/95 backdrop-blur-sm rounded-t-2xl" : ""}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className={`w-full h-9 flex items-center gap-2 px-2 bg-transparent border-0 text-left cursor-pointer ${open ? "border-b border-line" : "border-y border-dashed border-line"}`}>
        <span className="flex-none flex -space-x-1.5">{[...counts.keys()].slice(0, 4).map((n) => avatar(n, "w-5 h-5"))}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-dim">
          <b className="text-ink font-semibold">{run.length} agent messages</b>{[...counts].map(([n, c]) => ` · ${n} ${c}`).join("")}</span>
        <span className="flex-none text-acc">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
    </div>
    {open && <div className="relative">
      <div className="flex items-center gap-2 px-2 py-1 font-mono text-[11px] text-dim">
        {avatar(run[at].wolt!, "w-4 h-4")}<b className="text-acc">{run[at].wolt}</b><span className="flex-1" />
        <span>{at + 1} / {run.length}</span><span className="sm:hidden">· swipe</span></div>
      <div ref={strip} onScroll={(e) => { const el = e.currentTarget; setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
        className="flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ touchAction: "pan-x pan-y" }}>
        {children.map((c, k) => <div key={run[k].id} className="w-full flex-none snap-start max-h-[42vh] overflow-y-auto overscroll-contain pb-1 [&>*>*>div]:px-1.5 [&>*>*>div]:mt-0 [&_img.w-7]:hidden [&_[data-bubble]]:max-w-full [&_[data-bubble]]:flex-1">{c}</div>)}
      </div>
      <div className="flex justify-center gap-1 py-1.5">{run.map((m, k) => <button key={m.id} type="button" aria-label={`Message ${k + 1}`} onClick={() => go(k)}
        className={`w-1.5 h-1.5 p-0 rounded-full border-0 cursor-pointer ${k === at ? "bg-acc" : "bg-line"}`} />)}</div>
      {at > 0 && <button type="button" aria-label="Previous" onClick={() => go(at - 1)} className="hidden sm:grid absolute left-0 top-1/2 w-8 h-8 place-items-center rounded-full bg-panel border border-line text-acc cursor-pointer">‹</button>}
      {at < run.length - 1 && <button type="button" aria-label="Next" onClick={() => go(at + 1)} className="hidden sm:grid absolute right-0 top-1/2 w-8 h-8 place-items-center rounded-full bg-panel border border-line text-acc cursor-pointer">›</button>}
    </div>}
  </div>;
}

// A long chat reads as stretches of back and forth: one person with the agents (HAHAHA), or agents among themselves (AAAA).
// Each stretch is a group: closed, one line titled by the message that started it; open, a rail down its left side folds it
// again with a tap. A new group starts after a pause, when another person speaks, or at someone's next message once the group
// has run long. The newest group stays open.
export const GROUP_PAUSE = 300, GROUP_LONG = 10, GROUP_FROM = 12;
export function groups(list: Msg[]): Msg[][] {
  if (list.length < GROUP_FROM) return [list];
  const out: Msg[][] = [];
  let cur: Msg[] = [], human = "";
  for (const m of list) {
    const h = m.kind === "human", prev = cur[cur.length - 1];
    if (prev && (m.at - prev.at > GROUP_PAUSE || (h && human && m.email !== human) || (h && cur.length >= GROUP_LONG))) { out.push(cur); cur = []; }
    cur.push(m);
    if (h) human = m.email!;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function Group({ list, ctx, last, children }: { list: Msg[]; ctx: Ctx; last: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(last);
  const head = useRef<HTMLDivElement>(null), before = useRef<number | null>(null);
  const toggle = () => { before.current = head.current?.getBoundingClientRect().top ?? null; setOpen(!open); };
  useLayoutEffect(() => {  // keep the group's line where it was under the finger, as Fold does
    if (before.current === null || !head.current) return;
    const feed = head.current.closest("[data-feed]") as HTMLElement | null;
    const moved = head.current.getBoundingClientRect().top - before.current;
    before.current = null;
    if (feed && moved) feed.scrollTop += moved;
  }, [open]);
  const name = (m: Msg) => m.kind === "human" ? ctx.person(m.email).name : m.wolt!;
  const counts = new Map<string, { n: number; m: Msg }>();
  for (const m of list) { const k = name(m); counts.set(k, { n: (counts.get(k)?.n || 0) + 1, m }); }
  const opener = list.find((m) => m.kind === "human") || list[0];
  const pattern = list.map((m) => m.kind === "human" ? "H" : "A").join("");
  const face = (m: Msg) => {
    const w = m.kind === "wolt" ? ctx.wolts.find((x) => x.wolt === m.wolt) : undefined, p = ctx.person(m.kind === "human" ? m.email : w?.owner);
    return w ? <img key={name(m)} src={woltAvatar(w.creature, p.color, worn.wolts[w.wolt])} alt="" className="pixel w-5 h-5 rounded-full bg-panel border border-line" />
      : <span key={name(m)} className="w-5 h-5 rounded-full grid place-items-center text-white font-mono font-bold text-[9px] border border-panel" style={{ background: p.color }}>{name(m)[0]?.toUpperCase()}</span>;
  };
  return <div className="my-1.5" data-group={list.length}>
    <div ref={head} className={`mx-2.5 ${open ? "sticky top-0 z-[6]" : ""}`}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 bg-panel text-left cursor-pointer border border-line ${open ? "rounded-t-xl rounded-br-xl shadow-[0_1px_6px_#18100a14]" : "border-dashed rounded-xl"}`}>
        <span className="flex-none flex -space-x-1.5">{[...counts.values()].slice(0, 5).map((c) => face(c.m))}</span>
        <span className="flex-1 min-w-0">
          <b className="block truncate text-[13.5px] font-semibold">{firstLine(opener)}</b>
          <span className="block truncate font-mono text-[11px] text-dim">{list.length} messages{[...counts].map(([k, c]) => ` · ${k} ${c.n}`).join("")} · <span className="text-acc tracking-wide">{pattern.length > 16 ? pattern.slice(0, 16) + "…" : pattern}</span></span>
        </span>
        <span className="flex-none text-acc">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
    </div>
    {open && <div className="flex">
      <button type="button" aria-label="Fold this group" title="Fold" onClick={toggle}
        className="group flex-none w-6 ml-2.5 flex justify-center py-1 bg-transparent border-0 cursor-pointer">
        <i className="w-1 rounded-full bg-acc/50 group-hover:bg-acc group-active:bg-acc group-hover:w-1.5 transition-all" /></button>
      <div className="flex-1 min-w-0 -ml-2.5">{children}</div>
    </div>}
  </div>;
}
