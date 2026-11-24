// Reactions, the WhatsApp way: hold a message (right-click, or the smiley on hover, on a computer) and a bar of emojis
// opens over it, with the message's actions (actions.tsx) under it; tap one to react, the same one again to take it back. Everyone's show as small pills under the message.
// A reaction reaches only the agent whose message it is (the room and connector see to that); nobody gets a notification.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SmilePlus } from "lucide-react";
import { ActionRow, linkActions, messageActions, type Action } from "./actions";
import type { Ctx } from "./Message";
import type { Msg } from "./room";

export const QUICK = ["👍", "❤️", "😂", "🙏", "👀", "✅"];  // 👀 seen, ✅ go: signals an agent reads too
export type Reaction = { who: string; emoji: string };

const whoName = (who: string, ctx: Ctx) => (who.startsWith("p:") ? (who.slice(2) === ctx.me ? "You" : ctx.person(who.slice(2)).name) : who.slice(2));

// a press held this long, without moving, opens the bar
const HOLD_MS = 420;

type Open = false | { at: "pop" } | { at: DOMRect; link?: string };

export function Reactable({ m, ctx, mine, children }: { m: Msg; ctx: Ctx; mine: boolean; children: ReactNode }) {
  // a computer: a small bar over the message, the actions under it. A phone, the WhatsApp way: the screen dims, the
  // message is lifted out where it was, the emojis sit above it and what you can do with it below. Held on a link: the
  // link itself with Open and Copy link, like Telegram.
  const [open, setOpen] = useState<Open>(false);
  const held = useRef<{ t: number; x: number; y: number } | null>(null), box = useRef<HTMLDivElement>(null), fired = useRef(false);
  const can = !!ctx.react && !m.pending && !m.failed && m.id !== m.cid && (m.kind === "human" || m.kind === "wolt");
  useEffect(() => {
    if (!open || open.at !== "pop") return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!can) return <>{children}</>;
  const stop = () => { if (held.current) { clearTimeout(held.current.t); held.current = null; } };
  const close = () => setOpen(false);
  const pick = (emoji: string) => { close(); ctx.react!(m.id, ctx.myReaction?.(m.id) === emoji ? "" : emoji); };
  const lift = () => (box.current?.querySelector("[data-bubble]") || box.current)!.getBoundingClientRect();
  const emojis = (big: boolean) => QUICK.map((e) => <button key={e} type="button" role="menuitem" aria-label={`React ${e}`} onClick={(ev) => { ev.stopPropagation(); pick(e); }}
    className={`${big ? "w-10 h-10 text-[24px]" : "w-9 h-9 text-[21px]"} grid place-items-center rounded-full border-0 cursor-pointer leading-none transition-transform active:scale-90 hover:scale-110 ${ctx.myReaction?.(m.id) === e ? "bg-[#18100a14]" : "bg-transparent"}`}>{e}</button>);
  const acts = messageActions(m, ctx);
  return (
    <div ref={box} className="relative group/react min-w-0 [@media(hover:none)]:select-none [-webkit-touch-callout:none]" data-react-own
      onTouchStart={(e) => {
        const t = e.touches[0], a = (e.target as HTMLElement).closest?.("a[href]"), link = a?.getAttribute("href") || undefined;
        if (!link && (e.target as HTMLElement).closest?.("button, audio, video, input, [data-tap]")) return;
        stop(); fired.current = false;
        held.current = { x: t.clientX, y: t.clientY, t: window.setTimeout(() => { held.current = null; fired.current = true; navigator.vibrate?.(10); setOpen({ at: a ? a.getBoundingClientRect() : lift(), link }); }, HOLD_MS) };
      }}
      onTouchMove={(e) => { const t = e.touches[0], h = held.current; if (h && Math.hypot(t.clientX - h.x, t.clientY - h.y) > 10) stop(); }}
      onTouchEnd={() => { stop(); if (fired.current) setTimeout(() => { fired.current = false; }, 400); }} onTouchCancel={stop}
      onClickCapture={(e) => { if (fired.current) { fired.current = false; e.preventDefault(); e.stopPropagation(); } }}  // the lift of a hold is not a tap
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("a[href]")) { if (window.matchMedia?.("(hover: hover)").matches) return; e.preventDefault(); return; }  // a computer keeps its own link menu
        e.preventDefault(); if (window.matchMedia?.("(hover: hover)").matches) setOpen({ at: "pop" });
      }}>
      {children}
      <button type="button" data-tap aria-label="React" onClick={(e) => { e.stopPropagation(); setOpen((o) => (o ? false : { at: "pop" })); }}
        className={`hidden [@media(hover:hover)]:grid absolute top-1 ${mine ? "-left-8" : "-right-8"} w-7 h-7 place-items-center rounded-full border-0 bg-transparent text-dim cursor-pointer opacity-0 group-hover/react:opacity-100 hover:bg-[#18100a0d] transition-opacity`}>
        <SmilePlus size={16} /></button>
      {open && open.at === "pop" && <div className={`absolute z-[40] bottom-full mb-1.5 ${mine ? "right-0" : "left-0"} flex flex-col ${mine ? "items-end" : "items-start"} gap-1.5 animate-[fadein_.12s_ease-out]`}>
        <div role="menu" aria-label="React to this message" className="flex items-center gap-0.5 rounded-full bg-white border border-line shadow-[0_6px_24px_#18100a2e] px-1.5 py-1">{emojis(false)}</div>
        {acts.length > 0 && <div role="menu" aria-label="Message actions" className="min-w-[200px] rounded-xl bg-white border border-line shadow-[0_6px_24px_#18100a2e] py-1">
          {acts.map((a) => <ActionRow key={a.id} a={a} done={close} small />)}</div>}
      </div>}
      {open && open.at !== "pop" && createPortal(open.link
        ? <LinkLifted rect={open.at} url={open.link} onClose={close} />
        : <Lifted rect={open.at} mine={mine} onClose={close} bar={emojis(true)} actions={acts}>{children}</Lifted>, document.body)}
    </div>
  );
}

