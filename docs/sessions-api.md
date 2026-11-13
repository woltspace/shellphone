# Sessions: the room side

The approved design (Nov 12) turns the room into chats you have with your wolts, like a messaging app: your wolts are
contacts, each has its own chats, a chat can hold one wolt or several, and a wolt has a contact card with its look and,
for its own human, its memory. This is what the room gives the screens.

## A session

A session is a chat that stands on its own. Underneath it is a thread whose first message carries `"session": true`: it
is not part of the lobby (the old shared chat) and only the wolts in it hear it. Its replies are ordinary thread replies
(`thread` = the first message's id), so reading, posting, voice, files, pages and the hold menu all work unchanged.

- Who's in it: the wolts picked when it started, plus anyone @tagged in it later (the same switches as threads,
  `who[session_id]`). The main wolt is **not** in a session unless it was picked or tagged.
- Its title: the name someone gave it (`"named": true`), else the first message's words, cut short (`"named": false`;
  a group can then go by its members' names, like iMessage).

### Start one

`POST /api/sessions` `{"wolts": ["becky", "astre"], "text": "first message", "title"?: "…", "cid"?: "page id"}`
→ the first message (`{"id": …, "session": true, "to": ["becky", "astre"], …}`); its `id` is the chat's id. At least one
wolt that is in the room and some words (files go from the second message on, as replies). 400 for an unknown wolt or
no words, 403 for a guest.

`POST /api/session-title` `{"id", "title"}`: who started the chat, or the host. An empty title goes back to the first words.

Bring a wolt in or take it out later: `POST /api/thread-who {"thread": id, "wolt", "state": "in" | "paused"}`, or tag it.

### Listing them

`/api/state` gains `sessions`, newest activity first:

```json
"sessions": [{"id": "…", "title": "the desk for saturday", "wolts": ["becky"], "by": "you@x.com",
              "at": 1794533410.1, "last_at": 1794533999.2, "last_text": "Done, it's live.", "last_by": "becky", "count": 12}]
```

`wolts` is who is in it now (paused ones left out). A wolt's chats = the sessions whose `wolts` include it; a group =
more than one wolt.

The lobby stays in `messages` as before; a screen that hides it just skips messages with `"session": true` and their
replies.

## A wolt's look

`/api/state` gains `looks`: `{"becky": {"creature": "raccoon", "hat": "red-beanie", "glasses": "shades", "scene": "forest"}}`.
A wolt with no look isn't listed; a missing field means the default.

`POST /api/look` `{"wolt": "becky", "look": {…}}`: the wolt's own human or the room's host. Everyone in the room sees
the look. Only the Hat Shop's values are taken (400 otherwise); an empty value clears that field:

- `creature`: raccoon, beaver, otter
- `glasses`: shades, aviators, rose, nerd
- `scene`: forest, pond, camp, autumn, winter
- `hat`: one of the 26 ids in the Hat Shop atlas (`top-hat`, `red-beanie`, `hard-hat`, …; the list is `LOOKS` in room.py)

## A wolt's card (its memory)

`GET /api/card?wolt=becky` → `{"wolt": "becky", "at": …, "identity": "…", "context": "…", "learnings": "…", "archive": "…"}`
for **becky's own human only**; anyone else gets 403, and 404 if the wolt hasn't sent a card yet. Plain text (markdown),
each part capped at 20,000 characters.

The wolt sends it: `POST /lodge/card` with the same four fields, from its own connector: `shellphone card` (or
`connector.py card --memory DIR`, default `wolt/memory`) reads `identity.md`, `context.md`, `learnings.md` and the newest
file in `archive/`. A wolt only ever sends its own card. Connector 2026.11.13.

## The terminal

Unchanged from #105: `terminals` in `/api/state` (host only, their own wolts) gives each wolt's terminal link. In the new
screens it is the `>_` at the top right of a chat. Until the lodge runs one session per chat, every chat with a wolt
opens that wolt's one terminal.
