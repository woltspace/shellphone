"""Rooms at addresses of your own (shellphone/home.py): names under the domain set up here, a port each that is kept,
and the tunnel's settings that list exactly those. No cloudflared and no network: the setup is written as `setup` would."""
import argparse, json, os, sys, tempfile, unittest
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
        self.assertIn(f"  - hostname: a.example.com\n    service: http://127.0.0.1:{a}\n", settings)
        self.assertIn(f"  - hostname: b.example.com\n    service: http://127.0.0.1:{b}\n", settings)
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

    def test_removing_a_name_takes_it_off_the_tunnel(self):
        self.set_up()
        home.claim("a.example.com", self.dir / "a", lambda p: True)
        home.claim("b.example.com", self.dir / "b", lambda p: True)
        home.remove(argparse.Namespace(hostname="a"))
        settings = (home.home() / home.SETTINGS).read_text()
        self.assertNotIn("a.example.com", settings)
        self.assertIn("b.example.com", settings)
        self.assertEqual(list(home.rooms()), ["b.example.com"])

    def test_what_is_kept_is_private(self):
        self.set_up()
        home.claim("a.example.com", self.dir / "a", lambda p: True)
        self.assertEqual(home.home().stat().st_mode & 0o777, 0o700)
        for name in (home.ROOMS, home.SETTINGS):
            self.assertEqual((home.home() / name).stat().st_mode & 0o077, 0, name)


if __name__ == "__main__":
    unittest.main()
