"""The host's end of the pipe: sealed requests from a page or an agent come in through the relay, answers go back.

    HostPipe   one client's connection: the handshake, then requests in and responses out. No network in it.
    serve()    the room's one outgoing connection to the relay, handing each client's frames to its HostPipe.

A request is {"t":"req","id":n,"method","path","body","auth"} and its answer {"t":"res","id":n,"status","body"},
both sealed (seal.py). The relay only ever sees the sealed form.
"""
import json, threading, time

from . import seal

MAX_BODY = 32 * 1024   # a request's body, as JSON
MAX_BAD = 5            # frames that don't open or make no sense, before the client is turned away
PER_SECOND = 20        # requests a client may make, on average
BURST = 40


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

    def _allowed(self):
        now = self._clock()
        self._tokens = min(BURST, self._tokens + (now - self._filled) * PER_SECOND)
        self._filled = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True

    def feed(self, data):
        """One frame from this client -> the frame to send back, or None for nothing. Raises Closed to drop the client."""
        with self._lock:  # one frame at a time per client: answers go back in the order the requests came
            if self._session is None:
                try:
                    hello, self._session, self._kind = self._host.hi(data)
                except seal.SealError:
                    return self._strike()
                return hello
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
                return self._session.seal({"t": "res", "id": rid, "status": status, "body": body})
            except seal.SealError:
                raise Closed("this session has sealed all it may") from None

    def _reply(self, msg):
        method, path, body, auth = msg.get("method"), msg.get("path"), msg.get("body"), msg.get("auth")
        if method not in ("GET", "POST") or not isinstance(path, str) or not path.startswith("/") or len(path) > 2000:
            return 400, {"error": "not a request the room understands"}
        if not isinstance(auth, str) or len(auth) > 200:
            return 403, {"error": "not on this room's list"}
        if len(json.dumps(body)) > MAX_BODY:
            return 413, {"error": "too big"}
        if not self._allowed():
            return 429, {"error": "slow down"}
        try:
            return self._answer(self._kind, method, path, body, auth)
        except Exception as exc:  # the room's own failure is the room's to log; the client gets a plain answer
            print(f"the room couldn't answer {method} {path.split('?')[0]}: {exc!r}", flush=True)
            return 500, {"error": "the room couldn't answer"}


def serve(url, key, new_pipe, stop, on_state=lambda state: None, connect=None, wait=(1, 2, 4, 8, 15, 30)):
    """Keep one connection to the relay (the room's `host` socket at `url`) until `stop` is set, reconnecting when it drops.

    new_pipe() makes a HostPipe for each client the relay announces. on_state gets "up", "down" or "refused: ..."."""
    if connect is None:
        from websockets.sync.client import connect  # only a shared room needs it
    tries = 0
    while not stop.is_set():
        try:
            with connect(url, additional_headers={"Authorization": f"Bearer {key}"} if key else {}, open_timeout=15, max_size=256 * 1024) as ws:
                tries, pipes = 0, {}
                on_state("up")
                while not stop.is_set():
                    try:
                        raw = ws.recv(timeout=1)
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
                        if out is not None:
                            ws.send(json.dumps({"to": cid, "data": out}))
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (401, 409):  # not allowed to open rooms here, or this room already has a host: trying again won't help
                on_state(f"refused: {'this relay is not open to new rooms yet' if status == 401 else 'this room already has a host'}")
                return
            on_state("down")
        if stop.wait(wait[min(tries, len(wait) - 1)]):
            break
        tries += 1
    on_state("down")
