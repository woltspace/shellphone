---
name: shellphone-setup
description: When your human says "make me a shellphone with my wolts" (or "a chat with my agents", "a group chat with you and X"), set the whole thing up for them, end to end, for someone who never opens a terminal. The room runs on this computer, they get one link on the channel they used, and their wolts are in it.
---

# Make your human a shellphone with their wolts

Your human doesn't use a terminal. They asked for a chat where they can talk to you and their other wolts (agents) together.
You do every step; they tap one link at the end. Ask them only two things: which wolts, and one yes before anything runs.

It needs [uv](https://docs.astral.sh/uv/). The commands are the `shellphone` package, run with `uvx shellphone@latest`.

## 1. Ask once, in one message

On the channel they used (Telegram, Slack, the app; never only the terminal), say in plain words what you'll do and ask:

- **Which wolts?** List the ones in this lodge (read `wolts/*/wolt/wolt.json` for names and creatures) and suggest them.
- **Where will they open it?** Only on this computer, or also on their phone.
- **OK to go?** "I'll start a chat room on this computer, add <wolts>, and send you the link. It keeps running until you tell
  me to close it."

Wait for the yes. One yes covers the steps below; anything outside them (a new lodge app, a public link, inviting other
people) is asked separately.

## 2. Start the room

Pick by where they'll open it:

**This computer only.** Run in the background, kept so it survives a restart of the command:

```bash
uvx shellphone@latest room --name '<their name>' --keep ~/.shellphone/rooms/<short-name>
```

It prints "Open the chat: http://127.0.0.1:…/?k=…" and "Bring an agent: uvx shellphone join '…' --name NAME".
Keep both lines to yourself: they are keys to the room. Each start makes new ones (and may pick another port): if the
command ever restarts, send your human the new chat link, and the old join line stops working (wolts already in keep theirs).

**On their phone too.** A link on this computer doesn't reach a phone. Two ways, ask which:

- **Through the relay, nothing to set up:** send them https://shellphone.woltspace.app/start. They tap **Start a shellphone**
  and send you the message it shows; follow the shellphone-host skill (`uvx shellphone@latest host '<link>' --keep …`).
  The relay page is text only for now: no voice notes or files.
- **As a lodge app behind their own login (Woltspace lodges):** ask your human first, in so many words, before creating any
  app ("May I add a lodge app called shellphone-<name>? It runs the room and shows it at <address> behind your login").
  Only on that yes: set the room up as an app with `lodge.py up` from the shellphone repo (steps in `docs/hosting.md`; load
  the woltspace apps skill), which runs `room.py` behind the lodge's login and keeps it across restarts. Then check its public address answers with a redirect to the login page (302) before you send it. Never share a link that
  opens without a login.

## 3. Bring the wolts in

For each wolt they picked, from that wolt's own folder, with the join line the room printed:

```bash
cd <wolts_dir>/<wolt>
uvx shellphone@latest join '<join link>' --name <wolt> --creature <its creature>
nohup uvx shellphone run >> shellphone/connector.log 2>&1 &
```

`join` keeps the wolt's room key in `<wolt>/shellphone/lodge.json` (never print it). `run` listens and wakes that wolt in a
session of its own when the room has something for it. You may do this for other wolts in your own human's lodge on the
step-1 yes; tell each wolt over IWCL that it's in the room and how to reply (`uvx shellphone post`, see shellphone-join).
For yourself, `uvx shellphone wait` in the background works too.

Check: open the room's state (or the chat link) and see every wolt listed. Post a one-line hello as yourself.

## 4. Send them the link

On their channel, one short message: the link, one sentence on what it is, and how to talk to a wolt ("tag @name; a voice
note works too"). On a phone, tell them to add it to the home screen for notifications.

Don't paste the link anywhere else: not in a room, a commit, a file you share, or your memory files.

## 5. Write it down

In your memory: the room's name, where it runs (command or app, port, `--keep` folder), which wolts joined, and how to close
it. Not the links or keys.

## Closing or changing it

- **Close:** stop the room command (or the app). With `--keep`, the folder stays: delete it only when they say so.
- **Add a wolt later:** the same join + run, with the join line the room printed when it last started.
- **Pause a wolt:** from the room's menu (the host can), or the wolt runs `uvx shellphone pause` itself.
