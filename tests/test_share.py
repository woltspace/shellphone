"""The room's one switch for sharing (cli.Share) over the ways there are to share it: which way a plain "share" takes,
that one way is on at a time, and that stopping ends whatever was shared or kept. Stand-ins for the ways: no network."""
import argparse, json, sys, unittest, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import cli  # noqa: E402


class Way:
    """A way to share a room, as the switch sees one: info, on, off, close, saved."""

    def __init__(self, name, kept=False, fails=False):
        self.name, self.open, self.kept, self.fails, self.calls = name, False, kept, fails, []

    def info(self):
        return {"linked": True, "relay": "site.example", "link": self.name + "-link"} if self.open else {"linked": False, "relay": "site.example"}

    def saved(self):
        return {"kept": True} if self.kept else None

    def on(self):
        self.calls.append("on")
        if self.fails:
            return 502, {"error": "no way through", "linked": False}
        self.open = self.kept = True
        return 200, self.info()

    def off(self):
        self.calls.append("off")
        self.open = self.kept = False
        return 200, self.info()

    def close(self):
        self.calls.append("close")
        self.open = False


def share(first="relay", **kw):
    ways = {"relay": Way("relay", **kw.get("relay", {})), "tunnel": Way("tunnel", **kw.get("tunnel", {}))}
    return cli.Share(ways, first), ways


class WhichWay(unittest.TestCase):
    def test_a_plain_share_takes_the_way_the_room_was_opened_with(self):
        for first in ("relay", "tunnel"):
            s, ways = share(first)
            self.assertEqual(s.info()["via"], first)
            status, info = s.on()
            self.assertEqual((status, info["linked"], info["via"], info["link"]), (200, True, first, first + "-link"))
            self.assertEqual([w for w in ways if ways[w].open], [first])

    def test_the_host_can_name_the_other_way(self):
        s, ways = share("relay")
        self.assertEqual(s.on("tunnel")[1]["via"], "tunnel")
        self.assertEqual((ways["relay"].calls, ways["tunnel"].open), ([], True))
        self.assertEqual(s.info()["via"], "tunnel")

    def test_a_kept_room_comes_back_the_way_it_was_shared(self):
        s, ways = share("relay", tunnel={"kept": True})
        self.assertEqual(s.saved(), "tunnel")
        self.assertEqual(s.on()[1]["via"], "tunnel")
        self.assertFalse(ways["relay"].open)

    def test_one_way_at_a_time(self):
        s, ways = share("relay")
        s.on()
        status, info = s.on("tunnel")
        self.assertEqual((status, info["linked"]), (409, True))
        self.assertIn("stop sharing it first", info["error"])
        self.assertEqual(ways["tunnel"].calls, [])
        self.assertEqual(s.on("relay")[0], 200)  # asked again the way it is: the same share
        self.assertEqual(ways["relay"].calls, ["on"])

    def test_a_kept_share_is_not_dropped_for_another_way_without_a_word(self):
        s, ways = share("relay", relay={"kept": True})
        status, info = s.on("tunnel")
        self.assertEqual((status, info["linked"]), (409, False))
        self.assertIn("share --stop", info["error"])
        self.assertEqual((ways["relay"].kept, ways["tunnel"].calls), (True, []))

    def test_links_kept_from_both_ways_are_never_chosen_between_without_a_word(self):
        for first in ("relay", "tunnel"):
            for via in (None, "relay", "tunnel"):
                s, ways = share(first, relay={"kept": True}, tunnel={"kept": True})
                status, info = s.on(via)
                self.assertEqual((status, info["linked"]), (409, False))
                self.assertIn("share --stop", info["error"])
                self.assertEqual([w.calls for w in ways.values()], [[], []])  # neither was started
        self.assertEqual(s.off()[0], 200)  # the way out: stop, which ends both
        self.assertEqual(s.on()[0], 200)

    def test_a_share_that_fails_leaves_the_room_as_it_was(self):
        s, ways = share("relay", relay={"fails": True})
        status, info = s.on()
        self.assertEqual((status, info["linked"], info["error"]), (502, False, "no way through"))
        self.assertEqual(s.info()["linked"], False)


class Stop(unittest.TestCase):
    def test_stop_ends_what_is_shared_and_what_was_kept(self):
        s, ways = share("relay", tunnel={"kept": True})
        s.on()
        self.assertTrue(ways["tunnel"].open)
        status, info = s.off()
        self.assertEqual((status, info["linked"]), (200, False))
        self.assertEqual((ways["tunnel"].open, ways["tunnel"].kept), (False, False))
        self.assertEqual(s.saved(), None)

    def test_a_stop_that_is_not_finished_is_said_whichever_way_comes_next(self):
        s, ways = share("relay")
        ways["tunnel"].info = lambda: {"linked": False, "relay": "site.example", "note": "the site couldn't be told yet"}
        self.assertEqual(s.info()["note"], "the site couldn't be told yet")
        self.assertEqual(s.info()["via"], "relay")

    def test_a_way_that_cant_be_stopped_doesnt_keep_the_next_one_open(self):
        s, ways = share("relay", tunnel={"kept": True})
        s.on()
        self.assertTrue(ways["tunnel"].open)

        def broken():
            raise OSError("the kept link's file can't be removed")
        ways["relay"].off = broken
        status, info = s.off()
        self.assertEqual(status, 500)
        self.assertIn("can't be removed", info["error"])
        self.assertIn("sealed relay", info["error"])  # which way it was
        self.assertEqual((ways["tunnel"].open, ways["tunnel"].calls[-1], info["linked"]), (False, "off", False))

    def test_a_stop_that_fails_says_what_is_still_shared(self):
        s, ways = share("tunnel")
        s.on()
        ways["tunnel"].off = lambda: (500, {"error": "the tunnel wouldn't close", "linked": True})
        status, info = s.off()
        self.assertEqual((status, info["linked"], info["error"]), (500, True, "the tunnel wouldn't close"))

    def test_closing_the_room_closes_every_way(self):
        s, ways = share("relay")
        s.on()
        s.close()
        self.assertEqual([w.calls[-1] for w in ways.values()], ["close", "close"])


class AtTheDoor(unittest.TestCase):
    """The room's own call for the switch: only its ways are taken, and only to turn sharing on."""

    def setUp(self):
        self.r, self.data, self.url, self.token, code, self.server = cli.start(argparse.Namespace(keep=None, port=0, name="Hostess"))
        self.share, self.ways = share("relay")
        self.r.LINKER = self.share
        import threading
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close()
        import shutil
        shutil.rmtree(self.data, ignore_errors=True)

    def post(self, body):
        port = self.server.server_address[1]
        req = urllib.request.Request(f"{self.url}/api/link", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Cookie": f"sp{port}={self.token}"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_the_way_is_one_of_the_rooms_own(self):
        for bad in ("carrier-pigeon", "", 7, ["tunnel"]):
            self.assertEqual(self.post({"on": True, "via": bad})[0], 400, bad)
        self.assertEqual(self.post({"on": False, "via": "tunnel"})[0], 400)
        self.assertEqual([w.calls for w in self.ways.values()], [[], []])
        status, info = self.post({"on": True, "via": "tunnel"})
        self.assertEqual((status, info["via"], info["linked"]), (200, "tunnel", True))
        self.assertEqual(self.post({"on": False})[1]["linked"], False)


if __name__ == "__main__":
    unittest.main()
