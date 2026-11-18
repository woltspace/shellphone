"""The room's rules (shellphone/core.py): who may do what, coming in which way. Every case is written out here, so a
change to the table shows up as a change to this file. A stand-in for the room: no server, no network."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import core  # noqa: E402
from shellphone.core import ACCESS, GUEST, HOST, LOCAL, MEMBER, RELAY, TUNNEL, Core, Via  # noqa: E402


class Room:
    """What the rules ask a room: who is on its list, who its host is, and to put a guest on the list."""

    def __init__(self):
        self.list = {"host@x": {"name": "Hostess"}, "member@x": {"name": "Member"}, "guest@x": {"name": "Guest", "guest": True}}

    def people(self):
        return self.list

    def host(self):
        return "host@x"

    def add_guest(self, name):
        if not str(name or "").strip():
            raise ValueError("pick a name")
        email = f"guest-{len(self.list)}@x"
        self.list[email] = {"name": name, "guest": True}
        return email


WHO = {"host@x": HOST, "member@x": MEMBER, "guest@x": GUEST, "stranger@x": None, "": None, None: None}
WAYS = (LOCAL, TUNNEL, RELAY, ACCESS)
# what: {role: the ways that role may do it by}. Anything not written here is refused.
ALLOWED = {
    "share.see": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "share.switch": {HOST: {LOCAL}},
    "invite.see": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "guest_agents.set": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "agent.invite": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}, MEMBER: {LOCAL, TUNNEL, RELAY, ACCESS}, GUEST: {LOCAL, TUNNEL, RELAY, ACCESS}},
}


class Rules(unittest.TestCase):
    def setUp(self):
        self.core = Core(Room())

    def test_everyone_has_one_role_or_none(self):
        for email, role in WHO.items():
            self.assertEqual(self.core.role(email), role, email)

    def test_the_table_is_exactly_this(self):
        self.assertEqual(set(core.RULES), set(ALLOWED))  # a new line in the rules needs its cases written here
        for what, by in ALLOWED.items():
            for email, role in WHO.items():
                for via in WAYS:
                    want = via in by.get(role, ())
                    self.assertEqual(self.core.may(email, what, via), want, (what, email, via))
                    no = self.core.refusal(email, what, via)
                    self.assertEqual(no is None, want)
                    if no:
                        self.assertEqual(no[0], 403)
                        self.assertTrue(no[1]["error"])

    def test_sharing_takes_the_rooms_own_computer_whoever_asks(self):
        for via in (TUNNEL, RELAY, ACCESS):
            self.assertEqual(self.core.refusal("host@x", "share.switch", via), (403, {"error": core.ONLY_HERE}))
        self.assertIsNone(self.core.refusal("host@x", "share.switch", LOCAL))

    def test_a_way_in_that_isnt_one_of_the_rooms_gets_nothing(self):
        for via in (Via("unknown", False), Via("unknown", True), Via("tunnel", True), Via("relay", True), Via("local", False), Via("", True), ("unknown", True), ("tunnel", True)):
            for what in core.RULES:
                self.assertFalse(self.core.may("host@x", what, via), (what, via))
        self.assertTrue(self.core.may("host@x", "share.switch", ("local", True)))  # a door may say it as a plain pair

    def test_guests_bring_agents_only_while_the_host_allows_it(self):
        for via in WAYS:
            self.assertEqual(self.core.refusal("guest@x", "agent.invite", via, {"guest_agents": False}), (403, {"error": core.NO_GUEST_AGENTS}))
            self.assertIsNone(self.core.refusal("guest@x", "agent.invite", via, {"guest_agents": True}))
            for email in ("host@x", "member@x"):  # the switch is about guests only
                self.assertIsNone(self.core.refusal(email, "agent.invite", via, {"guest_agents": False}))
        self.assertTrue(self.core.guests_agent("guest@x"))
        self.assertFalse(self.core.guests_agent("host@x") or self.core.guests_agent("member@x") or self.core.guests_agent("stranger@x"))

    def test_the_host_is_who_the_room_says_unless_the_door_was_told(self):
        self.assertEqual(Core(Room(), "member@x").role("member@x"), HOST)
        self.assertEqual(Core(Room(), "member@x").role("host@x"), MEMBER)
        self.assertEqual(Core(Room(), "guest@x").role("guest@x"), GUEST)  # a guest is never the host, whatever a door was told


class Admit(unittest.TestCase):
    def test_an_invite_makes_a_guest_with_a_key_of_their_own(self):
        room, guests = Room(), {}
        c = Core(room)
        status, out, key = c.admit(guests, "Ada")
        self.assertEqual((status, guests), (200, {key: out["email"]}))
        self.assertEqual(c.role(out["email"]), GUEST)
        self.assertGreaterEqual(len(key), 32)
        _, _, other = c.admit(guests, "Bob")
        self.assertNotEqual(key, other)
        for what in ("share.see", "share.switch", "invite.see", "guest_agents.set"):
            for via in WAYS:
                self.assertFalse(c.may(out["email"], what, via))

    def test_no_name_no_place_and_a_full_room_stays_full(self):
        room, guests = Room(), {}
        c = Core(room)
        self.assertEqual(c.admit(guests, "  ")[::2], (400, None))
        self.assertEqual(guests, {})
        guests = {f"k{n}": f"g{n}@x" for n in range(core.MAX_GUESTS)}
        before = dict(room.list)
        self.assertEqual(c.admit(guests, "Late"), (429, {"error": "this room is full"}, None))
        self.assertEqual((len(guests), room.list), (core.MAX_GUESTS, before))


if __name__ == "__main__":
    unittest.main()
