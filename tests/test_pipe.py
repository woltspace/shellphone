"""The pipe: the host's side on its own, the page's side under node, and (when asked) both through a real local relay.

    uv run --with cryptography --with websockets python -m unittest tests.test_pipe
    RELAY_E2E=1 …   also starts the relay with `npx wrangler dev --local` and a shared room, and talks through them
"""
import base64, http.cookiejar, json, os, re, shutil, signal, subprocess, sys, tempfile, threading, time, unittest, urllib.error, urllib.request
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
            return {"t": "res", "id": self.n, **json.loads(base64.b64decode("".join(p["chunk"] for p in out)))}
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

    def test_no_frame_outgrows_the_relay_whatever_the_answer_holds(self):
        relay_carries = 64 * 1024
        awkward = ['"' * 20_000, "\\" * 20_000, "\n" * 20_000, "🐚" * 20_000, "\u0000" * 9_000, "x" * 29_990, '"' * 14_990, "é" * 30_000]
        for body in awkward + [awkward, {"messages": [{"text": '"' * 8000} for _ in range(60)]}]:
            c = Client(self.make(lambda *_: (200, body)))
            frames = c.pipe.feed(c.session.seal({"t": "req", "id": 1, "method": "GET", "path": "/api/state", "body": None, "auth": "tok"}))
            biggest = max(len(json.dumps({"to": "0123456789abcdef", "data": f})) for f in frames)
            self.assertLess(biggest, relay_carries, f"{str(body)[:20]!r}… made a frame of {biggest}")
            again = Client(self.make(lambda *_: (200, body)))
            self.assertEqual(again.ask()["body"], body)

    def test_a_megabyte_answer_is_many_parts_of_one_size(self):
        body = {"blob": "a" * 1_300_000}
        c = Client(self.make(lambda *_: (200, body)))
        frames = c.pipe.feed(c.session.seal({"t": "req", "id": 1, "method": "GET", "path": "/api/state", "body": None, "auth": "tok"}))
        self.assertEqual(len(frames), -(-len(json.dumps({"status": 200, "body": body}, separators=(",", ":"))) // pipe.PART))
        self.assertGreater(len(frames), 40)
        self.assertEqual(pipe.PART % 3, 0)  # so the base64 of the parts joins into the base64 of the whole
        self.assertEqual(Client(self.make(lambda *_: (200, body))).ask()["body"], body)

    def test_the_host_hands_a_long_answer_over_at_a_pace_the_relay_allows(self):
        allowed = int(re.search(r"hostPerSecond: (\d+)", (REPO / "relay" / "src" / "index.js").read_text()).group(1))
        self.assertLessEqual(pipe.FRAMES_PER_SECOND * 2, allowed)
        client, sent, naps, stop = seal.Client(ROOM, SECRET), [], [], __import__("threading").Event()
        script = iter([json.dumps({"join": "c1"}), json.dumps({"from": "c1", "data": client.hi()})])

        class Relay:  # the relay's side of the host's socket, scripted
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def send(self, text): sent.append(json.loads(text))
            def recv(self, timeout=None):
                if len(sent) == 1 and "session" not in vars(self):  # the hello went out: now ask for something long
                    self.session = client.hello(sent[0]["data"])
                    return json.dumps({"from": "c1", "data": self.session.seal({"t": "req", "id": 1, "method": "GET", "path": "/api/state", "body": None, "auth": "t"})})
                try:
                    return next(script)
                except StopIteration:
                    stop.set()
                    raise TimeoutError
        real = pipe.time.sleep
        pipe.time.sleep = naps.append
        try:
            pipe.serve("ws://relay.test/r/x/host", "", lambda: pipe.HostPipe(ROOM, {"h": SECRET}, lambda *_: (200, {"blob": "a" * 200_000})), stop, connect=lambda *a, **k: Relay())
        finally:
            pipe.time.sleep = real
        parts = [m for m in sent[1:] if m.get("to") == "c1"]
        self.assertGreater(len(parts), 5)
        self.assertEqual(naps, [1 / pipe.FRAMES_PER_SECOND] * len(parts))  # a pause after every part

    def test_news_is_sealed_for_each_client_and_only_once_it_is_established(self):
        host = self.make(lambda *_: (200, {}))
        self.assertIsNone(host.news())  # nobody to tell yet
        c = Client(host)
        self.assertEqual(c.session.open(host.news()), {"t": "news"})
        self.assertEqual(c.ask()["status"], 200)  # answers and news share one counter, in the order they were sealed
        note = host.news()
        self.assertEqual(c.session.open(note), {"t": "news"})
        with self.assertRaises(seal.SealError):
            c.session.open(note)  # the same note a second time is dropped
        other = Client(self.make(lambda *_: (200, {})))
        with self.assertRaises(seal.SealError):
            other.session.open(host.news())  # and it means nothing to another client

    def test_the_host_tells_established_clients_of_news_once_however_often_it_is_set(self):
        client, sent, stop, news = seal.Client(ROOM, SECRET), [], threading.Event(), threading.Event()
        script = iter([json.dumps({"join": "c1"}), json.dumps({"join": "c2"}), json.dumps({"from": "c1", "data": client.hi()})])
        turns = []

        class Relay:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def send(self, text): sent.append(json.loads(text))
            def recv(self, timeout=None):
                turns.append(timeout)
                try:
                    return next(script)
                except StopIteration:
                    if len(turns) < 12:
                        news.set()  # set again and again: the room keeps changing
                    else:
                        stop.set()
                    raise TimeoutError
        clock = iter(i * 0.2 for i in range(1000))
        real = pipe.time.monotonic
        pipe.time.monotonic = lambda: next(clock)
        try:
            pipe.serve("ws://relay.test/r/x/host", "", lambda: pipe.HostPipe(ROOM, {"h": SECRET}, lambda *_: (200, {})), stop, connect=lambda *a, **k: Relay(), news=news)
        finally:
            pipe.time.monotonic = real
        session = client.hello(sent[0]["data"])
        notes = sent[1:]
        self.assertTrue(notes and all(m["to"] == "c1" for m in notes))  # c2 never said hi: it is told nothing
        self.assertEqual([session.open(m["data"]) for m in notes], [{"t": "news"}] * len(notes))
        self.assertLess(len(notes), 5)  # set eight times in a row, told far fewer: no faster than NEWS_EVERY
        self.assertLess(max(turns), 1)  # with news to watch for, the host looks up often

    def test_a_full_relay_is_asked_again_later_and_a_closed_door_is_not(self):
        def turned_away(status):
            class No(Exception):
                response = type("R", (), {"status_code": status})
            states, waits, knocks = [], [], []

            class Stop:  # the host's stop signal, standing in: it notes each wait, and ends the third
                def is_set(self): return False
                def wait(self, seconds):
                    waits.append(seconds)
                    return len(waits) >= 3

            def connect(*a, **k):
                knocks.append(1)
                raise No()
            pipe.serve("ws://relay.test/r/x/host", "", lambda: None, Stop(), on_state=states.append, connect=connect)
            return states, waits, len(knocks)
        states, waits, knocks = turned_away(429)
        self.assertEqual((states[:3], waits, knocks), (["full"] * 3, [pipe.FULL_WAIT] * 3, 3))  # no place: it keeps asking, minutes apart
        for status in (401, 409):
            states, waits, knocks = turned_away(status)
            self.assertEqual((states[0][:8], waits, knocks), ("refused:", [], 1))  # not allowed, or already hosted: once is enough

    def test_a_host_that_lost_its_connection_keeps_asking_while_the_relay_still_sees_the_old_one(self):
        class Taken(Exception):
            response = type("R", (), {"status_code": 409})

        class Cut:  # a connection that opens, then is cut without a goodbye, as when the relay is updated
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def recv(self, timeout=None): raise ConnectionError("cut")

        def run(answers, seconds_per_wait, stop_at=None):
            states, waits, clock = [], [], [0.0]

            class Stop:
                def is_set(self): return False
                def wait(self, seconds):
                    waits.append(seconds)
                    clock[0] += seconds_per_wait
                    return len(waits) == stop_at

            def connect(*a, **k):
                if not answers:
                    raise KeyboardInterrupt  # the script ran out: end the test here
                answer = answers.pop(0)
                if answer == "taken":
                    raise Taken()
                if answer == "away":
                    raise ConnectionError("no network")
                return Cut()
            real = pipe.time.monotonic
            pipe.time.monotonic = lambda: clock[0]
            try:
                pipe.serve("ws://relay.test/r/x/host", "", lambda: None, Stop(), on_state=states.append, connect=connect)
            except KeyboardInterrupt:
                pass
            finally:
                pipe.time.monotonic = real
            return states, waits
        # Up, cut, then "taken" twice before the relay lets it back in: the room comes up again.
        states, waits = run(["up", "taken", "taken", "up"], 1)
        self.assertEqual(states[:5], ["up", "down", "down", "down", "up"])
        self.assertFalse([s for s in states if s.startswith("refused")])
        # Still "taken" a minute after the cut: someone else does host this room, and it stops.
        states, waits = run(["up"] + ["taken"] * 50, 20)
        self.assertEqual(states[-1][:8], "refused:")
        # paced, and the time allowed runs from the first "taken", not from each try: each wait takes 20 s here, so
        # the first "taken" comes at 20 s and the last one that is still waited on at 160 s, inside TAKEN_WAIT
        self.assertEqual(waits, [1, 2, 4, 8, 15, 30, 30, 30, 30])
        self.assertGreater(pipe.TAKEN_WAIT, 60 + 30)  # longer than the relay's minute of silence plus the slowest retry
        # Away for minutes (asleep, no network), then "taken" on coming back: the minute starts then, and the room comes up.
        states, waits = run(["up"] + ["away"] * 10 + ["taken", "taken", "up"], 9)  # 90 s without a network, then 18 s of "taken"
        self.assertEqual(states.count("up"), 2)
        self.assertFalse([s for s in states if s.startswith("refused")])
        # Stopped while it waits to ask again: it ends there, quietly.
        states, waits = run(["up"] + ["taken"] * 50, 1, stop_at=3)
        self.assertEqual((states[-1], len(waits)), ("down", 3))
        self.assertFalse([s for s in states if s.startswith("refused")])

    def test_the_host_shows_its_claim_and_says_it_is_here_every_twenty_seconds(self):
        sent, seen, clock, stop = [], {}, [0.0], threading.Event()

        class Relay:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def send(self, text): sent.append((clock[0], text))
            def recv(self, timeout=None):
                clock[0] += 1  # a quiet room: a second goes by on every look
                if clock[0] >= 45:
                    stop.set()
                raise TimeoutError

        def connect(url, additional_headers=None, **k):
            seen.update(additional_headers)
            return Relay()
        real = pipe.time.monotonic
        pipe.time.monotonic = lambda: clock[0]
        try:
            pipe.serve("ws://relay.test/r/x/host", "relay-key", lambda: None, stop, connect=connect, claim="C" * 43)
        finally:
            pipe.time.monotonic = real
        self.assertEqual(seen, {"Authorization": "Bearer relay-key", "X-Shellphone-Claim": "C" * 43})
        self.assertEqual(sent, [(20.0, '{"ping":1}'), (40.0, '{"ping":1}')])  # nothing else is said in a quiet room
        seen.clear()
        stop.clear(); clock[0] = 0.0
        pipe.time.monotonic = lambda: clock[0]
        try:
            pipe.serve("ws://relay.test/r/x/host", "", lambda: None, stop, connect=connect)
        finally:
            pipe.time.monotonic = real
        self.assertEqual(seen, {})  # no claim given, none shown

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


@unittest.skipUnless(NODE and subprocess.run([NODE, "-e", "require('node:sqlite')"], capture_output=True).returncode == 0, "needs a node with sqlite built in (22.5 or later)")
class RelayDesk(unittest.TestCase):
    def test_the_relays_desk_and_room_pass_their_own_tests(self):
        got = subprocess.run([NODE, "--test", str(REPO / "relay" / "tests" / "desk.test.mjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(got.returncode, 0, got.stdout[-3000:] + got.stderr[-2000:])


def free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_relay(*variables):
    """The relay on this computer, in Cloudflare's local simulator, with these settings (NAME:value)."""
    port, fresh = free_port(), tempfile.mkdtemp()  # nothing the relay kept from an earlier run: the desk's counts start at zero
    proc = subprocess.Popen([NPX, "-y", "wrangler@4", "dev", "--local", "--port", str(port), "--persist-to", fresh, *[x for v in variables for x in ("--var", v)]],
                            cwd=REPO / "relay", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    proc.fresh = fresh
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
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass  # already gone: whatever went wrong before this is the thing to report
    proc.communicate(timeout=20)
    shutil.rmtree(proc.fresh, ignore_errors=True)


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
            # (each of these holds a character sealed frames never do, or is long: a short plain word like Sam turns up
            # in random sealed text by chance, about one run in six)
            for plain in ("through the relay", self.token, "/api/", '"Sam"', '"name"', seal.b64e(self.secret)):
                self.assertNotIn(plain, frame)
        # what the relay doesn't offer isn't reachable
        self.assertEqual(ask(cmd="request", method="GET", path="/api/push")["status"], 404)
        # the host goes away: the page is told, and the relay says so too
        host.send_signal(signal.SIGINT)
        self.assertIn("Room closed and deleted.", host.communicate(timeout=15)[0])
        self.assertEqual(ask(cmd="wait", state="offline")["state"], "offline")
        self.assertFalse(self.up())
        self.assertEqual(ask(cmd="states")["states"][:3], ["connecting", "open", "offline"])

    def test_the_room_tells_the_page_when_something_changed_and_is_silent_otherwise(self):
        link = self.link()
        host, banner = self.host(link)
        ask = self.page(link)
        first = ask(cmd="request", method="GET", path="/api/state?after=0")
        self.assertEqual((first["status"], first["body"].get("news")), (200, True))  # the host says it will tell: the page may stop asking
        time.sleep(1.5)
        quiet = len(ask(cmd="wire")["wire"])
        time.sleep(2.5)
        self.assertEqual(len(ask(cmd="wire")["wire"]), quiet)  # nothing happens in the room: nothing crosses the relay
        self.assertEqual(ask(cmd="news", atLeast=1, ms=300)["news"], 0)
        # someone says something at the room's own door: the page hears there is news, and finds it when it asks
        local = re.search(r"join '(http://127[^#']+)/#", banner).group(1)
        browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        browser.open(f"{local}/?k={self.token}")
        browser.open(urllib.request.Request(local + "/api/messages", data=json.dumps({"text": "said at home", "cid": "home0001"}).encode(), headers={"Content-Type": "application/json"}))
        self.assertGreaterEqual(ask(cmd="news", atLeast=1)["news"], 1)
        got = ask(cmd="request", method="GET", path="/api/state?after=0")["body"]["messages"]
        self.assertEqual([m["text"] for m in got if m["kind"] == "human"], ["said at home"])
        for frame in ask(cmd="wire")["wire"]:
            self.assertNotIn('"news"', frame)  # the note is sealed like everything else

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

    def test_a_very_full_room_loads_and_stays_up(self):
        link = self.link()
        _, banner = self.host(link)
        local = re.search(r"join '(http://127[^#']+)/#", banner).group(1)
        door = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        door.open(f"{local}/?k={self.token}")
        # 170 messages of nothing but quotes: the worst text for sizes, and well over a megabyte once it's an answer
        for i in range(170):
            door.open(urllib.request.Request(local + "/api/messages", data=json.dumps({"text": '"' * 7990 + f" {i}", "cid": f"full{i:04d}"}).encode(),
                                             headers={"Content-Type": "application/json"}))
        ask = self.page(link)
        for _ in range(2):
            state = ask(cmd="request", method="GET", path="/api/state?after=0")
            self.assertEqual(state.get("status"), 200, {**state, "states": ask(cmd="states")["states"]} if "body" not in state else state["status"])  # if it fails, say how
            texts = [m["text"] for m in state["body"]["messages"] if m["kind"] == "human"]
            self.assertEqual((len(texts), texts[0], texts[-1]), (170, '"' * 7990 + " 0", '"' * 7990 + " 169"))
        self.assertGreater(sum(len(f) for f in ask(cmd="wire")["wire"]), 2_500_000)  # it really was that much
        # five pages asking for all of it at the same moment: several hundred parts for the host to hand over
        import threading
        pages, counts = [self.page(link) for _ in range(5)], []
        threads = [threading.Thread(target=lambda p=p: counts.append(len((p(cmd="request", method="GET", path="/api/state?after=0").get("body") or {}).get("messages", [])))) for p in pages]
        [t.start() for t in threads], [t.join() for t in threads]
        self.assertEqual(counts, [170] * 5)
        self.assertEqual(ask(cmd="states")["states"], ["connecting", "open"])  # and the room never dropped
        self.assertTrue(self.up())

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

    def test_an_invite_makes_a_guest_and_never_a_host(self):
        link = self.link()
        self.host(link)
        base, me = link.split("#")[0], self.page(link)
        key = me(cmd="request", method="GET", path="/api/invite")["body"]["key"]
        self.assertRegex(key, r"^i\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{20,}$")
        self.assertNotIn(seal.b64e(self.secret), key)
        self.assertNotIn(self.token, key)
        # the invite link itself can only ask for a place
        door = self.page(f"{base}#{key}")
        self.assertEqual(door(cmd="request", method="GET", path="/api/state")["status"], 403)
        self.assertEqual(door(cmd="request", method="POST", path="/api/messages", body={"text": "let me in", "cid": "x0000001"})["status"], 403)
        self.assertEqual(door(cmd="request", method="GET", path="/api/invite")["status"], 403)
        self.assertEqual(door(cmd="request", method="POST", path="/api/guest", body={"name": "  "})["status"], 400)
        got = door(cmd="request", method="POST", path="/api/guest", body={"name": "Ali"})
        self.assertEqual(got["status"], 200)
        secret_part = key.split(".")[1]
        ali = self.page(f"{base}#i.{secret_part}.{got['body']['token']}")
        state = ali(cmd="request", method="GET", path="/api/state?after=0")["body"]
        self.assertRegex(state["me"], r"^guest-[0-9a-f]{8}@room\.local$")
        people = {p["name"]: p for p in state["members"]["people"]}
        self.assertEqual((sorted(people), bool(people["Ali"].get("guest")), bool(people["Sam"].get("guest"))), (["Ali", "Sam"], True, False))
        self.assertEqual(ali(cmd="request", method="POST", path="/api/messages", body={"text": "hello from a guest", "cid": "g0000001"})["status"], 200)
        seen = [(m["email"], m["text"]) for m in me(cmd="request", method="GET", path="/api/state?after=0")["body"]["messages"] if m["kind"] == "human"]
        self.assertEqual(seen, [(state["me"], "hello from a guest")])
        # a guest is not the host: no invite of their own, and their token means nothing under the host's link
        self.assertEqual(ali(cmd="request", method="GET", path="/api/invite")["status"], 404)
        swapped = self.page(f"{base}#h.{seal.b64e(self.secret)}.{got['body']['token']}")
        self.assertEqual(swapped(cmd="request", method="GET", path="/api/state")["status"], 403)
        # and the host's token means nothing under the invite link
        climb = self.page(f"{base}#i.{secret_part}.{self.token}")
        self.assertEqual(climb(cmd="request", method="GET", path="/api/state")["status"], 403)
        # the invite secret offered as the host's link doesn't even connect
        fake = self.page(f"{base}#h.{secret_part}.{self.token}", helloWait=400)
        self.assertEqual(fake(cmd="request", method="GET", path="/api/state"), {"failed": "refused"})

    def test_a_room_has_one_host_and_the_relay_can_be_locked(self):
        link = self.link()
        self.host(link)
        _, said = self.host(link, wait_for="this room already has a host")
        self.assertNotIn("room is up", said)
        _, said = self.host(self.link(), key="wrong", wait_for="not open to new rooms")
        self.assertNotIn("room is up", said)


@E2E
class RoomCap(unittest.TestCase):
    """The relay's desk: only so many rooms at once and per day, and counts for whoever holds the host key."""
    link, host, page, setUp, tearDown = (getattr(ThroughTheRelay, n) for n in ("link", "host", "page", "setUp", "tearDown"))

    @classmethod
    def setUpClass(cls):
        cls.relay, cls.base = start_relay("HOST_KEY:test-host-key", "MAX_ROOMS:2", "MAX_ROOMS_PER_DAY:3")

    @classmethod
    def tearDownClass(cls):
        stop_relay(cls.relay)

    def stats(self, key="test-host-key"):
        got = json.load(urllib.request.urlopen(urllib.request.Request(self.base + "/stats", headers={"Authorization": "Bearer " + key})))
        today = got["days"][0] if got["days"] else {"rooms_opened": 0, "connections": 0, "frames": 0, "refused": 0}
        return got["open_rooms"], today

    def taps(self):
        got = json.load(urllib.request.urlopen(urllib.request.Request(self.base + "/stats", headers={"Authorization": "Bearer test-host-key"})))
        return {t["what"]: t["n"] for t in got["taps"]}

    def close(self, host):
        """Stop a host, and wait until the desk has heard: the relay learns of it a moment after the process is gone."""
        before = self.stats()[0]
        host.send_signal(signal.SIGINT)
        self.assertIn("Room closed", host.communicate(timeout=15)[0])
        end = time.time() + 10
        while self.stats()[0] != before - 1 and time.time() < end:
            time.sleep(0.1)
        self.assertEqual(self.stats()[0], before - 1)

    def test_a_host_that_went_silent_is_replaced_only_by_its_own_claim(self):
        from websockets.sync.client import connect
        from websockets.exceptions import ConnectionClosed, InvalidStatus
        relay, base = start_relay("HOST_KEY:test-host-key", "QUIET_SECONDS:2")
        self.addCleanup(stop_relay, relay)
        room = "/r/" + "Q" * 22
        up = lambda: json.load(urllib.request.urlopen(base + room + "/up"))["up"]

        def host(claim=None):
            return connect(base.replace("http", "ws", 1) + room + "/host", open_timeout=15,
                           additional_headers={"Authorization": "Bearer test-host-key", **({"X-Shellphone-Claim": claim} if claim else {})})

        def refused(claim=None):
            with self.assertRaises(InvalidStatus) as no:
                host(claim)
            return no.exception.response.status_code
        mine, other = "m" * 43, "o" * 43
        first = self.enterContext(host(mine))
        self.assertTrue(up())
        self.assertEqual(refused(mine), 409)  # just let in: nobody takes its place
        for _ in range(4):  # it says it's here, and the relay answers by itself, for longer than the silence allowed
            first.send('{"ping":1}')
            self.assertEqual(first.recv(timeout=5), '{"pong":1}')
            time.sleep(0.8)
        self.assertTrue(up())
        self.assertEqual(refused(mine), 409)
        time.sleep(2.5)  # now it says nothing, though its connection is still open: as when a computer sleeps
        self.assertFalse(up())
        self.assertEqual(refused(other), 409)
        self.assertEqual(refused(), 409)
        second = self.enterContext(host(mine))  # the room's own host, on a new connection
        self.assertTrue(up())
        with self.assertRaises(ConnectionClosed) as closed:
            first.recv(timeout=5)
        self.assertEqual(closed.exception.rcvd.code, 4409)
        second.send('{"ping":1}')
        self.assertEqual(second.recv(timeout=5), '{"pong":1}')
        second.close()
        # a host that shows no claim is the host of before: silent for as long, it is still the room, and stays
        old = self.enterContext(host())
        time.sleep(2.5)
        self.assertTrue(up())
        self.assertEqual(refused(mine), 409)
        old.close()

    def test_rooms_are_capped_places_come_back_and_the_counts_say_what_happened(self):
        for key in ("", "wrong"):  # the counts are for the key's holder only
            with self.assertRaises(urllib.error.HTTPError) as no:
                self.stats(key)
            self.assertEqual(no.exception.code, 404)
        self.assertEqual(self.stats()[0], 0)
        a_link, b_link = self.link(), self.link()
        a, b = self.host(a_link)[0], self.host(b_link)[0]
        # the relay is full: a third room is told so and gives up, without knocking again and again
        c_link = self.link()
        refused = self.host(c_link, wait_for="no place for another room")[0]
        self.assertNotEqual(refused.wait(timeout=15), 0)
        rooms, today = self.stats()
        self.assertEqual((rooms, today["rooms_opened"], today["refused"]), (2, 2, 1))
        # a page comes and asks something: one connection, and frames both ways
        ask = self.page(b_link)
        self.assertEqual(ask(cmd="request", method="GET", path="/api/state?after=0")["status"], 200)
        ask(cmd="close")
        # a room closes: its place is free at once, and what it carried is counted
        self.close(a)
        self.close(b)
        rooms, today = self.stats()
        self.assertEqual((rooms, today["rooms_opened"], today["connections"]), (0, 2, 1))
        self.assertGreaterEqual(today["frames"], 4)  # hi, hello, the request, its answer
        self.assertLess(today["frames"], 12)
        # the same room coming back takes a place but isn't a new room
        b = self.host(b_link)[0]
        rooms, today = self.stats()
        self.assertEqual((rooms, today["rooms_opened"]), (1, 2))
        # a third new room today is the last one allowed: the fourth is refused though there is a place
        c = self.host(c_link)[0]
        self.close(c)
        self.host(self.link(), wait_for="no place for another room")
        rooms, today = self.stats()
        self.assertEqual((rooms, today["rooms_opened"], today["refused"]), (1, 3, 2))
        self.close(b)

    def test_an_open_room_keeps_its_place_and_reports_while_it_is_open(self):
        relay, self.base = start_relay("HOST_KEY:test-host-key", "MAX_ROOMS:1", "BEAT_SECONDS:1")
        self.addCleanup(setattr, self, "base", self.base)
        self.addCleanup(stop_relay, relay)
        link = self.link()
        host = self.host(link)[0]
        ask = self.page(link)
        self.assertEqual(ask(cmd="request", method="GET", path="/api/state?after=0")["status"], 200)
        time.sleep(5)  # longer than the desk waits before giving a silent room's place away
        rooms, today = self.stats()
        self.assertEqual((rooms, today["connections"]), (1, 1))  # still there, and counted without waiting for it to close
        frames = today["frames"]
        self.assertGreaterEqual(frames, 4)
        self.host(self.link(), wait_for="no place for another room")
        self.close(host)
        rooms, today = self.stats()
        self.assertEqual((rooms, today["connections"], today["frames"]), (0, 1, frames))  # nothing counted twice at the end

    def test_anyone_may_know_how_many_rooms_are_live_and_nothing_else(self):
        relay, self.base = start_relay("HOST_KEY:test-host-key")
        self.addCleanup(setattr, self, "base", self.base)
        self.addCleanup(stop_relay, relay)
        host = self.host(self.link())[0]
        self.assertEqual(self.stats()[0], 1)
        first = urllib.request.urlopen(self.base + "/live")
        self.assertEqual(json.load(first), {"rooms": 1})  # one number, no key asked for, and nothing beside it
        self.assertIn("max-age=30", first.headers["cache-control"])
        self.close(host)
        self.assertEqual(self.stats()[0], 0)
        self.assertEqual(json.load(urllib.request.urlopen(self.base + "/live")), {"rooms": 1})  # kept for half a minute: asked again here, the desk isn't
        with self.assertRaises(urllib.error.HTTPError) as no:
            urllib.request.urlopen(urllib.request.Request(self.base + "/live", method="POST", data=b"{}"))
        self.assertEqual(no.exception.code, 404)
        def tap(query, method="POST"):
            try:
                with urllib.request.urlopen(urllib.request.Request(self.base + "/tap" + query, method=method, data=b"" if method == "POST" else None)) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as e:
                return e.code, None
        self.assertEqual([tap("?what=mic"), tap("?what=mic"), tap("?what=file"), tap("?what=more")], [(204, b"")] * 4)  # counted, and nothing comes back
        self.assertEqual([tap("?what=camera")[0], tap("")[0], tap("?what=mic", "GET")[0]], [404, 404, 404])  # only the things it knows, only by POST
        end = time.time() + 5  # the count is written after the answer is given
        while time.time() < end and len(self.taps()) < 3:
            time.sleep(0.1)
        self.assertEqual(self.taps(), {"file": 1, "mic": 2, "more": 1})
        self.assertNotIn("taps", json.load(urllib.request.urlopen(self.base + "/live")))  # the public number stays one number
        for gone in ("/numbers", "/numbers.html"):  # the site has no page for the private counts: whoever runs the relay reads /stats themselves
            with self.assertRaises(urllib.error.HTTPError) as no:
                urllib.request.urlopen(self.base + gone)
            self.assertEqual(no.exception.code, 404)

    def test_two_hosts_at_the_same_moment_cant_both_take_the_last_place(self):
        import concurrent.futures, contextlib
        from websockets.sync.client import connect
        relay, self.base = start_relay("HOST_KEY:test-host-key", "MAX_ROOMS:2")  # its own relay: the other test uses up the day's rooms
        self.addCleanup(setattr, self, "base", self.base)
        self.addCleanup(stop_relay, relay)
        first = self.host(self.link())[0]  # one place left

        def knock(_):
            room = seal.b64e(os.urandom(16))
            try:
                return stack.enter_context(connect(self.base.replace("http", "ws", 1) + f"/r/{room}/host", additional_headers={"Authorization": "Bearer test-host-key"}, open_timeout=15))
            except Exception as exc:
                return exc.response.status_code
        with contextlib.ExitStack() as stack:
            with concurrent.futures.ThreadPoolExecutor(6) as pool:
                got = list(pool.map(knock, range(6)))
            inside = [g for g in got if not isinstance(g, int)]
            self.assertEqual((len(inside), sorted(g for g in got if isinstance(g, int))), (1, [429] * 5))
            self.assertEqual(self.stats()[0], 2)
        self.close(first)


if __name__ == "__main__":
    unittest.main()
