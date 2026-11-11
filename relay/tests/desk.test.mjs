// The relay's desk and room, run under node with stand-ins for Cloudflare's parts, so the awkward orderings can
// be made to happen on purpose: a desk that answers late, never, or after the room's next host is already in.
//   node --test relay/tests/desk.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

// index.js as it is, with only its one Cloudflare import swapped for the smallest things that behave the same.
const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const line = 'import { DurableObject } from "cloudflare:workers";';
assert.ok(source.includes(line));
const stand = `class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
class Response { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.webSocket = init.webSocket; } }
class WebSocketPair { constructor() { this[0] = globalThis.newSocket(); this[1] = globalThis.newSocket(); } }
class WebSocketRequestResponsePair { constructor(request, response) { this.request = request; this.response = response; } }`;
const file = join(mkdtempSync(join(tmpdir(), "relay-")), "index.mjs");
writeFileSync(file, source.replace(line, stand));
const { Desk, Room } = await import(pathToFileURL(file).href);

let clock = 1_800_000_000_000;
Date.now = () => clock;
const BEAT = 10_000, later = (ms) => { clock += ms; };
const settle = () => new Promise((r) => setImmediate(r));

globalThis.newSocket = () => ({
  kept: null, sent: [], closed: null,
  serializeAttachment(x) { this.kept = structuredClone(x); }, deserializeAttachment() { return structuredClone(this.kept); },
  send(text) { this.sent.push(text); }, close(code) { this.closed ??= code; },
});

function newDesk(vars = {}) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...p) { const rows = db.prepare(q).all(...p); return { toArray: () => rows, one: () => rows[0] }; } };
  return new Desk({ storage: { sql } }, { MAX_ROOMS: "1", BEAT_SECONDS: "10", ...vars });
}

// A room whose desk is `desk`, or whatever `via` puts in front of it. A socket the other end closed is gone from the room.
function newRoom(name, desk, via = (d) => d) {
  const sockets = [], ctx = {
    id: { toString: () => name }, alarm: null,
    // a socket the room closed is gone from it, unless the test says its closing hasn't got through yet (lingers)
    getWebSockets: (tag) => sockets.filter((s) => (s.sock.closed === null || s.sock.lingers) && (!tag || s.tag === tag)).map((s) => s.sock),
    acceptWebSocket(sock, [tag]) { sockets.push({ sock, tag }); },
    storage: { async setAlarm(at) { ctx.alarm = at; }, async deleteAlarm() { ctx.alarm = null; } },
    setWebSocketAutoResponse(pair) { ctx.auto = pair; },
    getWebSocketAutoResponseTimestamp: (sock) => (sock.pinged ? new Date(sock.pinged) : null),
  };
  const room = new Room(ctx, { BEAT_SECONDS: "10", DESK: { idFromName: () => "desk", get: () => via(desk) } });
  const come = async (what, claim) => {
    const res = await room.fetch({ url: `https://relay.test/r/${name}/${what}`, headers: { get: (h) => (h === "X-Shellphone-Claim" && claim) || null } });
    return res.status === 101 ? sockets.at(-1).sock : res.status;
  };
  const up = async () => JSON.parse((await room.fetch({ url: `https://relay.test/r/${name}/up` })).body).up;
  const ping = (sock) => { sock.pinged = clock; };  // what Cloudflare notes when a socket says it's here: the room isn't woken
  const gone = (sock) => { sock.closed = 1006; return room.webSocketClose(sock, 1006); };  // the other end went away
  return { room, ctx, host: (claim) => come("host", claim), client: () => come("ws"), gone, up, ping };
}

test("a room that reports too late loses its place, and is told so", () => {
  const desk = newDesk();
  const a = desk.open("a");
  assert.deepEqual(a, { ok: true, gen: 1 });
  assert.equal(desk.open("b").ok, false);  // full
  later(3 * BEAT + 1);                      // a says nothing for three report times
  const b = desk.open("b");
  assert.equal(b.ok, true);                // its place went to b
  assert.deepEqual(desk.report("a", a.gen, 0, 0), { ok: false });  // and a hears it: no place to come back to
  assert.equal(desk.stats().open_rooms, 1);
  desk.leave("b", b.gen, 0, 0);
  assert.deepEqual(desk.report("a", a.gen, 2, 9), { ok: true });   // with a place free, a late room gets one back
  const s = desk.stats();
  assert.deepEqual([s.open_rooms, s.days[0].rooms_opened, s.days[0].connections, s.days[0].frames], [1, 2, 2, 9]);  // not a new room; its counts kept
});

