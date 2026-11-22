"""What someone with no key yet may send a room: a little, quickly. Asked as a regular tunnel passes it on (a random
trycloudflare name, no fixed address and no door in front), so this is the room's own rule."""
import argparse, json, socket, sys, tempfile, threading, time, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import cli
from shellphone.outside import Outside

NAME = "some-words-here.trycloudflare.com"


class HandIn(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        r, data, url, token, code, server = cli.start(argparse.Namespace(keep=d.name + "/room", port=0, name="Hostess"))
        self.addCleanup(server.server_close)
        out = Outside(r, data, True, "https://site.example", server.server_address[1], cli.HOST_EMAIL, say=lambda *a, **kw: None)
        out.open, out.host, out.room, out.host_token = True, NAME, "r" * 16, "k" * 32
        r.LINKER = r.OUTSIDE = out
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.r, self.out, self.code, self.port = r, out, code, server.server_address[1]

    def head(self, path, size, host=NAME, extra="", kind="application/json"):
        page = "" if "Authorization" in extra else f"Origin: https://{host}\r\n"
        return f"POST {path} HTTP/1.1\r\nHost: {host}\r\n{page}{extra}Content-Type: {kind}\r\nContent-Length: {size}\r\n\r\n".encode()

    def send(self, head, body=b"", every=None):
        """(status, seconds). every: one byte at a time, this far apart."""
        began = time.monotonic()
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as s:
            s.sendall(head)
            try:
                if every is None and body:
                    s.sendall(body)
                for b in body if every is not None else b"":
                    time.sleep(every)
                    s.sendall(bytes([b]))
            except OSError:  # it stopped listening: its answer is there to read
                pass
            got = b""
            try:
                while data := s.recv(65536):
                    got += data
            except OSError:
                pass
        return int(got.split(b" ", 2)[1]) if got else 0, time.monotonic() - began

    def key(self):
        return json.dumps({"k": self.out.host_token}).encode()

    def test_a_key_handed_in_gets_in(self):
        self.assertEqual(self.send(self.head("/api/enter", len(self.key())), self.key())[0], 200)

    def test_an_agent_joins_on_this_computer_as_before(self):
        body = json.dumps({"wolt": "helper", "creature": "raccoon", "voice": "alba"}).encode()
        head = self.head("/lodge/join", len(body), host=f"127.0.0.1:{self.port}", extra=f"Authorization: Bearer {self.code}\r\n")
        self.assertEqual(self.send(head, body)[0], 200)

    def test_an_agent_joins_through_the_tunnel_as_before(self):
        code = self.r.agent_code(cli.HOST_EMAIL, self.out.via())
        body = json.dumps({"wolt": "faraway"}).encode()
        self.assertEqual(self.send(self.head("/lodge/join", len(body), extra=f"Authorization: Bearer {code}\r\n"), body)[0], 200)

    def test_more_than_a_key_takes_is_refused_at_once(self):
        for path, extra in (("/api/enter", ""), ("/lodge/join", "Authorization: Bearer nobody\r\n")):
            status, took = self.send(self.head(path, 200_000, extra=extra))  # promised, and never sent
            self.assertEqual(status, 413, path)
            self.assertLess(took, 2, path)

    def test_that_refusal_arrives_though_the_body_is_still_coming(self):
        self.assertEqual(self.send(self.head("/api/enter", 100_000), b"x" * 100_000)[0], 413)

    def test_the_whole_hand_in_has_a_deadline_however_it_comes(self):
        with patch.object(self.r, "HAND_IN_SECONDS", 1):
            for path, extra in (("/api/enter", ""), ("/lodge/join", "Authorization: Bearer nobody\r\n")):
                status, took = self.send(self.head(path, 100, extra=extra))  # nothing at all
                self.assertEqual(status, 408, path)
                self.assertLess(took, 3, path)
                status, took = self.send(self.head(path, 100, extra=extra), b"x" * 16, every=0.25)  # a trickle
                self.assertEqual(status, 408, path)
                self.assertLess(took, 6, path)

    def test_less_than_nothing_is_refused_not_read_for_ever(self):
        status, took = self.send(self.head("/api/enter", -1))
        self.assertEqual(status, 400)
        self.assertLess(took, 2)
        status, took = self.send(self.head("/api/files?name=x", -1, extra=f"Cookie: spo={self.out.host_token}\r\n"))
        self.assertEqual(status, 400)
        self.assertLess(took, 2)

    def test_whoever_is_in_can_send_more_and_take_their_time(self):
        cookie = f"Cookie: spo={self.out.host_token}\r\n"
        with patch.object(self.r, "HAND_IN_SECONDS", 1):
            status, took = self.send(self.head("/api/files?name=t.bin&text=", 12, extra=cookie), b"x" * 12, every=0.25)
            self.assertEqual(status, 200)
            self.assertGreater(took, 2)
        big = b"x" * 300_000
        self.assertEqual(self.send(self.head("/api/files?name=b.bin&text=", len(big), extra=cookie), big)[0], 200)
        words = json.dumps({"text": "x" * 6000}).encode()
        self.assertEqual(self.send(self.head("/api/messages", len(words), extra=cookie), words)[0], 200)


if __name__ == "__main__":
    unittest.main()
