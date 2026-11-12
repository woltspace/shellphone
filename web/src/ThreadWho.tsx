// Who's in this thread: a MOCK to try the feel, nothing behind it yet. Three overlapping faces in the thread's header;
// tapped, a sheet with a switch per agent. The switches are kept on this phone only: the room still hands every agent
// what it did before, so no one is really paused or brought in.
import { useState } from "react";
import { X } from "lucide-react";
import type { Msg, Wolt } from "./room";
import type { Ctx } from "./Message";
import { woltAvatar } from "./sprites";

type Mark = "in" | "paused" | "out";
const KEY = "mock-thread-who";
const load = (): Record<string, Record<string, Mark>> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const save = (all: Record<string, Record<string, Mark>>) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: it lasts until reload */ } };

// in by default: the agents that spoke in the thread or were tagged in it
function guess(list: Msg[], wolts: Wolt[]): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (const w of wolts) {
    const spoke = list.some((m) => m.kind === "wolt" && m.wolt === w.wolt);
    const tagged = list.some((m) => new RegExp(`@${w.wolt}\\b`, "i").test(m.text || ""));
    out[w.wolt] = spoke || tagged ? "in" : "out";
  }
  return out;
}

export function ThreadWho({ thread, list, ctx }: { thread: string; list: Msg[]; ctx: Ctx }) {
  const [all, setAll] = useState(load), [open, setOpen] = useState(false);
  const marks = { ...guess(list, ctx.wolts), ...(all[thread] || {}) };
  const set = (wolt: string, m: Mark) => { const next = { ...all, [thread]: { ...(all[thread] || {}), [wolt]: m } }; setAll(next); save(next); };
  const face = (w: Wolt) => woltAvatar(w.creature || "raccoon", ctx.person(w.owner).color);
  const shown = ctx.wolts.filter((w) => marks[w.wolt] !== "out");
  const first = shown.slice(0, 3), more = shown.length - first.length;
  if (!ctx.wolts.length) return null;

  return <>
    <button type="button" aria-label="Who's in this thread" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className="flex-none flex items-center h-10 px-1 border-0 bg-transparent cursor-pointer">
      {first.length ? first.map((w, i) => <span key={w.wolt} className="relative" style={{ marginLeft: i ? -10 : 0, zIndex: 3 - i }}>
        <img src={face(w)} alt={w.wolt} className={`pixel block w-[28px] h-[28px] rounded-full border-2 border-[#fffdf6] bg-[#fbe9df] ${marks[w.wolt] === "paused" ? "grayscale opacity-50" : ""}`} />
        {marks[w.wolt] === "in" && <i className="absolute -right-px -bottom-px w-[9px] h-[9px] rounded-full bg-[#3aa45b] border-[1.5px] border-[#fffdf6]" />}
      </span>)
        : <span className="grid place-items-center w-[28px] h-[28px] rounded-full border-2 border-dashed border-line text-dim text-sm">+</span>}
      {more > 0 && <span className="ml-1 font-mono text-[11px] text-dim">+{more}</span>}
    </button>
    {open && <div className="fixed inset-0 z-[2950]" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
      <div className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
      <div role="dialog" aria-label="Who's in this thread" onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 max-w-[640px] mx-auto bg-paper rounded-t-[18px] px-4 pt-2 pb-[max(14px,env(safe-area-inset-bottom))] shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]">
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mb-2" />
        <div className="flex items-center">
          <b className="flex-1 font-mono text-[13px] text-dim tracking-wide">WHO'S IN THIS THREAD</b>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="w-9 h-9 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={18} /></button>
        </div>
        {ctx.wolts.map((w) => {
          const m = marks[w.wolt], on = m === "in";
          return <div key={w.wolt} className="flex items-center gap-2.5 py-2 border-t border-line">
            <img src={face(w)} alt="" className={`pixel w-[30px] h-[30px] rounded-full ${on ? "" : "grayscale opacity-50"}`} />
            <span className="flex-1 min-w-0">
              <span className={`block truncate font-mono text-sm ${on ? "text-ink" : "text-dim"}`}>{w.wolt}</span>
              <small className="block text-xs text-dim">{on ? "in this thread" : m === "paused" ? "paused here · still active elsewhere" : "not in this thread"}</small>
            </span>
            <button type="button" role="switch" aria-checked={on} aria-label={`${on ? "Pause" : "Bring in"} ${w.wolt} here`}
              onClick={() => set(w.wolt, on ? "paused" : "in")}
              className={`relative flex-none w-[42px] h-[24px] rounded-full border-0 cursor-pointer transition-colors ${on ? "bg-[#3aa45b]" : "bg-line"}`}>
              <i className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
            </button>
          </div>;
        })}
        <p className="mt-2 mb-0 text-xs text-dim">Paused here: gets nothing from this thread, still active elsewhere. @-tagging someone brings them in.</p>
        <p className="mt-1.5 mb-0 font-mono text-[11px] text-acc">Mock: switches are kept on this phone only. Agents aren't really paused yet.</p>
      </div>
    </div>}
  </>;
}
