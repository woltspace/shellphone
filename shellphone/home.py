"""Rooms at addresses of your own: one named Cloudflare tunnel for a domain of yours, and a room per name under it.

`shellphone tunnel setup --domain example.com` makes the tunnel once and points *.example.com at it. Each
`shellphone room --hostname demo` then gets demo.example.com, a port of its own that it keeps, and a line in the
list of rooms. `shellphone tunnel run` keeps the tunnel and its one door (door.py) up, and opens the listed rooms when
it starts; it doesn't reopen one that is closed later. Everything lives in ~/.shellphone (or
$SHELLPHONE_HOME): nothing here is anyone's in particular."""
import contextlib, fcntl, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

CONFIG, ROOMS, SETTINGS, DOOR = "home.json", "rooms.json", "tunnel.yml", "door.sock"
FIRST_PORT = 4400  # rooms at an address of their own get ports from here up, each one kept for good


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
    return {h: r for h, r in got.items() if isinstance(r, dict) and isinstance(r.get("port"), int) and (r.get("keep") is None or isinstance(r.get("keep"), str))} if isinstance(got, dict) else {}


def settings_text(conf):
    """The tunnel's own settings: the domain's names to the one door, which checks each request; never a port, which
    another program could take. The same whatever rooms are listed, so listing one restarts nothing."""
    return "\n".join([f"tunnel: {conf['tunnel']}", f"credentials-file: {conf['credentials']}", "ingress:",
                      '  - hostname: "*.' + conf["domain"] + '"', f"    service: {json.dumps('unix:' + str(home() / DOOR))}",
                      "  - service: http_status:404", ""])


def save_rooms(listed):
    _write(ROOMS, json.dumps(listed, indent=2))
    conf = config()
    if not conf:
        return
    text, path = settings_text(conf), home() / SETTINGS
    if not path.exists() or path.read_text() != text:
        _write(SETTINGS, text)


def one_level(host):
    """*.domain, in DNS and in the certificate, covers one name under the domain: not the domain, and not deeper."""
    domain = config()["domain"]
    if host == domain or "." in host.removesuffix("." + domain):
        sys.exit(f"{host}: rooms here get one name under {domain}, like demo.{domain} (that's what *.{domain} covers)")


HOSTNAME = re.compile(r"(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")


def full_name(name):
    """demo -> demo.<your domain>; a whole name stays as it is. Nothing but a host name: it goes into the tunnel's settings."""
    name = name.strip().lower().removeprefix("https://").rstrip("/")
    conf = config()
    if "." not in name:
        if not conf:
            sys.exit(f"--hostname {name}: a short name needs your domain first: shellphone tunnel setup --domain example.com")
        name = f"{name}.{conf['domain']}"
    if not HOSTNAME.fullmatch(name):
        sys.exit(f"--hostname wants a name like shell.example.com, not {name!r}")
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
    one_level(host)
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
            where = f"the room in {listed[host]['keep']}" if listed[host]["keep"] else f"listed for a room elsewhere (port {listed[host]['port']})"
            sys.exit(f"{host} is {where}: pick another name, or shellphone tunnel remove {host} first")
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
  Keep the tunnel up:        shellphone tunnel run

Nothing is served until a room is listed: other names under {domain} answer 404.""")


def listing(a):
    from .cli import open_rooms
    conf, listed = config(), rooms()
    if not conf:
        return print("No tunnel set up here yet: shellphone tunnel setup --domain example.com")
    open_ports = {r["port"] for r in open_rooms()}
    print(f"Tunnel {conf['name']!r} for *.{conf['domain']}" + ("" if listed else ": no rooms listed yet"))
    for host, r in sorted(listed.items()):
        state = ('open' if r['port'] in open_ports else 'closed') if r["keep"] else "elsewhere"
        print(f"  https://{host}   port {r['port']}   {state}   {r['keep'] or '(tunnel add: not opened from here)'}")


def answers_as_room(host, port):
    """Whether what's on that port is a shared room at this name: only its own door says this."""
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("GET", "/enter", headers={"Host": host})
        res = conn.getresponse()
        return res.status == 200 and f'const SIGN = "https://{host}/enter"'.encode() in res.read(200_000)
    except (OSError, http.client.HTTPException):
        return False
    finally:
        conn.close()


