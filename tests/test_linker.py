"""What a kept room writes down about its link, and that an unlinked room's link is never written again.
    python3 -m unittest tests.test_linker"""
import json, os, sys, tempfile, unittest
from pathlib import Path

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

    def test_a_link_that_isnt_this_rooms_is_not_written(self):
        self.linker.save(Fake())
        self.assertFalse(self.file.exists())

    def test_a_room_that_isnt_kept_writes_nothing(self):
        linker = cli.Linker(None, self.data, False, "http://relay.example")
        linker.link = Fake()
        linker.save(linker.link)
        self.assertFalse(self.file.exists())


if __name__ == "__main__":
    unittest.main()
