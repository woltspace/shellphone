"""What a kept room writes down about its link, and that an unlinked room's link is never written again.
    python3 -m unittest tests.test_linker"""
import json, os, sys, tempfile, threading, time, unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import cli


class Fake:
    """As much of a Link as Linker.save reads."""
    relay, token, invite_token = "http://relay.example", "host-token", "invite-token"
    room_id, secret, invite_secret = b"r" * 16, b"s" * 32, b"i" * 32

    def __init__(self):
        self.open, self.guests, self.allow = True, {"guest-token": "guest-1@room.local"}, {"guest_agents": False}

    def stop(self):
        self.open = False


class KeptLink(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        self.linker = cli.Linker(None, self.data, True, "http://relay.example")
        self.file = self.data / cli.LINK

    def test_guests_and_the_hosts_choice_are_kept_and_read_back(self):
        link = self.linker.link = Fake()
        self.linker.save(link)
        self.assertEqual(os.stat(self.file).st_mode & 0o777, 0o600)
        back = self.linker.saved()
        self.assertEqual((back["guests"], back["guest_agents"]), ({"guest-token": "guest-1@room.local"}, False))
        self.assertEqual((back["room_id"], back["token"], back["invite_token"]), (link.room_id, "host-token", "invite-token"))

    def test_a_link_kept_before_guests_were_saved_still_reads(self):
        link = self.linker.link = Fake()
        self.linker.save(link)
        old = {k: v for k, v in json.loads(self.file.read_text()).items() if k not in ("guests", "guest_agents")}
        self.file.write_text(json.dumps(old))
        back = self.linker.saved()
        self.assertEqual((back["guests"], back["guest_agents"]), ({}, True))

    def test_nothing_is_written_once_the_room_is_unlinked(self):
        link = self.linker.link = Fake()
        self.linker.save(link)
        self.linker.off()
        self.assertFalse(self.file.exists())
        self.linker.save(link)  # a guest's request that was still on its way when the host unlinked
        self.assertFalse(self.file.exists())

    def test_a_closing_room_keeps_what_it_had_and_writes_nothing_after(self):
        link = self.linker.link = Fake()
        self.linker.save(link)
        before = self.file.read_text()
        self.linker.close()
        link.guests["late"] = "guest-2@room.local"
        self.linker.save(link)
        self.assertEqual(self.file.read_text(), before)

    def test_a_save_that_fails_leaves_the_last_one_whole(self):
        link = self.linker.link = Fake()
        self.linker.save(link)
        before = self.file.read_text()
        link.guests["second"] = "guest-2@room.local"
        for where in ("os.fsync", "os.replace"):
            with mock.patch(f"shellphone.cli.{where}", side_effect=OSError("disk full")), mock.patch("builtins.print"):
                self.linker.save(link)  # says so, and the room goes on
            self.assertEqual(self.file.read_text(), before)
            self.assertEqual(self.linker.saved()["guests"], {"guest-token": "guest-1@room.local"})
            self.assertEqual(sorted(p.name for p in self.data.iterdir()), [cli.LINK])  # nothing half-written left behind
        self.linker.save(link)
        self.assertEqual(sorted(self.linker.saved()["guests"]), ["guest-token", "second"])
        self.assertEqual(os.stat(self.file).st_mode & 0o777, 0o600)

    def test_a_link_planted_at_the_name_is_replaced_not_followed(self):
        target = self.data / "elsewhere"
        target.write_text("untouched")
        self.file.symlink_to(target)
        link = self.linker.link = Fake()
        self.linker.save(link)
        self.assertFalse(self.file.is_symlink())
        self.assertEqual(target.read_text(), "untouched")
        self.assertEqual(self.linker.saved()["token"], "host-token")

    def test_a_link_that_isnt_this_rooms_is_not_written(self):
        self.linker.save(Fake())
        self.assertFalse(self.file.exists())

    def test_a_room_that_isnt_kept_writes_nothing(self):
        linker = cli.Linker(None, self.data, False, "http://relay.example")
        linker.link = Fake()
        linker.save(linker.link)
        self.assertFalse(self.file.exists())


class SlowRoom:
    """A room whose answer to a person can be held up, as a busy database would."""

    def __init__(self):
        self.started, self.go, self.done = threading.Event(), threading.Event(), []

    def Request(self, method, target, body):
        return (method, target, body)

    def for_person(self, request, email):
        self.started.set()
        self.go.wait(10)
        self.done.append(time.monotonic())  # the moment the room was changed
        return 200, {"ok": True}, None, None


class Unlinking(unittest.TestCase):
    """stop() is the end: when it returns, nothing that came in through the link is still at work in the room."""

    def link(self):
        from shellphone.link import Link
        room = SlowRoom()
        link = Link(room, "host@room.local", "http://relay.example", say=lambda *a, **k: None)
        link.open = True
        return room, link

    def test_stop_waits_for_a_request_that_was_already_let_in(self):
        room, link = self.link()
        got, stopped = [], []
        ask = threading.Thread(target=lambda: got.append(link.answer("h", "POST", "/api/messages", {"text": "late", "cid": "c0000001"}, link.token)))
        ask.start()
        self.assertTrue(room.started.wait(5))
        end = threading.Thread(target=lambda: (link.stop(), stopped.append(time.monotonic())))
        end.start()
        time.sleep(0.4)
        self.assertEqual((stopped, link.open), ([], False))  # the gate is shut at once; stop itself is still waiting
        self.assertEqual(link.answer("h", "GET", "/api/state", None, link.token)[0], 503)  # and nothing new gets in
        room.go.set()
        ask.join(5), end.join(5)
        self.assertEqual(got[0][0], 200)
        self.assertEqual(len(stopped), 1)
        self.assertLessEqual(room.done[0], stopped[0])  # the room was last touched before stop returned, not after

    def test_stop_returns_at_once_when_nothing_is_under_way(self):
        room, link = self.link()
        room.go.set()
        self.assertEqual(link.answer("h", "POST", "/api/messages", {"text": "hi", "cid": "c0000002"}, link.token)[0], 200)
        began = time.monotonic()
        link.stop()
        self.assertLess(time.monotonic() - began, 1)
        self.assertEqual(link.answer("h", "GET", "/api/state", None, link.token)[0], 503)

    def test_a_request_that_fails_is_still_counted_out(self):
        room, link = self.link()
        room.for_person = mock.Mock(side_effect=RuntimeError("boom"))
        with self.assertRaises(RuntimeError):
            link.answer("h", "POST", "/api/messages", {"text": "x", "cid": "c0000003"}, link.token)
        began = time.monotonic()
        link.stop()  # would wait for ever if the failed request were still counted
        self.assertLess(time.monotonic() - began, 1)


if __name__ == "__main__":
    unittest.main()
