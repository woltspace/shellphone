// Code in messages, drawn by the usual tools instead of our own: diff2html for diffs (files, hunks, line numbers,
// word-level changes) and highlight.js for syntax colours. This file is loaded only when a message has code.
import { useEffect, useRef } from "react";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import hljs from "highlight.js/lib/common";
import "diff2html/bundles/css/diff2html.min.css";
import "highlight.js/styles/github.css";

export default function Code({ body, lang, diff, full }: { body: string; lang: string; diff: boolean; full?: boolean }) {  // full: in the pane beside the chat, no height limit
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current; if (!box) return;
    if (diff) {
      const ui = new Diff2HtmlUI(box, body, { drawFileList: false, matching: "lines", outputFormat: "line-by-line", highlight: true, colorScheme: "light" as never, synchronisedScroll: false, fileContentToggle: false });
      ui.draw(); ui.highlightCode();
    } else {
      const code = document.createElement("code");
      code.textContent = body;
      if (lang && hljs.getLanguage(lang)) code.className = `language-${lang}`;
      box.replaceChildren(Object.assign(document.createElement("pre"), { className: "hljs" }));
      box.firstElementChild!.appendChild(code);
      hljs.highlightElement(code);
    }
  }, [body, lang, diff]);
  // click a line: its file and line number (and the line itself) go into the message box, to comment on it, like a review comment
  const pick = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest("tr"); if (!row || !el.current?.contains(row)) return;
    const num = row.querySelector(".line-num2")?.textContent?.trim() || row.querySelector(".line-num1")?.textContent?.trim() || row.querySelector(".d2h-code-linenumber")?.textContent?.trim();
    const line = (row.querySelector(".d2h-code-line-ctn")?.textContent || "").trim();
    if (!num || !line) return;
    const file = row.closest(".d2h-file-wrapper")?.querySelector(".d2h-file-name")?.textContent?.trim() || "";
    dispatchEvent(new CustomEvent("shp-quote", { detail: `> \`${file ? file + ":" : "line "}${num}\` ${line.length > 90 ? line.slice(0, 90) + "…" : line}\n` }));
    row.classList.add("shp-picked"); setTimeout(() => row.classList.remove("shp-picked"), 900);
  };
  return <div ref={el} data-tap onClick={diff ? pick : undefined} title={diff ? "Click a line to comment on it" : undefined} className={`shp-code bg-white overflow-auto whitespace-normal text-ink ${full ? "h-full" : "my-1.5 rounded-lg border border-[#d9cfbf] max-h-[460px]"} ${diff ? "shp-diff" : ""}`} />;
}
