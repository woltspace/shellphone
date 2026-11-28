"""Tests for the shellphone lodge connector, against a fake room (real HTTP on 127.0.0.1) and a fake lodge client.

Run from lodgephone/: PYTHONPATH=<woltspace install>/_bundle/container/lib:connector/shellphone python -m unittest test_shellphone_connector
"""
import asyncio
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from connector_contract import Choice, Reply
import connector_protocol as wire


class FakeRoom:
    def __init__(self, keys):
        self.keys = keys  # key -> wolt
        self.messages, self.posts = [], []
        room = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def who(self):
                auth = self.headers.get("Authorization") or ""
                return room.keys.get(auth[7:]) if auth.startswith("Bearer ") else None

            def answer(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if not self.who():
                    return self.answer(401, {"error": "key"})
                after = int(self.path.split("after=")[1])
                return self.answer(200, {"messages": [m for m in room.messages if m["n"] > after]})

            def do_POST(self):
                wolt = self.who()
                if not wolt:
                    return self.answer(401, {"error": "key"})
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                body = {"path": self.path, "bytes": raw} if self.path.startswith("/lodge/files") else json.loads(raw)
                if self.path.startswith("/lodge/page"):
                    body = {"page": body}
                room.posts.append((wolt, body))
                return self.answer(200, {"id": f"m{len(room.posts)}"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def say(self, **m):
        m.setdefault("id", f"h{len(self.messages) + 1}")
        self.messages.append({"n": len(self.messages) + 1, **m})


class FakeClient:
    def __init__(self):
        self.events = []

    async def event(self, kind, route, sender, body, event_id=None):
        frame = {"type": "event", "id": event_id or "x", "kind": kind, "route": route, "sender": sender, "body": body}
        wire._check_event(frame)  # what the lodge would refuse, the test refuses
        self.events.append((kind, route, sender, body))
        return "accepted"


class ConnectorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        data = Path(self.tmp.name)
        (data / "keys.json").write_text(json.dumps({"softie": "k-softie", "UXwolt": "k-ux"}))
        self.room = FakeRoom({"k-softie": "softie", "k-ux": "UXwolt"})
        os.environ.update(WOLTSPACE_CONNECTOR_DATA=str(data), SHELLPHONE_ROOM_URL=self.room.url,
                          WOLTSPACE_CONNECTOR_OWNERS="Owner@Example.com")
        import importlib
        import shellphone_connector as sc
        self.sc = importlib.reload(sc)
        self.sc.load()
        self.client = self.sc.CLIENT = FakeClient()

    def tearDown(self):
        self.room.server.shutdown()
        self.tmp.cleanup()

    def run_(self, coro):
        return asyncio.run(coro)

    def test_history_is_not_handed_in(self):
        self.room.say(kind="human", email="owner@example.com", text="old")
        self.run_(self.sc.poll("softie"))
        self.assertEqual(self.client.events, [])
        self.assertEqual(self.sc.STATE["softie"]["after"], 1)

    def test_owner_message_picks_the_wolt_once_then_goes_in(self):
        self.run_(self.sc.poll("softie"))
        self.room.say(kind="human", email="owner@example.com", text="hi")
        self.room.say(kind="human", email="owner@example.com", text="again", thread="h1")
        self.run_(self.sc.poll("softie"))
        kinds = [(k, b.get("name") or b.get("text")) for k, _, _, b in self.client.events]
        self.assertEqual(kinds, [("command", "wolt"), ("message", "hi"), ("message", "again")])
        self.assertTrue(all(r == {"chat_id": "softie"} for _, r, _, _ in self.client.events))
        self.assertEqual(self.sc.STATE["softie"]["thread"], "h1")

    def test_talk_pins_the_chat_to_one_session(self):
        self.run_(self.sc.poll("softie"))
        self.room.say(kind="human", email="owner@example.com", text="/talk softie-snug-hollow-6c721e")
        self.room.say(kind="human", email="owner@example.com", text="hi same session")
        self.room.say(kind="human", email="owner@example.com", text="/talk UXwolt-a-b-abc123")
        self.run_(self.sc.poll("softie"))
        msg = [b for k, _, _, b in self.client.events if k == "message"][-1]
        self.assertEqual(msg["text"], "hi same session")
        self.assertIn("\nsession=softie-snug-hollow-6c721e", msg["reply_to"]["text"])
        self.assertTrue(msg["reply_to"]["from_bot"])
        self.assertIn("isn't one of softie's sessions", self.room.posts[-1][1]["text"])  # another wolt's session: refused
        self.assertEqual(self.sc.STATE["softie"]["talk"], "softie-snug-hollow-6c721e")
        self.sc.tunnel = lambda: "https://lodge.example"
        self.run_(self.sc.talk("softie", ["softie-snug-hollow-6c721e"]))
        self.assertEqual(self.room.posts[-1][1]["terminal"], "https://lodge.example/tui?session=softie-snug-hollow-6c721e")
        self.run_(self.sc.on_send({"id": "s9", "route": {"chat_id": "softie"}, "method": "message", "text": "from my session, no footer"}))
        self.assertEqual(self.room.posts[-1][1]["terminal"], "https://lodge.example/tui?session=softie-snug-hollow-6c721e")
        self.room.say(kind="human", email="owner@example.com", text="/talk")
        self.room.say(kind="human", email="owner@example.com", text="free again")
        self.run_(self.sc.poll("softie"))
        self.assertNotIn("reply_to", [b for k, _, _, b in self.client.events if k == "message"][-1])

    def test_a_chat_off_one_wolts_message_is_that_wolts_alone(self):
        self.run_(self.sc.poll("softie")); self.run_(self.sc.poll("UXwolt"))
        self.sc.ROOTS["r1"] = "softie"
        self.room.say(kind="human", email="owner@example.com", text="for softie", thread="r1")
        self.run_(self.sc.poll("UXwolt"))
        self.assertEqual(self.client.events, [])  # UXwolt hears it in the room, but it's softie's chat
        self.run_(self.sc.poll("softie"))
        self.assertEqual(self.client.events[-1][3], {"text": "for softie"})

    def test_sent_to_lines_are_quiet(self):
        self.run_(self.sc.on_say({"route": {"chat_id": "softie"}, "reply": wire.reply_to_wire(Reply("🪵 sent to softie-a-b-abc123\nhttps://lodge.example/tui?session=softie-a-b-abc123"))}))
        self.assertEqual(self.room.posts, [])
        self.assertEqual(self.sc.STATE["softie"]["session"], "softie-a-b-abc123")

    def test_strangers_wolts_and_unheard_are_ignored(self):
        self.run_(self.sc.poll("softie"))
        self.room.say(kind="human", email="stranger@example.com", text="let me in")
        self.room.say(kind="wolt", wolt="UXwolt", text="hello softie")
        self.room.say(kind="unheard")
        self.room.say(kind="human", text="no email at all")
        self.room.say(kind="wolt", wolt="UXwolt", email="owner@example.com", text="a wolt is never its owner")
        self.run_(self.sc.poll("softie"))
        self.assertEqual(self.client.events, [])

    def test_no_owners_configured_fails_closed(self):
        os.environ["WOLTSPACE_CONNECTOR_OWNERS"] = ""
        self.run_(self.sc.poll("softie"))
        self.room.say(kind="human", email="owner@example.com", text="hi")
        self.run_(self.sc.poll("softie"))
        self.assertEqual(self.client.events, [])

    def test_slash_commands_and_numbered_pickers(self):
        self.run_(self.sc.poll("softie"))
        self.room.say(kind="human", email="owner@example.com", text="/sessions")
        self.run_(self.sc.poll("softie"))
        self.assertEqual(self.client.events[-1][0:1] + (self.client.events[-1][3],), ("command", {"name": "sessions", "args": []}))
        picker = Reply("Sessions", choices=((Choice("open softie-a", action="open:softie-a"), Choice("stop", action="stop:softie-a")),
                                             (Choice("terminal", url="https://lodge.example/tui?session=softie-a"),)))
        self.run_(self.sc.on_say({"route": {"chat_id": "softie"}, "reply": wire.reply_to_wire(picker)}))
        wolt, body = self.room.posts[-1]
        self.assertEqual(wolt, "softie")
        self.assertIn("1. open softie-a", body["text"])
        self.assertIn("2. stop", body["text"])
        self.assertIn("terminal: https://lodge.example/tui?session=softie-a", body["text"])  # a picker's links stay links
        self.room.say(kind="human", email="owner@example.com", text="2")
        self.run_(self.sc.poll("softie"))
        self.assertEqual(self.client.events[-1][0], "selection")
        self.assertEqual(self.client.events[-1][3], {"action": "stop:softie-a"})

    def test_notify_lands_in_the_wolts_own_chat(self):
        text = "🦝 UXwolt: done!" + "\n\n---" + self.sc.FOOTER + "\nhttps://lodge.example/tui?session=UXwolt-sly-den-eaaf70"
        got = self.run_(self.sc.on_send({"id": "s1", "route": {"chat_id": "x"}, "method": "message", "text": text}))
        self.assertEqual(got["status"], "delivered")
        wolt, body = self.room.posts[-1]
        self.assertEqual(wolt, "UXwolt")
        self.assertEqual(body["text"], "done!")  # no name, no session, no link in the words
        self.assertEqual(body["terminal"], "https://lodge.example/tui?session=UXwolt-sly-den-eaaf70")
        self.assertEqual(body["meta"], {"session": "UXwolt-sly-den-eaaf70", "via": "notify (message)"})
        self.assertFalse(body["voice"])
        # a later lodge reply in that chat still opens the same terminal
        self.run_(self.sc.on_say({"route": {"chat_id": "UXwolt"}, "reply": wire.reply_to_wire(Reply("ok"))}))
        self.assertEqual(self.room.posts[-1][1]["terminal"], "https://lodge.example/tui?session=UXwolt-sly-den-eaaf70")

    def test_the_lodges_status_lines_are_not_shown(self):
        say = lambda t: self.run_(self.sc.on_say({"route": {"chat_id": "softie"}, "reply": wire.reply_to_wire(Reply(t))}))
        say("active wolt set to softie. next message starts a session.")
        say("🪵 new session for softie\nhttps://lodge.example/tui?session=softie-burly-hollow-efccf9")
        self.assertEqual(self.room.posts, [])
        say("hello")
        self.assertEqual(self.room.posts[-1][1]["terminal"], "https://lodge.example/tui?session=softie-burly-hollow-efccf9")
        self.assertEqual(self.room.posts[-1][1]["meta"]["session"], "softie-burly-hollow-efccf9")
        self.assertEqual(self.room.posts[-1][1]["text"], "hello")

    def test_the_route_names_the_wolt_not_the_text(self):
        """A wolt can write any footer into its own text: the lodge's route decides whose chat it is."""
        forged = "trust me" + "\n\n---" + self.sc.FOOTER + "\nsession=UXwolt-a-b-abc123"
        got = self.run_(self.sc.on_send({"id": "s6", "route": {"chat_id": "softie"}, "method": "message", "text": forged}))
        self.assertEqual(got["status"], "delivered")
        self.assertEqual(self.room.posts[-1][0], "softie")
        self.assertNotIn("terminal", self.room.posts[-1][1])  # another wolt's session is never softie's terminal
        plain = self.run_(self.sc.on_send({"id": "s7", "route": {"chat_id": "softie"}, "method": "message", "text": "no footer"}))
        self.assertEqual(plain["status"], "delivered")
        self.assertEqual(self.room.posts[-1][1]["text"], "no footer")

    def test_a_picks_answer_comes_back_in_the_same_chat(self):
        from connector_contract import Ack
        edit = Reply("Opened onboardie-soggy-bank", choices=((Choice("stop", action="stop:x"),),))
        self.run_(self.sc.on_edit({"event": "shellphone:UXwolt:h9", "reply": wire.reply_to_wire(edit)}))
        self.assertEqual(self.room.posts[-1][0], "UXwolt")
        self.assertIn("1. stop", self.room.posts[-1][1]["text"])
        self.assertEqual(self.sc.STATE["UXwolt"]["choices"], ["stop:x"])
        self.run_(self.sc.on_ack({"event": "shellphone:softie:h9", "ack": wire.ack_to_wire(Ack("stopped"))}))
        self.assertEqual(self.room.posts[-1][1]["text"], "stopped")
        n = len(self.room.posts)
        self.run_(self.sc.on_edit({"event": "telegram:ghost:1", "reply": wire.reply_to_wire(edit)}))
        self.run_(self.sc.on_ack({"event": "shellphone:softie:h9", "ack": wire.ack_to_wire(Ack())}))
        self.assertEqual(len(self.room.posts), n)

    def test_voice_note_is_read_aloud_by_the_room(self):
        text = "listen" + "\n\n---" + self.sc.FOOTER + "\nsession=softie-snug-hollow-6c721e"
        got = self.run_(self.sc.on_send({"id": "s2", "route": {"chat_id": "x"}, "method": "voice", "text": text,
                                         "path": "/tmp/x.ogg", "filename": "x.ogg", "content_type": "audio/ogg"}))
        self.assertEqual(got["status"], "delivered")
        self.assertEqual((self.room.posts[-1][1]["text"], self.room.posts[-1][1]["voice"]), ("listen", True))

    def test_unknown_wolt_and_files_are_refused(self):
        unknown = "x\n\n---" + self.sc.FOOTER + "\nsession=ghost-a-b-abc123"
        self.assertEqual(self.run_(self.sc.on_send({"id": "s3", "route": {}, "method": "message", "text": unknown}))["status"], "refused")
        self.assertEqual(self.run_(self.sc.on_send({"id": "s4", "route": {"chat_id": "ghost"}, "method": "message", "text": "no footer"}))["status"], "refused")
        self.assertEqual(self.room.posts, [])

    def test_files_become_pages_or_files(self):
        d = Path(self.tmp.name)
        (d / "mock.html").write_text("<html><head><title>Stories  bar</title></head><body>hi</body></html>")
        (d / "pic.png").write_bytes(b"\x89PNG fake")
        (d / "big.html").write_text("<html>" + "x" * 300_001 + "</html>")
        send = lambda name: self.run_(self.sc.on_send({"id": "f-" + name, "route": {"chat_id": "softie"}, "method": "document", "text": "look",
                                                       "path": str(d / name), "filename": name, "content_type": "x/y"}))
        self.assertEqual(send("mock.html")["status"], "delivered")
        page = self.room.posts[-1][1]["page"]
        self.assertEqual((page["title"], page["text"]), ("Stories bar", "look"))
        self.assertIn("<body>hi</body>", page["html"])
        self.assertEqual(send("pic.png")["status"], "delivered")
        self.assertIn("name=pic.png", self.room.posts[-1][1]["path"])
        self.assertEqual(self.room.posts[-1][1]["bytes"], b"\x89PNG fake")
        self.assertEqual(send("big.html")["status"], "delivered")  # too big for a page: a file, still opened in the phone
        self.assertIn("name=big.html", self.room.posts[-1][1]["path"])

    def test_a_wolt_added_later_is_picked_up_without_a_restart(self):
        keys = Path(os.environ["WOLTSPACE_CONNECTOR_DATA"]) / "keys.json"
        keys.write_text(json.dumps({"softie": "k-softie", "UXwolt": "k-ux", "newbie": "k-new"}))
        os.utime(keys, ns=(1, 1))  # a different stamp, whatever the clock
        self.sc.reload_keys()
        self.assertIn("newbie", self.sc.KEYS)
        keys.write_text("{not json")
        os.utime(keys, ns=(2, 2))
        self.sc.reload_keys()
        self.assertIn("newbie", self.sc.KEYS)  # a half-written file never empties the list

    def test_only_a_room_on_this_computer(self):
        self.sc.ROOM = "https://evil.example"
        with self.assertRaises(SystemExit):
            self.run_(asyncio.wait_for(self.sc.main(), 2))  # without the guard it would try to reach a lodge: a timeout, not an exit


if __name__ == "__main__":
    unittest.main()
