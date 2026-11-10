"""The sealing code: keys, handshake, replay rules, and that Python and the browser's crypto agree.

    python3 -m unittest tests.test_seal            # needs the cryptography package; the browser half needs node
    python3 tests/test_seal.py --write-vectors     # only when the format changes on purpose
"""
import json, shutil, subprocess, sys, threading, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
try:
    from shellphone import seal  # noqa: E402
except ImportError as missing:  # the cryptography package isn't installed here
    raise unittest.SkipTest(f"the sealing tests need the cryptography package ({missing}): uv run --with cryptography python -m unittest discover tests")

VECTORS = REPO / "tests" / "seal_vectors.json"
NODE = shutil.which("node")
SECRET, INVITE, ROOM = bytes(range(32)), bytes(range(32, 64)), bytes(range(100, 116))
CN, SID = bytes(range(200, 216)), bytes(range(216, 232))
N = [bytes([i]) * 12 for i in (1, 2, 3, 4)]  # fixed nonces, for the vectors only
SAY = [{"t": "req", "id": 1, "method": "POST", "path": "/api/messages", "body": {"text": "héllo 🐚", "cid": "abc123"}},
       {"t": "res", "id": 1, "status": 200, "body": {"n": 7}}]


def make_vectors():
    root, sess = seal.root_keys(SECRET, ROOM), seal.session_keys(SECRET, ROOM, SID, CN)
    client, host = seal.Client(ROOM, SECRET), seal.Host(ROOM, {"h": SECRET})
    hi = client.hi(_cn=CN, _nonce=N[0])
    hello, hs, _ = host.hi(hi, _sid=SID, _nonce=N[1])
    cs = client.hello(hello)
    return {"about": "Fixed inputs and what both implementations must produce from them. Nonces are fixed here only.",
            "secret": seal.b64e(SECRET), "room": seal.b64e(ROOM), "cn": seal.b64e(CN), "sid": seal.b64e(SID),
            "root": {k: v.hex() for k, v in root.items()}, "session": {k: v.hex() for k, v in sess.items()},
            "hi": {"nonce": seal.b64e(N[0]), "frame": hi}, "hello": {"nonce": seal.b64e(N[1]), "frame": hello},
            "frames": [{"dir": "c2h", "seq": 1, "nonce": seal.b64e(N[2]), "obj": SAY[0], "frame": cs.seal(SAY[0], _nonce=N[2])},
                       {"dir": "h2c", "seq": 1, "nonce": seal.b64e(N[3]), "obj": SAY[1], "frame": hs.seal(SAY[1], _nonce=N[3])}]}


def pair(kind="h", secrets=None):
    secrets = secrets or {"h": SECRET, "i": INVITE}
    client, host = seal.Client(ROOM, secrets[kind], kind), seal.Host(ROOM, secrets)
    hi = client.hi()
    hello, hs, got = host.hi(hi)
    return client, host, client.hello(hello), hs, hi, hello, got


class Keys(unittest.TestCase):
    def test_python_reproduces_the_vectors(self):
        self.assertEqual(make_vectors(), json.loads(VECTORS.read_text()))

    def test_the_root_keys_are_the_ones_reviewed(self):
        root = seal.root_keys(SECRET, ROOM)
        self.assertEqual(root["c2h"].hex(), "8e8735a2c35e23673223171c6b0131fa57729a40eda5d8269611dada79f56416")
        self.assertEqual(root["h2c"].hex(), "ef5bae58c55367c47b6f347a09c425d73a44806fe3aacc0297626cb984f32290")

    def test_every_key_differs(self):
        a, b = seal.root_keys(SECRET, ROOM), seal.session_keys(SECRET, ROOM, SID, CN)
        others = [seal.root_keys(INVITE, ROOM), seal.root_keys(SECRET, bytes(16)), seal.session_keys(SECRET, ROOM, CN, SID)]
        keys = [v for d in (a, b, *others) for v in d.values()]
        self.assertEqual(len(set(keys)), len(keys))

    def test_sizes_are_checked(self):
        for bad in ((SECRET[:31], ROOM), (SECRET, ROOM[:15])):
            with self.assertRaises(seal.SealError):
                seal.root_keys(*bad)
        with self.assertRaises(seal.SealError):
            seal.session_keys(SECRET, ROOM, SID[:8], CN)


