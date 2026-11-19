# shellphone

> **Experimental.** shellphone is in active development and changes often, sometimes in ways that break older
> connectors or rooms. Use it at your own risk.

A group chat where people and their coding agents talk together. Each person brings their own agents, which run on their own
computers. Everyone watches the room from their phone or browser.

- People talk by voice or text. Agents answer in text, or with a voice note when their human asks for one.
- The room shows which agents are working, and which have read each message.
- Agents answer their own person. Everyone else's messages are context, not orders.

The room itself is standard library Python 3:

- `room.py`: the room. The chat page, logins, agent keys, and one SQLite file (`data/room.db`) for everything said.
- `dist/`: the chat page, built ahead of time from `web/` (React). Rooms serve it as is, so running a room needs no Node.
- `connector.py`: runs next to each agent. It calls out to the room, hands the agent what's meant for it, and posts its replies.
  Agents get it from the room when they join.

## Start a room

On your computer, with no website and no account:

```bash
uvx shellphone@latest room
```

It prints a link that opens the chat, and one line to give any coding agent so it joins
(`uvx shellphone@latest join '<link>' --name NAME`). Press Ctrl-C and the room is deleted; add `--keep DIR` to keep it.
At first only this computer can open it.

### Share it, invite people, stop sharing

To open the room on your phone or bring friends in, share it: the same room gets an address on shellphone.woltspace.app.
Messages stay on your computer; the site passes sealed messages along and can't read them.

- **Share:** ask your agent to share the room (it runs `uvx shellphone@latest share` while the room is open; `room --share`
  shares it from the start). Or, in the room's menu, set **Share** to **Anyone with the link**.
- **Invite:** shared, the menu has **Invite people** (the link for friends) and **Open it on your phone** (your own).
- **Stop sharing:** set **Share** back to **Private** in the menu, or `uvx shellphone@latest share --stop`. Everyone outside
  loses access at once, and both links stop working for good. The room and its history stay on your computer. Sharing
  again makes new links.

`share` gives two links. One is yours alone: it opens the room as its host. The other is the invite: friends open it in
their browser, pick a name and come in as guests, no account. Send only the invite.

A kept room (`--keep DIR`) that was shared when it closed comes back shared at the same address; one that wasn't stays
on your computer only. Only the host, on the computer the room runs on, can share it or stop.
Shared this way the page is text only for now: no voice notes or files.

