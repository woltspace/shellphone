// shellphone, our own page. Same room, same look as the classic page, but every piece is ours to change.
import { becomeGuest, needsName, relayKeyMissing, relayRoom, onRelayState, type PipeState } from "./relay";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./Composer";
import { Listening, type Recording } from "./Listening";
import { Message, type Ctx, woltFace, roomWolts } from "./Message";
import { say, send, sendWithProgress, useRoom, type Msg } from "./room";
import { drop, keep, waiting, type Outgoing } from "./outbox";
import { LORE, woltAvatar } from "./sprites";
import { wear, worn } from "./hats";
import { WoltStrip, usePullDown, type Who } from "./WoltStrip";
import { Sidebar } from "./Sidebar";
import { ChatSide } from "./ChatSide";
import { LinkModal, roomInvite } from "./InviteModal";
import { Profile } from "./Profile";
import { UPPER } from "./Sky";
import { AddAgentSheet } from "./AddAgent";
import { ThreadWho } from "./ThreadWho";
import { NewChatSheet } from "./NewChat";
import { Home, chatsByWolt } from "./Home";
import { InboxSheet, ThreadFooter, chatRows, threadColor, threadTitle, threadWallpaper, ThreadHat, nameChats, named, useChatsHome, unread, rootFresh, useSeen } from "./Threads";
import { Menu } from "./Menu";
import { PageViewer } from "./Page";
import { ShareButton } from "./Share";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Inbox, Menu as MenuIcon, Monitor, PanelRight, X } from "lucide-react";
const Desk = lazy(() => import("./Desk"));  // terminals and their library load only on a computer that opens the desk
import { usePush } from "./push";

// iPhone Safari doesn't shrink the page for the keyboard, so size the app to the part of the screen still visible.
function useFit() {
  useEffect(() => {
    // the keyboard is only up while a text box has focus; otherwise the whole screen is ours (iOS sometimes misses the
    // resize when the keyboard goes away and leaves its height empty, so don't trust the last size then)
    const typing = () => !!document.activeElement?.matches("textarea, input:not([type=file]), [contenteditable]");
    const fit = () => {
      document.documentElement.style.setProperty("--vh", window.visualViewport && typing() ? Math.round(visualViewport!.height) + "px" : "100dvh");
      window.scrollTo(0, 0);
    };
    const settle = () => { fit(); for (const ms of [100, 350, 700]) setTimeout(fit, ms); };  // again as the keyboard finishes moving
    const pin = () => window.scrollTo(0, 0);  // Safari slides the page while you type: put it back, without resizing anything
    fit();
    visualViewport?.addEventListener("resize", fit);
    visualViewport?.addEventListener("scroll", pin);
    document.addEventListener("focusin", settle); document.addEventListener("focusout", settle); document.addEventListener("visibilitychange", settle);
    return () => {
      visualViewport?.removeEventListener("resize", fit); visualViewport?.removeEventListener("scroll", pin);
      document.removeEventListener("focusin", settle); document.removeEventListener("focusout", settle); document.removeEventListener("visibilitychange", settle);
    };
  }, []);
}

// Who's working: a fixed one-line slot under the last message, wolts side by side, chewing on a line of lore.
// A wolt its connector can't reach shows that instead: its messages wait, in order, and arrive once it's back.
function Gnaw({ ctx, working, away = {}, place }: { ctx: Ctx; working: Record<string, unknown>; away?: Record<string, number>; place: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 2400); return () => clearInterval(t); }, []);
  const here = ctx.busy ? ctx.busy(place) : ctx.wolts.filter((w) => working[w.wolt]);  // working in this feed only
  const on = ctx.wolts.filter((w) => here.includes(w) || away[w.wolt]);
  return <div className="flex items-center gap-1.5 h-[38px] px-3 pb-2 overflow-hidden">
    {on.map((w) => { const lines = LORE[w.creature] || LORE.beaver;
      return <div key={w.wolt} className="gnaw-row flex-[0_1_auto] min-w-0 flex items-center gap-1.5 pl-[3px] pr-[9px] py-[3px] bg-[#fffdf6ee] border border-line rounded-lg font-mono font-semibold text-xs whitespace-nowrap">
        <img src={woltFace(w.wolt, w.creature)} alt="" className="gnaw-img pixel flex-none w-6 h-6" />
        {away[w.wolt] ? <span className="overflow-hidden text-ellipsis text-dim">can't reach {w.wolt} · messages wait</span>
          : <span key={tick} className="lore new overflow-hidden text-ellipsis">{w.wolt}: {lines[(tick + w.wolt.length) % lines.length]}</span>}
      </div>; })}
  </div>;
}

// Pictures full screen, like WhatsApp: swipe left and right through the ones sent together ("2 / 3" up top).
// Always a way out: the ✕ (dark, so it shows on any picture), a tap, a swipe down, or Escape. A double tap zooms in.
type Zoomer = { toggle: (x: number, y: number) => void; reset: () => void };

// One picture you can pinch, pan and double-tap, like any picture on the web. The page itself never zooms (the room
// would jump around), so the viewer does it: two fingers zoom around where they are, one finger moves a zoomed picture.
function Zoomable({ src, bind, onZoom }: { src: string; bind: (z: Zoomer | null) => void; onZoom: (on: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null), img = useRef<HTMLImageElement>(null);
  const s = useRef({ k: 1, x: 0, y: 0 });
  const g = useRef<{ d: number; k: number; mx: number; my: number; x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const said = useRef(onZoom); said.current = onZoom;
  const center = () => { const r = box.current!.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, W: r.width, H: r.height }; };
  const draw = (anim = false) => {
    const el = img.current; if (!el) return;
    el.style.transition = anim ? "transform .22s cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = `translate(${s.current.x}px, ${s.current.y}px) scale(${s.current.k})`;
    said.current(s.current.k > 1.02);
  };
  // zoom to k around the screen point (fx, fy), keeping what's under it in place
  const zoomAt = (k: number, fx: number, fy: number, from = s.current) => {
    const { cx, cy } = center(); k = Math.min(6, Math.max(1, k));
    const ux = (fx - cx - from.x) / from.k, uy = (fy - cy - from.y) / from.k;
    s.current = { k, x: fx - cx - k * ux, y: fy - cy - k * uy };
  };
  // a zoomed picture can't be pushed off screen; back at 1x it sits in the middle again
  const settle = () => {
    const el = img.current; if (!el) return;
    const { W, H } = center(), { k } = s.current;
    if (k < 1.05) { s.current = { k: 1, x: 0, y: 0 }; return draw(true); }
    const mx = Math.max(0, (el.offsetWidth * k - W) / 2), my = Math.max(0, (el.offsetHeight * k - H) / 2);
    s.current.x = Math.max(-mx, Math.min(mx, s.current.x)); s.current.y = Math.max(-my, Math.min(my, s.current.y));
    draw(true);
  };
  useEffect(() => {
    bind({
      toggle: (x, y) => { if (s.current.k > 1.02) s.current = { k: 1, x: 0, y: 0 }; else zoomAt(2.5, x, y); settle(); },
      reset: () => { s.current = { k: 1, x: 0, y: 0 }; draw(); },
    });
    return () => bind(null);
  }, []);
  useEffect(() => {
    const el = box.current!;
    const pts = (e: TouchEvent) => [...e.touches].map((t) => ({ x: t.clientX, y: t.clientY }));
    const start = (e: TouchEvent) => {
      const p = pts(e);
      if (p.length === 2) { e.preventDefault(); g.current = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), k: s.current.k, mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2, x: s.current.x, y: s.current.y }; }
      last.current = p.length === 1 ? p[0] : null;
    };
    const move = (e: TouchEvent) => {
      const p = pts(e);
      if (p.length === 2 && g.current) {
        e.preventDefault();
        const G = g.current, d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
        zoomAt(G.k * d / G.d, G.mx, G.my, { k: G.k, x: G.x, y: G.y });
        s.current.x += mx - G.mx; s.current.y += my - G.my;  // the fingers carry the picture as they go
        draw();
      } else if (p.length === 1 && s.current.k > 1.02 && last.current) {
        e.preventDefault();  // zoomed in: one finger moves the picture, not the carousel
        s.current.x += p[0].x - last.current.x; s.current.y += p[0].y - last.current.y; last.current = p[0];
        draw();
      }
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) g.current = null;
      last.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      if (!e.touches.length) settle();
    };
    // a trackpad pinch arrives as a wheel with ctrl held; a plain wheel moves a zoomed picture
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) { e.preventDefault(); zoomAt(s.current.k * Math.exp(-e.deltaY / 100), e.clientX, e.clientY); draw(); clearTimeout(wt); wt = window.setTimeout(settle, 150); }
      else if (s.current.k > 1.02) { e.preventDefault(); s.current.x -= e.deltaX; s.current.y -= e.deltaY; draw(); clearTimeout(wt); wt = window.setTimeout(settle, 150); }
    };
    let wt = 0;
    const no = (e: Event) => e.preventDefault();  // Safari's own page pinch
    el.addEventListener("touchstart", start, { passive: false }); el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end); el.addEventListener("touchcancel", end); el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", no); el.addEventListener("gesturechange", no);
    return () => {
      el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end); el.removeEventListener("wheel", wheel); el.removeEventListener("gesturestart", no); el.removeEventListener("gesturechange", no);
    };
  }, []);
  return <div ref={box} className="flex-none w-full h-full grid place-items-center snap-center snap-always overflow-hidden">
    <img ref={img} src={src} alt="" draggable={false} className="max-w-[94vw] max-h-[86dvh] object-contain rounded-md will-change-transform select-none" style={{ transformOrigin: "50% 50%" }} /></div>;
}

