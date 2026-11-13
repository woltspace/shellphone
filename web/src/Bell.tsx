// The bell: what's new for you (answers from wolts, messages from other people), newest first, with the switch for
// notifications on this phone at the top. It takes the place of the old inbox and of any settings screen.
import { ChevronLeft } from "lucide-react";
import type { Ctx } from "./Message";
import type { Msg } from "./room";
import { relayRoom } from "./relay";
import { personAvatar } from "./sprites";
import { Face } from "./Chats";

export type Note = { m: Msg; place: string; chat: boolean; where: string; fresh: boolean };
function ago(at: number) {
  const s = Math.max(0, Date.now() / 1000 - at);
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`;
}
const words = (m: Msg) => (m.text || (m.files?.length ? "sent " + m.files.map((f) => f.name).join(", ") : m.audio ? "sent a voice note" : m.page ? "posted " + m.page.title : "")).replace(/\s+/g, " ").slice(0, 110);

export function BellScreen({ notes, ctx, push, compact, onBack, onOpen }: {
  notes: Note[]; ctx: Ctx; push: { state: "ask" | "on" | "off"; turnOn: () => void }; compact?: boolean; onBack: () => void; onOpen: (n: Note) => void;
}) {
  const on = push.state === "on", fresh = notes.filter((n) => n.fresh), earlier = notes.filter((n) => !n.fresh).slice(0, 20);
  const SEC = "px-4 pt-3.5 pb-1.5 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";
  const row = (n: Note) => {
    const m = n.m, wolt = m.kind === "wolt" ? ctx.wolts.find((w) => w.wolt === m.wolt) : undefined, p = ctx.person(m.email);
    const tagged = !n.chat;  // from the shared chat only what names you gets here
    return <button key={m.id} type="button" onClick={() => onOpen(n)} className={`flex w-full items-start gap-3 px-4 py-3 border-0 border-b border-[#ece4d6] text-left cursor-pointer active:opacity-70 ${n.fresh ? "bg-[#fbeee6]" : "bg-panel"}`}>
      {m.kind === "wolt" ? <Face w={wolt} ctx={ctx} size={40} /> : <img src={personAvatar(p.name, p.color)} alt="" className="flex-none w-10 h-10 rounded-full" />}
      <span className="min-w-0 flex-1 text-[15px] leading-snug"><b>{m.kind === "wolt" ? m.wolt : p.name}</b> {tagged ? "mentioned you" : <>replied in <b>{n.where}</b></>}: “{words(m)}”
        <small className="block mt-0.5 text-xs text-dim">{ago(m.at)}</small></span>
    </button>;
  };
  return <div className="h-full flex flex-col bg-paper">
    <header className={`relative flex-none grid place-items-center border-b border-line ${compact ? "h-[60px]" : "pt-[calc(8px+env(safe-area-inset-top))] pb-2 min-h-[52px]"}`}>
      <button type="button" aria-label="Back" onClick={onBack} className={`absolute left-1 ${compact ? "top-2.5" : "top-[calc(6px+env(safe-area-inset-top))]"} w-9 h-10 grid place-items-center border-0 bg-transparent text-acc cursor-pointer`}><ChevronLeft size={26} /></button>
      <h1 className="m-0 font-mono font-bold text-[17px]">Notifications</h1>
    </header>
    <button type="button" role="switch" aria-checked={on} onClick={push.state === "ask" ? push.turnOn : undefined}
      className={`flex-none flex items-center gap-3 w-full px-4 py-2.5 border-0 border-b border-line bg-paper text-left ${push.state === "ask" ? "cursor-pointer" : "cursor-default"}`}>
      <span className="flex-1 min-w-0"><span className="block font-mono font-semibold text-[15px]">Push to this phone</span>
        <small className="block text-[13px] text-dim truncate">{relayRoom ? "not yet for rooms opened through a link" : on ? "when a wolt answers or someone mentions you" : push.state === "ask" ? "tap to turn on" : "add the app to your home screen first"}</small></span>
      <span className={`flex-none w-[50px] h-[30px] rounded-full p-[3px] transition-colors ${on ? "bg-go" : "bg-[#d6ccba]"}`}><i className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} /></span>
    </button>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[calc(20px+env(safe-area-inset-bottom))]">
      {fresh.length > 0 && <div className={SEC}>New</div>}
      {fresh.map(row)}
      {earlier.length > 0 && <div className={SEC}>Earlier</div>}
      {earlier.map(row)}
      {!notes.length && <p className="text-center text-dim font-mono text-xs mt-10 px-6">Nothing yet. Answers from your wolts show up here.</p>}
    </div>
  </div>;
}
