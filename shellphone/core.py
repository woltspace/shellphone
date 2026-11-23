"""CORE: who may do what in a room.

This file is the line between the room's core and everything around it.

  * The doors (room.py's own HTTP door, link.py for the relay, outside.py for a tunnel) each find out WHO is calling,
    in their own way: a key in a link, a cookie, a login in front of the room. They also know HOW the call came in
    (`Via`), from the connection itself. Neither is ever taken from what the caller sends as data.
  * What that person may then do is decided here, and nowhere else: one table (`RULES`), read by every door.
  * Pages, menus and anything else a room's owner restyles call the room and show its answers. They decide nothing:
    hiding a button is a convenience, the refusal is here.

So a new way to prove who you are (a password, a sign-in) is a new door, and this file doesn't change. And a new
thing people can do in a room is a new line in the table, and no door changes.

Changing this file changes who gets into people's rooms and what they can do there. It is not a place for look and
feel. If a change here seems needed, it belongs in an issue on the project first.
"""
import hashlib, secrets, time
from typing import NamedTuple

HOST, MEMBER, GUEST = "host", "member", "guest"  # the host opened the room; a member is on its list by name; a guest came in by an invite
MAX_GUESTS = 50  # people who may come in through one way of sharing a room


class Via(NamedTuple):
    """How a call came in. Made by the door from the connection, never from the request's own fields."""
    transport: str  # "local": this computer's own address; "tunnel"; "relay"; "access": a login in front of the room
    here: bool      # on the computer the room runs on


LOCAL, TUNNEL, RELAY, ACCESS = Via("local", True), Via("tunnel", False), Via("relay", False), Via("access", False)
TRANSPORTS = {v.transport: v for v in (LOCAL, TUNNEL, RELAY, ACCESS)}

# what: (who may, and whether only on the computer the room runs on)
RULES = {
    "share.see": ({HOST}, False),          # whether the room is shared, and through what
    "share.switch": ({HOST}, True),        # share the room, or stop: being the host is not enough, it takes the room's own computer
    "room.close": ({HOST}, True),          # close the room itself, as Ctrl-C in its window does: the host, on the room's own computer
    "invite.see": ({HOST}, False),         # the link that lets people in as guests
    "guest_agents.set": ({HOST}, False),   # whether guests may bring agents of their own
    "agent.invite": ({HOST, MEMBER, GUEST}, False),  # a message for one of the caller's own agents (guests: while the host allows it)
    "invite.make": ({HOST, GUEST}, False), # a new link that lets people in as guests, for a time (guests: only while the host lets them, and within limits)
    "guests_invite.set": ({HOST}, False),  # whether guests may invite people
    "invite.end": ({HOST}, False),         # end the open ones: nobody new comes in by them; who is in stays in
    "invite.list": ({HOST}, False),        # which are open: when they end, how many places are left. Never the links themselves
}
ONLY_HOST = "only the room's host can do that"
ONLY_HERE = "only the room's host can do that, on the computer the room runs on"
NOT_LISTED = "not on this room's list"
NO_GUEST_AGENTS = "the host has turned off agents from guests in this room"
NO_INVITE = "this link doesn't open this room any more: ask its host for a new one"
NO_GUEST_INVITES = "the host hasn't let guests invite people to this room"
# What a guest's invite can be, when the host lets guests invite: it always ends, within a day; it lets in a few
# people; a guest has a few open at a time, and makes a few an hour (ending one doesn't give that hour back).
GUEST_LONGEST, GUEST_USES, GUEST_OPEN, GUEST_HOURLY = 86400, 10, 5, 10
NOT_SHARED = "share the room first: an invite is a link through what the room is shared by"
DAY = 86400
USUAL = 30 * 60  # how long an invite for people works when nobody says: long enough to pass on and open, short enough that a link left lying about is dead
LONGEST = 30 * DAY  # an invite that ends, ends within this; the host may also make one with no end
# A people invite is a row here, never a fixed key: who made it, who it is for (nobody named: anyone), when it ends,
# how many places are left, and the mark of what the room was shared by when it was made (it works through that only).
# Only a hash of its secret is kept: the link itself can't be made again from this table.
TABLES = (
    """create table if not exists people_invites(id text primary key, token_hash text unique not null, made_by text not null, for_name text,
        expires real, uses_left integer, ended real, mark text not null, epoch integer not null default 0, created real not null, legacy integer not null default 0)""",
    "create table if not exists invited(email text primary key, invite text not null, at real not null)",  # which invite each guest came in by
    # a guest's own key (a hash of it), for what the room was shared by when they came in. Written in the same
    # transaction as their place on the list and the invite's use: there is no moment when one exists without the others
    "create table if not exists guest_keys(key_hash text primary key, email text not null, mark text not null, at real not null)",
    # what the host has switched on for guests (guests_can_invite), and how many times that was switched off
    # (invite_epoch): an invite a guest made carries the count it was made under, and is dead when it differs
    "create table if not exists room_rules(key text primary key, value integer not null)",
)


