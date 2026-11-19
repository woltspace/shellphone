// Where a held message and its actions go on screen. The actions always fit: a message taller than the room left for it
// is shown cut short (it scrolls inside its frame), never pushing the menu off the bottom, where a fixed overlay can't reach.
//   node --test web/tests/held.test.mjs
export const ROW = 48, PAD = 8, GAP = 8, TOP = 16, BOTTOM = 24;

export function heldLayout(rect, items, vh) {
  const menuH = items * ROW + PAD;
  const room = Math.max(ROW, vh - TOP - BOTTOM - menuH - GAP);  // what's left for the message itself
  const height = Math.min(rect.height, room);
  const top = Math.max(TOP, Math.min(rect.top, vh - BOTTOM - menuH - GAP - height));
  return { top, height, cut: height < rect.height, menuTop: top + height + GAP, menuH };
}
