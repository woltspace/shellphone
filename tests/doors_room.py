"""For tests/test_doors.py: one room on this computer and its doors (a tunnel's switch, relay links), driven in this
process without any tunnel, relay or site. Runs the cases and prints what happened, as one line of JSON."""
import argparse, json, os, re, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import cli
from shellphone.link import Link
from shellphone.outside import Outside

r, data, url, token, code, server = cli.start(argparse.Namespace(keep=None, port=0, name="Hostess"))
HOST = cli.HOST_EMAIL
out = {}


def link():
    made = Link(r, HOST, "https://relay.example", say=lambda *a, **kw: None)
    made.open = True  # as if connected: what comes through it is answered
    return made


def code_in(text):
    return re.search(r"#a\.(?:[^.'\s]+\.)?([^.'\s]+)'", text).group(1)


def join(door, name, c):
    """Through a relay link (door: a Link), or at this computer's own door (None)."""
    if door is None:
        return r.join_wolt(r.key_hash(c), {"wolt": name})[0]
    return door.answer("i", "POST", "/lodge/join", {"wolt": name}, c)[0]


try:
    from shellphone import seal  # noqa: F401  (what a relay link seals with: not there in a bare checkout)
    out["relay"] = True
except ImportError:
    out["relay"] = False


def relay_cases():
    # -- the relay: a code belongs to the link that handed it out
    one = link()
    status, got = one.answer("h", "POST", "/api/agent-invite", {}, one.token)
    old = code_in(got["text"])
    other = link()  # another link, open at the same time (as a second room's would be): not its code
    out["relay_code_at_another_link"] = join(other, "sideways", old)
    out["relay_code_at_this_computer"] = join(None, "sideways", old)
    one.stop()
    two = link()
    out["relay_code_after_stop_through_a_new_link"] = join(two, "late", old)
    out["relay_code_after_stop_at_this_computer"] = join(None, "late", old)
    fresh = code_in(two.answer("h", "POST", "/api/agent-invite", {}, two.token)[1]["text"])
    out["relay_fresh_code"] = join(two, "fresh", fresh)
    out["relay_fresh_code_again"] = join(two, "again", fresh)
    out["this_computers_code_through_the_relay"] = join(two, "homebody", code)
    out["this_computers_code_here"] = join(None, "homebody", code)
    out["agent_key_marked_with_its_link"] = r.q("select via from wolts where wolt = 'fresh'")[0]["via"] == two._via()
    out["agent_key_of_this_computer_unmarked"] = r.q("select via from wolts where wolt = 'homebody'")[0]["via"] is None

    # -- the relay: only the host sets the switch for guests' agents
    guest = two.answer("i", "POST", "/api/guest", {"name": "Sam"}, two.invite_token)[1]["token"]
    out["guest_sets_guest_agents"] = two.answer("i", "POST", "/api/guest-agents", {"on": False}, guest)[0]
    out["guest_agents_still"] = two.allow["guest_agents"]
    out["guest_reads_invite"] = two.answer("i", "GET", "/api/invite", None, guest)[0]
    out["host_sets_guest_agents"] = two.answer("h", "POST", "/api/guest-agents", {"on": False}, two.token)[0]
    out["guest_agent_invite_when_off"] = two.answer("i", "POST", "/api/agent-invite", {}, guest)[0]
    out["host_agent_invite_when_off"] = two.answer("h", "POST", "/api/agent-invite", {}, two.token)[0]

    # -- the relay: the host's invites for people
    rv = out["relay_invites"] = {}
    status, made = two.answer("h", "POST", "/api/invites", {"uses": 1, "ends_in": 600}, two.token)
    rv["made"] = status
    rv["link_is_this_links"] = made.get("link", "").startswith(two.invite_link("x").rsplit(".", 1)[0] + ".")
    secret = made.get("link", ".").rsplit(".", 1)[1]
    rv["only_a_name_is_asked_of_it"] = two.answer("i", "GET", "/api/state", None, secret)[0]
    newcomer = two.answer("i", "POST", "/api/guest", {"name": "Ada"}, secret)
    rv["comes_in"] = newcomer[0]
    rv["is_in"] = two.answer("i", "GET", "/api/state", None, newcomer[1].get("token"))[0]
    rv["once"] = two.answer("i", "POST", "/api/guest", {"name": "Bob"}, secret)[0]
    rv["at_another_link"] = other.answer("i", "POST", "/api/guest", {"name": "Bob"}, secret)[0]
    now = time.time()
    plain = two.answer("h", "POST", "/api/invites", {}, two.token)[1]  # no length said, through the relay: the same 30 minutes as at the room's own door
    rv["default_length"] = now + 1795 < plain.get("expires", 0) < now + 1805
    with_none = two.answer("h", "POST", "/api/invites", {"ends_in": None}, two.token)[1]
    rv["no_end_when_said"] = "expires" in with_none and with_none["expires"] is None
    from unittest.mock import patch
    from shellphone import core as rules_mod
    with patch.object(rules_mod.time, "time", lambda: now + 1801):  # half an hour on, nobody comes in by the plain one
        rv["default_over_after_30_minutes"] = two.answer("i", "POST", "/api/guest", {"name": "Late"}, plain.get("link", ".").rsplit(".", 1)[1])[0]
    two.answer("h", "POST", "/api/invites/end", {"id": plain.get("id")}, two.token), two.answer("h", "POST", "/api/invites/end", {"id": with_none.get("id")}, two.token)
    rv["guest_makes"] = two.answer("i", "POST", "/api/invites", {}, guest)[0]
    rv["guest_sets_the_switch"] = two.answer("i", "POST", "/api/guests-invite", {"on": True}, guest)[0]
    rv["host_sets_the_switch"] = two.answer("h", "POST", "/api/guests-invite", {"on": True}, two.token)
    made_by_guest = two.answer("i", "POST", "/api/invites", {}, guest)
    rv["guest_makes_when_on"] = made_by_guest[0]
    rv["friend_of_guest_comes_in"] = two.answer("i", "POST", "/api/guest", {"name": "Friend"}, made_by_guest[1].get("link", ".").rsplit(".", 1)[1])[0]
    rv["host_stops_it"] = two.answer("h", "POST", "/api/guests-invite", {"on": False}, two.token)
    rv["guests_invite_after_off"] = two.answer("i", "POST", "/api/guest", {"name": "Late"}, made_by_guest[1].get("link", ".").rsplit(".", 1)[1])[0]
    rv["guest_lists"] = two.answer("i", "GET", "/api/invites", None, guest)[0]
    rv["guest_ends"] = two.answer("i", "POST", "/api/invites/end", {}, guest)[0]
    status, listed = two.answer("h", "GET", "/api/invites", None, two.token)
    rv["listed"] = (status, len(listed.get("invites", [])), "token" in json.dumps(listed) or secret in json.dumps(listed))
    rv["first_invite_key"] = two.answer("h", "GET", "/api/invite", None, two.token)[0]
    rv["ended"] = two.answer("h", "POST", "/api/invites/end", {}, two.token)
    rv["first_invite_after_end"] = two.answer("i", "POST", "/api/guest", {"name": "Late"}, two.invite_token)[0]
    rv["first_invite_key_after_end"] = two.answer("h", "GET", "/api/invite", None, two.token)[0]
    rv["first_invite_gone_from_info"] = "invite" not in two.info()
    rv["guests_stay"] = (two.answer("i", "GET", "/api/state", None, guest)[0], two.answer("i", "GET", "/api/state", None, newcomer[1].get("token"))[0])


