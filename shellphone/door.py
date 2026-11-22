"""The one door of the tunnel for rooms at addresses of your own. cloudflared hands every request under your domain to
this socket; a request goes on to a room only if its name is listed and what answers on that room's port is, right
then, that room with sharing on. So a name never shows whatever took a closed room's port, and listing a room doesn't
restart the tunnel for everyone else. A socket in ~/.shellphone rather than a port: no other program can come to own it."""
import contextlib, os, socket, threading, time

HEAD_LIMIT = 65536
# a connection waits for nobody: a head has a deadline, a body may not stall, and one name can't take every slot
HEAD_SECONDS, BODY_IDLE = 10, 30
EACH_ROOM, ALL_ROOMS = 128, 768


def _refuse(conn, status, text):
    body = f"{text}\n".encode()
    with contextlib.suppress(OSError):
        conn.sendall(f"HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {len(body)}\r\n"
                     "Cache-Control: no-store\r\nConnection: close\r\n\r\n".encode() + body)


def _request(head):
    """(the name asked for, the head to pass on) or None for anything two readers could read two ways."""
    lines = head.split(b"\r\n")
    if any(b"\r" in x or b"\n" in x for x in lines) or len(lines[0].split(b" ")) != 3:
        return None
    kept, hosts = [lines[0]], []
    for line in lines[1:]:
        name, colon, value = line.partition(b":")
        if not colon or not name or name != name.strip() or b" " in name or b"\t" in name:
            return None
        low = name.lower()
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


def _pass_on(src, dst):
    with contextlib.suppress(OSError):
        while data := src.recv(65536):
            dst.sendall(data)
    with contextlib.suppress(OSError):
        dst.shutdown(socket.SHUT_WR)


def _pass_body(conn, up, left, idle):
    """The body, which may not stall; after it, only whether the person is still there (an answer can take long)."""
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


def handle(conn, rooms, is_room, slot=lambda host: contextlib.nullcontext(True), head_seconds=HEAD_SECONDS, idle=BODY_IDLE):
    until, got = time.monotonic() + head_seconds, b""
    while b"\r\n\r\n" not in got:
        conn.settimeout(max(0.01, until - time.monotonic()))  # for the whole head: a byte now and then doesn't extend it
        chunk = conn.recv(65536)
        if time.monotonic() > until:
            return
        if not chunk:
            return
        got += chunk
        if len(got) > HEAD_LIMIT and b"\r\n\r\n" not in got:
            return _refuse(conn, "431 Request Header Fields Too Large", "too much")
    head, rest = got.split(b"\r\n\r\n", 1)
    asked = _request(head)
    if not asked:
        return _refuse(conn, "400 Bad Request", "bad request")
    host, head = asked
    room = rooms().get(host)
    if not room:
        return _refuse(conn, "404 Not Found", "nothing here")
    size = _body_size(head)
    if size is None:
        return _refuse(conn, "411 Length Required", "a body needs its Content-Length")
    with slot(host) as free:
        if not free:
            return _refuse(conn, "503 Service Unavailable", "this room is busy")
        if not is_room(host, room["port"]):  # closed, unshared, or something else has its port now
            return _refuse(conn, "503 Service Unavailable", "this room is offline")
        try:
            up = socket.create_connection(("127.0.0.1", room["port"]), 10)
        except OSError:
            return _refuse(conn, "503 Service Unavailable", "this room is offline")
        with up:
            up.settimeout(None)
            first = rest[:size]
            up.sendall(head + first)
            body = threading.Thread(target=_pass_body, args=(conn, up, size - len(first), idle), daemon=True)
            body.start()
            _pass_on(up, conn)
            with contextlib.suppress(OSError):
                conn.shutdown(socket.SHUT_RDWR)
            body.join(5)


def _room_for_connections(files):
    with contextlib.suppress(ImportError, OSError, ValueError):
        import resource
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        if soft != resource.RLIM_INFINITY and soft < files:
            resource.setrlimit(resource.RLIMIT_NOFILE, (files if hard == resource.RLIM_INFINITY else min(files, hard), hard))


class Door:
    def __init__(self, path, rooms, is_room, each=EACH_ROOM, total=ALL_ROOMS, head_seconds=HEAD_SECONDS, idle=BODY_IDLE):
        self.path, self.rooms, self.is_room, self.slots = str(path), rooms, is_room, threading.BoundedSemaphore(total)
        self.each, self.head_seconds, self.idle, self.busy, self.lock = each, head_seconds, idle, {}, threading.Lock()
        _room_for_connections(2 * total + 64)
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
                    _refuse(conn, "503 Service Unavailable", "too busy")
                conn.close()
                continue
            try:
                threading.Thread(target=self._one, args=(conn,), daemon=True).start()
            except RuntimeError:  # no threads to spare: this one is dropped, the door stays
                conn.close()
                self.slots.release()

    @contextlib.contextmanager
    def _slot(self, host):
        with self.lock:
            free = self.busy.get(host, 0) < self.each
            if free:
                self.busy[host] = self.busy.get(host, 0) + 1
        try:
            yield free
        finally:
            if free:
                with self.lock:
                    self.busy[host] -= 1

    def _one(self, conn):
        try:
            conn.setblocking(True)
            handle(conn, self.rooms, self.is_room, self._slot, self.head_seconds, self.idle)
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
