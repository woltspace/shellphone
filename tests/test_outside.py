"""A room linked through a tunnel of its own (shellphone/outside.py): who gets in by which key, what an unlink leaves
behind, and where an agent's calls may go. No tunnel, no site and no network: stand-ins for both."""
import hashlib, hmac, http.client, http.server, json, os, re, socket, subprocess, sys, tempfile, threading, types, unittest, urllib.error
from pathlib import Path
from unittest.mock import patch

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from shellphone import cli
from shellphone.outside import FILE, OWED, Outside

HOST = "room-under-test.trycloudflare.com"


class Door(unittest.TestCase):
    """The room's own door, asked over HTTP as a tunnel would pass requests on: on this computer, under the tunnel's name."""

    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen([sys.executable, str(REPO / "tests" / "outside_room.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                    env={**os.environ, "PYTHONPATH": str(REPO), "PYTHONUNBUFFERED": "1"})
        cls.keys = json.loads(cls.proc.stdout.readline())

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.communicate(timeout=10)

    def ask(self, method, path, host=HOST, cookie=None, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.keys["port"], timeout=10)
        h = {"Host": host, **({"Cookie": cookie} if cookie else {}), **({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})}
        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
        res = conn.getresponse()
        raw = res.read()
        conn.close()
        try:
            return res.status, json.loads(raw), res.getheader("Set-Cookie") or ""
        except ValueError:
            return res.status, raw.decode(errors="replace"), res.getheader("Set-Cookie") or ""

    def enter(self, **body):
        status, out, cookie = self.ask("POST", "/api/enter", body=body)
        return status, out, cookie.split(";")[0]

    def test_nobody_without_a_key_gets_anything_of_the_room(self):
        for method, path in (("GET", "/api/state"), ("POST", "/api/messages"), ("POST", "/api/voice"), ("POST", "/api/files?name=a.txt"), ("GET", "/join"), ("GET", "/files/" + "0" * 32 + ".txt"), ("POST", "/api/link")):
            self.assertEqual(self.ask(method, path, body={} if method == "POST" else None)[0], 403, path)
        self.assertEqual(self.ask("GET", "/lodge/messages")[0], 401)
        self.assertEqual(self.ask("GET", "/lodge/messages", headers={"Authorization": "Bearer made-up"})[0], 401)
        status, page, _ = self.ask("GET", "/")  # the page that takes a key from the link: it holds nothing of the room
        self.assertEqual(status, 200)
        self.assertIn("Opening the room", page)
        self.assertNotIn("Hostess", page)

    def test_the_hosts_own_link_lets_the_host_in_from_outside_but_not_at_the_switch(self):
        status, _, cookie = self.enter(k=self.keys["host"])
        self.assertEqual(status, 200)
        self.assertEqual(self.ask("GET", "/api/state", cookie=cookie)[1]["me"], cli.HOST_EMAIL)
        self.assertEqual(self.ask("GET", "/api/link", cookie=cookie)[0], 403)  # linking and unlinking stay on the room's own computer
        self.assertEqual(self.ask("POST", "/api/link", cookie=cookie, body={"on": False})[0], 403)
        self.assertEqual(self.ask("POST", "/api/messages", cookie=cookie, body={"text": "x"}, headers={"Sec-Fetch-Site": "cross-site"})[0], 403)  # another site's page can't post as the host
        self.assertEqual(self.ask("POST", "/api/messages", cookie=cookie, body={"text": "from outside"})[0], 200)

    def test_the_cookie_is_kept_from_scripts_and_other_sites(self):
        _, _, cookie = self.ask("POST", "/api/enter", body={"k": self.keys["host"]})
        for part in ("HttpOnly", "Secure", "SameSite=Lax"):
            self.assertIn(part, cookie)

    def test_the_key_of_this_computer_opens_nothing_from_outside(self):
        local = self.keys["local"]
        self.assertEqual(self.ask("GET", "/api/state?k=" + local)[0], 403)
        self.assertEqual(self.ask("GET", "/api/state", cookie=f"sp{self.keys['port']}={local}")[0], 403)
        self.assertEqual(self.ask("GET", "/api/state", cookie=f"spo={local}")[0], 403)
        self.assertEqual(self.enter(k=local)[0], 403)
        self.assertEqual(self.ask("GET", "/api/state?k=" + local, headers={"X-Forwarded-Host": "127.0.0.1", "Forwarded": "host=127.0.0.1"})[0], 403)
        self.assertEqual(self.ask("GET", "/api/state", headers={"Cf-Access-Authenticated-User-Email": cli.HOST_EMAIL})[0], 403)
        self.assertEqual(self.ask("GET", "/api/state", host="127.0.0.1", cookie=f"spo={self.keys['host']}")[0], 403)  # and the outside key opens nothing as "this computer"
        self.assertEqual(self.ask("GET", "/api/state", host="another-name.trycloudflare.com", cookie=f"spo={self.keys['host']}")[0], 403)

    def test_the_invite_makes_a_guest_with_a_key_of_their_own(self):
        self.assertEqual(self.enter(i="made-up-invite-made-up", name="x")[0], 403)
        self.assertEqual(self.enter(i=self.keys["invite"], name="")[0], 400)
        status, out, cookie = self.enter(i=self.keys["invite"], name="Guesty")
        self.assertEqual(status, 200)
        self.assertEqual(cookie, "spo=" + out["mine"])
        me = self.ask("GET", "/api/state", cookie=cookie)[1]["me"]
        self.assertTrue(me.startswith("guest-"))
        self.assertEqual(self.enter(k=out["mine"])[0], 200)  # their own key lets them back in, as the same guest
        self.assertEqual(self.ask("GET", "/api/state", cookie="spo=" + self.keys["invite"])[0], 403)  # the invite itself is nobody
        listed = {p["email"]: p for p in self.ask("GET", "/api/state", cookie=cookie)[1]["members"]["people"]}
        self.assertTrue(listed[me].get("guest"))  # and they are marked as a guest, to everyone

    def test_the_site_is_answered_only_with_proof_it_asked_for(self):
        n = "ab" * 16
        status, out, _ = self.ask("GET", "/api/up?n=" + n)
        check = hashlib.sha256(b"shellphone-check\0synthetic-room\0synthetic-secret").hexdigest()
        self.assertEqual((status, out["room"], out["proof"]), (200, "synthetic-room", hmac.new(check.encode(), n.encode(), hashlib.sha256).hexdigest()))
        self.assertEqual(self.ask("GET", "/api/up")[1]["proof"], "")
        self.assertEqual(self.ask("GET", "/api/up?n=not-a-number")[1]["proof"], "")
        self.assertEqual(self.ask("GET", "/api/up?n=" + n, host="127.0.0.1")[0], 403)  # not a question this computer's own page asks

    def test_an_agent_joins_through_the_link_and_one_from_this_computer_stays_there(self):
        _, _, cookie = self.enter(k=self.keys["host"])
        page = self.ask("GET", "/join", cookie=cookie)[1]
        code = page.split("#a.")[1].split("'")[0].split("&")[0]
        self.assertIn("https://site.example/t/synthetic-room#a.", page)  # the message names the lasting address, never the tunnel's
        self.assertNotIn(HOST, page)
        status, out, _ = self.ask("POST", "/lodge/join", body={"wolt": "away"}, headers={"Authorization": "Bearer " + code})
        self.assertEqual(status, 200)
        away = {"Authorization": "Bearer " + out["key"]}
        self.assertEqual(self.ask("GET", "/lodge/messages", headers=away)[0], 200)
        self.assertEqual(self.ask("POST", "/lodge/join", body={"wolt": "again"}, headers={"Authorization": "Bearer " + code})[0], 401)  # the code worked once
        status, out, _ = self.ask("POST", "/lodge/join", host="127.0.0.1", body={"wolt": "homebody"}, headers={"Authorization": "Bearer " + self.keys["code"]})
        self.assertEqual(status, 200)
        home = {"Authorization": "Bearer " + out["key"]}
        self.assertEqual(self.ask("GET", "/lodge/messages", host="127.0.0.1", headers=home)[0], 200)
        self.assertEqual(self.ask("GET", "/lodge/messages", headers=home)[0], 401)  # its key is for this computer


class AfterUnlink(unittest.TestCase):
    def test_every_key_that_was_handed_out_is_dead_and_the_room_goes_on_here(self):
        proc = subprocess.Popen([sys.executable, str(REPO / "tests" / "outside_room.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                env={**os.environ, "PYTHONPATH": str(REPO), "PYTHONUNBUFFERED": "1"})
        try:
            keys = json.loads(proc.stdout.readline())

            def ask(method, path, host=HOST, headers=None, body=None):
                conn = http.client.HTTPConnection("127.0.0.1", keys["port"], timeout=10)
                conn.request(method, path, body=json.dumps(body) if body is not None else None, headers={"Host": host, **({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})})
                res = conn.getresponse()
                raw = res.read()
                conn.close()
                return res.status, raw
            host = {"Cookie": "spo=" + keys["host"]}
            self.assertEqual(ask("GET", "/api/state", headers=host)[0], 200)
            code = ask("GET", "/join", headers=host)[1].decode().split("#a.")[1].split("'")[0].split("&")[0]
            agent = {"Authorization": "Bearer " + json.loads(ask("POST", "/lodge/join", body={"wolt": "away"}, headers={"Authorization": "Bearer " + code})[1])["key"]}
            self.assertEqual(ask("GET", "/lodge/messages", headers=agent)[0], 200)
            proc.stdin.write("unlink\n"); proc.stdin.flush()
            self.assertEqual(proc.stdout.readline().strip(), "unlinked")
            self.assertEqual(ask("GET", "/api/state", headers=host)[0], 403)
            self.assertEqual(ask("POST", "/api/enter", body={"k": keys["host"]})[0], 403)
            self.assertEqual(ask("POST", "/api/enter", body={"i": keys["invite"], "name": "x"})[0], 403)
            self.assertEqual(ask("GET", "/lodge/messages", headers=agent)[0], 401)
            self.assertEqual(ask("GET", "/api/state", host="127.0.0.1", headers={"Cookie": f"sp{keys['port']}={keys['local']}"})[0], 200)  # the room itself, on its own computer, is as it was
        finally:
            proc.terminate()
            proc.communicate(timeout=10)


def room(td, tell):
    o = Outside(None, Path(td), True, "https://site.example", 1, "host")
    o.room, o.secret, o.host_token, o.invite_token = "synthetic-room", "synthetic-secret", "h", "i"
    o._tell, o._keep_telling = tell, lambda: None
    (Path(td) / FILE).write_text("{}")
    return o


class Unlink(unittest.TestCase):
    """What the site has still to be told is never lost without saying so."""

    def test_told_at_once_when_the_site_is_there(self):
        with tempfile.TemporaryDirectory() as td:
            status, info = room(td, lambda *a, **kw: None).off()
            self.assertEqual((status, info.get("note")), (200, None))
            self.assertFalse((Path(td) / OWED).exists() or (Path(td) / FILE).exists())

    def test_written_down_and_said_while_the_site_cant_be_told_then_told_by_the_next_run(self):
        with tempfile.TemporaryDirectory() as td:
            o = room(td, lambda *a, **kw: "site unreachable")
            status, info = o.off()
            self.assertEqual(status, 200)
            self.assertIn("couldn't be told yet", info["note"])
            self.assertNotIn("written down", info["note"])
            self.assertIn("couldn't be told yet", o.info()["note"])  # for as long as it is true, wherever the host looks
            self.assertEqual(json.loads((Path(td) / OWED).read_text())[0]["room"], "synthetic-room")
            self.assertEqual(oct(os.stat(Path(td) / OWED).st_mode)[-3:], "600")
            o2 = room(td, lambda *a, **kw: None)
            o2.room = o2.secret = None
            self.assertEqual(o2._settle(), (0, True))
            self.assertFalse((Path(td) / OWED).exists())
            self.assertNotIn("note", o2.info())

    def test_it_is_written_down_before_the_kept_keys_go(self):
        with tempfile.TemporaryDirectory() as td:
            o, seen, real = room(td, lambda *a, **kw: "site unreachable"), {}, Path.unlink

            def dying(self, *a, **kw):
                if self.name == FILE:
                    seen["owed"] = (Path(td) / OWED).exists() and json.loads((Path(td) / OWED).read_text())[0]["room"]
                    raise SystemExit("the process stops here")
                return real(self, *a, **kw)
            with patch.object(Path, "unlink", dying), self.assertRaises(SystemExit):
                o.off()
            self.assertEqual(seen, {"owed": "synthetic-room"})

    def test_when_nothing_can_be_written_it_says_so_and_remembers_while_open(self):
        with tempfile.TemporaryDirectory() as td:
            o = room(td, lambda *a, **kw: "site unreachable")
            with patch.object(cli, "replace_private", side_effect=OSError("disk full")):
                status, info = o.off()
                self.assertEqual(status, 200)
                self.assertIn("couldn't be written down", info["note"])
                self.assertEqual(len(o._unwritten), 1)
            self.assertFalse((Path(td) / FILE).exists())
            self.assertIsNone(o.who("h"))
            told = []
            o._tell = lambda *a, **kw: told.append(kw) or None
            self.assertEqual(o._settle(), (0, True))
            self.assertEqual((told[0]["room"], told[0]["gone"], o._unwritten), ("synthetic-room", True, []))

    def test_keys_that_cant_be_removed_are_reported_and_open_nothing_meanwhile(self):
        with tempfile.TemporaryDirectory() as td:
            o = room(td, lambda *a, **kw: None)
            with patch.object(Path, "unlink", side_effect=OSError("read-only")):
                status, info = o.off()
            self.assertEqual(status, 500)
            self.assertIn("delete that file yourself", info["error"])
            self.assertIsNone(o.who("h"))


class Elsewhere(http.server.BaseHTTPRequestHandler):
    """Sends whoever asks on to another server, which notes what it was shown."""
    seen, to = [], ""

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        code = re.search(r"c=(30[12378])$", self.path)
        self.send_response(int(code.group(1)) if code else 302)
        self.send_header("Location", Elsewhere.to)
        self.send_header("Content-Length", "0")
        self.end_headers()
    do_GET = do_POST

    def log_message(self, *a):
        pass


class Sink(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        Elsewhere.seen.append(self.headers.get("Authorization"))
        self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"{}")
    do_POST = do_GET

    def log_message(self, *a):
        pass


class Secrets(unittest.TestCase):
    """A call that carries a secret goes where it was sent, and nowhere it is sent on to."""

    @classmethod
    def setUpClass(cls):
        cls.sink, cls.redirect = http.server.HTTPServer(("127.0.0.1", 0), Sink), http.server.HTTPServer(("127.0.0.1", 0), Elsewhere)
        Elsewhere.to = f"http://127.0.0.1:{cls.sink.server_port}/capture"
        for s in (cls.sink, cls.redirect):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.redirect.server_port}"

    @classmethod
    def tearDownClass(cls):
        for s in (cls.sink, cls.redirect):
            s.shutdown(); s.server_close()

    def setUp(self):
        Elsewhere.seen.clear()

    def test_the_rooms_secret_is_not_sent_on_after_a_redirect(self):
        for code in (301, 302, 303, 307, 308):
            o = Outside(None, Path(tempfile.gettempdir()), False, self.base, 1, "host")
            o.room, o.secret = f"synthetic-room?c={code}", "synthetic-review-only"
            self.assertIn(str(code), o._tell("https://example.trycloudflare.com"))
        self.assertEqual(Elsewhere.seen, [])

    def test_an_agents_key_is_not_sent_on_whichever_call_comes_first(self):
        import urllib.request
        for first in ("upload", "call"):
            urllib.request.install_opener(urllib.request.build_opener())  # as a fresh process starts
            conn = cli.connector()
            cfg = {"room_url": self.base, "sign": "https://site.example/t/id", "key": "synthetic-key"}
            with tempfile.TemporaryDirectory() as td, patch.object(cli, "where", lambda sign: None):
                (Path(td) / "note.txt").write_text("synthetic only")
                with self.assertRaises(urllib.error.HTTPError):
                    conn.upload(cfg, [str(Path(td) / "note.txt")]) if first == "upload" else conn.call(cfg, "POST", "/lodge/messages", {"text": "x"})
            self.assertEqual(Elsewhere.seen, [], first)

    def test_where_a_room_is_said_to_be_is_only_believed_when_it_is_a_quick_tunnel(self):
        answers = {}

        class Site(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps({"known": True, "url": answers["url"]}).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

            def log_message(self, *a):
                pass
        site = http.server.HTTPServer(("127.0.0.1", 0), Site)
        threading.Thread(target=site.serve_forever, daemon=True).start()
        try:
            sign = f"http://127.0.0.1:{site.server_port}/t/id"
            for url, believed in (("https://calm-river-four-words.trycloudflare.com", True), ("http://127.0.0.1:4090", True), ("https://example.com", False),
                                  ("https://evil.example/x.trycloudflare.com", False), ("https://a.trycloudflare.com.evil.example", False), ("http://a-b.trycloudflare.com", False),
                                  ("https://a-b.trycloudflare.com/path", False), (None, False)):
                answers["url"] = url
                self.assertEqual(cli.where(sign), url if believed else None, url)
            self.assertIsNone(cli.where(self.base + "/t/id"))  # the site itself sending the question elsewhere: not followed
            self.assertEqual(Elsewhere.seen, [])
        finally:
            site.shutdown(); site.server_close()


class Moved(unittest.TestCase):
    """A room behind a lasting address moves. What only reads is asked again at the new address; what changes the
    room is sent again only when the first try certainly never left this computer."""

    def attempt(self, method, failure):
        sent = []

        def direct(cfg, *a):
            sent.append(cfg["room_url"])
            if len(sent) == 1:
                raise failure
            return {"ok": True}
        with patch.object(cli, "part", lambda name: types.SimpleNamespace(call=direct, upload=lambda *a: None)), patch.object(cli, "where", lambda sign: "https://new.trycloudflare.com"):
            conn = cli.connector()
            try:
                conn.call({"sign": "https://site.example/t/id", "room_url": "https://old.trycloudflare.com"}, method, "/lodge/messages", {"text": "synthetic"})
                return "again", sent
            except SystemExit as e:
                self.assertIn("may or may not have arrived", str(e))
                return "unsure", sent
            except urllib.error.URLError:
                return "failed", sent

    def test_which_failures_are_tried_again(self):
        gone = lambda: urllib.error.HTTPError("https://old.trycloudflare.com", 530, "x", {}, None)
        for method, failure, want, times in (
                ("GET", gone(), "again", 2), ("POST", gone(), "unsure", 1),
                ("POST", urllib.error.HTTPError("https://old.trycloudflare.com", 502, "x", {}, None), "failed", 1),
                ("POST", urllib.error.URLError(socket.gaierror(8, "no such name")), "again", 2), ("POST", urllib.error.URLError(ConnectionRefusedError()), "again", 2),
                ("POST", urllib.error.URLError(TimeoutError("timed out")), "unsure", 1), ("GET", urllib.error.URLError(TimeoutError("timed out")), "again", 2)):
            got, sent = self.attempt(method, failure)
            self.assertEqual((got, len(sent)), (want, times), (method, failure))
            if want != "failed":
                self.assertEqual(sent[-1] if times == 2 else None, "https://new.trycloudflare.com" if times == 2 else None)


if __name__ == "__main__":
    unittest.main()
