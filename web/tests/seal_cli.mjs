// Lets the Python tests drive the browser's sealing code: one JSON command per line in, one JSON answer per line out.
import { createInterface } from "node:readline";
import { b64d, Client, Host } from "../src/seal.js";

let side = null, session = null;
const run = {
  async host({ room, secrets }) { side = new Host(b64d(room), Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, b64d(v)]))); return {}; },
  async client({ room, secret, kind }) { side = new Client(b64d(room), b64d(secret), kind); return { hi: await side.hi() }; },
  async hi({ frame }) { const [hello, s, kind] = await side.hi(frame); session = s; return { hello, kind }; },
  async hello({ frame }) { session = await side.hello(frame); return {}; },
  async seal({ obj }) { return { frame: await session.seal(obj) }; },
  async open({ frame }) { return { obj: await session.open(frame) }; },
};
for await (const line of createInterface({ input: process.stdin })) {
  let out;
  try { const { cmd, ...args } = JSON.parse(line); out = await run[cmd](args); } catch (e) { out = { error: String(e.message || e) }; }
  process.stdout.write(JSON.stringify(out) + "\n");
}
