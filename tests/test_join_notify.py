"""Someone new in the room is a notification for everyone with them on: a guest who came in by an invite, or an agent
that signed itself up. Not for the newcomer, nor for the human who sent their own agent, and not again when an agent
signs up anew. Driven in a process of its own (tests/join_notify_room.py), with a stand-in push service."""
import json, os, subprocess, sys, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class JoinNotify(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        p = subprocess.run([sys.executable, str(REPO / "tests" / "join_notify_room.py")], capture_output=True, text=True, timeout=120, env={**os.environ, "PYTHONPATH": str(REPO)})
        if p.returncode and "cryptography" in p.stderr:
            raise unittest.SkipTest("push keys need the cryptography package")
        assert p.returncode == 0, p.stderr[-3000:]
        cls.got = json.loads(p.stdout.strip().splitlines()[-1])

    def test_a_guest_coming_in_by_an_invite_is_told_to_everyone_even_someone_looking(self):
        self.assertEqual(self.got["guest"], [200, [["host@shellphone.local", "Gus joined"], ["member@x.org", "Gus joined"]]])

    def test_an_agent_signing_up_is_told_to_everyone_but_its_own_human(self):
        self.assertEqual(self.got["agent"], [200, [["host@shellphone.local", "rocky joined (Mem's agent)"]]])

    def test_an_agent_signing_up_again_is_not_news(self):
        self.assertEqual(self.got["agent_again"], [200, []])


if __name__ == "__main__":
    unittest.main()