if out["relay"]:
    relay_cases()

# -- the tunnel: a message for an agent asked for while the room stops being shared
o = Outside(r, data, False, "https://site.example", server.server_address[1], HOST, say=lambda *a, **kw: None)
o.room, o.secret, o.host_token, o.invite_token, o.host, o.open = "synthetic-room", "synthetic-secret", "h" * 32, "i" * 32, "room.trycloudflare.com", True
o._tell, o._keep_telling = (lambda *a, **kw: None), (lambda: None)
before = r.q("select count(*) as n from invites")[0]["n"]
people = r.people


def stopping():  # the stop lands in the middle of making the message
    o.off()
    return people()


r.people = stopping
out["tunnel_steps_while_stopping"] = o.agent_steps(HOST, "h" * 32)
r.people = people
out["tunnel_codes_made_while_stopping"] = r.q("select count(*) as n from invites")[0]["n"] - before
out["tunnel_unbound_codes"] = r.q("select count(*) as n from invites where via is null and once = 1")[0]["n"]
out["tunnel_steps_when_closed"] = o.agent_steps(HOST, "h" * 32)

# -- the tunnel: stopped and shared again while a call with an old key is on its way
o.room, o.secret, o.host_token, o.invite_token, o.host, o.open = "synthetic-room-1b", "synthetic-secret", "n" * 32, "j" * 32, "room.trycloudflare.com", True
out["tunnel_steps_with_a_key_from_before"] = o.agent_steps(HOST, "h" * 32)
out["tunnel_steps_with_no_key"] = o.agent_steps(HOST, "")
out["tunnel_steps_with_todays_key"] = bool(o.agent_steps(HOST, "n" * 32))
out["tunnel_invite_from_before"] = o.enter({"i": "i" * 32, "name": "Late"})[0]
out["tunnel_key_from_before"] = o.enter({"k": "h" * 32})[0]
o.off()

