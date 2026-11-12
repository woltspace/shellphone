// Desk bridge: lets the room's desktop view show your wolts' live terminals, from your own lodge, read-only.
//
//   node desk/bridge.mjs            # then open the room on this computer and press "desk"
//
// It runs on this computer only (127.0.0.1) and talks to the lodge on :7777. The room's page, open in your browser on
// this same computer, asks it two things:
//   GET  /sessions          → your lodge's running sessions: name, wolt, last activity (nothing else)
//   WS   /tui?session=NAME  → that session's terminal, as it is drawn (tmux attach), output only
// Read-only: nothing the page sends ever reaches the terminal, so no keystroke from a browser can type into a wolt.
// Only pages from the rooms you allow (DESK_ORIGINS, default your woltspace.com rooms and localhost) may connect, so
// another website open in your browser can't watch your terminals. Anyone else in the room opening the desk view
// reaches their own computer, not yours: they see nothing.
// Node stdlib only (Node 22+, for its built-in WebSocket client).
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.DESK_PORT || 7791);
const LODGE = process.env.DESK_LODGE || '127.0.0.1:7777';
const ORIGINS = (process.env.DESK_ORIGINS || '^https://shellphone-[a-z0-9-]+\\.woltspace\\.com$,^http://(127\\.0\\.0\\.1|localhost)(:\\d+)?$')
  .split(',').map((s) => new RegExp(s));
const allowed = (o) => !!o && ORIGINS.some((r) => r.test(o));

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowed(origin)) { res.writeHead(403); return res.end('not from an allowed room'); }
  const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Private-Network': 'true' };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET' }); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/sessions') {
    try {
      const d = await (await fetch(`http://${LODGE}/sessions?view=lodge`)).json();
      const list = (Array.isArray(d) ? d : d.sessions || []).filter((s) => s.alive !== false && s.status === 'running')
        .map((s) => ({ name: s.name, wolt: s.wolt, last: s.last_activity || 0 }));
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ sessions: list }));
    } catch { res.writeHead(502, cors); return res.end('the lodge on ' + LODGE + " isn't answering"); }
  }
  res.writeHead(404, cors); res.end('not found');
});

// A browser's websocket: we answer the handshake ourselves, open our own (client) websocket to the lodge, and pass the
// terminal's output down. What the browser sends is read only to keep the connection alive and is never forwarded.
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x'), session = url.searchParams.get('session') || '';
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/tui' || !allowed(req.headers.origin) || !key || !/^[\w.-]{1,120}$/.test(session)) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const frame = (op, data) => {  // a server frame: never masked
    const n = data.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536
      ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127, 0, 0, 0, 0]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; })()]);
    if (!sock.destroyed) sock.write(Buffer.concat([head, data]));
  };
  const cols = Math.min(400, Math.max(20, Number(url.searchParams.get('cols')) || 120));
  const rows = Math.min(200, Math.max(5, Number(url.searchParams.get('rows')) || 36));
  const up = new WebSocket(`ws://${LODGE}/tui?session=${encodeURIComponent(session)}`);
  up.binaryType = 'arraybuffer';
  up.onopen = () => up.send(JSON.stringify({ type: 'resize', cols, rows }));
  up.onmessage = (e) => frame(2, Buffer.from(typeof e.data === 'string' ? Buffer.from(e.data) : new Uint8Array(e.data)));
  const end = () => { try { up.close(); } catch { /* already closed */ } if (!sock.destroyed) { frame(8, Buffer.alloc(0)); sock.end(); } };
  up.onclose = end; up.onerror = end;
  sock.on('data', (b) => { if ((b[0] & 0x0f) === 8) end(); });  // the browser closed; anything else it says is dropped
  sock.on('error', end); sock.on('close', end);
});

server.listen(PORT, '127.0.0.1', () => console.log(`Desk bridge on http://127.0.0.1:${PORT} → lodge ${LODGE} (read-only terminals)`));
