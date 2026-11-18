"""The room's rules (shellphone/core.py): who may do what, coming in which way. Every case is written out here, so a
change to the table shows up as a change to this file. A stand-in for the room: no server, no network."""
import contextlib, json, sqlite3, sys, threading, time, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import core  # noqa: E402
from shellphone.core import ACCESS, GUEST, HOST, LOCAL, MEMBER, RELAY, TUNNEL, Core, Via  # noqa: E402


class Room:
    """What the rules ask a room: who is on its list, who its host is, to put a guest on the list, and its database
    (one transaction at a time, all or nothing, as room.py's)."""

    def __init__(self):
        self.con = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("create table people(email text primary key, name text, guest integer not null default 0)")
        self.con.executemany("insert into people values (?, ?, ?)", [("host@x", "Hostess", 0), ("member@x", "Member", 0), ("guest@x", "Guest", 1)])
        self.lock, self.n, self.fail_commit = threading.RLock(), 0, False

    @contextlib.contextmanager
    def tx(self):
        with self.lock:
            if self.con.in_transaction:
                yield self.con
                return
            self.con.execute("begin immediate")
            try:
                yield self.con
                if self.fail_commit:  # as a disk that refuses the write
                    self.fail_commit = False
                    raise sqlite3.OperationalError("disk I/O error")
                self.con.execute("commit")
            except BaseException:
                if self.con.in_transaction:
                    self.con.execute("rollback")
                raise

    def people(self):
        return {r["email"]: {"name": r["name"], **({"guest": True} if r["guest"] else {})} for r in self.con.execute("select * from people")}

    def host(self):
        return "host@x"

    def add_guest(self, name):
        name = " ".join(str(name or "").split())[:40]
        if not name:
            raise ValueError("pick a name")
        with self.tx() as c:
            self.n += 1
            c.execute("insert into people values (?, ?, 1)", (f"guest-{self.n}@x", name))
        return f"guest-{self.n}@x"


WHO = {"host@x": HOST, "member@x": MEMBER, "guest@x": GUEST, "stranger@x": None, "": None, None: None}
WAYS = (LOCAL, TUNNEL, RELAY, ACCESS)
# what: {role: the ways that role may do it by}. Anything not written here is refused.
ALLOWED = {
    "share.see": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "share.switch": {HOST: {LOCAL}},
    "invite.see": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "guest_agents.set": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "agent.invite": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}, MEMBER: {LOCAL, TUNNEL, RELAY, ACCESS}, GUEST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "invite.make": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "invite.end": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
    "invite.list": {HOST: {LOCAL, TUNNEL, RELAY, ACCESS}},
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


MARK = "t:room-one"


