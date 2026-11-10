"""The pipe: the host's side on its own, the page's side under node, and (when asked) both through a real local relay.

    uv run --with cryptography --with websockets python -m unittest tests.test_pipe
    RELAY_E2E=1 …   also starts the relay with `npx wrangler dev --local` and a shared room, and talks through them
"""
import http.cookiejar, json, os, re, shutil, signal, subprocess, sys, tempfile, time, unittest, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
try:
    from shellphone import pipe, seal  # noqa: E402
except ImportError as missing:
    raise unittest.SkipTest(f"the pipe tests need the cryptography package ({missing})")

NODE, NPX = shutil.which("node"), shutil.which("npx")
ROOM, SECRET = bytes(range(1, 17)), bytes(range(7, 39))


class Client:
    """A client as the page would be: handshake, then numbered requests."""
    def __init__(self, hostpipe, secret=SECRET):
        self.pipe, c = hostpipe, seal.Client(ROOM, secret)
        (hello,) = hostpipe.feed(c.hi())
        self.session, self.n = c.hello(hello), 0

    def ask(self, method="GET", path="/api/state", body=None, auth="tok", **fields):
        self.n += 1
        out = [self.session.open(f) for f in self.pipe.feed(self.session.seal({"t": "req", "id": self.n, "method": method, "path": path, "body": body, "auth": auth, **fields}))]
        if len(out) > 1:  # a long answer in parts: put it back together as the page does
            assert [(p["t"], p["id"], p["part"], p["of"]) for p in out] == [("res", self.n, i, len(out)) for i in range(len(out))], out
            return {"t": "res", "id": self.n, **json.loads("".join(p["chunk"] for p in out))}
        return out[0] if out else None


