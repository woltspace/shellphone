"""The tunnel's one door (shellphone/door.py): a real room behind it, then everything that must not get through."""
import argparse, http.server, socket, tempfile, threading, time, unittest, sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import cli, home
from shellphone.door import Door
from shellphone.outside import Outside

NAME = "room.example.com"


class Doorway(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory(dir="/tmp")  # a socket's path has to be short
        self.addCleanup(d.cleanup)
        p = patch.dict("os.environ", {"SHELLPHONE_HOME": d.name + "/h"})
        p.start()
        self.addCleanup(p.stop)
        r, data, url, token, code, server = cli.start(argparse.Namespace(keep=d.name + "/room", port=0, name="Hostess"))
        self.addCleanup(server.server_close)
        self.out = Outside(r, data, True, "https://site.example", server.server_address[1], cli.HOST_EMAIL, say=lambda *a, **kw: None, hostname=NAME)
        r.LINKER = r.OUTSIDE = self.out
        self.out.on()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.server, self.listed = server, {NAME: {"port": server.server_address[1], "keep": None}}
        self.path = Path(d.name) / "d.sock"
        self.door = Door(self.path, lambda: self.listed, home.answers_as_room)
        self.addCleanup(self.door.close)

    def send(self, raw):
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(10)
            s.connect(str(self.path))
            s.sendall(raw)
            got = b""
            while data := s.recv(65536):
                got += data
        return got

    def get(self, path="/enter", host=NAME):
        return self.send(f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: keep-alive\r\n\r\n".encode())

    def status(self, got):
        return int(got.split(b" ", 2)[1])

    def test_a_listed_shared_room_is_served_with_its_own_key_check(self):
        self.assertEqual(self.status(self.get()), 200)
        self.assertEqual(self.status(self.get("/api/state")), 403)

    def test_a_key_in_a_body_gets_through_whole(self):
        body = ('{"k": "%s"}' % self.out.on()[1]["link"].split("#k.")[1]).encode()
        head = f"POST /api/enter HTTP/1.1\r\nHost: {NAME}\r\nOrigin: https://{NAME}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n"
        self.assertEqual(self.status(self.send(head.encode() + body)), 200)

    def test_unshared_means_offline(self):
        self.out.off()
        self.assertEqual(self.status(self.get()), 503)

    def test_whatever_takes_a_closed_rooms_port_is_never_served(self):
        hits = []
        class Other(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass
            def do_GET(self):
                hits.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"someone else's service")
        port = self.server.server_address[1]
        self.server.shutdown()
        self.server.server_close()
        self.assertEqual(self.status(self.get("/private")), 503)
        other = http.server.ThreadingHTTPServer(("127.0.0.1", port), Other)
        threading.Thread(target=other.serve_forever, daemon=True).start()
        self.addCleanup(other.server_close)
        self.addCleanup(other.shutdown)
        got = self.get("/private")
        self.assertEqual(self.status(got), 503)
        self.assertNotIn(b"someone else", got)
        self.assertEqual(hits, ["/enter"])  # asked who it is, and handed nothing else

    def test_other_names_and_this_computers_names_are_nothing(self):
        for host in ("other.example.com", "127.0.0.1", "localhost"):
            self.assertEqual(self.status(self.get(host=host)), 404, host)
        self.listed.clear()  # removed: gone at once
        self.assertEqual(self.status(self.get()), 404)

    def test_what_could_be_read_two_ways_is_refused(self):
        for extra in ("Host: 127.0.0.1\r\n", "X: a\nHost: 127.0.0.1\r\n", " Host: 127.0.0.1\r\n", "Host : 127.0.0.1\r\n"):
            self.assertEqual(self.status(self.send(f"GET /enter HTTP/1.1\r\nHost: {NAME}\r\n{extra}\r\n".encode())), 400, repr(extra))

    def test_one_connection_never_carries_a_second_rooms_request(self):
        one = f"GET /enter HTTP/1.1\r\nHost: {NAME}\r\n\r\n"
        self.assertEqual(self.send((one + one.replace(NAME, "other.example.com")).encode()).count(b"HTTP/1."), 1)

    def test_stalled_uploads_to_one_room_dont_stall_another_and_dont_last(self):
        path = self.path.with_name("f.sock")
        other = "other.example.com"
        both = {**self.listed, other: self.listed[NAME]}
        door = Door(path, lambda: both, lambda host, port: True, each=4, total=32, idle=3)
        self.addCleanup(door.close)
        held = []
        self.addCleanup(lambda: [s.close() for s in held])
        stall = f"POST /lodge/join HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 1000\r\n\r\n".encode()
        for _ in range(12):
            s = socket.socket(socket.AF_UNIX)
            s.connect(str(path))
            s.sendall(stall)
            held.append(s)
        time.sleep(1)
        self.assertEqual(door.busy[NAME], 4)  # its own share, and no more
        self.path, kept = path, self.path
        self.assertNotIn(self.status(self.get(host=other)), (0, 503))
        time.sleep(4)
        self.assertEqual(door.busy[NAME], 0)  # a body that doesn't come is let go
        self.assertEqual(self.status(self.get()), 200)
        self.path = kept

    def test_a_head_has_a_deadline_however_slowly_it_comes(self):
        path = self.path.with_name("h.sock")
        door = Door(path, lambda: self.listed, lambda host, port: True, head_seconds=1)
        self.addCleanup(door.close)
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(5)
            s.connect(str(path))
            began = time.monotonic()
            try:
                for c in b"GET /enter HTTP/1.1":
                    s.sendall(bytes([c]))
                    time.sleep(0.25)
            except OSError:
                pass
            self.assertLess(time.monotonic() - began, 3.5)

    def test_a_body_of_unknown_length_is_refused(self):
        got = self.send(f"POST /api/enter HTTP/1.1\r\nHost: {NAME}\r\nTransfer-Encoding: chunked\r\n\r\n".encode())
        self.assertEqual(self.status(got), 411)

    def test_only_one_door_at_a_time(self):
        with self.assertRaises(SystemExit):
            Door(self.path, lambda: self.listed, home.answers_as_room)


if __name__ == "__main__":
    unittest.main()
