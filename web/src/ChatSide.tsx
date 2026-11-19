// Beside the open chat on a wide screen: who's in it (a switch per wolt), its pages and its files. On a phone the same
// things stay where they were: the faces in the chat's header open the switches, pages and files open from the messages.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { Msg } from "./room";
import { ThreadWho } from "./ThreadWho";
import { looksLikeDiff, woltColor, woltFace, type Ctx } from "./Message";
import type { Note } from "./Code";

const Review = lazy(() => import("./ReviewPane"));
import { personAvatar } from "./sprites";
import { worn } from "./hats";
import { ago } from "./Threads";

type Tab = "info" | "pages" | "files" | "changes";

// The whole change set of a chat, like a PR's "Files changed": every diff in it (```diff blocks, and .diff/.patch files
// attached), cut into files, the latest version of each file kept, in the order they first came up.
function byFile(diffs: string[]) {
  const files = new Map<string, string>();
  for (const d of diffs) for (const part of d.split(/^(?=diff --git )/m)) {
    if (!/^(diff --git |--- |@@ )/m.test(part)) continue;
    const name = (part.match(/^\+\+\+ (?:b\/)?(.+)$/m) || part.match(/^diff --git a\/\S+ b\/(.+)$/m) || [])[1] || `change ${files.size + 1}`;
    files.set(name, part.trimEnd() + "\n");
  }
  return files;
}

