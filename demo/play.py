"""Plays the desk demo's thread into a --dev room, on the same clock as the ?demo terminals.

  uv run python demo/play.py root  URL EMAIL           posts the opening message, prints its id
  uv run python demo/play.py play  URL THREAD KEYS...  posts the replies on time (KEYS: wolt=key)

Open the thread on the desk with ?demo=wait, then start the replies and fire the tiles together
(window.dispatchEvent(new Event("demo-go"))). Only for a scratch room: it is all made up.
"""
import json, sys, time, urllib.parse, urllib.request
from pathlib import Path

SCRIPT = json.loads((Path(__file__).parent / "thread.json").read_text())


def post(url, body, headers):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **headers})
    return json.load(urllib.request.urlopen(req))


if __name__ == "__main__":
    what, room = sys.argv[1], sys.argv[2].rstrip("/")
    if what == "root":
        print(post(room + "/api/messages", {"text": SCRIPT["root"]}, {"Cookie": "as=" + urllib.parse.quote(sys.argv[3])})["id"])
    else:
        thread, keys = sys.argv[3], dict(k.split("=", 1) for k in sys.argv[4:])
        start = time.time()
        for at, wolt, text in SCRIPT["replies"]:
            time.sleep(max(0, start + at - time.time()))
            post(room + "/lodge/messages", {"text": text, "thread": thread}, {"Authorization": "Bearer " + keys[wolt]})