class HostSide(unittest.TestCase):
    def make(self, answer=None, clock=time.monotonic):
        self.calls = []

        def default(kind, method, path, body, auth):
            self.calls.append((kind, method, path, body, auth))
            return 200, {"path": path}
        return pipe.HostPipe(ROOM, {"h": SECRET}, answer or default, clock)

    def test_a_request_reaches_the_room_and_its_answer_comes_back(self):
        c = Client(self.make())
        self.assertEqual(c.ask("POST", "/api/messages", {"text": "hi", "cid": "c1"}), {"t": "res", "id": 1, "status": 200, "body": {"path": "/api/messages"}})
        self.assertEqual(self.calls, [("h", "POST", "/api/messages", {"text": "hi", "cid": "c1"}, "tok")])
        self.assertEqual(c.ask()["id"], 2)

    def test_a_request_number_is_used_once(self):
        c = Client(self.make())
        c.ask()
        for stale in (1, 0, -3):
            c.n = stale - 1
            self.assertIsNone(c.ask())
        self.assertEqual(len(self.calls), 1)
        c.n = 5
        self.assertEqual(c.ask()["id"], 6)

    def test_what_isnt_a_proper_request_never_reaches_the_room(self):
        c = Client(self.make())
        self.assertEqual(c.ask("DELETE")["status"], 400)
        self.assertEqual(c.ask(path="api/state")["status"], 400)
        self.assertEqual(c.ask(path="/" + "x" * 3000)["status"], 400)
        self.assertEqual(c.ask(auth=None)["status"], 403)
        self.assertEqual(c.ask("POST", "/api/messages", {"text": "x" * 40_000})["status"], 413)
        self.assertEqual(self.calls, [])
        for junk in ({"t": "res", "id": 99}, {"id": 100}, ["req"], "req", {"t": "req", "id": "101"}, {"t": "req", "id": True}):
            fresh = Client(self.make())  # each on its own connection: a few of these in a row get a client turned away
            self.assertEqual(fresh.pipe.feed(fresh.session.seal(junk)), [])
            self.assertEqual(self.calls, [])

    def test_a_long_answer_goes_out_in_parts_that_each_fit_the_relay(self):
        history = [{"n": i, "text": ("héllo 🐚 " * 1000)[:8000]} for i in range(7)]  # a room with seven long messages
        c = Client(self.make(lambda *_: (200, {"messages": history})))
        frames = c.pipe.feed(c.session.seal({"t": "req", "id": 1, "method": "GET", "path": "/api/state", "body": None, "auth": "tok"}))
        self.assertGreater(len(frames), 1)
        for frame in frames:
            self.assertLess(len(json.dumps({"to": "0123456789abcdef", "data": frame})), 64 * 1024)  # what the relay carries
        c2 = Client(self.make(lambda *_: (200, {"messages": history})))
        self.assertEqual(c2.ask(), {"t": "res", "id": 1, "status": 200, "body": {"messages": history}})
        small = Client(self.make(lambda *_: (200, {"ok": True})))
        self.assertEqual(len(small.pipe.feed(small.session.seal({"t": "req", "id": 1, "method": "GET", "path": "/", "body": None, "auth": "t"}))), 1)

    def test_an_answer_too_long_to_send_is_refused_plainly(self):
        c = Client(self.make(lambda *_: (200, {"blob": "x" * (pipe.MAX_ANSWER + 1)})))
        self.assertEqual(c.ask(), {"t": "res", "id": 1, "status": 502, "body": {"error": "too much to send at once"}})

    def test_a_full_length_message_in_any_script_fits_a_request(self):
        c = Client(self.make())
        self.assertEqual(c.ask("POST", "/api/messages", {"text": "🐚" * 8000, "cid": "c1"})["status"], 200)

    def test_a_client_sending_rubbish_is_turned_away(self):
        hp = self.make()
        for _ in range(pipe.MAX_BAD - 1):
            self.assertEqual(hp.feed("h.AAAA"), [])
        with self.assertRaises(pipe.Closed):
            hp.feed("not even a frame")
        c = Client(self.make())
        for _ in range(pipe.MAX_BAD - 1):
            self.assertEqual(c.pipe.feed("AAAA"), [])
        with self.assertRaises(pipe.Closed):
            c.pipe.feed(c.session.seal({"t": "req", "id": 1}) + "x")

    def test_a_key_the_room_doesnt_know_gets_no_answer(self):
        hp = self.make()
        self.assertEqual(hp.feed(seal.Client(ROOM, bytes(32)).hi()), [])
        self.assertEqual(hp.feed(seal.Client(ROOM, SECRET, "i").hi()), [])  # this room has no invite link
        self.assertEqual(Client(hp).ask()["status"], 200)  # the real one still gets in on the same connection

    def test_a_client_asking_too_fast_is_told_to_slow_down(self):
        now = [0.0]
        c = Client(self.make(clock=lambda: now[0]))
        got = [c.ask()["status"] for _ in range(pipe.BURST + 3)]
        self.assertEqual(got, [200] * pipe.BURST + [429] * 3)
        now[0] += 1
        self.assertEqual([c.ask()["status"] for _ in range(pipe.PER_SECOND + 1)], [200] * pipe.PER_SECOND + [429])

    def test_the_rooms_own_failure_is_a_plain_500(self):
        def broken(*_):
            raise RuntimeError("secret detail")
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()):
            got = Client(self.make(broken)).ask()
        self.assertEqual((got["status"], got["body"]), (500, {"error": "the room couldn't answer"}))


