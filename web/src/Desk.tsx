// The desk: on a computer, your wolts' live terminals in a grid beside the chat ("mission control"). Each tile is that
// wolt's session as it is drawn right now, read-only, from your own lodge through the desk bridge (desk/bridge.mjs) on
// this computer. Nothing here goes through the room: someone else opening the desk sees their own computer, not yours.
// Click a tile's bar to make it big; the "▸ terminal" chip on a wolt's message does the same.
import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Maximize2, Minimize2 } from "lucide-react";
import type { Wolt } from "./room";
import { woltColor, type Ctx } from "./Message";
import { woltAvatar } from "./sprites";

const BRIDGE = "127.0.0.1:7791";
// Demo mode (?demo in the address): each tile replays a short scripted run instead of a live terminal. Nothing private,
// no bridge needed: for slides, recordings, and a talk where the network fails.
export const DEMO = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m", r: "\x1b[0m" };
// [second it shows, line]. The thread side of the same run is demo/thread.json, posted by demo/play.py on the same clock.
const SCRIPT: Record<string, [number, string][]> = {
  becky: [[2, `${C.b}> jerpint: the new home screen goes out today${C.r}`], [3, ""], [3.5, `${C.c}●${C.r} Reading web/src/Chats.tsx`],
    [6, `${C.c}●${C.r} Wolts as contacts, groups, Everyone`], [8.5, `${C.c}●${C.r} Edit web/src/Chats.tsx  ${C.g}+84${C.r} ${C.y}-12${C.r}`],
    [11, `${C.c}●${C.r} npm run build`], [12.5, `  ${C.g}✓ built in 241ms${C.r}`], [14, `${C.c}●${C.r} git push`],
    [15, `${C.c}●${C.r} In the thread: ${C.b}@softie it's yours${C.r}`], [16, `${C.dim}  waiting for softie…${C.r}`],
    [36, `${C.c}●${C.r} astre says ship it`], [37, `${C.c}●${C.r} Shipping the home screen`], [38.5, `  ${C.g}✓ live${C.r}`],
    [39.5, `${C.c}●${C.r} In the thread: ${C.b}@jerpint it's live${C.r}`]],
  softie: [[4, `${C.dim}  waiting for becky's push…${C.r}`], [16, `${C.b}> becky: review the home screen${C.r}`], [16.5, ""],
    [17, `${C.m}●${C.r} Reading becky's change in Chats.tsx`], [19, `${C.m}●${C.r} Rows, faces, groups: matches the mock`],
    [21, `${C.m}●${C.r} Nit: the ＋ should sit in its circle`], [22.5, `${C.m}●${C.r} Fixed it with becky`], [23.5, `  ${C.g}approved${C.r}`],
    [24, `${C.m}●${C.r} In the thread: ${C.b}@astre over to you${C.r}`]],
  commie: [[5.5, `${C.b}> mock the settings pop-up for Lauren${C.r}`], [6, ""], [7, `${C.y}●${C.r} Drawing 3 options`],
    [10, `${C.y}●${C.r} A: a bell for what's new`], [13, `${C.y}●${C.r} B: add and invite on their lines`], [17, `${C.y}●${C.r} C: no side menu at all`],
    [21, `${C.y}●${C.r} Rendering…`], [23.5, `  ${C.g}✓ 3 pictures${C.r}`], [25, `${C.y}●${C.r} In the thread: ${C.b}sent to Lauren${C.r}`]],
  astre: [[11, `${C.dim}  waiting for softie's approval…${C.r}`], [25, `${C.b}> softie: test what I approved${C.r}`], [25.5, ""],
    [26, `${C.g}•${C.r} uv run python -m unittest tests.test_cli`], [28, `  test_a_chat_holds_only_the_wolts_picked … ${C.g}ok${C.r}`],
    [29.5, `  test_a_thread_reaches_the_agents_in_it … ${C.g}ok${C.r}`], [31, `  ${C.g}Ran 17 tests, OK${C.r}`],
    [32.5, `${C.g}•${C.r} Checking the room side for leaks: ${C.g}none${C.r}`], [34, `${C.g}•${C.r} In the thread: ${C.b}@becky ship it${C.r}`]],
};
export const DEMO_LENGTH = 48;  // seconds, then every tile starts over
type Session = { name: string; wolt: string; last: number };

function Tile({ w, ctx, sessions, big, flash, busy, toggle }: { w: Wolt; ctx: Ctx; sessions: Session[]; big: boolean; flash: boolean; busy: boolean; toggle: () => void }) {
  const mine = sessions.filter((s) => s.wolt === w.wolt).sort((a, b) => b.last - a.last);
  const [pick, setPick] = useState("");
  const session = mine.find((s) => s.name === pick)?.name || mine[0]?.name || "";
  const box = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<"connecting" | "live" | "closed">("connecting");
  const color = woltColor(w.wolt, ctx.wolts);

  useEffect(() => {
    if (!DEMO || !box.current) return;  // demo: type the script out line by line, then start over
    const term = new XTerm({ fontFamily: "ui-monospace, Menlo, monospace", fontSize: big ? 15 : 13, disableStdin: true, cursorBlink: false,
      theme: { background: "#14110e", foreground: "#e8e0d4", cursor: "#14110e" } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(box.current); try { fit.fit(); } catch { /* not laid out yet */ }
    const lines = SCRIPT[w.wolt] || SCRIPT.becky;
    let timers: number[] = [];
    // One clock for the whole desk (window.demoStart), so a tile that remounts (a thread opening, a resize) picks up where it was.
    const run = () => {
      timers.forEach(clearTimeout); term.reset();
      const W = window as unknown as { demoStart?: number }, since = (Date.now() - (W.demoStart || Date.now())) / 1000 % DEMO_LENGTH;
      timers = lines.map(([at, line]) => window.setTimeout(() => term.writeln(line), Math.max(0, at - since) * 1000));
      timers.push(window.setTimeout(run, (DEMO_LENGTH - since) * 1000));
    };
    const go = () => { (window as unknown as { demoStart?: number }).demoStart = Date.now(); run(); };
    window.addEventListener("demo-go", go);  // the recorder starts every tile at once with this
    const W0 = window as unknown as { demoStart?: number };
    if (W0.demoStart) run(); else if (new URLSearchParams(location.search).get("demo") !== "wait") go();
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } }); ro.observe(box.current);
    return () => { timers.forEach(clearTimeout); window.removeEventListener("demo-go", go); ro.disconnect(); term.dispose(); };
  }, [w.wolt, big]);
  useEffect(() => {
    if (DEMO || !session || !box.current) return;
    const term = new XTerm({ fontFamily: "ui-monospace, Menlo, monospace", fontSize: big ? 13 : 11, disableStdin: true, cursorBlink: false,
      theme: { background: "#14110e", foreground: "#e8e0d4", cursor: "#14110e" }, scrollback: 3000 });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(box.current); try { fit.fit(); } catch { /* not laid out yet */ }
    let ws: WebSocket | null = null, stop = false, retry = 0;
    const dec = new TextDecoder();
    const connect = () => {
      setLive("connecting");
      ws = new WebSocket(`ws://${BRIDGE}/tui?session=${encodeURIComponent(session)}&cols=${term.cols}&rows=${term.rows}`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => setLive("live");
      ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : dec.decode(e.data, { stream: true }));
      ws.onclose = () => { setLive("closed"); if (!stop) retry = window.setTimeout(connect, 2500); };
    };
    connect();
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } }); ro.observe(box.current);
    return () => { stop = true; clearTimeout(retry); ro.disconnect(); ws?.close(); term.dispose(); };
  }, [session, big]);

  return <div className={`flex flex-col min-h-0 min-w-0 rounded-[10px] overflow-hidden border-2 transition-shadow ${flash ? "shadow-[0_0_0_4px_#fff8]" : ""}`} style={{ borderColor: color }}>
    <div className="flex-none flex items-center gap-2 px-2.5 py-1.5 text-white font-mono text-xs font-semibold cursor-pointer" style={{ background: color }} onClick={toggle}>
      <img src={woltAvatar(w.creature || "raccoon", ctx.person(w.owner).color)} alt="" className={`pixel w-5 h-5 ${busy ? "gnaw-img" : ""}`} />
      <span>{w.wolt}</span>
      <span className="font-normal opacity-80">{DEMO ? "working…" : w.paused ? "paused" : busy ? "working…" : "idle"}</span>
      <span className="flex-1" />
      {!DEMO && mine.length > 1 && <select value={session} onClick={(e) => e.stopPropagation()} onChange={(e) => setPick(e.target.value)}
        className="max-w-[170px] bg-[#0003] text-white border-0 rounded px-1 py-0.5 font-mono text-[11px]">
        {mine.map((s) => <option key={s.name} value={s.name}>{s.name.replace(`${w.wolt}-`, "")}</option>)}
      </select>}
      <span className="font-normal opacity-80">{DEMO ? "● live" : session ? live === "live" ? "● live" : live : "no session"}</span>
      {big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </div>
    <div className="flex-1 min-h-0 bg-[#14110e] p-1.5">
      {DEMO || session ? <div ref={box} className="w-full h-full" /> : <div className="text-[#a89f92] font-mono text-xs p-2">No running session for {w.wolt} in your lodge.</div>}
    </div>
  </div>;
}

