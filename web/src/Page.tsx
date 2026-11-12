// A page an agent posted: a still tile in the chat (nothing runs there), and full screen when opened, like a photo.
// Opened, it runs in a sealed frame: its own empty origin, no storage, no way out to the internet (pages.js puts the
// policy first in it). It reaches the room through one door only: it hands the app changes to its board, and the app
// hands it back the changes the room confirmed, in order, each stamped by the room with who made it.
import { useEffect, useRef, useState } from "react";
import { FileCode2, X } from "lucide-react";
import { call, relayRoom } from "./relay";
import { send, type Msg, type PageRef } from "./room";
import { after, sealed, type Change } from "./pages.js";
import type { Ctx } from "./Message";

export function PageTile({ m, ctx }: { m: Msg; ctx: Ctx }) {
  const p = m.page!;
  return <button type="button" data-tap onClick={() => ctx.openPage?.(p.id)}
    className="mt-1 mb-0.5 flex w-[min(260px,68vw)] items-center gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5 text-left cursor-pointer">
    <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-[#fbe9df]"><FileCode2 size={20} className="text-acc" /></span>
    <span className="min-w-0 flex-1">
      <b className="block truncate text-[15px]">{p.title || "Page"}</b>
      {p.line && <span className="block truncate text-[13px] text-dim">{p.line}</span>}
      <span className="block font-mono text-[10.5px] text-dim">page · v{p.v}</span>
    </span>
    <span className="flex-none rounded-lg border border-acc px-2 py-0.5 font-mono text-[11px] font-semibold text-acc">Open</span>
  </button>;
}

type Got = { id: string; title: string; line?: string; v: number; by?: string; n: number; html?: string; changes?: Change[]; error?: string };
const get = async (url: string): Promise<Got | null> => {
  const r = await (relayRoom ? call(url) : fetch(url, { cache: "no-store" })).catch(() => null);
  return r && r.ok ? ((await r.json().catch(() => null)) as Got | null) : null;
};

// mark: where the room says this page stands ({v, n} from /api/state); when it moves, the viewer asks for what's new
export function PageViewer({ id, mark, ctx, close }: { id: string; mark?: { v: number; n: number }; ctx: Ctx; close: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<{ title: string; by?: string; v: number; html: string } | null>(null), [missing, setMissing] = useState(false);
  const changes = useRef<Change[]>([]), ready = useRef(false), v = useRef(0), busy = useRef(false), again = useRef(false);
  const tell = (msg: object) => frame.current?.contentWindow?.postMessage({ shellphone: 1, ...msg }, "*");  // a sealed frame has no origin to name

  const load = async () => {
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    const last = changes.current.at(-1)?.n || 0;
    const got = await get(`/api/page?id=${encodeURIComponent(id)}&after=${last}&v=${v.current}`);
    if (!got) setMissing((m) => m || !page);
    else if (got.html !== undefined && got.v !== v.current) {
      // a new version of the page: it starts over, and gets the whole board once it says it's ready
      v.current = got.v; ready.current = false; changes.current = [];
      const all = got.changes && !last ? got.changes : (await get(`/api/page?id=${encodeURIComponent(id)}&after=0&v=${got.v}`))?.changes;
      changes.current = after([], all);
      setPage({ title: got.title, by: got.by, v: got.v, html: sealed(got.html) });
    } else {
      const fresh = after(changes.current, got.changes);
      if (fresh.length) { changes.current = [...changes.current, ...fresh]; if (ready.current) tell({ type: "changes", changes: fresh }); }
    }
    busy.current = false;
    if (again.current) { again.current = false; load(); }
  };
  useEffect(() => { load(); }, [id, mark?.v, mark?.n]);

  useEffect(() => {
    const hear = async (e: MessageEvent) => {
      const d = e.data;
      if (!frame.current || e.source !== frame.current.contentWindow || !d || d.shellphone !== 1) return;  // only this page's frame
      if (d.type === "ready") {
        ready.current = true;
        const me = ctx.person(ctx.me);
        tell({ type: "init", me: { name: me.name, color: me.color }, changes: changes.current });  // its board, and nothing else of the room
      } else if (d.type === "change" && d.op !== undefined) {
        const body = JSON.stringify({ id, op: d.op });
        if (body.length > 4200) return;  // the room takes 4 KB per change
        await send("/api/page", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        load();  // the room's copy comes back stamped, and only then does the page draw it
      }
    };
    addEventListener("message", hear);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", key);
    return () => { removeEventListener("message", hear); removeEventListener("keydown", key); };
  }, [id]);

  // the handle and the title bar pull down to close, like a photo
  const from = useRef<number | null>(null), [dy, setDy] = useState(0);
  const pull = {
    onTouchStart: (e: React.TouchEvent) => { from.current = e.touches[0].clientY; },
    onTouchMove: (e: React.TouchEvent) => { if (from.current !== null) setDy(Math.max(0, e.touches[0].clientY - from.current)); },
    onTouchEnd: () => { from.current = null; if (dy > 90) close(); else setDy(0); },
  };
  return <div className="fixed inset-0 z-[2900] flex flex-col bg-paper" role="dialog" aria-label={page?.title || "Page"}
    style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: from.current === null ? "transform .2s" : "none" }}>
    <div {...pull} className="flex-none touch-none border-b border-line bg-panel pt-[env(safe-area-inset-top)]">
      <div className="mx-auto mt-2 h-[5px] w-10 rounded-full bg-line" />
      <div className="flex items-center gap-2 px-4 pb-2 pt-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{page?.title || (missing ? "This page is gone" : "Opening…")}</div>
          <div className="truncate font-mono text-[11px] text-dim">{page ? `by ${page.by || "an agent"} · v${page.v} · swipe down for the chat` : " "}</div>
        </div>
        <button type="button" aria-label="Close the page" onClick={close} className="grid h-10 w-10 flex-none place-items-center border-0 bg-transparent text-dim cursor-pointer"><X size={22} /></button>
      </div>
    </div>
    {page ? <iframe ref={frame} key={page.v} title={page.title} srcDoc={page.html} sandbox="allow-scripts" referrerPolicy="no-referrer" allow=""
      className="m-2.5 min-h-0 flex-1 rounded-xl border border-line bg-white" />
      : <div className="flex-1 grid place-items-center font-mono text-sm text-dim">{missing ? "The room doesn't have this page anymore." : "…"}</div>}
    <div className="flex-none px-4 pb-[max(10px,env(safe-area-inset-bottom))] text-center font-mono text-[10.5px] text-dim">
      🔒 Sealed: it can only save this board. It can't read the chat, your phone or the internet.</div>
  </div>;
}

export type { PageRef };
