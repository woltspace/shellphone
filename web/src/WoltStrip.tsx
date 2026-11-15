// Everyone in the room at a glance, pulled down from the top of the chats: the people, and every wolt: who is gnawing on something, who is idle,
// who is paused or out of reach, and which one is the room's main agent. Pull down again, or tap it, to put it away.
import { woltColor, woltFace } from "./Message";
import { useEffect, useRef } from "react";
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

export function WoltStrip({ state, person, open, onClose, onPick, el }: { state: State; person: Person; open: boolean; onClose: () => void; onPick?: (who: Who) => void; el: React.RefObject<HTMLDivElement | null> }) {
  const wolts = [...state.members.wolts].sort((a, b) => Number(b.wolt === state.main) - Number(a.wolt === state.main)
    || Number(mood(b, state).busy) - Number(mood(a, state).busy));
  const people = state.members.people;
  // everyone in their own circle: people first, then the wolts, each one alive in its own way; tap one to see what it's up to
  const tile = (key: string, face: string, name: string, color: string, m: { awake: boolean; busy: boolean; word: string }, star: boolean, i: number) =>
    <button type="button" key={key} onClick={(e) => { e.stopPropagation(); onPick?.(key); }} aria-label={`${name}: ${m.word}`}
      className={`flex-none w-[84px] flex flex-col items-center gap-1 pt-2 pb-1.5 px-1 rounded-xl border bg-transparent cursor-pointer active:scale-95 transition-transform ${m.busy ? "gnaw-row border-[#c9b98f] bg-[#fffdf6cc]" : "border-transparent"} ${m.awake ? "" : "opacity-55"}`}>
      <span className="relative">
        <span className={`block ${m.busy ? "" : m.awake ? "idle-bob" : ""}`} style={{ animationDelay: `${(i % 5) * -0.6}s` }}>
          <img src={face} alt="" className={`pixel block w-14 h-14 ${m.busy ? "gnaw-img" : ""}`} /></span>
        <i className={`absolute -right-0.5 bottom-0.5 w-3.5 h-3.5 rounded-full border-2 border-paper ${m.busy ? "bg-acc" : m.awake ? "bg-go" : "bg-[#c9bfae]"}`} />
        {!m.awake && m.word === "napping" && <span className="absolute -top-1 -right-1 font-mono text-[11px] text-dim snooze">z</span>}
      </span>
      <span className="max-w-full truncate font-mono font-semibold text-[12px] px-1.5 rounded-md bg-[#fffdf6d9]" style={{ color }}>{name}{star && <span className="ml-0.5 text-acc" title="main agent">★</span>}</span>
      {m.busy ? <span className="lore max-w-full truncate font-mono font-semibold text-[10.5px]">gnawing…</span>
        : <span className="font-mono text-[10.5px] text-[#4d5a3c]">{m.word}</span>}
    </button>;
  // its height is the pull's: the hook below moves it with your finger and lets it spring open or shut
  return <div ref={el} aria-hidden={!open} onClick={onClose}
    className={`relative flex-none overflow-hidden ${open ? "border-b border-line" : ""}`} style={{ height: 0, background: "#dce5c9", ["--p" as string]: 0 }}>
    <Meadow />
    <div className="relative flex items-end gap-1 px-3 pt-3 pb-2 overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ height: STRIP, transform: "translateY(calc((1 - var(--p)) * -24px)) scale(calc(.8 + var(--p) * .2))", opacity: "var(--p)", transformOrigin: "50% 100%" }}>
      {people.map((p, i) => tile("p:" + p.email, personAvatar(p.name, person(p.email).color, worn.people[p.email]), p.name, person(p.email).color,
        { awake: true, busy: false, word: p.email === state.me ? "you" : "human" }, false, i))}
      {people.length > 0 && wolts.length > 0 && <i className="flex-none self-stretch w-px my-4 mx-1 bg-[#3a664433]" />}
      {wolts.map((w, i) => tile("w:" + w.wolt, woltFace(w.wolt, w.creature), w.wolt, woltColor(w.wolt, state.members.wolts), mood(w, state), state.main === w.wolt, i + people.length))}
      {wolts.length === 0 && people.length === 0 && <div className="py-6 w-full text-center text-sm text-dim">Nobody here yet</div>}
    </div>
  </div>;
}

// Lauren's meadow from the woltspace map: rolling grass, a river and a few pines, behind everyone.
// It drifts a little slower than the faces while you pull, so the scene feels deep.
function Meadow() {
  return <svg aria-hidden viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full pointer-events-none"
    style={{ transform: "translateY(calc((1 - var(--p)) * -40px))" }}>
    <path d="M0 230 Q 160 200 300 240 T 620 230 T 1000 220 L1000 300 L0 300Z" fill="#C9D6AE" />
    <path d="M560 0 C 540 80 600 120 570 180 S 520 260 560 300" stroke="#9EC1CF" strokeWidth="22" fill="none" opacity=".7" />
    <g fill="#3A6644" opacity=".55">
      <polygon points="40,70 55,40 70,70" /><polygon points="62,80 78,48 94,80" />
      <polygon points="420,30 436,0 452,30" /><polygon points="900,40 916,10 932,40" /><polygon points="925,55 940,25 955,55" />
      <polygon points="250,290 264,262 278,290" /><polygon points="760,295 774,268 788,295" />
    </g>
  </svg>;
}

// Pull down on an element (the header, or the chats when they're at their top): the strip follows your finger,
// stretches a little past open, and springs open or shut when you let go, by how far and how fast you pulled.
export const STRIP = 168;
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
