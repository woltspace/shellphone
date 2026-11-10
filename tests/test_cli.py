"""The front door, end to end on one computer: open a room, log in with the link, bring an agent, talk, close.

    python3 -m unittest discover tests
"""
import http.cookiejar, json, os, re, signal, subprocess, sys, tempfile, time, unittest, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
CLI = [sys.executable, "-m", "shellphone.cli"]


def run(*args, cwd, stdin=None):
    return subprocess.run([*CLI, *args], cwd=cwd, input=stdin, capture_output=True, text=True, timeout=30,
                          env={**os.environ, "PYTHONPATH": str(REPO)})


class Room:
    """A room in its own process, as `shellphone room` starts it."""
    def __init__(self, *args):
        self.proc = subprocess.Popen([*CLI, "room", "--port", "0", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                     env={**os.environ, "PYTHONPATH": str(REPO), "PYTHONUNBUFFERED": "1"})
        self.banner = ""
        while "Press Ctrl-C" not in self.banner:
            line = self.proc.stdout.readline()
            if not line:
                raise AssertionError("the room didn't start:\n" + self.banner)
            self.banner += line
        self.open = re.search(r"Open the chat:\s+(\S+)", self.banner).group(1)
        self.agent = re.search(r"join '([^']+)'", self.banner).group(1)
        self.url = self.open.split("/?")[0]
        self.browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def close(self, sig=signal.SIGINT):
        self.proc.send_signal(sig)
        out = self.proc.communicate(timeout=10)[0]
        return out

    def state(self):
        return json.load(self.browser.open(self.url + "/api/state"))


def status(url, **headers):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=headers)).status
    except urllib.error.HTTPError as e:
        return e.code


