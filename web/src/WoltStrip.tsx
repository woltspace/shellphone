// Every wolt in the room at a glance, pulled down from the top of the chat: who is gnawing on something, who is idle,
// who is paused or out of reach, and which one is the room's main agent. Pull down again, or tap it, to put it away.
import { useRef } from "react";
import type { State, Wolt } from "./room";
import { woltAvatar } from "./sprites";
import { worn } from "./hats";

type Person = (email: string) => { name: string; color: string };

export function mood(w: Wolt, state: State): { awake: boolean; busy: boolean; word: string } {
  if (w.paused) return { awake: false, busy: false, word: "paused" };
  if (state.unreachable?.[w.wolt]) return { awake: false, busy: false, word: "napping" };
  const busy = state.working_in ? (state.working_in[w.wolt] || []).length > 0 : !!state.working?.[w.wolt];
  return { awake: true, busy, word: busy ? "gnawing" : "idle" };
}

export function WoltStrip({ state, person, open, onClose }: { state: State; person: Person; open: boolean; onClose: () => void }) {
  const wolts = [...state.members.wolts].sort((a, b) => Number(b.wolt === state.main) - Number(a.wolt === state.main)
    || Number(mood(b, state).busy) - Number(mood(a, state).busy));
  return <div aria-hidden={!open} onClick={onClose}
    className={`flex-none overflow-hidden bg-paper border-b border-line transition-[max-height] duration-300 ease-out ${open ? "max-h-[132px]" : "max-h-0 border-b-0"}`}>
    <div className="flex gap-2 px-3 py-2.5 overflow-x-auto overscroll-contain">
      {wolts.length === 0 && <div className="py-6 w-full text-center text-sm text-dim">No wolts in this room yet</div>}
      {wolts.map((w) => { const m = mood(w, state);
        return <div key={w.wolt} className={`flex-none w-[92px] flex flex-col items-center gap-1 pt-2 pb-1.5 px-1 rounded-xl border ${m.busy ? "gnaw-row border-line bg-[#fffdf6]" : "border-transparent"} ${m.awake ? "" : "opacity-55"}`}>
          <span className="relative">
            <img src={woltAvatar(w.creature, person(w.owner).color, worn.wolts[w.wolt])} alt="" className={`pixel w-11 h-11 ${m.busy ? "gnaw-img" : ""}`} />
            <i className={`absolute -right-0.5 bottom-0 w-3 h-3 rounded-full border-2 border-paper ${m.busy ? "bg-acc" : m.awake ? "bg-go" : "bg-[#c9bfae]"}`} />
          </span>
          <span className="max-w-full truncate font-mono font-semibold text-[12.5px]">{w.wolt}{state.main === w.wolt && <span className="ml-0.5 text-acc" title="main agent">★</span>}</span>
          {m.busy ? <span className="lore max-w-full truncate font-mono font-semibold text-[10.5px]">gnawing…</span>
            : <span className="font-mono text-[10.5px] text-dim">{m.word}</span>}
        </div>; })}
    </div>
  </div>;
}

// Pull down on an element (the chat's header, or the chat itself when it is at its top) to open; pull up to close.
export function usePullDown(open: boolean, setOpen: (on: boolean) => void, atTop: () => boolean = () => true) {
  const start = useRef<{ x: number; y: number; top: boolean } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY, top: atTop() }; },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current; start.current = null; if (!s) return;
      const t = e.changedTouches[0], dy = t.clientY - s.y, dx = Math.abs(t.clientX - s.x);
      if (dx > Math.abs(dy)) return;  // sideways: someone else's swipe
      if (!open && dy > 50 && s.top) setOpen(true);
      else if (open && dy < -40) setOpen(false);
    },
  };
}
