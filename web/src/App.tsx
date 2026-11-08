// Shell Phone, our own page. Same room, same look as the classic page, but every piece is ours to change.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./Composer";
import { Listening, type Recording } from "./Listening";
import { Message, type Ctx } from "./Message";
import { say, sendText, useRoom, type Msg } from "./room";
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
  open?: (id: string) => void; divider?: number; stick: React.MutableRefObject<() => void>;
}) {
  const scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
  stick.current = () => { stuck.current = true; };
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
      return <div key={m.cid || m.id}>
        {newDay && <div className="text-center my-3"><span className="font-mono text-[11px] uppercase text-dim bg-panel border border-line rounded-lg px-2.5 py-1">{day}</span></div>}
        {/* like Slack: tap a message to open its thread (links, players, pictures and a voice note's words keep their own tap) */}
        <div className={open && !m.pending ? "cursor-pointer active:opacity-60 transition-opacity" : ""}
          onClick={(e) => { if (open && !m.pending && !(e.target as HTMLElement).closest("button,a,audio,video,img,[data-tap]")) open(m.id); }}>
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
// Leave a thread like going back on iPhone: drag from the left edge to the right. The screen follows your finger.
function useSwipeBack(close: () => void) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    dx,
    handlers: {
      onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; start.current = t.clientX < 28 ? { x: t.clientX, y: t.clientY } : null; },
      onTouchMove: (e: React.TouchEvent) => {
        const s = start.current, t = e.touches[0]; if (!s) return;
        if (Math.abs(t.clientY - s.y) > Math.abs(t.clientX - s.x) && dx === 0) { start.current = null; return; }  // that's a scroll
        setDx(Math.max(0, t.clientX - s.x));
      },
      onTouchEnd: () => { if (start.current && dx > 90) close(); start.current = null; setDx(0); },
    },
  };
}

export function App() {
  useFit();
  const { state, msgs, setMsgs, error, setError, person, fresh, setFresh, after } = useRoom();
  const [listening, setListening] = useState<AudioContext | null | false>(false);
  const [viewing, setViewing] = useState("");
  const [thread, setThread] = useState("");  // the message whose thread is open
  const stickMain = useRef(() => {}), stickThread = useRef(() => {});
  const ctx: Ctx = { me: state.me, person, wolts: state.members.wolts, people: state.members.people, seen: state.seen || {}, all: msgs, view: setViewing };

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
  const [listOpen, setListOpen] = useState(false);
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
  async function voice(r: Recording | null) {
    setListening(false);
    if (!r) return;
    // shows as sent right away; the room's copy takes its place under the same id once the words are written down
    const cid = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t = thread || undefined;
    const local: Msg = { id: cid, cid, n: after.current + 0.9, at: Date.now() / 1000, kind: "human", email: state.me, text: "", audio: "local", localUrl: URL.createObjectURL(r.blob), seconds: r.seconds, pending: true, thread: t };
    setMsgs((m) => [...m, local]); stick();
    const err = await say(`/api/voice?seconds=${r.seconds}&cid=${cid}${where(t)}`, { method: "POST", headers: { "Content-Type": r.type }, body: r.blob });
    if (err) setMsgs((m) => m.map((x) => (x.cid === cid ? { ...x, pending: false, text: "didn't send: tap the mic to try again" } : x)));
    report(err);
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
  const text = (t: string) => { stick(); sendText(t, thread || undefined).then(report); };

  const me = state.members.wolts.find((w) => w.owner === state.me);
  const composer = <Composer wolts={state.members.wolts} me={state.me} onText={text} onFiles={files} onMic={mic} placeholder={thread ? "$ reply in thread" : undefined} />;
  return (
    <div className="h-full flex flex-col relative">
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
      {listOpen && !thread && <ThreadList roots={roots} replies={replies} ctx={ctx} seen={seen} onOpen={open} onClose={() => setListOpen(false)} />}
      {thread && <div {...swipe.handlers} style={swipe.dx ? { transform: `translateX(${swipe.dx}px)`, boxShadow: "-8px 0 24px #18100a22" } : undefined}
        className={`absolute inset-0 z-[1550] bg-paper flex flex-col ${swipe.dx ? "" : "transition-transform duration-200 animate-[fadein_.18s_ease-out]"}`}>
        <header className="flex-none flex items-center gap-2 px-2 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-panel border-b border-line" style={{ boxShadow: `inset 4px 0 0 ${threadColor(thread)}` }}>
          <button type="button" aria-label="Back" onClick={() => setThread("")} className="w-10 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer"><ChevronLeft size={24} /></button>
          <div className="min-w-0 flex-1">
            <div className="font-mono font-semibold truncate" style={{ color: threadColor(thread) }}>{threadTitle(root)}</div>
            <div className="font-mono text-[11px] text-dim truncate">{(replies.get(thread) || []).length} replies · started by {root ? (root.kind === "human" ? person(root.email).name : root.wolt) : ""}</div>
          </div>
        </header>
        <RecentStrip ids={recent} current={thread} roots={rootMap} replies={replies} seen={seen} me={state.me} onOpen={open} onAll={() => { setThread(""); setListOpen(true); }} />
        <Feed list={root ? [root, ...(replies.get(thread) || [])] : []} ctx={ctx} working={state.working || {}} divider={(replies.get(thread) || []).length} stick={stickThread} />
        {composer}
      </div>}
      <Menu open={menu} close={() => setMenu(false)} title={state.title || "shell"} me={state.me} push={push} freshCount={freshCount} onThreads={() => { setThread(""); setListOpen(true); }} />
      {error && <div onClick={() => setError("")} className="absolute left-1/2 -translate-x-1/2 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[1600] font-mono text-xs bg-panel text-acc border border-acc px-3 py-1.5 rounded-lg cursor-pointer shadow-[0_2px_10px_#18100a1f]">&gt; {error}</div>}
      {listening !== false && <Listening sprite={woltAvatar(me?.creature || "raccoon", person(state.me).color)} audio={listening} onDone={voice} />}
      {viewing && <Viewer url={viewing} close={() => setViewing("")} />}
    </div>
  );
}
