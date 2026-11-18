// The small print under "Invite people" while a room isn't shared (inside the code: "linked"), and what a tap on the switch leaves behind.
// Kept apart from LinkRoom.tsx so it can be tested without a browser: node --test web/tests/linkroom.test.mjs

// What the row says: that it's working, else why the last try failed (the room's own reason, or that the room
// couldn't be reached at all), else what the room says is still unfinished about a stop (info.note: the site
// hasn't been told yet), else what sharing does. `warn` marks a failure or a warning, so the row can show it as one.
export function unlinkedWords(info, note, busy) {
  if (busy) return { text: "Sharing the room…", warn: false };
  const failed = info.error || note || info.note;
  if (failed) return { text: failed, warn: true };
  return { text: `To invite someone, the room is shared through ${info.relay || "the site"} first. You can stop sharing any time.`, warn: false };
}

// After asking the room to share itself or to stop: the state to show, and a note when the room didn't answer.
// A room that didn't answer changes nothing, so the same button is still there to try again.
export function after(info, got) {
  if (!got) return { info: { ...info, error: undefined }, note: "Couldn't reach the room. Try again." };
  return { info: got.error ? { ...info, error: got.error } : got, note: "" };
}
