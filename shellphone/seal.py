"""Sealing for rooms reached through a relay: the relay passes these frames along and can't read them.

Nothing here talks to a network. It turns objects into sealed frames and back, and holds the per-connection state
that makes a replayed or duplicated frame useless. web/src/seal.js is the same thing for the browser; both must
reproduce tests/seal_vectors.json.

    keys      HKDF-SHA256 over a 32-byte link secret, salted with the 16-byte room id
    handshake client "hi" (a fresh challenge) -> host "hello" (a fresh session id, the challenge echoed)
    session   AES-256-GCM, random 12-byte nonces, a rising counter per direction bound into every frame

A trusted-members prototype: everyone holding one link secret can read and forge what that secret protects.
The host's link and the invite link carry different secrets, so a guest can't become the host.
"""
import base64, json, re, secrets, threading

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

VERSION = "shellphone-v0"
MAX_SEQ = 2 ** 20  # frames one side may seal in one session; then it reconnects for new keys
KINDS = ("h", "i")  # which link a client holds: the host's, or the invite


class SealError(Exception):
    """A frame that must be dropped: wrong key, tampered, replayed, out of range, or out of turn."""


def b64e(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def b64d(text, size=None):
    if not isinstance(text, str) or not re.fullmatch(r"[A-Za-z0-9_-]*", text):
        raise SealError("not base64url")
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except ValueError:
        raise SealError("not base64url") from None
    if size is not None and len(raw) != size:
        raise SealError("wrong length")
    return raw


def _hkdf(secret, room, info):
    if len(secret) != 32 or len(room) != 16:
        raise SealError("a link secret is 32 bytes and a room id is 16")
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=room, info=info).derive(secret)


def root_keys(secret, room):
    """The two keys a link secret gives, used for the handshake only. One per direction, so a frame can't be turned around."""
    return {"c2h": _hkdf(secret, room, b"shellphone v0 c2h"), "h2c": _hkdf(secret, room, b"shellphone v0 h2c")}


def session_keys(secret, room, sid, cn):
    """Keys for one connection, from the host's fresh session id and the client's fresh challenge."""
    if len(sid) != 16 or len(cn) != 16:
        raise SealError("a session id and a challenge are 16 bytes each")
    return {"c2h": _hkdf(secret, room, b"shellphone v0 session c2h|" + sid + cn),
            "h2c": _hkdf(secret, room, b"shellphone v0 session h2c|" + sid + cn)}