function Viewer({ urls, names, at, close }: { urls: string[]; names?: string[]; at: number; close: () => void }) {
  const [zoomed, setZoomed] = useState(false), [i, setI] = useState(at);
  const strip = useRef<HTMLDivElement>(null), tap = useRef(0), lastTap = useRef(0), from = useRef<{ x: number; y: number } | null>(null);
  const zoomers = useRef<Record<number, Zoomer | null>>({});
  const go = (to: number) => { const s = strip.current; if (s) s.scrollTo({ left: Math.max(0, Math.min(urls.length - 1, to)) * s.clientWidth, behavior: "smooth" }); };
  useLayoutEffect(() => { const s = strip.current; if (s) s.scrollLeft = i * s.clientWidth; }, []);  // opens on the picture you tapped
  useEffect(() => { for (const [j, z] of Object.entries(zoomers.current)) if (+j !== i) z?.reset(); }, [i]);  // the others back to 1x
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") go(i + 1); if (e.key === "ArrowLeft") go(i - 1); };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [i]);
  const btn = "fixed w-11 h-11 grid place-items-center rounded-full bg-[#000c] border-2 border-white text-white text-xl cursor-pointer shadow-[0_2px_8px_#0008]";
  return <div className="fixed inset-0 z-[3000] bg-[#000e]"
    // one tap closes (unless zoomed in), two quick taps zoom in where you tapped, or back out
    onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; clearTimeout(tap.current);
      if (Date.now() - lastTap.current < 300) { lastTap.current = 0; zoomers.current[i]?.toggle(e.clientX, e.clientY); return; }
      lastTap.current = Date.now(); if (!zoomed) tap.current = window.setTimeout(close, 300); }}
    onTouchStart={(e) => { from.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
    onTouchEnd={(e) => { const f = from.current, t = e.changedTouches[0]; from.current = null;
      if (f && !zoomed && t.clientY - f.y > 80 && Math.abs(t.clientX - f.x) < 60) close(); }}>
    <div ref={strip} onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
      className={`w-full h-full flex ${zoomed ? "overflow-hidden" : "overflow-x-auto"} snap-x snap-mandatory overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      style={{ touchAction: zoomed ? "none" : "pan-x" }}>
      {urls.map((u, j) => <Zoomable key={u} src={u} bind={(z) => { zoomers.current[j] = z; }} onZoom={setZoomed} />)}
    </div>
    {urls.length > 1 && <>
      <div className="fixed top-[calc(22px+env(safe-area-inset-top))] left-0 right-0 text-center font-mono text-sm text-white pointer-events-none">{i + 1} / {urls.length}</div>
      <div className="fixed bottom-[calc(18px+env(safe-area-inset-bottom))] left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
        {urls.map((u, j) => <i key={u} className={`w-1.5 h-1.5 rounded-full ${j === i ? "bg-white" : "bg-[#fff6]"}`} />)}</div>
      {!zoomed && i > 0 && <button type="button" aria-label="Previous" onClick={() => go(i - 1)} className={btn + " left-3 top-1/2 -translate-y-1/2 hidden sm:grid"}>‹</button>}
      {!zoomed && i < urls.length - 1 && <button type="button" aria-label="Next" onClick={() => go(i + 1)} className={btn + " right-3 top-1/2 -translate-y-1/2 hidden sm:grid"}>›</button>}
    </>}
    <button type="button" aria-label="Close" onClick={close} className={btn + " top-[calc(12px+env(safe-area-inset-top))] right-3"}>✕</button>
    {!zoomed && <ShareButton key={urls[i]} url={urls[i]} name={names?.[i]} className="fixed top-[calc(12px+env(safe-area-inset-top))] left-3 h-11 min-w-11 bg-[#000c] border-2 border-white text-white shadow-[0_2px_8px_#0008]" />}
  </div>;
}

// Humans mode: one stretch of agents' messages. Folded, it is a thin rule across the chat (who, how many, a chevron);
// open, the same rule sits above it and a second one closes it. The stretch slides shut under its rule.
function AgentRun({ id, msgs, ctx, on, shown, lit, toggle, children }: { id: string; msgs: Msg[]; ctx: Ctx; on: boolean; shown: boolean; lit: boolean; toggle: (at: Element) => void; children: React.ReactNode }) {
  const names = [...new Set(msgs.map((m) => m.wolt).filter(Boolean))] as string[], n = msgs.length;
  const label = !names.length ? "the room" : names.length < 3 ? names.join(" and ") : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  const line = `flex-1 h-px transition-colors duration-700 ${lit ? "bg-acc" : "bg-line"}`;
  return <div data-run={id} data-shown={shown ? "" : undefined}>
    {on && <div data-rule className="px-3 md:px-5 mt-2.5">
      <button type="button" data-tap aria-expanded={shown} aria-label={`${shown ? "Hide" : "Show"} ${n} ${n === 1 ? "message" : "messages"} from ${label}`} onClick={(e) => toggle(e.currentTarget.parentElement!)}
        className="w-full flex items-center gap-2 border-0 bg-transparent p-0 py-0.5 cursor-pointer text-[12.5px] text-dim">
        <i className={line} />
        <span className="flex flex-none">{names.slice(0, 3).map((w, i) => <img key={w} src={woltFace(w, ctx.wolts.find((x) => x.wolt === w)?.creature)} alt="" className={`pixel w-5 h-5 rounded-full bg-panel ring-1 ring-line ${i ? "-ml-1.5" : ""}`} />)}</span>
        <span className={`flex-none transition-colors duration-700 ${lit ? "text-acc" : ""}`}>{label} · <b className={`font-semibold ${lit ? "" : "text-ink"}`}>{n} {n === 1 ? "message" : "messages"}</b></span>
        <ChevronRight size={16} className={`flex-none -ml-1 text-acc transition-transform duration-300 ${shown ? "rotate-90" : ""}`} />
        <i className={line} />
      </button></div>}
    <div className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none" style={{ gridTemplateRows: shown ? "1fr" : "0fr", opacity: shown ? 1 : 0 }}>
      <div className="min-h-0 overflow-hidden" inert={!shown}>
        {children}
        {on && <div className="px-3 md:px-5 mt-2">
          <button type="button" data-tap aria-label={`Hide these ${n} messages`} onClick={(e) => toggle(e.currentTarget)}
            className="w-full flex items-center gap-2 border-0 bg-transparent p-0 py-0.5 cursor-pointer text-[12px] text-dim">
            <i className="flex-1 h-px bg-line" /><span className="flex-none">end of {n} agent {n === 1 ? "message" : "messages"}</span><ChevronUp size={16} className="flex-none -ml-1 text-acc" /><i className="flex-1 h-px bg-line" />
          </button></div>}
      </div>
    </div>
  </div>;
}

// A list of messages that stays at the bottom while you're there, and leaves you alone if you scrolled up to read.
// Used for the main chat and for a thread alike.
function Feed({ list, ctx, working, away, replies, seen, open, divider, stick, place = "", humans, flip }: {
  list: Msg[]; ctx: Ctx; working: Record<string, unknown>; away?: Record<string, number>; replies?: Map<string, Msg[]>; seen?: Record<string, number>; place?: string;
  open?: (id: string) => void; divider?: number; stick: React.MutableRefObject<(on?: boolean) => void>;
  humans?: boolean; flip?: React.MutableRefObject<() => void>;  // humans: fold each stretch of agents' messages under a rule; flip: called just before it changes, to keep your place
}) {
  // The chat is laid out from the bottom up (column-reverse), like chat apps do: the browser itself keeps the newest
  // message in place while pictures, players and cards load, and while new messages arrive. No pinning code to fight it.
  // scrollTop is 0 at the bottom and goes negative as you read back up.
  const scroller = useRef<HTMLDivElement>(null);
  const [far, setFar] = useState(false);  // scrolled well up: show the jump-to-the-bottom button
  const toBottom = (smooth = true) => scroller.current?.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  stick.current = (on = true) => { if (on) toBottom(false); };  // sending, or coming back after a while: the newest
  const pad = useRef<HTMLDivElement>(null);  // quiet space under the newest message, only while it is needed to keep your place
  const following = useRef(false);
  const onScroll = () => {
    const s = scroller.current!, room = pad.current?.offsetHeight || 0;
    setFar(-s.scrollTop > 600);
    // the quiet space goes away once you have scrolled it out of sight: nothing on screen moves when it does
    if (room && !following.current && -s.scrollTop >= room) { pad.current!.style.height = "0px"; s.scrollTop += room; }
  };
  // Humans: a chat's own view folds every stretch of agents' messages (in the lobby a tap opens the chat, nothing folds there)
  const fold = !!humans && !open;
  const [peek, setPeek] = useState<Set<string>>(() => new Set());  // the stretches opened one by one while Humans is on
  const [lit, setLit] = useState("");  // the rule that just closed lights up for a moment, so the eye lands on it
  const litTimer = useRef(0);
  useEffect(() => () => clearTimeout(litTimer.current), []);
  useEffect(() => setPeek(new Set()), [fold]);
  // Keeping your place. The chat is anchored at its bottom, so whatever folds or opens below what you are reading moves it.
  // hold(): remember the first thing on screen and where it is; follow(): for as long as the slide lasts, scroll so it stays there.
  const held = useRef<{ el: Element; run: Element | null; want: number; glued: boolean; rule: boolean; agent: boolean } | null>(null);
  const hold = (near?: Element | null) => {
    const s = scroller.current; if (!s) return;
    const top = s.getBoundingClientRect().top;
    const seen = (e: Element) => e.hasAttribute("data-rule") || !e.closest("[data-run]") || e.closest("[data-run]")!.hasAttribute("data-shown");
    const el = near || [...s.querySelectorAll("[data-mid],[data-rule]")].find((e) => seen(e) && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().bottom > top + 8);
    held.current = el ? { el, run: el.closest("[data-run]"), want: el.getBoundingClientRect().top,  // its stretch is noted now: a rule is gone from the page once Humans is off
      glued: !near && s.scrollTop > -24 && !pad.current?.offsetHeight, rule: el.hasAttribute("data-rule"), agent: !!el.closest("[data-run]") && !el.hasAttribute("data-rule") } : null;
  };
  const follow = (swap: boolean) => {
    const s = scroller.current, h = held.current; held.current = null;
    if (!s || !h) return;
    const top = s.getBoundingClientRect().top, run = h.run;
    // the switch itself: an agent's message gives its place to its rule, and a rule (gone when Humans is off) to its first message
    let el: Element | null = h.el, want = h.want;
    if (swap && run && (h.agent || h.rule)) { el = run.querySelector(fold ? "[data-rule]" : "[data-mid]"); want = Math.max(want, top + 6); }
    following.current = true; s.style.overflowAnchor = "none";  // the browser's own scroll anchoring would pull against this
    if (pad.current) pad.current.style.height = "0px";
    const until = performance.now() + 380;
    const step = () => {
      if (h.glued) s.scrollTop = 0;
      else if (el?.isConnected) {
        const d = el.getBoundingClientRect().top - want;
        if (d > 0 && s.scrollTop + d > 0 && pad.current) pad.current.style.height = pad.current.offsetHeight + s.scrollTop + d + "px";  // not enough chat left below: make room
        s.scrollTop += el.getBoundingClientRect().top - want;
      }
      if (performance.now() < until) requestAnimationFrame(step); else { following.current = false; s.style.overflowAnchor = ""; }
    };
    step();
  };
  if (flip) flip.current = () => hold();
  useLayoutEffect(() => follow(true), [fold]);
  // opening a chat whose newest message is taller than the screen (a slide, a long answer): start at its top, not its bottom
  const topped = useRef("");  // once per chat opened, as soon as its messages are in
  useEffect(() => {
    const s = scroller.current; if (!s || !place || !list.length || topped.current === place) return;
    topped.current = place;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const els = s.querySelectorAll("[data-mid]"), el = els[els.length - 1]; if (!el || s.scrollTop < -24) return;
      const r = el.getBoundingClientRect(), box = s.getBoundingClientRect();
      if (r.height > box.height - 16) s.scrollTop += r.top - box.top - 8;
    }));
  }, [place, list.length]);
  const toggleRun = (key: string, at?: Element | null) => {
    const s = scroller.current, rule = s?.querySelector(`[data-run="${key}"] [data-rule]`) || null;
    // tapped on the rule: it stays where it is. Tapped lower down (a bubble, the end line) with the rule off screen: bring the rule to the top
    const above = !!rule && !!s && rule.getBoundingClientRect().top < s.getBoundingClientRect().top;
    hold(rule);
    if (held.current && above && at !== rule) held.current.want = s!.getBoundingClientRect().top + 48;
    const closing = peek.has(key);
    setPeek((was) => { const now = new Set(was); if (!now.delete(key)) now.add(key); return now; });
    if (closing) { setLit(key); clearTimeout(litTimer.current); litTimer.current = window.setTimeout(() => setLit(""), 80); }
    requestAnimationFrame(() => follow(false));
  };
  // which stretch each agent message belongs to: a stretch is named after its first message, so it keeps its name as it grows
  const runOf = new Map<string, string>(), runs = new Map<string, Msg[]>();
  if (!open) { let key = ""; for (const m of list) { if (m.kind === "human") { key = ""; continue; } if (!key) key = m.cid || m.id; runOf.set(m.cid || m.id, key); runs.set(key, [...(runs.get(key) || []), m]); } }
  let lastDay = "", lastWho = "";
  return <div className="flex-1 min-h-0 relative flex flex-col"><div ref={scroller} data-feed onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain flex flex-col-reverse"><div className="pt-1">
    {list.length === 0 && <p className="text-center text-dim font-mono text-xs mt-10 px-6">Nobody has said anything yet. Tag a wolt with @ to bring it in.</p>}
    {(() => { const rows = list.map((m, i) => {
      const d = new Date(m.at * 1000), day = d.toLocaleDateString([], { day: "numeric", month: "long" });
      const who = m.kind === "human" ? m.email! : "wolt:" + m.wolt, newDay = day !== lastDay;
      const thread = replies?.get(m.id) || [];
      const run = newDay || who !== lastWho;
      lastDay = day; lastWho = thread.length ? "" : who;  // a thread breaks the run, so the next bubble shows its name
      return { m, node: <div key={m.cid || m.id} data-mid={m.id}>
        {newDay && <div className="text-center my-3"><span className="font-mono text-[11px] uppercase text-dim bg-panel border border-line rounded-lg px-2.5 py-1">{day}</span></div>}
        {/* like Slack: tap a message to open its thread (links, players, pictures and a voice note's words keep their own tap) */}
        <div className={open && !m.pending && !m.failed ? "cursor-pointer active:opacity-60 transition-opacity" : fold && runOf.has(m.cid || m.id) ? "cursor-pointer" : ""}
          onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,audio,video,img,[data-tap]") || String(window.getSelection() || "")) return;
            if (open && !m.pending && !m.failed) open(m.id);
            else if (fold && runOf.has(m.cid || m.id)) toggleRun(runOf.get(m.cid || m.id)!, e.currentTarget); }}>
          <Message m={m} ctx={ctx} firstOfRun={run} wallpaper={thread.length > 0 && open ? { ...threadWallpaper(m.id), borderColor: threadColor(m.id) + "80" } : undefined} footer={thread.length > 0 && open ?
            <ThreadFooter id={m.id} list={thread} fresh={unread(thread, seen?.[m.id], ctx.me)} ctx={ctx} onOpen={() => open(m.id)} busy={ctx.busy?.(m.id)} /> : undefined} />
        </div>
        {divider !== undefined && i === 0 && <div className="flex items-center gap-2.5 px-3.5 my-3 font-mono text-[11px] text-dim">
          <span>{divider} {divider === 1 ? "reply" : "replies"}</span><span className="flex-1 h-px bg-line" /></div>}
      </div> };
    });
      // a chat's own view: each stretch of agents' messages sits in one box that can slide shut under its rule
      const out: React.ReactNode[] = [];
      for (let i = 0; i < rows.length; i++) {
        const key = runOf.get(rows[i].m.cid || rows[i].m.id);
        if (!key) { out.push(rows[i].node); continue; }
        const nodes: React.ReactNode[] = [];
        while (i < rows.length && runOf.get(rows[i].m.cid || rows[i].m.id) === key) nodes.push(rows[i++].node);
        i--;
        out.push(<AgentRun key={"run:" + key} id={key} msgs={runs.get(key)!} ctx={ctx} on={fold} shown={!fold || peek.has(key)} lit={lit === key} toggle={(at) => toggleRun(key, at)}>{nodes}</AgentRun>);
      }
      return out; })()}
    <Gnaw ctx={ctx} working={working} away={away} place={place} />
    <div ref={pad} aria-hidden style={{ height: 0 }} />
  </div></div>
    {far && <button type="button" aria-label="Jump to the newest" onClick={() => toBottom()}
      className="absolute right-3 bottom-3 z-10 w-11 h-11 rounded-full bg-panel border border-line text-acc grid place-items-center shadow-[0_2px_10px_#18100a2e] cursor-pointer animate-[fadein_.15s_ease-out]">
      <ChevronDown size={22} /></button>}
  </div>;
}
// Swipes move the screen itself, frame by frame, without redrawing the chat: smooth under your finger.
// On release they glide the rest of the way, and a quick flick counts even if it was short.
type Pt = { x: number; y: number; t: number; dx: number; dir?: "x" | "y" };
const track = (s: Pt, e: React.TouchEvent) => {
  const t = e.touches[0];
  if (!s.dir && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 8) s.dir = Math.abs(t.clientX - s.x) > Math.abs(t.clientY - s.y) ? "x" : "y";
  const v = (t.clientX - s.x - s.dx) / Math.max(1, performance.now() - s.t);
  s.dx = t.clientX - s.x; s.t = performance.now();
  return v;  // px per ms, + to the right
};
const glide = (el: HTMLElement | null, transform: string, shadow = "") => {
  if (!el) return;
  el.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)"; el.style.transform = transform; el.style.boxShadow = shadow;
};

// Leave a screen like going back on iPhone: drag from the left edge to the right. back() does the same slide for the ‹ button.
// A thread pops up over the main chat, like the voice-note sheet: you're still in the room, just looking closer.
// Drag the handle down, tap above it, or tap ✕ to drop back.
function ThreadSheet({ docked, side, back, startFull, chat, name, onRename, color, wallpaper, title, count, close, who, extra, children }: { docked?: boolean; back?: boolean; side?: { on: boolean; flip: () => void }; startFull?: boolean; chat?: boolean; name?: string; onRename?: (name: string) => void; color: string; wallpaper?: React.CSSProperties; title: React.ReactNode; count: number; close: () => void; who?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  const [drag, setDrag] = useState<{ y: number; dy: number; t: number } | null>(null), [full, setFull] = useState(!!startFull);
  const [editing, setEditing] = useState(false);  // renaming the chat: its title becomes a box
  const [leaving, setLeaving] = useState(false);  // closing: the scrim fades and the sheet slides away, then it's gone
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);  // gone before the fade ended (another thread took its place): no late close
  const bye = () => { if (leaving) return; setLeaving(true); timer.current = window.setTimeout(close, 220); };
  // the handle on top and the strip down the right edge both move the sheet with your finger: far enough down, it closes
  const grip = {
    onTouchStart: (e: React.TouchEvent) => setDrag({ y: e.touches[0].clientY, dy: 0, t: performance.now() }),
    onTouchMove: (e: React.TouchEvent) => drag && setDrag({ ...drag, dy: e.touches[0].clientY - drag.y }),
    // a chat is one screen: down far enough, or a quick flick down, and it slides away from where your finger left it.
    // a thread over the room keeps its tray: up far enough: full screen; down from full screen: back to the tray; down from the tray: closed
    onTouchEnd: () => {
      if (drag) {
        const flick = drag.dy > 30 && drag.dy / Math.max(1, performance.now() - drag.t) > 0.5;
        if (chat) { if (drag.dy > 120 || flick) bye(); }
        else if (drag.dy < -60) setFull(true); else if (drag.dy > 80) { if (full) setFull(false); else bye(); }
      }
      setDrag(null);
    },
    onClick: (e: React.MouseEvent) => { if ((e.currentTarget as HTMLElement).dataset.side !== undefined) bye(); },  // a plain tap on a side edge: back to the chat
  };
  if (docked) return <div role="region" aria-label="Chat" style={wallpaper} className="h-full flex flex-col overflow-hidden bg-paper">
    {/* one slim line, like Slack: the chat's colour dot and name, who's in it, the side pane switch */}
    <div className={`group flex-none min-h-12 pt-[env(safe-area-inset-top)] flex items-center gap-2 ${back ? "pl-1" : "pl-5"} pr-2 border-b border-line bg-paper`}>
      {back && <button type="button" aria-label="Back to the chats" onClick={close} className="flex-none w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={24} /></button>}
      <i className="flex-none w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1 flex items-center gap-1.5">
        {editing ? <input autoFocus defaultValue={name} maxLength={80} aria-label="Chat name"
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = name || ""; e.currentTarget.blur(); } }}
          onBlur={(e) => { setEditing(false); const v = e.currentTarget.value.trim(); if (v !== (name || "")) onRename?.(v); }}
          className="w-full max-w-[520px] -ml-1.5 font-semibold text-[15px] text-ink rounded-md border border-acc bg-white px-1.5 py-0.5 outline-none" />
          : <><button type="button" disabled={!onRename} title={onRename ? "Click to rename" : undefined} onClick={() => setEditing(true)}
              className="min-w-0 truncate -ml-1.5 px-1.5 py-0.5 rounded-md border border-transparent bg-transparent text-left font-semibold text-[15px] text-ink cursor-text enabled:hover:bg-white enabled:hover:border-line disabled:cursor-default transition-colors">{name}</button>
            <span className="flex-none text-[12px] text-dim max-sm:hidden">· {count + 1} {count ? "messages" : "message"}</span></>}
      </div>
      {extra && <span className="flex-none max-sm:hidden">{extra}</span>}
      {who}
      {side && <button type="button" aria-label={side.on ? "Hide the side pane" : "Show the side pane"} title="Who's in it, pages, files" onClick={side.flip}
        className={`flex-none w-8 h-8 grid place-items-center border-0 bg-transparent cursor-pointer rounded-md hover:bg-[#18100a0d] ${side.on ? "text-ink" : "text-dim"}`}><PanelRight size={17} /></button>}
    </div>
    {/* on a phone the top line is full (back, name, faces, side pane): the switch gets a slim line of its own under it */}
    {extra && <div className="sm:hidden flex-none flex items-center justify-end px-2.5 py-1.5 border-b border-line bg-paper">{extra}</div>}
    {children}
  </div>;
  return <div className="absolute inset-0 z-[1580]">
    <div onClick={bye} className={`absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out] transition-opacity duration-200 ${leaving ? "opacity-0" : ""}`} />
    <div role="dialog" aria-label="Thread" onClick={(e) => {  // like iMessage: a tap on the see-through space beside the messages drops you back to the chat
      const t = e.target as HTMLElement;
      if (t.closest("[data-bubble],[data-composer],button,a,input,textarea,img,audio,video,[role=button],[data-tap]") || !t.closest("[data-feed]")) return;
      if (String(window.getSelection() || "")) return;  // selecting words, not leaving
      bye();
    }} style={{ ...wallpaper, transform: leaving ? "translateY(100%)" : drag ? `translateY(${Math.max(full ? 0 : -96, drag.dy)}px)` : undefined, opacity: leaving && !chat ? 0 : undefined,
      transition: drag ? "none" : chat ? "transform .22s cubic-bezier(.2,.8,.2,1)" : "top .25s cubic-bezier(.2,.8,.2,1), transform .22s cubic-bezier(.4,0,1,1), opacity .22s ease-in" }}
      className={`absolute inset-x-0 bottom-0 ${full ? "top-[env(safe-area-inset-top)]" : "top-[calc(env(safe-area-inset-top)+96px)]"} max-w-[640px] mx-auto ${chat ? "bg-paper" : "bg-[#f5f1e88c] backdrop-blur-sm"} rounded-t-[18px] flex flex-col overflow-hidden shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]`}>
      <div className="flex-none touch-none bg-[#fffdf680] border-b border-line" style={{ boxShadow: `inset 0 3px 0 ${color}` }}
        {...grip}>
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mt-2" />
        <div className={`flex items-center gap-2 ${chat ? "pl-1" : "pl-4"} pr-1.5 pb-1.5`}>
          {chat && <button type="button" aria-label="Back to the chats" onClick={bye} className="flex-none w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={24} /></button>}
          <div className="min-w-0 flex-1">
            {editing ? <input autoFocus defaultValue={name} maxLength={80} aria-label="Chat name"
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = name || ""; e.currentTarget.blur(); } }}
              onBlur={(e) => { setEditing(false); const v = e.currentTarget.value.trim(); if (v !== (name || "")) onRename?.(v); }}
              className="w-full font-mono font-semibold text-[15px] rounded-md border-2 border-acc bg-white px-1.5 py-0.5 outline-none" style={{ color }} />
              : <div className={`font-mono font-semibold truncate ${onRename ? "cursor-text" : ""}`} style={{ color }} title={onRename ? "Tap to rename" : undefined}
                onClick={(e) => { if (onRename) { e.stopPropagation(); setEditing(true); } }}>{title}{onRename && <span className="ml-1.5 text-[12px] text-dim font-normal">✎</span>}</div>}
            <div className="font-mono text-[11px] text-dim">{chat ? `chat · ${count + 1} ${count ? "messages" : "message"}` : `thread · ${count} ${count === 1 ? "reply" : "replies"}`}</div>
          </div>
          {extra}{who}
          {!chat && <button type="button" aria-label="Close the thread" onClick={bye} className="flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={20} /></button>}
        </div>
      </div>
      {children}
      <div {...grip} data-side aria-hidden className="absolute right-0 top-14 bottom-24 w-6 touch-none z-10 flex justify-center">
        <i className="mt-[30%] w-[4px] h-14 rounded-full bg-line" /></div>
      <div {...grip} data-side aria-hidden className="absolute left-0 top-14 bottom-24 w-6 touch-none z-10 flex justify-center">
        <i className="mt-[30%] w-[4px] h-14 rounded-full bg-line" /></div>
    </div>
  </div>;
}

function useSwipeBack(close: () => void) {
  const el = useRef<HTMLDivElement>(null), s = useRef<Pt | null>(null), v = useRef(0);
  const back = () => { glide(el.current, "translateX(100%)"); setTimeout(close, 200); };
  return {
    el, back,
    handlers: {
      // from anywhere on the left half (not only the very edge, which the phone's browser keeps for its own back swipe),
      // but not from a box you type in or something that scrolls sideways itself (code, a row of pictures)
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0], from = e.target as HTMLElement;
        const own = from.closest?.("textarea, input, pre, .shp-code, [data-swipe-own]");
        s.current = !own && t.clientX < window.innerWidth * 0.5 ? { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0 } : null; v.current = 0;
      },
      onTouchMove: (e: React.TouchEvent) => {
        const p = s.current; if (!p) return;
        v.current = track(p, e);
        if (p.dir === "y") { s.current = null; return; }  // that's a scroll
        const d = el.current; if (!d || p.dir !== "x") return;
        d.style.transition = "none"; d.style.transform = `translateX(${Math.max(0, p.dx)}px)`; d.style.boxShadow = "-8px 0 24px #18100a22";
      },
      onTouchEnd: () => {
        const p = s.current; s.current = null; if (!p || p.dir !== "x") return;
        if (p.dx > 70 || (p.dx > 25 && v.current > 0.3)) back(); else glide(el.current, "translateX(0)");
      },
    },
  };
}

