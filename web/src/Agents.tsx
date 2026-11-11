// The agents in this room, in the ☰ menu: each one is on or paused, and can be removed. Paused, it is off: the room hands
// it nothing, a tag included, and it can't post, so it costs nothing. The switches show where you may use them: on every
// agent for the room's host, on your own agents otherwise. Everyone sees the list.
import { useState } from "react";
import { Pause, Play, X } from "lucide-react";
import { say, type Person, type Wolt } from "./room";
import { woltAvatar } from "./sprites";

const set = (wolt: string, state: "on" | "paused" | "removed") =>
  say("/api/wolt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wolt, state }) });

export function Agents({ wolts, people, me, host, sec }: { wolts: Wolt[]; people: Person[]; me: string; host?: string; sec: string }) {
  const [busy, setBusy] = useState("");      // the agent a change is on its way for
  const [asking, setAsking] = useState("");  // the agent whose removal waits for a second tap
  const [note, setNote] = useState("");
  if (!wolts.length) return null;
  const guest = !!people.find((p) => p.email === me)?.guest;
  const may = (w: Wolt) => !guest && (me === host || w.owner === me);  // the room decides; this only hides what it would refuse
  const go = async (wolt: string, state: "on" | "paused" | "removed") => {
    setBusy(wolt); setAsking("");
    setNote((await set(wolt, state)) || "");
    setBusy("");
  };
  const btn = "flex-none h-8 px-2.5 grid place-items-center rounded-lg border font-mono text-xs cursor-pointer disabled:opacity-50", plain = `${btn} border-line bg-transparent`;
  return <>
    <div className={sec}>Agents</div>
    {wolts.map((w) => {
      const owner = people.find((p) => p.email === w.owner);
      return <div key={w.wolt} className="flex items-center gap-2.5 px-4 py-2">
        <img src={woltAvatar(w.creature || "raccoon", owner?.color || "#8a6a52")} alt="" className={`w-[30px] h-[30px] rounded-full ${w.paused ? "opacity-40" : ""}`} />
        <span className="flex-1 min-w-0">
          <span className={`block truncate font-mono text-sm ${w.paused ? "text-dim" : "text-ink"}`}>{w.wolt}</span>
          <small className="block text-xs text-dim">{w.paused ? "paused · hears nothing" : `${owner?.name || w.owner}'s`}</small>
        </span>
        {may(w) && (asking === w.wolt
          ? <>
            <button type="button" disabled={busy === w.wolt} onClick={() => go(w.wolt, "removed")} className={`${btn} text-white bg-acc border-acc`}>remove</button>
            <button type="button" onClick={() => setAsking("")} className={`${plain} text-dim`}>keep</button>
          </>
          : <>
            <button type="button" disabled={busy === w.wolt} aria-label={w.paused ? `Bring ${w.wolt} back` : `Pause ${w.wolt}`} onClick={() => go(w.wolt, w.paused ? "on" : "paused")} className={`${plain} gap-1 grid-flow-col ${w.paused ? "text-acc" : "text-dim"}`}>
              {w.paused ? <><Play size={14} />resume</> : <><Pause size={14} />pause</>}
            </button>
            <button type="button" aria-label={`Remove ${w.wolt}`} onClick={() => setAsking(w.wolt)} className={`${plain} px-2 text-dim`}><X size={14} /></button>
          </>)}
      </div>;
    })}
    {note && <div className="px-4 pb-1 text-xs text-acc">{note}</div>}
  </>;
}
