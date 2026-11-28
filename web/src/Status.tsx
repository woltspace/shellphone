// A lodge phone: the wolt's status, pinned on top of your chat with it. One line (what it's on now); tap it for what
// it's waiting on you for (answers you tap, sent as your message) and what's next. The wolt keeps it itself
// (wolt/site/status.json); the room reads it and sends words only.
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export type Status = { now: string; waiting: { ask: string; choices: string[] }[]; next: string[] };

export function StatusPin({ status, answer }: { status: Status; answer: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const waiting = status.waiting.length;
  return <div className="flex-none bg-[#fffdf8] border-b border-line shadow-[0_2px_8px_#18100a12]">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
      className="w-full flex items-center gap-2 px-3.5 py-2 border-0 bg-transparent text-left cursor-pointer">
      <b className="flex-none text-[13px] text-[#2f9e5b]">● Now</b>
      <span className="flex-1 min-w-0 truncate text-[14px]">{status.now || "—"}</span>
      {waiting > 0 && !open && <span className="flex-none rounded-full bg-[#fbf1dc] text-[#9a6b0c] text-[11px] font-bold px-2 py-0.5">{waiting} for you</span>}
      <ChevronDown size={17} className={`flex-none text-dim transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="px-3.5 pb-3">
      {status.waiting.map((w, i) => <div key={i} className="mb-2.5">
        <div className="text-[13.5px]"><b className="text-[#9a6b0c]">Waiting on you: </b>{w.ask}</div>
        {w.choices.length > 0 && <div className="flex gap-1.5 mt-1.5">{w.choices.map((c, j) => <button key={c} type="button" onClick={() => { answer(c); setOpen(false); }}
          className={`flex-1 h-9 rounded-[10px] text-[13.5px] font-semibold cursor-pointer active:scale-95 transition-transform ${j === 0 ? "bg-acc text-white border-0" : "bg-paper border border-line"}`}>{c}</button>)}</div>}
      </div>)}
      {status.next.length > 0 && <div className="text-[13px] text-dim"><b className="text-ink">Next: </b>{status.next.join(" · ")}</div>}
    </div>}
  </div>;
}
