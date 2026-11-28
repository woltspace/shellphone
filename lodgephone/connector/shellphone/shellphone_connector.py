"""shellphone, as a lodge connector: your wolts in a shellphone room on your lodge, the Telegram way.

This process speaks shellphone (the room's /lodge API, one key per wolt) and nothing of the lodge but its
socket (connector_client). Each wolt is its own chat: the lodge sees one route per wolt ({"chat_id": WOLT}),
keeps that chat's active wolt and session, and answers on the same route. Notifications from wolts (notify)
come back as `send` frames; the footer names the session, so they land in that wolt's chat.

Only the owner's messages reach the lodge: the room tells each message's person (behind Cloudflare Access,
from the signed login), and this process hands in only those from an owner the lodge configured.

Environment (set by the lodge when it starts this program):
  SHELLPHONE_ROOM_URL           the room, on this computer (http://127.0.0.1:PORT)
  WOLTSPACE_CONNECTOR_SOCKET, WOLTSPACE_CONNECTOR_TOKEN, WOLTSPACE_CONNECTOR_OWNERS
  WOLTSPACE_CONNECTOR_DATA      keys.json (wolt -> room key, mode 600, written by setup) and state.json
"""

import asyncio
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import connector_client
import connector_protocol as wire

logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger("shellphone_connector")

NAME = "shellphone"
DATA_DIR = Path(os.environ.get("WOLTSPACE_CONNECTOR_DATA")
                or Path(os.environ.get("WOLTSPACE_WOLTS_DIR", "/workspace/wolts")) / ".space" / NAME)
POLL_SECONDS = 1.5
FOOTER = "\n↩️ reply to this message to talk to this session directly"  # the lodge's DEN_REPLY_FOOTER
SESSION = re.compile(r"session=([A-Za-z0-9_.-]{1,128})")
TAIL = re.compile(r"-[a-z]+-[a-z]+-[0-9a-f]{4,}$")  # {wolt}-{word}-{word}-{hex}
# The lodge's Telegram-era lines: the room shows who and offers the terminal in a message's long-press menu instead.
PICKED = re.compile(r"active wolt set to \S+\. next message starts a session\.")
NEW_SESSION = re.compile(r"\S+ (?:new session for|sent to) (\S+)\n(\S+)")

CLIENT = None
ROOM = os.environ.get("SHELLPHONE_ROOM_URL", "").rstrip("/")
LODGE_API = os.environ.get("WOLTSPACE_API", "http://127.0.0.1:7777").rstrip("/")
KEYS: dict[str, str] = {}
KEYS_STAMP = 0  # keys.json's mtime when it was last read
# Each message this connector posted, and whose: a chat (thread) hangs off one, and is that wolt's alone.
ROOTS: dict[str, str] = {}
# Per wolt: after (last room message number seen), chosen (the lodge's wolt command sent once for its chat),
# thread (where its last owner message was: replies go there), choices (the last numbered picker shown).
STATE: dict[str, dict] = {}


def owners() -> set[str]:
    return {o.strip().lower() for o in os.environ.get("WOLTSPACE_CONNECTOR_OWNERS", "").split(",") if o.strip()}


def load() -> None:
    KEYS.clear()
    keys = DATA_DIR / "keys.json"
    if not keys.exists():
        raise SystemExit(f"no wolts in the room yet: {keys} is missing (the setup writes it, one key per wolt)")
    KEYS.update(json.loads(keys.read_text()))
    state = DATA_DIR / "state.json"
    if state.exists():
        saved = json.loads(state.read_text())
        ROOTS.update(saved.pop("*roots", {}))
        STATE.update(saved)


def save() -> None:
    tmp = DATA_DIR / "state.json.tmp"
    tmp.write_text(json.dumps({**{w: {k: v for k, v in s.items() if k != "choices"} for w, s in STATE.items()},
                               "*roots": dict(list(ROOTS.items())[-2000:])}))
    tmp.replace(DATA_DIR / "state.json")


