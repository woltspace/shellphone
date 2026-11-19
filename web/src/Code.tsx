// Code in messages, drawn by the usual tools instead of our own: diff2html for diffs (files, hunks, line numbers,
// word-level changes) and highlight.js for syntax colours. This file is loaded only when a message has code.
import { useEffect, useRef } from "react";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import hljs from "highlight.js/lib/common";
import "diff2html/bundles/css/diff2html.min.css";
import "highlight.js/styles/github.css";

export type Note = { file: string; line: string; items: { id: string; name: string; color: string; face: string; text: string }[] };
// a conversation on a line, drawn as a row right under it in the diff (plain DOM: diff2html owns this table)
function noteRow(n: Note) {
  const tr = document.createElement("tr"); tr.className = "shp-note";
  const td = document.createElement("td"); td.colSpan = 3; tr.appendChild(td);
  const box = document.createElement("div"); box.className = "shp-note-box"; td.appendChild(box);
  for (const it of n.items) {
    const row = document.createElement("div"); row.className = "shp-note-item"; row.title = "Show it in the chat";
    row.onclick = (e) => { e.stopPropagation(); const m = document.getElementById(it.id); if (m) { m.scrollIntoView({ block: "center", behavior: "smooth" }); m.classList.add("landed"); setTimeout(() => m.classList.remove("landed"), 2500); } };
    const img = document.createElement("img"); img.src = it.face; img.className = "pixel"; row.appendChild(img);
    const body = document.createElement("div");
    const who = document.createElement("b"); who.textContent = it.name; who.style.color = it.color; body.appendChild(who);
    const txt = document.createElement("div"); txt.textContent = it.text; body.appendChild(txt);
    row.appendChild(body); box.appendChild(row);
  }
  const reply = document.createElement("button"); reply.type = "button"; reply.className = "shp-note-reply"; reply.textContent = "↩ reply";
  reply.onclick = (e) => { e.stopPropagation(); dispatchEvent(new CustomEvent("shp-quote", { detail: `> \`${n.file}:${n.line}\`\n` })); };
  box.appendChild(reply);
  return tr;
}
export default function Code({ body, lang, diff, full, fileList, notes }: { body: string; lang: string; diff: boolean; full?: boolean; fileList?: boolean; notes?: Note[] }) {  // full: in the pane beside the chat, no height limit
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current; if (!box) return;
    if (diff) {
      const ui = new Diff2HtmlUI(box, body, { drawFileList: !!fileList, fileListToggle: false, fileListStartVisible: true, matching: "lines", outputFormat: "line-by-line", highlight: true, colorScheme: "light" as never, synchronisedScroll: false, fileContentToggle: false });
      ui.draw(); ui.highlightCode();
      // conversations on lines: under the line they're about, in its file
      for (const n of notes || []) {
        const wrap = [...box.querySelectorAll(".d2h-file-wrapper")].find((w) => w.querySelector(".d2h-file-name")?.textContent?.trim() === n.file);
        const rows = wrap ? [...wrap.querySelectorAll("tr")] : [];  // the new file's line first, the old one only if it's gone
        const row = rows.find((r) => r.querySelector(".line-num2")?.textContent?.trim() === n.line) || rows.find((r) => r.querySelector(".line-num1")?.textContent?.trim() === n.line);
        if (row) row.after(noteRow(n));
      }
    } else {
      const code = document.createElement("code");
      code.textContent = body;
      if (lang && hljs.getLanguage(lang)) code.className = `language-${lang}`;
      box.replaceChildren(Object.assign(document.createElement("pre"), { className: "hljs" }));
      box.firstElementChild!.appendChild(code);
      hljs.highlightElement(code);
    }
  }, [body, lang, diff, fileList, JSON.stringify(notes || [])]);
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