# -- the tunnel: a full room stays full
o.invite_token, o.open, o.room = "i" * 32, True, "synthetic-room-2"
o.guests = {f"k{n}": f"g{n}@x" for n in range(50)}
listed = len(r.people())
out["tunnel_full"] = o.enter({"i": "i" * 32, "name": "Late"})[0]
out["tunnel_full_added"] = len(r.people()) - listed
if out["relay"]:
    full = link()
    full.guests = {f"k{n}": f"g{n}@x" for n in range(50)}
    out["relay_full"] = full.answer("i", "POST", "/api/guest", {"name": "Late"}, full.invite_token)[0]
    out["relay_full_added"] = len(r.people()) - listed
# -- the room's own HTTP door: every way in asks the same rules
import http.client, threading
from shellphone import core
threading.Thread(target=server.serve_forever, daemon=True).start()
PORT = server.server_address[1]


def ask(method, path, host, cookie=None, bearer=None, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    h = {"Host": host, **({"Cookie": cookie} if cookie else {}), **({"Authorization": "Bearer " + bearer} if bearer else {}), **({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})}
    try:
        c.request(method, path, json.dumps(body) if body is not None else None, h)
        res = c.getresponse()
        res.read()
        return res.status
    except (http.client.HTTPException, OSError) as exc:
        return type(exc).__name__
    finally:
        c.close()


here = f"sp{PORT}={token}"


def mint(host, cookie=None, headers=None):
    """Ask for a message for an agent, as the room's own page does at that door."""
    origin = "https://room.example" if host == "room.example" else f"https://{host}" if host.endswith(".trycloudflare.com") else f"http://{host}:{PORT}"
    return ask("POST", "/api/agent-invite", host, cookie=cookie, body={}, headers={**(headers or {}), "Origin": origin})


def codes():
    return r.q("select count(*) as n from invites")[0]["n"]

# -- a POST is taken from the room's own page, or from its host's own command: at this computer's door
MINE = f"http://127.0.0.1:{PORT}"


def say(host="127.0.0.1", cookie=here, kind="application/json", raw='{"text": "hi"}', path="/api/messages", **headers):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    h = {"Host": host, **({"Cookie": cookie} if cookie else {}), **({"Content-Type": kind} if kind else {}), **{k.replace("_", "-"): v for k, v in headers.items()}}
    try:
        c.request("POST", path, raw.encode(), h)
        res = c.getresponse()
        res.read()
        return res.status
    finally:
        c.close()


gate = out["gate"] = {}
gate["page"] = say(Origin=MINE)
gate["page_fetch_metadata"] = say(Origin=MINE, Sec_Fetch_Site="same-origin")
gate["by_its_other_name"] = say(host=f"localhost:{PORT}", Origin=f"http://localhost:{PORT}")
gate["name_mismatch"] = say(Origin=f"http://localhost:{PORT}")  # asked as 127.0.0.1, says it comes from localhost
gate["other_port"] = say(Origin=f"http://127.0.0.1:{PORT + 1}")
gate["no_port"] = say(Origin="http://127.0.0.1")
gate["https"] = say(Origin=f"https://127.0.0.1:{PORT}")
gate["null"] = say(Origin="null")
gate["empty"] = say(Origin="")
gate["elsewhere"] = say(Origin="https://evil.example")
gate["lookalike"] = say(Origin=f"http://127.0.0.1:{PORT}.evil.example")
gate["cross_site_metadata"] = say(Origin=MINE, Sec_Fetch_Site="cross-site")
gate["same_site_metadata"] = say(Origin=MINE, Sec_Fetch_Site="same-site")
gate["forwarded_claims"] = say(Origin="https://evil.example", X_Forwarded_Host=f"127.0.0.1:{PORT}", Forwarded=f"host=127.0.0.1:{PORT}", X_Forwarded_Proto="http")
gate["no_origin"] = say()
gate["no_origin_with_key"] = say(X_Shellphone_Key=token)  # the host's own command
gate["key_without_cookie"] = say(cookie=None, X_Shellphone_Key=token)
gate["wrong_key"] = say(X_Shellphone_Key="x" * len(token))
gate["same_nonsense_twice"] = say(cookie=f"sp{PORT}=nonsense", X_Shellphone_Key="nonsense")  # equal, and nobody's
c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)  # the same case, for what the room says: stopped at the gate, not further in
c.request("POST", "/api/messages", b'{"text": "hi"}', {"Host": "127.0.0.1", "Cookie": f"sp{PORT}=nonsense", "X-Shellphone-Key": "nonsense", "Content-Type": "application/json"})
gate["same_nonsense_twice_why"] = json.loads(c.getresponse().read()).get("error")
c.close()
gate["key_and_foreign_origin"] = say(Origin="https://evil.example", X_Shellphone_Key=token)
gate["key_and_null_origin"] = say(Origin="null", X_Shellphone_Key=token)
gate["key_and_cross_site"] = say(Sec_Fetch_Site="cross-site", X_Shellphone_Key=token)
gate["as_text"] = say(Origin=MINE, kind="text/plain")
gate["as_form"] = say(Origin=MINE, kind="application/x-www-form-urlencoded")
gate["no_type"] = say(Origin=MINE, kind=None)
gate["json_with_charset"] = say(Origin=MINE, kind="application/json; charset=utf-8")
gate["agent_no_origin"] = say(cookie=None, path="/lodge/messages", Authorization="Bearer nobody")  # an agent's call: judged by its key, here an unknown one
gate["agent_path_with_a_persons_cookie"] = say(path="/lodge/messages", Origin=MINE)  # a person's cookie counts for nothing there
t = Outside(r, data, False, "https://site.example", PORT, HOST, say=lambda *a, **kw: None)
t.room, t.secret, t.host_token, t.invite_token, t.host, t.open = "synthetic-room-3", "synthetic-secret", "t" * 32, "v" * 32, "door.trycloudflare.com", True
t._tell, t._keep_telling = (lambda *a, **kw: None), (lambda: None)
r.OUTSIDE = t
visitor = t.enter({"i": "v" * 32, "name": "Visitor"})[2]
THEIRS, key = f"https://{t.host}", "spo=" + "t" * 32
gate["tunnel_page"] = say(host=t.host, cookie=key, Origin=THEIRS)
gate["tunnel_from_this_computers_page"] = say(host=t.host, cookie=key, Origin=MINE)
gate["tunnel_http"] = say(host=t.host, cookie=key, Origin=f"http://{t.host}")
gate["tunnel_another_tunnel"] = say(host=t.host, cookie=key, Origin="https://other.trycloudflare.com")
gate["tunnel_no_origin"] = say(host=t.host, cookie=key)
gate["tunnel_no_origin_with_key"] = say(host=t.host, cookie=key, X_Shellphone_Key="t" * 32)
gate["tunnel_key_of_this_computer"] = say(host=t.host, cookie=key, X_Shellphone_Key=token)
gate["enter_page"] = say(host=t.host, cookie=None, path="/api/enter", raw='{"k": "' + "t" * 32 + '"}', Origin=THEIRS)
gate["enter_from_elsewhere"] = say(host=t.host, cookie=None, path="/api/enter", raw='{"k": "' + "t" * 32 + '"}', Origin="https://evil.example")
gate["enter_no_origin"] = say(host=t.host, cookie=None, path="/api/enter", raw='{"k": "' + "t" * 32 + '"}')
gate["enter_as_text"] = say(host=t.host, cookie=None, path="/api/enter", raw='{"k": "' + "t" * 32 + '"}', Origin=THEIRS, kind="text/plain")
out["join_page_here_host"] = mint("127.0.0.1", cookie=here)
out["join_page_tunnel_host"] = mint(t.host, cookie="spo=" + "t" * 32)
out["join_page_tunnel_guest"] = mint(t.host, cookie="spo=" + visitor)
was = core.RULES["agent.invite"]
core.RULES["agent.invite"] = ({core.HOST}, False)  # were the rule the host's alone, every door would follow
out["hostonly_tunnel_guest"] = mint(t.host, cookie="spo=" + visitor)
out["hostonly_tunnel_host"] = mint(t.host, cookie="spo=" + "t" * 32)
out["hostonly_here_host"] = mint("127.0.0.1", cookie=here)
core.RULES["agent.invite"] = (set(), False)  # and were it nobody's
out["nobody_here_host"] = mint("127.0.0.1", cookie=here)
out["nobody_tunnel_host"] = mint(t.host, cookie="spo=" + "t" * 32)
core.RULES["agent.invite"] = was