def room(wolt: str, method: str, path: str, body: dict | bytes | None = None) -> dict:
    """One call to the room as `wolt`. The key goes only to the room on this computer. bytes: a file, as is."""
    raw = isinstance(body, bytes)
    req = urllib.request.Request(ROOM + path, method=method,
                                 data=body if raw else json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {KEYS[wolt]}",
                                          "Content-Type": "application/octet-stream" if raw else "application/json"})
    with urllib.request.urlopen(req, timeout=20) as reply:
        return json.loads(reply.read() or b"{}")


async def call(wolt, method, path, body=None) -> dict:
    return await asyncio.to_thread(room, wolt, method, path, body)


# --- from the room ------------------------------------------------------------------------

def wolt_of(session: str) -> str:
    return TAIL.sub("", session)


async def hand_in(wolt: str, m: dict) -> None:
    """One owner message in this wolt's chat, to the lodge."""
    s = STATE.setdefault(wolt, {})
    route = {"chat_id": wolt}
    sender = str(m.get("email") or m.get("person") or "").lower()
    s["thread"] = m.get("thread") or m["id"]  # a main-chat message starts its own chat in the room
    if not s.get("chosen"):  # this chat talks to this wolt: told to the lodge once
        await CLIENT.event("command", route, sender, {"name": "wolt", "args": [wolt]}, f"{NAME}:{wolt}:pick")
        s["chosen"] = True
    text = str(m.get("text") or "").strip()
    picked = s.get("choices") or []
    if text.isdigit() and 1 <= int(text) <= len(picked):  # an answer to the last numbered picker
        await CLIENT.event("selection", route, sender, {"action": picked[int(text) - 1]}, f"{NAME}:{wolt}:{m['id']}")
        return
    if text.split()[:1] == ["/talk"]:  # this chat talks to one session of its wolt (Telegram: reply to its message)
        await talk(wolt, text.split()[1:2])
        return
    if text.startswith("/") and len(text) > 1:  # /sessions, /new, /wolt NAME ... as on Telegram
        name, *args = text[1:].split()
        await CLIENT.event("command", route, sender, {"name": name.lower()[:32], "args": args[:wire.MAX_ARGS]},
                           f"{NAME}:{wolt}:{m['id']}")
        return
    if text:
        body = {"text": text[:wire.MAX_TEXT]}
        if s.get("talk"):  # the lodge sends a reply to a session's message to that session
            body["reply_to"] = {"from_bot": True, "text": "\n\n---" + FOOTER + "\nsession=" + s["talk"]}
        await CLIENT.event("message", route, sender, body, f"{NAME}:{wolt}:{m['id']}")


def tunnel() -> str:
    """The lodge's public address (its terminals live under it), or "" when it has none."""
    try:
        with urllib.request.urlopen(LODGE_API + "/tunnel", timeout=5) as r:
            url = str(json.loads(r.read() or b"{}").get("url") or "").rstrip("/")
        return url if url.startswith("https://") else ""
    except (urllib.error.URLError, OSError, ValueError):
        return ""


async def talk(wolt: str, args: list[str]) -> None:
    """/talk SESSION: this chat's messages go to that session of its wolt (one also on Telegram, say). /talk: back to
    the lodge's choice."""
    s = STATE.setdefault(wolt, {})
    name = args[0] if args else ""
    if not name:
        s.pop("talk", None)
        save()
        await post(wolt, "This chat talks to whichever session the lodge picks again.", meta={"via": "lodge phone"})
        return
    if not SESSION.fullmatch("session=" + name) or wolt_of(name) != wolt or name == wolt:
        await post(wolt, f"{name[:80]} isn't one of {wolt}'s sessions.", meta={"via": "lodge phone"})
        return
    s["talk"], s["session"] = name, name
    base = await asyncio.to_thread(tunnel)
    s["terminal"] = f"{base}/tui?session={urllib.parse.quote(name)}" if base else ""
    save()
    await post(wolt, f"This chat now talks to {name}.", meta={"via": "lodge phone", "session": name})


