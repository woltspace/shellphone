// Handing a link over: a small window with the link, Copy, and Share (the phone's own share sheet, where there is one).
// Used for "Invite humans" from the menu and from the chat list, and for the host's own link.
import { useEffect, useState } from "react";
import { Check, Copy, Share, UserPlus, X } from "lucide-react";
import { inviteLink, relayHost, relayRoom } from "./relay";

// The room's invite for humans: through the relay for a room started there, else the room's own shared link (if it's shared).
export async function roomInvite(): Promise<{ url?: string; why?: string }> {
  if (relayRoom) {
    if (!relayHost) return { why: "Only the host can invite humans. Message them to ask." };
    const url = await inviteLink();
    return url ? { url } : { why: "Couldn't get the link from the room. Try again." };
  }
  try {
    const r = await fetch("/api/link", { cache: "no-store" });
    if (!r.ok) return { why: "Only the room's host can invite humans." };
    const info = await r.json();
    if (info?.linked && info.invite) return { url: info.invite };
    return { why: "This room isn't shared yet. Open the menu, then Share → Anyone with the link." };
  } catch { return { why: "Couldn't reach the room. Try again." }; }
}

export function LinkModal({ title, sub, get, note, onClose }: { title: string; sub: string; get: () => Promise<{ url?: string; why?: string }>; note?: string; onClose: () => void }) {
  const [got, setGot] = useState<{ url?: string; why?: string } | null>(null), [copied, setCopied] = useState(false);
  useEffect(() => { get().then(setGot); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener("keydown", key, true); return () => removeEventListener("keydown", key, true);
  }, [onClose]);
  const url = got?.url || "";
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the link is there to select by hand */ } };
  const share = () => navigator.share({ title: "shellphone", text: "Join my shellphone room", url }).catch(() => {});
  return <div className="fixed inset-0 z-[2950] grid place-items-center px-4">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a59] backdrop-blur-[3px] animate-[fadein_.18s_ease-out]" />
    <div role="dialog" aria-label={title} className="relative w-[min(440px,100%)] bg-paper rounded-2xl shadow-[0_24px_70px_#18100a59] animate-[pop_.2s_cubic-bezier(.2,.8,.2,1)] overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <span className="w-9 h-9 rounded-full bg-[#c4531e1a] grid place-items-center"><UserPlus size={18} className="text-acc" /></span>
        <div className="flex-1 min-w-0"><div className="font-semibold text-[16px]">{title}</div><div className="text-[12.5px] text-dim">{sub}</div></div>
        <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 grid place-items-center border-0 bg-transparent text-dim cursor-pointer rounded-md hover:bg-[#18100a0d]"><X size={18} /></button>
      </div>
      <div className="px-5 pb-5">
        {!got ? <p className="m-0 text-[13px] text-dim">Getting the link…</p>
          : got.why ? <p className="m-0 text-[13.5px] text-acc">{got.why}</p>
          : <>
            <div className="rounded-xl border border-line bg-white px-3 py-2.5 font-mono text-[12px] text-[#4a4038] break-all select-all">{url}</div>
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={copy} className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border-0 bg-acc text-white font-semibold text-[15px] cursor-pointer hover:brightness-110 active:scale-[.98] transition">{copied ? <><Check size={18} />Copied</> : <><Copy size={18} />Copy link</>}</button>
              {"share" in navigator && <button type="button" onClick={share} className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border border-line bg-white text-ink font-semibold text-[15px] cursor-pointer hover:border-acc active:scale-[.98] transition"><Share size={18} />Share</button>}
            </div>
            {note && <p className="mt-3 mb-0 text-[12px] text-dim leading-snug">{note}</p>}
          </>}
      </div>
    </div>
  </div>;
}
