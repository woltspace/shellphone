"""An agent on another computer than the room's (experimental): its calls go to the room sealed, through the relay.

    link_parts(link)   https://RELAY/r/ROOM#a.SECRET.CODE -> (relay, room id, secret, code), or None if it isn't one
    Away(cfg)          one sealed pipe to the room; call(method, path, body, auth) -> the room's answer, like connector.call

The page does the same in web/src/pipe.js. An agent's link seals with the room's invite secret (as a guest's page does)
and carries the person's one-time code: the room only lets it sign up, and after that it uses its own key.
"""
import base64, json, re, time, urllib.parse

from . import seal

TIMEOUT = 30  # seconds for the room to answer one call


def link_parts(link):
    got = urllib.parse.urlsplit(link)
    found = re.fullmatch(r"/r/([A-Za-z0-9_-]{22})", got.path)
    parts = got.fragment.split(".")
    if got.scheme not in ("http", "https") or not got.netloc or not found or len(parts) != 3 or parts[0] != "a" or not parts[2]:
        return None
    return f"{got.scheme}://{got.netloc}", found.group(1), parts[1], parts[2]


class Away:
    def __init__(self, cfg, connect=None):
        self.address = cfg["relay"].replace("http", "ws", 1) + f"/r/{cfg['room']}/ws"
        self.room, self.secret = seal.b64d(cfg["room"], 16), seal.b64d(cfg["secret"], 32)
        self.connect, self.ws, self.session, self.n = connect, None, None, 0

    def _open(self):
        if self.connect is None:
            from websockets.sync.client import connect
            self.connect = connect
        self.ws = self.connect(self.address, open_timeout=15, max_size=256 * 1024)
        client = seal.Client(self.room, self.secret, "i")
        self.ws.send(json.dumps({"data": client.hi()}))
        end = time.monotonic() + 10
        while time.monotonic() < end:
            frame = json.loads(self.ws.recv(timeout=max(0.1, end - time.monotonic())))
            if isinstance(frame, dict) and isinstance(frame.get("data"), str):
                try:
                    self.session = client.hello(frame["data"])
                    return
                except seal.SealError:
                    continue  # not the answer to this connection
        raise OSError("the room didn't answer: is it still open?")

    def close(self):
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass
        self.ws = self.session = None

    def call(self, method, path, body, auth):
        """(status, body) from the room. One retry on a new connection if the old one went."""
        for attempt in (0, 1):
            asked = False
            try:
                if self.session is None:
                    self._open()
                asked = True
                return self._ask(method, path, body, auth)
            except Exception as exc:  # the socket went (websockets' own errors too), or the room didn't answer
                self.close()
                if attempt or (asked and method != "GET"):  # a POST may have gone through: never send it twice
                    raise OSError(f"couldn't reach the room through the relay: {exc}") from exc

    def _ask(self, method, path, body, auth):
        self.n += 1
        rid = self.n
        self.ws.send(json.dumps({"data": self.session.seal({"t": "req", "id": rid, "method": method, "path": path, "body": body, "auth": auth})}))
        parts, end = [], time.monotonic() + TIMEOUT
        while time.monotonic() < end:
            frame = json.loads(self.ws.recv(timeout=max(0.1, end - time.monotonic())))
            if not isinstance(frame, dict) or not isinstance(frame.get("data"), str):
                continue
            try:
                msg = self.session.open(frame["data"])
            except seal.SealError:
                continue
            if not isinstance(msg, dict) or msg.get("t") != "res" or msg.get("id") != rid:
                continue  # news, or an answer to something else
            if isinstance(msg.get("chunk"), str):  # a long answer, in numbered parts
                parts.append(msg["chunk"])
                if len(parts) < msg.get("of", 0):
                    continue
                whole = json.loads(base64.b64decode("".join(parts)))
                return whole["status"], whole["body"]
            return msg["status"], msg["body"]
        raise TimeoutError("the room didn't answer in time")
