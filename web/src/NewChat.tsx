// Starting a chat: what it's about, who's in. Every person in the room is in; the room's main agent is picked for you,
// and you tap any other agent to bring it in (or the main one to leave it out). Start sends the first message and opens
// the chat; the room then hands it to the agents you picked.
import { useState } from "react";
import { Check, X } from "lucide-react";
import type { Ctx } from "./Message";
import type { Person, Wolt } from "./room";
import { personAvatar, woltAvatar } from "./sprites";
import { worn } from "./hats";

export function NewChatSheet({ ctx, people, wolts, main, onStart, onClose }: {
  ctx: Ctx; people: Person[]; wolts: Wolt[]; main?: string | null;
  onStart: (text: string, agents: Record<string, boolean>) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(wolts.map((w) => [w.wolt, w.wolt === main])));
  // tagging an agent in the words picks it too
  const tagged = (w: string) => new RegExp(`@${w}\\b`, "i").test(text);
  const isIn = (w: string) => picked[w] || tagged(w);
  const chip = "inline-flex items-center gap-1.5 rounded-full border-2 pl-1 pr-3 py-1 mr-1.5 mb-1.5 font-mono text-[13px] font-semibold cursor-pointer";
  const sec = "mt-4 mb-1.5 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
  const start = () => { const t = text.trim(); if (!t) return; onStart(t, Object.fromEntries(wolts.map((w) => [w.wolt, isIn(w.wolt)]))); };
  return <div className="absolute inset-0 z-[1650]">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
    <div className="absolute inset-x-0 bottom-0 max-h-[88%] overflow-y-auto bg-paper rounded-t-[18px] px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]">
      <div className="w-10 h-[5px] rounded-full bg-line mx-auto mb-2" />
      <div className="flex items-center">
        <b className="flex-1 font-mono text-acc text-lg">new chat</b>
        <button type="button" aria-label="Cancel" onClick={onClose} className="w-9 h-9 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={20} /></button>
      </div>
      <div className={sec}>What's it about</div>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Ask, plan, share an idea…"
        className="w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-[15px] leading-snug resize-none outline-none focus:border-acc" />
      <div className={sec}>People · everyone's in</div>
      <div>{people.map((p) => <span key={p.email} className={`${chip} border-acc bg-[#c4531e10] cursor-default`}>
        <img src={personAvatar(p.name, ctx.person(p.email).color, worn.people[p.email])} alt="" className="pixel w-6 h-6" />{p.name}<Check size={14} className="text-acc" /></span>)}</div>
      <div className={sec}>Agents · tap to bring in</div>
      <div>{wolts.map((w) => { const on = isIn(w.wolt); return <button key={w.wolt} type="button" disabled={w.paused}
        onClick={() => setPicked((s) => ({ ...s, [w.wolt]: !s[w.wolt] }))}
        className={`${chip} ${on ? "border-acc bg-[#c4531e10] text-ink" : "border-line bg-white text-dim"} ${w.paused ? "opacity-50" : ""}`}>
        <img src={woltAvatar(w.creature || "raccoon", ctx.person(w.owner).color, worn.wolts[w.wolt])} alt="" className="pixel w-6 h-6" />
        {w.wolt}{w.wolt === main && <span className="font-normal text-[10px] text-dim">default</span>}{on && <Check size={14} className="text-acc" />}</button>; })}</div>
      {wolts.some((w) => tagged(w.wolt) && !picked[w.wolt]) && <p className="m-0 font-mono text-[11px] text-dim">tagged in your message, so it's in</p>}
      <button type="button" onClick={start} disabled={!text.trim()}
        className="mt-4 w-full rounded-xl border-0 bg-acc text-white font-mono font-bold text-[15px] py-3.5 cursor-pointer disabled:opacity-40">Start chat</button>
    </div>
  </div>;
}
