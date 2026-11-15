// A room on this computer, in its host's menu: whether anyone outside can reach it, and the one place to invite people.
// "Not linked" until the host links it; linked, it has an address others can open and an invite to send;
// unlinked again, both stop working for good and the room goes on as it was. The room answers these calls only to its
// host, on the computer it runs on (see link_call in room.py); for anyone else this draws nothing.
import { useEffect, useState } from "react";
import { ChevronRight, Globe, Loader2, Lock, Smartphone, UserPlus } from "lucide-react";

type Info = { linked: boolean; relay?: string; link?: string; invite?: string; guests?: number; error?: string };

async function ask(on?: boolean): Promise<Info | null> {
  try {
    const r = await fetch("/api/link", on === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) });
    if (r.status === 403 || r.status === 404) return null;  // not this room's host here, or a room that has no such switch
    return await r.json();
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
  const [busy, setBusy] = useState<"" | "link" | "unlink">(""), [sure, setSure] = useState(false);
  const [note, setNote] = useState(""), [mine, setMine] = useState("");
  useEffect(() => { if (open) { setSure(false); ask().then(setInfo); } }, [open]);  // each time the menu opens: `shellphone link` may have changed it meanwhile
  if (!info) return null;
  const flip = async (on: boolean) => {
    setBusy(on ? "link" : "unlink"); setNote(""); setMine(""); setSure(false);
    const got = await ask(on);
    setBusy("");
    if (!got) return setNote("Couldn't reach the room. Try again.");
    setInfo(got.error ? { ...info, error: got.error } : got);
    if (on && got.linked && got.invite) pass(got.invite, "Join my shellphone room", setNote);  // "Link and invite": the invite comes right after
  };
  const small = "block text-xs text-dim";
  if (!info.linked) return <>
    <div className={`${row} cursor-default`}><Lock size={20} className="text-go" />
      <span className="flex-1">Not linked<small className={small}>Nobody can reach this room through {info.relay || "the site"}.</small></span></div>
    <button type="button" disabled={!!busy} onClick={() => flip(true)} className={row}><UserPlus size={20} className="text-acc" />
      <span className="flex-1">Invite people<small className={`${small} ${info.error ? "text-acc" : ""}`}>{busy ? "Linking the room…" : info.error || `To invite someone, the room is linked to ${info.relay || "the site"} first. You can unlink it any time.`}</small>
        {!busy && <span className="inline-block mt-2 font-mono font-semibold text-xs text-white bg-acc rounded-lg px-2.5 py-1">link and invite</span>}</span>
      {busy && <Loader2 size={20} className="text-acc animate-spin" />}</button>
  </>;
  return <>
    <div className={`${row} cursor-default`}><Globe size={20} className="text-acc" />
      <span className="flex-1">Linked<small className={small}>Reachable through {info.relay}, by the people you invite{info.guests ? ` (${info.guests} came in)` : ""}. Messages stay on this computer.</small></span></div>
    <button type="button" onClick={() => info.invite && pass(info.invite, "Join my shellphone room", setNote)} className={row}><UserPlus size={20} className="text-acc" />
      <span className="flex-1">Invite people<small className={`${small} ${note.startsWith("http") ? "break-all" : ""}`}>{note || "Send this link to a friend: they open it and pick a name. They come in as a guest."}</small></span><ChevronRight size={20} className="text-acc" /></button>
    <button type="button" onClick={() => info.link && pass(info.link, "My shellphone room", setMine)} className={row}><Smartphone size={20} className="text-acc" />
      <span className="flex-1">Open it on your phone<small className={`${small} ${mine.startsWith("http") ? "break-all" : ""}`}>{mine || "Your own link: it opens the room as you, its host. Keep it to yourself."}</small></span><ChevronRight size={20} className="text-acc" /></button>
    <button type="button" disabled={!!busy} onClick={() => (sure ? flip(false) : setSure(true))} className={row}><Lock size={20} className={sure ? "text-acc" : "text-dim"} />
      <span className="flex-1">{sure ? "Tap again to unlink" : "Unlink"}<small className={small}>{busy ? "Unlinking…" : "Everyone outside loses access at once, and both links stop working for good. The room and its history stay here."}</small></span>
      {busy ? <Loader2 size={20} className="text-acc animate-spin" /> : sure ? <span className="font-mono font-semibold text-xs text-white bg-acc rounded-lg px-2.5 py-1">unlink</span> : null}</button>
  </>;
}
