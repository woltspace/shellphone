// The sky behind everyone, from Lauren's home scene (her branch's Scene.tsx): a pixel sky by day, at sunset and by
// night, with a sun or a moon, clouds or stars, a meadow, a big pine on the left and, by night, a campfire on the right.
// It follows this phone's clock (and its dark mode); the little sun or moon switches it by hand, and that choice stays
// on this phone until it agrees with the clock again.
import { useEffect, useMemo, useRef, useState } from "react";

const art = import.meta.glob("./scene/*.png", { eager: true, query: "?inline", import: "default" }) as Record<string, string>;
const cache = new Map<string, Promise<HTMLImageElement | null>>();
function load(id: string) {
  if (!cache.has(id)) cache.set(id, new Promise((done) => {
    const src = art[`./scene/${id}.png`]; if (!src) return done(null);
    const im = new Image(); im.onload = () => done(im); im.onerror = () => { cache.delete(id); done(null); }; im.src = src;
  }));
  return cache.get(id)!;
}

export type Sky = "day" | "sunset" | "night";
const SKIES: Record<Sky, { top: string; low: string; ground: string; edge: string }> = {
  night: { top: "#140f24", low: "#2f2140", ground: "#3a3326", edge: "#28231a" },
  day: { top: "#3d8fd1", low: "#b5e0f5", ground: "#5a9a3c", edge: "#467a2e" },
  sunset: { top: "#43306b", low: "#f2935a", ground: "#4f6a34", edge: "#3b5127" },  // the hour or two before the phone goes dark
};
const byClock = (): Sky => { const h = new Date().getHours(), dark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  return dark || h < 7 || h >= 19 ? "night" : h >= 17 ? "sunset" : "day"; };
const picked = (): Sky | null => { try { const v = localStorage.getItem("sky"); return v === "day" || v === "night" ? v : null; } catch { return null; } };
export function useSky(): [Sky, () => void] {
  const [sky, setSky] = useState<Sky>(() => picked() || byClock());
  useEffect(() => {
    const sync = () => setSky(picked() || byClock());
    const t = setInterval(sync, 60_000);  // the sun sets while the page is open
    window.addEventListener("sky", sync);
    return () => { clearInterval(t); window.removeEventListener("sky", sync); };
  }, []);
  const flip = () => {
    const next: Sky = sky === "night" ? "day" : "night";  // by hand it's one or the other; the sunset comes by itself
    try { if (next === byClock()) localStorage.removeItem("sky"); else localStorage.setItem("sky", next); } catch { /* private mode: until reload */ }
    setSky(next); window.dispatchEvent(new Event("sky"));
  };
  return [sky, flip];
}

// The canvas is ROWS pixels tall and as many wide as the strip needs at that size; the meadow starts at row GROUND.
export const ROWS = 70, GROUND = 58;

export function Backdrop({ sky, height }: { sky: Sky; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [cols, setCols] = useState(128);
  useEffect(() => {  // as wide as the strip, in the scene's own pixels
    const cv = ref.current?.parentElement; if (!cv) return;
    const fit = () => setCols(Math.max(64, Math.ceil(cv.clientWidth / (height / ROWS))));
    fit(); const o = new ResizeObserver(fit); o.observe(cv); return () => o.disconnect();
  }, [height]);
  useEffect(() => {
    let off = false;
    const ids = ["n-big-pine", "n-campfire", "n-flower", "n-mushroom"];
    Promise.all(ids.map(load)).then((ims) => {
      const cv = ref.current; if (off || !cv) return;
      const by = Object.fromEntries(ids.map((id, i) => [id, ims[i]])), c = cv.getContext("2d")!, W = cols, H = ROWS, G = GROUND;
      cv.width = W; cv.height = H; c.imageSmoothingEnabled = false;
      const S = SKIES[sky], g = c.createLinearGradient(0, 0, 0, G); g.addColorStop(0, S.top); g.addColorStop(1, S.low); c.fillStyle = g; c.fillRect(0, 0, W, H);
      if (sky === "sunset") { const m = c.createLinearGradient(0, 0, 0, G); m.addColorStop(0, S.top); m.addColorStop(0.55, "#b8577a"); m.addColorStop(1, S.low); c.fillStyle = m; c.fillRect(0, 0, W, G); }
      if (sky === "night") { c.fillStyle = "#ffffffaa"; for (let i = 0; i < W / 14; i++) c.fillRect((i * 37 + 9) % W, 3 + ((i * 13) % 16), 1, 1); }
      const disc = (cx: number, cy: number, r: number, col: string) => { c.fillStyle = col; for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 1) c.fillRect(cx + x, cy + y, 1, 1); };
      const sx = W - 12;  // the sun or moon in the top right corner, where it can be tapped
      if (sky === "day") { disc(sx, 9, 5, "#ffe9a0"); disc(sx, 9, 4, "#ffd23f"); }
      else if (sky === "sunset") { disc(sx, 12, 6, "#ffb347"); disc(sx, 12, 4, "#ffd98a"); }
      else { disc(sx, 9, 4, "#f4f0d8"); disc(sx + 2, 7, 3, S.top); }
      c.fillStyle = S.ground; c.fillRect(0, G, W, H - G); c.fillStyle = S.edge; c.fillRect(0, G, W, 1);
      const put = (id: string, x: number) => { const im = by[id]; if (im) c.drawImage(im, x, G + 2 - im.height); };
      put("n-big-pine", 0);  // the mushroom stands among everyone instead (Mushroom below), where it can wiggle
      put(sky === "day" ? "n-flower" : "n-campfire", W - 17);
    });
    return () => { off = true; };
  }, [sky, cols]);
  // the clouds drift across on their own, each at its own slow pace and height, so the sky never quite sits still
  const k = height / ROWS, width = cols * k;
  const clouds = useMemo(() => Array.from({ length: 4 }, (_, i) => {
    const w = 6 + Math.floor(Math.random() * 7), secs = 70 + Math.random() * 80;
    return { y: 5 + i * 4 + Math.floor(Math.random() * 4), w, top: Math.max(3, Math.floor(w / 2)), dx: 2 + Math.floor(Math.random() * 3), secs, delay: -Math.random() * secs };
  }), []);
  const puff = sky === "sunset" ? "#ffd9c2bb" : "#ffffffcc";
  return <>
    <canvas ref={ref} aria-hidden className="absolute bottom-0 left-0 block" style={{ imageRendering: "pixelated", width, height }} />
    {sky !== "night" && clouds.map((c, i) => <span key={i} aria-hidden className="cloud absolute left-0 block"
      style={{ top: c.y * k, width: c.w * k, height: 2 * k, background: puff, ["--far" as string]: `${width + 40}px`, animationDuration: `${c.secs}s`, animationDelay: `${c.delay}s` }}>
      <i className="absolute block" style={{ left: c.dx * k, top: -2 * k, width: c.top * k, height: 2 * k, background: puff }} /></span>)}
  </>;
}

// A little mushroom on the meadow that gives a tiny wiggle every so often.
export function Mushroom({ size }: { size: number }) {
  return <img src={art["./scene/n-mushroom.png"]} alt="" aria-hidden className="mushroom pixel block pointer-events-none" style={{ width: size, height: size, imageRendering: "pixelated" }} />;
}
