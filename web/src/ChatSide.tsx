// Beside the open chat on a wide screen: who's in it (a switch per wolt), its pages and its files. On a phone the same
// things stay where they were: the faces in the chat's header open the switches, pages and files open from the messages.
import { useState } from "react";
import type { Msg } from "./room";
import { ThreadWho } from "./ThreadWho";
import { type Ctx } from "./Message";
import { personAvatar } from "./sprites";
import { worn } from "./hats";
import { ago } from "./Threads";

type Tab = "info" | "pages" | "files";

export function ChatSide({ thread, list, ctx, room, fallback, host, main }: {
  thread: string; list: Msg[]; ctx: Ctx; room?: Record<string, "in" | "paused">; fallback?: "in" | "out"; host?: string; main?: string | null;
}) {
  const [tab, setTab] = useState<Tab>("info");
  const pages = list.filter((m) => m.page), files = list.flatMap((m) => (m.files || (m.file ? [m.file] : [])).map((f) => ({ f, m })));
  const people = [...new Set(list.filter((m) => m.kind === "human").map((m) => m.email!))];
  const head = (label: string) => <div className="mt-1 mb-2 font-mono text-[10.5px] font-semibold tracking-[.07em] uppercase text-dim">{label}</div>;
  const tabBtn = (t: Tab, label: string, n?: number) => <button type="button" onClick={() => setTab(t)}
    className={`px-2.5 py-1 rounded-lg border-0 font-mono text-[12px] cursor-pointer ${tab === t ? "bg-white text-ink shadow-[0_1px_2px_#18100a1a]" : "bg-transparent text-dim hover:text-ink"}`}>{label}{n ? ` · ${n}` : ""}</button>;
  return <aside aria-label="About this chat" className="w-[290px] flex-none h-full flex flex-col bg-paper border-l border-line">
    <div className="flex-none flex gap-0.5 px-3 py-2.5 border-b border-line">{tabBtn("info", "Info")}{tabBtn("pages", "Pages", pages.length)}{tabBtn("files", "Files", files.length)}</div>
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      {tab === "info" && <>
        {head("Humans")}
        {people.length ? people.map((e) => { const p = ctx.person(e); return <div key={e} className="flex items-center gap-2.5 py-1.5 text-[13px]">
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