# -- the host's invites for people, over HTTP: from this computer and through the tunnel
def tell(method, path, host, cookie=None, body=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    origin = f"https://{host}" if host == t.host else f"http://{host}:{PORT}"
    h = {"Host": host, **({"Cookie": cookie} if cookie else {}), **({"Content-Type": "application/json", "Origin": origin} if method == "POST" else {})}
    try:
        c.request(method, path, json.dumps(body) if method == "POST" else None, h)
        res = c.getresponse()
        raw = res.read()
        try:
            return res.status, json.loads(raw)
        except ValueError:
            return res.status, {}
    finally:
        c.close()


class Switch:  # what the room's switch says: shared through the tunnel t
    ways = {"tunnel": t}

    def info(self):
        return {**t.info(), "via": "tunnel", "ways": ["tunnel"]}

    def door(self):
        return t if t.open else None


inv = out["invites"] = {}
r.LINKER = Switch()
host_out = "spo=" + "t" * 32
# a phone signs up for notifications: the room keeps the tunnel address it did so at
out["push_signup"] = [tell("POST", "/api/push", t.host, host_out, {"subscription": {"endpoint": "https://push.example/through-the-tunnel"}})[0],
                      tell("POST", "/api/push", "127.0.0.1", here, {"subscription": {"endpoint": "https://push.example/on-this-computer"}})[0]]
out["push_signup_at"] = {row["endpoint"].rsplit("/", 1)[1]: row["at"] for row in r.q("select * from push")}
with r.tx() as c:
    c.execute("delete from push")
inv["first_invite_shown"] = "invite" in tell("GET", "/api/link", "127.0.0.1", here)[1]
status, made = tell("POST", "/api/invites", "127.0.0.1", here, {"ends_in": 3600, "uses": 2})
inv["made_here"] = status
inv["link_is_the_lasting_address"] = made.get("link", "").startswith("https://site.example/t/synthetic-room-3#i.")
inv["answer_keys"] = sorted(made)
secret = made.get("link", "#i.").split("#i.")[1]
inv["comes_in"] = t.enter({"i": secret, "name": "Ada"})[0]
inv["comes_in_twice"] = t.enter({"i": secret, "name": "Bob"})[0]
inv["third_is_refused"] = t.enter({"i": secret, "name": "Cy"})[0]
status, personal = tell("POST", "/api/invites", t.host, host_out, {"for": "Grace Hopper"})  # the host, from their phone
inv["made_from_outside"] = status
got = t.enter({"i": personal.get("link", "#i.").split("#i.")[1], "name": "Mallory"})
inv["personal_name"] = got[1].get("name")
status, listed = tell("GET", "/api/invites", t.host, host_out)
inv["listed"] = status
inv["listed_count"] = len(listed.get("invites", []))
inv["list_says_no_secret"] = secret not in json.dumps(listed) and "token" not in json.dumps(listed)
inv["guest_makes"] = tell("POST", "/api/invites", t.host, "spo=" + visitor, {})[0]
inv["guest_lists"] = tell("GET", "/api/invites", t.host, "spo=" + visitor)[0]
inv["guest_ends"] = tell("POST", "/api/invites/end", t.host, "spo=" + visitor, {})[0]
inv["stranger_makes"] = tell("POST", "/api/invites", t.host, None, {})[0]
inv["bad_ends_in"] = tell("POST", "/api/invites", "127.0.0.1", here, {"ends_in": 1})[0]
inv["not_an_object"] = tell("POST", "/api/invites", "127.0.0.1", here, ["x"])[0]
import contextlib, io, sqlite3

# the command: `shellphone invite`
cli.running = lambda keep, port: {"port": PORT, "token": token}


def command(**kw):
    said = io.StringIO()
    with contextlib.redirect_stdout(said):
        try:
            cli.invite(argparse.Namespace(**{"keep": None, "port": None, "end": False, "name": None, "hours": None, "minutes": None, "uses": None, "forever": False, "guests": None, **kw}))
        except SystemExit as exc:
            return "refused: " + str(exc)
    return said.getvalue()


# guests invite only while the host lets them: over HTTP, through the tunnel
gi = out["guests_invite"] = {}
guest_out = "spo=" + visitor
gi["guest_sets"] = tell("POST", "/api/guests-invite", t.host, guest_out, {"on": True})[0]
gi["off_to_begin_with"] = tell("GET", "/api/invites", "127.0.0.1", here)[1].get("guests_can_invite")
gi["host_sets_from_outside"] = tell("POST", "/api/guests-invite", t.host, host_out, {"on": True})
gi["bad_body"] = tell("POST", "/api/guests-invite", "127.0.0.1", here, {"on": "yes"})[0]
status, theirs = tell("POST", "/api/invites", t.host, guest_out, {"uses": 2})
gi["guest_makes"] = (status, theirs.get("link", "").startswith("https://site.example/t/synthetic-room-3#i."))
gi["guest_makes_one_with_no_end"] = tell("POST", "/api/invites", t.host, guest_out, {"ends_in": None})[0]
theirs = theirs.get("link", "#i.").split("#i.")[1]
gi["friend_comes_in"] = t.enter({"i": theirs, "name": "Friend"})[0]
gi["guest_still_cant"] = (tell("GET", "/api/invites", t.host, guest_out)[0], tell("POST", "/api/invites/end", t.host, guest_out, {})[0], tell("POST", "/api/link", t.host, guest_out, {"on": False})[0])
gi["host_sees_who_invited"] = [i["by"] == HOST for i in tell("GET", "/api/invites", "127.0.0.1", here)[1]["invites"]]
gi["host_stops_it"] = tell("POST", "/api/guests-invite", "127.0.0.1", here, {"on": False})
gi["after_off"] = (t.enter({"i": theirs, "name": "Late"})[0], tell("POST", "/api/invites", t.host, guest_out, {})[0])
tell("POST", "/api/guests-invite", "127.0.0.1", here, {"on": True})
gi["on_again_old_invite"] = t.enter({"i": theirs, "name": "Late"})[0]
said = command(guests="off")
gi["command"] = ("can't invite people any more" in said, tell("GET", "/api/invites", "127.0.0.1", here)[1].get("guests_can_invite"), "can invite people now" in command(guests="on"))
command(guests="off")

# the room's database refuses the write at the last moment: nobody is half let in


class Refusing:
    """The room's database, refusing to commit the transaction that lets a guest in."""

    def __init__(self, real):
        self.real, self.guest = real, False

    def execute(self, sql, *a):
        self.guest = self.guest or sql.startswith("insert into guest_keys")
        if self.guest and sql.strip().lower() == "commit":
            self.guest = False
            raise sqlite3.OperationalError("disk I/O error")
        return self.real.execute(sql, *a)

    def __getattr__(self, name):
        return getattr(self.real, name)


once = tell("POST", "/api/invites", "127.0.0.1", here, {"uses": 1})[1]["link"].split("#i.")[1]
listed, real = len(r.people()), r.con()
r.CON = Refusing(real)
got = t.enter({"i": once, "name": "Unlucky"})
r.CON = real


class Dead:  # and a database that refuses everything: the door still answers, and lets nobody in
    in_transaction = False

    def execute(self, sql, *a):
        raise sqlite3.OperationalError("disk I/O error")


r.CON = Dead()
inv["when_the_database_is_gone"] = t.enter({"i": once, "name": "Unlucky"})[::2]
r.CON = real
inv["when_the_database_refuses"] = (got[0], got[2], len(r.people()) - listed, real.in_transaction, r.q("select count(*) as n from guest_keys where email not in (select email from people)")[0]["n"])
got = t.enter({"i": once, "name": "Lucky"})
inv["and_the_one_place_is_still_there"] = (got[0], tell("GET", "/api/state", t.host, "spo=" + got[2])[0])

said = command(name="Ada", hours=2)
inv["command_says"] = ("for Ada, once" in said, "for 2 hours" in said, "https://site.example/t/synthetic-room-3#i." in said)
inv["command_link_works"] = t.enter({"i": said.split("#i.")[1].split()[0], "name": "x"})[1].get("name")
inv["command_forever"] = "with no end" in command(forever=True, uses=3) and "for up to 3 people" in command(forever=True, uses=3)
inv["command_bad"] = command(hours=0.001)[:8]
inv["command_lengths"] = ("for anyone who has it, for 30 minutes:" in command(), "for 5 minutes:" in command(minutes=5), "for 1 hour:" in command(minutes=60), "for 3 days:" in command(hours=72), "for 90 minutes:" in command(hours=1.5))
inv["command_one_length"] = [command(**kw)[:8] for kw in ({"minutes": 5, "hours": 1}, {"minutes": 5, "forever": True}, {"hours": 1, "forever": True}, {"minutes": 5, "end": True}, {"minutes": 5, "guests": "on"})]
now = time.time()
made = tell("POST", "/api/invites", "127.0.0.1", here, {})[1]
inv["page_default"] = now + 1795 < made["expires"] < now + 1805

people_before = len(r.people())
status, ended = tell("POST", "/api/invites/end", t.host, host_out, {})
inv["ended"] = (status, ended.get("ended"))
inv["first_invite_after_end"] = t.enter({"i": "v" * 32, "name": "Late"})[0]
inv["first_invite_gone_from_the_menu"] = "invite" not in tell("GET", "/api/link", "127.0.0.1", here)[1]
inv["share_says_how_long"] = "for the next" not in cli.linked_words({"link": "L", "invite": "I"}) and all("works for 30 minutes from when it is made" in cli.linked_words(i) for i in ({"link": "L", "invite": "I"}, {"link": "L"}))  # the usual length, never a promise of how long this one has left
inv["command_words_without_an_invite"] = "The invite this room came with has ended" in cli.linked_words(t.info()) and "#i." not in cli.linked_words(t.info())
inv["command_end"] = command(end=True)[:22]
inv["guests_stay_after_end"] = len(r.people()) == people_before and tell("GET", "/api/state", t.host, "spo=" + visitor)[0] == 200
t.door_mark()  # a second look, as a restart would take
inv["first_invite_stays_ended"] = t.enter({"i": "v" * 32, "name": "Late"})[0]
status, again = tell("POST", "/api/invites", "127.0.0.1", here, {})
again_secret = again.get("link", "#i.").split("#i.")[1]
t.off()
inv["after_stop_sharing"] = t.enter({"i": again_secret, "name": "Late"})[0]
inv["make_when_not_shared"] = tell("POST", "/api/invites", "127.0.0.1", here, {})[0]
t.room, t.secret, t.host_token, t.invite_token, t.host, t.open = "synthetic-room-4", "synthetic-secret", "u" * 32, "w" * 32, "door.trycloudflare.com", True
inv["old_invite_through_a_new_address"] = t.enter({"i": again_secret, "name": "Late"})[0]
inv["new_address_first_invite"] = t.enter({"i": "w" * 32, "name": "Newcomer"})[0]
t.off()
r.OUTSIDE = None
r.LINKER = None

# -- a room behind a login of its own (Cloudflare Access): not this computer's page, and not a tunnel either
# -- opening the page makes nothing: a code is made on a POST from the room's own page only
n = codes()
out["page_opened"] = (ask("GET", "/join", "127.0.0.1", cookie=here), codes() - n)
out["page_opened_from_another_site"] = (ask("GET", "/join", "127.0.0.1", cookie=here, headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}), codes() - n)
out["asked_from_another_site"] = (ask("POST", "/api/agent-invite", "127.0.0.1", cookie=here, body={}, headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}), codes() - n)
out["asked_by_the_page"] = (mint("127.0.0.1", cookie=here), codes() - n)

