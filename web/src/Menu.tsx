// The ☰ menu: this room, its settings, and later all your rooms. It slides in from the left, like Slack's.
import { Bell, BellOff, BellRing, Check, ChevronRight, MessagesSquare, Shell, Squirrel } from "lucide-react";
import { relayRoom } from "./relay";

const row = "flex items-center gap-3 w-full px-4 py-2.5 border-0 bg-transparent text-left text-[15px] text-ink no-underline cursor-pointer active:bg-panel";
const sec = "px-4 pt-4 pb-1 font-mono font-semibold text-[10.5px] tracking-[.08em] uppercase text-dim";

export function Menu({ open, panel, scrim, touch, close, title, me, push, freshCount, onThreads }: {
  open: boolean; panel: React.RefObject<HTMLElement | null>; scrim: React.RefObject<HTMLDivElement | null>; touch: React.DOMAttributes<HTMLElement>; close: () => void; title: string; me: string;
  push: { state: "ask" | "on" | "off"; turnOn: () => void }; freshCount: number; onThreads: () => void;
}) {
  // while a finger drags it, App moves these two directly; otherwise the classes below decide
  return <>
    <div ref={scrim} onClick={close} {...touch} className={`absolute inset-0 z-[1700] bg-[#18100a55] transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`} />
    <aside ref={panel} aria-hidden={!open} {...touch} className={`absolute inset-y-0 left-0 z-[1710] w-[84%] max-w-[360px] bg-paper flex flex-col shadow-[8px_0_24px_#18100a22] will-change-transform transition-transform duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] ${open ? "" : "-translate-x-full"}`}>
      {/* leaves room on the left for the ☰/✕ button, which stays on top in the same spot */}
      <div className="flex-none flex items-center gap-2.5 pl-[60px] pr-4 pt-[calc(14px+env(safe-area-inset-top))] pb-3 bg-panel border-b border-line">
        <div className="min-w-0"><div className="font-mono font-semibold text-acc">shell phone</div><div className="font-mono text-[11px] text-dim truncate">{me}</div></div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain pb-5">
        <div className={sec}>Your rooms</div>
        <button type="button" onClick={close} className={`${row} bg-[#f6e2d6]`}>
          <img src="/room-icon.png" alt="" className="w-[30px] h-[30px] rounded-full" />
          <span className="flex-1 min-w-0 truncate font-mono font-semibold text-sm"><span className="text-dim font-normal">~/</span>{title}</span>
          <Check size={20} className="text-acc" />
        </button>
        <div className={`${row} cursor-default text-dim`}><Shell size={20} className="text-dim" /><span className="flex-1 text-sm">All your rooms in one place</span><span className="font-mono text-[10px] border border-line rounded px-1.5">soon</span></div>
        <div className={sec}>This room</div>
        {!relayRoom && <button type="button" onClick={push.state === "ask" ? push.turnOn : undefined} className={row}>
          {push.state === "on" ? <BellRing size={20} className="text-acc" /> : push.state === "ask" ? <Bell size={20} className="text-acc" /> : <BellOff size={20} className="text-dim" />}
          <span className="flex-1">Notifications<small className="block text-xs text-dim">{push.state === "on" ? "On for this phone" : push.state === "ask" ? "Tap to turn on for this phone" : "Not available here (add the app to your home screen)"}</small></span>
          {push.state === "on" ? <Check size={20} className="text-go" /> : push.state === "ask" ? <span className="font-mono font-semibold text-xs text-white bg-acc rounded-lg px-2.5 py-1">turn on</span> : null}
        </button>}
        {!relayRoom && <a href="/join" className={row}><Squirrel size={20} className="text-acc" /><span className="flex-1">Add an agent<small className="block text-xs text-dim">An invite for your wolt or any AI agent</small></span><ChevronRight size={20} className="text-acc" /></a>}
        <button type="button" onClick={() => { close(); onThreads(); }} className={row}><MessagesSquare size={20} className="text-acc" /><span className="flex-1">Threads</span>
          {freshCount > 0 && <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-acc text-white font-mono font-semibold text-[10.5px] leading-[18px] text-center">{freshCount}</span>}</button>
      </div>
    </aside>
  </>;
}
