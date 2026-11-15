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

export const FOLD_AT = 3, PREVIEW_UP_TO = 5;

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

export function Fold({ run, ctx, children }: { run: Msg[]; ctx: Ctx; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const head = useRef<HTMLDivElement>(null), before = useRef<number | null>(null);
  const counts = new Map<string, number>();
  for (const m of run) counts.set(m.wolt!, (counts.get(m.wolt!) || 0) + 1);
  const toggle = () => { before.current = head.current?.getBoundingClientRect().top ?? null; setOpen(!open); };
  // the chat is anchored at the bottom, so opening a run would push its row up the screen: scroll it back under the finger
  useLayoutEffect(() => {
    if (before.current === null || !head.current) return;
    const feed = head.current.closest("[data-feed]") as HTMLElement | null;
    const moved = head.current.getBoundingClientRect().top - before.current;
    before.current = null;
    if (feed && moved) feed.scrollTop += moved;
  }, [open]);
  const avatar = (name: string) => {
    const w = ctx.wolts.find((x) => x.wolt === name);
    return w ? <img src={woltAvatar(w.creature, ctx.person(w.owner).color, worn.wolts[w.wolt])} alt="" className="pixel w-5 h-5" />
      : <span className="w-5 h-5 rounded-full bg-line grid place-items-center font-mono text-[10px]">{name[0]?.toUpperCase()}</span>;
  };
  return <div className="mx-2.5 my-1.5 rounded-2xl border border-dashed border-line" data-fold={run.length}>
    <div ref={head} className={open ? "sticky top-0 z-[5] bg-paper rounded-t-2xl border-b border-line" : ""}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border-0 text-left cursor-pointer">
        <span className="font-mono font-semibold text-[13px] text-ink whitespace-nowrap">{run.length} agent messages</span>
        <span className="flex-1 min-w-0 flex flex-wrap gap-1">
          {[...counts].map(([name, n]) => <span key={name} className="inline-flex items-center gap-1 rounded-full border border-line bg-panel pl-0.5 pr-2 py-px font-mono text-[11.5px]">
            {avatar(name)}{name}<b>{n}</b></span>)}
        </span>
        <span className="flex-none w-8 h-8 grid place-items-center rounded-full text-acc">{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
      </button>
      {!open && run.length <= PREVIEW_UP_TO && <div className="px-3 pb-2 -mt-0.5 space-y-0.5">
        {run.map((m) => <div key={m.id} className="truncate text-[12.5px] text-dim"><b className="font-mono font-semibold text-acc">{m.wolt}</b> {firstLine(m)}</div>)}
      </div>}
    </div>
    {open && <div className="pb-1">{children}</div>}
  </div>;
}
