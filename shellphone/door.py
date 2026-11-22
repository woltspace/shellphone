"""The one door of the tunnel for rooms at addresses of your own. cloudflared hands every request under your domain to
this socket, and it goes on only if:
  - its name is listed, and what answers on that room's port is, right then, that room with sharing on (a name never
    shows whatever took a closed room's port);
  - and it carries a key that room accepts right now (a person's cookie, an agent's bearer key).
Without a key there is only what it takes to get in: the join page, which reads the key from the link's fragment, and
handing a key or a join code in, a few KB in a few seconds. So only someone who is in can upload, and they can take
their time. Listing a room restarts nothing. A socket in ~/.shellphone rather than a port: no other program can come
to own it."""
import contextlib, http.client, os, socket, threading, time

HEAD_LIMIT, HEAD_SECONDS = 65536, 10
HAND_IN_LIMIT, HAND_IN_SECONDS = 4096, 5  # a key or a join code
BODY_IDLE = 120  # someone who is in, sending nothing at all: gone
LINGER_SECONDS, LINGER_LIMIT = 0.5, 262144  # after the door's own answer, what is let run out unread
ALL_CONNECTIONS = 1024
# each room's own places, so a crowd at one name takes nothing from another; strangers take none from the people inside.
# strangers are sent off at once when theirs are full, people who are in wait a moment for one
STRANGERS, CHECKS, INSIDE = 24, 32, 128
TURN_SECONDS = 5
PAGES = (b"/", b"/index.html", b"/enter")


def _answer(conn, status, kind, body, linger=True):
    """The door's own answer. Then it stops listening gently: closing on bytes still on their way loses the answer."""
    with contextlib.suppress(OSError):
        conn.sendall(f"HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {len(body)}\r\n"
                     "Cache-Control: no-store\r\nConnection: close\r\n\r\n".encode() + body)
        conn.shutdown(socket.SHUT_WR)
        until, dropped = time.monotonic() + LINGER_SECONDS, 0
        while linger and dropped < LINGER_LIMIT and (spare := until - time.monotonic()) > 0:
            conn.settimeout(spare)
            if not (data := conn.recv(65536)):
                break
            dropped += len(data)


def _refuse(conn, status, text, linger=True):
    _answer(conn, status, "text/plain; charset=utf-8", f"{text}\n".encode(), linger)


def _no_key(conn, path):
    """What the room itself says to nobody's key: the app and an agent's connector know these answers."""
    agent = path.startswith(b"/lodge/")
    body = b'{"error": "unknown lodge key"}' if agent else b'{"error": "not on this room\'s list"}'
    _answer(conn, "401 Unauthorized" if agent else "403 Forbidden", "application/json", body)


def _request(head):
    """(the name asked for, the head to pass on) or None for anything two readers could read two ways."""
    lines = head.split(b"\r\n")
    if any(b"\r" in x or b"\n" in x for x in lines) or len(lines[0].split(b" ")) != 3:
        return None
    kept, hosts, once = [lines[0]], [], set()
    for line in lines[1:]:
        name, colon, value = line.partition(b":")
        if not colon or not name or name != name.strip() or b" " in name or b"\t" in name:
            return None
        low = name.lower()
        if low in (b"authorization", b"cookie"):  # whoever the door checked is who the room must see
            if low in once:
                return None
            once.add(low)
        if low == b"host":
            hosts.append(value.strip())
        elif low not in (b"connection", b"keep-alive", b"upgrade"):
            kept.append(line)
    if len(hosts) != 1:
        return None
    try:
        host = hosts[0].decode("ascii").lower().split(":")[0]
    except UnicodeDecodeError:
        return None
    # one request to a connection: cloudflared keeps connections for all the names, and the next may be another room's
    return host, b"\r\n".join([*kept, b"Host: " + host.encode(), b"Connection: close"]) + b"\r\n\r\n"


def _header(head, name):
    return next((v.strip() for k, _, v in (x.partition(b":") for x in head.split(b"\r\n")[1:]) if k.lower() == name), b"")


def _body_size(head):
    """How much body comes after the head, or None if that isn't one plain number (the room reads Content-Length only)."""
    sizes = []
    for line in head.split(b"\r\n")[1:]:
        name, _, value = line.partition(b":")
        if name.lower() == b"transfer-encoding":
            return None
        if name.lower() == b"content-length":
            sizes.append(value.strip())
    if not sizes:
        return 0
    return int(sizes[0]) if len(sizes) == 1 and sizes[0].isdigit() and len(sizes[0]) < 13 else None


def _bearer(head):
    auth = _header(head, b"authorization")
    return auth[7:].strip() if auth.startswith(b"Bearer ") else b""


