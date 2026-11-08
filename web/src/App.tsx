// Shell Phone, our own page. Same room, same look as the classic page, but every piece is ours to change.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./Composer";
import { Listening, type Recording } from "./Listening";
import { Message, type Ctx } from "./Message";
import { say, send, useRoom, type Msg } from "./room";
import { drop, keep, waiting, type Outgoing } from "./outbox";
import { LORE, woltAvatar } from "./sprites";
import { RecentStrip, ThreadLine, ThreadList, threadColor, threadTitle, unread, useRecent, useSeen } from "./Threads";
import { Menu } from "./Menu";
import { ChevronLeft, Menu as MenuIcon, MessagesSquare, X } from "lucide-react";
import { usePush } from "./push";

// iPhone Safari doesn't shrink the page for the keyboard, so size the app to the part of the screen still visible.
function useFit() {
  useEffect(() => {
    const fit = () => {
      document.documentElement.style.setProperty("--vh", window.visualViewport ? Math.round(visualViewport!.height) + "px" : "100dvh");
      window.scrollTo(0, 0);
    };
    const pin = () => window.scrollTo(0, 0);  // Safari slides the page while you type: put it back, without resizing anything
    fit();
    visualViewport?.addEventListener("resize", fit);
    visualViewport?.addEventListener("scroll", pin);
    return () => { visualViewport?.removeEventListener("resize", fit); visualViewport?.removeEventListener("scroll", pin); };
  }, []);
}

// Who's working: a fixed one-line slot under the last message, wolts side by side, chewing on a line of lore.
function Gnaw({ ctx, working }: { ctx: Ctx; working: Record<string, unknown> }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 2400); return () => clearInterval(t); }, []);
  const on = ctx.wolts.filter((w) => working[w.wolt]);
  return <div className="flex items-center gap-1.5 h-[38px] px-3 pb-2 overflow-hidden">
    {on.map((w) => { const lines = LORE[w.creature] || LORE.beaver;
      return <div key={w.wolt} className="gnaw-row flex-[0_1_auto] min-w-0 flex items-center gap-1.5 pl-[3px] pr-[9px] py-[3px] bg-[#fffdf6ee] border border-line rounded-lg font-mono font-semibold text-xs whitespace-nowrap">
        <img src={woltAvatar(w.creature, ctx.person(w.owner).color)} alt="" className="gnaw-img pixel flex-none w-6 h-6" />
        <span key={tick} className="lore new overflow-hidden text-ellipsis">{w.wolt}: {lines[(tick + w.wolt.length) % lines.length]}</span>
      </div>; })}
  </div>;
}

function Viewer({ url, close }: { url: string; close: () => void }) {
  const [big, setBig] = useState(false);
  return <div className="fixed inset-0 z-[3000] bg-[#000e] grid place-items-center overflow-auto" onClick={(e) => e.target === e.currentTarget && close()}>
    <img src={url} alt="" onDoubleClick={() => setBig(!big)} className={big ? "max-w-none w-[250vw]" : "max-w-[100vw] max-h-[100dvh] object-contain"} />
    <button type="button" aria-label="Close" onClick={close} className="fixed top-[calc(14px+env(safe-area-inset-top))] right-3.5 w-10 h-10 border-0 rounded-full bg-[#fff3] text-white text-xl cursor-pointer">✕</button>
  </div>;
}