local, r.LOCAL = r.LOCAL, {}
r.ACCESS_TEAM = r.ACCESS_AUD = "fixture"
os.environ["SHELLPHONE_URL"] = "https://room.example"
r.add_person("member@example.com", "Member")
signed = {"who": HOST}
r.access_email = lambda assertion: signed["who"]  # as if the login's own check had passed
login = {"Cf-Access-Jwt-Assertion": "synthetic"}
out["access_join_page_host"] = mint("room.example", headers=login)
signed["who"] = "member@example.com"
out["access_join_page_member"] = mint("room.example", headers=login)
signed["who"] = "stranger@example.com"
out["access_join_page_stranger"] = mint("room.example", headers=login)
n = codes()
signed["who"] = HOST
out["access_page_opened_from_another_site"] = (ask("GET", "/join", "room.example", headers={**login, "Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}), codes() - n)
signed["who"] = "stranger@example.com"
out["access_agent_joins_with_a_code"] = ask("POST", "/lodge/join", "room.example", bearer=code, body={"wolt": "access-agent"}, headers=login)
signed["who"] = HOST
signed["who"] = HOST
os.environ.pop("SHELLPHONE_URL", None)
gate["login_room_address_not_set"] = say(host="room.example", cookie=None, Origin="https://room.example", **{"Cf-Access-Jwt-Assertion": "synthetic"})
os.environ["SHELLPHONE_URL"] = "https://room.example/"
gate["login_room_page"] = say(host="room.example", cookie=None, Origin="https://room.example", **{"Cf-Access-Jwt-Assertion": "synthetic"})
gate["login_room_page_whatever_host_says"] = say(host="other.example", cookie=None, Origin="https://room.example", **{"Cf-Access-Jwt-Assertion": "synthetic"})
gate["login_room_host_header_is_not_an_origin"] = say(host="evil.example", cookie=None, Origin="https://evil.example", **{"Cf-Access-Jwt-Assertion": "synthetic"})
gate["login_room_http"] = say(host="room.example", cookie=None, Origin="http://room.example", **{"Cf-Access-Jwt-Assertion": "synthetic"})
gate["login_room_no_origin"] = say(host="room.example", cookie=None, **{"Cf-Access-Jwt-Assertion": "synthetic"})
gate["login_room_no_origin_with_a_key"] = say(host="room.example", cookie=here, X_Shellphone_Key=token, **{"Cf-Access-Jwt-Assertion": "synthetic"})
gate["login_room_this_computers_page"] = say(host=f"127.0.0.1:{PORT}", cookie=None, Origin=MINE, **{"Cf-Access-Jwt-Assertion": "synthetic"})
r.DEV = True
gate["login_room_dev_this_computers_page"] = say(host=f"127.0.0.1:{PORT}", cookie=None, Origin=MINE, **{"Cf-Access-Jwt-Assertion": "synthetic"})
gate["login_room_dev_no_origin"] = say(host=f"127.0.0.1:{PORT}", cookie=None, **{"Cf-Access-Jwt-Assertion": "synthetic"})
r.DEV = False
os.environ["SHELLPHONE_URL"] = "https://room.example"
out["access_share_switch"] = ask("POST", "/api/link", "room.example", body={"on": True}, headers={**login, "Origin": "https://room.example"})
out["access_share_state"] = ask("GET", "/api/link", "room.example", headers=login)
out["access_invites"] = (ask("GET", "/api/invites", "room.example", headers=login), ask("POST", "/api/invites", "room.example", body={}, headers={**login, "Origin": "https://room.example"}))
core.RULES["agent.invite"] = ({core.HOST}, False)
signed["who"] = "member@example.com"
out["hostonly_access_member"] = mint("room.example", headers=login)
signed["who"] = HOST
out["hostonly_access_host"] = mint("room.example", headers=login)
core.RULES["agent.invite"] = was
r.LOCAL, r.ACCESS_TEAM, r.ACCESS_AUD = local, "", ""

# notifications: what each one is signed with (no push service is asked: a stand-in takes the calls)
signed_with = []


class StandInPush:
    class WebPushException(Exception):
        response = None

    @staticmethod
    def webpush(sub, body, **kw):
        signed_with.append((sub["endpoint"], kw["vapid_claims"]["sub"]))


was_push, r.pywebpush = r.pywebpush, StandInPush
was_keys, r.vapid = r.vapid, lambda: ("no-key-file", "no-key")  # the room's push keys need the cryptography package: not asked for here, the stand-in signs nothing
with r.tx() as c:
    for i, who in enumerate((HOST, "guest-12ab34cd@room.local", "Ada.Lovelace@example.org", "nobody")):
        c.execute("insert or replace into push (endpoint, email, sub) values (?, ?, ?)", (f"https://push.example/{i}", who, json.dumps({"endpoint": f"https://push.example/{i}", "keys": {}})))
r.ACTIVE.clear()
r.notify({"id": "0" * 32, "email": "someone-else@room.local", "text": "hello", "files": []})
out["push_signed_with"] = [s for _, s in sorted(signed_with)]
# the room's tunnel address changed: an app that signed up at the old one gets nothing more and is forgotten
import types
with r.tx() as c:
    c.execute("delete from push")
    for name, at in (("old-address", "old.trycloudflare.com"), ("this-address", "new.trycloudflare.com"), ("this-computer", ""), ("from-before", None)):
        c.execute("insert into push (endpoint, email, sub, at) values (?, ?, ?, ?)", (f"https://push.example/{name}", HOST, json.dumps({"endpoint": f"https://push.example/{name}", "keys": {}}), at))
was_outside, r.OUTSIDE = r.OUTSIDE, types.SimpleNamespace(open=True, host="new.trycloudflare.com")
signed_with.clear()
r.notify({"id": "1" * 32, "email": "someone-else@room.local", "text": "hello", "files": []})
out["push_after_a_new_address"] = (sorted(e.rsplit("/", 1)[1] for e, _ in signed_with), sorted(row["endpoint"].rsplit("/", 1)[1] for row in r.q("select * from push")))
r.OUTSIDE = None  # and when the room is not shared through a tunnel at all any more
signed_with.clear()
r.notify({"id": "2" * 32, "email": "someone-else@room.local", "text": "hello", "files": []})
out["push_after_sharing_stopped"] = (sorted(e.rsplit("/", 1)[1] for e, _ in signed_with), sorted(row["endpoint"].rsplit("/", 1)[1] for row in r.q("select * from push")))
r.OUTSIDE = was_outside
out["push_contact"] = [r.push_contact(e) for e in ("me@gmail.com", " Me@Example.COM ", "", None, "x@y", "a@b.localhost", "a@shellphone.local")]
with r.tx() as c:
    c.execute("delete from push where endpoint like 'https://push.example/%'")
r.pywebpush, r.vapid = was_push, was_keys
print(json.dumps(out), flush=True)
