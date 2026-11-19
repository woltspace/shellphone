// A file opened inside the app, like Messages' Quick Look: the file is fetched here (signed in to the room, which a
// Safari window from the home-screen app isn't), then shown full screen: a PDF as a PDF, text and code as text, a CSV
// as a table. Share (the phone's share sheet) and Download sit in the top bar; ✕, Escape or the back swipe close it.
import { Suspense, lazy, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Share, X } from "lucide-react";
import { canShareFiles, load, save, share } from "./sharefile.js";
import type { FileInfo } from "./room";
import { parseCsv } from "./csv.js";

const Pdf = lazy(() => import("./Pdf"));
const TEXT = /^(txt|md|markdown|py|js|mjs|ts|tsx|jsx|json|ya?ml|toml|ini|cfg|sh|zsh|bash|css|html?|xml|sql|rs|go|java|c|h|cpp|rb|log|diff|patch|csv|tsv)$/i;
const ext = (f: FileInfo) => ((f.name || f.url).match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase() || f.type.toLowerCase();
export const canPreview = (f: FileInfo) => ext(f) === "pdf" || TEXT.test(ext(f));

export function FileView({ f, onClose }: { f: FileInfo; onClose: () => void }) {
  const [body, setBody] = useState<{ pdf?: ArrayBuffer; text?: string } | null>(null), [error, setError] = useState("");
  const [note, setNote] = useState(""), e = ext(f);
  useEffect(() => {
    let gone = false;
    load(f.url, f.name).then(async (file: File) => {
      if (gone) return;
      if (e === "pdf") setBody({ pdf: await file.arrayBuffer() });
      else setBody({ text: await file.text() });
    }).catch((x: Error) => !gone && setError(x.message || "Couldn't get the file"));
    return () => { gone = true; };
  }, [f.url]);
  // the viewer is a step in the browser's history, like a chat: Back (or the phone's back swipe) closes it and keeps the chat
  const close = () => { if ((history.state as { shpFile?: number } | null)?.shpFile) history.back(); else onClose(); };
  useEffect(() => {
    history.pushState({ ...(history.state || {}), shpFile: 1 }, "", location.href);
    const back = () => onClose();
    addEventListener("popstate", back); return () => removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    const esc = (k: KeyboardEvent) => { if (k.key === "Escape") { k.stopPropagation(); close(); } };
    addEventListener("keydown", esc, true); return () => removeEventListener("keydown", esc, true);
  }, [onClose]);
  const shareIt = () => share(f.url, f.name).then((r: string) => setNote(r === "again" ? "Tap Share again" : "")).catch(() => setNote("Couldn't share it"));
  const btn = "flex-none h-10 min-w-10 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-full border-0 bg-transparent text-acc cursor-pointer hover:bg-[#18100a0d] text-[14px] font-semibold";
  const sep = e === "tsv" ? "\t" : ",";
  const rows = body?.text !== undefined && (e === "csv" || e === "tsv") ? parseCsv(body.text, sep) : null;
  return createPortal(<div role="dialog" aria-label={f.name} onTouchStart={(t) => t.stopPropagation()} onTouchMove={(t) => t.stopPropagation()} onTouchEnd={(t) => t.stopPropagation()} className="fixed inset-0 z-[3000] flex flex-col bg-paper animate-[fadein_.15s_ease-out]">
    <div className="flex-none flex items-center gap-1 pl-1 pr-2 pt-[env(safe-area-inset-top)] min-h-12 border-b border-line bg-paper">
      <button type="button" aria-label="Close" onClick={close} className={btn}><X size={22} /></button>
      <div className="min-w-0 flex-1 px-1"><div className="font-semibold text-[15px] truncate">{f.name}</div>
        <div className="font-mono text-[11px] text-dim truncate">{note || `${e.toUpperCase()} · ${Math.max(1, Math.round(f.size / 1024))} KB`}</div></div>
      {canShareFiles() && <button type="button" aria-label="Share" onClick={shareIt} className={btn}><Share size={19} /></button>}
      <button type="button" aria-label="Download" onClick={() => load(f.url, f.name).then(save).catch(() => setNote("Couldn't get it"))} className={btn}><Download size={19} /></button>
    </div>
    <div className="flex-1 min-h-0 overflow-auto overscroll-contain bg-white">
      {error ? <p className="p-5 text-acc text-sm">{error}</p>
        : !body ? <div className="h-full grid place-items-center text-dim"><Loader2 size={22} className="animate-spin" /></div>
        : body.pdf ? <Suspense fallback={<div className="h-full grid place-items-center text-dim"><Loader2 size={22} className="animate-spin" /></div>}><Pdf data={body.pdf} /></Suspense>
        : rows && !rows.length ? <p className="p-5 text-dim text-sm">This file is empty.</p>
        : rows ? <table className="text-[13px] border-collapse min-w-full">
            <thead className="sticky top-0 bg-panel"><tr>{rows[0].map((c, i) => <th key={i} className="text-left font-semibold px-3 py-2 border-b border-line whitespace-nowrap">{c}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((r, i) => <tr key={i} className="odd:bg-[#faf7f1]">{r.map((c, j) => <td key={j} className="px-3 py-1.5 border-b border-line whitespace-pre font-mono align-top">{c}</td>)}</tr>)}</tbody>
          </table>
        : <pre className="m-0 p-4 font-mono text-[12.5px] leading-[1.55] text-ink whitespace-pre-wrap break-words pb-[calc(16px+env(safe-area-inset-bottom))]">{body.text}</pre>}
    </div>
  </div>, document.body);
}
