// Pixel sprites for wolts, and the lore lines they chew on while working. Same as the classic page.
import { hatSize, hatSrc } from "./hats";

export const SPRITES: Record<string, { map: string[]; colors: Record<string, string> }> = {
  raccoon: { map: ["...BB........BBB.........","...BFGG.....GFFB.........","...BABB.....BAAB.........","...BCAABBBBBACCB.........","...BAAAAAAAAAAAB.........","...BCCCCAAACCCCB.........","...BCBCCAAACCCCB.........",".BBCCBBCBCCCBCBCB........",".BBACBBCAAACBCCAB........",".BBCAAADHHHDAAACB...BBB..",".BBCAAADHHHDAAACB...BBB..","...BCAADDDDDAEEB...BCCCB.","....BCCCCEEECBB....BAAACB","...BAAAAAAAAAAAB...BCCCBB","...BAAAAAAAAAAAB...BCCCCB",".BBAAAAAAAAAAAAAB..BAAAAB",".BBAABBAAAAABAAAB..BCCCCB",".BBAAAABAAABAAAABBBAACCCB",".GGFAAABAAABAAAAGBBAABBCG","BAABAAABAAABAAABABBCAAAB.","BAAABBBBAAABBBBAABBCCBB..","BCCAAAAAAAAAAAAACBBBB....",".BBBBGGAAAAAGBBBB........",".BBCCBBAAAAABCCCB........","...BBBBBBBBBBBBB........."],
    colors: { A: "#7f8894", B: "#282c33", C: "#40454b", D: "#f0ecf0", E: "#545c65", F: "#a0abbd", G: "#050029", H: "#efa09f" } },
  beaver: { map: ["..AAA........AAA.....",".ABBBA......ABBBA....",".ABAAAAAAAAAAAABA....",".ABABBBBBBBBBAABA....","..ABBBBBBBBBBBAA.....","..ABABBBBAEBBBAA.....","..ABABBBBAEBBBAA.....",".ABBAAAABAEBBBBA.....",".ABACAACCCFABBBA.....",".ABACCACCCFABBBA.AAA.",".ABBAAAAAAEBBBAAADDDA","..ABBCAFABBBBAA.AADDA","...ABAAAABBBBBBAADADA","..ABBBBBBBBBBBBAADDAA",".ABBABCCCAEBBBBBAADDA",".ABBACCCABBBBABBADADA",".AGGACCCAGGGGABBADADA","..AAACCCAAAAABBBADDA.","..ABCCCCCCFABBBBAAAA.",".AAABCCCCAAAABBBAA...","ABBBACCCABBBBBBAA....","AAAAAAAAAAAAAAAA....."],
    colors: { A: "#3f190e", B: "#af6127", C: "#fce6b0", D: "#773c1f", E: "#050003", F: "#fffee7", G: "#dd7a2d" } },
};
export const LORE: Record<string, string[]> = {
  beaver: ["Gnawing on it…", "Hauling some logs…", "Patching the dam…", "Packing the mud…", "Stacking branches…", "Slapping the tail…"],
  raccoon: ["Gnawing on it…", "Rummaging through the bins…", "Washing it in the creek…", "Sniffing out the bug…", "Stashing the shiny bits…", "Peeking under the lid…"],
};