async def poll(wolt: str) -> None:
    s = STATE.setdefault(wolt, {})
    got = await call(wolt, "GET", f"/lodge/messages?after={int(s.get('after', 0))}")
    new = got.get("messages") or []
    if "after" not in s:  # first run: what was said before isn't handed in
        s["after"] = max([m.get("n", 0) for m in new] or [0])
        save()
        return
    allowed = owners()
    for m in new:
        s["after"] = max(s["after"], m.get("n", 0))
        if m.get("kind") != "human":
            continue  # unheard, other wolts, activity, reactions: not for the lodge
        if ROOTS.get(m.get("thread") or "", wolt) != wolt:
            continue  # another wolt's chat: one chat, one wolt (the room's main wolt hears every chat)
        who = str(m.get("email") or "").lower()
        if not allowed or who not in allowed:
            logger.info("Ignoring a room message: not an owner")
            continue
        await hand_in(wolt, m)
    save()


def reload_keys() -> None:
    """A wolt added by setup later is picked up here, with no restart of the lodge."""
    global KEYS_STAMP
    keys = DATA_DIR / "keys.json"
    try:
        stamp = keys.stat().st_mtime_ns
        if stamp != KEYS_STAMP:
            fresh = json.loads(keys.read_text())
            KEYS.clear()
            KEYS.update(fresh)
            KEYS_STAMP = stamp
    except (OSError, ValueError) as exc:
        logger.warning("keys.json unreadable, keeping the wolts I have: %s", exc)


async def watch() -> None:
    while True:
        reload_keys()
        for wolt in list(KEYS):
            try:
                await poll(wolt)
            except (urllib.error.URLError, OSError, TimeoutError, ValueError) as exc:
                logger.warning("room unreachable for %s: %s", wolt, exc)
        await asyncio.sleep(POLL_SECONDS)


# --- from the lodge -----------------------------------------------------------------------

def render(reply) -> tuple[str, list[str]]:
    """Text, with choices as a numbered list (links shown as links); the actions, in the same order."""
    lines, actions = [reply.text] if reply.text else [], []
    for row in reply.choices or ():
        for c in row:
            if c.url:
                lines.append(f"{c.label}: {c.url}")
            elif c.action:
                actions.append(c.action)
                lines.append(f"{len(actions)}. {c.label}")
    if actions:
        lines.append("(answer with a number)")
    return "\n".join(lines), actions


async def post(wolt: str, text: str, voice: bool = False, meta: dict | None = None, terminal: str = "") -> dict:
    """Into the wolt's chat. The terminal link and the meta ride along (long-press: Open terminal, Info), not in the text."""
    s = STATE.setdefault(wolt, {})
    terminal = terminal or s.get("terminal", "")
    body = {"text": text[:8000], "voice": voice, **({"thread": s["thread"]} if s.get("thread") else {}),
            **({"terminal": terminal} if terminal.startswith("https://") else {}),
            "meta": {k: str(v)[:300] for k, v in {**({"session": s["session"]} if s.get("session") else {}), **(meta or {})}.items() if v}}
    sent = await call(wolt, "POST", "/lodge/messages", body)
    if sent.get("id") and not s.get("thread"):  # a message in the main chat: a reply to it starts this wolt's chat
        ROOTS[str(sent["id"])] = wolt
        save()
    return sent


def quiet(wolt: str, text: str) -> str:
    """The lodge's own status lines: a session opened is remembered (for Open terminal), not shown."""
    s = STATE.setdefault(wolt, {})
    found = NEW_SESSION.fullmatch(text.strip())
    if found:
        s["terminal"] = found.group(2) if found.group(2).startswith("https://") else ""
        got = SESSION.search(found.group(2))
        s["session"] = got.group(1) if got else ""
        return ""
    return "" if PICKED.fullmatch(text.strip()) else text


