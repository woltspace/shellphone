"""One request to a room as a person or a stranger would make it, from a container that isn't the room's. Run by live.py:
the request comes on stdin (so no key is in any argument), and one line of JSON goes back."""
import base64, hashlib, http.client, json, re, sys, urllib.parse

from shellphone import cli, seal
from shellphone.away import Away


def through_relay(a):
    url, frag = a["link"].split("#", 1)
    kind, secret, _ = frag.split(".")
    u = urllib.parse.urlsplit(url)

    class Page(Away):  # what the page does in web/src/pipe.js, with the host's link or an invite's
        def _open(self):
            real = seal.Client
            seal.Client = lambda room, key, _kind: real(room, key, kind)
            try:
                super()._open()
            finally:
                seal.Client = real

    page = Page({"relay": f"{u.scheme}://{u.netloc}", "room": u.path.rsplit("/", 1)[1], "secret": secret})
    try:
        status, body = page.call(a["method"], a["path"], a.get("json"), a.get("key") or "")
    finally:
        page.close()
    return {"status": status, "json": body}


def over_http(a):
    url = a["base"]
    if "/t/" in url:  # the site's lasting link: to wherever the room's tunnel is now
        url = cli.where(url)
        if not url:
            return {"status": 0, "why": "the lasting link leads nowhere"}
    u = urllib.parse.urlsplit(url)
    secure = u.scheme == "https"
    conn = (http.client.HTTPSConnection if secure else http.client.HTTPConnection)(u.netloc, timeout=90)
    body = b"x" * a["size"] if "size" in a else json.dumps(a["json"]).encode() if "json" in a else None
    if "seed" in a:  # a file of random-looking bytes, the same for the same seed
        body, n = b"", 0
        while len(body) < a["bytes"]:
            body += hashlib.sha256(f"{a['seed']}{n}".encode()).digest() * 512
            n += 1
        body = body[:a["bytes"]]
    h = {"User-Agent": "Mozilla/5.0", "Content-Type": a.get("type", "application/json")}
    if a["method"] == "POST":
        h["Origin"] = f"{u.scheme}://{u.netloc}"
    if a.get("key"):
        h["Cookie"] = f"spo={a['key']}" if secure else f"sp{u.port}={a['key']}"
    try:
        conn.request(a["method"], a["path"], body, h)
        res = conn.getresponse()
        raw, cookie = res.read(), re.search(r"spo=([^;]+)", res.getheader("Set-Cookie") or "")
    finally:
        conn.close()
    out = {"status": res.status, "cookie": cookie and cookie.group(1), "sha": hashlib.sha256(raw).hexdigest(),
           "sent": hashlib.sha256(body).hexdigest() if body else None}
    try:
        out["json"] = json.loads(raw)
    except ValueError:
        pass
    return out


def main():
    a = json.load(sys.stdin)
    try:
        out = through_relay(a) if a.get("link") else over_http(a)
    except Exception as e:  # no answer at all: never the request itself, it holds keys
        out = {"status": 0, "why": f"{type(e).__name__}"}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
