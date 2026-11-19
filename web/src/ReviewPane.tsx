// The chat's whole change set, drawn by @git-diff-view/react (a diff viewer made for code review): every file with its
// diff, syntax colours, and conversations right under the lines they're about. "+" on a line writes a comment there;
// it's sent to the chat as a message that quotes the line, so agents see exactly which line it's about.
import { useState } from "react";
import { DiffView, DiffModeEnum, SplitSide } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import type { Note } from "./Code";

type Item = Note["items"][number];
const counts = (d: string) => [(d.match(/^\+(?!\+\+)/gm) || []).length, (d.match(/^-(?!--)/gm) || []).length];
const langOf = (f: string) => (f.split(".").pop() || "").replace(/^(tsx|jsx)$/, "tsx");

function Thread({ items, onReply }: { items: Item[]; onReply: () => void }) {
  return <div className="m-2 ml-12 max-w-[640px] rounded-xl border border-line bg-white shadow-[0_1px_2px_#18100a14] font-sans">
    {items.map((it) => <button key={it.id} type="button" onClick={() => { const m = document.getElementById(it.id); if (m) { m.scrollIntoView({ block: "center", behavior: "smooth" }); m.classList.add("landed"); setTimeout(() => m.classList.remove("landed"), 2500); } }}
      title="Show it in the chat" className="flex w-full gap-2 px-3 py-2 border-0 border-b border-[#f0e9de] bg-transparent text-left cursor-pointer hover:bg-[#faf6ee]">
      <img src={it.face} alt="" className="pixel w-6 h-6 flex-none" />
      <span className="min-w-0"><b className="block text-[12px]" style={{ color: it.color }}>{it.name}</b>
        <span className="block text-[13px] text-ink whitespace-pre-wrap break-words">{it.text}</span></span>
    </button>)}
    <button type="button" onClick={onReply} className="m-2 px-2.5 py-1 rounded-md border border-line bg-white font-mono text-[11px] text-dim cursor-pointer hover:text-ink hover:border-acc">↩ reply</button>
  </div>;
}

function Write({ file, line, onClose, say }: { file: string; line: number; onClose: () => void; say: (t: string) => void }) {
  const [t, setT] = useState("");
  const send = () => { if (!t.trim()) return; say(`> \`${file}:${line}\`\n${t.trim()}`); onClose(); };
  return <div className="m-2 ml-12 max-w-[640px] rounded-xl border border-acc bg-white p-2 font-sans">
    <textarea autoFocus value={t} onChange={(e) => setT(e.target.value)} rows={3} placeholder={`Comment on line ${line}… (@agent to ask one)`}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      className="w-full resize-y border-0 outline-none text-[13px] text-ink bg-transparent" />
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-3 py-1 rounded-md border border-line bg-white text-[12px] cursor-pointer">Cancel</button>
      <button type="button" onClick={send} disabled={!t.trim()} className="px-3 py-1 rounded-md border-0 bg-acc text-white text-[12px] font-semibold cursor-pointer disabled:opacity-50">Comment</button></div>
  </div>;
}

export default function ReviewPane({ files, notes, say }: { files: Map<string, string>; notes: Note[]; say?: (t: string) => void }) {
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [reply, setReply] = useState("");  // "file:line" of the thread being answered
  return <div className="h-full overflow-y-auto bg-[#faf8f4] p-3 flex flex-col gap-3">
    {[...files].map(([name, diff]) => {
      const [a, r] = counts(diff), mine = notes.filter((n) => n.file === name);
      const extend = { newFile: Object.fromEntries(mine.map((n) => [n.line, { data: n }])) };
      return <section key={name} className="rounded-xl border border-line bg-white overflow-hidden">
        <button type="button" onClick={() => setShut({ ...shut, [name]: !shut[name] })} className="w-full flex items-center gap-2 px-3 py-2 border-0 border-b border-line bg-paper text-left cursor-pointer">
          <span className="text-dim text-[11px]">{shut[name] ? "▸" : "▾"}</span>
          <b className="flex-1 min-w-0 truncate font-mono text-[12.5px] text-ink">{name}</b>
          {mine.length > 0 && <span className="font-mono text-[11px] text-dim">💬 {mine.length}</span>}
          <span className="font-mono text-[11px] text-[#2f7d4f]">+{a}</span><span className="font-mono text-[11px] text-[#b33a2b]">−{r}</span>
        </button>
        {!shut[name] && <DiffView<Note>
          data={{ oldFile: { fileName: name, fileLang: langOf(name) }, newFile: { fileName: name, fileLang: langOf(name) }, hunks: [diff] }}
          extendData={extend} diffViewMode={DiffModeEnum.Unified} diffViewHighlight diffViewWrap diffViewTheme="light" diffViewFontSize={12}
          diffViewAddWidget={!!say}
          renderWidgetLine={({ lineNumber, onClose }) => say ? <Write file={name} line={lineNumber} onClose={onClose} say={say} /> : null}
          renderExtendLine={({ data, side }) => side === SplitSide.new || side === undefined ? <>
            <Thread items={data.items} onReply={() => setReply(`${name}:${data.line}`)} />
            {reply === `${name}:${data.line}` && say && <Write file={name} line={+data.line} onClose={() => setReply("")} say={say} />}</> : null}
        />}
      </section>;
    })}
  </div>;
}
