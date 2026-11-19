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
        self.assertEqual(g["same_nonsense_twice_why"], "only the room's own page can post")  # the same key twice proves nothing: it is refused at the gate
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

    def test_the_host_makes_invites_from_this_computer_and_from_their_phone(self):
        v = self.got["invites"]
        self.assertTrue(v["first_invite_shown"])
        self.assertEqual((v["made_here"], v["made_from_outside"], v["link_is_the_lasting_address"]), (200, 200, True))
        self.assertEqual(v["answer_keys"], ["expires", "id", "link", "uses_left"])  # the link is said once, in this answer
        self.assertEqual((v["comes_in"], v["comes_in_twice"], v["third_is_refused"]), (200, 200, 403))
        self.assertEqual(v["personal_name"], "Grace Hopper")  # whatever was typed at the door
        self.assertEqual((v["listed"], v["listed_count"], v["list_says_no_secret"]), (200, 1, True))  # the first invite; the two others are used up

    def test_only_the_host_touches_invites_at_the_http_door_too(self):
        v = self.got["invites"]
        self.assertEqual((v["guest_makes"], v["guest_lists"], v["guest_ends"], v["stranger_makes"]), (403, 403, 403, 403))
        self.assertEqual((v["bad_ends_in"], v["not_an_object"], v["make_when_not_shared"]), (400, 400, 409))
        self.assertEqual(self.got["access_invites"], [403, 403])  # a room behind a login has none: its owner adds people

    def test_ending_invites_ends_the_first_one_too_and_for_good(self):
        v = self.got["invites"]
        self.assertEqual(v["ended"][0], 200)
        self.assertGreaterEqual(v["ended"][1], 1)
        self.assertEqual((v["first_invite_after_end"], v["first_invite_stays_ended"], v["first_invite_gone_from_the_menu"], v["guests_stay_after_end"]), (403, 403, True, True))

    def test_when_the_rooms_database_refuses_at_the_last_moment_nobody_is_half_let_in(self):
        v = self.got["invites"]
        self.assertEqual(v["when_the_database_refuses"], [500, None, 0, False, 0])  # no key, nobody on the list, nothing left open
        self.assertEqual(v["when_the_database_is_gone"], [500, None])
        self.assertEqual(v["and_the_one_place_is_still_there"], [200, 200])

    def test_a_notification_is_signed_with_an_address_a_push_service_takes(self):
        g, there = self.got, "https://shellphone.dev"
        # the host of a room on their own computer, a guest, and someone with no address at all: the project's; a real address: their own
        self.assertEqual(g["push_signed_with"], [there, there, "mailto:Ada.Lovelace@example.org", there])
        self.assertEqual(g["push_contact"], ["mailto:me@gmail.com", "mailto:Me@Example.COM", there, there, there, there, there])

    def test_an_app_that_signed_up_at_a_tunnel_address_the_room_no_longer_has_gets_no_more_notifications(self):
        g = self.got
        self.assertEqual(g["push_signup"], [200, 200])
        self.assertEqual(g["push_signup_at"], {"through-the-tunnel": "door.trycloudflare.com", "on-this-computer": ""})
        keeps = ["from-before", "this-address", "this-computer"]  # the old address's app is not sent to, and is forgotten; one from before this was kept track of stays
        self.assertEqual(g["push_after_a_new_address"], [keeps, keeps])
        self.assertEqual(g["push_after_sharing_stopped"], [["from-before", "this-computer"]] * 2)

    def test_the_command_makes_and_ends_invites_and_says_so_when_none_is_open(self):
        v = self.got["invites"]
        self.assertEqual((v["command_says"], v["command_link_works"], v["command_forever"]), ([True, True, True], "Ada", True))
        self.assertEqual(v["command_bad"], "refused:")
        self.assertEqual(v["command_lengths"], [True] * 5)  # 30 minutes unless said, and said back as people say it
        self.assertEqual(v["command_one_length"], ["refused:"] * 5)
        self.assertTrue(v["share_says_how_long"])
        self.assertTrue(v["page_default"])  # a page that names no length gets the same 30 minutes
        self.assertTrue(v["command_words_without_an_invite"])  # share's own words, once the first invite was ended
        self.assertEqual(v["command_end"], "0 open invites ended. ")

    def test_guests_invite_over_http_only_while_the_host_lets_them(self):
        v = self.got["guests_invite"]
        self.assertEqual((v["guest_sets"], v["off_to_begin_with"], v["bad_body"]), (403, False, 400))
        self.assertEqual(v["host_sets_from_outside"], [200, {"guests_can_invite": True}])
        self.assertEqual((v["guest_makes"], v["guest_makes_one_with_no_end"], v["friend_comes_in"]), ([200, True], 400, 200))
        self.assertEqual(v["guest_still_cant"], [403, 403, 403])  # list, end, or touch sharing
        self.assertIn(False, v["host_sees_who_invited"])  # one of the open invites is not the host's
        self.assertEqual((v["host_stops_it"], v["after_off"], v["on_again_old_invite"]), ([200, {"guests_can_invite": False}], [403, 403], 403))
        self.assertEqual(v["command"], [True, False, True])

    def test_invites_end_with_what_they_were_made_through(self):
        v = self.got["invites"]
        self.assertEqual((v["after_stop_sharing"], v["old_invite_through_a_new_address"], v["new_address_first_invite"]), (403, 403, 200))

    def test_invites_through_the_relay_follow_the_same_rules(self):
        v = self.relay()["relay_invites"]
        self.assertEqual((v["default_length"], v["no_end_when_said"], v["default_over_after_30_minutes"] != 200), (True, True, True))  # 30 minutes through the relay too, unless said
        self.assertEqual((v["made"], v["link_is_this_links"], v["comes_in"], v["is_in"], v["once"], v["at_another_link"]), (200, True, 200, 200, 403, 403))
        self.assertEqual(v["only_a_name_is_asked_of_it"], 403)  # an invite is not a key: it can ask for a place, nothing else
        self.assertEqual((v["guest_makes"], v["guest_lists"], v["guest_ends"], v["guest_sets_the_switch"]), (403, 403, 403, 403))
        self.assertEqual((v["host_sets_the_switch"], v["guest_makes_when_on"], v["friend_of_guest_comes_in"]), ([200, {"guests_can_invite": True}], 200, 200))
        self.assertEqual((v["host_stops_it"], v["guests_invite_after_off"]), ([200, {"guests_can_invite": False}], 403))
        self.assertEqual(v["listed"][::2], [200, False])  # the first invite; the one-place invite is used up; no secret in the list
        self.assertEqual((v["first_invite_key"], v["ended"][0], v["first_invite_after_end"], v["first_invite_key_after_end"], v["first_invite_gone_from_info"]), (200, 200, 403, 404, True))
        self.assertGreaterEqual(v["ended"][1]["ended"], 1)
        self.assertEqual(v["guests_stay"], [200, 200])

    def test_opening_a_page_makes_no_code_whoever_sends_the_browser_there(self):
        g = self.got
        self.assertEqual((g["page_opened"], g["page_opened_from_another_site"], g["access_page_opened_from_another_site"]), ([200, 0], [200, 0], [200, 0]))
        self.assertEqual((g["asked_from_another_site"], g["asked_by_the_page"]), ([403, 0], [200, 1]))

    def test_a_full_room_stays_full_at_every_door(self):
        g = self.got
        self.assertEqual((g["tunnel_full"], g["tunnel_full_added"]), (429, 0))
        if g["relay"]:
            self.assertEqual((g["relay_full"], g["relay_full_added"]), (429, 0))


if __name__ == "__main__":
    unittest.main()
