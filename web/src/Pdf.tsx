// A PDF drawn page by page with pdf.js (loaded only when a PDF is opened): a frame can't be trusted to show one on a
// phone (an iPhone shows the first page, or nothing), and this looks the same everywhere.
import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.min.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker";

let port: Worker | null = null;
export default function Pdf({ data }: { data: ArrayBuffer }) {
  const box = useRef<HTMLDivElement>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!port) { port = new PdfWorker(); pdfjs.GlobalWorkerOptions.workerPort = port; }
    let gone = false;
    const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false });  // files from anyone in the room: no eval, ever
    task.promise.then(async (doc) => {
      const el = box.current; if (!el) return;
      const width = Math.min(el.clientWidth - 24, 900), ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= doc.numPages && !gone; n++) {
        const page = await doc.getPage(n), base = page.getViewport({ scale: 1 }), view = page.getViewport({ scale: (width / base.width) * ratio });
        const c = document.createElement("canvas");
        c.width = view.width; c.height = view.height; c.style.width = `${width}px`; c.setAttribute("aria-label", `page ${n}`);
        c.className = "block mx-auto mb-3 bg-white shadow-[0_1px_6px_#18100a26]";
        el.appendChild(c);
        await page.render({ canvasContext: c.getContext("2d")!, viewport: view }).promise;
      }
    }).catch((e: Error) => !gone && setError(e.message || "Couldn't read this PDF"));
    return () => { gone = true; task.destroy(); };
  }, [data]);
  return <div ref={box} className="py-3 bg-[#ece6da] min-h-full">{error && <p className="p-5 text-acc text-sm">{error}</p>}</div>;
}
