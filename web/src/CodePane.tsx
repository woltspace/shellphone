// A diff or a piece of code opened beside the chat: read it whole while you keep talking about it.
import { Suspense, lazy } from "react";
import { X } from "lucide-react";

const Code = lazy(() => import("./Code"));
export function CodePane({ code, close, wide }: { code: { body: string; lang: string; diff: boolean }; close: () => void; wide?: boolean }) {
  const files = code.diff ? [...code.body.matchAll(/^\+\+\+ (?:b\/)?(.+)$/gm)].map((m) => m[1]) : [];
  const title = code.diff ? (files.length === 1 ? files[0] : `${files.length || ""} files changed`.trim()) : code.lang || "code";
  const added = code.diff ? (code.body.match(/^\+(?!\+\+)/gm) || []).length : 0, removed = code.diff ? (code.body.match(/^-(?!--)/gm) || []).length : 0;
  return <aside aria-label="Code" className={`${wide ? "w-[min(52%,760px)] min-w-[420px] border-l border-line" : "w-full"} flex-none h-full flex flex-col bg-white`}>
    <div className="flex-none min-h-12 pt-[env(safe-area-inset-top)] flex items-center gap-2 pl-4 pr-2 border-b border-line bg-paper">
      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#e3dacb] text-ink">{code.diff ? "diff" : code.lang || "code"}</span>
      <b className="flex-1 min-w-0 truncate font-mono text-[13px]">{title}</b>
      {code.diff && <span className="font-mono text-[11px]"><span className="text-[#2f7d4f]">+{added}</span> <span className="text-[#b33a2b]">−{removed}</span></span>}
      <button type="button" aria-label="Close the code" title="Close" onClick={close} className="w-8 h-8 grid place-items-center border-0 bg-transparent text-dim cursor-pointer rounded-md hover:bg-[#18100a0d]"><X size={18} /></button>
    </div>
    <div className="flex-1 min-h-0"><Suspense fallback={<p className="p-4 text-dim text-sm">Loading…</p>}><Code full body={code.body} lang={code.lang} diff={code.diff} /></Suspense></div>
  </aside>;
}
