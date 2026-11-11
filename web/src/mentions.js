// One rule for @names, shared by the @ picker, the composer's highlight and sent messages, so they always agree.
// A human is tagged by the first word of their name, letters, digits, _ and - only ("Sam Smith" → @Sam, "O'Neil" → @ONeil).

/** @param {string} name */
export const handle = (name) => (name || "").trim().split(/\s+/)[0].replace(/[^\w-]/g, "");

/** Lower-cased names an @ can point at in this room. @param {{wolt: string}[]} wolts @param {{name: string}[]} people */
export const mentionNames = (wolts, people) =>
  new Set([...wolts.map((w) => w.wolt.toLowerCase()), ...people.map((p) => handle(p.name).toLowerCase()).filter(Boolean)]);
