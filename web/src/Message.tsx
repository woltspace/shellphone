// One bubble: who said it, the words (with @tags), a voice note with its words, a file or picture, a card.
import { relayRoom } from "./relay";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Reply, RotateCw, SquareTerminal } from "lucide-react";
import { Card } from "./Card";
import { PageTile } from "./Page";
import { ShareButton } from "./Share";
import type { FileInfo, Msg, Person, Wolt } from "./room";
import { personAvatar, woltAvatar } from "./sprites";
import { mentionNames } from "./mentions.js";

export type Ctx = { me: string; person: (e?: string) => Person; wolts: Wolt[]; people: Person[]; seen: Record<string, string[]>; all: Msg[]; view: (urls: string[], at?: number, names?: string[]) => void; retry?: (cid: string) => void; openPage?: (id: string) => void; busy?: (place: string) => Wolt[]; showTerminal?: (wolt: string) => void; terminals?: Record<string, string>; reply?: (m: Msg) => void };

const IMAGE = /^(png|jpe?g|gif|webp|avif|heic|bmp)$/i, VIDEO = /^(mp4|mov|m4v|webm)$/i;
const time = (at: number) => new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Words({ text, ctx }: { text: string; ctx: Ctx }) {
  const names = mentionNames(ctx.wolts, ctx.people);  // same rule as the @ picker (mentions.js)
  // a little markdown, like the classic page: links, **bold**, `code`, and @tags
  return <>{text.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\*\*[^*\n]+\*\*|`[^`\n]+`|(?:^|\s)@[\w-]+)/g).map((part, i) => {
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-acc underline break-all">{part}</a>;
    if (/^\*\*.+\*\*$/.test(part)) return <b key={i}>{part.slice(2, -2)}</b>;
    if (/^`.+`$/.test(part)) return <code key={i} className="font-mono text-[13px] bg-paper border border-line rounded px-1">{part.slice(1, -1)}</code>;
    const m = part.match(/^(\s?)@([\w-]+)$/);
    return m && names.has(m[2].toLowerCase()) ? <span key={i}>{m[1]}<b className="text-acc font-semibold">@{m[2]}</b></span> : part;
  })}</>;
}

// A round play button, a waveform that fills as it plays, and the length. The bars aren't the real sound: they're
// drawn from the note itself so each one looks its own and you can see there's something in it.
function bars(seed: string, n: number) {
  let h = [...seed].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 2166136261);
  const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => { const edge = Math.min(1, (i + 1) / 3, (n - i) / 3); return Math.max(0.15, (0.35 + 0.65 * rnd()) * edge); });
}
function Player({ src, seconds, seed, guess }: { src?: string; seconds?: number; seed: string; guess?: number }) {
  // The button follows your taps, never the audio's own events: tap = play, tap again = pause, as fast as you like.
  // The sound catches up with the last tap. A ring spins while it's meant to play but nothing is coming out yet.
  const a = useRef<HTMLAudioElement>(null), tap = useRef(0);
  const [want, setWant] = useState(false), [sounding, setSounding] = useState(false);
  const [at, setAt] = useState(0), [len, setLen] = useState(seconds || 0), [pressed, setPressed] = useState(false);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const shape = useMemo(() => bars(seed, 32), [seed]);
  const shown = len || guess || 0, done = len ? at / len : 0;
  const toggle = () => {
    const el = a.current; if (!el) return;
    const mine = ++tap.current;
    if (want) { setWant(false); setSounding(false); el.pause(); return; }
    setWant(true);
    el.play().catch(() => { if (tap.current === mine) { setWant(false); setSounding(false); } });  // a later tap already decided
  };
  return <div className="flex items-center gap-2.5 h-9">
    <audio ref={a} src={src} preload="none"
      onPause={(e) => { if (!e.currentTarget.ended) { setWant(false); setSounding(false); } }}  // paused from elsewhere: another note started
      onEnded={() => { setWant(false); setSounding(false); setAt(0); }}
      onWaiting={() => setSounding(false)}
      onTimeUpdate={(e) => { const t = e.currentTarget.currentTime; setAt(t); if (t > 0.05 && !e.currentTarget.paused) setSounding(true); }}
      onDurationChange={(e) => isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setLen(e.currentTarget.duration)} />
    <button type="button" aria-label={want ? "Pause" : "Play"} disabled={!src} onClick={toggle}
      onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onPointerLeave={() => setPressed(false)} onPointerCancel={() => setPressed(false)}
      style={{ transform: pressed ? "scale(.85)" : undefined }}
      className="relative flex-none w-8 h-8 rounded-full bg-acc grid place-items-center border-0 cursor-pointer disabled:opacity-40 transition-transform duration-100 touch-manipulation">
      {want && !sounding && <i className="absolute -inset-[3px] rounded-full border-2 border-[#c4531e33] border-t-acc animate-spin" />}
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">{want ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}</svg>
    </button>
    <div className="flex-1 h-7 flex items-center gap-[2px] cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (a.current && len) a.current.currentTime = ((e.clientX - r.left) / r.width) * len; }}>
      {shape.map((v, i) => <i key={i} className={`flex-1 rounded-full transition-colors ${(i + 0.5) / shape.length <= done ? "bg-acc" : "bg-[#c4b8a4]"}`} style={{ height: `${Math.round(v * 100)}%` }} />)}
    </div>
    <span className="flex-none font-mono text-[11px] text-dim tabular-nums">{shown ? (!len ? "~" : "") + fmt(want || at ? at : shown) : "–:––"}</span>
  </div>;
}

// A message the room didn't get: it stays here, and a tap sends the very same one again.
function Unsent({ m, ctx }: { m: Msg; ctx: Ctx }) {
  return <button type="button" data-tap onClick={() => m.cid && ctx.retry?.(m.cid)}
    className="mt-1.5 flex items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-xs text-acc cursor-pointer">
    <RotateCw className="w-3.5 h-3.5" />didn't send · tap to send again</button>;
}

function Voice({ m, ctx }: { m: Msg; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const src = m.localUrl || (m.audio && m.audio !== "local" && !relayRoom ? "/voice/" + m.audio : undefined);  // through the relay: words only, for now
  return <div className="w-[min(260px,68vw)]">
    <Player src={src} seconds={m.seconds} seed={m.id || m.cid || "v"} guess={m.text ? Math.max(1, m.text.split(/\s+/).length / 2.6) : undefined} />
    {m.failed ? <Unsent m={m} ctx={ctx} /> : m.pending
      ? <div className="h-5 leading-5 mt-1.5 text-xs text-dim flex items-center gap-1.5 animate-[pulse-soft_1.4s_ease-in-out_infinite]"><i className="w-[11px] h-[11px] border-2 border-line border-t-acc rounded-full animate-spin" />transcribing</div>
      : m.text ? <div data-tap onClick={() => setOpen(!open)} className={`mt-1.5 text-sm leading-snug whitespace-pre-wrap cursor-pointer ${open ? "" : "line-clamp-1 text-dim"}`}>
          <span className="text-acc">{open ? "▾ " : "▸ "}</span>{m.text}</div> : null}
  </div>;
}

// the pictures sent together sit together: one at its own shape, several as a grid of tiles
function Files({ m, ctx }: { m: Msg; ctx: Ctx }) {
  const pics = m.files!.filter((f) => IMAGE.test(f.type)), rest = m.files!.filter((f) => !IMAGE.test(f.type));
  return <>
    {pics.length === 1 && <File f={pics[0]} ctx={ctx} />}
    {pics.length > 1 && <div className="grid grid-cols-2 gap-1 w-[min(260px,68vw)] mb-1">
      {pics.map((f, i) => <img key={f.url} src={f.url} alt={f.name} onClick={() => ctx.view(pics.map((p) => p.url), i, pics.map((p) => p.name))} className="block w-full aspect-[3/4] object-cover rounded-lg cursor-zoom-in" />)}
    </div>}
    {rest.map((f) => <File key={f.url} f={f} ctx={ctx} />)}
  </>;
}

function File({ f, ctx }: { f: FileInfo; ctx: Ctx }) {
  if (IMAGE.test(f.type)) return <img src={f.url} alt={f.name} onClick={() => ctx.view([f.url], 0, [f.name])} className="block max-w-[min(260px,68vw)] max-h-[320px] rounded-lg cursor-zoom-in mb-1" />;
  if (VIDEO.test(f.type)) return <div className="relative w-fit mb-1">
    <video src={f.url} controls playsInline preload="metadata" className="block max-w-[min(260px,68vw)] rounded-lg" />
    <ShareButton url={f.url} name={f.name} className="absolute top-1.5 right-1.5 bg-[#000a] text-white border-0" />
  </div>;
  return <div className="flex items-center gap-1 mb-1"><a href={f.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 px-2.5 py-2 border border-line rounded-[10px] bg-paper no-underline text-ink">
    <span className="text-xl">📄</span><span className="min-w-0"><span className="block font-semibold truncate">{f.name}</span><span className="block font-mono text-[11px] text-dim">{f.type.toUpperCase()} · {Math.max(1, Math.round(f.size / 1024))} KB</span></span>
  </a><ShareButton url={f.url} name={f.name} className="flex-none bg-transparent border-0 text-dim" /></div>;
}

// Changes to a page, said by the room in one line ("maya made 3 changes to Launch plan"): not someone talking, so
// small and centred. A tap opens the page.
function Activity({ m, ctx }: { m: Msg; ctx: Ctx }) {
  const a = m.activity!;
  const who = a.by.map((b) => `${b.name}${b.count > 1 ? ` (${b.count})` : ""}`).join(", ");
  return <div className="flex justify-center px-2.5 mt-2" id={m.id}>
    <button type="button" data-tap onClick={() => ctx.openPage?.(a.page)}
      className="max-w-[85%] truncate rounded-full border-0 bg-line/60 px-3 py-1 font-mono text-[11px] text-dim cursor-pointer">
      ✎ {who} changed <b className="font-semibold text-ink">{a.title}</b> · {time(m.at)}</button>
  </div>;
}

export function Message({ m, ctx, firstOfRun, footer }: { m: Msg; ctx: Ctx; firstOfRun: boolean; footer?: ReactNode }) {
  if (m.kind === "activity" && m.activity) return <Activity m={m} ctx={ctx} />;
  const human = m.kind === "human", mine = human && m.email === ctx.me;
  const owner = human ? m.email : m.owner, who = ctx.person(owner);
  const name = human ? who.name : `${m.wolt} · ${owner === ctx.me ? "yours" : who.name + "'s"}`;
  const avatar = human ? personAvatar(who.name, who.color) : woltAvatar(m.creature || "raccoon", who.color);
  const readers = mine ? ctx.seen[m.id] || [] : [];
  // A wolt's terminal, for whoever may see it: the desk's tile on a computer, its session on your own lodge on a phone.
  // Hold a message (or right-click it on a computer) and the room dims and shows a small bar of actions under it: the
  // wolt's terminal, and copy. A short tap still does what it always did (in the main chat, it opens the thread);
  // tapping outside the bar closes it. On a computer, hovering a wolt's message also shows a terminal button.
  const link = !human && !ctx.showTerminal ? ctx.terminals?.[m.wolt!] : undefined;
  const openTerm = !human && ctx.showTerminal ? () => ctx.showTerminal!(m.wolt!) : link ? () => window.open(link, "_blank", "noopener") : undefined;
  const [acts, setActs] = useState<DOMRect | null>(null), [copied, setCopied] = useState(false);
  const bubble = useRef<HTMLDivElement>(null);
  const color = woltColor(m.wolt, ctx.wolts);
  const hold = useHold(!m.pending && !m.failed, () => { if (bubble.current) { setActs(bubble.current.getBoundingClientRect()); setCopied(false); } });
  const copy = async () => { try { await navigator.clipboard.writeText(m.text || ""); setCopied(true); setTimeout(() => setActs(null), 600); } catch { /* not allowed here */ } };
  return (
    <div>
    {acts && bubble.current && <Held rect={acts} html={bubble.current.outerHTML} right={mine} close={() => setActs(null)} items={[
      ...(ctx.reply ? [{ label: "Reply in thread", icon: <Reply size={18} />, run: () => ctx.reply!(m) }] : []),
      ...(m.text ? [{ label: copied ? "Copied" : "Copy", icon: copied ? <Check size={18} /> : <Copy size={18} />, run: copy, keep: true }] : []),
      ...(openTerm ? [{ label: `${m.wolt}'s terminal`, icon: <SquareTerminal size={18} />, href: link, run: link ? undefined : openTerm }] : []),
    ]} />}
    <div className={`group flex items-end gap-1.5 px-2.5 [@media(hover:none)]:select-none ${firstOfRun ? "mt-2.5" : "mt-1"} ${mine ? "flex-row-reverse" : ""}`} id={m.cid || m.id}
      {...hold}>
      {openTerm && firstOfRun ? <button type="button" data-tap onClick={(e) => { e.stopPropagation(); openTerm(); }} aria-label={`${m.wolt}'s terminal`} title={`${m.wolt}'s terminal`}
          className="flex-none p-0 border-0 bg-transparent cursor-pointer rounded-full"><img src={avatar} alt="" className="pixel block w-7 h-7 rounded-full" /></button>
        : <img src={avatar} alt="" className={`pixel w-7 h-7 flex-none rounded-full ${firstOfRun ? "" : "invisible"}`} />}
      <div data-bubble ref={bubble} className={`max-w-[80%] ${footer ? "min-w-[210px]" : "min-w-0"} rounded-xl border px-2.5 py-1.5 ${acts ? "invisible" : ""} ${mine ? "border-line" : "bg-panel border-line"}`}
        style={mine ? { background: mix(ctx.person(ctx.me).color, "#ffffff", 0.82) }
          : !human ? { background: mix(woltColor(m.wolt, ctx.wolts), "#ffffff", 0.9), borderColor: mix(woltColor(m.wolt, ctx.wolts), "#ffffff", 0.6) } : undefined}>
        {!mine && firstOfRun && <div className="font-mono text-[11px] text-dim lowercase mb-0.5" style={!human ? { color: woltColor(m.wolt, ctx.wolts) } : undefined}>[{name}]{human && who.guest && <span title="Came in with the invite link: this name wasn't checked" className="ml-1 px-1 rounded border border-line normal-case">guest</span>}</div>}
        {m.files?.length ? relayRoom ? <div className="font-mono text-xs text-dim mb-1">[{m.files.length === 1 ? "a file" : m.files.length + " files"}, not shown in this room yet]</div> : <Files m={m} ctx={ctx} /> : null}
        {m.audio ? <Voice m={m} ctx={ctx} /> : m.text ? <div className="text-[15px] leading-snug whitespace-pre-wrap break-words"><Words text={m.text} ctx={ctx} /></div> : null}
        {m.failed && !m.audio && <Unsent m={m} ctx={ctx} />}
        <Card msg={m} all={ctx.all} />
        {m.page && <PageTile m={m} ctx={ctx} />}
        <div className="flex justify-end items-center gap-1 mt-0.5 font-mono text-[10px] text-dim">
          {time(m.at)}
          {readers.length > 0 && <span className="inline-flex gap-px" title={"Read by " + readers.join(", ")}>
            {readers.map((r) => { const w = ctx.wolts.find((x) => x.wolt === r); return <img key={r} alt={r} className="pixel w-[15px] h-[15px]" src={woltAvatar(w?.creature || "raccoon", ctx.person(w?.owner).color)} />; })}
          </span>}
        </div>
        {footer}
      </div>
      {openTerm && <button type="button" data-tap onClick={(e) => { e.stopPropagation(); openTerm(); }} title={`${m.wolt}'s terminal`} aria-label={`${m.wolt}'s terminal`}
        className="hidden [@media(hover:hover)]:inline-flex self-center items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 font-mono text-[11px] cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        style={{ color }}><SquareTerminal size={15} />terminal</button>}
    </div>
    </div>
  );
}


