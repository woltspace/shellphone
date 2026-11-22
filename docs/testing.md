# Testing that shellphone works

"It works" means: **on every way into a room, people can be invited, files get across, agents can join and answer, and
all of it ends when sharing stops**, checked with real rooms in throwaway containers, at the commit in question.
Passing unit tests is the start of that, not the whole of it.

## Three steps

1. **The suite**, in a container for a branch you don't trust yet: `python -m unittest discover -s tests`
2. **The live test** (Docker, 4 to 8 minutes): `uv run python tests/live/live.py`
   It tests committed files (`--ref` for another commit), prints a table for the pull request and exits 1 if anything failed.
3. **A phone**, for what only a person can see: the checklist below.

## The ways in

| path | what it is | how it's tested |
|---|---|---|
| `local` | a room on this computer | the agent shares the room's "computer" |
| `own-domain` | a fixed address of your own (`--hostname`) | the tunnel's real door behind TLS, standing in for Cloudflare |
| `own-relay` | a relay of your own | this commit's relay, run by Wrangler in a container |
| `site-relay` | the shellphone site's sealed relay (`/r/` links) | the real site |
| `site-tunnel` | the site's lasting link to a tunnel of the room's (`/t/` links) | the real site and a real quick tunnel |
| `domain` | your own named tunnel, for real | only with `--domain check.example.com`, while `shellphone tunnel run` is up |

`--paths local,own-domain,own-relay` opens nothing public. The relay of `own-relay` is this commit's; the site's is
whatever is deployed. To test a relay you deployed, give it as the site: `--relay https://relay.example.com`.

`domain` uses the door and tunnel that are running on your computer, which may be another commit than the one tested.
`own-domain` is the one that tests this commit's door.

## What has to work on each

The room and whoever comes to it are always in separate containers.

| | local | own-domain, domain, site-tunnel | own-relay, site-relay |
|---|---|---|---|
| **host**: gets in, chats (and the app loads, except by relay) | yes | yes | yes |
| **invites**: a guest joins, reads, chats, is seen; a wrong invite is refused | no invites here | yes | yes |
| **files**: host, guest and agent send; the bytes come back the same | yes (no guest) | yes | **none yet**: must be refused, not lost |
| **agents**: invited, join from elsewhere, code works once, listen, hear, answer | yes | yes | yes |
| **keys**: a wrong key reads nothing | yes | yes, and none can send over 4 KB | yes |
| **restart**: same link, guest and agent still in, history kept | agent and history | yes | yes |
| **revoke**: `share --stop` ends host, guest and agent at once | not shared | yes | yes |

A change to what a path supports changes this table and `tests/live/live.py` in the same pull request.

## What to run for which change

| you changed | run |
|---|---|
| words, docs | the suite |
| the room, the CLI, the connector | every path |
| the door, hostnames, the tunnel | every path, and `--domain` |
| the relay or the pipe | every path; after a deploy again, as `site-relay` then tests what was deployed |
| the page, the service worker, the manifest | every path, and a phone |
| a release | every path, `--domain`, and a phone |

## With a phone

`uv run python tests/live/live.py --phone` leaves the rooms up and writes their links to a private file (they are keys:
send them privately, never in a pull request or a log). Then, for each link:

- [ ] it opens, and a message sent from the phone shows up
- [ ] an invite opened on another phone or browser lets a guest in, and both see each other
- [ ] a photo sends and opens (not through a relay)
- [ ] a voice note sends and comes back as words (needs a speech service where the room runs)
- [ ] added to the home screen, it opens in the room; at an address of your own, closing the room shows the offline page

Afterwards: `uv run python tests/live/live.py --clean` (with the same `--domain`, if you gave one).

## What this doesn't show

Real browsers (see `tests/browser/README.md`), voice, notifications, pages, load, a computer that sleeps, and security:
the key checks here are a smoke test, not a review. Say in the pull request what you ran, at which commit, and what you didn't.
