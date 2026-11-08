// Cards: a wolt's message can carry a card built from a few blocks (json-render's shape: type, props, children).
// Drawn with plain text and https links only, so a card can't run anything on your phone.
import { useState } from "react";
import { sendText, type CardNode, type Msg } from "./room";

const safeUrl = (u: unknown) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : undefined);
const box = "border border-line rounded-[10px] bg-panel";
const btn = "font-mono font-semibold text-xs text-acc border border-acc bg-panel rounded-lg px-2.5 py-1 no-underline cursor-pointer";

function Block({ node, msg, answered }: { node: CardNode; msg: Msg; answered?: string }) {
  const p = node.props || {};
  const kids = (node.children || []).map((c, i) => <Block key={i} node={c} msg={msg} answered={answered} />);
  switch (node.type) {
    case "Card":
      return <div className="flex flex-col gap-2">
        {p.title && <div className="font-mono font-semibold text-sm text-acc">{p.title}</div>}
        {p.subtitle && <div className="text-xs text-dim">{p.subtitle}</div>}
        {kids}
      </div>;
    case "Text": return <p className="m-0 leading-snug">{p.text}</p>;
    case "List":
      return <div className={`${box} flex flex-col overflow-hidden`}>
        {(p.items || []).slice(0, 30).map((it: any, i: number) => (
          <div key={i} className="flex items-center gap-2.5 px-2.5 py-2 border-t border-line first:border-t-0">
            <div className="flex-1 min-w-0"><div className="font-semibold">{it.title}</div>{it.subtitle && <div className="text-xs text-dim">{it.subtitle}</div>}</div>
            <div className="flex items-center gap-1.5 flex-none">
              {it.badge && <span className="font-mono font-semibold text-[10px] text-white bg-acc rounded-md px-1.5 py-0.5">{it.badge}</span>}
              {it.meta && <span className="text-xs text-dim">{it.meta}</span>}
              {safeUrl(it.link?.url) && <a className={btn} href={safeUrl(it.link.url)} target="_blank" rel="noopener noreferrer">{it.link.label || "Open"}</a>}
            </div>
          </div>))}
      </div>;
    case "Buttons": return <Choices options={(p.options || []).slice(0, 8)} answered={answered} />;
    case "Link":
      return safeUrl(p.url) ? <a className={`${box} flex flex-col gap-0.5 px-2.5 py-2 text-acc font-semibold no-underline`} href={safeUrl(p.url)} target="_blank" rel="noopener noreferrer">
        {p.label || "Open"}{p.description && <span className="text-xs text-dim font-normal">{p.description}</span>}
      </a> : null;
    case "Table":
      return <table className="border-collapse w-full text-[13px]"><tbody>
        <tr>{(p.columns || []).map((c: string, i: number) => <th key={i} className="text-left font-mono font-semibold text-[11px] text-dim px-1.5 py-1 border-b border-line">{c}</th>)}</tr>
        {(p.rows || []).slice(0, 40).map((r: string[], i: number) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-1.5 py-1 border-b border-line">{v}</td>)}</tr>)}
      </tbody></table>;
    case "Stats":
      return <div className="flex gap-2 flex-wrap">{(p.items || []).slice(0, 6).map((it: any, i: number) => (
        <div key={i} className={`${box} flex-1 min-w-[70px] flex flex-col px-2.5 py-2`}><b className="text-lg">{it.value}</b><span className="text-xs text-dim">{it.label}</span></div>))}</div>;
  }
  return null;
}

// Your choice goes to the room as a normal message, so the wolts hear it.
function Choices({ options, answered }: { options: any[]; answered?: string }) {
  const [picked, setPicked] = useState<string | undefined>(answered);
  return <div className="flex flex-wrap gap-1.5">{options.map((o, i) => {
    const label = typeof o === "string" ? o : o.label, value = typeof o === "string" ? o : (o.value || o.label);
    const done = !!(picked ?? answered), on = (picked ?? answered) === value;
    return <button key={i} type="button" disabled={done}
      className={`${btn} ${on ? "bg-acc! text-white!" : done ? "opacity-45" : ""}`}
      onClick={() => { setPicked(value); sendText(value); }}>{label}</button>;
  })}</div>;
}

export function Card({ msg, all }: { msg: Msg; all: Msg[] }) {
  if (!msg.card) return null;
  const answered = all.find((x) => x.kind === "human" && x.n > msg.n && (msg.card ? optionValues(msg.card).includes(x.text || "") : false))?.text;
  return <div className="mt-1.5 mb-0.5 min-w-[min(280px,64vw)] text-sm"><Block node={msg.card} msg={msg} answered={answered} /></div>;
}
function optionValues(n: CardNode): string[] {
  const own = n.type === "Buttons" ? (n.props?.options || []).map((o: any) => (typeof o === "string" ? o : o.value || o.label)) : [];
  return [...own, ...(n.children || []).flatMap(optionValues)];
}