const svgUri = (svg: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
function spriteRects(creature: string) {
  const { map, colors } = SPRITES[creature] || SPRITES.raccoon;
  let rects = "";
  map.forEach((row, y) => [...row].forEach((c, x) => { if (colors[c]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${colors[c]}"/>`; }));
  return { rects, side: Math.max(map.length, ...map.map((r) => r.length)) };
}
// A person is a filled circle in their colour; their wolts wear that colour as a ring.
export function personAvatar(name: string, color: string, hat = "") {
  const ch = (name || "?").trim()[0].toUpperCase().replace(/[<&]/g, "");
  const top = hatImage(hat, 20, 9, 1.35, -12);  // a hat sits on top of the circle, a little tilted
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${top ? "-7 -14 54 54" : "0 0 40 40"}"><circle cx="20" cy="20" r="20" fill="${color}"/><text x="20" y="26" text-anchor="middle" font-family="monospace" font-weight="700" font-size="18" fill="#fff">${ch}</text>${top}</svg>`);
}
// where a hat sits on each creature: its middle (x) and its brim (y), in the sprite's pixels (the Hat Shop's numbers)
const HAT_AT: Record<string, { x: number; y: number }> = { raccoon: { x: 9.5, y: 5 }, beaver: { x: 8.5, y: 4 } };
function hatImage(hat: string, x: number, brim: number, scale = 1, tilt = 0) {
  const src = hatSrc(hat);
  if (!src) return "";
  const { w, h } = hatSize(hat), W = w * scale, H = h * scale;
  return `<image href="${src}" x="${x - W / 2}" y="${brim - H}" width="${W}" height="${H}" style="image-rendering:pixelated"${tilt ? ` transform="rotate(${tilt} ${x} ${brim - H / 2})"` : ""}/>`;
}
export function woltAvatar(creature: string, color: string, hat = "") {
  const { rects, side } = spriteRects(creature);
  const pad = side * 0.25, box = side + pad * 2;
  const at = HAT_AT[creature] || HAT_AT.raccoon, top = hatImage(hat, at.x, at.y);
  // with a hat, the picture grows upward (and as much sideways, to stay square) so the hat fits
  const grow = top ? Math.max(0, hatSize(hat).h - at.y - pad + 0.5) : 0, x0 = -pad - grow / 2, y0 = -pad - grow, b = box + grow;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${b} ${b}" shape-rendering="crispEdges"><circle cx="${side / 2}" cy="${side / 2}" r="${box / 2 - 1}" fill="${color}33" stroke="${color}" stroke-width="1.6"/>${rects}${top}</svg>`);
}

// A wolt standing in the scene, the way the lodge draws it: the whole creature, no circle, feet on the bottom edge.
// Every one is drawn at the same scale, with room on top for a hat, so they stand in a row on the grass.
export function woltSprite(creature: string, hat = "") {
  const { rects, side } = spriteRects(creature);
  const at = HAT_AT[creature] || HAT_AT.raccoon, top = hatImage(hat, at.x, at.y);
  const room = 12, b = side + room;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-room / 2} ${-room} ${b} ${b}" shape-rendering="crispEdges">${rects}${top}</svg>`);
}

// The lodge's landscape, pixel by pixel (the lodge home page's generator): snowy mountains, pine hills, a strip of grass,
// earth and the river. Drawn once, a little wider than any phone, and reused.
let scene = "";
export const SCENE = { px: 5, rows: 48, grass: 34 };  // the grass starts at row 34
export function lodgeScene() {
  if (scene) return scene;
  const S = SCENE.px, W = 180, H = SCENE.rows, BANK = SCENE.grass, RIVER = 40;
  const C = { fa: "#8AA6BA", fb: "#6A8698", sn: "#F0F4F8", sb: "#C8D8E8", na: "#3E5A32", nb: "#293E20", ta: "#3A7030", tb: "#2A5225", tc: "#1A3A18", tt: "#4A2810",
    ga: "#72B855", gb: "#4A8838", gc: "#2A5A1A", ea: "#5A4020", eb: "#3A2810", ra: "#90D4E8", rb: "#4AAAC8", rc: "#2A7AAA", rd: "#1A5888", ba: "#3A7030" };
  const out: string[] = [], dot = (x: number, y: number, c: string) => out.push(`<rect x="${x * S}" y="${y * S}" width="${S}" height="${S}" fill="${c}"/>`);
  const fp: number[] = [], np: number[] = [];
  for (let x = 0; x < W; x++) {
    fp[x] = Math.round(7 + 5 * Math.sin(x * 0.05 + 0.3) + 3 * Math.sin(x * 0.12 + 1.7) + 1.5 * Math.sin(x * 0.04 + 0.9));
    np[x] = Math.round(6 + 6 * Math.sin(x * 0.08 + 1.0) + 3.5 * Math.sin(x * 0.16 + 0.5) + 1.5 * Math.sin(x * 0.22 + 2.4));
  }
  for (let x = 0; x < W; x++) { const ft = BANK - 16 - fp[x], snow = ft + 3;
    for (let y = Math.max(ft, 0); y < BANK; y++) dot(x, y, y <= snow ? (y === snow ? C.sb : C.sn) : y === ft ? C.fb : C.fa); }
  for (let x = 0; x < W; x++) { const nt = BANK - 2 - np[x]; for (let y = Math.max(nt, 1); y < BANK; y++) dot(x, y, y === nt ? C.nb : C.na); }
  for (let x = 0; x < W; x++) { dot(x, BANK, C.ga); dot(x, BANK + 1, C.gb); dot(x, BANK + 2, C.gc); dot(x, BANK + 3, C.ea); for (let y = BANK + 4; y < RIVER; y++) dot(x, y, C.eb); }
  for (let x = 0; x < W; x++) { dot(x, RIVER, C.ba); dot(x, RIVER + 1, (x * 3 + 2) % 9 < 2 ? C.ra : x % 5 === 0 ? C.rb : C.rc); dot(x, RIVER + 2, C.rc); for (let y = RIVER + 3; y < H; y++) dot(x, y, C.rd); }
  const tree = (cx: number, base: number, h: number) => {
    for (let dy = 0; dy < h; dy++) { const hw = Math.floor((dy + 1) * 0.55), c = dy < 2 ? C.ta : dy < h - 2 ? C.tb : C.tc;
      for (let dx = -hw; dx <= hw; dx++) if (cx + dx >= 0 && cx + dx < W) dot(cx + dx, base - h + 1 + dy, c); }
    dot(cx, base + 1, C.tt); dot(cx, base + 2, C.tt);
  };
  for (let tx = 3; tx < W - 3; tx += 7 + ((tx * 13 + 5) % 5)) { const nt = BANK - 2 - np[tx]; if (nt < BANK - 7) tree(tx, nt + Math.floor(np[tx] * 0.55), 5 + ((tx * 7) % 4)); }
  scene = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" shape-rendering="crispEdges">${out.join("")}</svg>`);
  return scene;
}
