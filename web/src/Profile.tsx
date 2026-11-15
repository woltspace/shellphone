// Someone's card, opened from the strip: who they are, what they're up to right now, and the chats they're in.
// For a wolt: who keeps it and where it's gnawing. For a person: their wolts. Tap a chat to go there.
import { useEffect, useRef, useState } from "react";
import { Crown, Pause, Play, Shirt, X } from "lucide-react";
import { crown, setWolt } from "./Agents";
import { HatGrid, putFace, putLook } from "./HatShop";
import { mix, woltColor, woltFace } from "./Message";
import type { Msg, State } from "./room";
import { personAvatar, verbs } from "./sprites";
import { worn } from "./hats";
import { mood, type Who } from "./WoltStrip";
import { ago, threadTitle, ThreadHat } from "./Threads";

type Person = (email: string) => { name: string; color: string };

export function Profile({ who, state, person, msgs, onOpen, onPick, onClose }: {
  who: Who; state: State; person: Person; msgs: Msg[]; onOpen: (thread: string) => void; onPick: (who: Who) => void; onClose: () => void;
}) {
  const isWolt = who.startsWith("w:"), key = who.slice(2);
  const w = isWolt ? state.members.wolts.find((x) => x.wolt === key) : undefined;
  const p = !isWolt ? state.members.people.find((x) => x.email === key) : undefined;
  const [hats, setHats] = useState(false), [asking, setAsking] = useState(false), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  // a sheet with two heights: half the screen when it opens, nearly all of it for more. It follows your finger:
  // up grows it to tall, down from tall brings it back to half, down from half slides it away. What's inside scrolls.
  const panel = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const short = () => Math.max(340, window.innerHeight * 0.46), full = () => window.innerHeight * 0.92;
  const drag = useRef<{ y: number; t: number; dy: number; on: boolean; inBody: boolean; base: number; down: boolean; ly: number; lt: number; v: number } | null>(null);
  const bye = () => { const p = panel.current; if (p) { p.style.transition = "transform .2s cubic-bezier(.2,.8,.2,1)"; p.style.transform = "translateY(100%)"; } setTimeout(onClose, 180); };
  const settle = (toTall: boolean) => { const p = panel.current; if (!p) return;
    p.style.transition = "transform .3s cubic-bezier(.25,1.3,.45,1), height .35s cubic-bezier(.25,1.2,.45,1)"; p.style.transform = ""; p.style.height = `${toTall ? full() : short()}px`; setTall(toTall); };
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => { drag.current = { y: e.touches[0].clientY, t: performance.now(), dy: 0, on: false, base: tall ? full() : short(), down: false, ly: e.touches[0].clientY, lt: performance.now(), v: 0, inBody: !!body.current?.contains(e.target as Node) }; },
    onTouchMove: (e: React.TouchEvent) => {
      const d = drag.current, p = panel.current; if (!d || !p) return;
      d.dy = e.touches[0].clientY - d.y;
      if (!d.on) {
        if (Math.abs(d.dy) < 6) return;
        const b = body.current, canScroll = !!b && b.scrollHeight > b.clientHeight;
        // tall: the list scrolls as usual, and only a pull down from its top moves the card. Half height: up grows it first.
        if (d.inBody && ((d.dy > 0 && (b?.scrollTop || 0) > 0) || (tall && d.dy < 0 && canScroll))) { drag.current = null; return; }
        d.on = true; d.down = d.dy > 0; d.y = e.touches[0].clientY; d.dy = 0;
      }
      const now = performance.now(), y = e.touches[0].clientY; d.v = (y - d.ly) / Math.max(1, now - d.lt); d.ly = y; d.lt = now;  // speed at the end, for a flick
      p.style.transition = "none";
      const h = d.base - d.dy, top = full();
      if (h >= short() || tall) { p.style.transform = ""; p.style.height = `${h > top ? top + (h - top) * 0.3 : Math.max(short(), h)}px`; }  // past tall it gets heavier
      else { p.style.height = `${short()}px`; p.style.transform = `translateY(${short() - h}px)`; }  // below half: on its way out
    },
    onTouchEnd: () => {
      const d = drag.current; drag.current = null; if (!d?.on) return;
      // a swipe that started down never grows the card: down and back up just settles where it was
      const v = d.v, flickDown = v > 0.5 && d.dy > 20, flickUp = v < -0.5 && d.dy < -20;
      if (!tall) { if (!d.down && (d.dy < -60 || flickUp)) settle(true); else if (d.dy > 90 || flickDown) bye(); else settle(false); }
      else settle(!(d.dy > 80 || flickDown));
    },
  };
  const [tick, setTick] = useState(0);  // a busy wolt's line of lore changes every few seconds, like in the chats
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 2400); return () => clearInterval(t); }, []);
  if (!w && !p) return null;
  const color = w ? woltColor(w.wolt, state.members.wolts) : person(p!.email).color;
  const face = w ? woltFace(w.wolt, w.creature) : personAvatar(p!.name, color, worn.people[p!.email]);
  const name = w ? w.wolt : p!.name;
  const m = w ? mood(w, state) : null;
  const byId = new Map(msgs.map((x) => [x.id, x]));
  // the chats they're in: wherever they said something, newest first, with what they last said there
  const mine = msgs.filter((x) => (w ? x.kind === "wolt" && x.wolt === w.wolt : x.kind === "human" && x.email === p!.email));
  const chats = new Map<string, Msg>();
  for (const x of mine) chats.set(x.thread || x.id, x);
  const threads = new Set(msgs.map((x) => x.thread).filter(Boolean));  // a chat is a message with replies, or one a person started
  const rows = [...chats.entries()].filter(([id]) => { const r = byId.get(id); return !!r && !r.thread && (threads.has(id) || r.kind === "human"); }).sort((a, b) => b[1].at - a[1].at);
  const working = w ? (state.working_in?.[w.wolt] || []) : [];
  const last = mine[mine.length - 1];
  const wolts = p ? state.members.wolts.filter((x) => x.owner === p.email) : [];
  const keeper = w ? state.members.people.find((x) => x.email === w.owner) : undefined;
  // what you may change here, the same as the room allows: your own hat; your own wolts (any wolt, for the host)
  const meP = state.members.people.find((x) => x.email === state.me), guest = !!meP?.guest;
  const mayWolt = !!w && !guest && (state.me === state.host || w.owner === state.me);
  const mayHat = w ? mayWolt : p!.email === state.me && !guest;
  const hatNow = w ? state.looks?.[w.wolt]?.hat || "" : (state.faces?.[p!.email] || "").replace(/^hat-/, "");
  const act = async (f: () => Promise<string | null>) => { setBusy(true); setAsking(false); setNote((await f()) || ""); setBusy(false); };
  const chip = "flex items-center gap-1.5 h-9 px-3 rounded-full border font-mono text-[12.5px] font-semibold cursor-pointer disabled:opacity-50";
  const sec = "mt-4 mb-1 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
  return <div className="absolute inset-0 z-[1660]">
    <div onClick={bye} className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
    <div ref={panel} {...swipe} role="dialog" aria-label={name} style={{ height: "max(340px, 46dvh)" }} className="absolute inset-x-0 bottom-0 max-w-[640px] mx-auto flex flex-col bg-paper rounded-t-[18px] shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)] overflow-hidden">
      <div className="flex-none px-4 pt-2 pb-3" style={{ background: `linear-gradient(${mix(color, "#ffffff", 0.78)}, transparent)` }}>
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mb-2" />
        <div className="flex items-center gap-3">
          {/* tap the face for hats, when the hat is yours to change */}
          <button type="button" disabled={!mayHat} onClick={() => setHats(!hats)} aria-expanded={mayHat ? hats : undefined} aria-label={mayHat ? `${name}'s hat` : undefined}
            className={`relative flex-none p-0 border-0 bg-transparent ${mayHat ? "cursor-pointer active:scale-95 transition-transform" : "cursor-default"} ${m?.busy ? "" : "idle-bob"}`}>
            <img src={face} alt="" className={`pixel block w-[72px] h-[72px] ${m?.busy ? "gnaw-img" : ""}`} />
            {mayHat && <span className={`absolute -bottom-0.5 -right-0.5 w-6 h-6 grid place-items-center rounded-full border-2 border-paper ${hats ? "bg-acc text-white" : "bg-white text-acc"} shadow`}><Shirt size={12} /></span>}
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-mono font-bold text-lg truncate" style={{ color }}>{name}{w && state.main === w.wolt && <span className="ml-1 text-acc text-base" title="main agent">★</span>}</div>
            <div className="font-mono text-[12px] text-dim truncate">
              {w ? <>{w.creature} · {keeper ? <button type="button" onClick={() => onPick("p:" + keeper.email)} className="p-0 border-0 bg-transparent font-mono text-[12px] text-acc cursor-pointer">{keeper.name}'s</button> : "a guest's"} wolt{state.main === w.wolt ? " · main agent" : ""}</>
                : p!.email === state.me ? "you" : p!.guest ? "guest" : "human"}
            </div>
            <div className="mt-1 font-mono text-[12px]">
              {m ? (m.busy ? <span key={tick} className="lore new font-semibold">{verbs(w!.creature)[(tick + w!.wolt.length) % verbs(w!.creature).length]}</span> : <span className={m.awake ? "text-go" : "text-dim"}>● {m.word}</span>)
                : <span className="text-dim">{last ? `last said something ${ago(last.at)}` : "hasn't said anything yet"}</span>}
              {m && last && <span className="text-dim"> · last spoke {ago(last.at)}</span>}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={bye} className="flex-none self-start w-9 h-9 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={18} /></button>
        </div>
      </div>
      <div ref={body} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {mayWolt && <div className="flex flex-wrap gap-2 pt-1">
          {mayWolt && <button type="button" disabled={busy} onClick={() => act(() => setWolt(w!.wolt, w!.paused ? "on" : "paused"))}
            className={`${chip} border-line bg-white ${w!.paused ? "text-acc" : "text-ink"}`}>{w!.paused ? <><Play size={15} />Bring back</> : <><Pause size={15} />Pause</>}</button>}
          {mayWolt && state.me === state.host && state.main !== undefined && <button type="button" disabled={busy} onClick={() => act(() => crown(state.main === w!.wolt ? null : w!.wolt))}
            className={`${chip} ${state.main === w!.wolt ? "border-acc bg-[#f6e2d6] text-acc" : "border-line bg-white text-ink"}`}><Crown size={15} />{state.main === w!.wolt ? "Main agent ✓" : "Make main agent"}</button>}
          {mayWolt && (asking
            ? <><button type="button" disabled={busy} onClick={() => act(async () => { const r = await setWolt(w!.wolt, "removed"); if (!r) onClose(); return r; })} className={`${chip} border-acc bg-acc text-white`}>Remove {w!.wolt}</button>
              <button type="button" onClick={() => setAsking(false)} className={`${chip} border-line bg-white text-dim`}>Keep</button></>
            : <button type="button" onClick={() => setAsking(true)} aria-label={`Remove ${w!.wolt}`} className={`${chip} border-line bg-white text-dim`}><X size={15} />Remove</button>)}
        </div>}
        {w?.paused && <p className="mt-2 text-[12.5px] text-dim">Paused: it hears nothing in this room, a tag included, and can't post.</p>}
        {hats && <div className="-mx-4 mt-2"><HatGrid hat={hatNow} put={(h) => (w ? putLook(w.wolt, state.looks?.[w.wolt], h) : putFace(h))} /></div>}
        {note && <p className="mt-1 text-xs text-acc">{note}</p>}
        {working.length > 0 && <>
          <div className={sec}>Working on it now</div>
          {working.map((t) => { const r = byId.get(t); return <button type="button" key={t || "main"} onClick={() => t && onOpen(t)}
            className="w-full flex items-center gap-2 py-2 px-2.5 mb-1 rounded-xl border border-line bg-[#fffdf6] gnaw-row text-left cursor-pointer">
            {t && <ThreadHat id={t} className="w-5 h-5" />}<span className="flex-1 min-w-0 truncate font-mono text-[13px] font-semibold">{t ? threadTitle(r) : "the lobby"}</span><span className="lore font-mono text-[11px] font-semibold">gnawing…</span></button>; })}
        </>}
        {wolts.length > 0 && <>
          <div className={sec}>Their wolts</div>
          <div className="flex flex-wrap gap-2">
            {wolts.map((x) => { const xm = mood(x, state); return <button type="button" key={x.wolt} onClick={() => onPick("w:" + x.wolt)}
              className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border border-line bg-white cursor-pointer">
              <img src={woltFace(x.wolt, x.creature)} alt="" className={`pixel w-7 h-7 ${xm.busy ? "gnaw-img" : ""}`} />
              <span className="font-mono text-[12.5px] font-semibold" style={{ color: woltColor(x.wolt, state.members.wolts) }}>{x.wolt}</span>
              <span className={`font-mono text-[10.5px] ${xm.busy ? "lore font-semibold" : "text-dim"}`}>{xm.busy ? "gnawing…" : xm.word}</span></button>; })}
          </div>
        </>}
        {/* a little more about them, for when the card is pulled up */}
        <div className={sec}>In this room</div>
        <div className="grid grid-cols-3 gap-2">
          {[[String(mine.length), mine.length === 1 ? "message" : "messages"], [String(rows.length), rows.length === 1 ? "chat" : "chats"],
            [mine.length ? new Date(mine[0].at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—", "first said hi"]].map(([n, l]) =>
            <div key={l} className="rounded-xl border border-line bg-white px-2 py-2 text-center">
              <div className="font-mono font-bold text-[17px]" style={{ color }}>{n}</div>
              <div className="font-mono text-[10.5px] text-dim">{l}</div></div>)}
        </div>
        <div className={sec}>Chats {name === "you" ? "" : "they're in"}</div>
        {rows.length === 0 && <p className="text-sm text-dim py-2">No chats yet.</p>}
        {rows.map(([id, x]) => <button type="button" key={id} onClick={() => onOpen(id)}
          className="w-full flex items-center gap-2.5 py-2 border-0 border-t border-line bg-transparent text-left cursor-pointer">
          <ThreadHat id={id} className="flex-none w-6 h-6" />
          <span className="flex-1 min-w-0">
            <span className="block truncate font-mono text-[13px] font-semibold">{threadTitle(byId.get(id))}</span>
            <span className="block truncate text-[12px] text-dim">{(x.text || (x.audio ? "voice note" : x.files?.length || x.file ? "a file" : "")).replace(/\s+/g, " ").slice(0, 90)}</span>
          </span>
          <span className="flex-none font-mono text-[10.5px] text-dim">{ago(x.at)}</span>
        </button>)}
      </div>
    </div>
  </div>;
}
