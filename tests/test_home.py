"""Rooms at addresses of your own (shellphone/home.py): names under the domain set up here, a port each that is kept,
and the tunnel's settings that list exactly those. No cloudflared and no network: the setup is written as `setup` would."""
import argparse, json, os, subprocess, sys, tempfile, threading, time, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import home


class Home(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.dir = Path(d.name)
        p = patch.dict(os.environ, {"SHELLPHONE_HOME": str(self.dir / "home")})
        p.start()
        self.addCleanup(p.stop)

    def set_up(self, domain="example.com"):
        (home.home() / home.CONFIG).write_text(json.dumps({"name": "shellphone", "tunnel": "0" * 8 + "-0000-0000-0000-" + "0" * 12, "credentials": "/creds.json", "domain": domain}))

    def test_a_short_name_needs_a_domain_and_then_goes_under_it(self):
        with self.assertRaises(SystemExit) as got:
            home.full_name("demo")
        self.assertIn("tunnel setup", str(got.exception))
        self.set_up()
        self.assertEqual(home.full_name("Demo"), "demo.example.com")
        self.assertEqual(home.full_name("https://shell.elsewhere.org/"), "shell.elsewhere.org")
        self.assertTrue(home.ours("demo.example.com"))
        self.assertFalse(home.ours("demo.example.com.evil.org"))
        self.assertFalse(home.ours("notexample.com"))

    def test_each_room_gets_a_port_of_its_own_and_keeps_it(self):
        self.set_up()
        free = lambda p: p != home.FIRST_PORT + 1  # something else already listens there
        a = home.claim("a.example.com", self.dir / "a", free)
        b = home.claim("b.example.com", self.dir / "b", free)
        self.assertEqual((a, b), (home.FIRST_PORT, home.FIRST_PORT + 2))
        self.assertEqual(home.claim("a.example.com", self.dir / "a", lambda p: False), a)  # it had one: the same, whatever is free now
        settings = (home.home() / home.SETTINGS).read_text()
        self.assertIn('  - hostname: "*.example.com"\n', settings)
        self.assertNotIn("127.0.0.1", settings)  # only the door, never a port another program could take
        self.assertTrue(settings.rstrip().endswith("- service: http_status:404"))  # any other name: nothing

    def test_a_room_that_asks_for_its_port_keeps_it(self):
        self.set_up()
        self.assertEqual(home.claim("lodge.example.com", self.dir / "l", lambda p: True, 4398), 4398)
        self.assertEqual(home.claim("lodge.example.com", self.dir / "l", lambda p: True), 4398)
        with self.assertRaises(SystemExit):
            home.claim("other.example.com", self.dir / "o", lambda p: True, 4398)

    def test_one_address_per_room_and_one_room_per_address(self):
        self.set_up()
        home.claim("a.example.com", self.dir / "a", lambda p: True)
        with self.assertRaises(SystemExit):
            home.claim("other.example.com", self.dir / "a", lambda p: True)
        with self.assertRaises(SystemExit):
            home.claim("a.example.com", self.dir / "b", lambda p: True)

    def test_a_listed_room_cant_move_onto_another_rooms_port(self):
        self.set_up()
        a = home.claim("a.example.com", self.dir / "a", lambda p: True)
        b = home.claim("b.example.com", self.dir / "b", lambda p: True)
        before = (home.home() / home.SETTINGS).read_text()
        with self.assertRaises(SystemExit):
            home.claim("a.example.com", self.dir / "a", lambda p: True, b)
        with self.assertRaises(SystemExit):  # nor onto a port something else on this computer has
            home.claim("a.example.com", self.dir / "a", lambda p: False, b + 1)
        self.assertEqual({h: r["port"] for h, r in home.rooms().items()}, {"a.example.com": a, "b.example.com": b})
        self.assertEqual((home.home() / home.SETTINGS).read_text(), before)

    def test_rooms_opening_at_once_get_ports_of_their_own_and_both_stay_listed(self):
        self.set_up()
        read = home.rooms
        def slow():  # every reader dawdles between reading the list and writing it back: without the lock, both get one port
            got = read()
            time.sleep(0.3)
            return got
        got = {}
        with patch.object(home, "rooms", slow):
            ts = [threading.Thread(target=lambda n=n: got.__setitem__(n, home.claim(f"{n}.example.com", self.dir / n, lambda p: True))) for n in ("a", "b")]
            [t.start() for t in ts]
            [t.join() for t in ts]
        self.assertNotEqual(got["a"], got["b"])
        self.assertEqual(sorted(home.rooms()), ["a.example.com", "b.example.com"])

    def test_a_tunnel_that_wont_stop_is_killed_not_left_to_end_the_watch(self):
        proc = subprocess.Popen([sys.executable, "-c", "import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print(flush=True); time.sleep(60)"], stdout=subprocess.PIPE)
        proc.stdout.readline()  # it ignores being asked to stop from here on
        home._end(proc, grace=0.5)
        proc.stdout.close()
        self.assertIsNotNone(proc.poll())

    def test_removing_a_name_takes_it_off_the_tunnel(self):
        self.set_up()
        home.claim("a.example.com", self.dir / "a", lambda p: True)
        home.claim("b.example.com", self.dir / "b", lambda p: True)
        home.remove(argparse.Namespace(hostname="a"))
        self.assertEqual(list(home.rooms()), ["b.example.com"])

    def test_listing_a_room_never_restarts_the_tunnel_for_the_others(self):
        self.set_up()
        home.claim("a.example.com", self.dir / "a", lambda p: True)
        before = (home.home() / home.SETTINGS).stat().st_mtime_ns
        time.sleep(0.02)
        home.claim("b.example.com", self.dir / "b", lambda p: True)
        home.remove(argparse.Namespace(hostname="a"))
        self.assertEqual((home.home() / home.SETTINGS).stat().st_mtime_ns, before)

    def test_only_names_the_wildcard_covers(self):
        self.set_up()
        for name in ("example.com", "x.y.example.com"):
            with self.assertRaises(SystemExit):
                home.claim(name, self.dir / "r", lambda p: True)

    def test_a_room_elsewhere_gets_a_name_and_is_never_opened_from_here(self):
        self.set_up()
        a = home.claim("a.example.com", self.dir / "a", lambda p: True)
        add = lambda name, port: home.add(argparse.Namespace(hostname=name, port=port))
        with self.assertRaises(SystemExit) as got:  # nothing that isn't that room gets a public name
            add("box", 4501)
        self.assertIn("no shared room", str(got.exception))
        p = patch.object(home, "answers_as_room", lambda host, port: True)
        p.start()
        self.addCleanup(p.stop)
        add("box", 4501)
        self.assertEqual(home.rooms()["box.example.com"], {"port": 4501, "keep": None})
        for name, port in (("other", 4501), ("a", 4502), ("box.elsewhere.org", 4503), ("low", 80)):  # its port, a room here, not our domain, not a port for this
            with self.assertRaises(SystemExit):
                add(name, port)
        with self.assertRaises(SystemExit) as got:  # a room here can't take the name either
            home.claim("box.example.com", self.dir / "b", lambda p: True)
        self.assertIn("elsewhere", str(got.exception))
        add("box", 4510)  # moving it is just adding it again
        self.assertEqual(home.rooms()["box.example.com"]["port"], 4510)
        opened = []
        with patch.object(home, "_cloudflared", lambda: "cloudflared"), patch("shellphone.cli.open_rooms", lambda: []), \
             patch.object(home.subprocess, "Popen", lambda cmd, **kw: opened.append(cmd) or (_ for _ in ()).throw(KeyboardInterrupt)), \
             patch.object(home.signal, "signal", lambda *a: None), patch("shellphone.door.Door"):
            (self.dir / "a").mkdir()
            try:
                home.run(argparse.Namespace())
            except KeyboardInterrupt:
                pass
        self.assertEqual(len(opened), 1)
        self.assertIn(str((self.dir / "a").resolve()), opened[0])  # only the room kept here

    def test_a_name_cant_write_lines_of_its_own_into_the_tunnels_settings(self):
        self.set_up()
        bad = "x.example.com\n    service: http://127.0.0.1:80\n  - hostname: y.example.com"
        with patch.object(home, "answers_as_room", lambda host, port: True):
            for name in (bad, "x y.example.com", "x\ny", "*.example.com", "x: y"):
                with self.assertRaises(SystemExit, msg=repr(name)):
                    home.add(argparse.Namespace(hostname=name, port=4501))
        self.assertEqual(home.rooms(), {})
        self.assertFalse((home.home() / home.SETTINGS).exists())

    def test_what_is_kept_is_private(self):
        self.set_up()
        home.claim("a.example.com", self.dir / "a", lambda p: True)
        self.assertEqual(home.home().stat().st_mode & 0o777, 0o700)
        for name in (home.ROOMS, home.SETTINGS):
            self.assertEqual((home.home() / name).stat().st_mode & 0o077, 0, name)


if __name__ == "__main__":
    unittest.main()
