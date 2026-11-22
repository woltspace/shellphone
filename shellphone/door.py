"""The one door of the tunnel for rooms at addresses of your own. cloudflared hands every request under your domain to
this socket; a request goes on to a room only if its name is listed and what answers on that room's port is, right
then, that room with sharing on. So a name never shows whatever took a closed room's port, and listing a room doesn't
restart the tunnel for everyone else. A socket in ~/.shellphone rather than a port: no other program can come to own it."""
import contextlib, os, socket, threading

HEAD_LIMIT = 65536


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


def _pass_on(src, dst):
    with contextlib.suppress(OSError):
        while data := src.recv(65536):
            dst.sendall(data)
    with contextlib.suppress(OSError):
        dst.shutdown(socket.SHUT_WR)


def handle(conn, rooms, is_room):
    conn.settimeout(30)
    got = b""
    while b"\r\n\r\n" not in got:
        chunk = conn.recv(65536)
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
    if not is_room(host, room["port"]):  # closed, unshared, or something else has its port now
        return _refuse(conn, "503 Service Unavailable", "this room is offline")
    try:
        up = socket.create_connection(("127.0.0.1", room["port"]), 10)
    except OSError:
        return _refuse(conn, "503 Service Unavailable", "this room is offline")
    with up:
        conn.settimeout(None)
        up.settimeout(None)
        up.sendall(head + rest)
        body = threading.Thread(target=_pass_on, args=(conn, up), daemon=True)
        body.start()
        _pass_on(up, conn)
        with contextlib.suppress(OSError):
            conn.shutdown(socket.SHUT_RDWR)
        body.join(5)


class Door:
    def __init__(self, path, rooms, is_room):
        self.path, self.rooms, self.is_room, self.slots = str(path), rooms, is_room, threading.BoundedSemaphore(512)
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
            self.slots.acquire()
            try:
                threading.Thread(target=self._one, args=(conn,), daemon=True).start()
            except RuntimeError:  # no threads to spare: this one is dropped, the door stays
                conn.close()
                self.slots.release()

    def _one(self, conn):
        try:
            conn.setblocking(True)
            handle(conn, self.rooms, self.is_room)
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
