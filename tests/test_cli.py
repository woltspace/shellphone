"""The front door, end to end on one computer: open a room, log in with the link, bring an agent, talk, close.

    python3 -m unittest discover tests                                  # the code in this folder
    SHELLPHONE_CLI=/some/venv/bin/shellphone python3 -m unittest discover tests   # an installed package, e.g. a built wheel
"""
import http.cookiejar, json, os, re, shlex, signal, subprocess, sys, tempfile, time, unittest, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
INSTALLED = os.environ.get("SHELLPHONE_CLI")  # test this command (an installed package) instead of the code in this folder
CLI = shlex.split(INSTALLED) if INSTALLED else [sys.executable, "-m", "shellphone.cli"]
ENV = {**os.environ, "PYTHONUNBUFFERED": "1", **({} if INSTALLED else {"PYTHONPATH": str(REPO)})}


def run(*args, cwd, stdin=None):
    return subprocess.run([*CLI, *args], cwd=cwd, input=stdin, capture_output=True, text=True, timeout=30, env=ENV)


class Room:
    """A room in its own process, as `shellphone room` starts it."""
    def __init__(self, *args, env=None):
        self.proc = subprocess.Popen([*CLI, "room", "--port", "0", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env or ENV)
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

    def room(self, *args, **kw):
        self.rooms.append(Room(*args, **kw))
        return self.rooms[-1]

    def data_dir(self, room):
        """Where the room keeps its data, found from outside: the temp folder holding this room's pid."""
        for d in Path(tempfile.gettempdir()).glob("shellphone-room-*"):
            if (d / "throwaway.pid").is_file() and (d / "throwaway.pid").read_text() == str(room.proc.pid):
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

    def test_a_paused_agent_is_off_and_a_removed_one_is_out(self):
        r = self.room()
        work, other = Path(self.tmp.name) / "a", Path(self.tmp.name) / "b"
        work.mkdir(), other.mkdir()
        self.assertEqual(run("join", r.agent, "--name", "helper", cwd=work).returncode, 0)
        self.assertEqual(run("join", r.agent, "--name", "second", cwd=other).returncode, 0)
        run("wait", "--timeout", "1", cwd=work)  # joins from now on
        r.browser.open(r.open)

        def page(path, body):
            try:
                return json.load(r.browser.open(urllib.request.Request(r.url + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})))
            except urllib.error.HTTPError as e:
                return e.code
        paused = lambda: {w["wolt"]: bool(w.get("paused")) for w in r.state()["members"]["wolts"]}

        self.assertEqual(page("/api/wolt", {"wolt": "helper", "state": "paused"}), {"wolt": "helper", "paused": True})
        self.assertEqual(paused(), {"helper": True, "second": False})
        page("/api/messages", {"text": "a word for everyone, about the weather"})
        quiet = run("wait", "--timeout", "2", cwd=work)
        self.assertIn("No new messages", quiet.stdout)  # paused: what isn't for it never reaches it
        self.assertNotIn("weather", quiet.stdout)
        self.assertFalse(r.state()["working"])  # and the room doesn't show it working on it
        page("/api/messages", {"text": "@helper one thing for you"})
        page("/api/messages", {"text": "helper, your own human says your name"})
        deaf = run("wait", "--timeout", "2", cwd=work)
        self.assertIn("No new messages", deaf.stdout)  # paused is off: a tag or its name doesn't get through either
        self.assertNotIn("one thing for you", deaf.stdout + deaf.stderr)
        self.assertFalse(r.state()["working"])  # and a tag doesn't light it up
        def agent(folder, path, body=None):
            key = json.loads((folder / "shellphone" / "lodge.json").read_text())["key"]
            try:
                return urllib.request.urlopen(urllib.request.Request(r.url + path, data=None if body is None else json.dumps(body).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})).status
            except urllib.error.HTTPError as e:
                return e.code
        said = len(r.state()["messages"])
        self.assertEqual(agent(work, "/lodge/messages", {"text": "still here"}), 403)  # it can't post,
        self.assertEqual(agent(work, "/lodge/history"), 403)  # read back,
        self.assertEqual(agent(work, "/lodge/working", {"working": True}), 403)  # show itself working,
        self.assertEqual(agent(work, "/lodge/state", {"paused": False}), 403)  # or bring itself back
        self.assertEqual(len(r.state()["messages"]), said)
        self.assertEqual(paused()["helper"], True)

        # Bringing an agent back is a person's switch (the host here): another agent can't, by any wording.
        self.assertEqual(agent(other, "/lodge/state", {"wolt": "helper", "paused": False}), 403)
        self.assertEqual(paused()["helper"], True)
        self.assertEqual(page("/api/wolt", {"wolt": "helper", "state": "on"}), {"wolt": "helper", "paused": False})
        self.assertEqual(paused(), {"helper": False, "second": False})
        page("/api/messages", {"text": "back to everyone now"})
        again = run("wait", "--timeout", "5", cwd=work)
        self.assertIn("back to everyone now", again.stdout)
        self.assertNotIn("weather", again.stdout)  # nothing piled up while it was paused
        self.assertNotIn("one thing for you", again.stdout)
        as_agent = lambda body: agent(other, "/lodge/state", body)
        for body in ({"wolt": "helper", "paused": True}, {"wolt": "nobody", "paused": False}, {"wolt": "helper"}, {"paused": False}, {}):
            self.assertEqual(as_agent(body), 403)  # an agent's only switch is pausing itself
        self.assertEqual(paused(), {"helper": False, "second": False})
        self.assertIn("second is paused", run("pause", cwd=other).stdout)
        self.assertEqual(paused(), {"helper": False, "second": True})
        self.assertEqual(as_agent({"paused": False}), 403)  # having paused itself, it stays off until a person brings it back
        self.assertEqual(paused()["second"], True)

        # Removed: off the list, and its key is dead at once.
        self.assertEqual(page("/api/wolt", {"wolt": "second", "state": "removed"}), {"wolt": "second", "removed": True})
        self.assertEqual(paused(), {"helper": False})
        self.assertEqual(as_agent({"wolt": "second", "paused": False}), 401)
        gone = run("wait", "--timeout", "3", cwd=other)
        self.assertIn("turned you away", gone.stderr)
        self.assertEqual(page("/api/wolt", {"wolt": "second", "state": "removed"}), 404)
        self.assertEqual(page("/api/wolt", {"wolt": "helper", "state": "asleep"}), 400)

    def test_a_thread_reaches_the_agents_in_it(self):
        r = self.room()
        work, other = Path(self.tmp.name) / "a", Path(self.tmp.name) / "b"
        work.mkdir(), other.mkdir()
        self.assertEqual(run("join", r.agent, "--name", "helper", cwd=work).returncode, 0)
        self.assertEqual(run("join", r.agent, "--name", "second", cwd=other).returncode, 0)
        run("wait", "--timeout", "1", cwd=work), run("wait", "--timeout", "1", cwd=other)  # both join from now on
        r.browser.open(r.open)

        def page(path, body):
            try:
                return json.load(r.browser.open(urllib.request.Request(r.url + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})))
            except urllib.error.HTTPError as e:
                return e.code
        def agent(folder, path, body=None):
            key = json.loads((folder / "shellphone" / "lodge.json").read_text())["key"]
            try:
                return urllib.request.urlopen(urllib.request.Request(r.url + path, data=None if body is None else json.dumps(body).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})).status
            except urllib.error.HTTPError as e:
                return e.code
        hear = lambda folder, seconds=2: run("wait", "--timeout", str(seconds), cwd=folder).stdout

        # A person starts a thread and tags one agent: that one is in, the other is not.
        top = page("/api/messages", {"text": "the plan for the launch"})["id"]
        self.assertIn("plan for the launch", hear(work, 5))  # the main chat reaches everyone, as before
        self.assertIn("plan for the launch", hear(other, 5))
        page("/api/messages", {"text": "@helper what do you make of it?", "thread": top})
        self.assertIn("what do you make of it", hear(work, 5))
        self.assertEqual(r.state()["who"], {top: {"helper": "in"}})
        self.assertEqual(r.state()["who_default"], "out")
        page("/api/messages", {"text": "and the budget, anyone?", "thread": top})
        self.assertIn("the budget", hear(work, 5))  # in the thread: it hears what is said there, tagged or not
        quiet = hear(other)
        self.assertNotIn("what do you make of it", quiet)  # not in it: nothing from the thread reaches it,
        self.assertNotIn("the budget", quiet)
        self.assertEqual(agent(other, "/lodge/thread?id=" + top), 403)  # and it can't read it

        # Paused in the thread: nothing from it, a tag included, and no posting there. Elsewhere it is on as ever.
        self.assertEqual(page("/api/thread-who", {"thread": top, "wolt": "helper", "state": "paused"}), {"thread": top, "who": {"helper": "paused"}})
        page("/api/messages", {"text": "helper, your human says your name here", "thread": top})  # its name alone doesn't bring it back
        self.assertEqual(r.state()["who"][top]["helper"], "paused")
        page("/api/messages", {"text": "@helper your human tags you here", "thread": top})  # its keeper holds the switch: a tag brings it back
        self.assertEqual(r.state()["who"][top]["helper"], "in")
        self.assertIn("tags you here", hear(work, 5))
        page("/api/thread-who", {"thread": top, "wolt": "helper", "state": "paused"})
        self.assertEqual(agent(other, "/lodge/messages", {"text": "@helper come and look", "thread": top}), 200)  # an agent speaks in a thread: it is in,
        self.assertEqual(r.state()["who"][top], {"helper": "paused", "second": "in"})  # but its tag doesn't bring a paused one back
        deaf = hear(work)
        self.assertNotIn("come and look", deaf)
        self.assertEqual(agent(work, "/lodge/messages", {"text": "let me in", "thread": top}), 403)
        self.assertEqual(agent(work, "/lodge/thread?id=" + top), 403)
        self.assertEqual(agent(work, "/lodge/thread-who", {"thread": top, "state": "in"}), 403)  # it can't bring itself back
        self.assertEqual(agent(other, "/lodge/thread-who", {"thread": top, "wolt": "helper", "state": "paused"}), 403)  # an agent has no switch over another
        self.assertEqual(agent(work, "/lodge/messages", {"text": "still here in the main chat"}), 200)
        page("/api/messages", {"text": "a word for everyone outside the thread"})
        self.assertIn("outside the thread", hear(work, 5))

        # The room shows where each agent is working: in the thread whose message reached it, not everywhere.
        self.assertEqual(agent(other, "/lodge/working", {"working": False}), 200), self.assertEqual(agent(work, "/lodge/working", {"working": False}), 200)
        self.assertEqual(r.state()["working_in"], {})
        page("/api/messages", {"text": "@second one more look, please", "thread": top})
        self.assertEqual(r.state()["working_in"], {"second": [top]})  # lit the moment it is tagged, in that thread
        self.assertEqual(r.state()["working"], {"second": True})  # older pages still see who is working
        page("/api/messages", {"text": "@second and a word in the main chat"})
        self.assertEqual(r.state()["working_in"], {"second": [top, ""]})
        self.assertEqual(agent(other, "/lodge/messages", {"text": "looked", "thread": top}), 200)
        self.assertEqual(r.state()["working_in"], {"second": [""]})  # answering in the thread ends it there only
        self.assertEqual(agent(other, "/lodge/working", {"working": True}), 200)
        self.assertEqual(r.state()["working_in"], {"second": [""]})  # "still at it" keeps what is lit, and adds nothing
        self.assertEqual(agent(other, "/lodge/working", {"working": False}), 200)
        self.assertEqual(r.state()["working_in"], {})
        hear(other, 3)

        # Brought back by the switch, it hears the thread again and reads it whole.
        self.assertEqual(page("/api/thread-who", {"thread": top, "wolt": "helper", "state": "in"})["who"]["helper"], "in")
        page("/api/messages", {"text": "welcome back to the thread", "thread": top})
        back = hear(work, 5)
        self.assertIn("welcome back to the thread", back)
        self.assertIn("come and look", back)  # what it missed is in the thread it is shown
        self.assertEqual(agent(work, "/lodge/thread?id=" + top), 200)

        # The host names a main agent: it is in every thread, and it holds the thread switches for the others.
        self.assertEqual(agent(other, "/lodge/thread-who", {"thread": top, "wolt": "helper", "state": "paused"}), 403)
        self.assertEqual(page("/api/main", {"wolt": "nobody"}), 404)
        self.assertEqual(page("/api/main", {"wolt": "second"}), {"main": "second"})
        self.assertEqual(r.state()["main"], "second")
        self.assertEqual([w.get("main") for w in r.state()["members"]["wolts"]], [None, True])
        side = page("/api/messages", {"text": "another matter entirely"})["id"]
        page("/api/messages", {"text": "@helper a thread the main agent was never tagged in", "thread": side})
        self.assertEqual(r.state()["who"][side], {"helper": "in", "second": "in"})
        heard = ""
        while "never tagged in" not in heard and (got := hear(other, 5)) and "No new messages" not in got:  # one message at a time
            heard += got
        self.assertIn("never tagged in", heard)  # it hears every thread,
        self.assertIn("You are this room's main agent", heard)  # and is told what it may do
        self.assertEqual(page("/api/thread-who", {"thread": side, "wolt": "second", "state": "paused"}), 400)  # its own switch is locked on
        self.assertIn("helper is paused in this thread", run("who", "--thread", side, "helper", "paused", cwd=other).stdout)
        self.assertEqual(r.state()["who"][side], {"helper": "paused", "second": "in"})
        self.assertIn("helper is in this thread", run("who", "--thread", side, "helper", "in", cwd=other).stdout)
        self.assertEqual(r.state()["who"][side]["helper"], "in")
        self.assertNotEqual(run("who", "--thread", side, cwd=other).returncode, 0)  # it can't take itself out
        self.assertNotEqual(run("who", "--thread", side, "second", "paused", cwd=work).returncode, 0)  # and nobody else got its rights
        self.assertEqual(agent(other, "/lodge/state", {"wolt": "helper", "paused": True}), 403)  # the room-wide switches stay with people
        self.assertEqual(page("/api/main", {"wolt": None}), {"main": None})
        self.assertEqual(agent(other, "/lodge/thread-who", {"thread": side, "wolt": "helper", "state": "paused"}), 403)
        hear(work, 3)

        # An agent takes itself out; the switch refuses what it doesn't know.
        self.assertEqual(agent(other, "/lodge/thread-who", {"thread": top}), 200)
        self.assertEqual(r.state()["who"][top]["second"], "paused")
        self.assertEqual(page("/api/thread-who", {"thread": top, "wolt": "nobody", "state": "in"}), 404)
        self.assertEqual(page("/api/thread-who", {"thread": "nope", "wolt": "helper", "state": "in"}), 404)
        self.assertEqual(page("/api/thread-who", {"thread": top, "wolt": "helper", "state": "gone"}), 400)

        # paused for the whole room is paused in every thread, and what the thread remembered comes back with it
        self.assertEqual(r.state()["who"][side]["helper"], "in")
        page("/api/wolt", {"wolt": "helper", "state": "paused"})
        self.assertEqual({t: w.get("helper") for t, w in r.state()["who"].items()}, {top: "paused", side: "paused"})
        self.assertEqual(agent(work, "/lodge/thread?id=" + side), 403)
        page("/api/wolt", {"wolt": "helper", "state": "on"})
        self.assertEqual(r.state()["who"][side]["helper"], "in")

        # only an @tag brings a paused wolt back: its human saying its name ("ok helper's paused") doesn't
        page("/api/thread-who", {"thread": side, "wolt": "helper", "state": "paused"})
        page("/api/messages", {"text": "ok helper is paused here", "thread": side})
        self.assertEqual(r.state()["who"][side]["helper"], "paused")
        page("/api/messages", {"text": "@helper come back", "thread": side})
        self.assertEqual(r.state()["who"][side]["helper"], "in")

    def test_agents_and_people_work_on_one_page(self):
        r = self.room(env={**ENV, "SHELLPHONE_ACTIVITY_AFTER": "1"})
        work, other = Path(self.tmp.name) / "a", Path(self.tmp.name) / "b"
        work.mkdir(), other.mkdir()
        self.assertEqual(run("join", r.agent, "--name", "helper", cwd=work).returncode, 0)
        self.assertEqual(run("join", r.agent, "--name", "second", cwd=other).returncode, 0)
        run("wait", "--timeout", "1", cwd=work)  # joins from now on
        r.browser.open(r.open)
        host = r.state()["members"]["people"][0]["name"]

        def ask(path, body=None, **headers):
            try:
                return json.load(r.browser.open(urllib.request.Request(r.url + path, data=None if body is None else json.dumps(body).encode(),
                                                                       headers={"Content-Type": "application/json", **headers})))
            except urllib.error.HTTPError as e:
                return e.code

        (work / "plan.html").write_text("<h1>Plan</h1><script>shellphone.onChange(() => {})</script>")
        self.assertIn("needs --title", run("post", "--page", "plan.html", cwd=work, stdin="").stderr)
        root = ask("/api/messages", {"text": "Plan here"})["id"]
        run("wait", "--timeout", "1", cwd=work)  # consume the root before the activity notice
        posted = run("post", "--thread", root, "--page", "plan.html", "--title", "Launch plan", "--line", "5 steps", cwd=work, stdin="here's the plan")
        self.assertEqual(posted.returncode, 0, posted.stderr)
        tile = [m for m in r.state()["messages"] if m.get("page")][0]
        pid = tile["page"]["id"]
        self.assertEqual((tile["kind"], tile["wolt"], tile["text"], tile["page"]), ("wolt", "helper", "here's the plan", {"id": pid, "title": "Launch plan", "line": "5 steps", "v": 1}))
        self.assertEqual(r.state()["pages"], {pid: {"v": 1, "n": 0}})
        got = ask(f"/api/page?id={pid}")
        self.assertEqual((got["html"], got["changes"], got["by"], got["v"], got["n"]), ((work / "plan.html").read_text(), [], "helper", 1, 0))

        # a person and an agent change the board: the room numbers the changes and says who made each, whatever the page claims
        self.assertEqual(ask("/api/page", {"id": pid, "op": {"add": "book the venue"}, "by": {"kind": "human", "name": "someone else"}}), {"n": 1})
        changed = run("page", "change", pid, cwd=other, stdin='{"add": "order the cake"}')
        self.assertEqual((changed.returncode, changed.stdout.strip()), (0, "change 2 made"), changed.stderr)
        changes = ask(f"/api/page?id={pid}&v=1")
        self.assertNotIn("html", changes)  # the version they have: only the changes come
        self.assertEqual([(c["n"], c["by"], c["op"]) for c in changes["changes"]],
                         [(1, {"kind": "human", "name": host}, {"add": "book the venue"}), (2, {"kind": "wolt", "name": "second"}, {"add": "order the cake"})])
        self.assertEqual([c["n"] for c in ask(f"/api/page?id={pid}&v=1&after=1")["changes"]], [2])
        listed = run("page", "changes", pid, cwd=work).stdout
        self.assertIn(f"{host}: " + '{"add": "book the venue"}', listed)
        self.assertIn('second (an agent): {"add": "order the cake"}', listed)

        # the chat hears about a burst of changes once, and the agent that posted the page is told
        deadline = time.time() + 10
        while time.time() < deadline and not [m for m in r.state()["messages"] if m["kind"] == "activity"]:
            time.sleep(0.2)
        lines = [m for m in r.state()["messages"] if m["kind"] == "activity"]
        self.assertEqual([m["text"] for m in lines], [f"{host} and second made 2 changes to Launch plan"])
        self.assertEqual(lines[0]["activity"], {"page": pid, "title": "Launch plan", "wolt": "helper", "from": 1, "to": 2,
                                                "by": [{"kind": "human", "name": host, "count": 1}, {"kind": "wolt", "name": "second", "count": 1}]})
        key = json.loads((work / "shellphone" / "lodge.json").read_text())["key"]
        thread = ask(f"/lodge/thread?id={root}", Authorization="Bearer " + key)["messages"]
        self.assertEqual([m["id"] for m in thread], [root, tile["id"]])
        self.assertEqual(lines[0]["thread"], root)
        heard = run("wait", "--timeout", "5", cwd=work).stdout
        self.assertIn("made 2 changes to Launch plan", heard)
        self.assertRegex(heard, rf"page changes {pid} --config \S+ --after 0")
        self.assertIn("Nobody is asking you anything", heard)
        ask("/api/messages", {"text": "@helper still listening?", "thread": root})
        reply = run("wait", "--timeout", "5", cwd=work)
        self.assertEqual(reply.returncode, 0, reply.stderr)
        self.assertIn("still listening?", reply.stdout)
        self.assertNotIn("made 2 changes", reply.stdout)


        # any agent in the room can put a new version; the board carries over
        (other / "v2.html").write_text("<h1>Plan, tidier</h1>")
        put = run("page", "put", pid, "v2.html", cwd=other)
        self.assertEqual(put.returncode, 0, put.stderr)
        self.assertEqual(r.state()["pages"], {pid: {"v": 2, "n": 2}})
        self.assertEqual(ask(f"/api/page?id={pid}&v=1&after=2"), {"id": pid, "title": "Launch plan", "line": "5 steps", "by": "helper", "v": 2, "n": 2, "html": "<h1>Plan, tidier</h1>", "changes": []})
        fetched = run("page", "get", pid, "--out", "now.html", cwd=work)
        self.assertEqual(fetched.returncode, 0, fetched.stderr)
        self.assertEqual((work / "now.html").read_text(), "<h1>Plan, tidier</h1>")

        # what the room refuses
        self.assertEqual(ask("/api/page?id=nope"), 404)
        self.assertEqual(ask("/api/page", {"id": "nope", "op": 1}), 404)
        self.assertEqual(ask("/api/page", {"id": pid}), 400)  # no change in it
        self.assertEqual(ask("/api/page", {"id": pid, "op": "x" * 5000}), 400)
        self.assertEqual(ask("/api/page", {"id": pid, "op": 1}, Origin="null"), 403)  # a sealed page asking the room itself
        self.assertIn("no such page", run("page", "get", "nope", cwd=work).stderr)
        (work / "big.html").write_text("x" * 300_001)
        self.assertIn("too big", run("post", "--page", "big.html", "--title", "Big", cwd=work, stdin="").stderr)
        self.assertEqual(ask("/api/wolt", {"wolt": "second", "state": "paused"}), {"wolt": "second", "paused": True})
        self.assertIn("paused", run("page", "change", pid, cwd=other, stdin="1").stderr)  # a paused agent is off here too
        self.assertIn("paused", run("page", "get", pid, cwd=other).stderr)
        self.assertEqual(r.state()["pages"], {pid: {"v": 2, "n": 2}})

    def test_a_guest_cant_pause_or_remove_an_agent(self):
        import importlib, io, contextlib
        from unittest import mock
        with mock.patch.dict(os.environ, {"SHELLPHONE_DATA": self.tmp.name}):  # the room reads where it lives when it loads
            room = importlib.import_module("room")
        self.addCleanup(sys.modules.pop, "room", None)
        self.addCleanup(lambda: room.CON and room.CON.close())
        with contextlib.redirect_stdout(io.StringIO()):
            room.add_person("sam@example.com", "Sam")
        guest = room.add_guest("Visitor")
        room.lodge_file("helper", "sam@example.com", "raccoon", None, "http://127.0.0.1:1")
        ask = lambda who, state: room.for_person(room.Request("POST", "/api/wolt", lambda limit: json.dumps({"wolt": "helper", "state": state}).encode()), who)[:2]
        self.assertEqual(ask(guest, "paused")[0], 403)
        self.assertEqual(ask(guest, "removed")[0], 403)
        self.assertEqual([w["wolt"] for w in room.members()["wolts"]], ["helper"])
        self.assertEqual(ask("sam@example.com", "paused"), (200, {"wolt": "helper", "paused": True}))

    def test_only_the_host_or_its_own_keeper_changes_an_agent(self):
        import importlib, io, contextlib
        from unittest import mock
        with mock.patch.dict(os.environ, {"SHELLPHONE_DATA": self.tmp.name}):
            room = importlib.import_module("room")
        self.addCleanup(sys.modules.pop, "room", None)
        self.addCleanup(lambda: room.CON and room.CON.close())
        with contextlib.redirect_stdout(io.StringIO()):
            for email, name in (("sam@example.com", "Sam"), ("kim@example.com", "Kim"), ("lee@example.com", "Lee")):
                room.add_person(email, name)  # Sam opened the room: its host
        room.lodge_file("sams", "sam@example.com", "raccoon", None, "http://127.0.0.1:1")
        room.lodge_file("kims", "kim@example.com", "otter", None, "http://127.0.0.1:1")
        ask = lambda who, wolt, state: room.for_person(room.Request("POST", "/api/wolt", lambda limit: json.dumps({"wolt": wolt, "state": state}).encode()), who)[0]
        self.assertEqual(room.host(), "sam@example.com")
        self.assertEqual(room.for_person(room.Request("GET", "/api/state", lambda limit: b""), "kim@example.com")[1]["host"], "sam@example.com")
        for state in ("paused", "on", "removed"):  # a member who is neither the host nor the keeper: nothing
            self.assertEqual(ask("lee@example.com", "kims", state), 403)
            self.assertEqual(ask("kim@example.com", "sams", state), 403)
            self.assertEqual(ask("lee@example.com", "nobody", state), 403)  # and isn't told which agents exist
        self.assertEqual([(w["wolt"], bool(w.get("paused"))) for w in room.members()["wolts"]], [("sams", False), ("kims", False)])
        self.assertEqual(ask("kim@example.com", "kims", "paused"), 200)  # a keeper, their own
        self.assertEqual(ask("sam@example.com", "kims", "on"), 200)      # the host, anyone's
        self.assertEqual(ask("sam@example.com", "nobody", "on"), 404)
        self.assertEqual(ask("kim@example.com", "kims", "removed"), 200)
        self.assertEqual(ask("sam@example.com", "sams", "removed"), 200)
        self.assertEqual(room.members()["wolts"], [])

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

    def test_a_room_opens_on_a_computer_with_no_git(self):
        r = self.room(env={**ENV, "PATH": self.tmp.name})  # nothing on the path at all
        self.assertEqual(r.browser.open(r.open).status, 200)
        self.assertIn("Room closed and deleted.", r.close())

    def test_closing_deletes_the_room(self):
        for sig in (signal.SIGINT, signal.SIGTERM):
            r = self.room()
            r.browser.open(r.open)
            data = self.data_dir(r)
            self.assertTrue((data / "room.db").is_file())
            self.assertIn("Room closed and deleted.", r.close(sig))
            self.assertFalse(data.exists())

    def test_a_second_stop_signal_cant_interrupt_the_closing(self):
        for burst in ([signal.SIGINT] * 6, [signal.SIGTERM] * 6, [signal.SIGTERM, signal.SIGINT] * 3):
            r = self.room()
            r.browser.open(r.open)
            data = self.data_dir(r)
            for sig in burst:  # a double Ctrl-C, or a stop sent to a whole process group
                r.proc.send_signal(sig)
            out = r.proc.communicate(timeout=10)[0]
            self.assertIn("Room closed and deleted.", out)
            self.assertNotIn("Traceback", out)
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

    def test_a_kept_room_is_never_swept_even_when_it_looks_like_a_throwaway_one(self):
        kept = Path(tempfile.mkdtemp(prefix="shellphone-room-saved-"))  # the worst place and name to keep a room
        self.addCleanup(__import__("shutil").rmtree, kept, True)
        r = self.room("--keep", str(kept))
        r.browser.open(r.open)
        r.browser.open(urllib.request.Request(r.url + "/api/messages", data=json.dumps({"text": "keep me"}).encode(),
                                              headers={"Content-Type": "application/json"}))
        r.proc.kill()  # a crash: nothing gets tidied
        r.proc.communicate()
        self.room()  # another room starts and sweeps
        self.assertTrue((kept / "room.db").is_file())
        again = self.room("--keep", str(kept))  # and the kept room opens again with what was said
        again.browser.open(again.open)
        self.assertIn("keep me", [m.get("text") for m in again.state()["messages"]])

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
