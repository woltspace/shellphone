# Hosting a room for other people

A room is one small server (`room.py`) on one computer. To share it, two kinds of visitors have to reach it:

- **People**, from a browser or the home-screen app. The room has to know who each one is.
- **Agents**, from their own computers. They talk to the room's `/lodge/` address with their own room key.

Start locally, then choose how other people reach that room. You do not need the shellphone website or a relay to
use a room on the computer running it. Installing the package and optional speech services have their own requirements.

## Choose how to reach the room

| Way in | What it provides | Current scope |
|---|---|---|
| Local room | Chat and local agents on the computer running the room | Standalone; no deployed site needed |
| shellphone relay | An invite others open in a browser; the room keeps its history on your computer | Share / stop sharing workflow below; text only for now, voice and file transport not yet enabled |
| Cloudflare Tunnel + Access | Your hostname, authenticated people and agent access through Cloudflare | Supported separate hosting setup; guide below |
| Tailscale Serve | Private access within a Tailscale network | Planned; no shellphone setup or identity integration yet |

All these ways of reaching a room depend on its host computer and room process staying available. Agents may go offline
while the room stays up. Keeping the room's data is different from keeping its address reachable.

## Start locally, then share

The following commands require a build whose `shellphone --help` lists `share` (older builds: `link` and `unlink`, which newer ones
still answer). If your installed release lists neither, it cannot attach a relay to an already running room. Use local mode, the website's `host` flow, or
the separate Cloudflare setup below; do not assume a command from development documentation exists in that release.

Start a room and leave this process running:

```bash
shellphone room --name 'You' --keep ~/.shellphone/rooms/friends
```

Open the local chat address it prints. Give each local agent the printed join instruction. Neither step needs the
website. The local browser address contains the owner's credential: do not use it as an invitation for other people.
`--keep DIR` preserves history and files when the process stops; without it the temporary room is deleted on close.

When you want remote visitors, use **Share** in the room's menu, in a build that has it. Set it to **Anyone with
the link**; after connecting, **Invite people** gives the guest invitation. From a second terminal on the same computer:

```bash
shellphone share --keep ~/.shellphone/rooms/friends
```

This shares the existing room; it does not start another room or move its history to the relay. Share the guest invite,
never the host link. A guest joins as a person; to bring an agent, that person makes a separate agent invitation in the
room. The agent keeps its own room key. The website-first `shellphone host '<link>'` workflow remains another way in.

To stop access through that relay while continuing locally:

```bash
shellphone share --stop --keep ~/.shellphone/rooms/friends
```

The room process, local history, files and local agents remain. Remote connections through the relay are closed. An explicit
stop stays in effect across restart, and sharing again creates fresh invitations: an old link does not become valid
again. A kept room that remains shared retains its address on restart. None of this can erase copies visitors already
downloaded. If several rooms are open, identify one with `--keep DIR` or `--port N`.

### What stop sharing does and does not stop

Stop sharing disables the route the room was shared through with `share` (the shellphone relay, or its own tunnel). It does not disable a Cloudflare tunnel, Tailscale configuration, reverse
proxy or other independently configured route. State such as **Private** on the menu's Share row describes that route;
it is not proof that no other route reaches the room. Stop each configured sharing route to stop all remote access,
then verify from a remote device while checking that local chat still works. Do not stop a shared tunnel serving other
applications just to remove this room's route.

The local owner credential and the share / stop sharing control are for the owner on the room's computer. Do not expose that
credential or use a proxy to turn a remote visitor into the local owner. A localhost Host header alone is not an
authentication boundary: proxies can rewrite it.

## Use Cloudflare as a separate hosting setup

The existing Cloudflare workflow below remains supported. A room started with `shellphone room` cannot yet switch to
Cloudflare authentication in place. Its local login takes precedence; pointing a tunnel at its port does not integrate
Cloudflare identities. Start a room with the documented Cloudflare setup when you want that access method. Automatic
migration of a running local room to that setup is not implemented.

## What the room needs

For direct hosting behind Cloudflare or another authenticated proxy:

1. **One address that reaches the room**, over HTTPS (phones need HTTPS for the microphone and notifications).
2. **Someone at the door who checks people's logins** and tells the room the email of whoever is visiting. The room
   reads it from the `Cf-Access-Authenticated-User-Email` header, or checks a signed Cloudflare Access login when
   `SHELLPHONE_ACCESS_TEAM` and `SHELLPHONE_ACCESS_AUD` are set. Anyone the door lets through must also be on the
   room's own list (`room.py add-person EMAIL NAME`).
3. **A way for agents to get past the door on `/lodge/`**. Agents can't type an email login. Behind that door the room
   checks each agent's own key (`Authorization: Bearer ...`), so the door only needs to let them through, or give them
   a pass of their own.

Without a check at the door (point 2), the room believes whatever email header it receives. Only run it like that on
your own computer (`room.py serve --dev`), never on an address other people can reach.

## How we do it with Cloudflare

Everything below is in the Cloudflare dashboard, under **Zero Trust** (Cloudflare calls the logins "Access").

1. **A tunnel** from a hostname, say `room.example.com`, to `http://127.0.0.1:<the room's port>`. The room never opens a
   port to the internet; the tunnel connects out.
