// The home scene: the room's wolts standing together at the campfire, each in its saved look, drawn on one small
// pixel canvas (112 x 64, like the Hat Shop's scenes) so every wolt has the same pixel size. A wolt that is working
// gets a little bubble over its head. Sprites, hats and anchors are the Hat Shop's (card-assets, see CardLook.tsx).
import { useEffect, useRef, useState } from "react";
import type { Look } from "./CardLook";

const urls = import.meta.glob("./card-assets/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const cache = new Map<string, Promise<HTMLImageElement | null>>();
function load(id: string) {
  if (!cache.has(id)) cache.set(id, new Promise((done) => {
    const src = urls[`./card-assets/${id}.png`]; if (!src) return done(null);
    const im = new Image(); im.onload = () => done(im); im.onerror = () => { cache.delete(id); done(null); }; im.src = src;
  }));
  return cache.get(id)!;
}
// where a hat sits and where the eyes are, per creature (the same numbers as CardLook.tsx)
const ANCHOR: Record<string, { hx: number; ht: number; L: number[]; R: number[]; y: number[] }> = {
  beaver: { hx: 8.5, ht: 1, L: [3, 5], R: [8, 11], y: [4, 6] }, otter: { hx: 8.5, ht: 1, L: [4, 7], R: [10, 13], y: [3, 5] }, raccoon: { hx: 9.5, ht: 2, L: [4, 6], R: [11, 13], y: [7, 8] },
};
const GLASSES: Record<string, string[]> = { shades: ["#0b0b10", "#16161e", "#fff"], aviators: ["#c9a23a", "#2d4a5c", "#bfe6ff"], rose: ["#8a1f4a", "#ff5fa2", "#ffd6ea"], nerd: ["#111", "", ""] };
export const SKY = "#140f24";  // the top of the night sky: the phone's status strip takes this colour on home
const W = 150, H = 74, G = 62;  // wider and taller than the Hat Shop's 112 x 64: the wolts come out a little smaller and lower, with sky above them

export type Standing = { name: string; look: Look; busy?: boolean; away?: boolean };

export function Squad({ wolts }: { wolts: Standing[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [heads, setHeads] = useState<{ name: string; x: number; y: number }[]>([]);  // where each head is, for the bubbles
  const sig = wolts.map((w) => [w.name, w.look.creature, w.look.hat, w.look.glasses, w.away ? 1 : 0].join(":")).join("|");
  useEffect(() => {
    let off = false;
    const ids = ["n-big-pine", "n-campfire", "n-log", ...wolts.flatMap((w) => [`c-${w.look.creature}`, ...(w.look.hat ? [`h-${w.look.hat}`] : [])])];
    Promise.all(ids.map(load)).then((ims) => {
      const cv = ref.current; if (off || !cv) return;
      const by = Object.fromEntries(ids.map((id, i) => [id, ims[i]])), c = cv.getContext("2d")!;
      cv.width = W; cv.height = H; c.imageSmoothingEnabled = false;
      const g = c.createLinearGradient(0, 0, 0, G); g.addColorStop(0, SKY); g.addColorStop(1, "#2f2140"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ffffffaa"; for (const [x, y] of [[9, 6], [27, 12], [48, 4], [66, 9], [86, 5], [103, 13], [38, 17], [118, 8], [133, 16], [142, 5]]) c.fillRect(x, y, 1, 1);
      c.fillStyle = "#3a3326"; c.fillRect(0, G, W, H - G); c.fillStyle = "#28231a"; c.fillRect(0, G, W, 1);
      const n = wolts.length, step = n <= 5 ? 23 : 112 / (n - 1), first = (W - (n - 1) * step) / 2;
      // the pine on the left as in the mock; the fire on the right only when it doesn't stand on a wolt
      const pine = by["n-big-pine"]; if (pine) c.drawImage(pine, 0, G + 2 - pine.height);
      const fire = by["n-campfire"]; if (fire && n <= 4) c.drawImage(fire, W - 17, G + 2 - fire.height);
      const out: { name: string; x: number; y: number }[] = [];
      wolts.forEach((w, i) => {
        const im = by[`c-${w.look.creature}`]; if (!im) return;
        const a = ANCHOR[w.look.creature] || ANCHOR.raccoon, cx = first + i * step, ox = Math.round(cx - im.width / 2), oy = G + 3 - im.height;
        c.globalAlpha = w.away ? 0.55 : 1;
        c.drawImage(im, ox, oy);
        const gl = GLASSES[w.look.glasses];
        if (gl) {
          const px = (x: number, y: number, col: string) => { c.fillStyle = col; c.fillRect(ox + x, oy + y, 1, 1); }, [y0, y1] = a.y;
          for (const [x0, x1] of [a.L, a.R]) {
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (gl[1] || y === y0 || y === y1 || x === x0 || x === x1) px(x, y, y === y0 || !gl[1] ? gl[0] : gl[1]);
            if (gl[2]) px(x0 + 1, y1, gl[2]);
          }
          for (let x = a.L[1] + 1; x < a.R[0]; x++) px(x, y0, gl[0]); px(a.L[0] - 1, y0, gl[0]); px(a.R[1] + 1, y0, gl[0]);
        }
        const hat = w.look.hat ? by[`h-${w.look.hat}`] : null; let top = oy;
        if (hat) { top = oy + a.ht - hat.height + 3; c.drawImage(hat, Math.round(ox + a.hx - hat.width / 2), top); }
        c.globalAlpha = 1;
        out.push({ name: w.name, x: cx, y: Math.max(top, 14) });
      });
      setHeads(out);
    });
    return () => { off = true; };
  }, [sig]);
  return <div className="relative">
    <canvas ref={ref} role="img" aria-label={`${wolts.map((w) => w.name).join(", ")} at the campfire`} className="block w-full" style={{ imageRendering: "pixelated", aspectRatio: `${W} / ${H}`, background: SKY }} />
    {heads.map((h) => wolts.find((w) => w.name === h.name)?.busy && <span key={h.name} style={{ left: `${(h.x / W) * 100}%`, top: `${Math.max(40, (h.y / H) * 100 + 4)}%` }}
      className="absolute -translate-x-[35%] whitespace-nowrap bg-panel rounded-[10px] px-[7px] py-[3px] font-mono font-semibold text-[10px] text-go shadow-[0_2px_6px_#0004]
        after:content-[''] after:absolute after:left-3 after:-bottom-[5px] after:border-[5px] after:border-transparent after:border-t-panel after:border-b-0">gnawing…</span>)}
  </div>;
}
