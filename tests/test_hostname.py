"""A room shared at a fixed address of its host's own (`shellphone room --hostname`): its links are its own address, they
outlive a restart, and nothing goes to the site or starts a quick tunnel. No tunnel and no network: the room is asked
over HTTP on this computer, under that name, as the host's named tunnel would pass requests on."""
import argparse, http.client, json, sys, tempfile, threading, unittest
from pathlib import Path
from unittest.mock import patch

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from shellphone import cli, outside
from shellphone.outside import Outside

NAME = "shell.example.com"


def nowhere(*a, **kw):
    raise AssertionError("a room at a fixed address calls nobody")


class Fixed(unittest.TestCase):
    def setUp(self):
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        p = patch.dict("os.environ", {"SHELLPHONE_HOME": home.name})
        p.start()
        self.addCleanup(p.stop)
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        for target in ("urllib.request.urlopen", "shellphone.outside.STAY.open", "shellphone.outside.Tunnel.start"):
            p = patch(target, nowhere)
            p.start()
            self.addCleanup(p.stop)

    def open_room(self):
        r, data, url, token, code, server = cli.start(argparse.Namespace(keep=self.dir.name, port=0, name="Hostess"))
        self.addCleanup(server.server_close)
        out = Outside(r, data, True, "https://site.example", server.server_address[1], cli.HOST_EMAIL, say=lambda *a, **kw: None, hostname=NAME.upper())
        r.LINKER = r.OUTSIDE = out
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        return r, out, server.server_address[1]

    def ask(self, port, method, path, cookie=None, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        h = {"Host": NAME, **({"Origin": f"https://{NAME}", "Content-Type": "application/json"} if method == "POST" else {}), **({"Cookie": cookie} if cookie else {})}
        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
        res = conn.getresponse()
        raw, cookie = res.read(), res.getheader("Set-Cookie") or ""
        conn.close()
        return res.status, raw.decode(errors="replace"), cookie.split(";")[0]

    def test_its_links_are_its_own_address_and_nothing_else_is_called(self):
        r, out, port = self.open_room()
        status, info = out.on()
        self.assertEqual(status, 200)
        self.assertEqual(info["link"], f"https://{NAME}/enter#k.{out.host_token}")
        self.assertTrue(info["invite"].startswith(f"https://{NAME}/enter#i."))
        self.assertEqual(out.host, NAME)
        steps = out.agent_steps(cli.HOST_EMAIL, out.host_token)
        self.assertIn(f"https://{NAME}/#", steps)
        self.assertNotIn("/t/", steps + info["link"] + info["invite"])

    def test_the_same_links_open_the_room_after_a_restart(self):
        _, first, _ = self.open_room()
        link = first.on()[1]["link"]
        first.close()
        _, again, port = self.open_room()
        self.assertEqual(again.on()[1]["link"], link)
        status, page, cookie = self.ask(port, "POST", "/api/enter", body={"k": link.split("#k.")[1]})
        self.assertEqual(status, 200)
        self.assertTrue(cookie.startswith("spo="))
        self.assertEqual(json.loads(self.ask(port, "GET", "/api/state", cookie=cookie)[1])["me"], cli.HOST_EMAIL)

    def test_the_door_sends_people_back_to_the_same_address_and_asks_for_the_offline_page(self):
        _, out, port = self.open_room()
        out.on()
        status, page, _ = self.ask(port, "GET", "/enter")
        self.assertEqual(status, 200)
        self.assertIn(f'const SIGN = "https://{NAME}/enter", OFFLINE = true;', page)
        self.assertEqual(self.ask(port, "GET", "/api/state", cookie=None)[0], 403)

    def test_the_home_screen_icon_starts_from_the_persons_own_link(self):
        _, out, port = self.open_room()
        key = out.on()[1]["link"].split("#k.")[1]
        cookie = self.ask(port, "POST", "/api/enter", body={"k": key})[2]
        status, raw, _ = self.ask(port, "GET", "/manifest.webmanifest", cookie=cookie)
        self.assertEqual(status, 200)
        m = json.loads(raw)
        self.assertEqual((m["start_url"], m["scope"]), (f"/enter#k.{key}", "/"))
        self.assertEqual(self.ask(port, "GET", "/manifest.webmanifest")[0], 403)  # nobody's key to anybody without one

    def test_stopping_throws_the_keys_away_and_tells_nobody(self):
        _, out, port = self.open_room()
        key = out.on()[1]["link"].split("#k.")[1]
        self.assertEqual(out.off()[0], 200)
        self.assertFalse((Path(self.dir.name) / outside.FILE).exists())
        self.assertEqual(self.ask(port, "POST", "/api/enter", body={"k": key})[0], 403)

    def test_a_quick_tunnels_room_still_asks_for_no_offline_page(self):
        out = Outside(None, Path(self.dir.name), False, "https://site.example", 1, cli.HOST_EMAIL)
        out.room = "r" * 16
        self.assertIn("OFFLINE = false;", out.enter_page())
        self.assertIn('"https://site.example/t/' + "r" * 16 + '"', out.enter_page())


class Asked(unittest.TestCase):
    def setUp(self):
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        p = patch.dict("os.environ", {"SHELLPHONE_HOME": home.name})
        p.start()
        self.addCleanup(p.stop)

    def room(self, **kw):
        a = argparse.Namespace(**{"keep": None, "port": 4090, "name": "x", "share": False, "via": None, "relay": None, "hostname": NAME, **kw})
        with self.assertRaises(SystemExit) as got:
            cli.room(a)
        return str(got.exception)

    def test_a_room_listens_on_this_computer_unless_told_its_in_a_container(self):
        self.assertEqual(cli.bind_address(), "127.0.0.1")
        with patch.dict("os.environ", {"SHELLPHONE_BIND": "0.0.0.0"}):
            self.assertEqual(cli.bind_address(), "0.0.0.0")
        with patch.dict("os.environ", {"SHELLPHONE_BIND": "192.168.1.5"}), self.assertRaises(SystemExit):
            cli.bind_address()

    def test_it_needs_a_kept_room_a_real_name_and_its_own_port(self):
        self.assertIn("--keep", self.room())
        self.assertIn("a name like", self.room(hostname="not_a.name", keep="/tmp/x"))
        self.assertIn("--via relay", self.room(keep="/tmp/x", via="relay"))
        with patch.object(cli, "free_port", lambda wanted: wanted + 1):
            self.assertIn("is taken", self.room(keep="/tmp/x"))


if __name__ == "__main__":
    unittest.main()
