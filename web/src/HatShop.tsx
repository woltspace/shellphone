// Hats in the ☰ menu: you, then each of your own wolts. Tap one and the Hat Shop opens under it: tap a hat to wear it,
// "none" to take it off. Everyone in the room sees the hats on the faces; only you dress yourself and your wolts.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { HATS, hatSrc } from "./hats";
import { say, type Person, type Wolt } from "./room";
import { personAvatar, woltAvatar } from "./sprites";

const post = (url: string, body: unknown) => say(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function HatShop({ me, wolts, people, looks = {}, faces = {}, sec }: {
  me: string; wolts: Wolt[]; people: Person[]; looks?: Record<string, Record<string, string>>; faces?: Record<string, string>; sec: string;
}) {
  const [open, setOpen] = useState("");  // whose hats are showing: an email for you, a wolt's name for one of yours
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const you = people.find((p) => p.email === me);
  if (!you || you.guest) return null;
  const mine = wolts.filter((w) => w.owner === me);
  const face = faces[me]?.startsWith("hat-") ? faces[me].slice(4) : "";
  const rows = [
    { key: me, name: "You", hat: face, src: (h: string) => personAvatar(you.name, you.color, h),
      put: (h: string) => post("/api/face", { face: h ? "hat-" + h : "" }) },
    ...mine.map((w) => ({ key: w.wolt, name: w.wolt, hat: looks[w.wolt]?.hat || "", src: (h: string) => woltAvatar(w.creature || "raccoon", you.color, h),
      put: (h: string) => post("/api/look", { wolt: w.wolt, look: { ...looks[w.wolt], hat: h } }) })),
  ];
  return <>
    <div className={sec}>Hats</div>
    {rows.map((r) => <div key={r.key}>
      <button type="button" onClick={() => { setOpen(open === r.key ? "" : r.key); setNote(""); }} aria-expanded={open === r.key}
        className="flex items-center gap-2.5 w-full px-4 py-2 border-0 bg-transparent text-left cursor-pointer active:bg-panel">
        <img src={r.src(r.hat)} alt="" className="pixel w-[30px] h-[30px]" />
        <span className="flex-1 min-w-0">
          <span className="block truncate font-mono text-sm text-ink">{r.name}</span>
          <small className="block text-xs text-dim">{HATS.find((h) => h.id === r.hat)?.name || "no hat"}</small>
        </span>
        <ChevronDown size={16} className={`flex-none text-dim transition-transform ${open === r.key ? "rotate-180" : ""}`} />
      </button>
      {open === r.key && <div className="grid grid-cols-6 gap-1.5 px-4 pb-3">
        {[{ id: "", name: "none" }, ...HATS].map((h) => <button key={h.id || "none"} type="button" disabled={busy} aria-label={h.name} title={h.name} aria-pressed={r.hat === h.id}
          onClick={async () => { setBusy(true); setNote((await r.put(h.id)) || ""); setBusy(false); }}
          className={`aspect-square grid place-items-center rounded-lg border cursor-pointer disabled:opacity-60 ${r.hat === h.id ? "border-acc bg-[#f6e2d6]" : "border-line bg-transparent"}`}>
          {h.id ? <img src={hatSrc(h.id)} alt="" className="pixel w-7 h-7 object-contain" /> : <span className="font-mono text-[10px] text-dim">none</span>}
        </button>)}
      </div>}
    </div>)}
    {note && <div className="px-4 pb-1 text-xs text-acc">{note}</div>}
  </>;
}
