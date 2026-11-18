"""A room's lasting address on the relay's site (/t/ID), end to end: the relay on this computer, and a stand-in for a
room that answers the one question the site asks it (is it you, and are you open?)."""
import hashlib, hmac, http.server, json, sys, threading, time, unittest, urllib.error, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_pipe
from test_pipe import E2E

ROOM, SECRET = "synthetic-room-0001", "synthetic-secret-" + "s" * 30


class FakeRoom:
    """Answers GET /api/up?n=N as a room with this id and secret would. `proves` can be switched off: then it answers
    as some other server that has ended up at the room's old address."""

    def __init__(self, room=ROOM, secret=SECRET):
        fake = self
        self.room, self.secret, self.proves, self.asked = room, secret, True, 0

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                fake.asked += 1
                n = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("n", [""])[0]
                check = hashlib.sha256(f"shellphone-check\0{fake.room}\0{fake.secret}".encode()).hexdigest()
                proof = hmac.new(check.encode(), n.encode(), hashlib.sha256).hexdigest() if fake.proves else "0" * 64
                body = json.dumps({"shellphone": True, "room": fake.room, "proof": proof}).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown(); self.server.server_close()


@E2E
class LastingAddress(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.relay, cls.base = test_pipe.start_relay("SIGN_LOCAL:1")  # only here may an address point at a room on this computer

    @classmethod
    def tearDownClass(cls):
        test_pipe.stop_relay(cls.relay)

    def setUp(self):
        self.seq = time.time_ns() // 1000
        self.rooms = []

    def tearDown(self):
        for r in self.rooms:
            r.close()

    def room(self, name):
        r = FakeRoom(room=name)
        self.rooms.append(r)
        return r

    def tell(self, room, url, secret=SECRET, gone=False, seq=None):
        self.seq += 1
        body = json.dumps({"url": url, "seq": seq or self.seq, **({"gone": True} if gone else {})}).encode()
        req = urllib.request.Request(f"{self.base}/t/{room}", data=body, method="POST", headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def where(self, room):
        with urllib.request.urlopen(f"{self.base}/t/{room}/where", timeout=20) as res:
            return json.loads(res.read())

    def test_a_room_is_found_at_its_address_and_shown_offline_when_it_closes(self):
        r = self.room("synthetic-room-0001")
        self.assertEqual(self.tell(r.room, r.url)[0], 200)
        self.assertEqual(self.where(r.room), {"known": True, "url": r.url})
        with urllib.request.urlopen(f"{self.base}/t/{r.room}", timeout=20) as res:  # the page a visitor gets: the site's own, whatever the room is doing
            self.assertIn("Opening the room", res.read().decode())
        self.assertEqual(self.tell(r.room, "")[0], 200)  # closed for now
        self.assertEqual(self.where(r.room), {"known": True, "url": None})
        self.assertEqual(self.tell(r.room, r.url)[0], 200)  # and open again, at the same lasting address
        self.assertEqual(self.where(r.room)["url"], r.url)

    def test_only_the_rooms_own_secret_points_its_address(self):
        r = self.room("synthetic-room-0002")
        self.assertEqual(self.tell(r.room, r.url)[0], 200)
        status, said = self.tell(r.room, "", secret="another-secret-" + "x" * 30)
        self.assertEqual((status, said["error"]), (403, "this address belongs to another room"))
        self.assertEqual(self.tell(r.room, r.url, secret="short")[0], 401)
        self.assertEqual(self.where(r.room)["url"], r.url)

    def test_an_address_only_ever_points_at_the_room_itself(self):
        r = self.room("synthetic-room-0003")
        self.assertEqual(self.tell(r.room, "https://example.com")[0], 400)  # not a tunnel
        self.assertEqual(self.tell(r.room, "https://not-this-room.trycloudflare.com")[0], 400)  # a tunnel, but nothing of this room answers there
        r.proves = False  # something answers there, and even says the room's name, but can't prove it
        self.assertEqual(self.tell(r.room, r.url)[0], 400)
        self.assertEqual(self.where(r.room), {"known": False, "url": None})

    def test_a_visitor_is_not_sent_to_an_address_the_room_has_left(self):
        r = self.room("synthetic-room-0004")
        self.assertEqual(self.tell(r.room, r.url)[0], 200)
        r.proves = False  # the room is gone from there; whoever has the address now is not it
        self.assertEqual(self.where(r.room), {"known": True, "url": None})
        r.proves = True
        self.assertEqual(self.where(r.room)["url"], r.url)
        r.close(); self.rooms.remove(r)  # nothing answers at all
        self.assertEqual(self.where(r.room), {"known": True, "url": None})

    def test_unlinking_is_for_good_and_late_messages_change_nothing(self):
        r = self.room("synthetic-room-0005")
        self.assertEqual(self.tell(r.room, r.url, seq=self.seq + 100)[0], 200)
        self.assertEqual(self.tell(r.room, "", seq=self.seq + 50)[0], 409)  # sent before that one, arrived after
        self.assertEqual(self.where(r.room)["url"], r.url)
        self.seq += 200
        self.assertEqual(self.tell(r.room, "", gone=True)[0], 200)
        self.assertEqual(self.where(r.room), {"known": False, "url": None})
        self.assertEqual(self.tell(r.room, r.url)[0], 410)
        self.assertEqual(self.tell(r.room, r.url, secret="another-secret-" + "x" * 30)[0], 400)  # and nobody else gets it: they can't answer as the room, and couldn't claim it if they did

    def test_what_isnt_a_message_from_a_room_is_turned_away(self):
        def raw(body, headers):
            req = urllib.request.Request(f"{self.base}/t/synthetic-room-0006", data=body, method="POST", headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=20) as res:
                    return res.status
            except urllib.error.HTTPError as e:
                return e.code
        auth = {"Authorization": f"Bearer {SECRET}"}
        self.assertEqual(raw(b"{}", {}), 401)
        self.assertEqual(raw(b"not json", auth), 400)
        self.assertEqual(raw(json.dumps({"url": ""}).encode(), auth), 400)  # no number
        self.assertEqual(raw(b'{"url": "", "seq": 1, "pad": "' + b"x" * 5000 + b'"}', auth), 413)


if __name__ == "__main__":
    unittest.main()
