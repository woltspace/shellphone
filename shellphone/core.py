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
import secrets
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
    "invite.see": ({HOST}, False),         # the link that lets people in as guests
    "guest_agents.set": ({HOST}, False),   # whether guests may bring agents of their own
    "agent.invite": ({HOST, MEMBER, GUEST}, False),  # a message for one of the caller's own agents (guests: while the host allows it)
}
ONLY_HOST = "only the room's host can do that"
ONLY_HERE = "only the room's host can do that, on the computer the room runs on"
NOT_LISTED = "not on this room's list"
NO_GUEST_AGENTS = "the host has turned off agents from guests in this room"


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
        return None

    def may(self, email, what, via, switches=None):
        return self.refusal(email, what, via, switches) is None

    def guests_agent(self, owner):
        """Whether this agent's human is a guest: such agents come and go with the host's switch."""
        return self.role(owner) == GUEST

    def admit(self, guests, name):
        """A people invite, already checked by the door it came to, lets one more guest in: a place on the room's list
        under the name they typed, and a key of their own. guests: that door's own {key: email}, which it locks and
        saves. Returns (status, {"email"} or {"error"}, the new key or None)."""
        if len(guests) >= MAX_GUESTS:
            return 429, {"error": "this room is full"}, None
        try:
            email = self.r.add_guest(name)
        except ValueError as exc:
            return 400, {"error": str(exc)}, None
        key = secrets.token_urlsafe(24)
        guests[key] = email
        return 200, {"email": email}, key