test("a goodbye from an earlier host can't close the room's next one", () => {
  const desk = newDesk();
  const first = desk.open("a"), second = desk.open("a");  // the host came back before its old goodbye arrived
  assert.deepEqual([first.gen, second.gen], [1, 2]);
  desk.leave("a", first.gen, 0, 0);
  assert.equal(desk.stats().open_rooms, 1);
  assert.deepEqual(desk.report("a", first.gen, 0, 0), { ok: false });  // the earlier host isn't the room any more
  assert.deepEqual(desk.report("a", second.gen, 0, 0), { ok: true });
  desk.leave("a", second.gen, 0, 0);
  assert.equal(desk.stats().open_rooms, 0);
});

test("the public count only reads, and leaves out a room that went silent", () => {
  const desk = newDesk({ MAX_ROOMS: "5" });
  let writes = 0;
  const real = desk.sql.exec.bind(desk.sql);
  desk.open("a"); desk.open("b");
  desk.sql.exec = (q, ...p) => { if (!/^select/i.test(q.trim())) writes++; return real(q, ...p); };
  assert.equal(desk.live(), 2);
  later(3 * BEAT + 1);            // both go silent past the point a place is given away
  assert.equal(desk.live(), 0);   // neither is counted any more,
  assert.equal(desk.count(), 2);  // though nothing has cleared them away yet: that is for the next host or report
  assert.equal(writes, 0);        // and all that asking wrote nothing
});

test("taps are counted by day and by thing, up to a day's limit, and nothing else is taken", () => {
  const desk = newDesk();
  desk.tap("mic"); desk.tap("mic"); desk.tap("file"); desk.tap("more"); desk.tap("camera"); desk.tap(undefined);
  assert.deepEqual(desk.stats().taps.map((t) => [t.what, t.n]), [["file", 1], ["mic", 2], ["more", 1]]);  // only the things it knows
  for (let i = 0; i < 5100; i++) desk.tap("mic");
  assert.equal(desk.stats().taps.find((t) => t.what === "mic").n, 5000);  // a day's count stops at its limit
  later(86400 * 1000);
  desk.tap("mic");
  assert.deepEqual(desk.stats().taps.filter((t) => t.what === "mic").map((t) => t.n), [1, 5000]);  // a new day, a new count
});

test("a number is never given twice, even to a room the desk had forgotten", () => {
  const desk = newDesk();
  const old = desk.open("a");
  later(3 * BEAT + 1);            // a goes silent and is forgotten,
  const back = desk.open("a");    // then its host comes back
  assert.notEqual(back.gen, old.gen);
  desk.leave("a", old.gen, 0, 0);  // the old host's goodbye arrives only now
  assert.equal(desk.stats().open_rooms, 1);
  assert.deepEqual(desk.report("a", old.gen, 0, 0), { ok: false });  // and its report is not the room's
  assert.deepEqual(desk.report("a", back.gen, 0, 0), { ok: true });
  assert.equal(desk.open("b").ok, false);  // the place is still taken
  const other = desk.open("a");            // numbers run across rooms and admissions alike
  assert.ok(other.gen > back.gen);
});

test("a room told it lost its place stops serving", async () => {
  const desk = newDesk(), a = newRoom("a", desk), b = newRoom("b", desk);
  const host = await a.host(), page = await a.client();
  later(3 * BEAT + 1);  // a's alarm never ran (as if the object had been asleep with its alarm lost)
  assert.equal(typeof (await b.host()), "object");
  await a.room.alarm();
  assert.deepEqual([host.closed, page.closed], [4429, 4404]);
  assert.equal(await a.host(), 429);  // and asking again finds the relay full
});