// The menu, like Slack's: drag it out from the left edge of the main screen, push it back to the left to close.
function useMenuSwipe(menu: boolean, setMenu: (open: boolean) => void, canOpen: boolean) {
  const panel = useRef<HTMLElement>(null), scrim = useRef<HTMLDivElement>(null), s = useRef<(Pt & { open: boolean }) | null>(null), v = useRef(0);
  const width = () => panel.current?.offsetWidth || 300;
  const place = (dx: number) => {  // dx: how far the panel is out, 0 (shut) to its width (open)
    const p = panel.current, c = scrim.current; if (!p || !c) return;
    p.style.transition = "none"; p.style.transform = `translateX(${dx - width()}px)`;
    c.style.transition = "none"; c.style.opacity = String(dx / width()); c.style.pointerEvents = "none";
  };
  const release = () => { for (const e of [panel.current, scrim.current]) if (e) { e.style.transition = ""; e.style.transform = ""; e.style.opacity = ""; e.style.pointerEvents = ""; } };
  const begin = (e: React.TouchEvent, open: boolean) => { const t = e.touches[0]; s.current = { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0, open }; v.current = 0; };
  const move = (e: React.TouchEvent) => {
    const p = s.current; if (!p) return;
    v.current = track(p, e);
    if (p.dir === "y") { s.current = null; release(); return; }
    if (p.dir === "x") place(Math.min(width(), Math.max(0, (p.open ? 0 : width()) + p.dx)));
  };
  const end = () => {
    const p = s.current; s.current = null; if (!p || p.dir !== "x") return;
    const open = p.open ? p.dx > 70 || (p.dx > 20 && v.current > 0.4) : !(p.dx < -70 || (p.dx < -20 && v.current < -0.4));
    // glide from where your finger left it, then hand back to the classes, which by then agree
    const p2 = panel.current, c = scrim.current;
    if (p2) { p2.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)"; p2.style.transform = open ? "translateX(0)" : "translateX(-100%)"; }
    if (c) { c.style.transition = "opacity .22s"; c.style.opacity = open ? "1" : "0"; }
    setMenu(open); setTimeout(release, 260);
  };
  return {
    panel, scrim,
    screen: { onTouchStart: (e: React.TouchEvent) => { if (!menu && canOpen && e.touches[0].clientX < 28) begin(e, true); }, onTouchMove: move, onTouchEnd: end },
    // the menu sits inside the screen, so its touches stop here instead of being counted twice
    menu: { onTouchStart: (e: React.TouchEvent) => { e.stopPropagation(); if (menu) begin(e, false); },
      onTouchMove: (e: React.TouchEvent) => { e.stopPropagation(); move(e); }, onTouchEnd: (e: React.TouchEvent) => { e.stopPropagation(); end(); } },
  };
}

