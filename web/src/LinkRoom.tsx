// Sharing a room on this computer, in its host's menu: one row with a choice, "Private" or "Anyone with the link".
// Shared, two more rows hand over the invite and the host's own link; private again, both stop working for good and
// the room goes on as it was. The room answers these calls only to its
// host: on the computer it runs on they can change it; come in from outside with their own link they see what it is and
// get the invite, nothing more (see link_call in room.py). For anyone else this draws nothing.
import { useEffect, useState } from "react";
import { ChevronRight, Globe, Loader2, Lock, Smartphone, UserPlus } from "lucide-react";
import { answered, settled, unlinkedWords, type Info } from "./linkwords.js";

async function ask(on?: boolean): Promise<Info | null> {
  try {
    const r = await fetch("/api/link", on === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* no words from the room */ }
    return answered(on === undefined, r.status, body);  // a refusal draws nothing; an answer that can't be read is never shown as "Private"
  } catch { return null; }
}

// Hand a link over: the phone's own share sheet, or copied. Says what happened in the row's small print.
async function pass(url: string, text: string, say: (note: string) => void) {
  try { if (navigator.share) { await navigator.share({ title: "shellphone", text, url }); return; } }
  catch (e) { if ((e as Error).name === "AbortError") return; }  // only a cancelled sheet ends here; anything else falls back to copying
  try { await navigator.clipboard.writeText(url); say("Link copied"); } catch { say(url); }
}

export function LinkRoom({ open, row }: { open: boolean; row: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState<"" | "link" | "unlink">("");
  const [note, setNote] = useState(""), [said, setSaid] = useState(""), [mine, setMine] = useState("");
  useEffect(() => { if (open) ask().then(setInfo); }, [open]);  // each time the menu opens: `shellphone share` may have changed it meanwhile
  if (!info) return null;
  if (info.unknown) return <div className={`${row} cursor-default`}><Lock size={20} className="text-dim" />
    <span className="flex-1 min-w-0">Share<small className="block text-xs text-acc">{info.error ? `${info.error}. ` : ""}Couldn't check whether this room is shared. Open the menu again to retry.</small></span></div>;
  const flip = async (on: boolean) => {
    if (on === info.linked) return;
    if (!on && !window.confirm("Make this room private? Everyone outside loses access at once, and its links stop working for good.")) return;
    setBusy(on ? "link" : "unlink"); setNote(""); setSaid(""); setMine("");
    const got = await ask(on);
    const fresh = got && !got.error ? null : await ask();  // no answer, or a failure: ask the room what it is now
    const now = settled(info, got, fresh);
    setBusy("");
    setInfo(now.info); setNote(now.note);
  };
  const small = "block text-xs text-dim";
  const words = unlinkedWords(info, note, busy);
  return <>
    <label className={`${row} cursor-default`}>{info.linked ? <Globe size={20} className="text-acc" /> : <Lock size={20} className="text-acc" />}
      <span className="flex-1 min-w-0">Share
        {busy ? <small className={small}>{busy === "link" ? "Sharing…" : "Stopping…"}</small>
          : words.warn ? <small className="block text-xs text-acc">{words.text}</small>
          : info.linked && info.guests ? <small className={small}>{info.guests} came in</small> : null}</span>
      {busy ? <Loader2 size={20} className="text-acc animate-spin" />
        : info.fixed ? <span title="Changed on the computer the room runs on" className="flex-none font-mono font-semibold text-xs text-dim">{info.linked ? "Anyone with the link" : "Private"}</span>
        : <select aria-label="Who can open this room" value={info.linked ? "link" : "private"} onChange={(e) => flip(e.target.value === "link")}
        title={info.linked ? `Shared through ${info.relay}${info.via === "tunnel" ? ", by a tunnel of its own" : ""}` : "No shared link opens this room"}
        className="flex-none font-mono font-semibold text-xs text-acc bg-panel border border-line rounded-lg px-2 py-1.5 cursor-pointer">
        <option value="private">Private</option><option value="link">Anyone with the link</option></select>}</label>
    {info.linked && <>
      <button type="button" onClick={() => info.invite && pass(info.invite, "Join my shellphone room", setSaid)} className={row}><UserPlus size={20} className="text-acc" />
        <span className="flex-1">Invite humans<small className={`${small} ${said.startsWith("http") ? "break-all" : ""}`}>{said || "The link to send to a friend"}</small></span><ChevronRight size={20} className="text-acc" /></button>
      {info.link && <button type="button" onClick={() => info.link && pass(info.link, "My shellphone room", setMine)} className={row}><Smartphone size={20} className="text-acc" />
        <span className="flex-1">Open it on your phone<small className={`${small} ${mine.startsWith("http") ? "break-all" : ""}`}>{mine || "Your own link, as host: keep it to yourself"}</small></span><ChevronRight size={20} className="text-acc" /></button>}
    </>}
  </>;
}
