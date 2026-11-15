// Starting a chat: what it's about, and who's in, as a row and a switch each (the same sheet as a thread's who's-in).
// Every person starts in, you always are; the room's main agent starts in, and anyone you @tag switches on by itself.
// Start sends the first message and opens the chat; the room then hands it to the agents switched on.
import { useState } from "react";
import { X } from "lucide-react";
import { mix, woltColor, type Ctx } from "./Message";
import type { Person, Wolt } from "./room";
import { personAvatar, woltAvatar } from "./sprites";
import { worn } from "./hats";

function Switch({ on, locked, label, flip }: { on: boolean; locked?: boolean; label: string; flip: () => void }) {
  return <button type="button" role="switch" aria-checked={on} disabled={locked} aria-label={label} onClick={flip}
    className={`relative flex-none w-[42px] h-[24px] rounded-full border-0 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${on ? "bg-[#3aa45b]" : "bg-line"}`}>
    <i className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
  </button>;
}

export function NewChatSheet({ ctx, people, wolts, main, onStart, onClose }: {
  ctx: Ctx; people: Person[]; wolts: Wolt[]; main?: string | null;
  onStart: (text: string, agents: Record<string, boolean>, people: Record<string, boolean>, title: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState(""), [title, setTitle] = useState("");
  const [agents, setAgents] = useState<Record<string, boolean>>(() => Object.fromEntries(wolts.map((w) => [w.wolt, w.wolt === main])));
  const [folks, setFolks] = useState<Record<string, boolean>>(() => Object.fromEntries(people.map((p) => [p.email, true])));
  const tagged = (w: string) => new RegExp(`@${w}\\b`, "i").test(text);
  const agentIn = (w: Wolt) => !w.paused && (agents[w.wolt] || tagged(w.wolt));
  const start = () => { const t = text.trim(); if (!t) return; onStart(t, Object.fromEntries(wolts.map((w) => [w.wolt, agentIn(w)])), folks, title.trim()); };
  const sec = "mt-3 mb-0.5 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
  const row = (key: string, face: string, name: string, color: string | undefined, yes: boolean, note: string, sw: React.ReactNode) =>
    <div key={key} className="flex items-center gap-2.5 py-2 border-t border-line">
      <img src={face} alt="" className={`pixel w-[30px] h-[30px] ${yes ? "" : "grayscale opacity-50"}`} />
      <span className="flex-1 min-w-0">
        <span className={`block truncate font-mono text-sm ${yes ? "" : "text-dim"}`} style={yes && color ? { color } : undefined}>{name}</span>
        <small className="block truncate text-xs text-dim">{note}</small>
      </span>
      {sw}
    </div>;
  return <div className="absolute inset-0 z-[1650]">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
    <div role="dialog" aria-label="New chat" className="absolute inset-x-0 bottom-0 max-h-[90%] max-w-[640px] mx-auto flex flex-col bg-paper rounded-t-[18px] shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]">
      <div className="flex-none px-4 pt-2">
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mb-2" />
        <div className="flex items-center">
          <b className="flex-1 font-mono text-[13px] text-dim tracking-wide">NEW CHAT</b>
          <button type="button" aria-label="Cancel" onClick={onClose} className="w-9 h-9 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={18} /></button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Name it (optional)"
          className="w-full mt-1 rounded-lg border border-line bg-white px-3 py-1.5 font-mono font-semibold text-[13px] outline-none focus:border-acc" />
        {/* the first message, looking like one: your face and a bubble in your colour */}
        <div className="flex items-end gap-2 mt-3">
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Message…"
            className="flex-1 min-w-0 rounded-2xl rounded-br-sm border-2 px-3 py-2.5 text-[15px] leading-snug resize-none outline-none"
            style={{ background: mix(ctx.person(ctx.me).color, "#ffffff", 0.82), borderColor: mix(ctx.person(ctx.me).color, "#ffffff", 0.5) }} />
          <img src={personAvatar(ctx.person(ctx.me).name, ctx.person(ctx.me).color, worn.people[ctx.me])} alt="" className="pixel flex-none w-8 h-8" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4">
        <div className={sec}>People</div>
        {people.map((p) => { const me = p.email === ctx.me, yes = me || folks[p.email];
          return row(p.email, personAvatar(p.name, ctx.person(p.email).color, worn.people[p.email]), p.name + (me ? " (you)" : ""), ctx.person(p.email).color, yes,
            me ? "starts the chat" : yes ? "in this chat" : "not in this chat",
            <Switch on={yes} locked={me} label={`${yes ? "Leave out" : "Bring in"} ${p.name}`} flip={() => setFolks((s) => ({ ...s, [p.email]: !s[p.email] }))} />); })}
        <div className={sec}>Agents</div>
        {wolts.map((w) => { const yes = agentIn(w), byTag = tagged(w.wolt);
          return row(w.wolt, woltAvatar(w.creature || "raccoon", ctx.person(w.owner).color, worn.wolts[w.wolt]), w.wolt, woltColor(w.wolt, ctx.wolts), yes,
            w.paused ? "paused in the room" : byTag ? "tagged in your message" : yes ? (w.wolt === main ? "default · in this chat" : "in this chat") : "not in this chat",
            <Switch on={yes} locked={!!w.paused || byTag} label={`${yes ? "Leave out" : "Bring in"} ${w.wolt}`} flip={() => setAgents((s) => ({ ...s, [w.wolt]: !s[w.wolt] }))} />); })}
      </div>
      <div className="flex-none px-4 pt-2 pb-[max(14px,env(safe-area-inset-bottom))] border-t border-line">
        <button type="button" onClick={start} disabled={!text.trim()}
          className="w-full rounded-xl border-0 bg-acc text-white font-mono font-bold text-[15px] py-3.5 cursor-pointer disabled:opacity-40">Send ➤ <span className="font-normal opacity-80">starts the chat</span></button>
      </div>
    </div>
  </div>;
}
