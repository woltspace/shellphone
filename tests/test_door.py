"""The tunnel's one door (shellphone/door.py): a real room behind it, then everything that must not get through."""
import argparse, http.server, json, socket, tempfile, threading, time, unittest, sys
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
        self.r = r
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

    def get(self, path="/enter", host=NAME, extra=""):
        return self.send(f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: keep-alive\r\n{extra}\r\n".encode("latin-1"))

    def cookie(self):
        return f"Cookie: spo={self.out.host_token}\r\n"

    def agent(self, wolt="helper"):
        code = self.r.agent_code(cli.HOST_EMAIL, self.out.via())
        body = ('{"wolt": "%s"}' % wolt).encode()
        got = self.send(f"POST /lodge/join HTTP/1.1\r\nHost: {NAME}\r\nAuthorization: Bearer {code}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n".encode() + body)
        self.assertEqual(self.status(got), 200)
        return json.loads(got.split(b"\r\n\r\n", 1)[1])["key"], code

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
        self.assertEqual(self.status(self.get("/private", extra=self.cookie())), 503)
        other = http.server.ThreadingHTTPServer(("127.0.0.1", port), Other)
        threading.Thread(target=other.serve_forever, daemon=True).start()
        self.addCleanup(other.server_close)
        self.addCleanup(other.shutdown)
        got = self.get("/private", extra=self.cookie())
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

    def test_without_a_key_only_the_way_in_and_nothing_is_read(self):
        asked = []
        path = self.path.with_name("n.sock")
        door = Door(path, lambda: self.listed, lambda host, port: asked.append(port) or True)
        self.addCleanup(door.close)
        self.path = path
        for method, where in (("GET", "/api/state"), ("GET", "/lodge/history"), ("GET", "/sw.js"), ("GET", "/join"), ("PUT", "/enter"), ("GET", "/enter/../api/state")):
            self.assertIn(self.status(self.send(f"{method} {where} HTTP/1.1\r\nHost: {NAME}\r\n\r\n".encode())), (401, 403), where)
        for where in ("/api/files?name=x", "/api/voice", "/lodge/files", "/lodge/join"):  # a big body promised, none sent: no waiting for it
            began = time.monotonic()
            got = self.send(f"POST {where} HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 5000000\r\n\r\n".encode())
            self.assertIn(self.status(got), (401, 403), where)
            self.assertLess(time.monotonic() - began, 2)
        self.assertEqual(asked, [])  # and the room heard none of it

    def test_a_refusal_arrives_though_the_body_is_still_coming(self):
        got = self.send(f"POST /api/files HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 100000\r\n\r\n".encode() + b"x" * 100000)
        self.assertEqual(self.status(got), 403)

    def test_a_wrong_key_is_no_key(self):
        for where, extra, want in (("/api/state", "Cookie: spo=nope\r\n", 403), ("/lodge/history", "Authorization: Bearer nope\r\n", 401)):
            self.assertEqual(self.status(self.get(where, extra=extra)), want)
        began = time.monotonic()
        got = self.send(f"POST /api/files HTTP/1.1\r\nHost: {NAME}\r\nCookie: spo=nope\r\nContent-Length: 5000000\r\n\r\n".encode())
        self.assertEqual(self.status(got), 403)
        self.assertLess(time.monotonic() - began, 2)

    def test_one_kind_of_key_opens_nothing_of_the_other_kind(self):
        key, code = self.agent()
        self.assertEqual(self.status(self.get("/api/state", extra=f"Cookie: spo={key}\r\n")), 403)
        self.assertEqual(self.status(self.get("/lodge/history", extra=self.cookie())), 401)
        self.assertEqual(self.status(self.get("/lodge/history", extra=f"Authorization: Bearer {self.out.host_token}\r\n")), 401)
        self.assertEqual(self.status(self.get("/lodge/history", extra=f"Authorization: Bearer {code}\r\n")), 401)  # a join code only joins
        self.assertEqual(self.status(self.get("/lodge/connector.py", extra=f"Authorization: Bearer {code}x\r\n")), 401)

    def test_a_person_and_an_agent_who_are_in_get_through_and_a_paused_agent_still_waits(self):
        key, _ = self.agent()
        self.assertEqual(self.status(self.get("/api/state?after=0", extra=self.cookie())), 200)
        self.assertEqual(self.status(self.get("/sw.js", extra=self.cookie())), 200)
        bearer = f"Authorization: Bearer {key}\r\n"
        self.assertEqual(self.status(self.get("/lodge/history", extra=bearer)), 200)
        self.r.set_paused("helper", True)
        self.assertEqual(self.status(self.get("/lodge/messages?after=0", extra=bearer)), 200)

    def test_someone_who_is_in_can_take_their_time_uploading(self):
        path = self.path.with_name("u.sock")
        door = Door(path, lambda: self.listed, home.answers_as_room, hand_in_seconds=1)
        self.addCleanup(door.close)
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(10)
            s.connect(str(path))
            s.sendall(f"POST /api/files?name=t.bin&text= HTTP/1.1\r\nHost: {NAME}\r\nOrigin: https://{NAME}\r\n{self.cookie()}Content-Length: 12\r\n\r\n".encode())
            for _ in range(12):  # far past a stranger's whole allowance
                time.sleep(0.25)
                s.sendall(b"x")
            self.assertEqual(self.status(s.recv(65536)), 200)

    def test_a_stranger_gets_a_few_kb_and_a_few_seconds(self):
        self.assertEqual(self.status(self.send(f"POST /api/enter HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 4097\r\n\r\n".encode())), 413)
        self.assertEqual(self.status(self.send(f"GET /enter HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 1\r\n\r\n".encode())), 413)
        path = self.path.with_name("s.sock")
        door = Door(path, lambda: self.listed, home.answers_as_room, hand_in_seconds=1)
        self.addCleanup(door.close)
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(5)
            s.connect(str(path))
            s.sendall(f"POST /api/enter HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 100\r\n\r\n".encode())
            began = time.monotonic()
            try:
                for _ in range(16):
                    time.sleep(0.25)
                    s.sendall(b"x")
            except OSError:
                pass
            self.assertLess(time.monotonic() - began, 3)

    def test_strangers_filling_a_room_stop_neither_its_people_nor_another_room(self):
        path = self.path.with_name("f.sock")
        other = "other.example.com"
        both = {**self.listed, other: self.listed[NAME]}
        door = Door(path, lambda: both, lambda host, port: True, strangers=4, total=64, hand_in_seconds=3)
        self.addCleanup(door.close)
        held = []
        self.addCleanup(lambda: [s.close() for s in held])
        for _ in range(12):
            s = socket.socket(socket.AF_UNIX)
            s.connect(str(path))
            s.sendall(f"POST /api/enter HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 100\r\n\r\n".encode())
            held.append(s)
        time.sleep(0.8)
        self.path = path
        self.assertEqual(self.status(self.get()), 503)  # its strangers' places are taken
        self.assertEqual(self.status(self.get("/api/state?after=0", extra=self.cookie())), 200)  # its people don't notice
        self.assertNotEqual(self.status(self.get(host=other)), 503)
        time.sleep(3.5)
        self.assertEqual(self.status(self.get()), 200)  # and they are let go

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

    def test_a_second_key_or_another_shape_of_path_is_refused(self):
        for raw in (f"GET /api/state HTTP/1.1\r\nHost: {NAME}\r\nCookie: spo=a\r\nCookie: spo=b\r\n\r\n",
                    f"GET //api/state HTTP/1.1\r\nHost: {NAME}\r\n\r\n", f"GET http://127.0.0.1/api/state HTTP/1.1\r\nHost: {NAME}\r\n\r\n"):
            self.assertEqual(self.status(self.send(raw.encode())), 400)

    def other_door(self, name, is_room=lambda host, port: True, **kw):
        path = self.path.with_name(name)
        door = Door(path, lambda: self.listed, is_room, **kw)
        self.addCleanup(door.close)
        self.path = path
        return door

    def hold(self, raw, times):
        held = []
        self.addCleanup(lambda: [s.close() for s in held])
        for _ in range(times):
            s = socket.socket(socket.AF_UNIX)
            s.settimeout(10)
            s.connect(str(self.path))
            s.sendall(raw.encode())
            held.append(s)
        return held

    def test_strangers_dont_shut_members_out_of_the_page(self):
        self.other_door("p.sock", strangers=2)
        self.hold(f"POST /api/enter HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 100\r\n\r\n", 4)
        time.sleep(0.5)
        self.assertEqual(self.status(self.get("/")), 503)  # the strangers' places are full
        for where in ("/", "/index.html", "/enter"):
            self.assertEqual(self.status(self.get(where, extra=self.cookie())), 200, where)

    def test_an_old_cookie_still_gets_the_join_page(self):
        self.assertEqual(self.status(self.get("/", extra="Cookie: spo=from-before\r\n")), 200)

    def test_a_hung_room_fills_only_its_own_share_of_the_door(self):
        hung = threading.Event()
        self.addCleanup(hung.set)
        other = "other.example.com"
        self.listed = {**self.listed, other: self.listed[NAME]}
        self.other_door("h2.sock", lambda host, port: host == other or not hung.wait(4), each_name=6, checks=2, total=20)
        self.hold(f"GET /api/state HTTP/1.1\r\nHost: {NAME}\r\nCookie: spo=junk\r\n\r\n", 60)
        time.sleep(0.5)
        self.assertNotEqual(self.status(self.get(host=other)), 503)

    def test_a_room_that_couldnt_be_asked_is_never_a_no(self):
        self.other_door("a.sock", takes=lambda *a: None)
        for where, extra in (("/lodge/messages", "Authorization: Bearer k\r\n"), ("/api/state", "Cookie: spo=k\r\n"), ("/", "Cookie: spo=k\r\n")):
            self.assertEqual(self.status(self.get(where, extra=extra)), 503, where)

    def test_the_rooms_own_trouble_is_not_a_no(self):
        from shellphone.door import room_takes
        class Broken(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass
            def do_GET(self):
                self.send_response(500)
                self.end_headers()
        broken = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Broken)
        threading.Thread(target=broken.serve_forever, daemon=True).start()
        self.addCleanup(broken.server_close)
        self.addCleanup(broken.shutdown)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            closed = s.getsockname()[1]
        for port in (broken.server_address[1], closed):
            for agent in (True, False):
                self.assertIsNone(room_takes(NAME, port, b"k", agent))
        for agent in (True, False):
            self.assertIs(room_takes(NAME, self.server.server_address[1], b"k", agent), False)

    def test_too_slow_is_said(self):
        self.other_door("l.sock", hand_in_seconds=1)
        s = self.hold(f"POST /api/enter HTTP/1.1\r\nHost: {NAME}\r\nContent-Length: 100\r\n\r\n", 1)[0]
        self.assertEqual(self.status(s.recv(65536)), 408)

    def test_one_key_cant_fill_its_room(self):
        self.other_door("k.sock", each_key=3, inside=6)
        key, _ = self.agent()
        self.hold(f"POST /lodge/files?name=x HTTP/1.1\r\nHost: {NAME}\r\nAuthorization: Bearer {key}\r\nContent-Length: 1000\r\n\r\n", 8)
        time.sleep(1)
        self.assertEqual(self.status(self.get("/lodge/history", extra=f"Authorization: Bearer {key}\r\n")), 503)
        self.assertEqual(self.status(self.get("/api/state?after=0", extra=self.cookie())), 200)

    def test_the_key_is_read_as_the_room_reads_it(self):
        self.assertEqual(self.status(self.get("/api/state?after=0", extra=f"Cookie: a=b;\xa0spo={self.out.host_token}\r\n")), 200)

    def test_only_one_door_at_a_time(self):
        with self.assertRaises(SystemExit):
            Door(self.path, lambda: self.listed, home.answers_as_room)


if __name__ == "__main__":
    unittest.main()