// the phone's view of a held message: everything else dimmed, the message where it was (moved only as far as needed to
// leave room for the emojis above and the actions below), and the first touch anywhere else closes it at once
// dims the screen; the first touch outside what's shown closes it at once, still catching the rest of that tap so
// nothing underneath gets it
function Dim({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc); return () => removeEventListener("keydown", esc);
  }, []);
  return <div role="dialog" aria-label={label} className={`fixed inset-0 z-[3100] select-none animate-[fadein_.15s_ease-out] ${gone ? "opacity-0" : ""}`}
    onPointerDown={() => { if (gone) return; setGone(true); setTimeout(onClose, 350); }} onClick={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
    <div className="absolute inset-0 bg-[#18100a59] backdrop-blur-[6px]" />
    {children}
  </div>;
}

// a held link, the iPhone way: just the link, lifted out as a pill where it was, the full address, and under it Open
// and Copy link; the message stays behind the blur
function LinkLifted({ rect, url, onClose }: { rect: DOMRect; url: string; onClose: () => void }) {
  const MENU = 16 + 2 * 52, PILL = 24 + 22 * Math.ceil(url.length / 36), GAP = 10, H = innerHeight;
  const top = Math.max(16 + (Number(getComputedStyle(document.documentElement).getPropertyValue("--sat").replace("px", "")) || 0), Math.min(rect.top - 10, H - PILL - GAP - MENU - 24));
  return <Dim label="Link options" onClose={onClose}>
    <div style={{ top }} className="absolute inset-x-3 flex flex-col items-center gap-2.5 animate-[pop_.18s_ease-out]">
      <div aria-hidden className="max-w-full rounded-2xl bg-white px-4 py-2.5 text-[16px] leading-[22px] text-acc break-all shadow-[0_8px_30px_#18100a40]">{url}</div>
      <div role="menu" aria-label="Link actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
        className="min-w-[240px] rounded-2xl bg-white shadow-[0_8px_30px_#18100a40] py-2">
        {linkActions(url).map((a) => <ActionRow key={a.id} a={a} done={onClose} />)}
      </div>
    </div>
  </Dim>;
}

function Lifted({ rect, mine, bar, actions, onClose, children }: { rect: DOMRect; mine: boolean; bar?: ReactNode; actions: Action[]; onClose: () => void; children: ReactNode }) {
  const BAR = bar ? 60 : 0, MENU = actions.length ? 16 + actions.length * 52 : 0, GAP = 10, H = innerHeight;
  const height = Math.min(rect.height, H * 0.45);  // a long message shows its start
  const top = Math.max(BAR + GAP + 12 + (Number(getComputedStyle(document.documentElement).getPropertyValue("--sat").replace("px", "")) || 0), Math.min(rect.top, H - height - GAP - MENU - 24));
  const side = mine ? { right: Math.max(8, innerWidth - rect.right) } : { left: Math.max(8, rect.left) };
  return <Dim label="Message options" onClose={onClose}>
    {bar && <div role="menu" aria-label="React to this message" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ top: top - BAR - GAP, ...side }}
      className="absolute flex items-center gap-0.5 rounded-full bg-white shadow-[0_8px_30px_#18100a40] px-1.5 py-1.5 animate-[pop_.18s_ease-out]">{bar}</div>}
    <div aria-hidden style={{ top, width: rect.width, maxHeight: height, ...side }} className="absolute overflow-hidden pointer-events-none rounded-[18px] [&>*]:!m-0">{children}</div>
    {actions.length > 0 && <div role="menu" aria-label="Message actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ top: top + height + GAP, ...side }}
      className="absolute min-w-[220px] rounded-2xl bg-white shadow-[0_8px_30px_#18100a40] py-2 animate-[fadein_.18s_ease-out]">
      {actions.map((a) => <ActionRow key={a.id} a={a} done={onClose} />)}
    </div>}
  </Dim>;
}

// the pills under a message: one per emoji, with how many, yours outlined; tapping one adds yours or takes it back
export function Reactions({ m, ctx, mine }: { m: Msg; ctx: Ctx; mine: boolean }) {
  const list = ctx.reactions?.(m.id) || [];
  if (!list.length) return null;
  const by = new Map<string, string[]>();
  for (const r of list) by.set(r.emoji, [...(by.get(r.emoji) || []), r.who]);
  const me = "p:" + ctx.me;
  return <div className={`flex flex-wrap gap-1 -mt-1.5 relative z-[1] ${mine ? "justify-end pr-1" : "pl-1"}`}>
    {[...by.entries()].map(([emoji, who]) => <button key={emoji} type="button" data-tap
      title={who.map((w) => whoName(w, ctx)).join(", ")} aria-label={`${emoji} ${who.map((w) => whoName(w, ctx)).join(", ")}`}
      onClick={(e) => { e.stopPropagation(); ctx.react?.(m.id, who.includes(me) ? "" : emoji); }}
      className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-full border text-[13px] leading-none cursor-pointer shadow-[0_1px_2px_#18100a1f] ${who.includes(me) ? "bg-[#fff4ec] border-acc" : "bg-white border-line"}`}>
      <span>{emoji}</span>{who.length > 1 && <span className="font-mono text-[11px] text-dim">{who.length}</span>}
    </button>)}
  </div>;
}