export function ChatSide({ thread, list, ctx, room, fallback, host, main }: {
  thread: string; list: Msg[]; ctx: Ctx; room?: Record<string, "in" | "paused">; fallback?: "in" | "out"; host?: string; main?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("info");
  const blocks = useMemo(() => list.flatMap((m) => [...(m.text || "").matchAll(/```([\w+-]*)\n?([\s\S]*?)```/g)].filter((x) => looksLikeDiff(x[1], x[2])).map((x) => x[2])), [list]);
  const patchFiles = list.flatMap((m) => m.files || []).filter((f) => /\.(diff|patch)$/i.test(f.name));
  const [patches, setPatches] = useState<string[]>([]);
  useEffect(() => { Promise.all(patchFiles.map((f) => fetch(f.url).then((r) => (r.ok ? r.text() : "")).catch(() => ""))).then(setPatches); }, [patchFiles.map((f) => f.url).join()]);
  const changed = useMemo(() => byFile([...patches, ...blocks]), [patches, blocks]);
  const all = [...changed.values()].join("");
  const added = (all.match(/^\+(?!\+\+)/gm) || []).length, removed = (all.match(/^-(?!--)/gm) || []).length;
  // conversations on lines: a message quoting `file:line` starts one (or joins it); the agents it tags answer under it
  // until the next human message
  const notes = useMemo(() => {
    const out = new Map<string, Note>(); let open: { key: string; tagged: string[] } | null = null;
    const item = (m: Msg, text: string) => { const p = ctx.person(m.kind === "human" ? m.email : m.owner);
      return { id: m.cid || m.id, name: m.kind === "human" ? p.name : m.wolt!, color: m.kind === "human" ? p.color : woltColor(m.wolt, ctx.wolts), face: m.kind === "human" ? personAvatar(p.name, p.color, worn.people[m.email!]) : woltFace(m.wolt, m.creature), text }; };
    for (const m of list) {
      const t = m.text || "", q = t.match(/^> `([^`]+):(\d+)`/m);
      if (q) {
        const key = q[1] + ":" + q[2], words = t.split("\n").filter((l) => !l.startsWith("> ")).join("\n").trim();
        if (!out.has(key)) out.set(key, { file: q[1], line: q[2], items: [] });
        out.get(key)!.items.push(item(m, words || "(comment)"));
        open = { key, tagged: [...t.matchAll(/@([\w-]+)/g)].map((x) => x[1].toLowerCase()) };
      } else if (open && m.kind === "wolt" && open.tagged.includes((m.wolt || "").toLowerCase())) out.get(open.key)!.items.push(item(m, t.trim()));
      else if (m.kind === "human") open = null;
    }
    return [...out.values()];
  }, [list]);
  useEffect(() => { if (changed.size && tab === "info") setTab("changes"); }, [changed.size > 0, thread]);  // a chat with changes opens on them
  const pages = list.filter((m) => m.page), files = list.flatMap((m) => (m.files || (m.file ? [m.file] : [])).map((f) => ({ f, m })));
  const people = [...new Set(list.filter((m) => m.kind === "human").map((m) => m.email!))];
  const head = (label: string) => <div className="mt-1 mb-2 font-mono text-[10.5px] font-semibold tracking-[.07em] uppercase text-dim">{label}</div>;
  const tabBtn = (t: Tab, label: string, n?: number) => <button type="button" onClick={() => setTab(t)}
    className={`px-2.5 py-1 rounded-lg border-0 font-mono text-[12px] cursor-pointer ${tab === t ? "bg-white text-ink shadow-[0_1px_2px_#18100a1a]" : "bg-transparent text-dim hover:text-ink"}`}>{label}{n ? ` · ${n}` : ""}</button>;
  return <aside aria-label="About this chat" className={`${tab === "changes" ? "w-[min(52%,760px)] min-w-[420px]" : "w-[290px]"} flex-none h-full flex flex-col bg-paper border-l border-line`}>
    <div className="flex-none flex gap-0.5 px-3 py-2.5 border-b border-line">{changed.size > 0 && tabBtn("changes", "Changes", changed.size)}{tabBtn("info", "Info")}{tabBtn("pages", "Pages", pages.length)}{tabBtn("files", "Files", files.length)}</div>
    {tab === "changes" && changed.size > 0 && <div className="flex-1 min-h-0 flex flex-col bg-white">
      <div className="flex-none flex items-center gap-2 px-4 py-2 border-b border-line bg-paper font-mono text-[12px]">
        <b className="text-ink">{changed.size} {changed.size === 1 ? "file" : "files"} changed</b>
        <span className="text-[#2f7d4f]">+{added}</span><span className="text-[#b33a2b]">−{removed}</span>
        <span className="flex-1" /><span className="text-dim text-[11px]">{notes.length ? `${notes.length} ${notes.length === 1 ? "conversation" : "conversations"} · ` : ""}+ on a line to comment</span></div>
      <div className="flex-1 min-h-0"><Suspense fallback={<p className="p-4 text-dim text-sm">Loading…</p>}><Review files={changed} notes={notes} say={ctx.say} /></Suspense></div>
    </div>}
    <div className={`flex-1 min-h-0 overflow-y-auto p-3 ${tab === "changes" ? "hidden" : ""}`}>
      {tab === "info" && <>
        {head("Humans")}
        {people.length ? people.map((e) => { const p = ctx.person(e); return <div key={e} onClick={() => ctx.openWho?.("p:" + e)} className="flex items-center gap-2.5 py-1.5 text-[13px] cursor-pointer rounded-md hover:bg-[#18100a08]">
          <img src={personAvatar(p.name, p.color, worn.people[e])} alt="" className="pixel w-[30px] h-[30px]" />{p.name}{e === ctx.me && <span className="text-dim">· you</span>}</div>; })
          : <p className="m-0 text-[12px] text-dim">No one has written here yet.</p>}
        <div className="mt-4" />{head("Agents")}
        <ThreadWho inline thread={thread} list={list} ctx={ctx} room={room} fallback={fallback} host={host} main={main} />
      </>}
      {tab === "pages" && (pages.length ? pages.map((m) => <button key={m.id} type="button" onClick={() => ctx.openPage?.(m.page!.id)}
        className="block w-full text-left mb-2 rounded-[10px] border border-line bg-white px-3 py-2.5 cursor-pointer hover:border-acc">
        <b className="block text-[13px] text-ink truncate">📄 {m.page!.title}</b>
        <span className="block font-mono text-[11px] text-dim">{m.wolt || ctx.person(m.email).name} · {ago(m.at)}</span></button>)
        : <p className="m-0 text-[12px] text-dim">No pages in this chat. Wolts post them with <code className="font-mono">post --page</code>.</p>)}
      {tab === "files" && (files.length ? <div className="grid grid-cols-2 gap-2">{files.map(({ f, m }, i) => f.type.startsWith("image/")
        ? <button key={m.id + i} type="button" onClick={() => ctx.view(files.filter((x) => x.f.type.startsWith("image/")).map((x) => x.f.url), files.filter((x) => x.f.type.startsWith("image/")).indexOf(files[i]))}
          className="p-0 border border-line rounded-lg overflow-hidden bg-white cursor-pointer aspect-square"><img src={f.url} alt={f.name} className="w-full h-full object-cover" /></button>
        : <a key={m.id + i} href={f.url} target="_blank" rel="noreferrer" className="col-span-2 block rounded-lg border border-line bg-white px-2.5 py-2 text-[12px] text-ink truncate no-underline">📎 {f.name}</a>)}</div>
        : <p className="m-0 text-[12px] text-dim">No files in this chat yet.</p>)}
    </div>
  </aside>;
}
