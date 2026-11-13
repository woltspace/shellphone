// Shell Phone, our own page. Same room, same look as the classic page, but every piece is ours to change.
import { becomeGuest, needsName, relayKeyMissing, relayRoom, onRelayState, type PipeState } from "./relay";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./Composer";
import { Listening, type Recording } from "./Listening";
import { Message, type Ctx } from "./Message";
import { onScreen, say, send, useRoom, type Msg } from "./room";
import { drop, keep, waiting, type Outgoing } from "./outbox";
import { LORE, woltAvatar } from "./sprites";
import { AddAgentSheet } from "./AddAgent";
import { ThreadWho } from "./ThreadWho";
import { InboxSheet, ThreadFooter, threadColor, threadTitle, unread, useSeen } from "./Threads";
import { Menu } from "./Menu";
import { ChatHeader, chatsOf, HomeList, NewChat, Standby, WoltChats, type Chat, type Nav } from "./Chats";
import { ContactCard } from "./CardContact";
import { SKIES, useSky } from "./Scene";
import { BellScreen, type Note } from "./Bell";
import { inviteLink, relayHost } from "./relay";
import { handle as handleOf } from "./mentions.js";
import { PageViewer } from "./Page";
import { ShareButton } from "./Share";
import { Bell, ChevronDown, ChevronLeft, Inbox, Menu as MenuIcon, Monitor, X } from "lucide-react";
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
      document.documentElement.classList.toggle("typing", typing());  // the keyboard is up: the composer sits right on it (index.css)
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
        <img src={woltAvatar(w.creature, ctx.person(w.owner).color)} alt="" className="gnaw-img pixel flex-none w-6 h-6" />
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

