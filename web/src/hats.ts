// Hats, from the Hat Shop: each person picks one for themselves and one for each of their own wolts, and everyone in the
// room sees them on their faces. The room keeps the choices (state.looks for wolts, state.faces "hat-<id>" for people);
// App puts them in `worn` on every update, so any face drawn anywhere wears the right hat.
import list from "./hats/hats.json";

export const HATS = list as { id: string; name: string; w: number; h: number }[];
// inlined: a face is an SVG data URI, and an image inside one can only come from another data URI
const srcs = import.meta.glob("./hats/h-*.png", { eager: true, query: "?inline", import: "default" }) as Record<string, string>;
export const hatSrc = (id?: string) => (id ? srcs[`./hats/h-${id}.png`] : undefined);
export const hatSize = (id: string) => HATS.find((h) => h.id === id) || { w: 16, h: 16 };

export const worn: { wolts: Record<string, string>; people: Record<string, string> } = { wolts: {}, people: {} };
export function wear(looks: Record<string, Record<string, string>> = {}, faces: Record<string, string> = {}) {
  worn.wolts = Object.fromEntries(Object.entries(looks).filter(([, l]) => hatSrc(l.hat)).map(([w, l]) => [w, l.hat]));
  worn.people = Object.fromEntries(Object.entries(faces).filter(([, f]) => f.startsWith("hat-") && hatSrc(f.slice(4))).map(([e, f]) => [e, f.slice(4)]));
}
