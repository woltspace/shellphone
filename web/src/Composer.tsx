// Shell's composer: a big round mic while the box is empty, the send arrow once you type. A paperclip for files.
// Typing @ suggests the room's wolts; typing / at the start offers a few ready-made asks.
import { useRef, useState } from "react";
import type { Wolt } from "./room";

export function Composer({ wolts, me, onText, onFiles, onMic }: {
  wolts: Wolt[]; me: string; onText: (t: string) => void; onFiles: (f: File[], text: string) => void; onMic: () => void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null), pick = useRef<HTMLInputElement>(null);
  const tag = text.match(/(?:^|\s)@([\w-]*)$/);
  const tagOpts = tag ? wolts.filter((w) => w.wolt.toLowerCase().startsWith(tag[1].toLowerCase())) : [];
  const all = wolts.map((w) => "@" + w.wolt).join(" ");
  const mine = wolts.filter((w) => w.owner === me).map((w) => "@" + w.wolt), others = wolts.filter((w) => w.owner !== me).map((w) => "@" + w.wolt);
  const slash = text.startsWith("/") && !text.includes(" ") ? [
    { tag: "status", text: `${all} what are you each working on right now?` },
    { tag: "review", text: `${others[0] || all} please review ` },
    { tag: "summary", text: `${mine[0] || all} sum up what this room decided so far` },
    { tag: "handoff", text: `${mine[0] || all} write a handoff for ${others[0] || "the others"}: what's done, what's next, what's risky` },
  ].filter((s) => s.tag.startsWith(text.slice(1))) : [];

  const grow = () => { const b = box.current; if (b) { b.style.height = "auto"; b.style.height = Math.min(140, b.scrollHeight) + "px"; } };
  const set = (t: string) => { setText(t); requestAnimationFrame(() => { grow(); box.current?.focus(); }); };
  const send = () => { const t = text.trim(); if (!t) return; onText(t); set(""); };
  const round = "flex-none w-[46px] h-[46px] rounded-full bg-acc grid place-items-center border-0 cursor-pointer";
  const menu = "absolute left-2.5 right-2.5 bottom-full mb-1 bg-panel border border-line rounded-[10px] overflow-hidden shadow-[0_2px_10px_#18100a1f]";
  const item = "block w-full text-left px-3 py-2 font-mono text-[13px] border-0 bg-transparent cursor-pointer hover:bg-line";

  return (
    <div className="relative bg-panel border-t border-line px-2.5 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]" data-busy={text ? "" : undefined}>
      {tagOpts.length > 0 && <div className={menu}>{tagOpts.map((w) => <button key={w.wolt} type="button" className={item} onClick={() => set(text.replace(/@[\w-]*$/, "@" + w.wolt + " "))}>@{w.wolt}</button>)}</div>}
      {slash.length > 0 && <div className={menu}>{slash.map((s) => <button key={s.tag} type="button" className={item} onClick={() => set(s.text)}><b className="text-acc">/{s.tag}</b> <span className="text-dim">{s.text}</span></button>)}</div>}
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Attach" onClick={() => pick.current?.click()} className="flex-none w-9 h-9 grid place-items-center border-0 bg-transparent cursor-pointer">
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-acc"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5Z" /></svg>
        </button>
        <input ref={pick} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) { onFiles(f, text.trim()); set(""); } }} />
        <textarea ref={box} rows={1} value={text} placeholder="$ message, @wolt, or /"
          onChange={(e) => { setText(e.target.value); grow(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); send(); } }}
          className="flex-1 min-w-0 resize-none bg-paper border border-line rounded-[10px] px-3 py-2.5 text-base leading-snug outline-none focus:shadow-[0_0_0_1px_var(--color-acc)] placeholder:font-mono placeholder:text-dim" />
        {text.trim()
          ? <button type="button" aria-label="Send" className={round} onClick={send}><svg viewBox="0 0 24 24" className="w-[22px] h-[22px] fill-white"><path d="M2 21l21-9L2 3v7l15 2-15 2v7Z" /></svg></button>
          : <button type="button" aria-label="Talk" className={round} onClick={onMic}><svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2Z" /></svg></button>}
      </div>
    </div>
  );
}
