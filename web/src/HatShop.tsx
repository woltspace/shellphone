// Hats in the ☰ menu: tap your own face in People, or one of your wolts' faces in Agents, and the Hat Shop opens under
// it: tap a hat to wear it, "none" to take it off. Everyone in the room sees the hats on the faces.
import { useState } from "react";
import { HATS, hatSrc } from "./hats";
import { say, type Person } from "./room";
import { personAvatar } from "./sprites";

const post = (url: string, body: unknown) => say(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const putFace = (hat: string) => post("/api/face", { face: hat ? "hat-" + hat : "" });
export const putLook = (wolt: string, look: Record<string, string> | undefined, hat: string) => post("/api/look", { wolt, look: { ...look, hat } });

export function HatGrid({ hat, put }: { hat: string; put: (hat: string) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false), [note, setNote] = useState("");
  return <div className="px-4 pb-3">
    <div className="grid grid-cols-6 gap-1.5">
      {[{ id: "", name: "none" }, ...HATS].map((h) => <button key={h.id || "none"} type="button" disabled={busy} aria-label={h.name} title={h.name} aria-pressed={hat === h.id}
        onClick={async () => { setBusy(true); setNote((await put(h.id)) || ""); setBusy(false); }}
        className={`aspect-square grid place-items-center rounded-lg border cursor-pointer disabled:opacity-60 ${hat === h.id ? "border-acc bg-[#f6e2d6]" : "border-line bg-transparent"}`}>
        {h.id ? <img src={hatSrc(h.id)} alt="" className="pixel w-7 h-7 object-contain" /> : <span className="font-mono text-[10px] text-dim">none</span>}
      </button>)}
    </div>
    {note && <div className="pt-1 text-xs text-acc">{note}</div>}
  </div>;
}

// The people in the room, with their hats. Your own face opens your hats.
export function People({ people, me, host, faces = {}, sec }: { people: Person[]; me: string; host?: string; faces?: Record<string, string>; sec: string }) {
  const [open, setOpen] = useState(false);
  const hatOf = (e: string) => (faces[e]?.startsWith("hat-") ? faces[e].slice(4) : "");
  const list = [...people].sort((a, b) => (a.email === me ? -1 : b.email === me ? 1 : a.name.localeCompare(b.name)));
  return <>
    <div className={sec}>People</div>
    {list.map((p) => { const mine = p.email === me && !p.guest, face = <img src={personAvatar(p.name, p.color, hatOf(p.email))} alt="" className="w-[30px] h-[30px]" />;
      return <div key={p.email}>
        <div className="flex items-center gap-2.5 px-4 py-2">
          {mine ? <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Your hat" title="Your hat" className="flex-none p-0 border-0 bg-transparent cursor-pointer">{face}</button> : face}
          <span className="flex-1 min-w-0">
            <span className="block truncate font-mono text-sm text-ink">{p.name}</span>
            <small className="block text-xs text-dim truncate">{[p.email === me && "you", p.email === host && "host", p.guest && "guest"].filter(Boolean).join(" · ") || "member"}{mine && !open ? " · tap your face for a hat" : ""}</small>
          </span>
        </div>
        {mine && open && <HatGrid hat={hatOf(p.email)} put={putFace} />}
      </div>; })}
  </>;
}