// Each agent its own colour, so two agents of one person don't look alike: by its place in the room's list (the same on
// every phone, and no two alike for the first eight), or from its name if it has left the room.
const HUES = ["#2f6fa3", "#7a4fb0", "#2f7d6d", "#b0427a", "#8a6d1c", "#5b5bb5", "#3f8a3a", "#c4531e"];
export function woltColor(name = "", wolts: Wolt[] = []) {
  const i = wolts.findIndex((w) => w.wolt === name);
  if (i >= 0) return HUES[i % HUES.length];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function mix(hex: string, to: string, t: number) {  // blend a colour toward white, so text stays readable on it
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [c(hex), c(to)];
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// A long press: about half a second without moving. It also swallows the tap that ends it, and the phone's own
// long-press menu, so holding never opens the thread or selects the words underneath.
function useHold(on: boolean, fire: () => void) {
  const t = useRef(0), at = useRef<{ x: number; y: number } | null>(null), fired = useRef(false);
  if (!on) return {};
  const stop = () => { clearTimeout(t.current); at.current = null; };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("a, button, audio, video, input, [data-tap]")) return;
      fired.current = false; at.current = { x: e.clientX, y: e.clientY };
      t.current = window.setTimeout(() => { fired.current = true; at.current = null; navigator.vibrate?.(10); fire(); }, 450);
    },
    onPointerMove: (e: React.PointerEvent) => { const a = at.current; if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 8) stop(); },
    onPointerUp: stop, onPointerCancel: stop, onPointerLeave: stop,
    onClickCapture: (e: React.MouseEvent) => { if (fired.current) { fired.current = false; e.stopPropagation(); e.preventDefault(); } },
    onContextMenu: (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest("a, img, video, audio")) return; e.preventDefault(); stop(); fire(); },
    style: { WebkitTouchCallout: "none" } as React.CSSProperties,
  };
}

