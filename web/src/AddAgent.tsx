// "Add an agent" as a sheet in the app, like the inbox, instead of a separate page. The room still renders /join
// (it mints a fresh one-time code on each visit), so the sheet asks for that page and takes the message out of it.
import { useEffect, useState } from "react";
import { Check, Copy, Share, Squirrel, X } from "lucide-react";

export function AddAgentSheet({ me, onClose }: { me: string; onClose: () => void }) {
  const [text, setText] = useState(""), [minutes, setMinutes] = useState(""), [problem, setProblem] = useState(false);
  const [copied, setCopied] = useState(false), [show, setShow] = useState(false);
  const [drag, setDrag] = useState<{ y: number; dy: number } | null>(null);
  useEffect(() => {
    fetch("/join", { cache: "no-store" }).then((r) => (r.ok ? r.text() : Promise.reject())).then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const t = doc.getElementById("text")?.textContent || "";
      if (!t) throw 0;
      setText(t); setMinutes(html.match(/within (\d+) minutes/)?.[1] || "");
    }).catch(() => setProblem(true));
  }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setShow(true); } };
  const share = () => navigator.share({ text }).catch(() => {});
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
          <div className="flex-1 font-mono font-semibold text-acc">add an agent</div>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 grid place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={20} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <p className="text-[15px] text-ink leading-snug m-0">Send this message to your coding agent (Claude Code, a wolt, …), wherever you talk to it. It checks with you once, then signs itself up and joins the room.</p>
        {problem ? <p className="text-sm text-acc mt-4">Couldn't make an invite just now. <a href="/join" className="text-acc">Open it as a page</a></p> : <>
          <div className="flex gap-2.5 my-4">
            {"share" in navigator && <button type="button" disabled={!text} onClick={share} className={`${btn} bg-acc text-white`}><Share size={18} />Share</button>}
            <button type="button" disabled={!text} onClick={copy} className={`${btn} bg-panel text-acc`}>{copied ? <><Check size={18} />Copied</> : <><Copy size={18} />Copy</>}</button>
          </div>
          <p className="text-sm text-dim leading-snug m-0">{text ? <>The code inside works once{minutes && <>, within {minutes} minutes</>}. Open this again for a fresh one. Your agent takes orders only from you{me ? <> ({me})</> : null}.</> : "Making a fresh invite…"}</p>
          {text && <button type="button" onClick={() => setShow(!show)} className="mt-3 p-0 border-0 bg-transparent font-mono text-xs text-dim underline cursor-pointer">{show ? "hide the message" : "see the message"}</button>}
          {show && <pre className="mt-2 whitespace-pre-wrap break-all bg-panel border border-line rounded-[10px] p-3 font-mono text-[12px] leading-[1.45] text-ink select-all">{text}</pre>}
        </>}
      </div>
    </div>
  </div>;
}