def add(a):
    """A name for a room this computer doesn't open itself (one in a container, publishing its port on 127.0.0.1): the
    tunnel sends the name to that port. Nothing else is listed there, and nothing here reopens it."""
    host = full_name(a.hostname)
    if not ours(host):
        sys.exit(f"{host} isn't under the domain set up here (shellphone tunnel list)")
    one_level(host)
    if not 1024 <= a.port <= 65535:
        sys.exit("--port is a port from 1024 to 65535")
    if not answers_as_room(host, a.port):  # a name makes the port public: never some other service's
        sys.exit(f"no shared room for {host} answers on port {a.port}: open it there first (--hostname {host} --share), then add it")
    with registry():
        listed = rooms()
        if host in listed and listed[host]["keep"]:
            sys.exit(f"{host} is the room in {listed[host]['keep']} on this computer: shellphone tunnel remove {host} first")
        if any(r["port"] == a.port for h, r in listed.items() if h != host):
            sys.exit(f"port {a.port} is already another listed room's (shellphone tunnel list)")
        listed[host] = {"port": a.port, "keep": None}
        save_rooms(listed)
    print(f"https://{host} now leads to http://127.0.0.1:{a.port} . It's served only while that "
          f"shared room is what answers there. Take the name off with shellphone tunnel remove {host}.")


def remove(a):
    host = full_name(a.hostname)
    with registry():
        listed = rooms()
        if host not in listed:
            sys.exit(f"{host} isn't listed here (shellphone tunnel list)")
        del listed[host]
        save_rooms(listed)
    print(f"{host} no longer leads here. The room itself is untouched: close it with "
          f"shellphone stop --port <its port>, and stop sharing it for good with shellphone share --stop.")


def _room_cmd(host, r):
    return [sys.executable, "-c", "from shellphone.cli import main; main()", "room", "--keep", r["keep"], "--hostname", host, "--port", str(r["port"]),
            "--name", os.environ.get("USER") or "you"]


def run(a):
    """Keep the tunnel and its door up; open the listed rooms that aren't open when this starts."""
    from .door import Door
    from .cli import open_rooms
    exe, conf = _cloudflared(), config()
    if not conf:
        sys.exit("No tunnel set up here yet: shellphone tunnel setup --domain example.com")
    logs = home() / "logs"
    logs.mkdir(exist_ok=True)
    stopping = []
    signal.signal(signal.SIGTERM, lambda *_: stopping.append(1))
    door = Door(home() / DOOR, rooms, answers_as_room)  # before the tunnel, and for as long as it
    with registry():
        save_rooms(rooms())  # settings from before there was a door point at ports
    open_ports = {r["port"] for r in open_rooms()}
    for host, r in rooms().items():  # every listed room comes back, at its own address
        if r["keep"] and r["port"] not in open_ports and Path(r["keep"]).is_dir():  # not the ones added for rooms elsewhere
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
            if proc and now != seen:  # set up again (another domain or tunnel): taken on a restart
                print("settings changed: restarting the tunnel", flush=True)
                _end(proc)
                proc = None
            if proc is None or proc.poll() is not None:
                if proc is not None:  # it ended by itself: wait a little longer each time before the next
                    time.sleep(wait)
                    wait = min(wait * 2, 60)
                seen = now
                conf = config() or conf  # as set up now: `tunnel setup` may have made another tunnel since this started
                with open(logs / "tunnel.log", "a") as log:
                    proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--config", str(settings), "run", conf["tunnel"]], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
                started = time.time()
            elif time.time() - started > 60:
                wait = 2
            time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        if proc:
            _end(proc)
        door.close()


def _end(proc, grace=10):
    """Stop the tunnel's program, and wait until it is gone: killed if it doesn't stop by itself in time."""
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(grace)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