class Talking(unittest.TestCase):
    def test_both_directions(self):
        _, _, cs, hs, *_ = pair()
        for i in range(1, 4):
            self.assertEqual(hs.open(cs.seal({"n": i})), {"n": i})
            self.assertEqual(cs.open(hs.seal({"n": -i})), {"n": -i})

    def test_a_frame_cant_be_turned_around(self):
        _, _, cs, hs, *_ = pair()
        with self.assertRaises(seal.SealError):
            cs.open(cs.seal({"t": "req"}))  # a client's own frame, offered back to a client as the host's
        with self.assertRaises(seal.SealError):
            hs.open(hs.seal({"t": "res"}))

    def test_a_frame_opens_once(self):
        _, _, cs, hs, *_ = pair()
        first, second = cs.seal({"n": 1}), cs.seal({"n": 2})
        self.assertEqual(hs.open(second), {"n": 2})
        for replayed in (second, first):  # the same again, and an older one
            with self.assertRaises(seal.SealError):
                hs.open(replayed)
        self.assertEqual(hs.open(cs.seal({"n": 3})), {"n": 3})  # and the session carries on

    def test_the_same_frame_arriving_many_times_at_once_passes_once(self):
        _, _, cs, hs, *_ = pair()
        frame, passed, go = cs.seal({"t": "req", "id": 1}), [], threading.Barrier(16)

        def one():
            go.wait()
            try:
                passed.append(hs.open(frame))
            except seal.SealError:
                pass
        threads = [threading.Thread(target=one) for _ in range(16)]
        [t.start() for t in threads], [t.join() for t in threads]
        self.assertEqual(passed, [{"t": "req", "id": 1}])

    def test_tampering_is_caught(self):
        _, _, cs, hs, *_ = pair()
        raw = bytearray(seal.b64d(cs.seal({"n": 1})))
        for at in (7, 8, 20, len(raw) - 1):  # the counter, the nonce, the body, the tag
            bent = bytearray(raw)
            bent[at] ^= 1
            with self.assertRaises(seal.SealError):
                hs.open(seal.b64e(bytes(bent)))
        self.assertEqual(hs.open(seal.b64e(bytes(raw))), {"n": 1})  # none of that spent the real frame

    def test_the_counter_must_be_in_range(self):
        _, _, cs, hs, *_ = pair()
        raw = seal.b64d(cs.seal({"n": 1}))
        for seq in (0, seal.MAX_SEQ + 1, 2 ** 40):
            with self.assertRaises(seal.SealError):
                hs.open(seal.b64e(seq.to_bytes(8, "big") + raw[8:]))
        for junk in ("", "AAAA", "not base64!", None, 5):
            with self.assertRaises(seal.SealError):
                hs.open(junk)

    def test_a_session_stops_sealing_at_its_budget(self):
        _, _, cs, _, *_ = pair()
        cs._sent = seal.MAX_SEQ - 1
        cs.seal({"last": True})
        with self.assertRaises(seal.SealError):
            cs.seal({"one": "too many"})


class Handshake(unittest.TestCase):
    def test_a_replayed_hello_changes_nothing(self):
        client, _, cs, hs, _, hello, _ = pair()
        self.assertEqual(hs.open(cs.seal({"n": 1})), {"n": 1})
        with self.assertRaises(seal.SealError):
            client.hello(hello)  # the very same, valid hello again
        self.assertEqual(hs.open(cs.seal({"n": 2})), {"n": 2})  # counters untouched
        with self.assertRaises(seal.SealError):
            client.hi()

    def test_a_hello_from_another_connection_is_refused_and_the_real_one_still_works(self):
        client, host = seal.Client(ROOM, SECRET), seal.Host(ROOM, {"h": SECRET})
        hi = client.hi()
        *_, stale_hello, _ = pair()
        with self.assertRaises(seal.SealError):
            client.hello(stale_hello)
        hello, hs, _ = host.hi(hi)
        self.assertEqual(hs.open(client.hello(hello).seal({"ok": 1})), {"ok": 1})

    def test_hello_is_not_accepted_before_hi(self):
        *_, hello, _ = pair()
        with self.assertRaises(seal.SealError):
            seal.Client(ROOM, SECRET).hello(hello)

    def test_a_connection_is_established_once(self):
        client, host, *_, hi, _, _ = pair()
        with self.assertRaises(seal.SealError):
            host.hi(hi)
        with self.assertRaises(seal.SealError):
            host.hi(seal.Client(ROOM, SECRET).hi())

    def test_a_new_connection_doesnt_open_the_old_ones_frames(self):
        _, _, old_cs, old_hs, old_hi, _, _ = pair()
        old_c2h, old_h2c = old_cs.seal({"n": 1}), old_hs.seal({"n": 1})
        _, _, cs, hs, *_ = pair()
        for session, frame in ((hs, old_c2h), (cs, old_h2c)):
            with self.assertRaises(seal.SealError):
                session.open(frame)
        # a relay replaying the old hi gets a new session id, so the old frames still don't open
        _, replayed_hs, _ = seal.Host(ROOM, {"h": SECRET, "i": INVITE}).hi(old_hi)
        with self.assertRaises(seal.SealError):
            replayed_hs.open(old_c2h)

    def test_challenges_and_session_ids_are_fresh(self):
        his = {seal.Client(ROOM, SECRET).hi() for _ in range(20)}
        self.assertEqual(len(his), 20)
        client, host = seal.Client(ROOM, SECRET), seal.Host(ROOM, {"h": SECRET})
        hi = client.hi()
        self.assertNotEqual(host.hi(hi)[0], seal.Host(ROOM, {"h": SECRET}).hi(hi)[0])


