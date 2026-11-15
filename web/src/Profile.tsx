// Someone's card, opened from the strip: who they are, what they're up to right now, and the chats they're in.
// For a wolt: who keeps it and where it's gnawing. For a person: their wolts. Tap a chat to go there.
import { X } from "lucide-react";
import { mix, woltColor, woltFace } from "./Message";
import type { Msg, State } from "./room";
import { personAvatar } from "./sprites";
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
  const rows = [...chats.entries()].filter(([id]) => { const r = byId.get(id); return !!r && !r.thread && (threads.has(id) || r.kind === "human"); }).sort((a, b) => b[1].at - a[1].at).slice(0, 12);
  const working = w ? (state.working_in?.[w.wolt] || []) : [];
  const last = mine[mine.length - 1];
  const wolts = p ? state.members.wolts.filter((x) => x.owner === p.email) : [];
  const keeper = w ? state.members.people.find((x) => x.email === w.owner) : undefined;
  const sec = "mt-4 mb-1 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
  return <div className="absolute inset-0 z-[1660]">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
    <div role="dialog" aria-label={name} className="absolute inset-x-0 bottom-0 max-h-[85%] max-w-[640px] mx-auto flex flex-col bg-paper rounded-t-[18px] shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)] overflow-hidden">
      <div className="flex-none px-4 pt-2 pb-3" style={{ background: `linear-gradient(${mix(color, "#ffffff", 0.78)}, transparent)` }}>
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mb-2" />
        <div className="flex items-center gap-3">
          <span className={`flex-none ${m?.busy ? "" : "idle-bob"}`}>
            <img src={face} alt="" className={`pixel block w-[72px] h-[72px] ${m?.busy ? "gnaw-img" : ""}`} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-mono font-bold text-lg truncate" style={{ color }}>{name}{w && state.main === w.wolt && <span className="ml-1 text-acc text-base" title="main agent">★</span>}</div>
            <div className="font-mono text-[12px] text-dim truncate">
              {w ? <>{w.creature} · {keeper ? <button type="button" onClick={() => onPick("p:" + keeper.email)} className="p-0 border-0 bg-transparent font-mono text-[12px] text-acc cursor-pointer">{keeper.name}'s</button> : "a guest's"} wolt{state.main === w.wolt ? " · main agent" : ""}</>
                : p!.email === state.me ? "you" : p!.guest ? "guest" : "human"}
            </div>
            <div className="mt-1 font-mono text-[12px]">
              {m ? (m.busy ? <span className="lore font-semibold">gnawing…</span> : <span className={m.awake ? "text-go" : "text-dim"}>● {m.word}</span>)
                : <span className="text-dim">{last ? `last said something ${ago(last.at)}` : "hasn't said anything yet"}</span>}
              {m && last && <span className="text-dim"> · last spoke {ago(last.at)}</span>}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex-none self-start w-9 h-9 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={18} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
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