def token_hash(token):
    return hashlib.sha256(str(token).encode()).hexdigest()


class Core:
    """The room's rules, for one room (r: the room module). Holds nothing of its own: who is on the list is the room's
    to say, and each door keeps the keys it handed out."""

    def __init__(self, r, host_email=None):
        self.r, self.host_email = r, host_email

    def role(self, email):
        """HOST, MEMBER or GUEST for someone on the room's list, None for anyone else."""
        p = self.r.people().get(email) if email else None
        if p is None:
            return None
        if p.get("guest"):
            return GUEST
        return HOST if email == (self.host_email or self.r.host()) else MEMBER

    def refusal(self, email, what, via, switches=None):
        """None when this person may do this, coming in this way; else (status, {"error": why}).
        switches: what the host has turned on or off where the call came in (today: guest_agents)."""
        via = via if isinstance(via, Via) else Via(*via)
        who, here = RULES[what]
        if TRANSPORTS.get(via.transport) != via:  # a door that doesn't say plainly how the call came in gets nothing
            return 403, {"error": ONLY_HERE if here else ONLY_HOST}
        role = self.role(email)
        if role is None:
            return 403, {"error": NOT_LISTED}
        if role not in who:
            return 403, {"error": ONLY_HERE if here else ONLY_HOST}
        if here and not via.here:
            return 403, {"error": ONLY_HERE}
        if what == "agent.invite" and role == GUEST and not (switches or {}).get("guest_agents", True):
            return 403, {"error": NO_GUEST_AGENTS}
        if what == "invite.make" and role == GUEST and not self.guests_can_invite():
            return 403, {"error": NO_GUEST_INVITES}
        return None

    def may(self, email, what, via, switches=None):
        return self.refusal(email, what, via, switches) is None

    def guests_agent(self, owner):
        """Whether this agent's human is a guest: such agents come and go with the host's switch."""
        return self.role(owner) == GUEST

    # -- people invites: records in the room's own database

    def _tx(self):
        if not getattr(self, "_tables", False):
            with self.r.tx() as c:
                for table in TABLES:
                    c.execute(table)
            self._tables = True
        return self.r.tx()

    @staticmethod
    def _rule(c, key):
        row = c.execute("select value from room_rules where key = ?", (key,)).fetchone()
        return row["value"] if row else 0

    def guests_can_invite(self):
        with self._tx() as c:
            return bool(self._rule(c, "guests_can_invite"))

    def set_guests_invite(self, email, via, on):
        """The host lets guests invite people, or stops that. Stopping it ends, for good, every invite a guest made:
        switching it on again does not bring them back. People who came in stay in."""
        no = self.refusal(email, "guests_invite.set", via)
        if no:
            return no
        if not isinstance(on, bool):
            return 400, {"error": "say on: true or false"}
        with self._tx() as c:
            if self._rule(c, "guests_can_invite") and not on:
                c.execute("insert or replace into room_rules (key, value) values ('invite_epoch', ?)", (self._rule(c, "invite_epoch") + 1,))
            c.execute("insert or replace into room_rules (key, value) values ('guests_can_invite', ?)", (int(on),))
        return 200, {"guests_can_invite": on}

    def _maker_may(self, c, row):
        """Whether the one who made this invite may still invite, as the room's rules stand now."""
        role = self.role(row["made_by"])
        if role == HOST:
            return True
        return role == GUEST and bool(self._rule(c, "guests_can_invite")) and row["epoch"] == self._rule(c, "invite_epoch")

    @staticmethod
    def _open(row, now):
        return bool(row) and row["ended"] is None and (row["expires"] is None or row["expires"] > now) and (row["uses_left"] is None or row["uses_left"] > 0)

    def adopt(self, mark, token, made_by=None):
        """The one invite a way of sharing comes with becomes a record like any other: the host's, and it works for
        as long as an invite does when nobody says (USUAL). Done once for that invite: asked again (a restart, a
        second look) it changes nothing, so an invite that ended stays ended, its end is not put off, and places that
        were taken stay taken."""
        now = time.time()
        with self._tx() as c:
            c.execute("insert or ignore into people_invites (id, token_hash, made_by, expires, mark, created, legacy) values (?, ?, ?, ?, ?, ?, 1)",
                      (secrets.token_hex(8), token_hash(token), made_by or self.host_email or self.r.host(), now + USUAL, mark, now))

    def invite(self, mark, token):
        """The record of this invite as it came through what the room is shared by now, open or not; None if there is none."""
        if not mark or not isinstance(token, str) or not token:
            return None
        with self._tx() as c:
            row = c.execute("select * from people_invites where token_hash = ? and mark = ?", (token_hash(token), mark)).fetchone()
        return dict(row) if row else None

    def invite_open(self, mark, token):
        return self._open(self.invite(mark, token), time.time())

    def make_invite(self, email, via, mark, ends_in=USUAL, uses=None, for_name=None):
        """A new invite. ends_in: seconds from now, or None for no end. uses: how many people it lets in (None: as
        many as the room has room for). for_name: one named person; then it lets in one, under that name.
        Returns (200, {"id", "token", ...}): the token is said here once and kept nowhere."""
        no = self.refusal(email, "invite.make", via)
        if no:
            return no
        if not mark:
            return 409, {"error": NOT_SHARED}
        if ends_in is not None and (isinstance(ends_in, bool) or not isinstance(ends_in, (int, float)) or not 60 <= ends_in <= LONGEST):
            return 400, {"error": f"ends_in: seconds from now, from 60 to {LONGEST}, or null for an invite with no end"}
        if for_name is not None:
            if not isinstance(for_name, str) or not " ".join(for_name.split()):
                return 400, {"error": "for: the person's name"}
            for_name, uses = " ".join(for_name.split())[:40], 1
        if uses is not None and (isinstance(uses, bool) or not isinstance(uses, int) or not 1 <= uses <= MAX_GUESTS):
            return 400, {"error": f"uses: how many people it lets in, from 1 to {MAX_GUESTS}, or null"}
        token, now, ident = secrets.token_urlsafe(32), time.time(), secrets.token_hex(8)
        guest = self.role(email) == GUEST
        if guest:  # within what a guest's invite can be
            if ends_in is None or ends_in > GUEST_LONGEST:
                return 400, {"error": f"an invite from a guest ends within {GUEST_LONGEST // 3600} hours"}
            if uses is None:
                uses = GUEST_USES
            elif uses > GUEST_USES:
                return 400, {"error": f"an invite from a guest lets in up to {GUEST_USES} people"}
        expires = now + ends_in if ends_in is not None else None
        with self._tx() as c:
            epoch = 0
            if guest:  # looked at with the write, so two at once can't both slip under a limit
                if not self._rule(c, "guests_can_invite"):
                    return 403, {"error": NO_GUEST_INVITES}
                mine = [dict(r) for r in c.execute("select * from people_invites where made_by = ?", (email,))]
                if sum(1 for r in mine if r["created"] > now - 3600) >= GUEST_HOURLY:  # made, whatever became of them: ending one doesn't give the hour back
                    return 429, {"error": f"that's {GUEST_HOURLY} invites in an hour: make the next one later"}
                epoch = self._rule(c, "invite_epoch")
                if sum(1 for r in mine if r["mark"] == mark and r["epoch"] == epoch and self._open(r, now)) >= GUEST_OPEN:  # open: what would still let someone in. One the host's switch has ended isn't
                    return 429, {"error": f"you have {GUEST_OPEN} open invites: wait for one to end or be used"}
            c.execute("insert into people_invites (id, token_hash, made_by, for_name, expires, uses_left, mark, epoch, created) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (ident, token_hash(token), email, for_name, expires, uses, mark, epoch, now))
        return 200, {"id": ident, "token": token, "expires": expires, "uses_left": uses, **({"for": for_name} if for_name else {})}

    def end_invites(self, email, via, mark, only=None):
        """End the open invites of what the room is shared by now (only: one of them, by its id). Who came in stays in."""
        no = self.refusal(email, "invite.end", via)
        if no:
            return no
        if only is not None and not isinstance(only, str):
            return 400, {"error": "id: which invite to end"}
        with self._tx() as c:
            now = time.time()  # the open ones: what has run out or been used up is over already, and isn't counted
            n = c.execute("update people_invites set ended = ? where mark = ? and ended is null and (expires is null or expires > ?) and (uses_left is null or uses_left > 0)"
                          + (" and id = ?" if only else ""), (now, mark or "", now, *((only,) if only else ()))).rowcount
        return 200, {"ended": n}

    def list_invites(self, email, via, mark):
        """The open invites, for the host: what each is, never its link."""
        no = self.refusal(email, "invite.list", via)
        if no:
            return no
        now = time.time()
        with self._tx() as c:  # open, and made by someone who may still invite: what would let someone in right now
            rows = [r for r in (dict(r) for r in c.execute("select * from people_invites where mark = ? order by created", (mark or "",))) if self._maker_may(c, r)]
        return 200, {"guests_can_invite": self.guests_can_invite(), "invites": [{"id": r["id"], "by": r["made_by"], "expires": r["expires"], "uses_left": r["uses_left"], "created": r["created"],
                                  **({"for": r["for_name"]} if r["for_name"] else {}), **({"first": True} if r["legacy"] else {})} for r in rows if self._open(r, now)]}

    def end_mark(self, mark):
        """The room stopped being shared this way: every invite made through it ends with it, and every guest's key."""
        with self._tx() as c:
            c.execute("update people_invites set ended = ? where mark = ? and ended is null", (time.time(), mark))
            c.execute("delete from guest_keys where mark = ?", (mark,))

    def guest_of(self, mark, key):
        """The guest this key belongs to, through what the room is shared by now; None for any other key."""
        if not mark or not isinstance(key, str) or not key:
            return None
        with self._tx() as c:
            row = c.execute("select email from guest_keys where key_hash = ? and mark = ?", (token_hash(key), mark)).fetchone()
        return row["email"] if row and self.role(row["email"]) == GUEST else None

    def guest_count(self, mark):
        with self._tx() as c:
            return c.execute("select count(*) as n from guest_keys where mark = ?", (mark or "",)).fetchone()["n"]

    def redeem(self, mark, token, name, already=0):
        """Someone comes in by an invite. One transaction in the room's database, all or nothing: the invite is open
        and was made through what the room is shared by now, its maker may still invite, the room has a place; then
        the place is taken, the guest is on the list, and their own key is on record. Only then is the key handed
        out. If any of it fails, the commit included, none of it happened: a one-time invite is not used up by a
        failure, and no key exists that the room doesn't know. already: guests the door holds keys for from before
        keys were kept here. Returns (status, {"email", "name"} or {"error"}, the new key or None)."""
        try:
            with self._tx() as c:
                row = c.execute("select * from people_invites where token_hash = ? and mark = ?", (token_hash(token), mark or "")).fetchone() if isinstance(token, str) and token else None
                if not self._open(row, time.time()) or not self._maker_may(c, row):  # the rules as they stand now, looked at with everything else
                    return 403, {"error": NO_INVITE}, None
                if already + c.execute("select count(*) as n from guest_keys where mark = ?", (mark,)).fetchone()["n"] >= MAX_GUESTS:
                    return 429, {"error": "this room is full"}, None
                try:
                    email = self.r.add_guest(row["for_name"] or name)
                except ValueError as exc:
                    return 400, {"error": str(exc)}, None
                if row["uses_left"] is not None:
                    c.execute("update people_invites set uses_left = uses_left - 1 where id = ?", (row["id"],))
                now, key = time.time(), secrets.token_urlsafe(24)
                c.execute("insert into invited (email, invite, at) values (?, ?, ?)", (email, row["id"], now))
                c.execute("insert into guest_keys (key_hash, email, mark, at) values (?, ?, ?, ?)", (token_hash(key), email, mark, now))
                out = {"email": email, "name": self.r.people().get(email, {}).get("name")}
        except Exception:  # the room's database refused, at any point up to and including the commit: taken back whole (room.tx)
            return 500, {"error": "the room couldn't keep your place just now: open the link again"}, None
        if hasattr(self.r, "joined"):
            self.r.joined(out["name"], skip=out["email"])  # only once it is kept: everyone with notifications on hears who came in
        return 200, out, key
