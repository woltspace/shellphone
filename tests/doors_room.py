"""For tests/test_doors.py: one room on this computer and its doors (a tunnel's switch, relay links), driven in this
process without any tunnel, relay or site. Runs the cases and prints what happened, as one line of JSON."""
import argparse, json, re, sys
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
t = Outside(r, data, False, "https://site.example", PORT, HOST, say=lambda *a, **kw: None)
t.room, t.secret, t.host_token, t.invite_token, t.host, t.open = "synthetic-room-3", "synthetic-secret", "t" * 32, "v" * 32, "door.trycloudflare.com", True
t._tell, t._keep_telling = (lambda *a, **kw: None), (lambda: None)
r.OUTSIDE = t
visitor = t.enter({"i": "v" * 32, "name": "Visitor"})[2]
out["join_page_here_host"] = ask("GET", "/join", "127.0.0.1", cookie=here)
out["join_page_tunnel_host"] = ask("GET", "/join", t.host, cookie="spo=" + "t" * 32)
out["join_page_tunnel_guest"] = ask("GET", "/join", t.host, cookie="spo=" + visitor)
was = core.RULES["agent.invite"]
core.RULES["agent.invite"] = ({core.HOST}, False)  # were the rule the host's alone, every door would follow
out["hostonly_tunnel_guest"] = ask("GET", "/join", t.host, cookie="spo=" + visitor)
out["hostonly_tunnel_host"] = ask("GET", "/join", t.host, cookie="spo=" + "t" * 32)
out["hostonly_here_host"] = ask("GET", "/join", "127.0.0.1", cookie=here)
core.RULES["agent.invite"] = (set(), False)  # and were it nobody's
out["nobody_here_host"] = ask("GET", "/join", "127.0.0.1", cookie=here)
out["nobody_tunnel_host"] = ask("GET", "/join", t.host, cookie="spo=" + "t" * 32)
core.RULES["agent.invite"] = was
t.off()
r.OUTSIDE = None

# -- a room behind a login of its own (Cloudflare Access): not this computer's page, and not a tunnel either
local, r.LOCAL = r.LOCAL, {}
r.ACCESS_TEAM = r.ACCESS_AUD = "fixture"
r.add_person("member@example.com", "Member")
signed = {"who": HOST}
r.access_email = lambda assertion: signed["who"]  # as if the login's own check had passed
login = {"Cf-Access-Jwt-Assertion": "synthetic"}
out["access_join_page_host"] = ask("GET", "/join", "room.example", headers=login)
signed["who"] = "member@example.com"
out["access_join_page_member"] = ask("GET", "/join", "room.example", headers=login)
signed["who"] = "stranger@example.com"
out["access_join_page_stranger"] = ask("GET", "/join", "room.example", headers=login)
out["access_agent_joins_with_a_code"] = ask("POST", "/lodge/join", "room.example", bearer=code, body={"wolt": "access-agent"}, headers=login)
signed["who"] = HOST
out["access_share_switch"] = ask("POST", "/api/link", "room.example", body={"on": True}, headers=login)
out["access_share_state"] = ask("GET", "/api/link", "room.example", headers=login)
core.RULES["agent.invite"] = ({core.HOST}, False)
signed["who"] = "member@example.com"
out["hostonly_access_member"] = ask("GET", "/join", "room.example", headers=login)
signed["who"] = HOST
out["hostonly_access_host"] = ask("GET", "/join", "room.example", headers=login)
core.RULES["agent.invite"] = was
r.LOCAL, r.ACCESS_TEAM, r.ACCESS_AUD = local, "", ""
print(json.dumps(out), flush=True)
