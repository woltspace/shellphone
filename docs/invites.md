# Invites for people

How a shared room lets people in, and the calls a page makes for it. The rules live in one file,
`shellphone/core.py`; the doors (`room.py`, `shellphone/link.py`, `shellphone/outside.py`) only say who is calling and
how they came in. A page decides nothing: it calls the room and shows the answer.

## What an invite is

- A link with a long random secret after `#i.`. Nothing to type.
- A record in the room's own database: who made it, who it is for (nobody named: anyone), when it ends, how many
  places are left. The room keeps a hash of the secret, never the secret: a link is shown once, when it is made.
- It belongs to what the room was shared by when it was made. Stop sharing, and it ends.
- It only opens the door. Someone who comes in gets a key of their own, which the invite's end does not take away.
- The invite a room comes with when it is first shared is a record like the others: the host's, with no end.

## Who may do what

| Call | Who | From where |
| --- | --- | --- |
| Make an invite | the host | this computer, or their own link from outside |
| End the open invites | the host | the same |
| List the open invites | the host | the same |
| Share the room, or stop | the host | this computer only |

A room behind a login of its own (see [hosting](hosting.md)) has no invites: its owner adds people.

## The calls

All are JSON. A page's POST must come from the room's own page (the browser says so by itself). Through the relay the
same paths are asked over the sealed connection.

`POST /api/invites` makes one.

```json
{"ends_in": 86400, "uses": 5, "for": "Ada"}
```

- `ends_in`: seconds from now, 60 to 30 days. Left out: one day. `null`: no end.
- `uses`: how many people it lets in, 1 to 50. Left out or `null`: as many as the room has room for.
- `for`: one named person. Then it lets in one person, under that name, whatever they type at the door.

Answer: `{"id": "...", "link": "https://...#i....", "expires": 1763500000.0, "uses_left": 5}`. `link` is said here and
nowhere else.

`GET /api/invites` lists the open ones: `{"invites": [{"id", "by", "expires", "uses_left", "created", "for"?, "first"?}]}`.
`first` marks the invite the room came with. No links, no secrets.

`POST /api/invites/end` ends every open invite (`{}`), or one (`{"id": "..."}`). Answer: `{"ended": 2}`. People who
came in stay in.

`GET /api/link` (the menu's Share row) has `invite` only while the room's first invite is open.

## Coming back

An invite ends; a guest's own key does not. After someone comes in through a tunnel, the entry page shows them their
own link once, to keep. Whoever holds that link comes in as them, so it is theirs alone. "Remember me on this device"
stays a choice.

## Limits today

- Through the relay, guests share one sealing secret: ending an invite stops new people, it does not shut out a
  guest who is already in.
- Removing one guest is not built yet.
- A personal invite says who the host meant, not who came: nothing checks the person.
