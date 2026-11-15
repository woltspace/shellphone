// Everyone in the room at a glance, pulled down from the top of the chats: the people, and every wolt: who is gnawing on something, who is idle,
// who is paused or out of reach, and which one is the room's main agent. Pull down again, or tap it, to put it away.
import { woltColor, woltFace } from "./Message";
import { useRef } from "react";
import type { State, Wolt } from "./room";
import { personAvatar } from "./sprites";
import { worn } from "./hats";

type Person = (email: string) => { name: string; color: string };

export function mood(w: Wolt, state: State): { awake: boolean; busy: boolean; word: string } {
  if (w.paused) return { awake: false, busy: false, word: "paused" };
  if (state.unreachable?.[w.wolt]) return { awake: false, busy: false, word: "napping" };
  const busy = state.working_in ? (state.working_in[w.wolt] || []).length > 0 : !!state.working?.[w.wolt];
  return { awake: true, busy, word: busy ? "gnawing" : "idle" };
}

// Who's who in the strip: a person or a wolt, by the key a profile opens with ("p:email" or "w:name").
export type Who = string;

export function WoltStrip({ state, person, open, onClose, onPick }: { state: State; person: Person; open: boolean; onClose: () => void; onPick?: (who: Who) => void }) {
  const wolts = [...state.members.wolts].sort((a, b) => Number(b.wolt === state.main) - Number(a.wolt === state.main)
    || Number(mood(b, state).busy) - Number(mood(a, state).busy));
  const people = state.members.people;
  // everyone in their own circle: people first, then the wolts, each one alive in its own way; tap one to see what it's up to
  const tile = (key: string, face: string, name: string, color: string, m: { awake: boolean; busy: boolean; word: string }, star: boolean, i: number) =>
    <button type="button" key={key} onClick={(e) => { e.stopPropagation(); onPick?.(key); }} aria-label={`${name}: ${m.word}`}
      className={`flex-none w-[84px] flex flex-col items-center gap-1 pt-2 pb-1.5 px-1 rounded-xl border bg-transparent cursor-pointer active:scale-95 transition-transform ${m.busy ? "gnaw-row border-line bg-[#fffdf6]" : "border-transparent"} ${m.awake ? "" : "opacity-55"}`}>
      <span className="relative">
        <span className={`block ${m.busy ? "" : m.awake ? "idle-bob" : ""}`} style={{ animationDelay: `${(i % 5) * -0.6}s` }}>
          <img src={face} alt="" className={`pixel block w-14 h-14 ${m.busy ? "gnaw-img" : ""}`} /></span>
        <i className={`absolute -right-0.5 bottom-0.5 w-3.5 h-3.5 rounded-full border-2 border-paper ${m.busy ? "bg-acc" : m.awake ? "bg-go" : "bg-[#c9bfae]"}`} />
        {!m.awake && m.word === "napping" && <span className="absolute -top-1 -right-1 font-mono text-[11px] text-dim snooze">z</span>}
      </span>
      <span className="max-w-full truncate font-mono font-semibold text-[12.5px]" style={{ color }}>{name}{star && <span className="ml-0.5 text-acc" title="main agent">★</span>}</span>
      {m.busy ? <span className="lore max-w-full truncate font-mono font-semibold text-[10.5px]">gnawing…</span>
        : <span className="font-mono text-[10.5px] text-dim">{m.word}</span>}
    </button>;
  return <div aria-hidden={!open} onClick={onClose}
    className={`flex-none overflow-hidden border-b border-line transition-[max-height] duration-300 ease-out ${open ? "max-h-[150px]" : "max-h-0 border-b-0"}`}
    style={{ background: "linear-gradient(#f3eddf, #fbf7ef)" }}>
    <div className="flex items-end gap-1 px-3 py-2.5 overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {people.map((p, i) => tile("p:" + p.email, personAvatar(p.name, person(p.email).color, worn.people[p.email]), p.name, person(p.email).color,
        { awake: true, busy: false, word: p.email === state.me ? "you" : "human" }, false, i))}
      {people.length > 0 && wolts.length > 0 && <i className="flex-none self-stretch w-px my-3 mx-1 bg-line" />}
      {wolts.map((w, i) => tile("w:" + w.wolt, woltFace(w.wolt, w.creature), w.wolt, woltColor(w.wolt, state.members.wolts), mood(w, state), state.main === w.wolt, i + people.length))}
      {wolts.length === 0 && people.length === 0 && <div className="py-6 w-full text-center text-sm text-dim">Nobody here yet</div>}
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