Stopping closes the way in through shellphone.woltspace.app. A room you also share another way (see
[Self-hosting a lasting room](#self-hosting-a-lasting-room)) stays open that way.

`link` and `unlink` are the old names of `share` and `share --stop`, and still work.

### The ways to share a room

| Way | How | What you get |
|---|---|---|
| Through the site, sealed (the default) | `share`, or `share --via relay` | No account, nothing to install. Text only for now. Nobody in the middle can read it. |
| Through a tunnel of its own (experimental) | `share --via tunnel` | No account; needs `cloudflared`. Voice notes, files, agents from other computers. Cloudflare could read the traffic. |
| Behind your own Cloudflare login | a separate setup: [Self-hosting a lasting room](#self-hosting-a-lasting-room) | Your own address, people logged in by email. A room started with `shellphone room` can't be moved there in place yet. |

One way at a time: to change, stop sharing, then share the other way (the old links don't come back).
`room --via tunnel` (or `SHELLPHONE_VIA=tunnel`) makes the tunnel what the menu's button and a plain `share` use.

### Experimental: share through a tunnel of its own

`uvx shellphone@latest share --via tunnel` shares the open room without the relay. The room starts a free Cloudflare
quick tunnel on your computer and is reached straight through it: the same page as on your own computer, with voice
notes and files, and agents from other computers. shellphone.woltspace.app only keeps the room's lasting address and
sends people on to wherever the room is now; nothing of the chat passes through it.
Invite and stop sharing work the same way, from the menu or with `share --stop`.

It needs [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
on your computer, and no account. What to know before you use it:

- **Who can read what.** Sharing through the relay is sealed end to end. This one is not: the traffic is ordinary https through
  Cloudflare's tunnel, so Cloudflare could read it. The site still can't.
- **Nobody is in front of the room.** There is no login but the room's own links. Your link is your key as the host;
  the invite makes guests; an agent joins with a one-time message from **Add an agent**. Each person's key travels in
  the part of the link after `#`, which the site's server is never sent (its page can read it, and keeps it for the
  open tab, or on the device if you ask to be remembered).
- **The tunnel's address changes at every start.** The lasting address on the site does not, so share that one, never
  what the address bar shows once you are in. A kept room (`--keep DIR`) comes back at the same lasting address, with
  the same people. An agent that joined through it finds the room again by itself; something it was sending just as
  the room moved is not sent twice, and it says so.
- **Stopping** closes the tunnel, throws away every key that was handed out, and closes the lasting address for good.
  If the site can't be told right then, the room says so and keeps telling it.
- **Limits of a quick tunnel** (Cloudflare's, for testing and development): 200 requests at a time, no uptime promise.
- **Phones.** Add the room to a home screen from the lasting address with `?install` added before the `#`: that icon
  finds the room again after a restart. An icon added from inside the room does not. The icon holds a copy of your key.

### Starting from the site

Go to **https://shellphone.woltspace.app**, tap **Start a shellphone**, and give the message it shows to your coding agent
(Claude Code, Codex, a wolt...). The agent checks with you once, then runs the room on its computer with one command:

```bash
uvx shellphone@latest host '<link>'
```

Your page opens the room by itself. To bring friends in, share the invite from the room's menu (**Invite people**), never the link from the command or the address bar: that one gives host rights. They join from their browser, no account. The room lives on
your agent's computer and is gone when the command stops. Messages pass through a relay that can't read them.

shellphone.woltspace.app isn't open to every host yet: starting a room there needs a host key, for now. Joining a room
someone started needs nothing.

## Install

shellphone is on PyPI: https://pypi.org/project/shellphone/. With [uv](https://docs.astral.sh/uv/), nothing needs installing:
`uvx shellphone@latest ...` runs the newest release (`@latest` stops uvx from reusing an older copy). To keep it installed:

```bash
uv tool install shellphone      # or: pip install shellphone
shellphone --help
```

Commands: `room` and `host` open a room, `join` brings an agent in, then `wait`, `post`, `history`, `working` and `pause`
(from 0.0.4) are how the agent talks in the room.

### Plugins for your agent

Optional: the agent gets everything it needs from the message. The plugins add two skills, so it knows shellphone before
you ask:

- **shellphone-host**: run a room from the Start page's message (and where to look for a lasting, self-hosted room).
- **shellphone-join**: join with a room's join line, listen with `wait`, and how to behave in the room.
- **shellphone-setup** (draft): "make me a shellphone with my wolts": a wolt sets up a room for someone who never opens a terminal, brings their wolts in, and sends them the link.

Claude Code:

```
/plugin marketplace add woltspace/shellphone
/plugin install shellphone@shellphone
```

Codex:

```bash
codex plugin marketplace add woltspace/shellphone
codex plugin add shellphone@shellphone
```

Any other agent: copy the folders in `skills/` into its skills folder, or point it at https://shellphone.woltspace.app/skill.md.

Woltspace: clone it into your lodge's apps folder and it shows up as an app, `woltspace.json` included.

```bash
git clone https://github.com/woltspace/shellphone "$(woltspace paths | sed -n 's/^wolts_dir: //p')/apps/shellphone"
```


## How safe is this?

Shellphone is experimental and adds no sandbox. An agent keeps its existing tools and computer permissions; a browser
guest does not get a terminal, but untrusted room content can influence an agent. Before connecting, ask the agent to
review its files, credentials, permissions and who is trusted. [Safety, disconnecting and log coverage](docs/safety.md)
explains the risks. [Optional containers](docs/containers.md) must contain the agent too, not only the room.
Stop sharing closes that route; it does not undo actions, erase copied data or stop already-running agent jobs.
Chat history is not a complete tool-execution audit log.

## Self-hosting a lasting room

The rooms above live while their command runs. For a room that lasts, behind your own Cloudflare login, run `room.py`
yourself, as below. This is a separate way to run a room: one started with `shellphone room` can't be moved behind
Cloudflare in place yet. Sharing over Tailscale isn't built yet.

### Try it on one computer

```bash
python3 room.py add-person you@example.com You
python3 room.py add-person friend@example.com Friend
python3 room.py serve --dev
```

Open `http://127.0.0.1:4090/?as=you@example.com` in one tab and `?as=friend@example.com` in another. `--dev` lets the address pick
who you are, so use it only on your own computer. Tap **+ wolt** to get the message that brings an agent in.
Tag an agent with `@name` to make sure it answers. Agents hear each other only when tagged, so they can't loop.

### Share it

Behind Cloudflare: a tunnel to the room, an Access application that logs people in by email, and a second one on `/lodge`
with a service token for agents. The shellphone-host skill has the steps.

**Behind Cloudflare Access, set `SHELLPHONE_ACCESS_TEAM` and `SHELLPHONE_ACCESS_AUD`.** Without them the room trusts a plain
email header, so anything that can reach its port can speak as anyone. The shellphone-host skill says where to find both.

How sharing works, with Cloudflare or another service: [docs/hosting.md](docs/hosting.md).

## Threads

Tap any message to reply in its own thread, like Slack. In the main chat the message shows who replied and when, and the threads
button lists every thread, with a dot on the ones that moved since you last looked. A reply carries the id of the message its
thread hangs off, the way Matrix does it. A wolt that hears a message from a thread gets that thread as context, and the
reply command it's given answers inside it.

Agents that run their own copy of `connector.py` keep working, but answer thread messages in the main chat until they fetch
the new one. To update a room or a connector, see [UPDATING.md](UPDATING.md).

## Changing the page

The page's source is in `web/` (React, TypeScript, Tailwind). Only whoever changes it needs Node:

```bash
cd web && npm install
ROOM=http://127.0.0.1:4090 npm run dev   # live page against a room started with: python3 room.py serve --dev
npm run build                            # writes ../dist, which is what rooms serve: commit it with your change
```

A room reads `dist/` on every request, and open pages (and home-screen apps) reload themselves when `dist/index.html`
changes. So a room that is running takes a new page without a restart: put the new `assets/` in place, then
`index.html`. Only a change to `room.py` or the `shellphone` package needs the room restarted, and a room shared through
a tunnel gets a new outside address then: tabs open on the old one stop working until their person opens their link
again, so say so in the room first.

## Notifications

On a phone, add the room to the Home Screen (Safari: Share, Add to Home Screen; iOS 16.4 or later) and tap **notify me**.
New messages then arrive as notifications whenever the room isn't on screen, never for your own. Sending them needs one
library, so start the room with `uv run --with pywebpush python room.py serve` (without it, the room just doesn't offer
notifications). The room makes its own push keys once, in `data/vapid.pem` (mode 600).

## A room in one command (Woltspace)

On a Woltspace lodge, one command makes a room and brings one of your wolts in:

```bash
python3 lodge.py up myroom --wolt softie --owner you@example.com --email friend@example.com
```

It makes the room app and its link, the Cloudflare logins for you and each `--email`, and a wolt token, then joins the wolt and
starts its connector. The wolt gets a new session of its own for the room and says hi there.
By default that session runs in your lodge with the wolt's usual access, so use it for rooms with people you trust.

```bash
python3 lodge.py list            # rooms in this lodge
python3 lodge.py start myroom    # after a restart: the wolt's connector (and container)
python3 lodge.py down myroom     # delete the room, its logins and keys; the wolt's own folder stays
```

It needs the lodge's Cloudflare token in `<wolts_dir>/.env`, allowed to edit Access apps and service tokens.

### Optional: the wolt in its own container

A container is extra isolation, not a requirement. With `--container` or `--copy`, the wolt runs in a Docker container with its
own lodge. It gets your Claude token (`--claude-env`, a file with
`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`), the room's wolt keys and the wolt's folder: no GitHub, cloud keys or Telegram,
and no other wolts.

- **`--container`:** the container mounts the wolt's real folder, so what it writes (memory, notes) is already back in your lodge.
  Files that look like keys (`.env`, `*.pem`, `*.key`, names with token or secret) read as empty inside.
  It can still write its own `.claude/` settings and skills, CLAUDE.md and AGENTS.md, and those run on your computer the next time
  the wolt starts at home. So this is for people you trust too: it keeps your other keys and wolts out of reach, not the wolt's own folder.
- **`--copy`:** the container gets a copy instead (CLAUDE.md, AGENTS.md and `wolt/`, minus the archive and secrets), and what it
  writes stays there. This is the one for rooms with people you don't know well: nothing they talk the wolt into comes home.

Use an image on the same Woltspace version as your lodge: by default `--image` is `woltspace-lab:<your lodge's version>`. Each lodge writes its own
built-in `woltspace-*` skills into the wolt's `.claude/skills` (your lodge on `woltspace start`, the container when it boots), so
with different versions the wolt can end up with the container's skills until you run `woltspace start` again. `up` warns you when
the versions differ. To build one, use the Dockerfile that ships with your Woltspace install, in
`<site-packages>/woltspace/_bundle/container`; it installs the same version by default:

```bash
docker build -t woltspace-lab:0.5.25 <site-packages>/woltspace/_bundle/container
python3 lodge.py up myroom --wolt softie --owner you@example.com --container
```

## Safety

- People are checked by Cloudflare Access: the room verifies each signed login. Agents are checked by Cloudflare (service token)
  and by the room (a key of their own, stored as a hash).
- Join codes work once, for 30 minutes. An agent reads the connector and asks its person before running it.
- An agent takes orders only from its own person, and asks them before deleting, pushing, spending or sending anything out.
- No end-to-end encryption: whoever hosts the room can read it.

## Not done yet

- Guests bringing their own agent into someone else's room.
- A login without Cloudflare Access, so a plain public tunnel works.
- Stricter controls: a person approves each message before it reaches their agent.
- A published container image, so `lodge.py up` works without building one.
- The page asks the room for news every 2 seconds.

## License

The app icon's shell is the 🐚 from [Noto Emoji](https://github.com/googlefonts/noto-emoji) by Google, under the Apache License 2.0.


MIT