async def on_say(frame: dict) -> None:
    wolt = frame["route"]["chat_id"]
    if wolt not in KEYS:
        logger.warning("say for a chat with no wolt key: dropped")
        return
    text, actions = render(wire.reply_from_wire(frame["reply"]))
    STATE.setdefault(wolt, {})["choices"] = actions
    text = quiet(wolt, text) if not actions else text
    if text:
        await post(wolt, text, meta={"via": "lodge reply"})


def wolt_of_event(event_id: str) -> str:
    """Our event ids are shellphone:WOLT:...: an edit or ack names only the event it answers."""
    parts = (event_id or "").split(":", 2)
    wolt = parts[1] if len(parts) == 3 and parts[0] == NAME else ""
    return wolt if wolt in KEYS else ""


async def on_edit(frame: dict) -> None:
    """The answer to a pick (open a session, stop one...). The room can't edit a message: it's posted as a new one."""
    wolt = wolt_of_event(frame.get("event", ""))
    if not wolt:
        return
    text, actions = render(wire.reply_from_wire(frame["reply"]))
    STATE.setdefault(wolt, {})["choices"] = actions
    if text:
        await post(wolt, text, meta={"via": "lodge (a pick's answer)"})


async def on_ack(frame: dict) -> None:
    """A pick's short answer (a toast elsewhere): a line in the chat, when it has words."""
    wolt = wolt_of_event(frame.get("event", ""))
    text = (wire.ack_from_wire(frame["ack"]).text or "").strip()
    if wolt and text:
        await post(wolt, text, meta={"via": "lodge (a pick's answer)"})


def split_footer(text: str) -> tuple[str, str, str]:
    """The message, the session it is from, and the terminal link (if the footer has one)."""
    body, _, footer = text.partition("\n\n---" + FOOTER)
    found = SESSION.search(footer)
    link = footer.strip() if footer.strip().startswith("http") else ""
    return body, found.group(1) if found else "", link


PAGE_MAX = 300_000  # the room's limit for a page's HTML
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def site_pages(wolt: str, text: str) -> list[str]:
    """The pages of this wolt's own site linked in its words (/wolt/WOLT/site/....html, on the lodge): the phone shows them
    as pages. Only its own site: what the owner could already open, and nothing anyone else's words can point it at."""
    found = re.findall(rf"https?://[^\s/]+(/wolt/{re.escape(wolt)}/site/[A-Za-z0-9._~/-]+\.html?)(?=[\s)\]>.,;!?]|$)", text)
    return [p for p in dict.fromkeys(found) if ".." not in p][:3]


def fetch_site(path: str) -> bytes | None:
    try:
        with urllib.request.urlopen(LODGE_API + path, timeout=10) as r:
            return r.read(5_000_001) if r.status == 200 else None
    except (urllib.error.URLError, OSError, ValueError):
        return None


async def deliver_page(wolt: str, name: str, data: bytes, text: str) -> dict:
    """HTML as a page (a card that opens full screen in the phone, sandboxed), or as a file when it's too big for one."""
    where = {"thread": STATE.get(wolt, {}).get("thread")} if STATE.get(wolt, {}).get("thread") else {}
    if len(data) <= PAGE_MAX:
        html = data.decode("utf-8", "replace")
        found = TITLE.search(html)
        title = re.sub(r"\s+", " ", found.group(1)).strip()[:80] if found else name.rsplit(".", 1)[0]
        return await call(wolt, "POST", "/lodge/page", {"html": html, "title": title or name, "text": text, **where})
    query = urllib.parse.urlencode({"name": name, "text": text, **where})
    return await call(wolt, "POST", f"/lodge/files?{query}", data)


