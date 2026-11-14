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
