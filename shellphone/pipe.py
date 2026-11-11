"""The host's end of the pipe: sealed requests from a page or an agent come in through the relay, answers go back.

    HostPipe   one client's connection: the handshake, then requests in and responses out. No network in it.
    serve()    the room's one outgoing connection to the relay, handing each client's frames to its HostPipe.

A request is {"t":"req","id":n,"method","path","body","auth"} and its answer {"t":"res","id":n,"status","body"},
both sealed (seal.py). The relay only ever sees the sealed form.

The room also tells its clients when something changed, with a sealed {"t":"news"}: a page fetches then, instead of
asking every other second. A room where nothing happens sends nothing, and the relay can let it sleep.
"""
import base64, json, threading, time

from . import seal

MAX_BODY = 32 * 1024   # a request's body, as JSON, in bytes
WHOLE = 30_000         # an answer up to this long (as JSON) goes out in one frame
PART = 24_000          # a longer one goes out in parts of this many bytes, each sent as base64 so its size is known exactly
MAX_FRAME = 60_000     # no sealed frame may be longer than this: the relay carries 65,536 with its own wrapping
MAX_ANSWER = 4 * 1024 * 1024  # and an answer longer than this isn't sent at all
FRAMES_PER_SECOND = 200       # how fast the host hands frames to the relay, across all clients (the relay allows a host 400)
FULL_WAIT = 120        # seconds before asking a full relay again for a place
TAKEN_WAIT = 60        # seconds a host that lost its connection keeps asking a relay that says the room has a host: that host is itself, not yet seen to be gone
MAX_BAD = 5            # frames that don't open or make no sense, before the client is turned away
PER_SECOND = 20        # requests a client may make, on average
BURST = 40
NEWS_EVERY = 0.5       # seconds between two "something changed" notes at the least, however much changes


class Closed(Exception):
    """This client is done: turn it away at the relay."""


class HostPipe:
    def __init__(self, room, secrets, answer, clock=time.monotonic):
        """answer(kind, method, path, body, auth) -> (status, body): the room's reply, for a client holding link `kind`."""
        self._host, self._answer, self._clock = seal.Host(room, secrets), answer, clock
        self._session = self._kind = None
        self._bad = self._last_id = 0
        self._tokens, self._filled = float(BURST), clock()
        self._lock = threading.Lock()

    def _strike(self):
        self._bad += 1
        if self._bad >= MAX_BAD:
            raise Closed("too many frames that don't open")
        return []

    def _allowed(self):
        now = self._clock()
        self._tokens = min(BURST, self._tokens + (now - self._filled) * PER_SECOND)
        self._filled = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True

    def feed(self, data):
        """One frame from this client -> the frames to send back, in order (often one, sometimes none).
        Raises Closed to drop the client."""
        with self._lock:  # one frame at a time per client: answers go back in the order the requests came
            if self._session is None:
                try:
                    hello, self._session, self._kind = self._host.hi(data)
                except seal.SealError:
                    return self._strike()
                return [hello]
            try:
                msg = self._session.open(data)
            except seal.SealError:
                return self._strike()
            rid = msg.get("id") if isinstance(msg, dict) else None
            if not isinstance(msg, dict) or msg.get("t") != "req" or type(rid) is not int or rid <= self._last_id:
                return self._strike()  # not a request, or one whose number was already used
            self._last_id = rid
            status, body = self._reply(msg)
            try:
                return self._frames(rid, status, body)
            except seal.SealError:
                raise Closed("this session has sealed all it may") from None

    def news(self):
        """A sealed note that something in the room changed, or None for a client that isn't established yet.
        Raises Closed when this session can't seal any more."""
        with self._lock:  # sealed in turn with the answers, so the client gets frames in the order they were sealed
            if self._session is None:
                return None
            try:
                return self._session.seal({"t": "news"})
            except seal.SealError:
                raise Closed("this session has sealed all it may") from None

    def _frames(self, rid, status, body):
        """The sealed frames for one answer. Every one of them is short enough for the relay, whatever the answer holds."""
        text = json.dumps({"status": status, "body": body}, separators=(",", ":")).encode()  # ASCII: a character is a byte
        if len(text) > MAX_ANSWER:
            return self._frames(rid, 502, {"error": "too much to send at once"})
        if len(text) <= WHOLE:
            frames = [self._session.seal({"t": "res", "id": rid, "status": status, "body": body})]
        else:  # cut the bytes, and send each cut as base64: nothing in it needs escaping, so a part can't grow on the way
            cuts = [text[i:i + PART] for i in range(0, len(text), PART)]
            frames = [self._session.seal({"t": "res", "id": rid, "part": i, "of": len(cuts), "chunk": base64.b64encode(cut).decode()}) for i, cut in enumerate(cuts)]
        if max(map(len, frames)) > MAX_FRAME:  # can't happen with the sizes above; if it ever does, say so instead of sending it
            return [self._session.seal({"t": "res", "id": rid, "status": 502, "body": {"error": "the answer didn't fit"}})]
        return frames

    def _reply(self, msg):
        method, path, body, auth = msg.get("method"), msg.get("path"), msg.get("body"), msg.get("auth")
        if method not in ("GET", "POST") or not isinstance(path, str) or not path.startswith("/") or len(path) > 2000:
            return 400, {"error": "not a request the room understands"}
        if not isinstance(auth, str) or len(auth) > 200:
            return 403, {"error": "not on this room's list"}
        if len(json.dumps(body, ensure_ascii=False).encode()) > MAX_BODY:
            return 413, {"error": "too big"}
        if not self._allowed():
            return 429, {"error": "slow down"}
        try:
            return self._answer(self._kind, method, path, body, auth)
        except Exception as exc:  # the room's own failure is the room's to log; the client gets a plain answer
            print(f"the room couldn't answer {method} {path.split('?')[0]}: {exc!r}", flush=True)
            return 500, {"error": "the room couldn't answer"}