def _door_key(head, path):
    """The key this request would get in by, as the room reads it: an agent's routes take its bearer key and nothing
    else, all the others a person's cookie and nothing else. So a key for the one opens nothing of the other."""
    if path.startswith(b"/lodge/"):
        key = _bearer(head)
    else:  # the last one wins, as it does in the room
        jar = dict(c.strip().split(b"=", 1) for c in _header(head, b"cookie").split(b";") if b"=" in c)
        key = jar.get(b"spo", b"")
    return key if key and len(key) < 513 and all(33 <= c < 127 and c not in b';,"\\' for c in key) else b""


def room_takes(host, port, key, agent):
    """Whether the room takes this key right now, asked by routes every room has, which change nothing. An agent's key
    gets "no such route" (404), or "you're paused" (403); anyone else's 401. A person's gets the app's manifest."""
    path, headers, yes = (("/lodge/door", {"Authorization": b"Bearer " + key}, (403, 404)) if agent
                          else ("/manifest.webmanifest", {"Cookie": b"spo=" + key}, (200,)))
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=TURN_SECONDS)
    try:
        conn.request("GET", path, headers={"Host": host, **headers})
        res = conn.getresponse()
        res.read()
        return res.status in yes
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        conn.close()


def _getting_in(method, path, head):
    """What someone with no key may ask: "page", "hand in", or None."""
    if method == b"GET" and (path in PAGES or (path == b"/lodge/connector.py" and _bearer(head))):
        return "page"  # (the connector goes to whoever holds a join code: the room checks it)
    if method == b"POST" and (path == b"/api/enter" or (path == b"/lodge/join" and _bearer(head))):
        return "hand in"
    return None


def _pass_on(src, dst):
    with contextlib.suppress(OSError):
        while data := src.recv(65536):
            dst.sendall(data)
    with contextlib.suppress(OSError):
        dst.shutdown(socket.SHUT_WR)


def _pass_body(conn, up, left, idle):
    """The body of someone who is in, at whatever pace; after it, only whether they are still there (an answer can
    take long)."""
    try:
        conn.settimeout(idle)
        while left > 0:
            data = conn.recv(min(65536, left))
            if not data:
                raise OSError("the body ended early")
            up.sendall(data)
            left -= len(data)
        conn.settimeout(None)
        while conn.recv(65536):  # no second request on this connection
            pass
    except OSError:
        if left > 0:
            for s in (up, conn):
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)
        return
    with contextlib.suppress(OSError):
        up.shutdown(socket.SHUT_WR)


def _to_room(conn, port, head, first, left, idle):
    try:
        up = socket.create_connection(("127.0.0.1", port), 10)
    except OSError:
        return _refuse(conn, "503 Service Unavailable", "this room is offline")
    with up:
        up.settimeout(None)
        up.sendall(head + first)
        body = threading.Thread(target=_pass_body, args=(conn, up, left, idle), daemon=True)
        body.start()
        _pass_on(up, conn)
        with contextlib.suppress(OSError):
            conn.shutdown(socket.SHUT_RDWR)
        body.join(5)


