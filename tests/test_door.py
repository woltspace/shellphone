"""The tunnel's one door (shellphone/door.py): a real room behind it, then everything that must not get through."""
import argparse, http.server, socket, tempfile, threading, unittest, sys
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

    def test_only_one_door_at_a_time(self):
        with self.assertRaises(SystemExit):
            Door(self.path, lambda: self.listed, home.answers_as_room)


if __name__ == "__main__":
    unittest.main()
