"""A guest brings their own agent, from another computer, through a real relay (experimental). RELAY_E2E=1 to run."""
import json, os, re, secrets, subprocess, sys, tempfile, time, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_pipe import E2E, REPO, start_relay, stop_relay  # noqa: E402
from shellphone import seal  # noqa: E402


class Page:
    """A page's calls through the relay, as the browser makes them."""
    def __init__(self, base, room, kind, secret, auth):
        from websockets.sync.client import connect
        self.ws = connect(base.replace("http", "ws", 1) + f"/r/{seal.b64e(room)}/ws")
        c = seal.Client(room, secret, kind)
        self.ws.send(json.dumps({"data": c.hi()}))
        while True:
            f = json.loads(self.ws.recv(timeout=10))
            if isinstance(f.get("data"), str):
                self.s = c.hello(f["data"])
                break
        self.n, self.auth = 0, auth

    def ask(self, method, path, body=None):
        self.n += 1
        self.ws.send(json.dumps({"data": self.s.seal({"t": "req", "id": self.n, "method": method, "path": path, "body": body, "auth": self.auth})}))
        while True:
            m = self.s.open(json.loads(self.ws.recv(timeout=20))["data"])
            if m.get("t") == "res" and m.get("id") == self.n:
                return m["status"], m["body"]


