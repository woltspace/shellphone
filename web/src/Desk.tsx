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
const SCRIPT: Record<string, string[]> = {  // the same four as the "alone" slide, now handing work to each other
  becky: [`${C.b}> jerpint: build the new home screen${C.r}`, "", `${C.c}●${C.r} Reading web/src/Chats.tsx`, `${C.c}●${C.r} Wolts as contacts, groups, Everyone`,
    `${C.c}●${C.r} Edit web/src/Chats.tsx  ${C.g}+84${C.r} ${C.y}-12${C.r}`, `${C.c}●${C.r} npm run build`, `  ${C.g}✓ built in 241ms${C.r}`,
    `${C.c}●${C.r} In the room: ${C.b}@softie can you review it?${C.r}`, "", `${C.dim}  waiting for softie…${C.r}`],
  softie: [`${C.b}> becky: review my home screen${C.r}`, "", `${C.m}●${C.r} Reading becky's change in Chats.tsx`, `${C.m}●${C.r} Rows, faces, groups: matches the mock`,
    `${C.m}●${C.r} One nit: the ＋ should sit in its circle`, `${C.m}●${C.r} Fixed it with becky`, `  ${C.g}approved${C.r}`,
    `${C.m}●${C.r} In the room: ${C.b}@astre over to you for tests${C.r}`, "", `${C.dim}  gnawing…${C.r}`],
  commie: [`${C.b}> Lauren: mock the settings${C.r}`, "", `${C.y}●${C.r} Drawing 3 options for Lauren`, `${C.y}●${C.r} A: a bell for what's new`,
    `${C.y}●${C.r} B: add and invite on their lines`, `${C.y}●${C.r} C: no side menu at all`, `  ${C.g}✓ 3 pictures${C.r}`,
    `${C.y}●${C.r} In the room: ${C.b}@softie Lauren picked B${C.r}`, "", `${C.dim}  gnawing…${C.r}`],
  astre: [`${C.b}> softie: test what I approved${C.r}`, "", `${C.g}•${C.r} uv run python -m unittest tests.test_cli`, `  test_a_chat_holds_only_the_wolts_picked … ${C.g}ok${C.r}`,
    `  test_a_thread_reaches_the_agents_in_it … ${C.g}ok${C.r}`, `  ${C.g}Ran 17 tests, OK${C.r}`, `${C.g}•${C.r} Checking the room side for leaks: ${C.g}none${C.r}`,
    `${C.g}•${C.r} In the room: ${C.b}@becky ship it${C.r}`, "", `${C.dim}  thinking…${C.r}`],
};
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
    const lines = SCRIPT[w.wolt] || SCRIPT.becky, offset = (w.wolt.length * 7) % 5;
    let i = 0, t = 0;
    const next = () => { if (i >= lines.length) { t = window.setTimeout(() => { term.clear(); term.reset(); i = 0; next(); }, 4000); return; }
      term.writeln(lines[i++]); t = window.setTimeout(next, 600 + ((i + offset) % 3) * 350); };
    t = window.setTimeout(next, offset * 300);
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } }); ro.observe(box.current);
    return () => { clearTimeout(t); ro.disconnect(); term.dispose(); };
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

export default function Desk({ ctx, wolts, working, focus }: { ctx: Ctx; wolts: Wolt[]; working: Set<string>; focus: { wolt: string; at: number } | null }) {
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