// The room's line, in the shell's waves on its icon (drawn over the icon's own, on its 192px grid): green waves going out
// while the room answers, amber and quicker while the page tries again, red and still when it can't reach the room (this
// phone offline, or the room's computer asleep).
function Live({ link }: { link: "live" | "retry" | "down" }) {
  const [color, word, speed] = link === "live" ? ["#2eaa50", "live", "1.1s"] : link === "retry" ? ["#d99a1e", "reconnecting", ".7s"] : ["#c8463a", "offline", ""];
  const still = !speed;
  return <svg role="status" aria-label={`room ${word}`} viewBox="0 0 192 192" className="absolute inset-1 w-10 h-10 overflow-visible pointer-events-none" style={{ ["--wave" as string]: speed }}>
    <title>{`room ${word}`}</title>
    <rect x="24" y="30" width="28" height="19" fill="#f5f1e8" />
    <g transform="translate(43 48) scale(1.9) translate(-38 -47)">
    <g fill={color} className={still ? "" : "wave-out"} opacity={still ? .3 : undefined}>
      <rect x="32" y="33" width="11" height="3" /><rect x="29" y="36" width="3" height="3" /><rect x="44" y="36" width="3" height="3" />
      <rect x="27" y="39" width="2" height="3" /><rect x="47" y="39" width="2" height="3" />
    </g>
    <g fill={color} className={still ? "" : "wave-in"}>
      <rect x="35" y="42" width="6" height="3" /><rect x="32" y="45" width="3" height="2" /><rect x="41" y="45" width="3" height="2" />
    </g>
    </g>
  </svg>;
}

// Through the relay the room lives on its host's computer. When that computer sleeps or the room is closed, say so
// plainly (the pipe keeps trying by itself); a link without its key can't work at all.
function Offline({ missing, state }: { missing: boolean; state: PipeState }) {
  const [title, text] = missing ? ["This link is missing its key", "Open the full link you were sent, including everything after the #."]
    : state === "refused" ? ["This link doesn't open this room", "Its key is wrong or old. Ask whoever sent it for a fresh link."]
    : state === "connecting" ? ["Connecting to the room…", "It runs on its host's computer, sealed through shellphone.woltspace.app."]
    : ["This room is offline", "Its host's computer is asleep, or the room was closed. It comes back here by itself when the room is up again."];
  return <div className="absolute inset-0 z-[1700] bg-paper/95 grid place-items-center px-8 text-center">
    <div>
      <div className="font-mono font-semibold text-acc text-lg mb-2">{title}</div>
      <p className="text-sm text-dim leading-snug mb-4">{text}</p>
      {state === "offline" && !missing && <button type="button" onClick={() => location.reload()} className="font-mono text-sm px-4 py-2 rounded-lg border border-acc text-acc bg-transparent cursor-pointer">Try again now</button>}
    </div>
  </div>;
}

// Until the room's first answer: say so, instead of an empty chat. A failed fetch keeps retrying by itself and says so, with a button.
// (index.html shows the same words before the script has even loaded.)
const WAVES = `<style>.w1{animation:sp-in 0.8s steps(1) infinite}.w2{animation:sp-out 0.8s steps(1) infinite}@media (prefers-reduced-motion:reduce){.w1,.w2{animation:none}}@keyframes sp-in{0%{opacity:.15}20%{opacity:1}85%{opacity:.15}}@keyframes sp-out{0%{opacity:.15}45%{opacity:1}85%{opacity:.15}}</style><rect x="58" y="78" width="74" height="46" fill="#f5f1e8"/><g class="w1" fill="#c4531e"><rect x="87" y="106" width="16" height="8"/><rect x="79" y="114" width="8" height="8"/><rect x="103" y="114" width="8" height="8"/></g><g class="w2" fill="#c4531e"><rect x="79" y="82" width="32" height="8"/><rect x="71" y="90" width="8" height="8"/><rect x="111" y="90" width="8" height="8"/><rect x="63" y="98" width="8" height="8"/><rect x="119" y="98" width="8" height="8"/></g>`;  // the icon's signal arcs, pulsing (same as index.html)
function Opening({ problem }: { problem: string }) {
  return <div className="absolute inset-0 z-[1650] bg-paper grid place-items-center px-8 text-center">
    <div>
      <div className="relative w-[120px] h-[120px] mx-auto mb-3">
        <img src="/icon-512.png" alt="" className="w-full h-full [image-rendering:pixelated]" />
        <svg viewBox="0 0 512 512" className="absolute inset-0 w-full h-full" dangerouslySetInnerHTML={{ __html: WAVES }} />
      </div>
      <div className="font-mono font-semibold text-acc text-lg mb-2">{problem ? "Can't reach the room" : "loading shellphone…"}</div>
      {problem && <><p className="text-sm text-dim leading-snug mb-4">{problem}</p>
        <button type="button" onClick={() => location.reload()} className="font-mono text-sm px-4 py-2 rounded-lg border border-acc text-acc bg-transparent cursor-pointer">Try again now</button></>}
    </div>
  </div>;
}