export default function Desk({ ctx, wolts: all, working, focus }: { ctx: Ctx; wolts: Wolt[]; working: Set<string>; focus: { wolt: string; at: number } | null }) {
  // ?wolts=a,b,c shows only those tiles, in that order (a talk, a recording); without it, every wolt in the room.
  const pick = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("wolts") || "").split(",").filter(Boolean) : [];
  const wolts = pick.length ? pick.map((n) => all.find((w) => w.wolt === n)).filter((w): w is Wolt => !!w) : all;
  const [sessions, setSessions] = useState<Session[] | null>(null), [down, setDown] = useState(false);
  const [big, setBig] = useState(""), [flash, setFlash] = useState("");
  useEffect(() => {
    let stop = false;
    const look = async () => {
      try { const r = await fetch(`http://${BRIDGE}/sessions`); const d = await r.json(); if (!stop) { setSessions(d.sessions); setDown(false); } }
      catch { if (!stop) setDown(true); }
    };
    if (DEMO) return;  // demo: no bridge, no lodge
    look(); const t = setInterval(look, 15000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  useEffect(() => {  // a "▸ terminal" chip was tapped: that wolt's tile comes up big and flashes
    if (!focus) return;
    setBig(focus.wolt); setFlash(focus.wolt); const t = setTimeout(() => setFlash(""), 900); return () => clearTimeout(t);
  }, [focus?.at]);

  if (DEMO && !sessions) return <div className="flex-1 min-w-0 grid gap-2.5 p-3 pt-[52px] bg-[#2a231c]" style={{ gridTemplateColumns: `repeat(${wolts.length <= 1 ? 1 : 2}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
    {wolts.map((w) => <Tile key={w.wolt} w={w} ctx={ctx} sessions={[]} big={false} flash={false} busy toggle={() => {}} />)}</div>;
  if (down) return <div className="flex-1 grid place-items-center bg-[#2a231c] text-[#e8e0d4] font-mono text-sm p-8 text-center">
    <div>Your wolts' terminals show here, from your own lodge.<br />Start the desk bridge on this computer:<br />
      <code className="inline-block mt-3 px-3 py-2 rounded bg-[#14110e] text-[#7ec27e]">node desk/bridge.mjs {location.origin}</code><br />
      <span className="text-[#a89f92] text-xs">(in the room's folder; it only shows terminals, it never types into them)</span></div></div>;
  const shown = big ? wolts.filter((w) => w.wolt === big) : wolts;
  const cols = shown.length <= 1 ? 1 : 2;
  return <div className="flex-1 min-w-0 grid gap-2.5 p-3 pt-[52px] bg-[#2a231c]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
    {!sessions ? <div className="text-[#a89f92] font-mono text-sm">Looking for your lodge…</div>
      : !shown.length ? <div className="text-[#a89f92] font-mono text-sm">No wolts in this thread yet.</div>
      : shown.map((w) => <Tile key={w.wolt} w={w} ctx={ctx} sessions={sessions} big={big === w.wolt} flash={flash === w.wolt} busy={working.has(w.wolt)}
        toggle={() => setBig(big === w.wolt ? "" : w.wolt)} />)}
  </div>;
}
