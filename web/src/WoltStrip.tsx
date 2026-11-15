// Everyone in the room at a glance, pulled down from the top of the chats: the people, and every wolt: who is gnawing on something, who is idle,
// who is paused or out of reach, and which one is the room's main agent. Pull down again, or tap it, to put it away.
import { mix, woltColor } from "./Message";
import { useEffect, useRef, useState } from "react";
import type { State, Wolt } from "./room";
import { personAvatar, verbs, woltAvatar } from "./sprites";
import { Backdrop, GROUND, ROWS, useSky } from "./Sky";
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

export function WoltStrip({ state, person, open, onClose, onPick, el }: { state: State; person: Person; open: boolean; onClose: () => void; onPick?: (who: Who) => void; el: React.RefObject<HTMLDivElement | null> }) {
  const wolts = [...state.members.wolts].sort((a, b) => Number(b.wolt === state.main) - Number(a.wolt === state.main)
    || Number(mood(b, state).busy) - Number(mood(a, state).busy));
  const people = state.members.people;
  const [sky, flip] = useSky();
  // a busy wolt chews through its lines of lore, a new one every few seconds, like it does in the chats
  const [tick, setTick] = useState(0);
  const anyBusy = wolts.some((w) => mood(w, state).busy);
  useEffect(() => { if (!open || !anyBusy) return; const t = setInterval(() => setTick((x) => x + 1), 2400); return () => clearInterval(t); }, [open, anyBusy]);
  // when everyone doesn't fit, the row opens scrolled to its middle, so it still sits centered on the screen
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => { const r = row.current; if (open && r) r.scrollLeft = (r.scrollWidth - r.clientWidth) / 2; }, [open, people.length, wolts.length]);
  const chew = (name: string, creature?: string) => { const v = verbs(creature); return v[(tick + name.length) % v.length]; };
  // everyone in their own circle: people first, then the wolts, each one alive in its own way; tap one to see what it's up to
  const tile = (key: string, face: string, name: string, color: string, m: { awake: boolean; busy: boolean; word: string }, star: boolean, i: number, lore?: string) =>
    <button type="button" key={key} onClick={(e) => { e.stopPropagation(); onPick?.(key); }} aria-label={`${name}: ${m.word}`}
      className={`flex-none w-[100px] flex flex-col items-center gap-1 p-0 border-0 bg-transparent cursor-pointer active:scale-95 transition-transform ${m.awake ? "" : "opacity-60"}`}>
      <span className="max-w-full truncate font-mono font-bold text-[13px] px-2 py-px rounded-full bg-[#fffdf6f2] shadow-[0_1px_2px_#0003]" style={{ color }}>{name}{star && <span className="ml-0.5 text-acc" title="main agent">★</span>}</span>
      <span className="relative">
        <span className={`block ${m.busy ? "" : m.awake ? "idle-bob" : ""}`} style={{ animationDelay: `${(i % 5) * -0.6}s` }}>
          <span className="flex items-end justify-center w-[84px] h-[84px]"><img src={face} alt="" className={`pixel block object-contain object-bottom ${key.startsWith("p:") ? "w-[72px] h-[72px] mb-1" : "w-[84px] h-[84px]"} ${m.busy ? "gnaw-img" : ""}`} /></span></span>
        <i className={`absolute right-2 bottom-1 w-3.5 h-3.5 rounded-full border-2 border-[#4A8838] ${m.busy ? "bg-acc" : m.awake ? "bg-go" : "bg-[#c9bfae]"}`} />
        {!m.awake && m.word === "napping" && <span className="absolute -top-1 -right-1 font-mono text-[11px] text-dim snooze">z</span>}
      </span>
      {m.busy ? <span className="mt-1 gnaw-row max-w-full truncate px-1.5 rounded-md bg-[#fffdf6ee] border border-line font-mono font-semibold text-[10.5px]"><span key={tick} className="lore new">{chew(name, lore)}</span></span>
        : <span className="mt-1 max-w-full truncate font-mono font-semibold text-[10.5px] px-1.5 rounded-md bg-[#1a3a18aa] text-[#e8f1dc]">{m.word}</span>}
    </button>;
  // its height is the pull's: the hook below moves it with your finger and lets it spring open or shut
  return <div ref={el} aria-hidden={!open} onClick={onClose}
    className={`relative flex-none overflow-hidden ${open ? "border-b border-line" : ""}`} style={{ height: 0, background: "#ede7df", ["--p" as string]: 0 }}>
    {/* Lauren's sky, by day or night, drifting a little slower than everyone standing in it */}
    <div aria-hidden className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: STRIP, transform: "translateY(calc((1 - var(--p)) * -40px))" }}>
      <Backdrop sky={sky} height={STRIP} /></div>
    <button type="button" aria-label={sky === "night" ? "Switch to day" : "Switch to night"} onClick={(e) => { e.stopPropagation(); flip(); }}
      className="absolute top-0 right-0 z-10 w-14 h-14 p-0 border-0 bg-transparent cursor-pointer" />
    <div ref={row} className="relative overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ height: STRIP, paddingTop: STAND, transform: "translateY(calc((1 - var(--p)) * -24px)) scale(calc(.8 + var(--p) * .2))", opacity: "var(--p)", transformOrigin: "50% 100%" }}>
      <div className="flex items-start justify-center gap-1 w-max min-w-full px-3">{/* centered when everyone fits, scrolls when they don't */}
      {people.map((p, i) => tile("p:" + p.email, personAvatar(p.name, person(p.email).color, worn.people[p.email]), p.name, person(p.email).color,
        { awake: true, busy: false, word: p.email === state.me ? "you" : "human" }, false, i))}
      {people.length > 0 && wolts.length > 0 && <i className="flex-none w-2" />}
      {wolts.map((w, i) => tile("w:" + w.wolt, woltAvatar(w.creature, woltColor(w.wolt, state.members.wolts), worn.wolts[w.wolt], mix(woltColor(w.wolt, state.members.wolts), "#ffffff", 0.78)), w.wolt, woltColor(w.wolt, state.members.wolts), mood(w, state), state.main === w.wolt, i + people.length, w.creature))}
      {wolts.length === 0 && people.length === 0 && <div className="py-6 w-full text-center text-sm text-dim">Nobody here yet</div>}
      </div>
    </div>
  </div>;
}

