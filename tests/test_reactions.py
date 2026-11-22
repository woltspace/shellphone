"""Reactions, the WhatsApp way: one per person or agent on a message, a new one takes the old one's place and an empty
one takes it back. A reaction reaches only the agent whose message it is, as a signal from its own human and as context
from anyone else; no other agent hears it, and it is never a message on the page."""
import json, os, subprocess, sys, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

ROOM = r'''
import argparse, json, tempfile, threading, urllib.request, urllib.error
from pathlib import Path
from shellphone import cli
r, data, url, token, code, server = cli.start(argparse.Namespace(keep=None, port=0, name="Hostess"))
threading.Thread(target=server.serve_forever, daemon=True).start()
conn = cli.part("connector")
r.add_person("guest@x", "Gus")

def key(name):
    c = cli.secrets.token_urlsafe(32)
    with r.tx() as t:
        t.execute("insert into invites (code_hash, owner, expires, once) values (?, ?, null, 1)", (r.key_hash(c), cli.HOST_EMAIL))
    return r.join_wolt(r.key_hash(c), {"wolt": name})[1]["key"]

def call(k, method, path, body=None):
    req = urllib.request.Request(url + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {k}", "Content-Type": "application/json", "User-Agent": "test"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

alpha, beta = key("alpha"), key("beta")
start = max((m["n"] for m in r.messages()), default=0)
said = r.append(kind="wolt", wolt="alpha", owner=cli.HOST_EMAIL, creature="raccoon", text="Shall I ship it?")
hers = r.append(kind="human", email=cli.HOST_EMAIL, text="@beta hello")
out = {}
out["host_thumbs"] = r.react(said["id"], "p:" + cli.HOST_EMAIL, "Hostess", "👍")[1]["reactions"]
out["host_swaps"] = r.react(said["id"], "p:" + cli.HOST_EMAIL, "Hostess", "✅")[1]["reactions"]
out["guest_too"] = r.react(said["id"], "p:guest@x", "Gus", "😂")[1]["reactions"]
out["guest_takes_back"] = r.react(said["id"], "p:guest@x", "Gus", "")[1]["reactions"]
out["not_an_emoji_we_take"] = r.react(said["id"], "p:guest@x", "Gus", "<b>")[0]
out["no_such_message"] = r.react("0" * 32, "p:guest@x", "Gus", "👍")[0]
out["beta_reacts"] = call(beta, "POST", "/lodge/react", {"id": hers["id"], "emoji": "👀"})[0]
to_beta = r.append(kind="wolt", wolt="alpha", owner=cli.HOST_EMAIL, creature="raccoon", text="@beta over to you")
out["beta_nods_at_alpha"] = call(beta, "POST", "/lodge/react", {"id": to_beta["id"], "emoji": "👍"})[0]  # shown, wakes nobody
out["beta_cant_react_to_what_it_doesnt_hear"] = call(beta, "POST", "/lodge/react", {"id": said["id"], "emoji": "👍"})[0]
out["alpha_reacts_to_its_own"] = call(alpha, "POST", "/lodge/react", {"id": said["id"], "emoji": "🎉"})[0]
out["lit_before"] = r.working_in_now()
a = call(alpha, "GET", f"/lodge/messages?after={start}")[1]["messages"]
out["lit_after"] = r.working_in_now()
r.append(kind="wolt", wolt="alpha", owner=cli.HOST_EMAIL, creature="raccoon", text="done")  # posting puts it out
with r.tx() as t: r.stop_working(t, "alpha")
out["said_id"] = said["id"]
b = call(beta, "GET", f"/lodge/messages?after={start}")[1]["messages"]
out["alpha_hears"] = [(m["kind"], m.get("reaction", {}).get("emoji")) for m in a if m["kind"] == "reaction"]
out["beta_hears"] = [m["kind"] for m in b if m["kind"] == "reaction"]
cfg = {"room_url": url, "key": alpha, "wolt": "alpha", "owner": cli.HOST_EMAIL}
members = r.members()
rs = [m for m in a if m["kind"] == "reaction"]
out["relevant"] = [conn.relevant(cfg, m) for m in rs]
out["relevant_to_beta"] = [conn.relevant({**cfg, "wolt": "beta", "key": beta}, m) for m in rs]
work = Path(tempfile.mkdtemp()).resolve()
out["prompt_human"] = conn.prompt(cfg, str(work / "lodge.json"), rs[0], [], members)
out["prompt_change"] = conn.prompt(cfg, str(work / "lodge.json"), rs[1], [], members)
r.react(said["id"], "p:guest@x", "Gus", "❤️")  # Gus woke alpha once already: taking it back and reacting again wakes nobody
out["again"] = [m for m in call(alpha, "GET", f"/lodge/messages?after={rs[-1]['n']}")[1]["messages"] if m["kind"] == "reaction"]
r.add_person("carl@x", "Carl")
mark = max(m["n"] for m in r.messages())
r.react(said["id"], "p:carl@x", "Carl", "🙏")
g = [m for m in call(alpha, "GET", f"/lodge/messages?after={mark}")[1]["messages"] if m["kind"] == "reaction"]
out["prompt_guest"] = conn.prompt(cfg, str(work / "lodge.json"), g[0], [], members)
out["lit_by_guest"] = r.working_in_now().get("alpha", [])
for e in ("👍", "🎉", "😂", "🔥"):
    r.react(said["id"], "p:carl@x", "Carl", e)
out["capped"] = [m["reaction"]["emoji"] for m in call(alpha, "GET", f"/lodge/messages?after={mark}")[1]["messages"] if m["kind"] == "reaction"]
r.react(said["id"], "p:carl@x", "Carl", "🙏")
# the real path: wait hands the agent its reaction, as it would a message
import contextlib, io
(work / "lodge.json").write_text(json.dumps({**cfg, "after": mark}))
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    conn.wait(str(work / "lodge.json"), 10, 0.2)
out["waited"] = buf.getvalue()
# paused: in the room, or in the thread the message is in, an agent hears no reaction
old = r.append(kind="wolt", wolt="alpha", owner=cli.HOST_EMAIL, creature="raccoon", text="an old one")
with r.tx() as t:
    t.execute("update messages set at = ? where id = ?", (old["at"] - 86400, old["id"]))
mark = max(m["n"] for m in r.messages())
r.set_paused("alpha", True)
r.react(old["id"], "p:carl@x", "Carl", "👍")
out["paused_room"] = [m["kind"] for m in call(alpha, "GET", f"/lodge/messages?after={mark}")[1]["messages"]]
r.set_paused("alpha", False)
root = r.append(kind="human", email=cli.HOST_EMAIL, text="a chat")
inside = r.append(kind="wolt", wolt="alpha", owner=cli.HOST_EMAIL, creature="raccoon", text="in a thread", thread=root["id"])
r.set_who(root["id"], "alpha", "paused")
mark = max(m["n"] for m in r.messages())
r.react(inside["id"], "p:carl@x", "Carl", "👍")
out["paused_thread"] = [m["kind"] for m in call(alpha, "GET", f"/lodge/messages?after={mark}")[1]["messages"]]
mark = max(m["n"] for m in r.messages())
r.react(old["id"], "p:guest@x", "Gus", "✅")
o = [m for m in call(alpha, "GET", f"/lodge/messages?after={mark}")[1]["messages"] if m["kind"] == "reaction"]
out["prompt_old"] = conn.prompt(cfg, str(work / "lodge.json"), o[0], [], members) if o else ""
out["state"] = r.reactions_now()[said["id"]]
out["history"] = call(alpha, "GET", "/lodge/history?last=10")[1]["reactions"].get(said["id"])
print(json.dumps(out))
'''