class Links(unittest.TestCase):
    def test_the_host_learns_which_link_a_client_holds(self):
        self.assertEqual(pair("h")[-1], "h")
        self.assertEqual(pair("i")[-1], "i")

    def test_the_invite_secret_cant_pass_as_the_hosts_link(self):
        impostor = seal.Client(ROOM, INVITE, "h")  # holds the invite, claims the host's link
        with self.assertRaises(seal.SealError):
            seal.Host(ROOM, {"h": SECRET, "i": INVITE}).hi(impostor.hi())

    def test_a_guest_cant_read_the_hosts_own_session(self):
        _, _, host_cs, host_hs, hi, hello, _ = pair("h")
        frame = host_cs.seal({"auth": "the host's token"})
        guest = seal.Client(ROOM, INVITE, "i")
        guest.hi()
        with self.assertRaises(seal.SealError):
            guest.hello(hello)
        for keys in (seal.root_keys(INVITE, ROOM), seal.session_keys(INVITE, ROOM, SID, CN)):
            with self.assertRaises(seal.SealError):
                seal.Session(ROOM, keys, send="h2c", recv="c2h").open(frame)

    def test_a_room_without_an_invite_refuses_invite_clients(self):
        with self.assertRaises(seal.SealError):
            seal.Host(ROOM, {"h": SECRET}).hi(seal.Client(ROOM, INVITE, "i").hi())
        for junk in ("x.AAAA", "hAAAA", "", "h.", None):
            with self.assertRaises(seal.SealError):
                seal.Host(ROOM, {"h": SECRET}).hi(junk)

    def test_another_rooms_frames_dont_open(self):
        other = bytes(16)
        client = seal.Client(other, SECRET)
        with self.assertRaises(seal.SealError):
            seal.Host(ROOM, {"h": SECRET}).hi(client.hi())


class Js:
    """The browser's implementation, driven line by line through node."""
    def __init__(self):
        self.proc = subprocess.Popen([NODE, str(REPO / "web" / "tests" / "seal_cli.mjs")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def ask(self, **cmd):
        self.proc.stdin.write(json.dumps(cmd) + "\n")
        self.proc.stdin.flush()
        got = json.loads(self.proc.stdout.readline())
        if "error" in got:
            raise seal.SealError(got["error"])
        return got

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)
        self.proc.stdout.close()


@unittest.skipUnless(NODE, "node isn't installed: the browser half isn't checked here")
class Browser(unittest.TestCase):
    def setUp(self):
        self.js = Js()
        self.addCleanup(self.js.close)

    def test_the_browser_code_passes_its_own_tests(self):
        got = subprocess.run([NODE, "--test", str(REPO / "web" / "tests" / "seal.test.mjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(got.returncode, 0, got.stdout[-3000:] + got.stderr[-2000:])

    def test_a_python_client_and_a_browser_host(self):
        self.js.ask(cmd="host", room=seal.b64e(ROOM), secrets={"h": seal.b64e(SECRET), "i": seal.b64e(INVITE)})
        client = seal.Client(ROOM, INVITE, "i")
        got = self.js.ask(cmd="hi", frame=client.hi())
        self.assertEqual(got["kind"], "i")
        session = client.hello(got["hello"])
        for obj in SAY:
            self.assertEqual(self.js.ask(cmd="open", frame=session.seal(obj))["obj"], obj)
            self.assertEqual(session.open(self.js.ask(cmd="seal", obj=obj)["frame"]), obj)
        with self.assertRaises(seal.SealError):
            self.js.ask(cmd="open", frame=session.seal({"n": 1})[:-2] + "AA")

    def test_a_browser_client_and_a_python_host(self):
        hi = self.js.ask(cmd="client", room=seal.b64e(ROOM), secret=seal.b64e(SECRET), kind="h")["hi"]
        hello, session, kind = seal.Host(ROOM, {"h": SECRET, "i": INVITE}).hi(hi)
        self.assertEqual(kind, "h")
        self.js.ask(cmd="hello", frame=hello)
        with self.assertRaises(seal.SealError):
            self.js.ask(cmd="hello", frame=hello)  # replayed to the browser side
        for obj in SAY:
            self.assertEqual(session.open(self.js.ask(cmd="seal", obj=obj)["frame"]), obj)
            frame = session.seal(obj)
            self.assertEqual(self.js.ask(cmd="open", frame=frame)["obj"], obj)
            with self.assertRaises(seal.SealError):
                self.js.ask(cmd="open", frame=frame)  # and a frame opens once there too


if __name__ == "__main__":
    if sys.argv[1:] == ["--write-vectors"]:
        VECTORS.write_text(json.dumps(make_vectors(), indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {VECTORS}")
    else:
        unittest.main()
