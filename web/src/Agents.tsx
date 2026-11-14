// The agents in this room, in the ☰ menu: each one is on or paused, and can be removed. Paused, it is off: the room hands
// it nothing, a tag included, and it can't post, so it costs nothing. The switches show where you may use them: on every
// agent for the room's host, on your own agents otherwise. Everyone sees the list.
import { useState } from "react";
import { ChevronDown, Pause, Play, X } from "lucide-react";
import { say, type Person, type Wolt } from "./room";
import { woltAvatar } from "./sprites";
import { worn } from "./hats";
import { HatGrid, putLook } from "./HatShop";

const set = (wolt: string, state: "on" | "paused" | "removed") =>
  say("/api/wolt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wolt, state }) });

// The main agent (main): in every thread, and the one you can ask to bring others in or out. Only the host picks it.
const crown = (wolt: string | null) =>
  say("/api/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wolt }) });

export function Agents({ wolts, people, me, host, sec, main, looks = {} }: { wolts: Wolt[]; people: Person[]; me: string; host?: string; sec: string; main?: string | null; looks?: Record<string, Record<string, string>> }) {
  const [dressing, setDressing] = useState("");  // the agent whose hats are open under it (tap its face)
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
      const face = <img src={woltAvatar(w.creature || "raccoon", owner?.color || "#8a6a52", worn.wolts[w.wolt])} alt="" className={`w-[30px] h-[30px] rounded-full ${w.paused ? "opacity-40" : ""}`} />;
      return <div key={w.wolt}><div className="flex items-center gap-2.5 px-4 py-2">
        {may(w) ? <button type="button" onClick={() => setDressing(dressing === w.wolt ? "" : w.wolt)} aria-expanded={dressing === w.wolt} aria-label={`${w.wolt}'s hat`} title={`${w.wolt}'s hat`}
          className="flex-none p-0 border-0 bg-transparent cursor-pointer">{face}</button> : face}
        <span className="flex-1 min-w-0">
          <span className={`block truncate font-mono text-sm ${w.paused ? "text-dim" : "text-ink"}`}>{w.wolt}</span>
          <small className="block text-xs text-dim">{w.paused ? "paused · hears nothing" : `${owner?.name || w.owner}'s`}{main === w.wolt ? " · main" : ""}</small>
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
      </div>
      {may(w) && dressing === w.wolt && <HatGrid hat={looks[w.wolt]?.hat || ""} put={(hat) => putLook(w.wolt, looks[w.wolt], hat)} />}
      </div>;
    })}
    {me === host && main !== undefined && <label className="relative flex items-center gap-2.5 px-4 py-2 cursor-pointer">
      <span className="flex-1 min-w-0">
        <span className="block font-mono text-sm text-ink">Main agent: <span className={main ? "text-acc" : "text-dim"}>{main || "none"}</span></span>
        <small className="block text-xs text-dim">in every thread, brings others in or out when you ask</small>
      </span>
      <ChevronDown size={16} className="flex-none text-dim" />
      {/* the phone's own picker, laid invisibly over the row */}
      <select aria-label="Main agent" value={main || ""} disabled={busy === "main"} className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={async (e) => { setBusy("main"); setNote((await crown(e.target.value || null)) || ""); setBusy(""); }}>
        <option value="">none</option>
        {wolts.map((w) => <option key={w.wolt} value={w.wolt}>{w.wolt}</option>)}
      </select>
    </label>}
    {note && <div className="px-4 pb-1 text-xs text-acc">{note}</div>}
  </>;
}
