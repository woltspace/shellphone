// Sealing for rooms reached through a relay: the relay passes these frames along and can't read them.
// The same thing as shellphone/seal.py, for the browser (WebCrypto). Both must reproduce tests/seal_vectors.json.
// Nothing here talks to a network: it turns objects into sealed frames and back, and holds the per-connection
// state that makes a replayed or duplicated frame useless.
//
// A trusted-members prototype: everyone holding one link secret can read and forge what that secret protects.

export const VERSION = "shellphone-v0";
export const MAX_SEQ = 2 ** 20; // frames one side may seal in one session; then it reconnects for new keys
const KINDS = ["h", "i"]; // which link a client holds: the host's, or the invite
const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true });

export class SealError extends Error {}

export function b64e(raw) {
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64d(text, size) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new SealError("not base64url");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const raw = Uint8Array.from(s, (c) => c.charCodeAt(0));
  if (size !== undefined && raw.length !== size) throw new SealError("wrong length");
  return raw;
}

function join(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(secret, room, info) {
  if (secret.length !== 32 || room.length !== 16) throw new SealError("a link secret is 32 bytes and a room id is 16");
  const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: room, info }, ikm, 256);
  return new Uint8Array(bits);
}

// The two keys a link secret gives, used for the handshake only. One per direction, so a frame can't be turned around.
export async function rootKeys(secret, room) {
  return { c2h: await hkdf(secret, room, enc.encode("shellphone v0 c2h")), h2c: await hkdf(secret, room, enc.encode("shellphone v0 h2c")) };
}

// Keys for one connection, from the host's fresh session id and the client's fresh challenge.
export async function sessionKeys(secret, room, sid, cn) {
  if (sid.length !== 16 || cn.length !== 16) throw new SealError("a session id and a challenge are 16 bytes each");
  return { c2h: await hkdf(secret, room, join(enc.encode("shellphone v0 session c2h|"), sid, cn)),
           h2c: await hkdf(secret, room, join(enc.encode("shellphone v0 session h2c|"), sid, cn)) };
}

const aes = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

async function seal(key, aad, obj, nonce) {
  nonce = nonce || crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(aad) }, await aes(key), enc.encode(JSON.stringify(obj)));
  return join(nonce, new Uint8Array(ct));
}

async function open(key, aad, raw) {
  if (raw.length < 12 + 16) throw new SealError("too short");
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: enc.encode(aad) }, await aes(key), raw.subarray(12));
  } catch { throw new SealError("doesn't open"); }
  try { return JSON.parse(dec.decode(plain)); } catch { throw new SealError("not json"); }
}

// One established connection, seen from one side. seal() what you send, open() what you receive.
export class Session {
  #room; #sendKey; #recvKey; #send; #recv; #sent = 0; #seen = 0;
  constructor(room, keys, send, recv) {
    this.#room = b64e(room); this.#sendKey = keys[send]; this.#recvKey = keys[recv]; this.#send = send; this.#recv = recv;
  }

  async seal(obj, _nonce) {
    if (this.#sent >= MAX_SEQ) throw new SealError("this session has sealed all it may: reconnect for new keys");
    const seq = ++this.#sent; // taken before any await, so two seals never share a counter
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(4, seq);
    return b64e(join(head, await seal(this.#sendKey, `${VERSION}|${this.#room}|${this.#send}|${seq}`, obj, _nonce)));
  }

  async open(frame) {
    const raw = b64d(frame);
    if (raw.length < 8) throw new SealError("too short");
    const view = new DataView(raw.buffer, raw.byteOffset, 8), seq = view.getUint32(4);
    if (view.getUint32(0) !== 0 || seq < 1 || seq > MAX_SEQ) throw new SealError("counter out of range");
    const obj = await open(this.#recvKey, `${VERSION}|${this.#room}|${this.#recv}|${seq}`, raw.subarray(8));
    if (seq <= this.#seen) throw new SealError("already seen"); // checked and advanced with no await between: one copy passes
    this.#seen = seq;
    return obj;
  }
}

function split(frame) {
  const at = typeof frame === "string" ? frame.indexOf(".") : -1;
  if (at !== 1 || !KINDS.includes(frame[0])) throw new SealError("not a handshake frame");
  return [frame[0], b64d(frame.slice(2))];
}

// A client's side of one connection: hi() once, then hello() once with the host's answer.
export class Client {
  #room; #secret; #kind; #cn = null; #state = "new";
  constructor(room, secret, kind = "h") {
    if (!KINDS.includes(kind)) throw new SealError("unknown link kind");
    this.#room = room; this.#secret = secret; this.#kind = kind;
  }

  async hi(_cn, _nonce) {
    if (this.#state !== "new") throw new SealError("hi is sent once per connection");
    this.#state = "sent";
    this.#cn = _cn || crypto.getRandomValues(new Uint8Array(16)); // a new challenge for every connection
    const roots = await rootKeys(this.#secret, this.#room);
    return this.#kind + "." + b64e(await seal(roots.c2h, `${VERSION}|${b64e(this.#room)}|c2h|hi`, { t: "hi", cn: b64e(this.#cn) }, _nonce));
  }

  async hello(frame) {
    if (this.#state !== "sent") throw new SealError("no hello expected now"); // only while waiting, and only once
    this.#state = "checking"; // a second hello arriving while this one is being opened is refused too
    try {
      const [kind, raw] = split(frame);
      if (kind !== this.#kind) throw new SealError("answered under another link");
      const roots = await rootKeys(this.#secret, this.#room);
      const got = await open(roots.h2c, `${VERSION}|${b64e(this.#room)}|h2c|hello`, raw);
      if (got.t !== "hello" || got.cn !== b64e(this.#cn)) throw new SealError("not the answer to this connection");
      const keys = await sessionKeys(this.#secret, this.#room, b64d(got.sid, 16), this.#cn);
      this.#state = "established";
      return new Session(this.#room, keys, "c2h", "h2c");
    } catch (e) {
      if (this.#state === "checking") this.#state = "sent"; // a bad hello doesn't use up the wait for the real one
      throw e;
    }
  }
}

// The host's side of one connection. secrets maps a link kind ("h", "i") to its 32-byte secret.
// The host is Python (shellphone/seal.py); this is here so the tests can play both sides in the browser's crypto.
export class Host {
  #room; #secrets; #state = "new";
  constructor(room, secrets) { this.#room = room; this.#secrets = secrets; }

  async hi(frame, _sid, _nonce) {
    if (this.#state !== "new") throw new SealError("this connection is already established");
    const [kind, raw] = split(frame);
    const secret = this.#secrets[kind];
    if (!secret) throw new SealError("this room has no such link");
    const roots = await rootKeys(secret, this.#room);
    const got = await open(roots.c2h, `${VERSION}|${b64e(this.#room)}|c2h|hi`, raw);
    if (got.t !== "hi") throw new SealError("not a hi");
    if (this.#state !== "new") throw new SealError("this connection is already established");
    const cn = b64d(got.cn, 16), sid = _sid || crypto.getRandomValues(new Uint8Array(16));
    this.#state = "established";
    const hello = await seal(roots.h2c, `${VERSION}|${b64e(this.#room)}|h2c|hello`, { t: "hello", sid: b64e(sid), cn: b64e(cn) }, _nonce);
    return [kind + "." + b64e(hello), new Session(this.#room, await sessionKeys(secret, this.#room, sid, cn), "h2c", "c2h"), kind];
  }
}
