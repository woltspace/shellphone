"""The room's doors hold to the room's rules (shellphone/core.py), each in its own way: an agent's code belongs to the
one door it was handed out at, only the host changes what guests may do, and a full room stays full. One room, driven
in a process of its own (tests/doors_room.py): no tunnel, relay, site or network."""
import json, os, subprocess, sys, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class Doors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        p = subprocess.run([sys.executable, str(REPO / "tests" / "doors_room.py")], capture_output=True, text=True, timeout=120, env={**os.environ, "PYTHONPATH": str(REPO)})
        assert p.returncode == 0, p.stderr[-3000:]
        cls.got = json.loads(p.stdout.strip().splitlines()[-1])

    def relay(self):
        if not self.got["relay"]:
            self.skipTest("the relay's cases need the cryptography package")
        return self.got

    def test_a_relay_links_code_for_an_agent_works_through_that_link_only(self):
        g = self.relay()
        self.assertEqual((g["relay_code_at_another_link"], g["relay_code_at_this_computer"]), (401, 401))
        self.assertEqual((g["relay_fresh_code"], g["relay_fresh_code_again"]), (200, 401))  # through its own link, once
        self.assertTrue(g["agent_key_marked_with_its_link"])

    def test_a_code_from_before_a_stop_is_dead_whatever_link_comes_next(self):
        g = self.relay()
        self.assertEqual((g["relay_code_after_stop_through_a_new_link"], g["relay_code_after_stop_at_this_computer"]), (401, 401))

    def test_this_computers_code_works_here_and_through_no_link(self):
        g = self.relay()
        self.assertEqual((g["this_computers_code_through_the_relay"], g["this_computers_code_here"]), (401, 200))
        self.assertTrue(g["agent_key_of_this_computer_unmarked"])

    def test_only_the_host_changes_what_guests_may_do(self):
        g = self.relay()
        self.assertEqual((g["guest_sets_guest_agents"], g["guest_agents_still"]), (403, True))
        self.assertNotEqual(g["guest_reads_invite"], 200)
        self.assertEqual((g["host_sets_guest_agents"], g["guest_agent_invite_when_off"], g["host_agent_invite_when_off"]), (200, 403, 200))

    def test_a_message_for_an_agent_asked_for_while_sharing_stops_is_no_message(self):
        g = self.got
        self.assertIsNone(g["tunnel_steps_while_stopping"])
        self.assertEqual((g["tunnel_codes_made_while_stopping"], g["tunnel_unbound_codes"]), (0, 0))  # and no code of this computer's is made in its place
        self.assertIsNone(g["tunnel_steps_when_closed"])

    def test_stopped_and_shared_again_nothing_from_before_gets_anything_of_what_is_shared_now(self):
        g = self.got
        self.assertIsNone(g["tunnel_steps_with_a_key_from_before"])  # a call that was on its way with the old host key
        self.assertIsNone(g["tunnel_steps_with_no_key"])
        self.assertTrue(g["tunnel_steps_with_todays_key"])
        self.assertEqual((g["tunnel_invite_from_before"], g["tunnel_key_from_before"]), (403, 403))

    def test_a_message_for_an_agent_is_the_rooms_rule_at_every_door(self):
        g = self.got
        self.assertEqual((g["join_page_here_host"], g["join_page_tunnel_host"], g["join_page_tunnel_guest"]), (200, 200, 200))
        self.assertEqual((g["hostonly_tunnel_guest"], g["hostonly_tunnel_host"], g["hostonly_here_host"]), (403, 200, 200))  # change the rule, and the doors follow
        self.assertEqual((g["nobody_here_host"], g["nobody_tunnel_host"]), (403, 403))
        self.assertEqual((g["hostonly_access_member"], g["hostonly_access_host"]), (403, 200))

    def test_a_room_behind_a_login_of_its_own_works_as_before(self):
        g = self.got
        self.assertEqual((g["access_join_page_host"], g["access_join_page_member"], g["access_join_page_stranger"]), (200, 200, 403))
        self.assertEqual(g["access_agent_joins_with_a_code"], 200)
        self.assertEqual((g["access_share_switch"], g["access_share_state"]), (403, 403))  # sharing from this computer isn't that room's to do

    def test_a_room_py_without_the_rules_next_to_it_says_so_and_does_not_open(self):
        import shutil, socket, tempfile
        with tempfile.TemporaryDirectory() as td:
            shutil.copy(REPO / "room.py", td)  # copied somewhere by itself
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                port = s.getsockname()[1]
            p = subprocess.run([sys.executable, "-I", "-S", "room.py", "serve", "--dev", "--port", str(port)], cwd=td, capture_output=True, text=True, timeout=20,  # -S: no installed packages either
                               env={k: v for k, v in os.environ.items() if k != "PYTHONPATH"})
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("can't find the room's rules", p.stderr)
            self.assertIn("complete checkout", p.stderr)
            self.assertNotIn("shellphone room on http", p.stdout)  # it never got as far as listening

    def test_a_post_is_taken_from_the_rooms_own_page_and_from_nowhere_else(self):
        g = self.got["gate"]
        for ok in ("page", "page_fetch_metadata", "by_its_other_name", "json_with_charset"):
            self.assertEqual(g[ok], 200, ok)
        for no in ("name_mismatch", "other_port", "no_port", "https", "null", "empty", "elsewhere", "lookalike", "cross_site_metadata", "same_site_metadata", "forwarded_claims"):
            self.assertEqual(g[no], 403, no)

    def test_with_no_origin_only_the_hosts_own_command_gets_in_and_a_key_never_excuses_a_foreign_one(self):
        g = self.got["gate"]
        self.assertEqual(g["no_origin_with_key"], 200)
        for no in ("no_origin", "key_without_cookie", "wrong_key", "same_nonsense_twice", "key_and_foreign_origin", "key_and_null_origin", "key_and_cross_site"):
            self.assertEqual(g[no], 403, no)

    def test_what_isnt_sent_as_json_isnt_read_as_json(self):
        g = self.got["gate"]
        self.assertEqual((g["as_text"], g["as_form"], g["no_type"], g["enter_as_text"]), (415, 415, 415, 415))

    def test_an_agents_call_is_judged_by_its_own_key_and_no_cookie_counts_there(self):
        g = self.got["gate"]
        self.assertEqual((g["agent_no_origin"], g["agent_path_with_a_persons_cookie"]), (401, 401))

    def test_the_tunnels_door_takes_posts_from_the_tunnels_page_only(self):
        g = self.got["gate"]
        self.assertEqual((g["tunnel_page"], g["tunnel_no_origin_with_key"], g["enter_page"]), (200, 200, 200))
        for no in ("tunnel_from_this_computers_page", "tunnel_http", "tunnel_another_tunnel", "tunnel_no_origin", "tunnel_key_of_this_computer", "enter_from_elsewhere", "enter_no_origin"):
            self.assertEqual(g[no], 403, no)

    def test_a_room_behind_a_login_takes_posts_from_the_address_it_was_set_up_with(self):
        g = self.got["gate"]
        self.assertEqual((g["login_room_page"], g["login_room_page_whatever_host_says"], g["login_room_dev_this_computers_page"]), (200, 200, 200))
        for no in ("login_room_address_not_set", "login_room_host_header_is_not_an_origin", "login_room_http", "login_room_no_origin", "login_room_no_origin_with_a_key", "login_room_this_computers_page", "login_room_dev_no_origin"):
            self.assertEqual(g[no], 403, no)

    def test_a_full_room_stays_full_at_every_door(self):
        g = self.got
        self.assertEqual((g["tunnel_full"], g["tunnel_full_added"]), (429, 0))
        if g["relay"]:
            self.assertEqual((g["relay_full"], g["relay_full_added"]), (429, 0))


if __name__ == "__main__":
    unittest.main()
