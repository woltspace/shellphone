// Lets the Python tests drive the page's pipe against a real relay: one JSON command per line in, one answer out.
import { createInterface } from "node:readline";
import { open } from "../src/pipe.js";

let pipe = null;
const states = [], wire = [];
class Tapped extends WebSocket {  // remembers everything that crosses the wire, as the relay sees it
  constructor(url) { super(url); this.addEventListener("message", (e) => wire.push(String(e.data))); }
  send(data) { wire.push(String(data)); super.send(data); }
}
const run = {
  async open({ link, options }) { pipe = open(link, { WebSocket: Tapped, ...options }); states.push(pipe.state); pipe.onState((s) => states.push(s)); return {}; },
  async request({ method, path, body }) { try { return await pipe.request(method, path, body); } catch (e) { return { failed: e.code || String(e) }; } },
  async wait({ state, ms = 15000 }) { const end = Date.now() + ms; while (pipe.state !== state && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return { state: pipe.state }; },
  async states() { return { states }; },
  async wire() { return { wire }; },
  async close() { pipe.close(); return {}; },
};
for await (const line of createInterface({ input: process.stdin })) {
  let out;
  try { const { cmd, ...args } = JSON.parse(line); out = await run[cmd](args); } catch (e) { out = { error: String(e.message || e) }; }
  process.stdout.write(JSON.stringify(out) + "\n");
}