// A list of messages that stays at the bottom while you're there, and leaves you alone if you scrolled up to read.
// Used for the main chat and for a thread alike.
// "3 NEW" above the first unread. Once the last new message has been on screen for 2s, it fades out (0.6s) and the gap closes.
function NewLine({ count, last, onGone }: { count: number; last?: string; onGone: () => void }) {
  const ref = useRef<HTMLDivElement>(null), [gone, setGone] = useState(false);
  useEffect(() => {
    const el = (last && ref.current?.closest("[data-feed]")?.querySelector(`[data-mid="${last}"]`)) || ref.current; if (!el) return;
    let t = 0;
    const io = new IntersectionObserver(([e]) => { clearTimeout(t); if (e.isIntersecting) start(); });
    const start = () => { clearTimeout(t); if (!document.hidden) t = window.setTimeout(() => { setGone(true); onGone(); }, 2000); };
    const vis = () => (document.hidden ? clearTimeout(t) : start());  // only while someone is looking
    document.addEventListener("visibilitychange", vis);
    io.observe(el); return () => { clearTimeout(t); io.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, [last]);
  return <div ref={ref} data-new aria-hidden={gone} className={`flex items-center px-3.5 transition-all duration-[600ms] overflow-hidden ${gone ? "opacity-0 my-0 h-0" : "opacity-100 my-3 h-5"}`}>
    <span className="flex-1 h-px bg-acc" /><span className="font-mono text-[10px] font-bold uppercase tracking-wider text-white bg-acc rounded-full px-2.5 py-0.5">{count} new</span><span className="flex-1 h-px bg-acc" /></div>;
}

function Feed({ list, ctx, working, away, replies, seen, open, divider, stick, place = "" }: {
  list: Msg[]; ctx: Ctx; working: Record<string, unknown>; away?: Record<string, number>; replies?: Map<string, Msg[]>; seen?: Record<string, number>; place?: string;
  open?: (id: string) => void; divider?: number; stick: React.MutableRefObject<(on?: boolean) => void>;
}) {
  // The chat is laid out from the bottom up (column-reverse), like chat apps do: the browser itself keeps the newest
  // message in place while pictures, players and cards load, and while new messages arrive. No pinning code to fight it.
  // scrollTop is 0 at the bottom and goes negative as you read back up.
  const scroller = useRef<HTMLDivElement>(null);
  const [far, setFar] = useState(false);  // scrolled well up: show the jump-to-the-bottom button
  const toBottom = (smooth = true) => scroller.current?.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  stick.current = (on = true) => { if (on) toBottom(false); };  // sending, or coming back after a while: the newest
  const onScroll = () => setFar(-scroller.current!.scrollTop > 600);
  // "— N new —": where you stopped reading, as it was when you came in (it stays put while you read, then moves on next visit)
  const mark = useRef<{ place: string; n: number } | null>(null);
  const [, moved] = useState(0);
  if (mark.current?.place !== place) mark.current = { place, n: seen?.[place || "main"] ?? Infinity };
  const fresh = list.filter((m) => m.n > mark.current!.n && !m.pending && !(m.kind === "human" && m.email === ctx.me));
  const firstNew = fresh[0]?.id;
  let lastDay = "", lastWho = "";
  return <div className="flex-1 min-h-0 relative flex flex-col"><div ref={scroller} data-feed onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain flex flex-col-reverse"><div className="pt-1">
    {list.length === 0 && <p className="text-center text-dim font-mono text-xs mt-10 px-6">Nobody has said anything yet. Tag a wolt with @ to bring it in.</p>}
    {list.map((m, i) => {
      const d = new Date(m.at * 1000), day = d.toLocaleDateString([], { day: "numeric", month: "long" });
      const who = m.kind === "human" ? m.email! : "wolt:" + m.wolt, newDay = day !== lastDay;
      const thread = replies?.get(m.id) || [];
      const run = newDay || who !== lastWho;
      lastDay = day; lastWho = thread.length ? "" : who;  // a thread breaks the run, so the next bubble shows its name
      return <div key={m.cid || m.id} data-mid={m.id}>
        {m.id === firstNew && <NewLine key={firstNew} count={fresh.length} last={fresh[fresh.length - 1]?.id}
          onGone={() => setTimeout(() => { mark.current = { place, n: Math.max(...list.map((x) => x.n || 0)) }; moved((k) => k + 1); }, 600)} />}
        {newDay && <div className="text-center my-3"><span className="font-mono text-[11px] uppercase text-dim bg-panel border border-line rounded-lg px-2.5 py-1">{day}</span></div>}
        {/* like Slack: tap a message to open its thread (links, players, pictures and a voice note's words keep their own tap) */}
        <div className={open && !m.pending && !m.failed ? "cursor-pointer active:opacity-60 transition-opacity" : ""}
          onClick={(e) => { if (open && !m.pending && !m.failed && !(e.target as HTMLElement).closest("button,a,audio,video,img,[data-tap]")) open(m.id); }}>
          <Message m={m} ctx={ctx} firstOfRun={run} footer={thread.length > 0 && open ?
            <ThreadFooter list={thread} fresh={unread(thread, seen?.[m.id], ctx.me)} ctx={ctx} onOpen={() => open(m.id)} busy={ctx.busy?.(m.id)} /> : undefined} />
        </div>
        {divider !== undefined && i === 0 && <div className="flex items-center gap-2.5 px-3.5 my-3 font-mono text-[11px] text-dim">
          <span>{divider} {divider === 1 ? "reply" : "replies"}</span><span className="flex-1 h-px bg-line" /></div>}
      </div>;
    })}
    <Gnaw ctx={ctx} working={working} away={away} place={place} />
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
function ThreadSheet({ color, title, count, close, who, children }: { color: string; title: string; count: number; close: () => void; who?: React.ReactNode; children: React.ReactNode }) {
  const [drag, setDrag] = useState<{ y: number; dy: number } | null>(null), [full, setFull] = useState(false);
  const [leaving, setLeaving] = useState(false);  // closing: the scrim fades and the sheet slides away, then it's gone
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);  // gone before the fade ended (another thread took its place): no late close
  const bye = () => { if (leaving) return; setLeaving(true); timer.current = window.setTimeout(close, 220); };
  // the handle on top and the strip down the right edge both move the sheet with your finger: far enough down, it closes
  const grip = {
    onTouchStart: (e: React.TouchEvent) => setDrag({ y: e.touches[0].clientY, dy: 0 }),
    onTouchMove: (e: React.TouchEvent) => drag && setDrag({ ...drag, dy: e.touches[0].clientY - drag.y }),
    // up far enough: full screen; down from full screen: back to the tray; down from the tray: closed
    onTouchEnd: () => { if (drag) { if (drag.dy < -60) setFull(true); else if (drag.dy > 80) { if (full) setFull(false); else bye(); } } setDrag(null); },
    onClick: (e: React.MouseEvent) => { if ((e.currentTarget as HTMLElement).dataset.side !== undefined) bye(); },  // a plain tap on a side edge: back to the chat
  };
  return <div className="absolute inset-0 z-[1580]">
    <div onClick={bye} className={`absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out] transition-opacity duration-200 ${leaving ? "opacity-0" : ""}`} />
    <div role="dialog" aria-label="Thread" onClick={(e) => {  // like iMessage: a tap on the see-through space beside the messages drops you back to the chat
      const t = e.target as HTMLElement;
      if (t.closest("[data-bubble],[data-composer],button,a,input,textarea,img,audio,video,[role=button],[data-tap]") || !t.closest("[data-feed]")) return;
      if (String(window.getSelection() || "")) return;  // selecting words, not leaving
      bye();
    }} style={{ transform: leaving ? "translateY(100%)" : drag ? `translateY(${Math.max(full ? 0 : -96, drag.dy)}px)` : undefined, opacity: leaving ? 0 : undefined,
      transition: drag ? "none" : "top .25s cubic-bezier(.2,.8,.2,1), transform .22s cubic-bezier(.4,0,1,1), opacity .22s ease-in" }}
      className={`absolute inset-x-0 bottom-0 ${full ? "top-[env(safe-area-inset-top)]" : "top-[calc(env(safe-area-inset-top)+96px)]"} max-w-[640px] mx-auto bg-[#f5f1e88c] backdrop-blur-sm rounded-t-[18px] flex flex-col overflow-hidden shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]`}>
      <div className="flex-none touch-none bg-[#fffdf680] border-b border-line" style={{ boxShadow: `inset 0 3px 0 ${color}` }}
        {...grip}>
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mt-2" />
        <div className="flex items-center gap-2 pl-4 pr-1.5 pb-1.5">
          <div className="min-w-0 flex-1">
            <div className="font-mono font-semibold truncate" style={{ color }}>{title}</div>
            <div className="font-mono text-[11px] text-dim">thread · {count} {count === 1 ? "reply" : "replies"}</div>
          </div>
          {who}
          <button type="button" aria-label="Close the thread" onClick={bye} className="flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={20} /></button>
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
      onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; s.current = t.clientX < 28 ? { x: t.clientX, y: t.clientY, t: performance.now(), dx: 0 } : null; v.current = 0; },
      onTouchMove: (e: React.TouchEvent) => {
        const p = s.current; if (!p) return;
        v.current = track(p, e);
        if (p.dir === "y") { s.current = null; return; }  // that's a scroll
        const d = el.current; if (!d || p.dir !== "x") return;
        d.style.transition = "none"; d.style.transform = `translateX(${Math.max(0, p.dx)}px)`; d.style.boxShadow = "-8px 0 24px #18100a22";
      },
      onTouchEnd: () => {
        const p = s.current; s.current = null; if (!p || p.dir !== "x") return;
        if (p.dx > 90 || (p.dx > 30 && v.current > 0.4)) back(); else glide(el.current, "translateX(0)");
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
      <p className="text-sm text-dim leading-snug mb-4">What should people here call you?</p>
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
  const { state, msgs, setMsgs, error, setError, person, fresh, setFresh, after, link: line } = useRoom();
  const firstState = useRef(state), loading = state === firstState.current;  // nothing from the room yet
  const [naming, setNaming] = useState(needsName);  // an invite link: who are you, first
  const [link, setLink] = useState<PipeState>("open");  // through the relay: is the room's computer there?
  useEffect(() => (relayRoom ? onRelayState(setLink) : undefined), []);
  const [listening, setListening] = useState<AudioContext | null | false>(false);
  const [viewing, setViewing] = useState<{ urls: string[]; names?: string[]; at: number } | null>(null);
  const [paging, setPaging] = useState("");  // the page open full screen, by id
  // the desk: on a wide screen, your wolts' terminals beside the chat (Desk.tsx). Remembered on this computer.
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1100px)").matches;
  const [desk, setDeskOn] = useState(() => { try { return wide && localStorage.getItem("desk") === "1"; } catch { return false; } });
  const setDesk = (on: boolean) => { setDeskOn(on); try { localStorage.setItem("desk", on ? "1" : "0"); } catch { /* private mode */ } };
  const [focus, setFocus] = useState<{ wolt: string; at: number } | null>(null);
  const [thread, setThread] = useState("");
  // Wolts as contacts (Chats.tsx): home, a wolt's chats, a new chat, a chat, or the room's shared chat ("Everyone").
  // A room from before chats says nothing about them: it stays one shared chat, as always.
  const chatsOn = state.sessions !== undefined;
  const [navNow, setNav] = useState<Nav>({ at: "home" });
  const nav: Nav = chatsOn ? navNow : { at: "everyone" };
  const chatId = nav.at === "chat" ? nav.id : "";
  const place = chatId || thread;  // where what you send goes: the open chat, the open thread, or ("") the shared chat
  onScreen.at = chatsOn && nav.at !== "chat" && nav.at !== "everyone" ? "home" : place || "";  // tells the room what not to push
  const [card, setCard] = useState("");  // the wolt whose contact card is open
  const cols = typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
  const wideCols = chatsOn && !desk && cols;  // a computer: wolts · chats · chat side by side
  const stacked = chatsOn && !wideCols && nav.at !== "home";  // a phone, one screen over another: swipe from the left edge to go back
  const goBack = useRef(() => {});
  // On home the night sky runs up under the phone's status strip: the strip takes the page's colour, so the page wears
  // the sky's while home is showing, and goes back to paper everywhere else.
  const skyTop = chatsOn && !wideCols && nav.at === "home" && !card, [sky] = useSky();
  // at night the whole app is dark, not only the scene (index.css, html.night). Set while drawing, so the bubbles
  // drawn in this same pass already take the dark tint.
  if (typeof document !== "undefined") document.documentElement.classList.toggle("night", chatsOn && sky === "night");
  useEffect(() => {
    const color = skyTop ? SKIES[sky].top : chatsOn && sky === "night" ? "#0e1120" : "#f5f1e8";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
    document.documentElement.style.background = document.body.style.background = color;
  }, [skyTop, sky, chatsOn]);
  const [adding, setAdding] = useState(false);  // the "add an agent" sheet  // the message whose thread is open
  const retryRef = useRef((_cid: string) => {});
  const stickMain = useRef((_on?: boolean) => {}), stickThread = useRef((_on?: boolean) => {});
  const ctx: Ctx = { me: state.me, person, wolts: state.members.wolts, people: state.members.people, seen: state.seen || {}, all: msgs, view: (urls, at = 0, names) => setViewing({ urls, names, at }), retry: (cid) => retryRef.current(cid), openPage: setPaging, showTerminal: desk ? (wolt: string) => setFocus({ wolt, at: Date.now() }) : undefined, terminals: state.terminals, looks: state.looks,
    reply: (m: Msg) => { if (!chatId && !m.thread) open(m.id); setTimeout(() => { const c = document.querySelectorAll<HTMLTextAreaElement>("[data-composer] textarea"); c[c.length - 1]?.focus(); }, 280); },
    // who's working where ("" the main chat, else a thread); a room that doesn't say where: everywhere, as before
    busy: (place: string) => state.members.wolts.filter((w) => state.working_in ? (state.working_in[w.wolt] || []).includes(place) : !!state.working?.[w.wolt]) };

  // Threads the Matrix way: a reply carries the id of the message its thread hangs off. The main chat shows only the rest.
  const { main, replies } = useMemo(() => {
    const replies = new Map<string, Msg[]>(), main: Msg[] = [];
    for (const m of msgs) {
      if (m.thread) replies.set(m.thread, [...(replies.get(m.thread) || []), m]);
      else if (!m.session) main.push(m);  // a chat's first message belongs to the chat, not to the shared one
    }
    return { main, replies };
  }, [msgs]);
  const root = thread ? msgs.find((m) => m.id === thread) : undefined;
  const [listOpen, setListOpen] = useState(false);  // the inbox sheet; home is always the main chat
  const [menu, setMenu] = useState(false);
  const open = (id: string) => setThread(id);  // opened from the threads list, back returns to it
  const { seen, mark } = useSeen();
  // an open thread counts as read, including replies that arrive while you're in it
  useEffect(() => { const r = replies.get(thread); if (thread && r?.length) mark(thread, r.at(-1)!.n); }, [thread, replies]);
  const roots = main.filter((m) => replies.has(m.id));
  const chats = useMemo(() => chatsOf(state, msgs, replies, seen), [state.sessions, state.me, msgs, replies, seen]);
  const chatRoot = chatId ? msgs.find((m) => m.id === chatId) : undefined;
  // a chat you just started is on screen before the room's list says so
  const chat: Chat | undefined = chats.find((c) => c.id === chatId) || (chatRoot?.session ? { id: chatId, title: threadTitle(chatRoot), wolts: chatRoot.to || [], at: chatRoot.at, fresh: 0 } : undefined);
  const chatList = chatRoot ? [chatRoot, ...(replies.get(chatId) || [])] : [];
  useEffect(() => { if (chatList.length) mark(chatId, chatList.at(-1)!.n); }, [chatId, chatList.length]);  // an open chat counts as read
  // a notification that lands in a chat arrives as "its thread": show the chat instead
  useEffect(() => { if (thread && state.sessions?.some((x) => x.id === thread)) { setNav({ at: "chat", id: thread }); setThread(""); } }, [thread, state.sessions]);
  const myTag = handleOf(person(state.me).name).toLowerCase();
  const tagsMe = (text?: string) => !!myTag && (text || "").toLowerCase().split(/[^\w@-]+/).includes("@" + myTag);
  // the bell: what others said, newest first; new until you've been where it was said
  const notes: Note[] = useMemo(() => msgs.filter((m) => !m.pending && (m.kind === "wolt" || (m.kind === "human" && m.email !== state.me))).map((m) => {
    const place = m.session ? m.id : m.thread || "", c = chats.find((x) => x.id === place);
    return { m, place, chat: !!c, where: c ? c.title : "Everyone", fresh: m.n > (seen[place || "main"] || 0) };
  // in your chats, everything the others say; in the shared chat, only what names you (it would drown the rest)
  }).filter((n) => n.chat || tagsMe(n.m.text)).reverse(), [msgs, chats, seen, state.me, state.members.people]);
  // the host passes the room's invite link on: shared from the phone's own sheet, or copied
  const invite = async () => {
    // a room behind a login has no link to hand out: its host puts people on the list
    if (!relayHost) return setError(state.me === state.host ? "This room is behind your login: ask your wolt to add someone by email." : "Only the room's host can add people here.");
    const link = await inviteLink(); if (!link) return setError("Couldn't get the invite link from the room.");
    try { if (navigator.share) { await navigator.share({ title: "shellphone", text: "Join my shellphone room", url: link }); return; } }
    catch (e) { if ((e as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(link); setError("Invite link copied"); } catch { setError(link); }
  };
  const rename = (id: string, title: string) => say("/api/session-title", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title }) });
  const openChat = (id: string, wolt?: string) => { setThread(""); setNav({ at: "chat", id, wolt }); };
  const selWolt = nav.at === "wolt" || nav.at === "chat" || nav.at === "new" ? nav.wolt : undefined;
  async function startChat(wolts: string[], first: string): Promise<string | null> {
    const r = await send("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wolts, text: first, cid: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }) });
    if (!r) return "Can't reach the room.";
    if (!r.ok) return r.status === 404 ? "This room can't start chats yet." : ((await r.json().catch(() => ({}))) as { error?: string }).error || "That didn't start.";
    const m = (await r.json()) as Msg;
    setMsgs((old) => (old.some((x) => x.id === m.id) ? old : [...old, m].sort((a, b) => a.n - b.n)));
    openChat(m.id, wolts.length === 1 ? wolts[0] : undefined);
    return null;
  }
  // a room with no threads yet opens on its chat, not on an empty list (a brand-new room, someone's first)
  const settled = useRef(false);
  const threadsSeen = useRef(false); threadsSeen.current = replies.size > 0;
  useEffect(() => { if (!settled.current && state.me) { settled.current = true; if (!replies.size) setListOpen(false); } }, [state.me]);
  const freshCount = roots.filter((r) => unread(replies.get(r.id)!, seen[r.id], state.me)).length;
  // the main chat counts as read while it's on screen; what arrives while you're in a thread waits in the inbox
  const mainFresh = main.filter((m) => m.n > (seen.main || 0) && !(m.kind === "human" && m.email === state.me));
  useEffect(() => { if (!thread && main.length) mark("main", main.at(-1)!.n); }, [thread, main]);
  const inboxCount = freshCount + mainFresh.length;
  const hdr = useRef<HTMLElement>(null), [hdrH, setHdrH] = useState(0);
  useLayoutEffect(() => { const el = hdr.current; if (!el) return; const ro = new ResizeObserver(() => setHdrH(el.offsetHeight)); ro.observe(el); return () => ro.disconnect(); }, [nav.at]);
  const swipe = useSwipeBack(() => goBack.current());

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
    setMenu(false); setListOpen(false); setNav({ at: "everyone" });
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
  // leaving the spot you landed on (back to the list, another thread) clears it from the address
  useEffect(() => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("m") && !target.current && (listOpen || (h.get("t") || "") !== place)) history.replaceState(null, "", location.pathname);
  }, [place, listOpen]);

  const menuSwipe = useMenuSwipe(menu, setMenu, !listOpen && !chatsOn);  // with home as the first screen, the panel is settings: opened by its button, not by a swipe

  // New voice notes from wolts play one after another, unless you picked something to hear yourself.
  const playing = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (playing.current || !fresh.length) return;
    const [next, ...rest] = fresh;
    const m = msgs.find((x) => x.id === next.id);
    if (!m || m.kind !== "wolt" || !m.audio || relayRoom) { setFresh(rest); return; }
    const a = new Audio("/voice/" + m.audio); playing.current = a;
    const done = () => { playing.current = null; setFresh(rest); };
    a.onended = done; a.onerror = done;
    a.play().catch(() => { playing.current = null; setError("Tap to hear new voice notes"); });
  }, [fresh, msgs]);
  useEffect(() => {
    const tap = () => { if (error === "Tap to hear new voice notes") { setError(""); setFresh((f) => [...f]); } };  // only when it asked for a tap: any other tap is yours
    const mine = (e: Event) => { document.querySelectorAll("audio").forEach((a) => a !== e.target && a.pause()); playing.current?.pause(); playing.current = null; setFresh([]); };
    document.addEventListener("pointerdown", tap); document.addEventListener("play", mine, true);
    return () => { document.removeEventListener("pointerdown", tap); document.removeEventListener("play", mine, true); };
  }, [error]);

  const report = (e: string | null) => setError(e || "");
  const push = usePush(report);
  const where = (t?: string) => (t ? `&thread=${t}` : "");
  const stick = () => (place ? stickThread : stickMain).current();
  // A voice note waits on this phone until the room has it. If it doesn't get there, it stays with "Tap to send again".
  type Typed = { cid: string; text: string; thread?: string };
  const outgoing = useRef(new Map<string, Outgoing | Typed>());
  // A voice note shows as sent the moment you tap send; the room's copy takes its place under the same id once the
  // words are written down. The recording joins it a moment later, when the phone has handed it over.
  const voiceAt = useRef(new Map<string, { thread?: string; at: number }>());
  function voiceStart(seconds: number) {
    const cid = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t = place || undefined, at = Date.now() / 1000;
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
    const r = await send(`/api/voice?seconds=${o.seconds}&cid=${o.cid}${where(o.thread)}`, { method: "POST", headers: { "Content-Type": o.type }, body: o.blob });
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
    report(r ? ((await r.json().catch(() => ({}))) as { error?: string }).error || "That didn't send." : "Can't reach the room.");
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
    const t = place || undefined;
    // all of them in one message, one after another in the body; their sizes tell the room where each ends
    const q = list.map((f) => `name=${encodeURIComponent(f.name)}&size=${f.size}`).join("&");
    report(await say(`/api/files?${q}&text=${encodeURIComponent(text)}${where(t)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Blob(list) }));
  }
  function mic() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return setError("This browser can't record here.");
    setListening(null);
  }
  // what you type shows at once, then becomes the room's copy as soon as the room has it (no wait for the next poll)
  async function text(t: string) {
    stick();
    const o: Typed = { cid: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, thread: place || undefined };
    setMsgs((m) => [...m, { id: o.cid, cid: o.cid, n: after.current + 0.9, at: Date.now() / 1000, kind: "human", email: state.me, text: t, pending: true, thread: o.thread }]);
    sendTyped(o);
  }
  // every try carries the same name (cid), so if the room got an earlier one, it answers with that copy instead of posting again
  async function sendTyped(o: Typed) {
    outgoing.current.set(o.cid, o);
    shown(o.cid, { pending: true, failed: false });
    settle(o.cid, await send("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: o.text, cid: o.cid, ...(o.thread ? { thread: o.thread } : {}) }) }));
  }

  const me = state.members.wolts.find((w) => w.owner === state.me);
  const composer = <Composer key={place || "main"} draft={place || "main"} wolts={state.members.wolts} people={state.members.people} working={state.working || {}} host={state.host} me={state.me} onText={text} onFiles={files} onMic={mic} placeholder={chat ? `message ${chat.wolts.join(chat.wolts.length === 2 ? " and " : ", ")}…` : thread ? "$ reply in thread" : undefined} />;
  // on the desk: the wolts of the open thread (or every wolt that isn't paused, in the main chat)
  const deskWolts = state.members.wolts.filter((w) => !w.paused && (!place || !state.who || (state.main === w.wolt && !chatId) || state.who[place]?.[w.wolt] === "in"));
  const toHome = () => { setThread(""); setNav({ at: "home" }); };
  const woltOf = (name: string) => state.members.wolts.find((w) => w.wolt === name);
  const homeList = (compact: boolean, only?: "wolts" | "people" | "groups") => <HomeList only={only} onBack={toHome} onAll={(what) => { setThread(""); setNav({ at: "all", what }); }} state={state} ctx={ctx} chats={chats} compact={compact} sel={selWolt} here={nav.at === "everyone" ? "everyone" : chatId}
    everyone={{ at: main.at(-1)?.at, fresh: inboxCount }} onWolt={(w) => { setThread(""); setNav({ at: "wolt", wolt: w }); }} onChat={(id) => openChat(id)}
    onEveryone={() => { setNav({ at: "everyone" }); stickMain.current(); }} onNew={() => setNav({ at: "new", wolts: [] })} bell={notes.filter((n) => n.fresh).length} onBell={() => { setThread(""); setNav({ at: "bell" }); }} onInvite={state.me ? invite : undefined} onRename={rename}
    onHat={state.faces ? (face) => say("/api/face", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ face }) }) : undefined} onAgent={relayRoom ? undefined : () => setAdding(true)} onDesk={wide && compact ? () => setDesk(true) : undefined} />;
  const woltList = (name: string, compact = false) => <WoltChats w={woltOf(name)!} state={state} ctx={ctx} chats={chats} compact={compact} here={chatId} onBack={toHome}
    onChat={(id) => openChat(id, name)} onNew={() => setNav({ at: "new", wolts: [name], wolt: name })} onCard={setCard} onRename={rename} />;
  const back = () => (nav.at === "chat" || nav.at === "new") && nav.wolt && woltOf(nav.wolt) ? setNav({ at: "wolt", wolt: nav.wolt }) : toHome();
  goBack.current = back;
  const cardWolt = card ? woltOf(card) : undefined;
  const cardView = cardWolt && <ContactCard wolt={cardWolt} ctx={ctx} host={state.host} look={state.looks?.[cardWolt.wolt]} onClose={() => setCard("")}
    onNewChat={(w) => { setCard(""); setNav({ at: "new", wolts: [w], wolt: w }); }} />;
  const menuEl = <Menu open={menu} panel={menuSwipe.panel} scrim={menuSwipe.scrim} touch={menuSwipe.menu} close={() => setMenu(false)} title={state.title || "shell"} me={state.me} host={state.host} wolts={state.members.wolts} people={state.members.people} push={push} freshCount={inboxCount} onThreads={() => setListOpen(true)} onAgent={() => setAdding(true)} main={state.main} />;
  const screen = <>
      {nav.at === "everyone" && <>
      <header ref={hdr} className="relative flex-none flex items-center gap-2 pl-1.5 pr-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-paper border-b border-line">
        {/* ☰ stays above the menu and turns into ✕, so tapping the same spot opens and closes it */}
        {chatsOn ? (!wideCols && <button type="button" aria-label="Back to your wolts" onClick={toHome} className="flex-none w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={26} /></button>)
        : <button type="button" aria-label={menu ? "Close menu" : "Menu"} onClick={() => setMenu(!menu)}
          className={`relative ${menu ? "z-[1720]" : ""} flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer rounded-[10px]`}>
          {menu ? <X size={22} /> : <MenuIcon size={22} />}
          {!menu && push.ask && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-acc" />}
        </button>}
        <span className="relative flex-none w-12 h-12 rounded-full bg-[#f5f1e8] ring-1 ring-line"><img src="/room-icon.png" alt="" className="absolute inset-1 w-10 h-10 rounded-full" /><Live link={link === "open" ? line : link === "connecting" ? "retry" : "down"} /></span>
        <div className="min-w-0 flex-1">
          <div className="font-mono font-semibold text-acc truncate"><span className="text-dim">~/</span><span className="cursor">{chatsOn ? "everyone" : state.title || "shell"}</span></div>
          <div className="font-mono text-[11px] text-dim truncate">{[...state.members.people.map((p) => p.name), ...state.members.wolts.map((w) => w.wolt)].join(", ")}</div>
        </div>
        {wide && <button type="button" aria-label={desk ? "Hide the terminals" : "Show the terminals"} title="desk: your wolts' terminals" onClick={() => setDesk(!desk)}
          className={`flex-none w-10 h-10 grid place-items-center border-0 cursor-pointer rounded-[10px] ${desk ? "bg-acc text-white" : "bg-transparent text-acc"}`}><Monitor size={20} /></button>}
        {/* with home as the first screen, the bell is the one place for what's new; a room from before keeps its inbox */}
        {chatsOn ? <button type="button" aria-label="Notifications" title="Notifications" onClick={() => { setThread(""); setNav({ at: "bell" }); }} className="relative flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer">
          <Bell size={21} />{notes.filter((n) => n.fresh).length > 0 && <span className="absolute top-0.5 right-0 min-w-4 h-4 px-1 rounded-full bg-acc text-white font-mono font-semibold text-[10px] leading-4 text-center">{Math.min(99, notes.filter((n) => n.fresh).length)}</span>}
        </button> :
        <button type="button" aria-label="Inbox" onClick={() => setListOpen(!listOpen)} className="relative flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer">
          <Inbox size={22} />{inboxCount > 0 && <span className="absolute top-0.5 right-0 min-w-4 h-4 px-1 rounded-full bg-acc text-white font-mono font-semibold text-[10px] leading-4 text-center">{inboxCount}</span>}
        </button>}
      </header>
      <Feed list={main} ctx={ctx} working={state.working || {}} away={state.unreachable} replies={replies} seen={seen} open={open} stick={stickMain} />
      {!thread && composer}
      {listOpen && <InboxSheet top={hdrH} main={mainFresh} roots={roots} replies={replies} ctx={ctx} seen={seen} current={thread}
        onMain={() => { setListOpen(false); setThread(""); stickMain.current(); }} onOpen={(id) => { setListOpen(false); open(id); }} onClose={() => setListOpen(false)} />}
      {thread && <ThreadSheet key={thread} color={threadColor(thread)} title={threadTitle(root)} count={(replies.get(thread) || []).length} close={() => { const was = thread; setThread((t) => (t === was ? "" : t)); }}
        who={<ThreadWho thread={thread} list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={ctx}
          room={state.who ? state.who[thread] || {} : undefined} fallback={state.who_default} host={state.host} main={state.main} />}>
        <Feed list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={ctx} working={state.working || {}} away={state.unreachable} divider={(replies.get(thread) || []).length} seen={seen} stick={stickThread} place={thread} />
        {composer}
      </ThreadSheet>}
      </>}
      {nav.at === "chat" && (chat ? <>
        <ChatHeader chat={chat} ctx={ctx} compact={wideCols} onBack={back} onCard={setCard}
          onRename={(title) => rename(chat.id, title)}
          who={<ThreadWho thread={chat.id} list={chatList} ctx={ctx} room={state.who ? state.who[chat.id] || {} : undefined} fallback={state.who_default} host={state.host} main={state.main} />} />
        <Feed list={chatList} ctx={ctx} working={state.working || {}} away={state.unreachable} seen={seen} stick={stickThread} place={chatId} />
        {composer}
      </> : <Standby state={state} />)}
      {nav.at === "new" && <NewChat key={nav.wolts.join()} state={state} ctx={ctx} start={nav.wolts} onStart={startChat}
        onBack={back} />}
      {nav.at === "all" && homeList(false, nav.what)}
      {nav.at === "bell" && <BellScreen notes={notes} ctx={ctx} push={push} compact={wideCols} onBack={toHome} onReadAll={() => { for (const n of notes) if (n.fresh) mark(n.place || "main", n.m.n); }}
        onOpen={(n) => { if (n.chat) openChat(n.place); else { setNav({ at: "everyone" }); setThread(n.place); } }} />}
      {(nav.at === "home" || nav.at === "wolt") && (wideCols ? <Standby state={state} /> : nav.at === "wolt" && woltOf(nav.wolt) ? woltList(nav.wolt) : homeList(false))}
  </>;
  const room = (
    <div className="h-full flex flex-col relative bg-paper" {...menuSwipe.screen}>
      {stacked ? <>
        <div className="absolute inset-0" aria-hidden inert>{(nav.at === "chat" || nav.at === "new") && nav.wolt && woltOf(nav.wolt) ? woltList(nav.wolt) : homeList(false)}</div>
        <div key={nav.at + (nav.at === "chat" ? nav.id : nav.at === "wolt" ? nav.wolt : "")} ref={swipe.el} onTouchStart={(e) => { if (!thread && !listOpen && !card) swipe.handlers.onTouchStart(e); }}
          onTouchMove={swipe.handlers.onTouchMove} onTouchEnd={swipe.handlers.onTouchEnd} className="absolute inset-0 flex flex-col bg-paper animate-[slidein_.2s_ease-out]">{screen}</div>
      </> : screen}
      {cardView && !wideCols && <div className="absolute inset-0 z-[1560] bg-paper animate-[fadein_.15s_ease-out]">{cardView}</div>}
      {!chatsOn && menuEl}
      {adding && <AddAgentSheet me={state.me} onClose={() => setAdding(false)} />}
      {loading && !naming && <Opening problem={error} />}
      {naming && <NameFirst done={() => setNaming(false)} />}
      {relayRoom && (relayKeyMissing || (link !== "open" && !(naming && link === "connecting"))) && <Offline missing={relayKeyMissing} state={link} />}
      {error && <div onClick={() => setError("")} className="absolute left-1/2 -translate-x-1/2 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[1600] font-mono text-xs bg-panel text-acc border border-acc px-3 py-1.5 rounded-lg cursor-pointer shadow-[0_2px_10px_#18100a1f]">&gt; {error}</div>}
      {listening !== false && <Listening sprite={woltAvatar(me?.creature || "raccoon", person(state.me).color)} audio={listening} onSend={voiceStart} onDone={voice} />}
      {viewing && <Viewer urls={viewing.urls} names={viewing.names} at={viewing.at} close={() => setViewing(null)} />}
      {paging && <PageViewer key={paging} id={paging} mark={state.pages?.[paging]} ctx={ctx} close={() => setPaging("")} />}
    </div>
  );
  if (wideCols) return <div className="h-full flex relative overflow-hidden">
    <aside className="flex-none w-[300px] h-full border-r border-line">{homeList(true)}</aside>
    {selWolt && woltOf(selWolt) && <aside className="flex-none w-[270px] h-full border-r border-line">{woltList(selWolt, true)}</aside>}
    <div className="flex-1 min-w-0 h-full relative overflow-hidden [transform:translateZ(0)]">{room}</div>
    {cardView && <aside className="flex-none w-[340px] h-full border-l border-line">{cardView}</aside>}
  </div>;
  if (!desk) return room;
  return <div className="h-full flex">
    <Suspense fallback={<div className="flex-1 bg-[#2a231c]" />}>
      <div className="relative flex-1 min-w-0 flex">
        <Desk ctx={ctx} wolts={deskWolts} working={new Set(Object.keys(state.working || {}))} focus={focus} />
        {/* always a way out of the terminals, whatever the chat column is showing */}
        <button type="button" onClick={() => setDesk(false)} aria-label="Close the terminals" title="Close the terminals"
          className="absolute top-2 right-2 z-20 flex items-center gap-1.5 h-9 pl-2.5 pr-3 rounded-full border-0 bg-[#fffdf6] text-acc font-mono font-semibold text-xs cursor-pointer shadow-[0_2px_10px_#0006]"><X size={16} />close terminals</button>
      </div>
    </Suspense>
    {/* its own box for everything fixed inside (menu, sheets), so they stay in the chat column */}
    <div className="flex-none w-[460px] h-full border-l border-line relative overflow-hidden [transform:translateZ(0)]">{room}</div>
  </div>;
}