class Door:
    def __init__(self, path, rooms, is_room, takes=room_takes, strangers=STRANGERS, checks=CHECKS, inside=INSIDE,
                 total=ALL_CONNECTIONS, head_seconds=HEAD_SECONDS, hand_in_seconds=HAND_IN_SECONDS, idle=BODY_IDLE):
        self.path, self.rooms, self.is_room, self.takes = str(path), rooms, is_room, takes
        self.sizes = {"strangers": strangers, "checks": checks, "inside": inside}
        self.head_seconds, self.hand_in_seconds, self.idle = head_seconds, hand_in_seconds, idle
        self.places, self.lock, self.slots = {}, threading.Lock(), threading.BoundedSemaphore(total)
        _room_for_connections(3 * total + 64)
        if len(self.path.encode()) > 100:
            raise SystemExit(f"{self.path} is too long for a socket: use a shorter SHELLPHONE_HOME")
        if os.path.exists(self.path):
            with socket.socket(socket.AF_UNIX) as probe:
                try:
                    probe.connect(self.path)
                except ConnectionRefusedError:
                    os.unlink(self.path)  # left by one that was killed
                else:
                    raise SystemExit("shellphone tunnel run is already running here")
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.bind(self.path)
        os.chmod(self.path, 0o600)
        self.sock.listen(128)
        self.sock.settimeout(0.5)
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    @contextlib.contextmanager
    def place(self, host, kind, wait=TURN_SECONDS):
        with self.lock:
            places = self.places.setdefault((host, kind), threading.BoundedSemaphore(self.sizes[kind]))
        got = places.acquire(timeout=wait) if wait else places.acquire(blocking=False)
        try:
            yield got
        finally:
            if got:
                places.release()

    def handle(self, conn):
        until, got = time.monotonic() + self.head_seconds, b""
        while b"\r\n\r\n" not in got:
            conn.settimeout(max(0.01, until - time.monotonic()))  # for the whole head: a byte now and then doesn't extend it
            chunk = conn.recv(65536)
            if not chunk or time.monotonic() > until:
                return
            got += chunk
            if len(got) > HEAD_LIMIT and b"\r\n\r\n" not in got:
                return _refuse(conn, "431 Request Header Fields Too Large", "too much")
        head, rest = got.split(b"\r\n\r\n", 1)
        asked = _request(head)
        if not asked:
            return _refuse(conn, "400 Bad Request", "bad request")
        host, head = asked
        room = self.rooms().get(host)
        if not room:
            return _refuse(conn, "404 Not Found", "nothing here")
        head_only = head[:-4]  # without the blank line
        size = _body_size(head_only)
        if size is None:
            return _refuse(conn, "411 Length Required", "a body needs its Content-Length")
        method, target, _ = head_only.split(b"\r\n", 1)[0].split(b" ")
        if not target.startswith(b"/") or target.startswith(b"//"):  # the room would read another path out of those
            return _refuse(conn, "400 Bad Request", "bad request")
        path, port = target.split(b"?", 1)[0].split(b"#", 1)[0], room["port"]
        conn.settimeout(self.idle)
        way = _getting_in(method, path, head_only)
        if way:  # no key needed, so never more than it takes to get in
            return self._stranger(conn, host, port, head, rest, size if way == "hand in" else 0, size)
        key = _door_key(head_only, path)
        if not key:
            return _no_key(conn, path)  # nothing is read, and the room never hears of it
        with self.place(host, "checks") as free:
            if not free:
                return _refuse(conn, "503 Service Unavailable", "this room is busy")
            if not self.is_room(host, port):  # closed, unshared, or something else has its port now: it isn't shown the key
                return _refuse(conn, "503 Service Unavailable", "this room is offline")
            if not self.takes(host, port, key, path.startswith(b"/lodge/")):
                return _no_key(conn, path)
        with self.place(host, "inside") as free:
            if not free:
                return _refuse(conn, "503 Service Unavailable", "this room is busy")
            first = rest[:size]
            _to_room(conn, port, head, first, size - len(first), self.idle)

    def _stranger(self, conn, host, port, head, rest, allowed, size):
        if size > min(allowed, HAND_IN_LIMIT):
            return _refuse(conn, "413 Content Too Large", "too much, without a key")
        with self.place(host, "strangers", wait=0) as free:
            if not free:
                return _refuse(conn, "503 Service Unavailable", "this room is busy")
            body, until = rest[:size], time.monotonic() + self.hand_in_seconds
            while len(body) < size:  # all of it here, before the room hears anything
                spare = until - time.monotonic()
                if spare <= 0:
                    return _refuse(conn, "408 Request Timeout", "too slow")
                conn.settimeout(spare)
                data = conn.recv(size - len(body))
                if not data:
                    return
                body += data
            conn.settimeout(self.idle)
            if not self.is_room(host, port):
                return _refuse(conn, "503 Service Unavailable", "this room is offline")
            _to_room(conn, port, head, body, 0, self.idle)

    def _serve(self):
        while not self.closed.is_set():
            try:
                conn, _ = self.sock.accept()
            except TimeoutError:
                continue
            except OSError:
                if self.closed.wait(0.1):
                    break
                continue
            if not self.slots.acquire(blocking=False):  # never waits here: that would be every room waiting
                with contextlib.suppress(OSError):
                    conn.settimeout(0.2)
                    _refuse(conn, "503 Service Unavailable", "too busy", linger=False)
                conn.close()
                continue
            try:
                threading.Thread(target=self._one, args=(conn,), daemon=True).start()
            except RuntimeError:  # no threads to spare: this one is dropped, the door stays
                conn.close()
                self.slots.release()

    def _one(self, conn):
        try:
            conn.setblocking(True)
            self.handle(conn)
        except OSError:
            pass
        finally:
            conn.close()
            self.slots.release()

    def close(self):
        self.closed.set()
        self.thread.join(2)
        self.sock.close()
        with contextlib.suppress(OSError):
            os.unlink(self.path)


def _room_for_connections(files):
    with contextlib.suppress(ImportError, OSError, ValueError):
        import resource
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        if soft != resource.RLIM_INFINITY and soft < files:
            resource.setrlimit(resource.RLIMIT_NOFILE, (files if hard == resource.RLIM_INFINITY else min(files, hard), hard))
