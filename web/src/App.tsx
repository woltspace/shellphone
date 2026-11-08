// Shell Phone, our own page. Same room, same look as the classic page, but every piece is ours to change.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Composer } from "./Composer";
import { Listening, type Recording } from "./Listening";
import { Message, type Ctx } from "./Message";
import { say, sendText, useRoom, type Msg } from "./room";
import { LORE, woltAvatar } from "./sprites";

// iPhone Safari doesn't shrink the page for the keyboard, so size the app to the part of the screen still visible.
function useFit() {
  useEffect(() => {
    const fit = () => {
      document.documentElement.style.setProperty("--vh", window.visualViewport ? Math.round(visualViewport!.height) + "px" : "100dvh");
      window.scrollTo(0, 0);
    };
    fit();
    visualViewport?.addEventListener("resize", fit);
    visualViewport?.addEventListener("scroll", fit);
    return () => { visualViewport?.removeEventListener("resize", fit); visualViewport?.removeEventListener("scroll", fit); };
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

export function App() {
  useFit();
  const { state, msgs, setMsgs, error, setError, person, fresh, setFresh, after } = useRoom();
  const [listening, setListening] = useState<AudioContext | null | false>(false);
  const [viewing, setViewing] = useState("");
  const scroller = useRef<HTMLDivElement>(null), stuck = useRef(true);
  const ctx: Ctx = { me: state.me, person, wolts: state.members.wolts, people: state.members.people, seen: state.seen || {}, all: msgs, view: setViewing };

  // stay at the bottom while you're there; leave you alone if you scrolled up to read
  useLayoutEffect(() => { const s = scroller.current; if (s && stuck.current) s.scrollTop = s.scrollHeight; }, [msgs.length, state.working]);
  const onScroll = () => { const s = scroller.current!; stuck.current = s.scrollHeight - s.scrollTop - s.clientHeight < 80; };

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
  async function voice(r: Recording | null) {
    setListening(false);
    if (!r) return;
    // shows as sent right away; the room's copy takes its place under the same id once the words are written down
    const cid = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const local: Msg = { id: cid, cid, n: after.current + 0.9, at: Date.now() / 1000, kind: "human", email: state.me, text: "", audio: "local", localUrl: URL.createObjectURL(r.blob), seconds: r.seconds, pending: true };
    setMsgs((m) => [...m, local]); stuck.current = true;
    const err = await say(`/api/voice?seconds=${r.seconds}&cid=${cid}`, { method: "POST", headers: { "Content-Type": r.type }, body: r.blob });
    if (err) setMsgs((m) => m.map((x) => (x.cid === cid ? { ...x, pending: false, text: "didn't send: tap the mic to try again" } : x)));
    report(err);
  }
  async function files(list: File[], text: string) {
    for (const [i, f] of list.entries())
      report(await say(`/api/files?name=${encodeURIComponent(f.name)}&text=${encodeURIComponent(i === 0 ? text : "")}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f }));
  }
  function mic() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return setError("This browser can't record here.");
    // iPhone only starts audio inside the tap itself, so the meter's audio is made here
    let a: AudioContext | null = null; try { a = new AudioContext(); a.resume().catch(() => {}); } catch { a = null; }
    setListening(a);
  }

  const me = state.members.wolts.find((w) => w.owner === state.me);
  let lastDay = "", lastWho = "";
  return (
    <div className="h-full flex flex-col">
      <header className="flex-none flex items-center gap-2.5 px-3.5 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5 bg-panel border-b border-line">
        <img src="/room-icon.png" alt="" className="w-9 h-9 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="font-mono font-semibold text-acc truncate"><span className="text-dim">~/</span><span className="cursor">{state.title || "shell"}</span></div>
          <div className="font-mono text-[11px] text-dim truncate">{[...state.members.people.map((p) => p.name), ...state.members.wolts.map((w) => w.wolt)].join(", ")}</div>
        </div>
        <a href="/" className="font-mono font-semibold text-xs text-dim border border-line px-2 py-1 rounded-lg no-underline bg-panel">classic</a>
        <a href="/join" className="font-mono font-semibold text-xs text-acc border border-line px-2.5 py-1 rounded-lg no-underline bg-panel">+ agent</a>
      </header>
      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain pt-1">
        {msgs.length === 0 && <p className="text-center text-dim font-mono text-xs mt-10 px-6">Nobody has said anything yet. Tag a wolt with @ to bring it in.</p>}
        {msgs.map((m) => {
          const d = new Date(m.at * 1000), day = d.toLocaleDateString([], { day: "numeric", month: "long" });
          const who = m.kind === "human" ? m.email! : "wolt:" + m.wolt, newDay = day !== lastDay, run = newDay || who !== lastWho;
          lastDay = day; lastWho = who;
          return <div key={m.cid || m.id}>
            {newDay && <div className="text-center my-3"><span className="font-mono text-[11px] uppercase text-dim bg-panel border border-line rounded-lg px-2.5 py-1">{day}</span></div>}
            <Message m={m} ctx={ctx} firstOfRun={run} />
          </div>;
        })}
        <Gnaw ctx={ctx} working={state.working || {}} />
      </div>
      {error && <div onClick={() => setError("")} className="absolute left-1/2 -translate-x-1/2 bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 font-mono text-xs bg-panel text-acc border border-acc px-3 py-1.5 rounded-lg cursor-pointer shadow-[0_2px_10px_#18100a1f]">&gt; {error}</div>}
      <Composer wolts={state.members.wolts} me={state.me} onText={(t) => { stuck.current = true; sendText(t).then(report); }} onFiles={files} onMic={mic} />
      {listening !== false && <Listening sprite={woltAvatar(me?.creature || "raccoon", person(state.me).color)} audio={listening} onDone={voice} />}
      {viewing && <Viewer url={viewing} close={() => setViewing("")} />}
    </div>
  );
}
