// Settings: a small pop-up under the ⚙ at the top of home (it replaces the old side menu). Only what home doesn't
// already show: notifications, inviting people, your rooms, and, for the room's host, its main wolt.
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { inviteLink, relayHost, relayRoom } from "./relay";
import { say, type State } from "./room";
import type { Ctx } from "./Message";
import { Face } from "./Chats";

const ROW = "flex items-center gap-2 w-full px-4 py-3 border-0 border-b border-[#ece4d6] last:border-b-0 bg-transparent text-left text-[16px] text-ink cursor-pointer active:bg-[#f6efe2]";

export function SettingsPop({ state, ctx, push, compact, onClose }: {
  state: State; ctx: Ctx; push: { state: "ask" | "on" | "off"; turnOn: () => void }; compact?: boolean; onClose: () => void;
}) {
  const [note, setNote] = useState(""), [open, setOpen] = useState<"" | "main" | "rooms">("");
  // the host passes the room's invite link on: shared from the phone's own sheet, or copied
  const invite = async () => {
    const link = await inviteLink();
    if (!link) return setNote("Couldn't get the link from the room. Try again.");
    try { if (navigator.share) { await navigator.share({ title: "shellphone", text: "Join my shellphone room", url: link }); return; } }
    catch (e) { if ((e as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(link); setNote("Link copied"); } catch { setNote(link); }
  };
  const crown = async (wolt: string | null) => {
    const e = await say("/api/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wolt }) });
    setNote(e || ""); if (!e) setOpen("");
  };
  const title = state.title && state.title !== "shell" ? state.title : "shellphone";
  const host = state.me === state.host, mainW = state.members.wolts.find((w) => w.wolt === state.main);
  const on = push.state === "on";
  const chev = (k?: string) => <ChevronRight size={17} className={`flex-none text-dim transition-transform ${k && open === k ? "rotate-90" : ""}`} />;
  const more = "px-4 py-2.5 bg-[#faf7ef] border-b border-[#ece4d6] text-[13px] text-dim";
  return <div className="absolute inset-0 z-[1550]">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a40] animate-[fadein_.12s_ease-out]" />
    <div role="dialog" aria-label="Settings" className={`absolute ${compact ? "left-3 top-[54px] w-[274px]" : "right-[58px] top-[calc(56px+env(safe-area-inset-top))] w-[250px] max-w-[calc(100%-70px)]"} bg-panel rounded-[18px] overflow-hidden shadow-[0_10px_34px_#18100a55] animate-[fadein_.14s_ease-out]`}>
      <button type="button" role="switch" aria-checked={on} onClick={push.state === "ask" ? push.turnOn : undefined} className={`${ROW} ${push.state === "ask" ? "" : "cursor-default"}`}>
        <span className="flex-1 min-w-0">Notifications
          {!on && <small className="block text-xs text-dim">{relayRoom ? "not yet for rooms opened through a link" : push.state === "ask" ? "tap to turn on for this phone" : "add the app to your home screen first"}</small>}</span>
        <span className={`flex-none w-[46px] h-[28px] rounded-full p-[3px] transition-colors ${on ? "bg-go" : "bg-[#d6ccba]"}`}><i className={`block w-[22px] h-[22px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : ""}`} /></span>
      </button>
      {relayHost && <button type="button" onClick={invite} className={ROW}><span className="flex-1">Invite people</span>{chev()}</button>}
      <button type="button" aria-expanded={open === "rooms"} onClick={() => setOpen(open === "rooms" ? "" : "rooms")} className={ROW}>
        <span className="flex-1">Switch room</span><span className="text-dim truncate max-w-[90px]">{title}</span>{chev("rooms")}</button>
      {open === "rooms" && <div className={more}>
        <div className="flex items-center gap-2 text-ink"><span className="flex-1 truncate font-mono font-semibold">{title}</span><span className="font-mono font-semibold text-xs text-go">you're here</span></div>
        <a href="https://shellphone.woltspace.app/" target="_blank" rel="noopener" className="block mt-2 font-mono font-semibold text-acc no-underline">+ Join or start a room</a>
      </div>}
      {host && <button type="button" aria-expanded={open === "main"} onClick={() => setOpen(open === "main" ? "" : "main")} className={ROW}>
        <span className="flex-1">Main wolt</span>{mainW && <Face w={mainW} ctx={ctx} size={24} />}<span className="text-dim">{mainW ? mainW.wolt : "none"}</span>{chev("main")}</button>}
      {host && open === "main" && <div className={more}>
        <p className="m-0 mb-2">In the shared chat and its threads; brings other wolts in or out when you ask it.</p>
        <div className="flex flex-wrap gap-1.5">{[...state.members.wolts.map((w) => w.wolt), ""].map((n) => <button key={n || "none"} type="button" data-main={n || "none"} onClick={() => crown(n || null)}
          className={`rounded-[14px] px-3 py-1.5 font-mono font-semibold text-[13px] cursor-pointer border ${(state.main || "") === n ? "bg-acc text-white border-acc" : "bg-panel text-ink border-line"}`}>{n || "none"}</button>)}</div>
      </div>}
      {note && <p className="m-0 px-4 py-2 font-mono text-xs text-acc break-all">&gt; {note}</p>}
    </div>
  </div>;
}
