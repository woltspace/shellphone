// Shell's composer: a big round mic while the box is empty, the send arrow once you type or attach. A paperclip for files, or paste them:
// they wait above the box until you send, like iMessage.
// Typing @ suggests the room's wolts; typing / at the start offers a few ready-made asks.
import { useEffect, useRef, useState } from "react";
import { File as FileIcon, Mic, Paperclip, SendHorizontal, X } from "lucide-react";
import { relayRoom } from "./relay";
import type { Wolt } from "./room";

// What you were typing, kept per box (the main chat, each thread) while you go back and forth.
const drafts = new Map<string, string>();
const attached = new Map<string, { f: File; url?: string }[]>();  // and the files waiting with it
const MOST = 10;  // files in one message (the room takes no more)

export function Composer({ draft, wolts, me, onText, onFiles, onMic, placeholder }: {
  draft: string; wolts: Wolt[]; me: string; onText: (t: string) => void; onFiles: (f: File[], text: string) => void; onMic: () => void; placeholder?: string;
}) {
  const [text, setTextNow] = useState(() => drafts.get(draft) || "");
  const setText = (t: string) => { setTextNow(t); if (t) drafts.set(draft, t); else drafts.delete(draft); };
  const box = useRef<HTMLTextAreaElement>(null), pick = useRef<HTMLInputElement>(null);
  const [files, setFilesNow] = useState(() => attached.get(draft) || []);  // attached, not sent yet
  const setFiles = (f: { f: File; url?: string }[]) => { setFilesNow(f); if (f.length) attached.set(draft, f); else attached.delete(draft); };
  const [full, setFull] = useState(false);
  // A room through the relay carries text only, for now. Its paperclip opens what's coming instead, and the relay counts
  // the taps (only which one: the paperclip, voice or files; no room, no name, no words) so we know what people want.
  const [soon, setSoon] = useState(false);
  const tap = (what: "more" | "mic" | "file") => fetch(`/tap?what=${what}`, { method: "POST", keepalive: true, referrerPolicy: "no-referrer", credentials: "omit" }).catch(() => {});
  const comingSoon = () => { if (!soon) tap("more"); setSoon(!soon); };
  const attach = (f: File[]) => {
    const room = MOST - files.length, took = f.slice(0, Math.max(0, room));
    if (took.length < f.length) { setFull(true); setTimeout(() => setFull(false), 3000); }
    setFiles([...files, ...took.map((x) => ({ f: x, url: x.type.startsWith("image/") ? URL.createObjectURL(x) : undefined }))]); box.current?.focus();
  };
  const unattach = (i: number) => { if (files[i].url) URL.revokeObjectURL(files[i].url!); setFiles(files.filter((_, j) => j !== i)); };
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

  // grow only when the words need another line, and shrink back when the box empties: no size change on each key
  const grow = () => {
    const b = box.current; if (!b) return;
    if (!b.value) { b.style.height = ""; return; }
    if (b.scrollHeight > b.clientHeight + 1 && b.clientHeight < 140) b.style.height = Math.min(140, b.scrollHeight + 2) + "px";
  };
  useEffect(grow, []);  // a long draft coming back gets its height back too
  const set = (t: string) => { setText(t); requestAnimationFrame(() => { grow(); box.current?.focus(); }); };
  const send = () => {
    const t = text.trim();
    if (files.length) { onFiles(files.map((x) => x.f), t); files.forEach((x) => x.url && URL.revokeObjectURL(x.url)); setFiles([]); }
    else if (t) onText(t); else return;
    set("");
  };
  const round = "flex-none w-[46px] h-[46px] rounded-full bg-acc grid place-items-center border-0 cursor-pointer";
  const menu = "absolute left-2.5 right-2.5 bottom-full mb-1 bg-panel border border-line rounded-[10px] overflow-hidden shadow-[0_2px_10px_#18100a1f]";
  const item = "block w-full text-left px-3 py-2 font-mono text-[13px] border-0 bg-transparent cursor-pointer hover:bg-line";

  return (
    <div className="relative bg-panel border-t border-line px-2.5 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]" data-busy={text || files.length ? "" : undefined}>
      {tagOpts.length > 0 && <div className={menu}>{tagOpts.map((w) => <button key={w.wolt} type="button" className={item} onClick={() => set(text.replace(/@[\w-]*$/, "@" + w.wolt + " "))}>@{w.wolt}</button>)}</div>}
      {slash.length > 0 && <div className={menu}>{slash.map((s) => <button key={s.tag} type="button" className={item} onClick={() => set(s.text)}><b className="text-acc">/{s.tag}</b> <span className="text-dim">{s.text}</span></button>)}</div>}
      {full && <div className="pl-11 pb-1 text-xs text-acc">{MOST} at most in one message</div>}
      {soon && <div className={menu + " right-auto min-w-60"}>
        {([[Mic, "Voice note", "mic"], [Paperclip, "Photo or file", "file"]] as const).map(([Icon, label, what]) => (
          <button key={what} type="button" onClick={() => { tap(what); setSoon(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-3 border-0 border-b border-line bg-transparent text-left text-[15px] cursor-pointer">
            <Icon size={19} className="text-acc" />{label}<span className="ml-auto text-[11px] text-dim border border-line rounded-lg px-1.5">soon</span>
          </button>))}
        <div className="px-3.5 py-2 text-[11px] text-dim">Coming soon. We count taps here to choose what to build next.</div>
      </div>}
      {files.length > 0 && <div className="flex gap-3 overflow-x-auto pt-2.5 pr-2.5 pb-2 pl-11">{files.map((x, i) => (
        <div key={i} className="relative flex-none">
          {x.url ? <img src={x.url} alt={x.f.name} className="block h-20 w-auto max-w-48 object-contain rounded-lg border border-line" />
            : <div className="h-20 max-w-40 px-2 rounded-lg border border-line bg-paper flex items-center gap-1 text-[12px] font-mono"><FileIcon size={16} className="flex-none text-acc" /><span className="truncate">{x.f.name}</span></div>}
          <button type="button" aria-label={"Remove " + x.f.name} onClick={() => unattach(i)} className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-ink grid place-items-center border-0 cursor-pointer"><X size={14} className="text-white" /></button>
        </div>))}</div>}
      <div className="flex items-center gap-2">
        <button type="button" aria-label={soon ? "Close" : "Attach"} onClick={() => relayRoom ? comingSoon() : pick.current?.click()} className="flex-none w-9 h-9 grid place-items-center border-0 bg-transparent cursor-pointer">
          {soon ? <X size={23} className="text-acc" /> : <Paperclip size={23} className="text-acc" />}
        </button>
        <input ref={pick} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) attach(f); }} />
        <textarea ref={box} rows={1} value={text} placeholder={placeholder || "$ message, @wolt, or /"}
          onChange={(e) => { setText(e.target.value); grow(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); send(); } }}
          onPaste={(e) => {  // a pasted picture (or file) is attached like one from the paperclip; text pastes as usual
            const f = [...e.clipboardData.items].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((x): x is File => !!x);
            if (f.length && !relayRoom) { e.preventDefault(); attach(f); }  // a room through the relay carries text only, for now
          }}
          className="flex-1 min-w-0 resize-none bg-paper border border-line rounded-[10px] px-3 py-2.5 text-base leading-snug outline-none focus:shadow-[0_0_0_1px_var(--color-acc)] placeholder:font-mono placeholder:text-dim" />
        {text.trim() || files.length || relayRoom
          // pressing send doesn't take focus from the box: otherwise the keyboard starts closing, the button moves away
          // under the finger, and the tap only closes the keyboard
          ? <button type="button" aria-label="Send" className={round} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={send}><SendHorizontal size={22} className="text-white" /></button>
          : <button type="button" aria-label="Talk" className={round} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { box.current?.blur(); onMic(); }}><Mic size={24} className="text-white" /></button>}
      </div>
    </div>
  );
}