// A list of messages that stays at the bottom while you're there, and leaves you alone if you scrolled up to read.
// Used for the main chat and for a thread alike.
function Feed({ list, ctx, working, replies, seen, open, divider, stick }: {
  list: Msg[]; ctx: Ctx; working: Record<string, unknown>; replies?: Map<string, Msg[]>; seen?: Record<string, number>;
  open?: (id: string) => void; divider?: number; stick: React.MutableRefObject<(on?: boolean) => void>;
}) {
  const scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
  stick.current = (on = true) => { stuck.current = on; };
  const last = list.at(-1);
  useLayoutEffect(() => { const s = scroller.current; if (s && stuck.current) s.scrollTop = s.scrollHeight; }, [list.length, last?.pending, working, replies]);
  // the keyboard opening, the suggestion bar, or the text box growing a line all shrink the chat: keep the last message in view
  useEffect(() => {
    const s = scroller.current; if (!s) return;
    const ro = new ResizeObserver(() => { if (stuck.current) s.scrollTop = s.scrollHeight; });
    ro.observe(s);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => { const s = scroller.current!; stuck.current = s.scrollHeight - s.scrollTop - s.clientHeight < 80; };
  let lastDay = "", lastWho = "";
  return <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain pt-1">
    {list.length === 0 && <p className="text-center text-dim font-mono text-xs mt-10 px-6">Nobody has said anything yet. Tag a wolt with @ to bring it in.</p>}
    {list.map((m, i) => {
      const d = new Date(m.at * 1000), day = d.toLocaleDateString([], { day: "numeric", month: "long" });
      const who = m.kind === "human" ? m.email! : "wolt:" + m.wolt, newDay = day !== lastDay;
      const thread = replies?.get(m.id) || [], mine = m.kind === "human" && m.email === ctx.me;
      const run = newDay || who !== lastWho;
      lastDay = day; lastWho = thread.length ? "" : who;  // a thread line breaks the run, so the next bubble shows its name
      const side = `px-2.5 ${mine ? "pr-[46px] text-right" : "pl-[46px]"}`;
      return <div key={m.cid || m.id} data-mid={m.id}>
        {newDay && <div className="text-center my-3"><span className="font-mono text-[11px] uppercase text-dim bg-panel border border-line rounded-lg px-2.5 py-1">{day}</span></div>}
        {/* like Slack: tap a message to open its thread (links, players, pictures and a voice note's words keep their own tap) */}
        <div className={open && !m.pending && !m.failed ? "cursor-pointer active:opacity-60 transition-opacity" : ""}
          onClick={(e) => { if (open && !m.pending && !m.failed && !(e.target as HTMLElement).closest("button,a,audio,video,img,[data-tap]")) open(m.id); }}>
          <Message m={m} ctx={ctx} firstOfRun={run} />
        </div>
        {divider !== undefined && i === 0 && <div className="flex items-center gap-2.5 px-3.5 my-3 font-mono text-[11px] text-dim">
          <span>{divider} {divider === 1 ? "reply" : "replies"}</span><span className="flex-1 h-px bg-line" /></div>}
        {thread.length > 0 && open && <div className={side}>
          <ThreadLine root={m} list={thread} fresh={unread(thread, seen?.[m.id], ctx.me)} onOpen={() => open(m.id)} /></div>}
      </div>;
    })}
    <Gnaw ctx={ctx} working={working} />
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

export function App() {
  useFit();
  const { state, msgs, setMsgs, error, setError, person, fresh, setFresh, after } = useRoom();
  const [listening, setListening] = useState<AudioContext | null | false>(false);
  const [viewing, setViewing] = useState("");
  const [thread, setThread] = useState("");  // the message whose thread is open
  const retryRef = useRef((_cid: string) => {});
  const stickMain = useRef((_on?: boolean) => {}), stickThread = useRef((_on?: boolean) => {});
  const ctx: Ctx = { me: state.me, person, wolts: state.members.wolts, people: state.members.people, seen: state.seen || {}, all: msgs, view: setViewing, retry: (cid) => retryRef.current(cid) };

  // Threads the Matrix way: a reply carries the id of the message its thread hangs off. The main chat shows only the rest.
  const { main, replies } = useMemo(() => {
    const replies = new Map<string, Msg[]>(), main: Msg[] = [];
    for (const m of msgs) {
      if (m.thread) replies.set(m.thread, [...(replies.get(m.thread) || []), m]);
      else main.push(m);
    }
    return { main, replies };
  }, [msgs]);
  const root = thread ? msgs.find((m) => m.id === thread) : undefined;
  const [listOpen, setListOpen] = useState(() => !location.hash.includes("m="));  // home: the threads list
  const [menu, setMenu] = useState(false);
  const { recent, touch } = useRecent();
  const open = (id: string) => { touch(id); setThread(id); };  // opened from the threads list, back returns to it
  const { seen, mark } = useSeen();
  // an open thread counts as read, including replies that arrive while you're in it
  useEffect(() => { const r = replies.get(thread); if (thread && r?.length) mark(thread, r.at(-1)!.n); }, [thread, replies]);
  const roots = main.filter((m) => replies.has(m.id));
  const rootMap = useMemo(() => new Map(msgs.filter((m) => replies.has(m.id)).map((m) => [m.id, m])), [msgs, replies]);
  const freshCount = roots.filter((r) => unread(replies.get(r.id)!, seen[r.id], state.me)).length;
  const swipe = useSwipeBack(() => setThread(""));

  // Where the app opens. A tapped notification lands on its message: inside its thread if it's a reply, or the main
  // chat scrolled to it. Opening it normally, or coming back after a while, lands home: the threads list.
  const target = useRef<{ m: string; t: string } | null>(null);
  const [landing, setLanding] = useState(0);
  const goTo = (url: string) => {
    const h = new URLSearchParams(new URL(url, location.href).hash.slice(1));
    if (!h.get("m")) return;
    target.current = { m: h.get("m")!, t: h.get("t") || "" };
    history.replaceState(null, "", location.pathname);
    setMenu(false); setListOpen(false);
    if (target.current.t) open(target.current.t); else setThread("");  // no jump to the bottom: we're going to the message
    setLanding((x) => x + 1);
    const mine = target.current; setTimeout(() => { if (target.current === mine) target.current = null; }, 8000);  // not here after all: let it go
  };
  useEffect(() => {
    goTo(location.href);
    const fromNote = (e: MessageEvent) => { if (e.data?.type === "open") goTo(e.data.url); };
    navigator.serviceWorker?.addEventListener("message", fromNote);
    let hidden = 0;
    const seen = () => {
      if (document.hidden) { hidden = Date.now(); return; }
      if (hidden && Date.now() - hidden > 10 * 60_000 && !target.current) { setThread(""); setListOpen(true); setMenu(false); stickMain.current(); }
    };
    document.addEventListener("visibilitychange", seen);
    return () => { navigator.serviceWorker?.removeEventListener("message", fromNote); document.removeEventListener("visibilitychange", seen); };
  }, []);
  // once that message is on screen, bring it into view and light it up for a moment
  useEffect(() => {
    const t = target.current; if (!t) return;
    const el = [...document.querySelectorAll<HTMLElement>(`[data-mid="${CSS.escape(t.m)}"]`)].at(-1); if (!el) return;
    target.current = null;
    // after the feeds have done their own scrolling for this render, so "stay at the bottom" doesn't undo it
    (t.t ? stickThread : stickMain).current(false);  // reading back here: stop following the newest
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center" }); el.classList.add("landed"); setTimeout(() => el.classList.remove("landed"), 1600);
    }));
  }, [msgs, thread, landing]);
  const listSwipe = useSwipeBack(() => setListOpen(false));
  const menuSwipe = useMenuSwipe(menu, setMenu, !thread && !listOpen);

  // New voice notes from wolts play one after another, unless you picked something to hear yourself.
  const playing = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (playing.current || !fresh.length) return;
    const [next, ...rest] = fresh;
    const m = msgs.find((x) => x.id === next.id);
    if (!m || m.kind !== "wolt" || !m.audio) { setFresh(rest); return; }
    const a = new Audio("/voice/" + m.audio); playing.current = a;
    const done = () => { playing.current = null; setFresh(rest); };
    a.onended = done; a.onerror = done;
    a.play().catch(() => { playing.current = null; setError("Tap to hear new voice notes"); });
  }, [fresh, msgs]);
  useEffect(() => {
    const tap = () => { if (error === "Tap to hear new voice notes") setError(""); setFresh((f) => [...f]); };
    const mine = (e: Event) => { document.querySelectorAll("audio").forEach((a) => a !== e.target && a.pause()); playing.current?.pause(); playing.current = null; setFresh([]); };
    document.addEventListener("pointerdown", tap); document.addEventListener("play", mine, true);
    return () => { document.removeEventListener("pointerdown", tap); document.removeEventListener("play", mine, true); };
  }, [error]);

  const report = (e: string | null) => setError(e || "");
  const push = usePush(report);
  const where = (t?: string) => (t ? `&thread=${t}` : "");
  const stick = () => (thread ? stickThread : stickMain).current();
  // A voice note waits on this phone until the room has it. If it doesn't get there, it stays with "Tap to send again".
  type Typed = { cid: string; text: string; thread?: string };
  const outgoing = useRef(new Map<string, Outgoing | Typed>());
  async function voice(r: Recording | null) {
    setListening(false);
    if (!r) return;
    // shows as sent right away; the room's copy takes its place under the same id once the words are written down
    const cid = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t = thread || undefined;
    const o: Outgoing = { cid, owner: state.me, blob: r.blob, type: r.type, seconds: r.seconds, thread: t, at: Date.now() / 1000 };
    const local: Msg = { id: cid, cid, n: after.current + 0.9, at: o.at, kind: "human", email: state.me, text: "", audio: "local", localUrl: URL.createObjectURL(r.blob), seconds: r.seconds, pending: true, thread: t };
    setMsgs((m) => [...m, local]); stick();
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
    const t = thread || undefined;
    for (const [i, f] of list.entries())
      report(await say(`/api/files?name=${encodeURIComponent(f.name)}&text=${encodeURIComponent(i === 0 ? text : "")}${where(t)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f }));
  }
  function mic() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return setError("This browser can't record here.");
    setListening(null);
  }
  // what you type shows at once, then becomes the room's copy as soon as the room has it (no wait for the next poll)
  async function text(t: string) {
    stick();
    const o: Typed = { cid: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, thread: thread || undefined };
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
  const composer = <Composer key={thread || "main"} draft={thread || "main"} wolts={state.members.wolts} me={state.me} onText={text} onFiles={files} onMic={mic} placeholder={thread ? "$ reply in thread" : undefined} />;
  return (
    <div className="h-full flex flex-col relative" {...menuSwipe.screen}>
      <header className="flex-none flex items-center gap-2 pl-1.5 pr-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-panel border-b border-line">
        {/* ☰ stays above the menu and turns into ✕, so tapping the same spot opens and closes it */}
        <button type="button" aria-label={menu ? "Close menu" : "Menu"} onClick={() => setMenu(!menu)}
          className={`relative ${menu ? "z-[1720]" : ""} flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer rounded-[10px]`}>
          {menu ? <X size={22} /> : <MenuIcon size={22} />}
          {!menu && push.ask && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-acc" />}
        </button>
        <img src="/room-icon.png" alt="" className="w-9 h-9 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="font-mono font-semibold text-acc truncate"><span className="text-dim">~/</span><span className="cursor">{state.title || "shell"}</span></div>
          <div className="font-mono text-[11px] text-dim truncate">{[...state.members.people.map((p) => p.name), ...state.members.wolts.map((w) => w.wolt)].join(", ")}</div>
        </div>
        <button type="button" aria-label="Threads" onClick={() => setListOpen(true)} className="relative flex-none w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer">
          <MessagesSquare size={22} />{freshCount > 0 && <span className="absolute top-0.5 right-0 min-w-4 h-4 px-1 rounded-full bg-acc text-white font-mono font-semibold text-[10px] leading-4 text-center">{freshCount}</span>}
        </button>
      </header>
      <Feed list={main} ctx={ctx} working={state.working || {}} replies={replies} seen={seen} open={open} stick={stickMain} />
      {!thread && composer}
      {listOpen && !thread && <div ref={listSwipe.el} {...listSwipe.handlers} className="absolute inset-0 z-[1500] will-change-transform">
        <ThreadList roots={roots} replies={replies} ctx={ctx} seen={seen} onOpen={open} onClose={listSwipe.back} /></div>}
      {thread && <div ref={swipe.el} {...swipe.handlers} className="absolute inset-0 z-[1550] bg-paper flex flex-col will-change-transform animate-[slidein_.22s_cubic-bezier(.2,.8,.2,1)]">
        <header className="flex-none flex items-center gap-2 px-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-panel border-b border-line" style={{ boxShadow: `inset 4px 0 0 ${threadColor(thread)}` }}>
          <button type="button" aria-label="Back" onClick={swipe.back} className="w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={24} /></button>
          <div className="min-w-0 flex-1">
            <div className="font-mono font-semibold truncate" style={{ color: threadColor(thread) }}>{threadTitle(root)}</div>
            <div className="font-mono text-[11px] text-dim truncate">{(replies.get(thread) || []).length} replies · started by {root ? (root.kind === "human" ? person(root.email).name : root.wolt) : ""}</div>
          </div>
        </header>
        <RecentStrip ids={recent} current={thread} roots={rootMap} replies={replies} seen={seen} me={state.me} onOpen={open} onAll={() => { setThread(""); setListOpen(true); }} />
        <Feed list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={ctx} working={state.working || {}} divider={(replies.get(thread) || []).length} stick={stickThread} />
        {composer}
      </div>}
      <Menu open={menu} panel={menuSwipe.panel} scrim={menuSwipe.scrim} touch={menuSwipe.menu} close={() => setMenu(false)} title={state.title || "shell"} me={state.me} push={push} freshCount={freshCount} onThreads={() => { setThread(""); setListOpen(true); }} />
      {error && <div onClick={() => setError("")} className="absolute left-1/2 -translate-x-1/2 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[1600] font-mono text-xs bg-panel text-acc border border-acc px-3 py-1.5 rounded-lg cursor-pointer shadow-[0_2px_10px_#18100a1f]">&gt; {error}</div>}
      {listening !== false && <Listening sprite={woltAvatar(me?.creature || "raccoon", person(state.me).color)} audio={listening} onDone={voice} />}
      {viewing && <Viewer url={viewing} close={() => setViewing("")} />}
    </div>
  );
}
