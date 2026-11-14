// Who's in this thread: up to three overlapping faces in the thread's header (a green dot: in; grey: paused here or
// in the whole room). Tapped, a sheet with a switch per agent. The room keeps the switches (/api/state "who") and hands
// a thread's messages only to the agents in it. People flip them; a room pause wins over all of them.
// An older room without switches: they're kept on this phone only, as a mock, and say so.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { say, type Msg, type Wolt } from "./room";
import { woltColor, type Ctx } from "./Message";
import { woltAvatar } from "./sprites";
import { worn } from "./hats";

type Mark = "in" | "paused" | "out";
const KEY = "mock-thread-who";
const load = (): Record<string, Record<string, Mark>> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const save = (all: Record<string, Record<string, Mark>>) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: it lasts until reload */ } };

// the mock's guess at who's in: the agents that spoke in the thread or were tagged in it
function guess(list: Msg[], wolts: Wolt[]): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (const w of wolts) {
    const spoke = list.some((m) => m.kind === "wolt" && m.wolt === w.wolt);
    const tagged = list.some((m) => new RegExp(`@${w.wolt}\\b`, "i").test(m.text || ""));
    out[w.wolt] = spoke || tagged ? "in" : "out";
  }
  return out;
}

export function ThreadWho({ thread, list, ctx, room, fallback, host, main }: {
  thread: string; list: Msg[]; ctx: Ctx;
  room?: Record<string, "in" | "paused">;  // the room's switches for this thread; undefined: the room has none (mock)
  fallback?: "in" | "out";                 // the room's rule for an agent with no switch here (none given: not in yet)
  host?: string;
  main?: string | null;  // the room's main agent: always in, its switch locked
}) {
  const real = room !== undefined;
  const [mock, setMock] = useState(load), [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(""), [note, setNote] = useState("");
  const [sent, setSent] = useState<Record<string, Mark>>({});  // switched here, until the room's state catches up
  const marks: Record<string, Mark> = real
    ? { ...Object.fromEntries(ctx.wolts.map((w) => [w.wolt, (fallback || "out") as Mark])), ...room, ...sent }
    : { ...guess(list, ctx.wolts), ...(mock[thread] || {}) };
  const guest = !!ctx.people.find((p) => p.email === ctx.me)?.guest;
  // same rights as a room pause: the host on every agent, otherwise your own (the room decides; this only hides what it would refuse)
  const may = (w: Wolt) => !real || (!guest && (ctx.me === host || w.owner === ctx.me));

  const flip = async (wolt: string, m: Mark) => {
    if (!real) { const next = { ...mock, [thread]: { ...(mock[thread] || {}), [wolt]: m } }; setMock(next); save(next); return; }
    setBusy(wolt); setNote(""); setSent((s) => ({ ...s, [wolt]: m }));
    const err = await say("/api/thread-who", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread, wolt, state: m }) });
    if (err) { setNote(err); setSent((s) => { const { [wolt]: _, ...rest } = s; return rest; }); }
    setBusy("");
  };
  // once the room has caught up, what it says wins again (someone else may flip it later)
  useEffect(() => {
    if (real && Object.entries(sent).some(([w, m]) => room![w] === m)) setSent((s) => Object.fromEntries(Object.entries(s).filter(([w, m]) => room![w] !== m)));
  }, [room]);

  const face = (w: Wolt) => woltAvatar(w.creature || "raccoon", ctx.person(w.owner).color, worn.wolts[w.wolt]);
  const on = (w: Wolt) => marks[w.wolt] === "in" && !w.paused;
  const shown = ctx.wolts.filter((w) => marks[w.wolt] !== "out");
  const first = shown.slice(0, 3), more = shown.length - first.length;
  if (!ctx.wolts.length) return null;

  return <>
    <button type="button" aria-label="Who's in this thread" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className="flex-none flex items-center h-10 px-1 border-0 bg-transparent cursor-pointer">
      {first.length ? first.map((w, i) => <span key={w.wolt} className="relative" style={{ marginLeft: i ? -10 : 0, zIndex: 3 - i }}>
        <img src={face(w)} alt={w.wolt} className={`pixel block w-[28px] h-[28px] rounded-full border-2 border-[#fffdf6] bg-[#fbe9df] ${on(w) ? "" : "grayscale opacity-50"}`} />
        {on(w) && <i className="absolute -right-px -bottom-px w-[9px] h-[9px] rounded-full bg-[#3aa45b] border-[1.5px] border-[#fffdf6]" />}
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
          const m = marks[w.wolt], yes = on(w), locked = !!w.paused || !may(w) || busy === w.wolt || w.wolt === main;
          return <div key={w.wolt} className="flex items-center gap-2.5 py-2 border-t border-line">
            <img src={face(w)} alt="" className={`pixel w-[30px] h-[30px] rounded-full ${yes ? "" : "grayscale opacity-50"}`} />
            <span className="flex-1 min-w-0">
              <span className={`block truncate font-mono text-sm ${yes ? "" : "text-dim"}`} style={yes ? { color: woltColor(w.wolt, ctx.wolts) } : undefined}>{w.wolt}</span>
              <small className="block text-xs text-dim">{(w.owner === ctx.me ? "yours" : `${ctx.person(w.owner).name}'s`) + " · "}{w.paused ? "paused in the room" : w.wolt === main ? "main · always in every thread" : yes ? "in this thread" : m === "paused" ? "paused here · still active elsewhere" : "not in this thread"}</small>
            </span>
            <button type="button" role="switch" aria-checked={yes} disabled={locked} aria-label={`${yes ? "Pause" : "Bring in"} ${w.wolt} here`}
              onClick={() => flip(w.wolt, yes ? "paused" : "in")}
              className={`relative flex-none w-[42px] h-[24px] rounded-full border-0 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default ${yes ? "bg-[#3aa45b]" : "bg-line"}`}>
              <i className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${yes ? "left-[21px]" : "left-[3px]"}`} />
            </button>
          </div>;
        })}
        {note && <p className="mt-2 mb-0 text-xs text-acc">{note}</p>}
        <p className="mt-2 mb-0 text-xs text-dim">Paused here: gets nothing from this thread, still active elsewhere. Tagging an agent brings it in.</p>
        {!real && <p className="mt-1.5 mb-0 font-mono text-[11px] text-acc">Mock: switches are kept on this phone only. Agents aren't really paused yet.</p>}
      </div>
    </div>}
  </>;
}
