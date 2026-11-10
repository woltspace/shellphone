// One bubble: who said it, the words (with @tags), a voice note with its words, a file or picture, a card.
import { relayRoom } from "./relay";
import { useRef, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Card } from "./Card";
import type { FileInfo, Msg, Person, Wolt } from "./room";
import { personAvatar, woltAvatar } from "./sprites";

export type Ctx = { me: string; person: (e?: string) => Person; wolts: Wolt[]; people: Person[]; seen: Record<string, string[]>; all: Msg[]; view: (urls: string[], at?: number) => void; retry?: (cid: string) => void };

const IMAGE = /^(png|jpe?g|gif|webp|avif|heic|bmp)$/i, VIDEO = /^(mp4|mov|m4v|webm)$/i;
const time = (at: number) => new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Words({ text, ctx }: { text: string; ctx: Ctx }) {
  const names = new Set([...ctx.wolts.map((w) => w.wolt.toLowerCase()), ...ctx.people.map((p) => p.name.toLowerCase())]);
  // a little markdown, like the classic page: links, **bold**, `code`, and @tags
  return <>{text.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\*\*[^*\n]+\*\*|`[^`\n]+`|(?:^|\s)@[\w-]+)/g).map((part, i) => {
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-acc underline break-all">{part}</a>;
    if (/^\*\*.+\*\*$/.test(part)) return <b key={i}>{part.slice(2, -2)}</b>;
    if (/^`.+`$/.test(part)) return <code key={i} className="font-mono text-[13px] bg-paper border border-line rounded px-1">{part.slice(1, -1)}</code>;
    const m = part.match(/^(\s?)@([\w-]+)$/);
    return m && names.has(m[2].toLowerCase()) ? <span key={i}>{m[1]}<b className="text-acc font-semibold">@{m[2]}</b></span> : part;
  })}</>;
}

// A round play button and a line that fills as it plays. Only one sound at a time: the app pauses the others.
function Player({ src, seconds }: { src?: string; seconds?: number }) {
  const a = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false), [at, setAt] = useState(0), [len, setLen] = useState(seconds || 0);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return <div className="flex items-center gap-2.5 h-9">
    <audio ref={a} src={src} preload="none" onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => { setOn(false); setAt(0); }}
      onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} onLoadedMetadata={(e) => isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)} />
    <button type="button" aria-label={on ? "Pause" : "Play"} disabled={!src} onClick={() => (on ? a.current?.pause() : a.current?.play())}
      className="flex-none w-8 h-8 rounded-full bg-acc grid place-items-center border-0 cursor-pointer disabled:opacity-40">
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">{on ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}</svg>
    </button>
    <div className="flex-1 h-1 rounded bg-line overflow-hidden cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (a.current && len) a.current.currentTime = ((e.clientX - r.left) / r.width) * len; }}>
      <div className="h-full bg-acc" style={{ width: `${len ? Math.min(100, (at / len) * 100) : 0}%` }} />
    </div>
    <span className="font-mono text-[11px] text-dim tabular-nums">{fmt(on || at ? at : len)}</span>
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
    <Player src={src} seconds={m.seconds} />
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
      {pics.map((f, i) => <img key={f.url} src={f.url} alt={f.name} onClick={() => ctx.view(pics.map((p) => p.url), i)} className="block w-full aspect-[3/4] object-cover rounded-lg cursor-zoom-in" />)}
    </div>}
    {rest.map((f) => <File key={f.url} f={f} ctx={ctx} />)}
  </>;
}

function File({ f, ctx }: { f: FileInfo; ctx: Ctx }) {
  if (IMAGE.test(f.type)) return <img src={f.url} alt={f.name} onClick={() => ctx.view([f.url])} className="block max-w-[min(260px,68vw)] max-h-[320px] rounded-lg cursor-zoom-in mb-1" />;
  if (VIDEO.test(f.type)) return <video src={f.url} controls playsInline preload="metadata" className="block max-w-[min(260px,68vw)] rounded-lg mb-1" />;
  return <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-2.5 py-2 mb-1 border border-line rounded-[10px] bg-paper no-underline text-ink">
    <span className="text-xl">📄</span><span className="min-w-0"><span className="block font-semibold truncate">{f.name}</span><span className="block font-mono text-[11px] text-dim">{f.type.toUpperCase()} · {Math.max(1, Math.round(f.size / 1024))} KB</span></span>
  </a>;
}

export function Message({ m, ctx, firstOfRun, footer }: { m: Msg; ctx: Ctx; firstOfRun: boolean; footer?: ReactNode }) {
  const human = m.kind === "human", mine = human && m.email === ctx.me;
  const owner = human ? m.email : m.owner, who = ctx.person(owner);
  const name = human ? who.name : `${m.wolt} · ${owner === ctx.me ? "yours" : who.name + "'s"}`;
  const avatar = human ? personAvatar(who.name, who.color) : woltAvatar(m.creature || "raccoon", who.color);
  const readers = mine ? ctx.seen[m.id] || [] : [];
  return (
    <div className={`flex items-end gap-1.5 px-2.5 ${firstOfRun ? "mt-2.5" : "mt-1"} ${mine ? "flex-row-reverse" : ""}`} id={m.cid || m.id}>
      <img src={avatar} alt="" className={`pixel w-7 h-7 flex-none rounded-full ${firstOfRun ? "" : "invisible"}`} />
      <div className={`max-w-[80%] ${footer ? "min-w-[210px]" : "min-w-0"} rounded-xl border px-2.5 py-1.5 ${mine ? "border-line" : "bg-panel border-line"}`}
        style={mine ? { background: mix(ctx.person(ctx.me).color, "#ffffff", 0.82) } : undefined}>
        {!mine && firstOfRun && <div className="font-mono text-[11px] text-dim lowercase mb-0.5">[{name}]</div>}
        {m.files?.length ? relayRoom ? <div className="font-mono text-xs text-dim mb-1">[{m.files.length === 1 ? "a file" : m.files.length + " files"}, not shown in this room yet]</div> : <Files m={m} ctx={ctx} /> : null}
        {m.audio ? <Voice m={m} ctx={ctx} /> : m.text ? <div className="text-[15px] leading-snug whitespace-pre-wrap break-words"><Words text={m.text} ctx={ctx} /></div> : null}
        {m.failed && !m.audio && <Unsent m={m} ctx={ctx} />}
        <Card msg={m} all={ctx.all} />
        <div className="flex justify-end items-center gap-1 mt-0.5 font-mono text-[10px] text-dim">
          {time(m.at)}
          {readers.length > 0 && <span className="inline-flex gap-px" title={"Read by " + readers.join(", ")}>
            {readers.map((r) => { const w = ctx.wolts.find((x) => x.wolt === r); return <img key={r} alt={r} className="pixel w-[15px] h-[15px]" src={woltAvatar(w?.creature || "raccoon", ctx.person(w?.owner).color)} />; })}
          </span>}
        </div>
        {footer}
      </div>
    </div>
  );
}

export function mix(hex: string, to: string, t: number) {  // blend a colour toward white, so text stays readable on it
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [c(hex), c(to)];
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