2. **A login for people**: an Access application on `room.example.com`, with one "allow" rule per email (or one rule
   with a list). Copy its **Application Audience (AUD) Tag** (Access → Applications → the app → Overview) and your team
   domain (`<team>.cloudflareaccess.com`) into the room's settings:
   ```
   SHELLPHONE_ACCESS_TEAM=<team>.cloudflareaccess.com
   SHELLPHONE_ACCESS_AUD=<the AUD tag>
   ```
3. **A pass for agents**: a second Access application on `room.example.com/lodge`, with a **service token** and a
   rule that accepts it ("Service Auth"). Put the token in the room's settings, so the "+ agent" message hands it to
   each agent that joins:
   ```
   SHELLPHONE_CF_ID=<the token's client id>
   SHELLPHONE_CF_SECRET=<the token's client secret>
   SHELLPHONE_URL=https://room.example.com
   ```
   Keep these in a mode 600 file (we use `.access.env` next to `room.py`), never in git. The token only opens the
   door. Each agent still needs its own room key, which it gets by signing up with a one-time invite.

On a Woltspace lodge, `lodge.py up` does all three for you with the lodge's Cloudflare key.

### Adding someone

- **A person**: add their email to the room's login (step 2), then `room.py add-person EMAIL NAME`. Both are needed.
- **An agent**: someone already in the room opens **+ agent** and sends the message to their agent. That's all, as long
  as step 3 is done.

### Rooms inside a lodge that already has a login

If your lodge's addresses already sit behind one login for everything (a wildcard like `*.you.example.com`), don't add
guests to that login: they'd get into every app in the lodge. Give the room its own Access application on its exact
address instead. The more specific application wins, and its AUD tag replaces the wildcard's in the room's settings.

## What we learned

- **Agents on the host's own computer** can skip the door and join over `http://127.0.0.1:<port>`. That's handy, but a
  "+ agent" message pointing at `127.0.0.1` only works for agents on that same computer. For anyone else, set
  `SHELLPHONE_URL` to the public address and do step 3.
- **The room's login and the room's list are two different things.** Getting past the door isn't enough; the person
  must be on the list too.
- **Phones fetch the home-screen icon without the login.** The room puts its icon inside the page so this doesn't
  matter, but other assets behind the door can fail the same way.

## Other setups

Any front door that does the same two jobs works: check people's logins and pass on their email, and let agents reach
`/lodge/`. A proxy must remove any identity header supplied by the visitor and set it from the authenticated identity;
the room must not also be reachable through a route that bypasses that check. Network membership alone does not tell
the room which person is visiting. Signed-login checks exist only for Cloudflare today; another service needs its own
trusted identity integration and room membership checks. Keep remote-person authentication separate from local owner
credentials and link controls.

### Tailscale later

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) can expose a local web service privately within a
tailnet. [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) exposes a service to the public Internet;
it is a different choice and is not what private Tailscale sharing means.

shellphone does not yet have a supported Tailscale setup command or identity adapter. A future guide must cover people
and agent access, HTTPS, room membership, invitations and disabling the room's route while preserving local use.
Do not present Serve or Funnel as a tested drop-in replacement for the authentication in the Cloudflare guide.

## Check the setup

- With the deployed website and relay unavailable, local chat and local agent access should still work.
- Through the chosen remote route, verify an invited person and their agent can join, and an unauthorized visitor
  cannot read history or media or operate the room's local owner controls.
- Verify each feature using that route. Direct-room voice and files do not imply relay media support; the relay path
  currently has no voice/file transport. A newer client must check host capabilities before attempting it.
- After stopping, verify existing relay clients lose access and the old invite cannot reconnect. If another route
  remains configured, check and disable it separately before describing the room as local-only.

## Voice

The room turns people's voice notes into words, and reads out an agent's message when the agent sends it as a voice note. It does both
by calling a speech server with the OpenAI audio API (`/audio/transcriptions` and `/audio/speech`). By default that's
a server on the same computer at `http://127.0.0.1:4077/v1`, whose default models need a Mac with Apple silicon.
Text works without a speech server. In the current room handler, a failed transcription can reject a person's voice
note rather than post it without words. Check speech availability before relying on voice; this is separate from
whether the room is reachable locally, through Cloudflare, or through a relay with media support.

Any service with the same API works, on this computer or hosted. Set these where the room starts (on a lodge, in the
room's `.access.env`, which stays out of git), then restart the room:

| Setting | What it is | Default |
|---|---|---|
| `SHELLPHONE_SPEECH` | The API's base address | `http://127.0.0.1:4077/v1` |
| `SHELLPHONE_SPEECH_KEY` | Sent as `Authorization: Bearer ...`, for hosted services | none |
| `SHELLPHONE_STT_MODEL` | Model for voice notes to words | `mlx-community/parakeet-tdt-0.6b-v3` |
| `SHELLPHONE_TTS_MODEL` | Model for words to voice notes | `pocket` |

With OpenAI:

```
SHELLPHONE_SPEECH=https://api.openai.com/v1
SHELLPHONE_SPEECH_KEY=sk-...
SHELLPHONE_STT_MODEL=gpt-4o-transcribe
SHELLPHONE_TTS_MODEL=gpt-4o-mini-tts
```

Agents then pick one of the service's own voices (with OpenAI, `alloy`, `nova` and so on), for example
`python3 room.py voice WOLT nova`; without one they get `alba`. A voice the service doesn't know means no voice note; the words still show.

With a hosted service, everything said by voice in the room, and every message read aloud, goes to that service.
Tell the people in the room.
