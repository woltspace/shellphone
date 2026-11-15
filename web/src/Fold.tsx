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
  const [open, setOpen] = useState(false), [one, setOne] = useState<Set<string>>(new Set());
  const head = useRef<HTMLDivElement>(null), before = useRef<number | null>(null);
  const counts = new Map<string, number>();
  for (const m of run) counts.set(m.wolt!, (counts.get(m.wolt!) || 0) + 1);
  const hold = () => { before.current = head.current?.getBoundingClientRect().top ?? null; };
  const toggle = () => { hold(); setOpen(!open); if (open) setOne(new Set()); };
  const flip = (id: string) => { hold(); const next = new Set(one); if (next.has(id)) next.delete(id); else next.add(id); setOne(next); };
  // the chat is anchored at the bottom, so opening a run would push its row up the screen: scroll it back under the finger
  useLayoutEffect(() => {
    if (before.current === null || !head.current) return;
    const feed = head.current.closest("[data-feed]") as HTMLElement | null;
    const moved = head.current.getBoundingClientRect().top - before.current;
    before.current = null;
    if (feed && moved) feed.scrollTop += moved;
  }, [open, one]);
  const avatar = (name: string, cls: string) => {
    const w = ctx.wolts.find((x) => x.wolt === name);
    return w ? <img key={name} src={woltAvatar(w.creature, ctx.person(w.owner).color, worn.wolts[w.wolt])} alt="" className={`pixel rounded-full bg-panel border border-line ${cls}`} />
      : <span key={name} className={`rounded-full bg-line grid place-items-center font-mono text-[9px] border border-panel ${cls}`}>{name[0]?.toUpperCase()}</span>;
  };
  // closed: one slim line. open: one line per message; tap a line for that whole message.
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
    {open && <div className="border-b border-dashed border-line pb-1">
      {run.map((m, k) => one.has(m.id)
        ? <div key={m.id}><button type="button" onClick={() => flip(m.id)} className="w-full flex items-center gap-1.5 px-2 pt-1.5 bg-transparent border-0 text-left cursor-pointer font-mono text-[11px] text-acc"><ChevronUp size={13} />{m.wolt}</button>{children[k]}</div>
        : <button key={m.id} type="button" onClick={() => flip(m.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 bg-transparent border-0 text-left cursor-pointer active:bg-line/40">
            {avatar(m.wolt!, "w-4 h-4 flex-none")}
            <span className="flex-1 min-w-0 truncate text-[13px]"><b className="font-mono font-semibold text-[12px] text-acc">{m.wolt}</b> <span className="text-dim">{firstLine(m)}</span></span>
          </button>)}
    </div>}
  </div>;
}