test("a room that can't reach the desk stops before the desk gives its place away", async () => {
  const desk = newDesk();
  let broken = false;
  const a = newRoom("a", desk, (d) => (broken ? { report: async () => { throw new Error("unreachable"); }, leave: async () => {} } : d));
  const host = await a.host(), page = await a.client(), began = clock;
  a.room.webSocketMessage(page, JSON.stringify({ data: "one" }));
  broken = true;
  later(BEAT); await a.room.alarm();
  assert.equal(host.closed, null);                        // one missed report: still serving,
  assert.equal(a.ctx.alarm, clock + Math.ceil(BEAT / 3));  // and asking again sooner
  later(BEAT); await a.room.alarm();
  assert.deepEqual([host.closed, page.closed], [4429, 4404]);  // two report times unconfirmed: it stops
  assert.ok(clock - began < 3 * BEAT);              // before the desk would forget it
  broken = false;
  assert.equal(desk.stats().days[0].frames, 0);          // nothing was told while the desk was unreachable
  await a.gone(host);
  assert.equal(desk.stats().days[0].frames, 1);          // and nothing was lost: the goodbye carries it
});

test("a desk that never answers doesn't keep a room serving past its lease", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const desk = newDesk();
  let hung = false;
  const a = newRoom("a", desk, (d) => (hung ? { report: () => new Promise(() => {}), leave: async () => {} } : d));
  const host = await a.host(), page = await a.client();
  hung = true;
  later(BEAT);
  const waiting = a.room.alarm();  // asks the desk, and no answer comes
  await settle();
  a.room.webSocketMessage(page, JSON.stringify({ data: "still carried" }));
  assert.equal(host.sent.length, 2);  // the join, and this frame: inside the lease, the room serves
  later(BEAT);
  a.room.webSocketMessage(page, JSON.stringify({ data: "not carried" }));
  assert.deepEqual([host.sent.length, host.closed, page.closed], [2, 4429, 4404]);  // at the deadline it stops, report still pending
  t.mock.timers.tick(10_000);  // and the wait for the desk ends by itself
  await waiting;
});

test("a late answer for a host that left changes nothing of the next host's", async () => {
  const desk = newDesk();
  let answer = null;
  const slow = (d) => ({ open: (...a) => d.open(...a), leave: (...a) => d.leave(...a),
    report: (...a) => (answer ? d.report(...a) : new Promise((yes) => { answer = () => yes(d.report(...a)); })) });
  const a = newRoom("a", desk, slow);
  const old = await a.host();
  later(BEAT);
  const reporting = a.room.alarm();  // the old host's report is on its way, unanswered
  await settle();
  await a.gone(old);
  const next = await a.host(), page = await a.client();
  const alarm = a.ctx.alarm, kept = next.deserializeAttachment();
  answer();                          // now the desk answers the old report: "yes, you hold your place"
  await reporting;
  assert.deepEqual([next.closed, page.closed, a.ctx.alarm], [null, null, alarm]);
  assert.deepEqual(next.deserializeAttachment(), kept);  // not a number of the new host's was touched
  assert.equal(desk.stats().open_rooms, 1);
});

test("an old host's goodbye, answered late, leaves the room's next host alone", async () => {
  const desk = newDesk();
  let release = null;
  const slow = (d) => ({ open: (...a) => d.open(...a), report: (...a) => d.report(...a),
    leave: (...a) => new Promise((yes) => { release = () => yes(d.leave(...a)); }) });
  const a = newRoom("a", desk, slow);
  const old = await a.host(), oldPage = await a.client();
  const leaving = a.gone(old);  // closes its clients, removes its alarm, then waits for the desk
  await settle();
  assert.deepEqual([oldPage.closed, a.ctx.alarm], [4404, null]);
  const next = await a.host(), page = await a.client();  // the host is back at once
  const alarm = a.ctx.alarm;
  assert.ok(alarm);
  release();
  await leaving;
  assert.deepEqual([next.closed, page.closed, a.ctx.alarm], [null, null, alarm]);  // its client and its alarm are still there
  assert.equal(desk.stats().open_rooms, 1);                                         // and the desk still has the room open
  assert.deepEqual(desk.report("a", next.deserializeAttachment().gen, 0, 0), { ok: true });
});

test("only one host at a time asks the desk for a room's place", async () => {
  const desk = newDesk();
  let let_in = null;
  const slow = (d) => ({ open: (...a) => new Promise((yes) => { let_in = () => yes(d.open(...a)); }) });
  const a = newRoom("a", desk, slow);
  const first = a.host();
  await settle();
  const second = await Promise.race([a.host(), settle().then(() => "still asking the desk")]);
  assert.equal(second, 409);  // a second while the first is still being admitted: turned away at once
  let_in();
  assert.equal(typeof (await first), "object");
  assert.equal((await first).deserializeAttachment().gen, 1);
});

const MINE = "A".repeat(43), OTHER = "B".repeat(43);