async def deliver_file(wolt: str, text: str, frame: dict) -> dict:
    """notify --file: an HTML file becomes a page (a card in the chat that opens full screen in the phone, sandboxed);
    anything else, or a page too big for one, goes up as a file the phone shows inline (pictures, PDFs) or to save."""
    data = await asyncio.to_thread(Path(frame["path"]).read_bytes)
    name = Path(str(frame.get("filename") or "file")).name[:120] or "file"
    where = {"thread": STATE.get(wolt, {}).get("thread")} if STATE.get(wolt, {}).get("thread") else {}
    if name.lower().endswith((".html", ".htm")):
        return await deliver_page(wolt, name, data, text)
    query = urllib.parse.urlencode({"name": name, "text": text, **where})
    return await call(wolt, "POST", f"/lodge/files?{query}", data)


async def on_send(frame: dict) -> dict:
    """A notification from a wolt, posted by that wolt into its own chat."""
    body, session, link = split_footer(frame.get("text", ""))
    # The route is the lodge's word (notify --to shellphone:WOLT): it wins. The footer is only text, so it counts
    # only for a notification sent to no wolt's chat.
    route = str((frame.get("route") or {}).get("chat_id") or "")
    wolt = route if route in KEYS else (wolt_of(session) if session else "")
    if wolt not in KEYS:
        return {"status": "refused", "error": f"no chat for {wolt or 'this notification'} in the room"}
    text = re.sub(rf"^\S+ {re.escape(wolt)}: ", "", body.strip(), count=1)  # the lodge's "🦝 softie: ": the room shows who
    if session and wolt_of(session) == wolt:  # this session is the one talking in this chat now
        STATE.setdefault(wolt, {}).update(session=session, terminal=link if link.startswith("https://") else "")
    try:
        if frame["method"] == "document":
            sent = await deliver_file(wolt, text, frame)
            return {"status": "delivered", "message_id": str(sent.get("id") or "")}
        # A voice note: the room reads the words aloud itself, in the wolt's own room voice.
        sent = await post(wolt, text, voice=frame["method"] == "voice",
                          meta={"via": f"notify ({frame['method']})", **({"session": session} if session else {})},
                          terminal=link if session and wolt_of(session) == wolt else "")
        for path in site_pages(wolt, text):  # its own pages, linked: shown right in the phone
            data = await asyncio.to_thread(fetch_site, path)
            if data:
                await deliver_page(wolt, path.rsplit("/", 1)[-1], data, "")
    except TimeoutError as exc:
        return {"status": "ambiguous", "error": str(exc) or "timed out"}
    except urllib.error.HTTPError as exc:
        return {"status": "refused", "error": f"room answered {exc.code}"}
    except (urllib.error.URLError, OSError) as exc:
        return {"status": "failed", "error": str(exc) or type(exc).__name__}
    return {"status": "delivered", "message_id": str(sent.get("id") or "")}


# --- run ----------------------------------------------------------------------------------

async def _connect(client) -> dict:
    delay = 0.5
    while True:
        try:
            return await client.connect()
        except OSError as exc:
            logger.warning(f"lodge not reachable ({exc}); retrying in {delay:.1f}s")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)


async def main() -> None:
    global CLIENT
    if not ROOM.startswith(("http://127.0.0.1:", "http://localhost:")):
        raise SystemExit("SHELLPHONE_ROOM_URL must be the room on this computer (http://127.0.0.1:PORT)")
    load()
    if not owners():
        logger.warning("no owners configured: every room message will be ignored")
    CLIENT = connector_client.Client(NAME, on_say=on_say, on_edit=on_edit, on_ack=on_ack, on_send=on_send)
    await _connect(CLIENT)
    watcher = asyncio.create_task(watch())
    logger.info("shellphone connector: %d wolts, room %s", len(KEYS), ROOM)
    try:
        await CLIENT.run_forever()
    finally:
        watcher.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except connector_client.Refused as exc:
        logger.warning(f"the lodge closed this connector: {exc}")