@unittest.skipUnless(NODE, "node isn't installed: the page's side isn't checked here")
class PageSide(unittest.TestCase):
    def test_the_pages_pipe_passes_its_own_tests(self):
        got = subprocess.run([NODE, "--test", str(REPO / "web" / "tests" / "pipe.test.mjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(got.returncode, 0, got.stdout[-3000:] + got.stderr[-2000:])


def free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_relay(*variables):
    """The relay on this computer, in Cloudflare's local simulator, with these settings (NAME:value)."""
    port = free_port()
    proc = subprocess.Popen([NPX, "-y", "wrangler@latest", "dev", "--local", "--port", str(port), *[x for v in variables for x in ("--var", v)]],
                            cwd=REPO / "relay", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    base, end = f"http://127.0.0.1:{port}", time.time() + 90
    while time.time() < end:
        try:
            urllib.request.urlopen(base + "/r/" + "A" * 22 + "/up", timeout=2)
            return proc, base
        except urllib.error.HTTPError:
            return proc, base  # it answers, even if only to say it's switched off
        except OSError:
            time.sleep(1)
    stop_relay(proc)
    raise AssertionError("the relay didn't start")


def stop_relay(proc):
    os.killpg(proc.pid, signal.SIGTERM)
    proc.communicate(timeout=20)


E2E = unittest.skipUnless(NODE and NPX and os.environ.get("RELAY_E2E"), "set RELAY_E2E=1 (needs node and npx) to run the relay on this computer and talk through it")


def host_status(base, key=""):
    """What the relay says to a host trying to open a room (the HTTP status of the websocket request)."""
    from websockets.sync.client import connect
    try:
        with connect(base.replace("http", "ws", 1) + "/r/" + seal.b64e(os.urandom(16)) + "/host", additional_headers={"Authorization": f"Bearer {key}"} if key else {}, open_timeout=10):
            return 101
    except Exception as exc:
        return getattr(getattr(exc, "response", None), "status_code", repr(exc))


@E2E
class RelaySettings(unittest.TestCase):
    def relay(self, *variables):
        proc, base = start_relay(*variables)
        self.addCleanup(stop_relay, proc)
        return base

    def test_with_no_key_set_nobody_can_host(self):
        base = self.relay()
        self.assertEqual(host_status(base), 401)
        self.assertEqual(host_status(base, "anything"), 401)
        self.assertEqual(host_status(base, ""), 401)

    def test_hosting_is_opened_to_everyone_only_on_purpose(self):
        self.assertEqual(host_status(self.relay("OPEN_HOSTING:1")), 101)

    def test_switched_off_means_nothing_is_served_or_carried(self):
        base = self.relay("RELAY_OFF:1", "HOST_KEY:k")
        self.assertEqual(host_status(base, "k"), 503)
        for path in ("/r/" + "A" * 22 + "/up", "/r/" + "A" * 22):
            with self.assertRaises(urllib.error.HTTPError) as refused:
                urllib.request.urlopen(base + path)
            self.assertEqual(refused.exception.code, 503)


@E2E
class ThroughTheRelay(unittest.TestCase):
    """A real relay (Cloudflare's local simulator), a real shared room, and the page's pipe under node."""
    @classmethod
    def setUpClass(cls):
        cls.port, cls.tmp = free_port(), tempfile.TemporaryDirectory()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.relay, cls.base = start_relay("HOST_KEY:test-host-key")

    @classmethod
    def tearDownClass(cls):
        stop_relay(cls.relay)
        cls.tmp.cleanup()

    def setUp(self):
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            if p.poll() is None:
                p.kill()
            p.communicate()

    def link(self, secret=None):
        self.room, self.secret, self.token = os.urandom(16), secret or os.urandom(32), "tok-" + os.urandom(18).hex()
        return f"{self.base}/r/{seal.b64e(self.room)}#h.{seal.b64e(self.secret)}.{self.token}"

    def host(self, link, key="test-host-key", wait_for="shellphone room is up"):
        env = {**os.environ, "PYTHONPATH": str(REPO), "PYTHONUNBUFFERED": "1", "SHELLPHONE_RELAY_KEY": key}
        p = subprocess.Popen([sys.executable, "-m", "shellphone.cli", "host", link, "--port", "0", "--name", "Sam"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
        self.procs.append(p)
        seen = ""
        while "Stop it (Ctrl-C)" not in seen:
            line = p.stdout.readline()
            if not line:
                break
            seen += line
        self.assertIn(wait_for, seen)
        return p, seen

    def page(self, link, **options):
        p = subprocess.Popen([NODE, str(REPO / "web" / "tests" / "pipe_cli.mjs")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.procs.append(p)

        def ask(**cmd):
            p.stdin.write(json.dumps(cmd) + "\n")
            p.stdin.flush()
            return json.loads(p.stdout.readline())
        ask(cmd="open", link=link, options={"waits": [300], **options})
        return ask

    def up(self):
        return json.load(urllib.request.urlopen(f"{self.base}/r/{seal.b64e(self.room)}/up"))["up"]

    def test_a_page_talks_to_a_room_on_this_computer_through_the_relay(self):
        link = self.link()
        self.assertFalse(self.up())
        host, banner = self.host(link)
        self.assertTrue(self.up())
        ask = self.page(link)
        state = ask(cmd="request", method="GET", path="/api/state?after=0")
        self.assertEqual((state["status"], state["body"]["me"], [p["name"] for p in state["body"]["members"]["people"]]), (200, "host@shellphone.local", ["Sam"]))
        said = ask(cmd="request", method="POST", path="/api/messages", body={"text": "through the relay 🐚", "cid": "abcd1234"})
        self.assertEqual(said["status"], 200)
        again = ask(cmd="request", method="POST", path="/api/messages", body={"text": "through the relay 🐚", "cid": "abcd1234"})
        self.assertEqual(again["body"]["id"], said["body"]["id"])  # the room knows this message by its name: not doubled
        # the room has it, seen from this computer's own door
        local = re.search(r"join '(http://127[^#']+)/#", banner).group(1)
        browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        browser.open(f"{local}/?k={self.token}")
        texts = [m.get("text") for m in json.load(browser.open(local + "/api/state"))["messages"] if m["kind"] == "human"]
        self.assertEqual(texts, ["through the relay 🐚"])
        # nothing readable crossed the relay
        for frame in ask(cmd="wire")["wire"]:
            for plain in ("through the relay", self.token, "/api/", "Sam", seal.b64e(self.secret)):
                self.assertNotIn(plain, frame)
        # what the relay doesn't offer isn't reachable
        self.assertEqual(ask(cmd="request", method="GET", path="/api/push")["status"], 404)
        # the host goes away: the page is told, and the relay says so too
        host.send_signal(signal.SIGINT)
        self.assertIn("Room closed and deleted.", host.communicate(timeout=15)[0])
        self.assertEqual(ask(cmd="wait", state="offline")["state"], "offline")
        self.assertFalse(self.up())
        self.assertEqual(ask(cmd="states")["states"][:3], ["connecting", "open", "offline"])

    def test_a_room_full_of_long_messages_still_loads(self):
        link = self.link()
        self.host(link)
        ask = self.page(link)
        long = [(f"message {i} " + "héllo 🐚 " * 1000)[:7990] + "." for i in range(7)]  # more than one relay frame can carry
        for i, text in enumerate(long):
            self.assertEqual(ask(cmd="request", method="POST", path="/api/messages", body={"text": text, "cid": f"long{i:04d}"})["status"], 200)
        for _ in range(2):  # and again: nothing was knocked over by the first long answer
            state = ask(cmd="request", method="GET", path="/api/state?after=0")
            self.assertEqual([m["text"] for m in state["body"]["messages"] if m["kind"] == "human"], long)
        self.assertEqual(ask(cmd="states")["states"], ["connecting", "open"])  # the room never dropped

    def test_the_room_comes_back_after_the_host_restarts(self):
        link = self.link()
        host, _ = self.host(link)
        ask = self.page(link)
        self.assertEqual(ask(cmd="request", method="GET", path="/api/state")["status"], 200)
        host.send_signal(signal.SIGINT)
        host.communicate(timeout=15)
        self.assertEqual(ask(cmd="wait", state="offline")["state"], "offline")
        self.host(link)  # a fresh room behind the same link (the first was deleted)
        self.assertEqual(ask(cmd="wait", state="open")["state"], "open")
        self.assertEqual(ask(cmd="request", method="GET", path="/api/state")["body"]["messages"], [])

    def test_only_the_links_own_key_gets_in(self):
        link = self.link()
        self.host(link)
        wrong = link.split("#")[0] + "#h." + seal.b64e(os.urandom(32)) + "." + self.token
        ask = self.page(wrong, helloWait=400)
        self.assertEqual(ask(cmd="request", method="GET", path="/api/state"), {"failed": "refused"})
        thief = self.page(link.rsplit(".", 1)[0] + ".not-the-token-000000000000")  # the right key, someone else's token
        self.assertEqual(thief(cmd="request", method="GET", path="/api/state")["status"], 403)

    def test_a_room_has_one_host_and_the_relay_can_be_locked(self):
        link = self.link()
        self.host(link)
        _, said = self.host(link, wait_for="this room already has a host")
        self.assertNotIn("room is up", said)
        _, said = self.host(self.link(), key="wrong", wait_for="not open to new rooms")
        self.assertNotIn("room is up", said)


if __name__ == "__main__":
    unittest.main()