def _dumps(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()


def _seal(key, aad, obj, nonce=None):
    nonce = nonce or secrets.token_bytes(12)
    return nonce + AESGCM(key).encrypt(nonce, _dumps(obj), aad.encode())


def _open(key, aad, raw):
    if len(raw) < 12 + 16:
        raise SealError("too short")
    try:
        plain = AESGCM(key).decrypt(raw[:12], raw[12:], aad.encode())
    except InvalidTag:
        raise SealError("doesn't open") from None
    try:
        return json.loads(plain)
    except ValueError:
        raise SealError("not json") from None


class Session:
    """One established connection, seen from one side. seal() what you send, open() what you receive."""

    def __init__(self, room, keys, send, recv):
        self._room, self._send_key, self._recv_key, self._send, self._recv = b64e(room), keys[send], keys[recv], send, recv
        self._sent = self._seen = 0
        self._lock = threading.Lock()

    def seal(self, obj, _nonce=None):
        with self._lock:
            if self._sent >= MAX_SEQ:
                raise SealError("this session has sealed all it may: reconnect for new keys")
            self._sent += 1
            seq = self._sent
        return b64e(seq.to_bytes(8, "big") + _seal(self._send_key, f"{VERSION}|{self._room}|{self._send}|{seq}", obj, _nonce))

    def open(self, frame):
        raw = b64d(frame)
        if len(raw) < 8:
            raise SealError("too short")
        seq = int.from_bytes(raw[:8], "big")
        if not 1 <= seq <= MAX_SEQ:
            raise SealError("counter out of range")
        obj = _open(self._recv_key, f"{VERSION}|{self._room}|{self._recv}|{seq}", raw[8:])
        with self._lock:  # checked and advanced together, so two copies arriving at once can't both pass
            if seq <= self._seen:
                raise SealError("already seen")
            self._seen = seq
        return obj


def _split(frame):
    kind, _, body = frame.partition(".") if isinstance(frame, str) else ("", "", "")
    if kind not in KINDS:
        raise SealError("not a handshake frame")
    return kind, b64d(body)


class Client:
    """A client's side of one connection: hi() once, then hello() once with the host's answer."""

    def __init__(self, room, secret, kind="h"):
        if kind not in KINDS:
            raise SealError("unknown link kind")
        self._room, self._secret, self._kind, self._roots = room, secret, kind, root_keys(secret, room)
        self._cn, self._state, self._lock = None, "new", threading.Lock()

    def hi(self, _cn=None, _nonce=None):
        with self._lock:
            if self._state != "new":
                raise SealError("hi is sent once per connection")
            self._cn, self._state = _cn or secrets.token_bytes(16), "sent"  # a new challenge for every connection
        sealed = _seal(self._roots["c2h"], f"{VERSION}|{b64e(self._room)}|c2h|hi", {"t": "hi", "cn": b64e(self._cn)}, _nonce)
        return self._kind + "." + b64e(sealed)

    def hello(self, frame):
        with self._lock:  # only while waiting for it, and only once: a replayed hello can never reset a session
            if self._state != "sent":
                raise SealError("no hello expected now")
            self._state = "checking"  # one hello is looked at at a time; a second arriving meanwhile is refused
        try:
            kind, raw = _split(frame)
            if kind != self._kind:
                raise SealError("answered under another link")
            got = _open(self._roots["h2c"], f"{VERSION}|{b64e(self._room)}|h2c|hello", raw)
            if not isinstance(got, dict) or got.get("t") != "hello" or got.get("cn") != b64e(self._cn):
                raise SealError("not the answer to this connection")
            session = Session(self._room, session_keys(self._secret, self._room, b64d(got.get("sid"), 16), self._cn), send="c2h", recv="h2c")
        except BaseException:
            with self._lock:
                self._state = "sent"  # a bad hello doesn't use up the wait for the real one
            raise
        with self._lock:
            self._state = "established"
        return session


class Host:
    """The host's side of one connection. secrets maps a link kind ("h", "i") to its 32-byte secret."""

    def __init__(self, room, secrets_by_kind):
        self._room, self._secrets, self._state, self._lock = room, dict(secrets_by_kind), "new", threading.Lock()

    def hi(self, frame, _sid=None, _nonce=None):
        """The client's hi -> (the hello to send back, the session, which link it holds). Once per connection."""
        with self._lock:
            if self._state != "new":
                raise SealError("this connection is already established")
            self._state = "checking"  # one hi is looked at at a time, so two can never both establish
        try:
            kind, raw = _split(frame)
            secret = self._secrets.get(kind)
            if secret is None:
                raise SealError("this room has no such link")
            roots = root_keys(secret, self._room)
            got = _open(roots["c2h"], f"{VERSION}|{b64e(self._room)}|c2h|hi", raw)
            if not isinstance(got, dict) or got.get("t") != "hi":
                raise SealError("not a hi")
            cn = b64d(got.get("cn"), 16)
            sid = _sid or secrets.token_bytes(16)  # fresh for every connection, so an old session's frames never open here
            hello = _seal(roots["h2c"], f"{VERSION}|{b64e(self._room)}|h2c|hello", {"t": "hello", "sid": b64e(sid), "cn": b64e(cn)}, _nonce)
            session = Session(self._room, session_keys(secret, self._room, sid, cn), send="h2c", recv="c2h")
        except BaseException:
            with self._lock:
                self._state = "new"  # a bad hi doesn't use up the connection's one handshake
            raise
        with self._lock:
            self._state = "established"
        return kind + "." + b64e(hello), session, kind
