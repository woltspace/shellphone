"""Rooms at addresses of your own: one named Cloudflare tunnel for a domain of yours, and a room per name under it.

`shellphone tunnel setup --domain example.com` makes the tunnel once and points *.example.com at it. Each
`shellphone room --hostname demo` then gets demo.example.com, a port of its own that it keeps, and a line in the
tunnel's settings. `shellphone tunnel run` keeps the tunnel up, restarts it when a room is added or removed, and opens
the listed rooms when it starts (at login, with `shellphone tunnel startup`). Everything lives in ~/.shellphone (or
$SHELLPHONE_HOME): nothing here is anyone's in particular."""
import contextlib, fcntl, json, os, plistlib, re, shutil, signal, subprocess, sys, time
from pathlib import Path

CONFIG, ROOMS, SETTINGS = "home.json", "rooms.json", "tunnel.yml"
FIRST_PORT = 4400  # rooms at an address of their own get ports from here up, each one kept for good
LABEL = "dev.shellphone.tunnel"  # the login item's name on a Mac


def home():
    d = Path(os.environ.get("SHELLPHONE_HOME") or Path.home() / ".shellphone").expanduser()
    d.mkdir(parents=True, exist_ok=True)
    os.chmod(d, 0o700)
    return d


def _read(name, empty):
    try:
        return json.loads((home() / name).read_text())
    except (OSError, ValueError):
        return empty


def _write(name, text):
    from .cli import replace_private
    replace_private(home() / name, text)


def config():
    """{domain, tunnel (its id), name, credentials} once set up, or None."""
    got = _read(CONFIG, None)
    return got if isinstance(got, dict) and all(isinstance(got.get(k), str) and got[k] for k in ("domain", "tunnel", "credentials")) else None


def rooms():
    got = _read(ROOMS, {})
    return {h: r for h, r in got.items() if isinstance(r, dict) and isinstance(r.get("port"), int) and isinstance(r.get("keep"), str)} if isinstance(got, dict) else {}


def settings_text(conf, listed):
    """The tunnel's own settings: each listed name to its room's port, nothing else anywhere."""
    lines = [f"tunnel: {conf['tunnel']}", f"credentials-file: {conf['credentials']}", "ingress:"]
    for host, r in sorted(listed.items()):
        lines += [f"  - hostname: {host}", f"    service: http://127.0.0.1:{r['port']}"]
    return "\n".join(lines + ["  - service: http_status:404", ""])


def save_rooms(listed):
    _write(ROOMS, json.dumps(listed, indent=2))
    conf = config()
    if conf:
        _write(SETTINGS, settings_text(conf, listed))


def full_name(name):
    """demo -> demo.<your domain>; a whole name stays as it is."""
    name = name.strip().lower().removeprefix("https://").rstrip("/")
    conf = config()
    if "." not in name:
        if not conf:
            sys.exit(f"--hostname {name}: a short name needs your domain first: shellphone tunnel setup --domain example.com")
        return f"{name}.{conf['domain']}"
    return name


def ours(host):
    """Whether this name is served by the tunnel set up here (rather than one its host runs by hand)."""
    conf = config()
    return bool(conf) and (host == conf["domain"] or host.endswith("." + conf["domain"]))


