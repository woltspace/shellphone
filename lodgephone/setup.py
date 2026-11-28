#!/usr/bin/env python3
"""Lodge Phone: shellphone as your own phone for your own wolts, on your lodge. One chat per wolt, the Telegram way.

    python3 lodgephone/setup.py up --owner you@example.com --team TEAM.cloudflareaccess.com --aud AUD [--url https://lodgephone.you.example]
    python3 lodgephone/setup.py up ...   # again, after you add a wolt: only what's missing is done

`up`, in order (each step skipped when it's already done):
  1. The phone: a lodge app `lodgephone` (this repo, cloned into <wolts_dir>/apps/lodgephone), in lodge mode:
     it opens only behind Cloudflare Access (team + AUD), for your email only.
  2. You, and each of your wolts, in the phone. Each wolt's key goes to <wolts_dir>/.space/shellphone/keys.json (600).
  3. The connector: <wolts_dir>/.space/connectors/shellphone, switched on in the lodge's config for your email.
  4. The app is started. The lodge starts the connector when it starts: after the first `up`, restart the lodge once.

The team and AUD: Cloudflare Zero Trust > Access > Applications, the app that covers this address (its AUD tag),
and your team domain (TEAM.cloudflareaccess.com). Without them the phone doesn't open.
"""
import argparse, json, os, re, shutil, socket, subprocess, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
LODGE = os.environ.get("WOLTSPACE_ENDPOINT", "http://127.0.0.1:7777")
APP = "lodgephone"  # the lodge app (its address: lodgephone.<your apps domain>)
CONNECTOR = "shellphone"  # the lodge connector
CREATURES = {"raccoon", "beaver", "otter", "rodent", "wolf", "dog"}


def say(msg):
    print(msg, flush=True)


def die(msg):
    sys.exit(f"lodgephone: {msg}")


def wolts_dir() -> Path:
    out = subprocess.run(["woltspace", "paths"], capture_output=True, text=True)
    found = re.search(r"^wolts_dir: (.+)$", out.stdout, re.M)
    if not found:
        die("couldn't find the lodge (`woltspace paths` failed). Is woltspace installed?")
    return Path(found.group(1).strip())


def lodge(method, path, body=None):
    req = urllib.request.Request(LODGE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.loads(reply.read() or b"null")


def free(port: int) -> bool:
    """Nothing on this computer listens there (another lodge's app, a room): the lodge's own list isn't enough."""
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def write_private(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.chmod(path, 0o600)


def up(a):
    if not re.fullmatch(r"[^@\s]+@[^@\s]+", a.owner):
        die("--owner is your email, the one your Cloudflare login uses")
    if not re.fullmatch(r"[a-z0-9-]+\.cloudflareaccess\.com", a.team):
        die("--team is your team domain: NAME.cloudflareaccess.com")
    if not re.fullmatch(r"[0-9a-f]{64}", a.aud):
        die("--aud is the Access app's AUD tag (64 hex characters)")
    wd = wolts_dir()
    app_dir = wd / "apps" / APP
    owner = a.owner.lower()

    # 1. the phone
    apps = lodge("GET", "/apps") or []
    if not app_dir.exists():
        say(f"1. The phone: {app_dir}")
        subprocess.run(["git", "clone", "-q", str(REPO), str(app_dir)], check=True)
        taken = {x.get("port") for x in apps}
        port = next(p for p in range(4090, 4190) if p not in taken and free(p))
        (app_dir / "woltspace.json").write_text(json.dumps({
            "name": APP, "description": "Lodge Phone: your wolts, one chat each", "stack": "python", "port": port,
            "start": "set -a; . ./.access.env; set +a; SHELLPHONE_LODGE=1 uv run --with pywebpush python room.py serve --port $PORT",
            "keeper": os.environ.get("WOLTSPACE_WOLT_NAME", ""), "public": True}, indent=2) + "\n")
        with open(app_dir / ".git" / "info" / "exclude", "a") as f:
            f.write(".access.env\nwoltspace.json\ndata/\n")
    elif "SHELLPHONE_LODGE=1" not in (app_dir / "woltspace.json").read_text():
        die(f"{app_dir} is another app, not a Lodge Phone: nothing changed. Move it away or pick another lodge.")
    else:
        say(f"1. The phone is already at {app_dir}: keeping it")
    port = json.loads((app_dir / "woltspace.json").read_text())["port"]
    env = f"SHELLPHONE_ACCESS_TEAM={a.team}\nSHELLPHONE_ACCESS_AUD={a.aud}\n" + (f"SHELLPHONE_URL={a.url}\n" if a.url else "")
    write_private(app_dir / ".access.env", env)

    # 2. you and your wolts
    room = lambda *args: subprocess.run([sys.executable, "room.py", *args], cwd=app_dir, capture_output=True, text=True)
    got = room("add-person", owner, a.name or owner.split("@")[0])
    if got.returncode:
        die(f"couldn't add you to the phone: {got.stderr.strip()[-300:]}")
    keys_file = wd / ".space" / CONNECTOR / "keys.json"
    keys = json.loads(keys_file.read_text()) if keys_file.exists() else {}
    wolts = [w for w in lodge("GET", "/wolts") or [] if (w.get("dir") or w.get("name"))]
    say(f"2. You ({owner}) and {len(wolts)} wolts")
    for w in wolts:
        name = w.get("dir") or w.get("name")
        if name in keys:
            continue
        creature = w.get("base_type") or w.get("type") or "raccoon"
        got = room("add-lodge", name, owner, "--creature", creature if creature in CREATURES else "raccoon",
                   "--url", f"http://127.0.0.1:{port}")
        if got.returncode:
            die(f"couldn't add {name}: {got.stderr.strip()[-300:]}")
        keys[name] = json.loads(got.stdout)["key"]
        say(f"   + {name}")
    write_private(keys_file, json.dumps(keys))

    # 3. the connector
    dest = wd / ".space" / "connectors" / CONNECTOR
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(HERE / "connector" / CONNECTOR, dest, ignore=shutil.ignore_patterns("__pycache__"))
    config_file = wd / ".space" / "platform" / "config.json"
    config = json.loads(config_file.read_text()) if config_file.exists() else {}
    config.setdefault("channels", {})[CONNECTOR] = {"enabled": True, "owners": [owner], "room_url": f"http://127.0.0.1:{port}"}
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(json.dumps(config, indent=2) + "\n")
    say(f"3. Connector in {dest}, on for {owner}")

    # 4. start it
    mine = next((x for x in lodge("GET", "/apps") or [] if x.get("name") == APP), None)
    if not mine or not mine.get("pid"):
        lodge("POST", f"/apps/{APP}/start")
    lodge("POST", f"/apps/{APP}/share")  # reachable at its address, behind the lodge's Cloudflare login
    say("4. The phone is started." + (f" Open {a.url} on your phone and add it to your home screen." if a.url else ""))
    say("   The lodge starts the connector when it starts: restart the lodge once (woltspace restart), the owner's call.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("up")
    s.add_argument("--owner", required=True, help="your email (your Cloudflare login)")
    s.add_argument("--name", help="your name in the phone")
    s.add_argument("--team", required=True, help="TEAM.cloudflareaccess.com")
    s.add_argument("--aud", required=True, help="the Access app's AUD tag")
    s.add_argument("--url", help="the phone's address, e.g. https://lodgephone.you.example")
    a = ap.parse_args()
    up(a)


if __name__ == "__main__":
    main()
