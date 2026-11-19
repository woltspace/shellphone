// "Add an agent" as a sheet in the app, like the inbox, instead of a separate page. The sheet asks the room for a
// fresh message (POST /api/agent-invite: a one-time code is made only when asked for this way).
import { useEffect, useState } from "react";
import { Check, Copy, Share, Squirrel, X } from "lucide-react";
import { call, relayRoom } from "./relay";

export function AddAgentSheet({ me, onClose }: { me: string; onClose: () => void }) {
  const [text, setText] = useState(""), [minutes, setMinutes] = useState(""), [problem, setProblem] = useState(false), [error, setError] = useState("");
  const [copied, setCopied] = useState(false), [show, setShow] = useState(false);
  const [drag, setDrag] = useState<{ y: number; dy: number } | null>(null);
  useEffect(() => {
    // the room makes the message: through the relay (experimental) for an agent on any computer, else at its own door
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
    (relayRoom ? call("/api/agent-invite", init) : fetch("/api/agent-invite", init)).then((r) => r.json().then((got) => {
      if (!r.ok || !got?.text) { setError(got?.error || ""); throw 0; }
      setText(got.text); setMinutes(String(got.minutes || ""));
    })).catch(() => setProblem(true));
  }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setShow(true); } };
  const share = () => navigator.share({ text }).catch(() => {});
  // on a computer screen: a small window in the middle, three steps, Copy as the main action
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
  const who = me && !relayRoom && !me.endsWith("@shellphone.local") ? ` (${me})` : "";
  if (wide) return <div className="fixed inset-0 z-[2900] grid place-items-center">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a59] backdrop-blur-[3px] animate-[fadein_.18s_ease-out]" />
    <div role="dialog" aria-label="Add an agent" className="relative w-[min(520px,92vw)] max-h-[86vh] flex flex-col bg-paper rounded-2xl shadow-[0_24px_70px_#18100a59] animate-[pop_.2s_cubic-bezier(.2,.8,.2,1)] overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <span className="w-9 h-9 rounded-full bg-[#c4531e1a] grid place-items-center"><Squirrel size={19} className="text-acc" /></span>
        <div className="flex-1"><div className="font-semibold text-[16px]">{relayRoom ? "Bring your agent" : "Add an agent"}</div>
          <div className="text-[12.5px] text-dim">Claude Code, Codex, a wolt… any coding agent{relayRoom ? " · experimental" : ""}</div></div>
        <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 grid place-items-center border-0 bg-transparent text-dim cursor-pointer rounded-md hover:bg-[#18100a0d]"><X size={18} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
        {problem ? <p className="text-sm text-acc">{relayRoom ? (error || "Couldn't make an invite just now. Try again.") : <>Couldn't make an invite just now. <a href="/join" className="text-acc">Open it as a page</a></>}</p> : <>
          <ol className="m-0 p-0 list-none flex flex-col gap-2.5">
            {[["Copy the message below", null], ["Paste it to your agent, wherever you talk to it", null], ["It checks with you once, then joins this room", null]].map(([t], i) =>
              <li key={i} className="flex items-center gap-3 text-[14px]"><span className="flex-none w-6 h-6 rounded-full bg-[#e3dacb] grid place-items-center font-mono text-[12px] font-bold text-ink">{i + 1}</span>{t}</li>)}
          </ol>
          <div className="relative mt-4 rounded-xl border border-line bg-white">
            <pre className={`m-0 whitespace-pre-wrap break-all p-3 font-mono text-[11.5px] leading-[1.5] text-[#4a4038] select-all ${show ? "" : "max-h-[96px] overflow-hidden"}`}>{text || "Making a fresh invite…"}</pre>
            {text && !show && <button type="button" onClick={() => setShow(true)} style={{ background: "linear-gradient(#ffffff00, #fff 70%)" }} className="absolute inset-x-0 bottom-0 h-14 flex items-end justify-center pb-1.5 border-0 rounded-b-xl font-mono text-[11px] text-dim cursor-pointer hover:text-ink">show all</button>}
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" disabled={!text} onClick={copy} className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl border-0 bg-acc text-white font-semibold text-[15px] cursor-pointer disabled:opacity-50 hover:brightness-110 active:scale-[.98] transition">{copied ? <><Check size={18} />Copied</> : <><Copy size={18} />Copy message</>}</button>
            {"share" in navigator && <button type="button" disabled={!text} onClick={share} title="Share" aria-label="Share" className="flex-none w-11 h-11 grid place-items-center rounded-xl border border-line bg-white text-ink cursor-pointer disabled:opacity-50 hover:border-acc"><Share size={18} /></button>}
          </div>
          <p className="mt-3 mb-0 text-[12px] text-dim leading-snug">{text ? <>The code inside works once{minutes && <>, within {minutes} minutes</>}: open this again for a fresh one. Your agent takes orders only from you{who}.</> : null}</p>
        </>}
      </div>
    </div>
  </div>;
  const btn = "flex-1 flex items-center justify-center gap-2 font-mono font-semibold text-[15px] py-3 rounded-xl border border-acc cursor-pointer disabled:opacity-50 active:scale-[.98] transition-transform";
  return <div className="absolute inset-0 z-[1600]">
    <div onClick={onClose} className="absolute inset-0 bg-[#18100a55] animate-[fadein_.15s_ease-out]" />
    <div className="absolute inset-x-0 bottom-0 max-h-[calc(100%-env(safe-area-inset-top)-96px)] bg-paper rounded-t-[18px] flex flex-col shadow-[0_-6px_24px_#18100a33] animate-[rise_.22s_cubic-bezier(.2,.8,.2,1)]"
      style={drag ? { transform: `translateY(${Math.max(0, drag.dy)}px)` } : undefined}>
      <div className="flex-none touch-none cursor-grab"
        onTouchStart={(e) => setDrag({ y: e.touches[0].clientY, dy: 0 })}
        onTouchMove={(e) => drag && setDrag({ ...drag, dy: e.touches[0].clientY - drag.y })}
        onTouchEnd={() => { if (drag && drag.dy > 80) onClose(); setDrag(null); }}>
        <div className="w-10 h-[5px] rounded-full bg-line mx-auto mt-2 mb-1.5" />
        <div className="flex items-center gap-2.5 px-4 pb-3 border-b border-line">
          <Squirrel size={20} className="text-acc" />
          <div className="flex-1 font-mono font-semibold text-acc">{relayRoom ? "bring your agent" : "add an agent"}</div>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={20} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <p className="text-[15px] text-ink leading-snug m-0">{relayRoom && <><b>Experimental.</b> </>}Send this message to your coding agent (Claude Code, a wolt, …), wherever you talk to it. It checks with you once, then signs itself up and joins the room.</p>
        {problem ? <p className="text-sm text-acc mt-4">{relayRoom ? (error || "Couldn't make an invite just now. Try again.") : <>Couldn't make an invite just now. <a href="/join" className="text-acc">Open it as a page</a></>}</p> : <>
          <div className="flex gap-2.5 my-4">
            {"share" in navigator && <button type="button" disabled={!text} onClick={share} className={`${btn} bg-acc text-white`}><Share size={18} />Share</button>}
            <button type="button" disabled={!text} onClick={copy} className={`${btn} bg-panel text-acc`}>{copied ? <><Check size={18} />Copied</> : <><Copy size={18} />Copy</>}</button>
          </div>
          <p className="text-sm text-dim leading-snug m-0">{text ? <>The code inside works once{minutes && <>, within {minutes} minutes</>}. Open this again for a fresh one. Your agent takes orders only from you{me && !relayRoom ? <> ({me})</> : null}.</> : "Making a fresh invite…"}</p>
          {text && <button type="button" onClick={() => setShow(!show)} className="mt-3 p-0 border-0 bg-transparent font-mono text-xs text-dim underline cursor-pointer">{show ? "hide the message" : "see the message"}</button>}
          {show && <pre className="mt-2 whitespace-pre-wrap break-all bg-panel border border-line rounded-[10px] p-3 font-mono text-[12px] leading-[1.45] text-ink select-all">{text}</pre>}
        </>}
      </div>
    </div>
  </div>;
}
