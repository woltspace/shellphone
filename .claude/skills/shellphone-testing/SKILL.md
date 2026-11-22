---
name: shellphone-testing
description: Test that a shellphone change really works before calling it done or ready to merge: every way into a room (local, own domain, own relay, the site's relay, the site's tunnel link) times invites, files and agents, with real rooms in throwaway containers. Use when asked to test, verify or live-test shellphone, or before saying a pull request is ready.
---

# Testing shellphone

Read `docs/testing.md`: it defines what "works" means and what to run for which change.

1. Commit what you want tested (the live test only sees committed files).
2. Run the suite, then `uv run python tests/live/live.py` (add `--domain NAME` for a change to the door or the tunnel,
   when the owner has a named tunnel and agrees to a test name on it).
3. A change to the page, or a release: `--phone`, send the owner the links privately (they are keys: never print them
   or put them in a pull request), and `--clean` when they're done.
4. Put the printed table in the pull request with the commit and what you didn't test. A FAIL or a path you skipped is
   reported as that, never rounded up to "works".

Everything runs in throwaway containers with empty rooms. Don't test on someone's real room.