@E2E
class GuestAgents(unittest.TestCase):
    def test_a_guest_brings_their_own_agent_and_the_host_keeps_control(self):
        relay, base = start_relay("OPEN_HOSTING:1")
        self.addCleanup(stop_relay, relay)
        work = Path(tempfile.mkdtemp())
        room, secret, token = secrets.token_bytes(16), secrets.token_bytes(32), secrets.token_urlsafe(24)
        log = open(work / "host.log", "w")
        host_proc = subprocess.Popen([sys.executable, "-m", "shellphone.cli", "host", f"{base}/r/{seal.b64e(room)}#h.{seal.b64e(secret)}.{token}"],
                                     cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
        self.addCleanup(host_proc.wait, 10)
        self.addCleanup(host_proc.terminate)
        end = time.time() + 60
        while "room is up" not in (work / "host.log").read_text() and time.time() < end:
            time.sleep(0.5)

        def sh(*args, input=None):
            p = subprocess.run([sys.executable, "-m", "shellphone.cli", *args], cwd=REPO, capture_output=True, text=True, input=input, timeout=120)
            return p.returncode, p.stdout + p.stderr

        host = Page(base, room, "h", secret, token)
        _, isec, itok = host.ask("GET", "/api/invite")[1]["key"].split(".")
        isec = seal.b64d(isec, 32)

        def guest(name):
            return Page(base, room, "i", isec, Page(base, room, "i", isec, itok).ask("POST", "/api/guest", {"name": name})[1]["token"])

        def agent_link(person):
            status, got = person.ask("POST", "/api/agent-invite", {})
            self.assertEqual(status, 200, got)
            return re.search(r"join '([^']+)'", got["text"]).group(1)

        sam = guest("Sam")
        link = agent_link(sam)
        self.assertIn("#a.", link)
        cfg = work / "sam" / "shellphone"
        code, out = sh("join", link, "--name", "samsagent", "--dir", str(cfg))
        self.assertEqual(code, 0, out)
        self.assertNotEqual(sh("join", link, "--name", "again", "--dir", str(work / "x"))[0], 0)  # the code works once
        cfg = str(cfg / "lodge.json")
        listening = subprocess.Popen([sys.executable, "-m", "shellphone.cli", "wait", "--config", cfg, "--timeout", "40"], cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        time.sleep(4)
        sam.ask("POST", "/api/messages", {"text": "@samsagent hi from Sam"})
        self.assertIn("hi from Sam", listening.communicate(timeout=60)[0])
        self.assertEqual(sh("post", "--config", cfg, input="hello Sam")[0], 0)
        self.assertTrue(any(m.get("text") == "hello Sam" for m in host.ask("GET", "/api/state?after=0")[1]["messages"]))

        host.ask("POST", "/api/guest-agents", {"on": False})  # the host's switch: guests' agents go quiet at once
        code, out = sh("post", "--config", cfg, input="should not land")
        self.assertNotEqual(code, 0)
        self.assertIn("turned off", out)
        self.assertEqual(sam.ask("POST", "/api/agent-invite", {})[0], 403)
        host.ask("POST", "/api/guest-agents", {"on": True})

        eve = guest("Eve")
        eve_cfg = work / "eve" / "shellphone"
        self.assertEqual(sh("join", agent_link(eve), "--name", "evebot", "--dir", str(eve_cfg))[0], 0)
        self.assertEqual(sam.ask("POST", "/api/wolt", {"wolt": "evebot", "state": "removed"})[0], 403)  # not Sam's to remove
        as_agent = Page(base, room, "i", isec, json.loads((eve_cfg / "lodge.json").read_text())["key"])
        self.assertEqual(as_agent.ask("GET", "/api/state?after=0")[0], 403)  # an agent's key is not a person's
        self.assertEqual(as_agent.ask("POST", "/lodge/files", {})[0], 404)  # and only the short list of agent calls is open

        status, chat = sam.ask("POST", "/api/messages", {"text": "a chat of Sam's"})
        self.assertEqual(status, 200, chat)
        switch = lambda person, wolt, state: person.ask("POST", "/api/thread-who", {"thread": chat["id"], "wolt": wolt, "state": state})[0]
        self.assertEqual(switch(sam, "samsagent", "paused"), 200)  # in a chat, Sam pauses Sam's own agent
        self.assertEqual(sam.ask("GET", "/api/state?after=0")[1]["who"][chat["id"]]["samsagent"], "paused")
        self.assertEqual(switch(sam, "samsagent", "in"), 200)  # and brings it back
        self.assertEqual(switch(sam, "evebot", "paused"), 403)  # but not Eve's
        self.assertEqual(sam.ask("POST", "/api/wolt", {"wolt": "samsagent", "state": "removed"})[0], 200)  # Sam's own: Sam may
        self.assertNotEqual(sh("post", "--config", cfg, input="gone?")[0], 0)

    def test_an_agent_from_an_old_link_is_not_let_back_in_by_itself(self):
        relay, base = start_relay("OPEN_HOSTING:1")
        self.addCleanup(stop_relay, relay)
        work = Path(tempfile.mkdtemp())
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "SHELLPHONE_RELAY": base}
        log = open(work / "room.log", "w")
        room_proc = subprocess.Popen([sys.executable, "-m", "shellphone.cli", "room", "--port", "0"], cwd=REPO, stdout=log, stderr=subprocess.STDOUT, env=env)
        self.addCleanup(room_proc.wait, 10)
        self.addCleanup(room_proc.terminate)
        end = time.time() + 60
        while "Press Ctrl-C" not in (work / "room.log").read_text() and time.time() < end:
            time.sleep(0.2)
        port = re.search(r"Open the chat:\s+http://127\.0\.0\.1:(\d+)", (work / "room.log").read_text()).group(1)

        def sh(*args, input=None):
            p = subprocess.run([sys.executable, "-m", "shellphone.cli", *args], cwd=REPO, capture_output=True, text=True, input=input, timeout=120)
            return p.returncode, p.stdout + p.stderr

        def linked():
            code, out = sh("link", "--port", port)
            self.assertEqual(code, 0, out)
            room, hsec, htok = re.search(r"/r/([\w-]{22})#h\.([\w-]+)\.([\w-]+)", out).groups()
            isec, itok = re.search(r"#i\.([\w-]+)\.([\w-]+)", out).groups()
            return seal.b64d(room, 16), seal.b64d(hsec, 32), htok, seal.b64d(isec, 32), itok

        room, hsec, htok, isec, itok = linked()
        host = Page(base, room, "h", hsec, htok)
        link = re.search(r"join '([^']+)'", host.ask("POST", "/api/agent-invite", {})[1]["text"]).group(1)
        cfg = work / "far" / "shellphone"
        code, out = sh("join", link, "--name", "faraway", "--dir", str(cfg))
        self.assertEqual(code, 0, out)
        key = json.loads((cfg / "lodge.json").read_text())["key"]
        self.assertEqual(sh("post", "--config", str(cfg / "lodge.json"), input="hello from far away")[0], 0)
        self.assertEqual(Page(base, room, "i", isec, key).ask("POST", "/lodge/working", {})[0], 200)

        self.assertEqual(sh("unlink", "--port", port)[0], 0)
        self.assertNotEqual(sh("post", "--config", str(cfg / "lodge.json"), input="still there?")[0], 0)  # the address it knows is gone
        room2, hsec2, htok2, isec2, itok2 = linked()
        self.assertNotEqual(room2, room)
        # even holding the new link's invite secret, the key from the old link opens nothing
        status, got = Page(base, room2, "i", isec2, key).ask("POST", "/lodge/working", {})
        self.assertEqual(status, 401, got)
        self.assertIn("unlinked since you joined", got["error"])
        # its human brings it back with a fresh message
        host2 = Page(base, room2, "h", hsec2, htok2)
        texts = [m.get("text") for m in host2.ask("GET", "/api/state?after=0")[1]["messages"]]
        self.assertIn("hello from far away", texts)  # what it said stays


if __name__ == "__main__":
    unittest.main()