// Someone who came in with the invite link says who they are, once. The name isn't checked: the room marks them "guest".
function NameFirst({ done }: { done: () => void }) {
  const [name, setName] = useState(""), [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  const go = async () => { if (!name.trim() || busy) return; setBusy(true); const problem = await becomeGuest(name.trim()); setBusy(false); if (problem) setProblem(problem); else done(); };
  return <div className="absolute inset-0 z-[1700] bg-paper grid place-items-center px-8 text-center">
    <form onSubmit={(e) => { e.preventDefault(); go(); }} className="w-full max-w-xs">
      <div className="font-mono font-semibold text-acc text-lg mb-2">&gt; you're invited</div>
      <p className="text-sm text-dim leading-snug mb-4">What should the humans and agents here call you?</p>
      <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="your name"
        className="w-full bg-panel border border-line rounded-[10px] px-3 py-2.5 text-base outline-none focus:shadow-[0_0_0_1px_var(--color-acc)] mb-3" />
      <button type="submit" disabled={!name.trim() || busy} className="w-full font-mono font-semibold text-sm px-4 py-2.5 rounded-lg border-0 bg-acc text-white cursor-pointer disabled:opacity-40">{busy ? "joining…" : "join the room"}</button>
      {problem && <p className="text-xs text-acc mt-3">{problem}</p>}
      <p className="text-xs text-dim mt-4">You'll show as a guest: nobody checked this name.</p>
    </form>
  </div>;
}

export function App() {
  useFit();
  const { state, msgs, setMsgs, error, setError, person, after, link: line } = useRoom();
  wear(state.looks, state.faces);  // every face drawn below wears its hat
  roomWolts.splice(0, roomWolts.length, ...state.members.wolts);  // and each wolt's face is in its own colour
  useMemo(() => nameChats(state.names), [JSON.stringify(state.names || {})]);  // only when the room's names change, so a rename shows before the room confirms it
  const firstState = useRef(state), loading = state === firstState.current;  // nothing from the room yet
  const [naming, setNaming] = useState(needsName);  // an invite link: who are you, first
  const [link, setLink] = useState<PipeState>("open");  // through the relay: is the room's computer there?
  useEffect(() => (relayRoom ? onRelayState(setLink) : undefined), []);
  const [listening, setListening] = useState<AudioContext | null | false>(false);
  const [micBlocked, setMicBlocked] = useState(false);  // the phone said no to the mic: offer to ask again, or reload
  const [viewing, setViewing] = useState<{ urls: string[]; names?: string[]; at: number } | null>(null);
  const [paging, setPaging] = useState("");  // the page open full screen, by id
  // the desk: on a wide screen, your wolts' terminals beside the chat (Desk.tsx). Remembered on this computer.
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1100px)").matches;
  const DESK_BUTTON = false;  // the terminals' button is hidden while the desk is experimental; the desk itself still works (localStorage "desk")
  const pageTab = typeof location !== "undefined" ? decodeURIComponent((location.hash.match(/^#page=([\w-]+)/) || [])[1] || "") : "";
  // a computer screen: the chats on the left, the open chat beside them (the phone keeps its one screen at a time)
  const [roomy, setRoomy] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => { const m = window.matchMedia("(min-width: 900px)"), on = () => setRoomy(m.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on); }, []);
  const [desk, setDeskOn] = useState(() => { try { return wide && localStorage.getItem("desk") === "1"; } catch { return false; } });
  const setDesk = (on: boolean) => { setDeskOn(on); try { localStorage.setItem("desk", on ? "1" : "0"); } catch { /* private mode */ } };
  const [focus, setFocus] = useState<{ wolt: string; at: number } | null>(null);
  // the open chat is in the address (#c=ID), so a reload, or a copied link, brings you back to it
  const [thread, setThread] = useState(() => typeof location !== "undefined" ? (location.hash.match(/^#c=([\w-]+)/) || [])[1] || "" : "");
  const [adding, setAdding] = useState(false);  // the "add an agent" sheet  // the message whose thread is open
  const retryRef = useRef((_cid: string) => {});
  const stickMain = useRef((_on?: boolean) => {}), stickThread = useRef((_on?: boolean) => {});
  // reactions: the room's, with yours shown the moment you tap (until the room's copy says the same)
  const [myReacts, setMyReacts] = useState<Record<string, string>>({});
  const reactions = (id: string) => {
    const room = state.reactions?.[id] || [], me = "p:" + state.me;
    if (!(id in myReacts)) return room;
    const rest = room.filter((r) => r.who !== me);
    return myReacts[id] ? [...rest, { who: me, emoji: myReacts[id] }] : rest;
  };
  useEffect(() => {  // the room caught up: its copy takes over
    setMyReacts((o) => { const n = { ...o }; let changed = false;
      for (const [id, e] of Object.entries(o)) if (((state.reactions?.[id] || []).find((r) => r.who === "p:" + state.me)?.emoji || "") === e) { delete n[id]; changed = true; }
      return changed ? n : o; });
  }, [state.reactions]);
  const react = (id: string, emoji: string) => {
    setMyReacts((o) => ({ ...o, [id]: emoji }));
    send("/api/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, emoji }) })
      .then((r) => { if (!r || !r.ok) { setMyReacts((o) => { const n = { ...o }; delete n[id]; return n; }); setError("Couldn't react: try again"); } });
  };
  const ctx: Ctx = { openWho: (w: string) => setWho(w), me: state.me, person, wolts: state.members.wolts, people: state.members.people, seen: state.seen || {}, all: msgs, view: (urls, at = 0, names) => setViewing({ urls, names, at }), retry: (cid) => retryRef.current(cid), openPage: setPaging, showTerminal: desk ? (wolt: string) => setFocus({ wolt, at: Date.now() }) : undefined, terminals: state.terminals,
    // who's working where ("" the main chat, else a thread); a room that doesn't say where: everywhere, as before
    busy: (place: string) => state.members.wolts.filter((w) => state.working_in ? (state.working_in[w.wolt] || []).includes(place) : !!state.working?.[w.wolt]),
    reactions, myReaction: (id: string) => reactions(id).find((r) => r.who === "p:" + state.me)?.emoji, react };

  // Threads the Matrix way: a reply carries the id of the message its thread hangs off. The main chat shows only the rest.
  const { main, replies } = useMemo(() => {
    const replies = new Map<string, Msg[]>(), main: Msg[] = [];
    // a change to a page posted in the main chat goes under that page's message: it's a chat of its own now
    const pageAt = new Map<string, string>();
    for (const m of msgs) if (m.page && !m.thread) pageAt.set(m.page.id, m.id);
    for (const m of msgs) {
      const under = m.thread || (m.kind === "activity" && m.activity ? pageAt.get(m.activity.page) : undefined);
      if (under) replies.set(under, [...(replies.get(under) || []), m]);
      else main.push(m);
    }
    return { main, replies };
  }, [msgs]);
  const root = thread ? msgs.find((m) => m.id === thread) : undefined;
  const [listOpen, setListOpen] = useState(false);  // the inbox sheet; home is always the main chat
  const [menu, setMenu] = useState(false);
  // everyone, people and wolts, pulled down from the top: on the chats, the app opens with it down, and scrolling folds it away
  const [strip, setStrip] = useState(true);
  const stripEl = useRef<HTMLDivElement>(null), pull = usePullDown(strip, setStrip, stripEl);
  const chatList = useRef<HTMLDivElement>(null);  // on the chats, everyone is the top of the list: scroll up to see them
  const [who, setWho] = useState<Who>("");  // someone's card, opened from the strip
  const open = (id: string) => setThread(id);  // opened from the threads list, back returns to it
  const { seen, mark } = useSeen();
  // an open thread counts as read, including replies that arrive while you're in it
  useEffect(() => { const r = replies.get(thread), first = msgs.find((m) => m.id === thread); const last = r?.length ? r.at(-1) : first; if (thread && last) mark(thread, last.n); }, [thread, replies, msgs]);
  // Home as the chats: no main chat to talk in. Every thread is a chat, and so is every message said in the main chat, by a
  // person or a wolt: it starts one, and the answers go under it. There is no lobby.
  const chatsHome = useChatsHome(), [lobby, setLobby] = useState(false), [starting, setStarting] = useState(false);
  // the sky above the scene stays hidden until you pull down for it: the chats open scrolled just past it
  // (once per time the list appears, as soon as it's tall enough to scroll that far)
  const skyTucked = useRef(false);
  // the sky up there is a peek, not a place: let go (or let a fling come to rest) and home springs back over it
  const touching = useRef(false), springing = useRef(0);
  const tuckSky = () => {  // straight away, with a quick ease-out of our own (the browser's smooth scroll lingers)
    const l = chatList.current; if (!l || touching.current || springing.current || l.scrollTop >= UPPER) return;
    l.style.overflowY = "hidden";  // stops a fling's momentum where it is
    const from = l.scrollTop, t0 = performance.now(), ms = 260;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      l.scrollTop = from + (UPPER - from) * e;
      if (k < 1) springing.current = requestAnimationFrame(step); else { springing.current = 0; l.style.overflowY = ""; }
    };
    springing.current = requestAnimationFrame(step);
  };
  useLayoutEffect(() => {
    const l = chatList.current;
    if (!l) { skyTucked.current = false; return; }
    if (!skyTucked.current && l.scrollHeight - l.clientHeight >= UPPER) { l.scrollTop = UPPER; skyTucked.current = true; }
  });
  const roots = main.filter((m) => replies.has(m.id) || (chatsHome && (m.kind === "human" || m.kind === "wolt")));
  const lobbyList = chatsHome ? main.filter((m) => !roots.includes(m)) : main;
  const [only, setOnly] = useState("");  // a lodge phone: the new chat is a DM with this wolt
  const homeView = state.layout ? <Home layout={state.layout} state={state} ctx={ctx} chats={chatsByWolt(roots, replies, state, seen)} onOpen={open}
    onWolt={(w) => { const dm = chatsByWolt(roots, replies, state, seen).find((c) => c.wolt === w); if (dm) open(dm.id); else { setOnly(w); setStarting(true); } }} /> : null;
  // a chat you just started opens under the name your phone gave it, then follows it to the room's own id
  useEffect(() => { if (!thread || msgs.some((m) => m.id === thread)) return; const real = msgs.find((m) => m.cid === thread); if (real) setThread(real.id); }, [msgs, thread]);
  // a room with no threads yet opens on its chat, not on an empty list (a brand-new room, someone's first)
  const settled = useRef(false);
  const threadsSeen = useRef(false); threadsSeen.current = replies.size > 0;
  useEffect(() => { if (!settled.current && state.me) { settled.current = true; if (!replies.size) setListOpen(false); } }, [state.me]);
  const freshCount = roots.filter((r) => unread(replies.get(r.id) || [], seen[r.id], state.me) || (chatsHome && rootFresh(r, seen, state.me))).length;
  // the main chat counts as read while it's on screen; what arrives while you're in a thread waits in the inbox
  const mainFresh = main.filter((m) => m.n > (seen.main || 0) && !(m.kind === "human" && m.email === state.me));
  useEffect(() => { if (!thread && (!chatsHome || lobby) && main.length) mark("main", main.at(-1)!.n); }, [thread, main, chatsHome, lobby]);
  const inboxCount = freshCount + (chatsHome ? 0 : mainFresh.length);  // on the chats, main-chat messages are chats: counted above
  const hdr = useRef<HTMLElement>(null), [hdrH, setHdrH] = useState(0);
  useLayoutEffect(() => { const el = hdr.current; if (!el) return; const ro = new ResizeObserver(() => setHdrH(el.offsetHeight)); ro.observe(el); return () => ro.disconnect(); }, []);
  // on a phone: from the left edge, a chat slides back to the chat list, and the side pane back to its chat
  const swipe = useSwipeBack(() => setThread("")), sideSwipe = useSwipeBack(() => setPhoneSide(false));

  // Where the app opens. A tapped notification lands on its message: inside its thread if it's a reply, or the main
  // chat scrolled to it. Opening it normally, or coming back after a while, lands home: the threads list.
  const target = useRef<{ m: string; t: string } | null>(null);
  const [landing, setLanding] = useState(0);
  const went = useRef({ m: "", at: 0 });  // the last message landed on, so the same tap arriving two ways lands once
  const goTo = (url: string) => {
    const h = new URLSearchParams(new URL(url, location.href).hash.slice(1));
    if (!h.get("m") || (h.get("m") === went.current.m && Date.now() - went.current.at < 10_000)) return;
    went.current = { m: h.get("m")!, at: Date.now() };
    target.current = { m: h.get("m")!, t: h.get("t") || "" };
    // the address says where we're going until we get there, so a reload on the way (a room update) still lands
    history.replaceState(null, "", location.pathname + "#m=" + encodeURIComponent(h.get("m")!) + (h.get("t") ? "&t=" + encodeURIComponent(h.get("t")!) : ""));
    setMenu(false); setListOpen(false);
    if (target.current.t) open(target.current.t); else setThread("");  // no jump to the bottom: we're going to the message
    setLanding((x) => x + 1);
    const mine = target.current; setTimeout(() => { if (target.current === mine) { target.current = null; history.replaceState(null, "", location.pathname); } }, 8000);  // not here after all: let it go
  };
  // the note a tapped notification leaves behind (see sw.js), read once and only if it's fresh
  const noted = async () => {
    try {
      const c = await caches.open("landing"), key = new URL("landing-note", location.href).href, r = await c.match(key);
      if (!r) return; await c.delete(key);
      const n = await r.json(); if (Date.now() - n.at < 60_000) goTo(n.url);  // a tap already handled the other way is skipped there
    } catch { /* no caches here: the address and the message still work */ }
  };
  useEffect(() => {
    goTo(location.href); noted();
    const fromNote = (e: MessageEvent) => { if (e.data?.type === "open") { goTo(e.data.url); noted(); } };
    navigator.serviceWorker?.addEventListener("message", fromNote);
    let hidden = 0;
    const seen = () => {
      if (document.hidden) { hidden = Date.now(); return; }
      noted();
      if (hidden && Date.now() - hidden > 10 * 60_000 && !target.current) { setThread(""); setListOpen(false); setMenu(false); stickMain.current(); }
    };
    document.addEventListener("visibilitychange", seen);
    return () => { navigator.serviceWorker?.removeEventListener("message", fromNote); document.removeEventListener("visibilitychange", seen); };
  }, []);
  // once that message is on screen, bring it into view and light it up for a moment
  useEffect(() => {
    const t = target.current; if (!t) return;
    const el = [...document.querySelectorAll<HTMLElement>(`[data-mid="${CSS.escape(t.m)}"]`)].at(-1); if (!el) return;
    target.current = null;  // the address keeps the spot until you leave it, so a reload for an update brings you back here
    // after the feeds have done their own scrolling for this render, so "stay at the bottom" doesn't undo it
    (t.t ? stickThread : stickMain).current(false);  // reading back here: stop following the newest
    // and again as the page settles (voice players, cards and pictures above it take their height after a cold start),
    // until you touch or scroll yourself
    let yours = false; const mine = () => { yours = true; };
    for (const ev of ["touchstart", "wheel", "keydown"]) window.addEventListener(ev, mine, { once: true, capture: true });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center" }); el.classList.add("landed"); setTimeout(() => el.classList.remove("landed"), 3000);
      for (const ms of [250, 700, 1500]) setTimeout(() => { if (!yours && el.isConnected) el.scrollIntoView({ block: "center" }); }, ms);
    }));
  }, [msgs, thread, landing]);
  useEffect(() => {
    if (pageTab || /^#(m|page)=/.test(location.hash) && !/^#c=/.test(location.hash)) return;  // a landing link or a page tab keeps its own address
    const want = thread ? `#c=${thread}` : "", base = location.pathname + location.search;
    const inChat = (history.state as { shpChat?: number } | null)?.shpChat;
    // opening a chat is a step in the browser's history, so the phone's own back swipe (or back button) comes back to
    // the list instead of leaving the shell; a chat open since loading gets the list put under it first
    if (thread && !inChat) { history.replaceState(null, "", base); history.pushState({ shpChat: 1 }, "", base + want); }
    else if (!thread && inChat) history.back();
    else if (location.hash !== want) history.replaceState(history.state, "", base + want);
  }, [thread]);
  useEffect(() => {
    const back = () => { if (!/^#(m|page)=/.test(location.hash)) setThread((location.hash.match(/^#c=([\w-]+)/) || [])[1] || ""); };
    addEventListener("popstate", back); return () => removeEventListener("popstate", back);
  }, []);
  // leaving the spot you landed on (back to the list, another thread) clears it from the address
  useEffect(() => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("m") && !target.current && (listOpen || (h.get("t") || "") !== thread)) history.replaceState(null, "", location.pathname);
  }, [thread, listOpen]);

  // the left edge opens the menu, except over a chat open full screen on a phone, where it goes back instead
  const menuSwipe = useMenuSwipe(menu, setMenu, !listOpen && !(thread && chatsHome && !lobby && !roomy));

  // Voice notes play when you tap them, never by themselves; playing one stops any other.
  useEffect(() => {
    const mine = (e: Event) => document.querySelectorAll("audio").forEach((a) => a !== e.target && a.pause());
    document.addEventListener("play", mine, true);
    return () => document.removeEventListener("play", mine, true);
  }, []);

  const report = (e: string | null) => setError(e || "");
  const push = usePush(report);
  const where = (t?: string) => (t ? `&thread=${t}` : "");
  const stick = () => (thread ? stickThread : stickMain).current();
  // A voice note waits on this phone until the room has it. If it doesn't get there, it stays with "Tap to send again".
  type Typed = { cid: string; text: string; thread?: string; title?: string; who?: Record<string, "in" | "paused"> };
  const outgoing = useRef(new Map<string, Outgoing | Typed>());
  // A voice note shows as sent the moment you tap send; the room's copy takes its place under the same id once the
  // words are written down. The recording joins it a moment later, when the phone has handed it over.
  const voiceAt = useRef(new Map<string, { thread?: string; at: number }>());
  function voiceStart(seconds: number) {
    const cid = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t = thread || undefined, at = Date.now() / 1000;
    voiceAt.current.set(cid, { thread: t, at });
    setListening(false);
    setMsgs((m) => [...m, { id: cid, cid, n: after.current + 0.9, at, kind: "human", email: state.me, text: "", audio: "local", seconds, pending: true, thread: t }]); stick();
    return cid;
  }
  async function voice(r: Recording | null, cid?: string) {
    setListening(false);
    const started = cid ? voiceAt.current.get(cid) : undefined; if (cid) voiceAt.current.delete(cid);
    if (!r || !cid || !started) { if (cid) setMsgs((m) => m.filter((x) => x.id !== cid)); return; }  // too short or nothing recorded
    const o: Outgoing = { cid, owner: state.me, blob: r.blob, type: r.type, seconds: r.seconds, thread: started.thread, at: started.at };
    shown(cid, { localUrl: URL.createObjectURL(r.blob), seconds: r.seconds });
    await keep(o);
    sendVoice(o);
  }
  async function sendVoice(o: Outgoing) {
    outgoing.current.set(o.cid, o);
    shown(o.cid, { pending: true, failed: false });
    // A note that doesn't get an answer (the connection dropped, the room was busy) is sent again by itself a few times
    // before it shows "didn't send". The same cid each time, so the room keeps one copy: a try that did get there
    // is handed back, not posted twice. A refusal (4xx) is final.
    let r: Response | null = null;
    const waits = [0, 2000, 5000, 10000];
    for (const [i, wait] of waits.entries()) {
      if (wait) { shown(o.cid, { progress: `trying again (${i}/${waits.length - 1})` }); await new Promise((ok) => setTimeout(ok, wait)); if (msgsNow.current.some((x) => x.cid === o.cid && x.id !== o.cid)) break; }
      shown(o.cid, { progress: "sending" });
      // where it is, as it is: the upload's own progress, then the room writing it down (the speech server isn't asked)
      r = await sendWithProgress(`/api/voice?seconds=${o.seconds}&cid=${o.cid}${where(o.thread)}`, { method: "POST", headers: { "Content-Type": o.type }, body: o.blob },
        (part) => shown(o.cid, { progress: part < 1 ? `sending ${Math.round(part * 100)}%` : "transcribing" }));
      if (r?.ok || (r && r.status < 500 && r.status !== 408 && r.status !== 429)) break;
    }
    settle(o.cid, r);
  }
  // Only the copy shown while sending (its id is still the cid) is ever marked; the room's copy never is.
  const shown = (cid: string, f: Partial<Msg>) => setMsgs((m) => m.map((x) => (x.id === cid ? { ...x, ...f } : x)));
  const msgsNow = useRef(msgs); msgsNow.current = msgs;
  // The room's answer to a send: its copy takes the place of the one shown while sending (keeping a recording already
  // loaded). If it failed but a poll already brought the room's copy, it did get there: nothing to retry.
  async function settle(cid: string, r: Response | null) {
    const real = r?.ok ? ((await r.json().catch(() => null)) as Msg | null) : null;
    if (real?.id || msgsNow.current.some((x) => x.cid === cid && x.id !== cid)) {
      outgoing.current.delete(cid); drop(cid);
      if (real?.id) setMsgs((m) => {
        const local = m.find((x) => x.id === cid); if (local?.localUrl) real.localUrl = local.localUrl;
        return (m.some((x) => x.id === real.id) ? m.filter((x) => x.id !== cid) : m.map((x) => (x.id === cid ? real : x))).sort((a, b) => a.n - b.n);
      });
      return;
    }
    shown(cid, { pending: false, failed: true });
    report(r ? ((await r.json().catch(() => ({}))) as { error?: string }).error || `That didn't send (${r.status}).` : "Can't reach the room.");
  }
  // after a reload or a closed app: notes the room never got come back, ready to send again
  useEffect(() => {
    if (!state.me) return;
    waiting().then((list) => {
      const have = new Set(msgs.map((m) => m.cid).filter(Boolean));
      // only what you recorded: someone else signed in on this phone never sees or sends it
      const lost = list.filter((o) => { if (o.owner !== state.me) return false; if (have.has(o.cid)) { drop(o.cid); return false; } return !outgoing.current.has(o.cid); });
      for (const o of lost) outgoing.current.set(o.cid, o);
      if (lost.length) setMsgs((m) => [...m, ...lost.map((o): Msg => ({ id: o.cid, cid: o.cid, n: after.current + 0.9, at: o.at, kind: "human", email: state.me, text: "", audio: "local", localUrl: URL.createObjectURL(o.blob), seconds: o.seconds, failed: true, thread: o.thread }))]);
    });
  }, [state.me]);
  retryRef.current = (cid) => retry(cid);
  function retry(cid: string) {
    const o = outgoing.current.get(cid); if (!o || !msgsNow.current.some((x) => x.id === cid)) return;
    if ("blob" in o) { if (o.owner === state.me) sendVoice(o); } else sendTyped(o);
  }
  async function files(list: File[], text: string) {
    const t = thread || undefined;
    // all of them in one message, one after another in the body; their sizes tell the room where each ends
    const q = list.map((f) => `name=${encodeURIComponent(f.name)}&size=${f.size}`).join("&");
    report(await say(`/api/files?${q}&text=${encodeURIComponent(text)}${where(t)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Blob(list) }));
  }
  function mic() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return setError("This browser can't record here.");
    setMicBlocked(false);
    setListening(null);
  }
  // what you type shows at once, then becomes the room's copy as soon as the room has it (no wait for the next poll)
  async function text(t: string) {
    stick();
    const o: Typed = { cid: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, thread: thread || undefined };
    setMsgs((m) => [...m, { id: o.cid, cid: o.cid, n: after.current + 0.9, at: Date.now() / 1000, kind: "human", email: state.me, text: t, pending: true, thread: o.thread }]);
    if (chatsHome && !thread && !lobby) setThread(o.cid);  // from home, a message starts a chat: go straight into it
    sendTyped(o);
  }
  // every try carries the same name (cid), so if the room got an earlier one, it answers with that copy instead of posting again
  async function sendTyped(o: Typed) {
    outgoing.current.set(o.cid, o);
    shown(o.cid, { pending: true, failed: false });
    settle(o.cid, await send("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: o.text, cid: o.cid, ...(o.thread ? { thread: o.thread } : {}), ...(o.title ? { title: o.title } : {}), ...(o.who ? { who: o.who } : {}) }) }));
  }

  // a chat started from the new-chat sheet: the first message carries who's in, so the agents picked hear it too
  async function startChat(t: string, agents: Record<string, boolean>, _people: Record<string, boolean>, title = "") {  // people: not kept by the room yet
    setStarting(false); setOnly("");
    // every agent's place in it, as chosen, so the chat starts with exactly that audience (the room asks permission
    // only for a real change from where an agent already stands)
    const who: Record<string, "in" | "paused"> = {};
    for (const w of state.members.wolts) who[w.wolt] = agents[w.wolt] ? "in" : "paused";
    const o: Typed = { cid: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, ...(title ? { title } : {}), ...(Object.keys(who).length ? { who } : {}) };
    setMsgs((m) => [...m, { id: o.cid, cid: o.cid, n: after.current + 0.9, at: Date.now() / 1000, kind: "human", email: state.me, text: t, pending: true, ...(title ? { title } : {}) }]);
    setThread(o.cid);
    await sendTyped(o);
  }
  // renaming a chat shows at once here; everyone else gets it with the room's next update. An empty name: back to its first one.
  const [, renamed] = useState(0);
  const guestMe = !!state.members.people.find((p) => p.email === state.me)?.guest;
  async function renameChat(t: string, n: string) {
    const was = named[t];
    if (n) named[t] = n; else delete named[t];
    renamed((x) => x + 1);
    const err = await say("/api/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread: t, name: n }) });
    if (err) { if (was) named[t] = was; else delete named[t]; renamed((x) => x + 1); report(err); }
  }
  const me = state.members.wolts.find((w) => w.owner === state.me);
  const composer = <Composer key={thread || "main"} draft={thread || "main"} wolts={state.members.wolts} people={state.members.people} working={state.working || {}} host={state.host} me={state.me} onText={text} onFiles={files} onMic={mic} placeholder={thread ? (chatsHome ? "$ message this chat" : "$ reply in thread") : chatsHome && !lobby ? "$ start a new chat…" : undefined} />;
  // on the desk: the wolts of the open thread (or every wolt that isn't paused, in the main chat)
  const deskWolts = state.members.wolts.filter((w) => !w.paused && (!thread || !state.who || (state.main === w.wolt && state.who[thread]?.[w.wolt] !== "paused") || state.who[thread]?.[w.wolt] === "in"));
  // the chats on the left and the open chat docked beside them, on a computer screen (not beside the desk: that column is narrow)
  // one set of pieces for every screen: the chats list, the chat, the side pane. Side by side on a computer, one at a time on a phone
  const oneUI = !desk && chatsHome && !lobby, twoPane = roomy && oneUI;
  const [phoneSide, setPhoneSide] = useState(false);
  const [inviting, setInviting] = useState(false);
  // Escape closes whatever pops up on top (a page, a card, the new chat sheet, the menu…), the top one first. Not the chat itself.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || viewing) return;  // the picture viewer closes itself
      if (paging) setPaging(""); else if (who) setWho(""); else if (starting) setStarting(false); else if (adding) setAdding(false);
      else if (menu) setMenu(false); else if (listOpen) setListOpen(false); else if (phoneSide) setPhoneSide(false); else return;
      e.preventDefault();
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [viewing, paging, who, starting, adding, menu, listOpen, phoneSide]);
  useEffect(() => setPhoneSide(false), [thread]);
  // the side pane beside the open chat (who's in it, pages, files): open by default on a wide screen, remembered here
  const [sideOn, setSideOn] = useState(() => { try { return localStorage.getItem("side") !== "0"; } catch { return true; } });
  const setSide = (on: boolean) => { setSideOn(on); try { localStorage.setItem("side", on ? "1" : "0"); } catch { /* fine */ } };
  // Humans: only people's messages, each stretch of agents' messages folded under a rule. Remembered on this device.
  const [humansOn, setHumansOn] = useState(() => { try { return localStorage.getItem("humans") === "1"; } catch { return false; } });
  const flipFeed = useRef<() => void>(() => {});
  const humansSwitch = <button type="button" role="switch" aria-checked={humansOn} title="Humans: fold the agents' messages" data-humans
    onClick={(e) => { e.stopPropagation(); flipFeed.current(); const on = !humansOn; setHumansOn(on); try { localStorage.setItem("humans", on ? "1" : "0"); } catch { /* private mode */ } }}
    className={`flex-none flex items-center gap-1.5 rounded-full border bg-paper pl-2.5 pr-1 py-[3px] font-mono text-[11.5px] font-semibold cursor-pointer transition-colors ${humansOn ? "border-go text-ink" : "border-line text-dim"}`}>
    Humans<i className={`relative block w-[30px] h-[18px] rounded-full transition-colors ${humansOn ? "bg-go" : "bg-line"}`}><i className={`absolute top-[2px] block w-[14px] h-[14px] rounded-full bg-white shadow-[0_1px_2px_#18100a40] transition-[left] ${humansOn ? "left-[14px]" : "left-[2px]"}`} /></i></button>;
  const chatSheet = (docked: boolean) => (
<ThreadSheet key={thread} docked={docked} side={docked ? (roomy ? { on: sideOn, flip: () => setSide(!sideOn) } : { on: phoneSide, flip: () => setPhoneSide(!phoneSide) }) : undefined} back={docked && !roomy} startFull={chatsHome} chat={chatsHome} name={threadTitle(root)} onRename={guestMe ? undefined : (n) => renameChat(thread, n)} color={threadColor(thread)} wallpaper={docked ? undefined : threadWallpaper(thread)} title={<><ThreadHat id={thread} className="w-5 h-5 mr-1.5" />{threadTitle(root)}</>} count={(replies.get(thread) || []).length} close={() => { const was = thread; setThread((t) => (t === was ? "" : t)); }}
        extra={humansSwitch} who={<><ThreadWho thread={thread} list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={ctx}
          room={state.who ? state.who[thread] || {} : undefined} fallback={state.who_default} host={state.host} main={state.main} /></>}>
        <Feed list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={docked ? { ...ctx, rows: true, tint: threadColor(thread) } : ctx} working={state.working || {}} away={state.unreachable} divider={chatsHome ? undefined : (replies.get(thread) || []).length} stick={stickThread} place={thread} humans={humansOn} flip={flipFeed} />
        {/* a chat just started: who will pick it up, and how to bring someone else in */}
        {chatsHome && root && root.kind !== "wolt" && !(replies.get(thread) || []).length && <p className="flex-none mx-4 mb-2 px-3 py-2 rounded-xl bg-panel border border-line text-center text-[13px] text-dim">
          New chat started{state.main && state.who?.[thread]?.[state.main] !== "paused" ? <>. <b className="text-ink">{state.main}</b> sees it and will pick it up</> : ""}. Tag <b className="text-ink">@a wolt</b> to bring it in.</p>}
        {composer}
      </ThreadSheet>
  );
  const room = (
    <div className={`h-full flex ${oneUI ? "" : "flex-col"} relative bg-paper`} {...menuSwipe.screen}>
      {!oneUI && <header ref={hdr} {...pull} className="relative flex-none flex items-center gap-2 pl-1.5 pr-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-paper border-b border-line">
        {/* ☰ stays above the menu and turns into ✕, so tapping the same spot opens and closes it */}
        <button type="button" aria-label={menu ? "Close menu" : "Menu"} onClick={() => setMenu(!menu)}
          className={`relative ${menu ? "z-[1720]" : ""} flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer rounded-[10px]`}>
          {menu ? <X size={22} /> : <MenuIcon size={22} />}
          {!menu && push.ask && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-acc" />}
        </button>
        <span className="relative flex-none w-12 h-12 rounded-full bg-[#f5f1e8] ring-1 ring-line"><img src="/room-icon.png" alt="" className="absolute inset-1 w-10 h-10 rounded-full" /><Live link={link === "open" ? line : link === "connecting" ? "retry" : "down"} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-mono font-semibold text-acc truncate"><span className="text-dim">~/</span><span className="cursor">{state.title || "shell"}</span></div>
          <button type="button" aria-expanded={strip} onClick={() => { if (chatsHome && !lobby) chatList.current?.scrollTo({ top: UPPER, behavior: "smooth" }); else setStrip(!strip); }} className="block max-w-full p-0 border-0 bg-transparent text-left font-mono text-[11px] text-dim truncate cursor-pointer">{[...state.members.people.map((p) => p.name), ...state.members.wolts.map((w) => w.wolt)].join(", ")}</button>
        </div>
        {wide && (DESK_BUTTON || desk) && <button type="button" aria-label={desk ? "Hide the terminals" : "Show the terminals"} title="desk: your wolts' terminals" onClick={() => setDesk(!desk)}
          className={`flex-none w-10 h-10 grid place-items-center border-0 cursor-pointer rounded-[10px] ${desk ? "bg-acc text-white" : "bg-transparent text-acc"}`}><Monitor size={20} /></button>}
        {!chatsHome && <button type="button" aria-label="Inbox" onClick={() => setListOpen(!listOpen)} className="relative flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer">
          <Inbox size={22} />{inboxCount > 0 && <span className="absolute top-0.5 right-0 min-w-4 h-4 px-1 rounded-full bg-acc text-white font-mono font-semibold text-[10px] leading-4 text-center">{inboxCount}</span>}
        </button>}
      </header>}
      {!(chatsHome && !lobby) && <WoltStrip el={stripEl} state={state} person={person} open={strip} onClose={() => setStrip(false)} onPick={setWho} />}
      {chatsHome && !lobby ? <div className="flex-1 min-h-0 min-w-0 flex relative">
      {/* on a phone the chat list stays underneath an open chat, so swiping the chat away shows where you're going */}
      {oneUI && !roomy ? <>
        <div className="flex-1 min-w-0 flex" aria-hidden={thread ? true : undefined} inert={!!thread}>
          <Sidebar full home={homeView} onInvite={() => setInviting(true)} state={state} ctx={ctx} roots={roots} replies={replies} seen={seen} current={thread} title={state.title || "shell"} menu={menu}
            onMenu={() => setMenu(!menu)} onOpen={open} onNew={() => setStarting(true)} onPick={setWho} onAgent={() => setAdding(true)} /></div>
        {thread && <div ref={swipe.el} {...swipe.handlers} className="absolute inset-0 z-[20] min-w-0 flex bg-paper"><div className="flex-1 min-w-0 relative">{chatSheet(true)}
        {phoneSide && <div ref={sideSwipe.el} {...sideSwipe.handlers} onTouchStart={(e) => { e.stopPropagation(); sideSwipe.handlers.onTouchStart(e); }} className="absolute inset-0 z-[1590] flex flex-col bg-paper animate-[fadein_.15s_ease-out]">
          <div className="flex-none flex items-center gap-1 pl-1 pr-3 pt-[env(safe-area-inset-top)] min-h-12 border-b border-line">
            <button type="button" aria-label="Back to the chat" onClick={() => setPhoneSide(false)} className="w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={24} /></button>
            <b className="text-[15px]">About this chat</b></div>
          <div className="flex-1 min-h-0 flex [&>aside]:w-full [&>aside]:border-l-0"><ChatSide key={thread} thread={thread} list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={ctx} room={state.who ? state.who[thread] || {} : undefined} fallback={state.who_default} host={state.host} main={state.main} /></div>
        </div>}</div></div>}</>
      : twoPane ? <Sidebar home={homeView} onInvite={() => setInviting(true)} state={state} ctx={ctx} roots={roots} replies={replies} seen={seen} current={thread} title={state.title || "shell"} menu={menu} desk={desk}
        onMenu={() => setMenu(!menu)} onDesk={wide && DESK_BUTTON ? () => setDesk(!desk) : undefined} onOpen={open} onNew={() => setStarting(true)} onPick={setWho} onAgent={() => setAdding(true)} />
      : <div ref={chatList} onTouchStart={() => { touching.current = true; cancelAnimationFrame(springing.current); springing.current = 0; if (chatList.current) chatList.current.style.overflowY = ""; }} onTouchEnd={() => { touching.current = false; tuckSky(); }} onScroll={tuckSky}
        className={`flex-1 min-h-0 overflow-y-auto overscroll-contain pb-24`}>
        {homeView || <><WoltStrip inline state={state} person={person} open onClose={() => {}} onPick={setWho} />
        {chatRows({ main: [], all: [], roots: roots, replies: replies, ctx: ctx, seen: seen, current: thread,
          onMain: () => {}, onOpen: open }).rows}
        {!roots.length && <p className="text-center text-dim font-mono text-xs mt-6 px-6">No chats yet. Start one below.</p>}</>}
      </div>}
      {twoPane && <div className="flex-1 min-w-0 relative flex">{thread ? <><div className="flex-1 min-w-0 relative">{chatSheet(true)}</div>
        {sideOn && <ChatSide key={thread} thread={thread} list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={ctx} room={state.who ? state.who[thread] || {} : undefined} fallback={state.who_default} host={state.host} main={state.main} />}</> : <div className="flex-1 h-full grid place-items-center text-center px-8">
        <div><div className="font-mono text-acc font-semibold">Pick a chat</div><div className="text-dim text-[13px] mt-1">or start a new one.</div></div></div>}</div>}
      </div> : <>
        {chatsHome && <button type="button" onClick={() => setLobby(false)} className="flex-none flex items-center gap-1 px-3 py-2 border-0 border-b border-line bg-panel font-mono text-[12px] text-acc text-left cursor-pointer">
          <ChevronLeft size={16} /> chats <span className="text-dim">· lobby: the old main chat. Anything you say here starts a chat.</span></button>}
        <Feed list={lobbyList} ctx={ctx} working={state.working || {}} away={state.unreachable} replies={replies} seen={seen} open={open} stick={stickMain} />
      </>}
      {!thread && !oneUI && (chatsHome && !lobby
        ? <button type="button" aria-label="New chat" onClick={() => setStarting(true)}
          className={"absolute right-4 bottom-[calc(18px+env(safe-area-inset-bottom))] z-[1400] flex items-center gap-1.5 h-14 pl-4 pr-5 rounded-full border-0 bg-acc text-white font-mono font-bold text-[15px] shadow-[0_4px_14px_#18100a40] cursor-pointer active:scale-95 transition-transform"}>
          <span className="text-2xl leading-none">＋</span>New chat</button>
        : composer)}
      {starting && <NewChatSheet ctx={ctx} people={state.members.people} wolts={state.members.wolts} main={state.main} fallback={state.who_default} host={state.host} only={only || undefined} onStart={startChat} onClose={() => { setStarting(false); setOnly(""); }} />}
      {listOpen && <InboxSheet top={hdrH} main={mainFresh} all={main.filter((m) => m.kind === "human" || m.kind === "wolt")} roots={roots} replies={replies} ctx={ctx} seen={seen} current={thread}
        onMain={() => { setListOpen(false); setThread(""); stickMain.current(); }} onOpen={(id) => { setListOpen(false); open(id); }} onClose={() => setListOpen(false)} />}
      {thread && !oneUI && chatSheet(false)}
      <Menu open={menu} panel={menuSwipe.panel} scrim={menuSwipe.scrim} touch={menuSwipe.menu} close={() => setMenu(false)} title={state.title || "shell"} me={state.me} host={state.host} wolts={state.members.wolts} people={state.members.people} push={push} freshCount={inboxCount} onThreads={() => { if (chatsHome) { setThread(""); setLobby(false); } else setListOpen(true); }} onAgent={() => setAdding(true)} onEveryone={() => { setThread(""); setLobby(false); setStrip(true); }} main={state.main} looks={state.looks} faces={state.faces} guestAgents={state.guest_agents} />
      {inviting && <LinkModal title="Invite humans" sub="Anyone with this link comes in and picks a name" get={roomInvite} onClose={() => setInviting(false)} />}
      {adding && <AddAgentSheet me={state.me} onClose={() => setAdding(false)} />}
      {loading && !naming && <Opening problem={error} />}
      {naming && <NameFirst done={() => setNaming(false)} />}
      {relayRoom && (relayKeyMissing || (link !== "open" && !(naming && link === "connecting"))) && <Offline missing={relayKeyMissing} state={link} />}
      {error && <div onClick={() => setError("")} className="absolute left-1/2 -translate-x-1/2 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[1600] font-mono text-xs bg-panel text-acc border border-acc px-3 py-1.5 rounded-lg cursor-pointer shadow-[0_2px_10px_#18100a1f]">&gt; {error}</div>}
      {listening !== false && <Listening sprite={woltFace(me?.wolt, me?.creature)} audio={listening} onSend={voiceStart} onDone={voice} onBlocked={() => setMicBlocked(true)} />}
      {/* An app on the home screen can lose the mic and never ask again until it starts over. A tap asks again;
          if the phone still says no, reloading starts the page over, which brings its question back without quitting the app. */}
      {who && <Profile who={who} state={state} person={person} msgs={msgs} onPick={setWho} onClose={() => setWho("")}
        onOpen={(t) => { setWho(""); setStrip(false); setLobby(false); setThread(t); }} />}
      {micBlocked && <div role="alert" className="absolute inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[1600] max-w-[480px] mx-auto rounded-xl border-2 border-acc bg-panel p-3 shadow-[0_4px_14px_#18100a33]">
        <div className="font-mono text-[13px] font-semibold text-acc">The mic isn't allowed right now</div>
        <div className="text-[13px] text-dim mt-0.5">Ask again, or reload the app so your phone asks you. If it still says no, allow the microphone for this site in your phone's settings.</div>
        <div className="flex gap-2 mt-2.5">
          <button type="button" onClick={mic} className="flex-1 rounded-lg border-0 bg-acc text-white font-mono font-semibold text-[13px] py-2 cursor-pointer">Ask again</button>
          <button type="button" onClick={() => location.reload()} className="flex-1 rounded-lg border border-acc bg-transparent text-acc font-mono font-semibold text-[13px] py-2 cursor-pointer">Reload app</button>
          <button type="button" aria-label="Close" onClick={() => setMicBlocked(false)} className="w-9 rounded-lg border border-line bg-transparent text-dim cursor-pointer">✕</button>
        </div>
      </div>}
      {viewing && <Viewer urls={viewing.urls} names={viewing.names} at={viewing.at} close={() => setViewing(null)} />}
      {paging && <PageViewer key={paging} id={paging} mark={state.pages?.[paging]} ctx={ctx} close={() => setPaging("")} />}
    </div>
  );
  // a page opened in a tab of its own (#page=ID): just the page, sealed as in the chat, its board saved to the room
  if (pageTab) return <div className="h-full">{!loading && <PageViewer tab id={pageTab} mark={state.pages?.[pageTab]} ctx={ctx} close={() => window.close()} />}</div>;
  if (!desk) return room;
  return <div className="h-full flex">
    <Suspense fallback={<div className="flex-1 bg-[#2a231c]" />}>
      <Desk ctx={ctx} wolts={deskWolts} working={new Set(Object.keys(state.working || {}))} focus={focus} bridge={state.desk} />
    </Suspense>
    {/* its own box for everything fixed inside (menu, sheets), so they stay in the chat column */}
    <div className="flex-none w-[460px] h-full border-l border-line relative overflow-hidden [transform:translateZ(0)]">{room}</div>
  </div>;
}
