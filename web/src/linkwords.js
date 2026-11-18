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
  if (!got.error) return { info: got, note: "" };
  // it failed: what the room says it is now (when it says), with its reason. A stop that failed is never shown as done.
  return { info: { ...info, ...(typeof got.linked === "boolean" ? { linked: got.linked } : {}), error: got.error }, note: "" };
}

// What a call to /api/link came to. Reading (GET): null when the room refuses (not its host here: nothing is drawn);
// its answer only when it succeeded and says plainly whether the room is shared; anything else is "unknown", never
// "Private". Switching (POST): the room's own words, a refusal or a failure included; null when there were none.
export function answered(read, status, body) {
  const said = body !== null && typeof body === "object" && !Array.isArray(body);
  if (read) {
    if (status === 403 || status === 404) return null;
    return status === 200 && said && typeof body.linked === "boolean" ? body : { linked: false, unknown: true };
  }
  if (said && status === 200 && typeof body.linked === "boolean") return body;
  if (said && typeof body.error === "string" && body.error) return body;
  return null;
}