// Pull down on an element (the header, or the chats when they're at their top): the strip follows your finger,
// stretches a little past open, and springs open or shut when you let go, by how far and how fast you pulled.
export const STRIP = 196;
const STAND = Math.round((GROUND / ROWS) * STRIP) + 4 - 84 - 26;  // so each face rests on the meadow, with its name above  // where everyone's top goes, so their feet land just inside the grass
const SPRING = "height .5s cubic-bezier(.25,1.45,.45,1)";
export function usePullDown(open: boolean, setOpen: (on: boolean) => void, el: React.RefObject<HTMLDivElement | null>, atTop: () => boolean = () => true) {
  const drag = useRef<{ x: number; y: number; top: boolean; base: number; h: number; on: boolean; v: number; t: number; ly: number } | null>(null);
  const show = (h: number, spring: boolean) => { const e = el.current; if (!e) return;
    e.style.transition = spring ? `${SPRING}, --p .5s` : "none"; e.style.height = `${h}px`; e.style.setProperty("--p", String(Math.min(1, h / STRIP))); };
  useEffect(() => { if (!drag.current) show(open ? STRIP : 0, true); }, [open]);  // opened or shut some other way: spring there
  return {
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0];
      drag.current = { x: t.clientX, y: t.clientY, top: atTop(), base: open ? STRIP : 0, h: open ? STRIP : 0, on: false, v: 0, t: performance.now(), ly: t.clientY }; },
    onTouchMove: (e: React.TouchEvent) => {
      const d = drag.current; if (!d) return;
      const t = e.touches[0], dy = t.clientY - d.y, dx = t.clientX - d.x;
      if (!d.on) {  // decide once: an up-and-down pull that's ours, or someone else's swipe or scroll
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (Math.abs(dx) > Math.abs(dy) || (!open && (dy < 0 || !d.top)) || (open && !d.top && dy > 0)) { drag.current = null; return; }
        d.on = true;
      }
      const now = performance.now(); d.v = (t.clientY - d.ly) / Math.max(1, now - d.t); d.t = now; d.ly = t.clientY;
      const raw = d.base + dy;
      d.h = raw > STRIP ? STRIP + (raw - STRIP) * 0.35 : Math.max(0, raw);  // past open it gets heavier, like a rubber band
      show(d.h, false);
    },
    onTouchEnd: () => {
      const d = drag.current; drag.current = null; if (!d || !d.on) return;
      const fling = Math.abs(d.v) > 0.45;
      const to = fling ? d.v > 0 : d.h > STRIP * (open ? 0.6 : 0.35);
      show(to ? STRIP : 0, true);
      if (to !== open) setOpen(to);
    },
  };
}
