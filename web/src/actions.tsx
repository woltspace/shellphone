// What you can do with a held message: one list, so adding an action is one entry here. Each entry decides for itself
// whether it shows, from the message (whose it is, what's in it), the agent that sent it, and what you may do in this
// room (the host gets terminal links, a desk shows tiles). The emoji row sits above this list; the list sits under the
// lifted message on a phone and under the emoji row on a computer.
import type { ReactNode } from "react";
import { Copy, ExternalLink, Link2, SquareTerminal } from "lucide-react";
import type { Ctx } from "./Message";
import type { Msg } from "./room";

export type Action = { id: string; label: string; icon: ReactNode; run?: () => void; href?: string };
type Entry = (m: Msg, ctx: Ctx) => Action | null;

const copyText = (s: string) => { navigator.clipboard?.writeText(s).catch(() => {}); };

export const MESSAGE_ACTIONS: Entry[] = [
  (m) => m.text ? { id: "copy", label: "Copy", icon: <Copy size={19} />, run: () => copyText(m.text!) } : null,
  // an agent's terminal: the desk's tile when the desk is open, else (host only: the room sends links to the host alone)
  // the agent's session on the host's own lodge
  (m, ctx) => {
    if (m.kind !== "wolt" || !m.wolt) return null;
    const icon = <SquareTerminal size={19} />, label = `${m.wolt}'s terminal`;
    if (ctx.showTerminal) return { id: "terminal", label, icon, run: () => ctx.showTerminal!(m.wolt!) };
    const href = ctx.terminals?.[m.wolt];
    return href ? { id: "terminal", label, icon, href } : null;
  },
];

export const messageActions = (m: Msg, ctx: Ctx) => MESSAGE_ACTIONS.map((a) => a(m, ctx)).filter((a): a is Action => !!a);

// a link held in a message, the Telegram way: open it, or copy it
export const linkActions = (url: string): Action[] => [
  { id: "open", label: "Open", icon: <ExternalLink size={19} />, href: url },
  { id: "copy-link", label: "Copy link", icon: <Link2 size={19} />, run: () => copyText(url) },
];

// one row of the list: a real link when it goes somewhere (so the browser opens it in a new tab), else a button
export function ActionRow({ a, done, small }: { a: Action; done: () => void; small?: boolean }) {
  const cls = `w-full flex items-center gap-3.5 border-0 bg-transparent text-left text-ink no-underline cursor-pointer active:bg-[#18100a0d] hover:bg-[#18100a08] ${small ? "h-10 px-4 text-[14px]" : "h-[52px] px-5 text-[17px]"}`;
  return a.href
    ? <a role="menuitem" href={a.href} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); done(); }} className={cls}>{a.icon}{a.label}</a>
    : <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); a.run?.(); done(); }} className={cls}>{a.icon}{a.label}</button>;
}