// Held, like WhatsApp: the message lifts above a blurred, dimmed room, with a menu card under it (above it if there's no
// room below). It lives on the page itself, outside any thread sheet, so tapping out closes only the menu.
type Item = { label: string; icon: ReactNode; color?: string; href?: string; run?: () => void; keep?: boolean };
function Held({ rect, html, right, close, items }: { rect: DOMRect; html: string; right: boolean; close: () => void; items: Item[] }) {
  const menuH = items.length * 48 + 8, gap = 8, vh = window.innerHeight;
  const top = Math.max(16, Math.min(rect.top, vh - 24 - menuH - gap - rect.height));
  const side = right ? { right: window.innerWidth - rect.right } : { left: rect.left };
  return createPortal(<div className="fixed inset-0 z-[3200] select-none [-webkit-touch-callout:none]" onClick={(e) => { e.stopPropagation(); close(); }} onPointerDown={(e) => e.stopPropagation()}>
    <div className="absolute inset-0 bg-[#18100a1a] backdrop-blur-[3px] animate-[fadein_.15s_ease-out]" />
    <div className="absolute pointer-events-none [&>*]:!max-w-none [&>*]:!m-0" style={{ top, ...side, width: rect.width }} dangerouslySetInnerHTML={{ __html: html.replace(" invisible", "") }} />
    <div role="menu" className="absolute min-w-[210px] rounded-xl bg-panel shadow-[0_8px_24px_#18100a2e] overflow-hidden animate-[fadein_.15s_ease-out]"
      style={{ top: top + rect.height + gap, ...side }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => {
        const inner = <><span className="flex-1">{it.label}</span><span className="text-ink/80">{it.icon}</span></>;
        const cls = `flex items-center gap-3 w-full px-4 h-11 text-[15px] text-ink bg-transparent border-0 text-left no-underline cursor-pointer active:bg-line/40 ${i ? "border-t border-line/70" : ""}`;
        return it.href ? <a key={i} role="menuitem" href={it.href} target="_blank" rel="noopener" onClick={close} className={cls} style={{ borderTopStyle: i ? "solid" : undefined }}>{inner}</a>
          : <button key={i} role="menuitem" type="button" onClick={() => { it.run?.(); if (!it.keep) close(); }} className={cls} style={{ borderTopStyle: i ? "solid" : undefined }}>{inner}</button>;
      })}
    </div>
  </div>, document.body);
}