class Reactions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        p = subprocess.run([sys.executable, "-c", ROOM], capture_output=True, text=True, timeout=120, cwd=REPO, env={**os.environ, "PYTHONPATH": str(REPO)})
        assert p.returncode == 0, p.stderr[-3000:]
        cls.got = json.loads(p.stdout.strip().splitlines()[-1])

    def test_one_reaction_each_a_new_one_takes_the_old_ones_place(self):
        g = self.got
        self.assertEqual([x["emoji"] for x in g["host_thumbs"]], ["👍"])
        self.assertEqual([x["emoji"] for x in g["host_swaps"]], ["✅"])
        self.assertEqual(sorted(x["emoji"] for x in g["guest_too"]), sorted(["✅", "😂"]))
        self.assertEqual([x["emoji"] for x in g["guest_takes_back"]], ["✅"])

    def test_only_the_rooms_emojis_on_real_messages(self):
        self.assertEqual((self.got["not_an_emoji_we_take"], self.got["no_such_message"]), (400, 404))

    def test_agents_react_to_what_they_hear(self):
        self.assertEqual((self.got["beta_reacts"], self.got["alpha_reacts_to_its_own"], self.got["beta_nods_at_alpha"]), (200, 200, 200))
        self.assertEqual(self.got["beta_cant_react_to_what_it_doesnt_hear"], 404)

    def test_a_reaction_reaches_only_the_agent_whose_message_it_is(self):
        # the host's 👍, their change to ✅ and the guest's 😂 wake alpha; alpha's own 🎉 and beta's 👍 don't
        self.assertEqual(self.got["alpha_hears"], [["reaction", "👍"], ["reaction", "✅"], ["reaction", "😂"]])
        self.assertEqual(self.got["beta_hears"], [])  # beta's 👀 on the host's message wakes nobody: it's a person's message
        self.assertEqual(self.got["relevant"], [True, True, True])
        self.assertEqual(self.got["relevant_to_beta"], [False, False, False])

    def test_a_change_wakes_and_says_so_up_to_three_times_and_taking_back_wakes_nobody(self):
        self.assertIn("reacted (changed 👍 to ✅) to your message", self.got["prompt_change"])
        self.assertEqual([m["reaction"]["emoji"] for m in self.got["again"]], ["❤️"])  # took 😂 back (nothing), then ❤️: a wake
        self.assertEqual(self.got["capped"], ["🙏", "👍", "🎉"])  # Carl's 4th and 5th change wake nobody

    def test_a_reaction_that_wakes_an_agent_shows_it_working_like_a_message(self):
        self.assertNotIn("alpha", self.got["lit_before"])
        self.assertIn(self.got["said_id"], self.got["lit_after"]["alpha"])  # where the message it is on is
        self.assertIn("working --config", self.got["prompt_human"])  # its own human's 👍: told to put it out if there's nothing to do
        self.assertNotIn(self.got["said_id"], self.got["lit_by_guest"])  # someone else's 🙏 lights nothing
        self.assertNotIn("working --config", self.got["prompt_guest"])

    def test_a_paused_agent_is_not_woken(self):
        self.assertNotIn("reaction", self.got["paused_room"])
        self.assertNotIn("reaction", self.got["paused_thread"])

    def test_wait_hands_it_over(self):
        self.assertIn("Carl (someone else in the room) reacted 🙏 to your message", self.got["waited"])
        self.assertIn("keep listening", self.got["waited"])

    def test_an_old_message_says_when_and_only_its_own_humans_thumbs_is_go(self):
        self.assertRegex(self.got["prompt_old"], r"to your message from \w{3} \d{2} \d{2}:\d{2}:")
        self.assertIn("👍 or ✅ is their go", self.got["prompt_human"])
        self.assertIn("Only your own human's 👍 or ✅ is a go", self.got["prompt_guest"])

    def test_from_its_own_human_a_signal_from_anyone_else_context(self):
        h, g = self.got["prompt_human"], self.got["prompt_guest"]
        self.assertIn("reacted 👍 to your message", h)
        self.assertIn('"Shall I ship it?"', h)
        self.assertIn("This is your own human", h)
        self.assertIn("reacted 🙏", g)
        self.assertIn("This isn't your human", g)
        self.assertIn("post --config", h)

    def test_the_page_and_history_show_them(self):
        self.assertEqual(sorted(x["emoji"] for x in self.got["state"]), sorted(["✅", "🎉", "❤️", "🙏"]))
        self.assertEqual(self.got["state"], self.got["history"])


if __name__ == "__main__":
    unittest.main()