def serve(url, key, new_pipe, stop, on_state=lambda state: None, connect=None, wait=(1, 2, 4, 8, 15, 30), news=None):
    """Keep one connection to the relay (the room's `host` socket at `url`) until `stop` is set, reconnecting when it drops.

    new_pipe() makes a HostPipe for each client the relay announces. on_state gets "up", "down", "full" (the
    relay has no place for this room for now: asked again every FULL_WAIT seconds) or "refused: ..." (and it stops).
    A room that was up and is told "already has a host" just after its connection dropped keeps trying for TAKEN_WAIT
    seconds: the relay may not have noticed yet that the old connection is gone (it is cut without a goodbye when the relay is updated).
    news is a threading.Event the room sets when something changed: every established client is then told, once."""
    if connect is None:
        from websockets.sync.client import connect  # only a shared room needs it
    tries, lost = 0, None  # lost: when a connection that was up went away, until the next one is up
    while not stop.is_set():
        was_up = False
        try:
            with connect(url, additional_headers={"Authorization": f"Bearer {key}"} if key else {}, open_timeout=15, max_size=256 * 1024) as ws:
                tries, pipes, told, lost, was_up = 0, {}, 0.0, None, True
                on_state("up")
                while not stop.is_set():
                    if news is not None and news.is_set() and time.monotonic() - told >= NEWS_EVERY:
                        news.clear()  # cleared before telling: a change made meanwhile sets it again and is told next
                        told = time.monotonic()
                        for cid, pipe in list(pipes.items()):
                            try:
                                note = pipe.news()
                            except Closed:
                                pipes.pop(cid, None)
                                ws.send(json.dumps({"drop": cid}))
                                continue
                            if note:
                                ws.send(json.dumps({"to": cid, "data": note}))
                    try:
                        raw = ws.recv(timeout=1 if news is None else 0.2)
                    except TimeoutError:
                        continue
                    try:
                        msg = json.loads(raw)
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(msg, dict):
                        continue
                    if isinstance(msg.get("leave"), str):
                        pipes.pop(msg["leave"], None)
                    elif isinstance(msg.get("join"), str):
                        pipes[msg["join"]] = new_pipe()
                    elif isinstance(msg.get("from"), str) and isinstance(msg.get("data"), str):
                        cid = msg["from"]
                        pipe = pipes.setdefault(cid, new_pipe()) if cid not in pipes else pipes[cid]
                        try:
                            out = pipe.feed(msg["data"])
                        except Closed:
                            pipes.pop(cid, None)
                            ws.send(json.dumps({"drop": cid}))
                            continue
                        for frame in out:
                            ws.send(json.dumps({"to": cid, "data": frame}))
                            if len(out) > 1:  # a long answer: hand it over at a steady pace, well inside what the relay allows a host
                                time.sleep(1 / FRAMES_PER_SECOND)
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status is None and not stop.is_set():  # why the connection went, for whoever reads the room's log later
                print(f"the relay connection ended: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
            if was_up and lost is None:
                lost = time.monotonic()
            taken_by_us = status == 409 and lost is not None and time.monotonic() - lost < TAKEN_WAIT
            if status in (401, 409) and not taken_by_us:  # not allowed to open rooms here, or this room already has a host: trying again won't help
                on_state(f"refused: {'this relay is not open to new rooms yet' if status == 401 else 'this room already has a host'}")
                return
            if status == 429:  # the relay is carrying all the rooms it may: a place comes free when one closes
                on_state("full")
                if stop.wait(FULL_WAIT):
                    break
                continue
            on_state("down")
        if stop.wait(wait[min(tries, len(wait) - 1)]):
            break
        tries += 1
    on_state("down")
