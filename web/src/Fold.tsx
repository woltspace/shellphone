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
  return <div className="mx-2.5 my-1" data-fold={run.length}>
    <div ref={head} className={open ? "sticky top-0 z-[5] bg-paper/95 backdrop-blur-sm" : ""}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="w-full h-9 flex items-center gap-2 px-2 bg-transparent border-0 border-y border-dashed border-line text-left cursor-pointer">
        <span className="flex-none flex -space-x-1.5">{[...counts.keys()].slice(0, 4).map((n) => avatar(n, "w-5 h-5"))}</span>
        <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-dim">
          <b className="text-ink font-semibold">{run.length} agent messages</b>{[...counts].map(([n, c]) => ` · ${n} ${c}`).join("")}</span>
        <span className="flex-none text-acc">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
    </div>
    {open && <div className="relative border-b border-dashed border-line">
      <div className="flex items-center gap-2 px-2 py-1 font-mono text-[11px] text-dim">
        {avatar(run[at].wolt!, "w-4 h-4")}<b className="text-acc">{run[at].wolt}</b><span className="flex-1" />
        <span>{at + 1} / {run.length}</span><span className="sm:hidden">· swipe</span></div>
      <div ref={strip} onScroll={(e) => { const el = e.currentTarget; setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}
        className="flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ touchAction: "pan-x pan-y" }}>
        {children.map((c, k) => <div key={run[k].id} className="w-full flex-none snap-start max-h-[60vh] overflow-y-auto overscroll-contain">{c}</div>)}
      </div>
      <div className="flex justify-center gap-1 py-1.5">{run.map((m, k) => <button key={m.id} type="button" aria-label={`Message ${k + 1}`} onClick={() => go(k)}
        className={`w-1.5 h-1.5 p-0 rounded-full border-0 cursor-pointer ${k === at ? "bg-acc" : "bg-line"}`} />)}</div>
      {at > 0 && <button type="button" aria-label="Previous" onClick={() => go(at - 1)} className="hidden sm:grid absolute left-0 top-1/2 w-8 h-8 place-items-center rounded-full bg-panel border border-line text-acc cursor-pointer">‹</button>}
      {at < run.length - 1 && <button type="button" aria-label="Next" onClick={() => go(at + 1)} className="hidden sm:grid absolute right-0 top-1/2 w-8 h-8 place-items-center rounded-full bg-panel border border-line text-acc cursor-pointer">›</button>}
    </div>}
  </div>;
}