@contextlib.contextmanager
def registry():
    """The list of rooms, read and written by one command at a time: two rooms opening at once never get one port,
    and neither loses the other's line."""
    with open(home() / ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def claim(host, keep, port_free, wanted=None):
    """The port the room at this name always uses: the one it had, the one asked for (wanted), or the next one nobody
    has. Listed from here on."""
    with registry():
        return _claim(host, keep, port_free, wanted)


def _claim(host, keep, port_free, wanted):
    listed = rooms()
    keep = str(Path(keep).expanduser().resolve())
    for other, r in listed.items():
        if other != host and r["keep"] == keep:
            sys.exit(f"the room in {keep} is already at {other}: one address per room (shellphone tunnel remove {other} first)")
    if host in listed:
        if listed[host]["keep"] != keep:
            sys.exit(f"{host} is the room in {listed[host]['keep']}: pick another name, or shellphone tunnel remove {host} first")
    used = {r["port"] for h, r in listed.items() if h != host}  # every other listed room's port
    if wanted is not None and wanted in used:
        sys.exit(f"port {wanted} is already another listed room's (shellphone tunnel list)")
    if host in listed:
        if wanted is not None and wanted != listed[host]["port"]:  # moving to another port: only to one nobody has, checked before anything is written
            if not port_free(wanted):
                sys.exit(f"port {wanted} is taken on this computer")
            listed[host]["port"] = wanted
            save_rooms(listed)
        return listed[host]["port"]
    if wanted is not None and not port_free(wanted):
        sys.exit(f"port {wanted} is taken on this computer")
    port = wanted if wanted is not None else next(p for p in range(FIRST_PORT, 65000) if p not in used and port_free(p))
    listed[host] = {"port": port, "keep": keep}
    save_rooms(listed)
    return port


def _cloudflared():
    exe = shutil.which("cloudflared")
    if not exe:
        sys.exit("cloudflared isn't installed: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/ (brew install cloudflared on a Mac)")
    return exe


def setup(a):
    exe = _cloudflared()
    domain = a.domain.strip().lower().removeprefix("https://").rstrip("/")
    if not re.fullmatch(r"([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
        sys.exit(f"--domain wants a name like example.com, not {a.domain!r}")
    if not (Path.home() / ".cloudflared" / "cert.pem").exists() and not os.environ.get("TUNNEL_ORIGIN_CERT"):
        sys.exit("first log this computer in to Cloudflare, once: cloudflared tunnel login (and pick your domain)")
    conf, creds = config(), home() / f"{a.name}.json"
    if not (conf and conf.get("name") == a.name and Path(conf["credentials"]).exists()):
        out = subprocess.run([exe, "tunnel", "create", "--credentials-file", str(creds), a.name], capture_output=True, text=True)
        got = re.search(r"with id ([0-9a-f-]{36})", out.stdout + out.stderr)
        if out.returncode or not got:
            sys.exit(f"cloudflared couldn't make the tunnel {a.name!r}: {(out.stderr or out.stdout).strip()[-300:]}")
        os.chmod(creds, 0o600)
        conf = {"name": a.name, "tunnel": got.group(1), "credentials": str(creds)}
    conf["domain"] = domain
    out = subprocess.run([exe, "tunnel", "route", "dns", conf["tunnel"], f"*.{domain}"], capture_output=True, text=True)
    if out.returncode:
        sys.exit(f"cloudflared couldn't point *.{domain} at the tunnel: {(out.stderr or out.stdout).strip()[-300:]}")
    _write(CONFIG, json.dumps(conf, indent=2))
    save_rooms(rooms())
    print(f"""Set up: every name under {domain} now leads to this computer's tunnel {conf['name']!r}.

  A room at demo.{domain}:   shellphone room --keep ~/rooms/demo --hostname demo --share
  Keep the tunnel up:        shellphone tunnel run       (or at login: shellphone tunnel startup)

Nothing is served until a room is listed: other names under {domain} answer 404.""")


def listing(a):
    from .cli import open_rooms
    conf, listed = config(), rooms()
    if not conf:
        return print("No tunnel set up here yet: shellphone tunnel setup --domain example.com")
    open_ports = {r["port"] for r in open_rooms()}
    print(f"Tunnel {conf['name']!r} for *.{conf['domain']}" + ("" if listed else ": no rooms listed yet"))
    for host, r in sorted(listed.items()):
        print(f"  https://{host}   port {r['port']}   {'open' if r['port'] in open_ports else 'closed'}   {r['keep']}")


def remove(a):
    host = full_name(a.hostname)
    with registry():
        listed = rooms()
        if host not in listed:
            sys.exit(f"{host} isn't listed here (shellphone tunnel list)")
        del listed[host]
        save_rooms(listed)
    print(f"{host} no longer leads here (the tunnel picks that up in a moment). The room itself is untouched: close it with "
          f"shellphone stop --port <its port>, and stop sharing it for good with shellphone share --stop.")


def _room_cmd(host, r):
    return [sys.executable, "-c", "from shellphone.cli import main; main()", "room", "--keep", r["keep"], "--hostname", host, "--port", str(r["port"]),
            "--name", os.environ.get("USER") or "you"]


def run(a):
    """Keep the tunnel up; restart it when the list of rooms changes; open the listed rooms that aren't open."""
    from .cli import open_rooms
    exe, conf = _cloudflared(), config()
    if not conf:
        sys.exit("No tunnel set up here yet: shellphone tunnel setup --domain example.com")
    logs = home() / "logs"
    logs.mkdir(exist_ok=True)
    stopping = []
    signal.signal(signal.SIGTERM, lambda *_: stopping.append(1))
    open_ports = {r["port"] for r in open_rooms()}
    for host, r in rooms().items():  # at login: every listed room comes back, at its own address
        if r["port"] not in open_ports and Path(r["keep"]).is_dir():
            with open(logs / f"{host}.log", "a") as log:
                subprocess.Popen(_room_cmd(host, r), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            print(f"opened https://{host}", flush=True)
    proc, seen, wait = None, None, 2
    try:
        while not stopping:
            settings = home() / SETTINGS
            try:
                now = settings.stat().st_mtime_ns
            except OSError:
                save_rooms(rooms())
                continue
            if proc and now != seen:  # a room was added or removed: the tunnel takes its new settings on a restart
                print("rooms changed: restarting the tunnel", flush=True)
                _end(proc)
                proc = None
            if proc is None or proc.poll() is not None:
                if proc is not None:  # it ended by itself: wait a little longer each time before the next
                    time.sleep(wait)
                    wait = min(wait * 2, 60)
                seen = now
                log = open(logs / "tunnel.log", "a")
                proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--config", str(settings), "run", conf["tunnel"]], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
                log.close()
                started = time.time()
            elif time.time() - started > 60:
                wait = 2
            time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        if proc:
            _end(proc)


def _end(proc, grace=10):
    """Stop the tunnel's program, and wait until it is gone: killed if it doesn't stop by itself in time."""
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(grace)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def startup(a):
    """Start `shellphone tunnel run` at login: a LaunchAgent on a Mac; the lines for a systemd user service elsewhere."""
    exe = shutil.which("shellphone") or sys.argv[0]
    if sys.platform != "darwin":
        return print(f"""Not a Mac: as a systemd user service, put this in ~/.config/systemd/user/shellphone-tunnel.service

[Unit]
Description=shellphone tunnel
[Service]
ExecStart={exe} tunnel run
Restart=always
[Install]
WantedBy=default.target

then: systemctl --user enable --now shellphone-tunnel""")
    plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{LABEL}"], capture_output=True)
    if a.off:
        plist.unlink(missing_ok=True)
        return print("The tunnel no longer starts at login (and is stopped).")
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_bytes(plistlib.dumps({"Label": LABEL, "ProgramArguments": [exe, "tunnel", "run"], "RunAtLoad": True, "KeepAlive": True,
                                      "StandardOutPath": str(home() / "logs" / "run.log"), "StandardErrorPath": str(home() / "logs" / "run.log"),
                                      "EnvironmentVariables": {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}}))
    (home() / "logs").mkdir(exist_ok=True)
    out = subprocess.run(["launchctl", "bootstrap", domain, str(plist)], capture_output=True, text=True)
    if out.returncode:
        sys.exit(f"launchctl couldn't load it: {out.stderr.strip()}")
    print(f"The tunnel and the listed rooms now start at login (and are starting now). Undo with: shellphone tunnel startup --off")