test("a host that died without a goodbye is replaced by its own room coming back, and by nobody else", async () => {
  const desk = newDesk(), r = newRoom("a", desk);
  const first = await r.host(MINE);
  r.ping(first);
  const page = await r.client();
  assert.equal(await r.up(), true);
  assert.equal(await r.host(MINE), 409);   // still saying it's here: nobody takes its place, not even itself
  later(20_000); r.ping(first);
  later(59_000);
  assert.equal(await r.host(MINE), 409);   // 59 s of silence isn't gone yet
  later(1_000);                            // a minute: the connection died and the relay was never told
  assert.equal(await r.up(), false);       // so the room no longer shows as up
  assert.equal(await r.client(), 404);     // and nobody is let in to talk to a dead socket
  assert.equal(await r.host(OTHER), 409);  // another room's claim doesn't open this one
  assert.equal(await r.host(), 409);       // nor does no claim at all
  assert.equal(await r.host("short"), 409);
  first.lingers = page.lingers = true;     // the dead connection's sockets stay listed for a while after they are closed
  const second = await r.host(MINE);       // the room's own process, back on a new connection
  assert.equal(typeof second, "object");
  assert.equal(first.closed, 4409);
  assert.equal(page.closed, 4404);         // its page starts over with the new connection
  assert.equal(r.room.host(), second);
  assert.deepEqual(r.room.clients(), []);
  assert.equal(await r.up(), true);
  assert.equal(desk.stats().open_rooms, 1);
  // What the dead connection still does touches nothing of the new one's.
  const mine = await r.client();
  r.room.webSocketMessage(first, JSON.stringify({ to: "*", data: "late" }));
  assert.deepEqual(mine.sent, []);
  const told = second.sent.length;
  await r.room.webSocketClose(page, 1006);  // the old page's closing isn't reported to the new host as someone leaving
  assert.equal(second.sent.length, told);
  await r.room.webSocketClose(first, 1006);
  assert.equal(mine.closed, null);
  assert.equal(second.closed, null);
  assert.notEqual(r.ctx.alarm, null);
  assert.equal(desk.stats().open_rooms, 1);
  // And when the new host leaves in the ordinary way, the room has no host: the dead one, still listed, isn't it again.
  await r.gone(second);
  assert.equal(r.room.host(), undefined);
  assert.equal(await r.up(), false);
  assert.equal(desk.stats().open_rooms, 0);
});

test("a host from before claims is never judged and never replaced", async () => {
  const desk = newDesk(), r = newRoom("a", desk);
  const old = await r.host();              // no claim, and it never pings
  later(10 * 60_000);
  assert.equal(await r.up(), true);        // as it always was: listed is up
  assert.equal(typeof await r.client(), "object");
  assert.equal(await r.host(MINE), 409);   // and nobody can take its place, with any claim
  assert.equal(await r.host(), 409);
  assert.equal(old.closed, null);
});

test("a host with a claim that goes quiet is closed at the room's next report", async () => {
  const desk = newDesk(), r = newRoom("a", desk);
  const host = await r.host(MINE), page = await r.client();
  later(61_000);
  await r.room.alarm();
  assert.equal(host.closed, 4429);
  assert.equal(page.closed, 4404);
});

test("pages that went without a goodbye don't hold a place, and pages that never pinged aren't judged", async () => {
  const desk = newDesk(), r = newRoom("a", desk);
  const host = await r.host(MINE);
  const keep = () => { r.ping(host); };
  const silent = await r.client();         // an older page: it never says it's here, so it's left alone
  const pages = [];
  for (let i = 0; i < 9; i++) { const p = await r.client(); r.ping(p); pages.push(p); }
  assert.equal(await r.client(), 429);     // ten are in: full
  later(30_000); keep(); r.ping(pages[0]); // one page is still there; the other eight went quiet
  later(31_000); keep();
  const next = await r.client();
  assert.equal(typeof next, "object");     // the quiet ones made room
  assert.deepEqual(pages.map((p) => p.closed), [null, ...Array(8).fill(4408)]);
  assert.equal(silent.closed, null);
  assert.equal(host.sent.filter((f) => JSON.parse(f).leave).length, 8);  // and the host was told each one left
  const before = host.sent.length;
  await r.room.webSocketClose(pages[1], 1006);  // its closing, arriving late, isn't counted or told twice
  assert.equal(host.sent.length, before);
});