class Invites(unittest.TestCase):
    """People invites: records in the room's database, used up in one go."""

    def setUp(self):
        self.room = Room()
        self.core = Core(self.room)

    def make(self, **kw):
        status, out = self.core.make_invite("host@x", TUNNEL, MARK, **kw)
        self.assertEqual(status, 200, out)
        return out

    def come_in(self, token, name="Ada", mark=MARK, already=0):
        return self.core.redeem(mark, token, name, already)

    def row(self, ident):
        return dict(self.room.con.execute("select * from people_invites where id = ?", (ident,)).fetchone())

    def test_only_the_host_makes_ends_and_lists_and_only_while_the_room_is_shared(self):
        for email in ("member@x", "guest@x", "stranger@x", None):
            self.assertEqual(self.core.make_invite(email, TUNNEL, MARK)[0], 403)
            self.assertEqual(self.core.end_invites(email, TUNNEL, MARK)[0], 403)
            self.assertEqual(self.core.list_invites(email, TUNNEL, MARK)[0], 403)
        self.assertEqual(self.core.make_invite("host@x", LOCAL, None)[0], 409)  # not shared: no link to make
        self.assertEqual(self.core.list_invites("host@x", LOCAL, MARK), (200, {"invites": []}))  # none of that left a record

    def test_what_an_invite_can_be(self):
        for bad in ({"ends_in": 5}, {"ends_in": core.LONGEST + 1}, {"ends_in": "tomorrow"}, {"ends_in": True}, {"uses": 0}, {"uses": core.MAX_GUESTS + 1}, {"uses": 1.5}, {"uses": True}, {"for_name": "  "}, {"for_name": 7}):
            self.assertEqual(self.core.make_invite("host@x", TUNNEL, MARK, **bad)[0], 400, bad)
        now = time.time()
        plain = self.make()
        self.assertTrue(now + core.DAY - 5 < plain["expires"] < now + core.DAY + 5)  # a day, unless said otherwise
        self.assertEqual((plain["uses_left"], self.make(ends_in=None)["expires"]), (None, None))
        personal = self.make(for_name="  Ada   Lovelace ", uses=9)
        self.assertEqual((personal["for"], personal["uses_left"]), ("Ada Lovelace", 1))  # one named person: one place
        self.assertGreaterEqual(len(plain["token"]), 43)
        self.assertNotEqual(plain["token"], personal["token"])

    def test_the_link_cant_be_made_again_from_what_the_room_keeps(self):
        made = self.make(for_name="Ada")
        kept = json.dumps([dict(r) for r in self.room.con.execute("select * from people_invites")])
        self.assertNotIn(made["token"], kept)
        status, listed = self.core.list_invites("host@x", TUNNEL, MARK)
        self.assertEqual(status, 200)
        self.assertEqual(set(listed["invites"][0]), {"id", "by", "expires", "uses_left", "created", "for"})  # what it is, never its secret or the hash of it
        self.assertNotIn(made["token"], json.dumps(listed))

    def test_an_invite_makes_a_guest_with_a_key_of_their_own(self):
        made = self.make(uses=2)
        status, out, key = self.come_in(made["token"])
        self.assertEqual((status, self.core.guest_of(MARK, key)), (200, out["email"]))
        self.assertEqual((self.core.guest_of("t:room-two", key), self.core.guest_of(MARK, key + "x"), self.core.guest_of(MARK, "")), (None, None, None))
        self.assertNotIn(key, json.dumps([dict(r) for r in self.room.con.execute("select * from guest_keys")]))  # the room keeps a hash of it
        self.assertEqual((self.core.role(out["email"]), out["name"], self.core.guest_count(MARK)), (GUEST, "Ada", 1))
        self.assertGreaterEqual(len(key), 32)
        self.assertEqual(self.row(made["id"])["uses_left"], 1)
        self.assertEqual(self.room.con.execute("select invite from invited where email = ?", (out["email"],)).fetchone()[0], made["id"])  # who came in by what
        _, _, other = self.come_in(made["token"], "Bob")
        self.assertNotEqual(key, other)
        self.assertEqual(self.come_in(made["token"], "Cy"), (403, {"error": core.NO_INVITE}, None))  # both places taken
        for what in ("share.see", "share.switch", "invite.see", "invite.make", "invite.end", "invite.list", "guest_agents.set"):
            for via in WAYS:
                self.assertFalse(self.core.may(out["email"], what, via))

    def test_a_personal_invite_lets_in_one_person_under_the_name_the_host_gave(self):
        made = self.make(for_name="Ada Lovelace")
        status, out, key = self.come_in(made["token"], "Mallory")
        self.assertEqual((status, out["name"]), (200, "Ada Lovelace"))
        self.assertEqual(self.come_in(made["token"], "Ada Lovelace")[0], 403)

    def test_what_doesnt_open_the_room(self):
        made = self.make()
        before = self.room.people()
        self.assertEqual(self.come_in("not-an-invite")[0], 403)
        self.assertEqual(self.come_in("")[0], 403)
        self.assertEqual(self.come_in(None)[0], 403)
        self.assertEqual(self.come_in(made["token"], mark="t:room-two")[0], 403)  # made through what the room was shared by then
        self.assertEqual(self.come_in(made["token"], mark=None)[0], 403)
        self.assertEqual(self.come_in(made["id"])[0], 403)  # its id is not its secret
        self.room.con.execute("update people_invites set expires = ? where id = ?", (time.time() - 1, made["id"]))
        self.assertEqual(self.come_in(made["token"])[0], 403)  # its time is up
        self.assertEqual(self.core.list_invites("host@x", TUNNEL, MARK)[1]["invites"], [])
        self.assertEqual((self.room.people(), self.core.guest_count(MARK)), (before, 0))

    def test_an_invite_whose_maker_may_no_longer_invite_opens_nothing(self):
        made = self.make()
        self.room.con.execute("update people_invites set made_by = 'guest@x' where id = ?", (made["id"],))
        self.assertEqual(self.come_in(made["token"])[0], 403)
        self.room.con.execute("update people_invites set made_by = 'gone@x' where id = ?", (made["id"],))
        self.assertEqual(self.come_in(made["token"])[0], 403)

    def test_a_refusal_or_a_failure_uses_nothing_up(self):
        made = self.make(uses=1)
        self.assertEqual(self.come_in(made["token"], "   ")[0], 400)  # no name
        self.assertEqual(self.come_in(made["token"], "Late", already=core.MAX_GUESTS), (429, {"error": "this room is full"}, None))
        before = self.room.people()

        def nothing_happened():
            self.assertEqual(self.room.people(), before)  # nobody was put on the list
            self.assertEqual(self.row(made["id"])["uses_left"], 1)  # the one place is still there
            self.assertEqual([self.room.con.execute(f"select count(*) from {t}").fetchone()[0] for t in ("invited", "guest_keys")], [0, 0])  # no key the room doesn't stand behind
            self.assertFalse(self.room.con.in_transaction)  # and nothing is left half-done for the next call

        self.room.fail_commit = True  # everything went through, and then the database refused to write it
        self.assertEqual(self.come_in(made["token"])[::2], (500, None))
        nothing_happened()
        people = self.room.people

        def breaks():  # or it failed part of the way, after the guest was put on the list
            raise RuntimeError("something else went wrong")
        self.room.people = lambda: breaks() if self.room.con.in_transaction and self.room.con.execute("select count(*) from invited").fetchone()[0] else people()
        self.assertEqual(self.come_in(made["token"])[::2], (500, None))
        self.room.people = people
        nothing_happened()
        status, out, key = self.come_in(made["token"])
        self.assertEqual((status, self.core.guest_of(MARK, key)), (200, out["email"]))  # the key exists once the room has it on record, not before

    def test_ending_invites_keeps_who_came_in_and_ends_the_rest_for_good(self):
        one, two = self.make(), self.make()
        _, out, key = self.come_in(one["token"])
        self.assertEqual(self.core.end_invites("host@x", TUNNEL, MARK, one["id"]), (200, {"ended": 1}))
        self.assertEqual(self.come_in(one["token"], "Late")[0], 403)
        self.assertEqual(self.come_in(two["token"], "Bob")[0], 200)  # the other one is as it was
        self.assertEqual(self.core.end_invites("host@x", TUNNEL, MARK), (200, {"ended": 1}))
        self.assertEqual(self.core.end_invites("host@x", TUNNEL, MARK), (200, {"ended": 0}))
        self.assertEqual(self.core.end_invites("host@x", TUNNEL, MARK, 7)[0], 400)
        self.assertEqual((self.core.role(out["email"]), self.core.guest_of(MARK, key)), (GUEST, out["email"]))  # who is in stays in

    def test_the_invite_a_way_of_sharing_comes_with_is_a_record_once(self):
        self.core.adopt(MARK, "the-first-invite")
        self.core.adopt(MARK, "the-first-invite")
        self.assertEqual(self.room.con.execute("select count(*) from people_invites").fetchone()[0], 1)
        self.assertEqual(self.core.list_invites("host@x", TUNNEL, MARK)[1]["invites"][0]["first"], True)
        self.assertTrue(self.core.invite_open(MARK, "the-first-invite"))
        self.assertEqual(self.come_in("the-first-invite")[0], 200)
        self.core.end_invites("host@x", TUNNEL, MARK)
        self.core.adopt(MARK, "the-first-invite")  # a restart, a second look: an ended invite is not made again
        self.assertFalse(self.core.invite_open(MARK, "the-first-invite"))
        self.assertEqual(self.come_in("the-first-invite", "Late")[0], 403)
        self.assertEqual(self.room.con.execute("select count(*) from people_invites").fetchone()[0], 1)

    def test_stopping_a_way_of_sharing_ends_its_invites_and_no_others(self):
        mine = self.make()
        status, theirs = self.core.make_invite("host@x", RELAY, "another-mark")
        _, _, key = self.come_in(mine["token"])
        self.core.end_mark(MARK)
        self.assertEqual(self.come_in(mine["token"], "Late")[0], 403)
        self.assertIsNone(self.core.guest_of(MARK, key))  # and the keys of who came in that way
        status, out, other = self.core.redeem("another-mark", theirs["token"], "Bob")
        self.assertEqual((status, self.core.guest_of("another-mark", other)), (200, out["email"]))


if __name__ == "__main__":
    unittest.main()