class FrontDoor(unittest.TestCase):
    def setUp(self):
        self.rooms = []
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        for r in self.rooms:
            if r.proc.poll() is None:
                r.proc.kill()
                r.proc.communicate()
        self.tmp.cleanup()

    def room(self, *args):
        self.rooms.append(Room(*args))
        return self.rooms[-1]

    def data_dir(self, room):
        """Where the room keeps its data, found from outside: the temp folder holding this room's pid."""
        for d in Path(tempfile.gettempdir()).glob("shellphone-room-*"):
            if (d / "host.pid").is_file() and (d / "host.pid").read_text() == str(room.proc.pid):
                return d

    def test_the_link_logs_the_host_in_and_nothing_else_does(self):
        r = self.room("--name", "Sam")
        self.assertEqual(status(r.url + "/"), 403)  # no link, no room
        self.assertEqual(status(r.url + "/api/state"), 403)
        self.assertEqual(status(r.url + "/?k=wrong"), 403)
        self.assertEqual(status(r.url + "/api/state", **{"Cf-Access-Authenticated-User-Email": "host@shellphone.local"}), 403)  # a header isn't a login
        self.assertEqual(status(r.url + "/api/state?as=host@shellphone.local"), 403)
        page = r.browser.open(r.open)
        self.assertEqual(page.url, r.url + "/")  # the token left the address bar
        self.assertIn(b"<html", page.read()[:200].lower())
        state = r.state()
        self.assertEqual(state["me"], "host@shellphone.local")
        self.assertEqual([p["name"] for p in state["members"]["people"]], ["Sam"])
        cookie = next(c for h in r.browser.handlers if hasattr(h, "cookiejar") for c in h.cookiejar)
        self.assertEqual(status(r.url + "/api/state", Cookie=f"{cookie.name}={cookie.value}"), 200)
        self.assertEqual(status(r.url + "/api/state", Cookie=f"{cookie.name}={cookie.value}", Host="evil.example:80"), 403)  # another site's name for this address

    def test_an_agent_joins_hears_and_answers(self):
        r = self.room()
        work = Path(self.tmp.name)
        joined = run("join", r.agent, "--name", "helper", cwd=work)
        self.assertEqual(joined.returncode, 0, joined.stderr)
        config = work / "shellphone" / "lodge.json"
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        saved = json.loads(config.read_text())
        self.assertEqual(sorted(saved), ["key", "room_url", "wolt"])  # the link's code isn't kept
        self.assertNotIn(saved["key"], joined.stdout)
        self.assertIn("already exists", run("join", r.agent, "--name", "helper", cwd=work).stderr)

        first = run("wait", "--timeout", "1", cwd=work)  # joins from now on
        self.assertIn("No new messages", first.stdout)
        r.browser.open(r.open)
        r.browser.open(urllib.request.Request(r.url + "/api/messages", data=json.dumps({"text": "@helper are you there?"}).encode(),
                                              headers={"Content-Type": "application/json"}))
        heard = run("wait", "--timeout", "5", cwd=work)
        self.assertIn("@helper are you there?", heard.stdout)
        self.assertIn("This is your own human asking.", heard.stdout)
        # the agent is told to answer with the command, never with a file path that moves with each version
        self.assertRegex(heard.stdout, r"\n(uvx )?shellphone post --config \S+lodge\.json <<'SHELLPHONE_")
        self.assertRegex(heard.stdout, r"\n(uvx )?shellphone wait --config ")
        self.assertNotIn("connector.py", heard.stdout)
        said = run("post", cwd=work, stdin="here")
        self.assertEqual(said.returncode, 0, said.stderr)
        texts = [(m["kind"], m.get("text")) for m in r.state()["messages"] if m["kind"] in ("human", "wolt")]
        self.assertEqual(texts, [("human", "@helper are you there?"), ("wolt", "here")])

    def test_a_newer_room_never_tells_a_package_to_swap_files(self):
        from shellphone import cli
        packaged, plain = cli.connector(), cli.part("connector")
        got = {"connector": "2999.01.01"}
        self.assertEqual(packaged.newer({}, {"connector": packaged.VERSION}), (None, None))
        version, note = packaged.newer({}, got)
        self.assertEqual(version, "2999.01.01")
        self.assertNotIn("connector.py", note)
        self.assertIn("uvx --refresh shellphone", note)
        self.assertIn("connector.py", plain.newer({}, got)[1])  # a plain connector file is still replaced by hand

    def test_every_command_the_help_names_exists(self):
        from shellphone import cli
        for cmd in cli.CONNECTOR:
            got = run(cmd, *([] if cmd == "version" else ["--help"]), cwd=Path(self.tmp.name))
            self.assertEqual(got.returncode, 0, f"{cmd}: {got.stderr}")
        epilog = run("--help", cwd=Path(self.tmp.name)).stdout.split("After join:")[1]
        for cmd in re.findall(r"\b[a-z]+\b", epilog.split("(")[0]):
            self.assertIn(cmd, ("shellphone", *cli.CONNECTOR))

    def test_a_bad_link_is_refused_before_anything_is_written(self):
        work = Path(self.tmp.name)
        for link in ("http://example.com/#code", "ftp://127.0.0.1/#code", "http://127.0.0.1:4090/", "http://127.0.0.1:1/#code"):
            got = run("join", link, "--name", "helper", cwd=work)
            self.assertNotEqual(got.returncode, 0, link)
            self.assertFalse((work / "shellphone").exists(), link)

    def test_closing_deletes_the_room(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            r = self.room()
            r.browser.open(r.open)
            data = self.data_dir(r)
            self.assertTrue((data / "room.db").is_file())
            self.assertIn("Room closed and deleted.", r.close(sig))
            self.assertFalse(data.exists())

    def test_keep_keeps_the_room_and_changes_the_links(self):
        kept = Path(self.tmp.name) / "kept"
        r = self.room("--keep", str(kept))
        r.browser.open(r.open)
        r.browser.open(urllib.request.Request(r.url + "/api/messages", data=json.dumps({"text": "remember me"}).encode(),
                                              headers={"Content-Type": "application/json"}))
        old = r.agent
        self.assertIn("kept in", r.close())
        again = self.room("--keep", str(kept))
        again.browser.open(again.open)
        self.assertIn("remember me", [m.get("text") for m in again.state()["messages"]])
        self.assertNotEqual(old.split("#")[1], again.agent.split("#")[1])
        stale = again.url + "/#" + old.split("#")[1]  # last run's agent link no longer opens the room
        self.assertNotEqual(run("join", stale, "--name", "helper", cwd=Path(self.tmp.name)).returncode, 0)

    def test_a_crashed_rooms_leftovers_are_swept_and_an_open_room_is_left_alone(self):
        open_room = self.room()
        crashed = self.room()
        gone, stays = self.data_dir(crashed), self.data_dir(open_room)
        crashed.proc.kill()
        crashed.proc.communicate()
        self.assertTrue(gone.exists())  # a kill leaves the folder behind
        self.room()  # the next room sweeps
        self.assertFalse(gone.exists())
        self.assertTrue(stays.exists())


if __name__ == "__main__":
    unittest.main()
