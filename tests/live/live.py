"""Does shellphone work? Every way into a room, times invites, files and agents: real rooms in throwaway containers.

    uv run python tests/live/live.py                      # this commit, every path that needs no account
    uv run python tests/live/live.py --ref BRANCH_OR_SHA  # some other commit
    uv run python tests/live/live.py --paths local,own-domain,own-relay    # nothing public
    uv run python tests/live/live.py --relay https://relay.example.com     # a relay you deployed, as the site
    uv run python tests/live/live.py --domain check.example.com            # also through your own named tunnel
    uv run python tests/live/live.py --phone              # leave the rooms up for a phone; --clean removes them

Needs Docker, and internet to build (and for the paths through the site). docs/testing.md says what each path and each
check means, and what only a person with a phone can check. Keys go to the containers on stdin, and none is printed."""
import argparse, json, os, re, socket, subprocess, sys, tempfile, time, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SITE, NAME, PORT = "https://shellphone.woltspace.app", "room.example.test", 4620
LABEL = "shellphone.live-test"
PATHS = ("local", "own-domain", "own-relay", "site-relay", "site-tunnel")
DOCKERFILE = f"""FROM cloudflare/cloudflared:2026.10.0 AS tunnel
FROM python:3.12-slim
COPY --from=tunnel /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY src /src
COPY client.py front.py /live/
RUN pip install -q --root-user-action=ignore /src && useradd -m t && mkdir /cert \\
 && openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN={NAME} -addext subjectAltName=DNS:{NAME} \\
    -keyout /cert/room.key -out /cert/room.crt 2>/dev/null \\
 && chown -R t /cert && cp /cert/room.crt /usr/local/share/ca-certificates/room.crt && update-ca-certificates >/dev/null
USER t
WORKDIR /tmp
CMD ["sleep", "7200"]
"""
RELAY_DOCKERFILE = """FROM node:22
COPY src /src
WORKDIR /src/relay
RUN sh build.sh && npm install -g --silent wrangler@4
CMD ["wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787", "--var", "OPEN_HOSTING:1"]
"""


def docker(*args, input=None, timeout=300):
    try:
        return subprocess.run(["docker", *args], input=input, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "timed out")


def clean(run=None):
    which = f"label={LABEL}={run}" if run else f"label={LABEL}"
    for kind, listed, removed in (("containers", ["ps", "-aq"], ["rm", "-f"]), ("networks", ["network", "ls", "-q"], ["network", "rm"])):
        ids = docker(*listed, "--filter", which).stdout.split()
        if ids:
            docker(*removed, *ids)
    if not run:
        for tag in docker("image", "ls", "--filter", which, "--format", "{{.Repository}}:{{.Tag}}").stdout.split():
            docker("rmi", "-f", tag)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def mask(text):
    return re.sub(r"#\S+|\?k=\S+|Bearer \S+", "#<key>", text)


class Way:
    """One way into a room, and the checks that go through it."""

    def __init__(self, name, live):
        self.name, self.live, self.port = name, live, PORT
        self.room, self.agent = f"{live.run}-{name}-room", f"{live.run}-{name}-agent"
        self.results, self.relay = [], name.endswith("-relay")

    def ok(self, area, what, passed, why=""):
        self.results.append((area, what, bool(passed)))
        print(f"  {'ok  ' if passed else 'FAIL'} {area:8} {what}" + (f"  ({mask(str(why))[:200]})" if why and not passed else ""), flush=True)
        return passed

    # -- starting and stopping

    def command(self):
        site = ["--relay", self.live.own_relay if self.name == "own-relay" else self.live.site]
        return ["shellphone", "room", "--keep", "/tmp/room", "--port", str(self.port), "--name", "Host", *{
            "local": [],
            "own-domain": ["--share", "--hostname", NAME],
            "domain": ["--share", "--hostname", self.live.domain or ""],
            "own-relay": ["--share", "--via", "relay", *site],
            "site-relay": ["--share", "--via", "relay", *site],
            "site-tunnel": ["--share", "--via", "tunnel", *site],
        }[self.name]]

    def containers(self):
        common = ["-d", "--memory", "768m", "--label", f"{LABEL}={self.live.run}"]
        room = ["--network", self.live.net]
        if self.name == "own-domain":
            room += ["--network-alias", NAME, "--sysctl", "net.ipv4.ip_unprivileged_port_start=0"]
        if self.name == "domain":
            self.port = free_port()
            room += ["-p", f"127.0.0.1:{self.port}:{self.port}", "-e", "SHELLPHONE_BIND=0.0.0.0"]
        a = docker("run", *common, "--name", self.room, *room, self.live.image)
        net = f"container:{self.room}" if self.name == "local" else self.live.net  # local: "this computer" is the room's
        b = docker("run", *common, "--name", self.agent, "--network", net, self.live.image)
        return self.ok("setup", "two containers: the room's and somebody else's", a.returncode == 0 and b.returncode == 0, (a.stderr + b.stderr).strip())

    def open_room(self):
        docker("exec", "-d", self.room, "sh", "-c", 'exec "$@" > /tmp/room.log 2>&1', "sh", *self.command())
        wanted = r"Open the chat:\s+(\S+)" if self.name == "local" else r"Open it from anywhere:\s+(\S+)"
        for _ in range(90):
            log = docker("exec", self.room, "cat", "/tmp/room.log").stdout
            found = re.search(wanted, log)
            if found:
                self.link = found.group(1)
                invite = re.search(r"Invite people:\s+(\S+)", log)
                self.invite = invite.group(1) if invite else None
                if self.name == "local":
                    self.base, self.key = self.link.split("/?k=")
                elif self.relay:
                    self.base, self.key = self.link.split("#")[0], self.link.rsplit(".", 1)[1]
                else:
                    self.base, self.key = self.link.split("#")[0], self.link.split("#k.")[1]
                return True
            time.sleep(1)
        self.why = log[-300:]
        return False

    def tunnel(self, *args):
        return subprocess.run([sys.executable, "-c", "from shellphone.cli import main; main()", "tunnel", *args],
                              cwd=REPO, capture_output=True, text=True, timeout=120, env={**os.environ, "PYTHONPATH": str(REPO)})

    def reachable(self):
        for _ in range(30):
            if self.state()["status"] == 200:
                return True
            time.sleep(2)
        return False

    # -- asking, as people do

    def ask(self, method, path, key=None, link=None, **more):
        a = {"method": method, "path": path, "key": key, **more}
        if self.relay:
            a["link"] = link or self.link
        else:
            a["base"] = self.base
        got = docker("exec", "-i", self.agent, "python", "/live/client.py", input=json.dumps(a), timeout=150)
        try:
            return json.loads(got.stdout)
        except ValueError:
            return {"status": 0, "why": "no answer from the test client"}

    def state(self, key=None, link=None):
        return self.ask("GET", "/api/state?after=0", key=self.key if key is None else key, link=link)

    def agent_cli(self, *args, input=None):
        return docker("exec", "-i", self.agent, "shellphone", *args, "--config", "/tmp/agent/lodge.json", input=input, timeout=120)

    def same_file_back(self, url, sha):
        return self.ask("GET", "/" + url, key=self.key).get("sha") == sha

    # -- the checks

    def run(self):
        print(f"\n## {self.name}", flush=True)
        if not self.containers():
            return
        if not self.ok("setup", "the room opens", self.open_room(), getattr(self, "why", "")):
            return
        if self.name == "own-domain":
            docker("exec", "-d", self.room, "python", "/live/front.py", NAME, str(self.port))
        if self.name == "domain":
            added = self.tunnel("add", self.live.domain, "--port", str(self.port))
            if not self.ok("setup", "the name is on your tunnel", added.returncode == 0, added.stderr.strip()):
                return
        if self.name == "site-tunnel":
            time.sleep(10)  # a new tunnel's name takes a moment: asked too early, "no such name" is remembered
        if not self.ok("host", "the host's link opens the room", self.reachable()):
            return
        self.host()
        self.people()
        self.files()
        self.agents()
        self.restart()
        if not self.live.phone:
            self.end()

    def host(self):
        if not self.relay and self.name != "local":
            self.ok("host", "the key signs the host in", self.ask("POST", "/api/enter", json={"k": self.key})["status"] == 200)
        if not self.relay:
            self.ok("host", "the app loads", self.ask("GET", "/", key=self.key)["status"] == 200)
        self.ok("host", "the host can chat", self.ask("POST", "/api/messages", key=self.key, json={"text": "hello from the host"})["status"] == 200)
        self.ok("keys", "a wrong key reads nothing", self.state(key="not-a-key")["status"] in (401, 403))
        if not self.relay:
            self.ok("keys", "no key reads nothing", self.state(key="")["status"] in (401, 403))
            if self.name != "local":
                self.ok("keys", "no key can send more than 4 KB", self.ask("POST", "/api/enter", size=5000)["status"] == 413)

    def people(self):
        self.guest = None
        if self.name == "local":
            return  # a room on this computer only has no invites for people
        if not self.ok("invites", "an invite is made", self.invite):
            return
        who = "A guest with a name of forty letters, ok"
        if self.relay:
            code = self.invite.rsplit(".", 1)[1]
            got = self.ask("POST", "/api/guest", key=code, link=self.invite, json={"name": who})
            self.guest, link = (got.get("json") or {}).get("token"), self.invite
            refused = self.ask("POST", "/api/guest", key="not-the-code", link=self.invite, json={"name": "x"})
        else:
            got = self.ask("POST", "/api/enter", json={"i": self.invite.split("#i.")[1], "name": who})
            self.guest, link = got.get("cookie"), None
            refused = self.ask("POST", "/api/enter", json={"i": "not-the-code", "name": "x"})
        self.ok("invites", "a wrong invite is refused", 400 <= refused["status"] < 500)
        if not self.ok("invites", "a guest joins by the invite", got["status"] == 200 and self.guest, got["status"]):
            return
        self.ok("invites", "the guest reads the room", self.state(self.guest, link)["status"] == 200)
        self.ok("invites", "the guest can chat", self.ask("POST", "/api/messages", key=self.guest, link=link, json={"text": "hello from the guest"})["status"] == 200)
        seen = (self.state().get("json") or {}).get("messages", [])
        self.ok("invites", "the host sees the guest's message", any(m.get("text") == "hello from the guest" for m in seen))

    def files(self):
        if self.relay:
            got = self.ask("POST", "/api/files?name=a.bin&text=", key=self.key, json={})
            self.ok("files", "refused cleanly (a relay carries no files yet)", 400 <= got["status"] < 500, got["status"])
            return
        senders = [("host", self.key, 5_000_000)] + ([("guest", self.guest, 1_000_000)] if self.guest else [])
        for who, key, size in senders:
            got = self.ask("POST", "/api/files?name=check.bin&text=", key=key, type="application/octet-stream", seed=who, bytes=size)
            if self.ok("files", f"the {who} sends {size // 1_000_000} MB", got["status"] == 200, got["status"]):
                self.ok("files", f"the {who}'s file comes back the same", self.same_file_back(got["json"]["files"][0]["url"], got["sent"]))

    def agent_link(self):
        text = str((self.ask("POST", "/api/agent-invite", key=self.key, json={}).get("json") or {}).get("text", ""))
        if self.name == "local":
            code = re.search(r'"invite":\s*"([A-Za-z0-9_-]+)"', text)
            return code and f"{self.base}/#{code.group(1)}"
        found = re.search(r"join '([^']+)'", text)
        return found and found.group(1)

    def agents(self):
        link = self.agent_link()
        if not self.ok("agents", "the host gets an agent invite", link):
            return
        join = 'read -r link; exec shellphone join "$link" "$@"'  # the link holds a code: not in this computer's arguments
        joined = docker("exec", "-i", self.agent, "sh", "-c", join, "sh", "--name", "helper", "--dir", "/tmp/agent", input=link + "\n")
        if not self.ok("agents", "an agent joins from somewhere else", joined.returncode == 0, joined.stderr.strip()):
            return
        again = docker("exec", "-i", self.agent, "sh", "-c", join, "sh", "--name", "second", "--dir", "/tmp/second", input=link + "\n")
        self.ok("agents", "its code works only once", again.returncode != 0)
        wait = subprocess.Popen(["docker", "exec", self.agent, "shellphone", "wait", "--config", "/tmp/agent/lodge.json"],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        time.sleep(8)
        self.ok("agents", "it keeps listening", wait.poll() is None)
        self.ask("POST", "/api/messages", key=self.key, json={"text": "@helper are you there? check-4471"})
        try:
            heard = "check-4471" in wait.communicate(timeout=60)[0]
        except subprocess.TimeoutExpired:
            wait.kill()
            wait.communicate()
            heard = False
        self.ok("agents", "it hears the host", heard)
        posted = self.agent_cli("post", input="here, from the agent")
        seen = (self.state().get("json") or {}).get("messages", [])
        self.ok("agents", "the host sees its answer", posted.returncode == 0 and any(m.get("text") == "here, from the agent" for m in seen))
        sha = docker("exec", self.agent, "sh", "-c", "head -c 1000000 /dev/urandom > /tmp/agent.bin && sha256sum /tmp/agent.bin").stdout.split()
        sent = self.agent_cli("post", "--file", "/tmp/agent.bin", input="a file from the agent")
        if self.relay:
            self.ok("files", "the agent's file is refused, not lost silently", sent.returncode != 0)
        elif self.ok("files", "the agent sends 1 MB", sent.returncode == 0, sent.stderr.strip()):
            urls = [f["url"] for m in (self.state().get("json") or {}).get("messages", []) if m.get("kind") == "wolt" for f in m.get("files") or ([m["file"]] if m.get("file") else [])]
            self.ok("files", "the agent's file comes back the same", sha and urls and self.same_file_back(urls[-1], sha[0]))

    def restart(self):
        before = self.link
        docker("exec", self.room, "shellphone", "stop", "--port", str(self.port))
        time.sleep(3)
        if not self.ok("restart", "the room opens again", self.open_room()):
            return
        if self.name == "site-tunnel":
            time.sleep(10)
        self.ok("restart", "the host gets back in", self.reachable())
        if self.name != "local":  # on this computer only, the host's link is new each run
            self.ok("restart", "at the same link", self.link == before)
        if self.guest:
            self.ok("restart", "the guest is still in", self.state(self.guest, self.invite if self.relay else None)["status"] == 200)
        kept = False
        for _ in range(10):
            got = self.agent_cli("history", "--last", "20")
            kept = got.returncode == 0 and "here, from the agent" in got.stdout
            if kept:
                break
            time.sleep(3)
        self.ok("restart", "the agent's key and the history are kept", kept)

    def end(self):
        if self.name == "local":
            return
        stopped = docker("exec", self.room, "shellphone", "share", "--stop", "--port", str(self.port))
        time.sleep(2)
        self.ok("revoke", "share --stop works", stopped.returncode == 0, stopped.stderr.strip())
        self.ok("revoke", "the host's link is dead", self.state()["status"] != 200)
        if self.guest:
            self.ok("revoke", "the guest is out", self.state(self.guest, self.invite if self.relay else None)["status"] != 200)
        self.ok("revoke", "the agent is out", self.agent_cli("history", "--last", "5").returncode != 0)

    def close(self):
        if self.live.phone:
            return
        if self.name == "domain":
            self.tunnel("remove", self.live.domain)
        docker("rm", "-f", self.agent, self.room)


class Live:
    def __init__(self, a):
        self.run = f"shellphone-live-{uuid.uuid4().hex[:6]}"
        self.net, self.site, self.domain, self.phone = f"{self.run}-net", a.relay.rstrip("/"), a.domain, a.phone
        self.image, self.own_relay = f"{self.run}:room", "http://relay:8787"
        self.sha = subprocess.run(["git", "rev-parse", f"{a.ref}^{{commit}}"], cwd=REPO, capture_output=True, text=True).stdout.strip()
        if not self.sha:
            sys.exit(f"no commit {a.ref!r} here")
        self.images = []

    def build(self, relay):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "src").mkdir()
            tar = subprocess.run(["git", "archive", self.sha], cwd=REPO, capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(d / "src")], input=tar, check=True)
            for f in ("client.py", "front.py"):
                (d / f).write_text((HERE / f).read_text())
            wanted = [(self.image, DOCKERFILE)] + ([(f"{self.run}:relay", RELAY_DOCKERFILE)] if relay else [])
            for tag, text in wanted:
                (d / "Dockerfile").write_text(text)
                print(f"building {tag.split(':')[1]} from {self.sha[:7]}…", flush=True)
                got = docker("build", "-q", "-t", tag, "--label", f"{LABEL}={self.run}", str(d), timeout=900)
                if got.returncode:
                    sys.exit(f"the image didn't build:\n{got.stderr.strip()[-1200:]}")
                self.images.append(tag)
        docker("network", "create", "--label", f"{LABEL}={self.run}", self.net)

    def start_relay(self):
        name = f"{self.run}-relay"
        docker("run", "-d", "--name", name, "--label", f"{LABEL}={self.run}", "--network", self.net, "--network-alias", "relay", f"{self.run}:relay")
        for _ in range(90):
            got = docker("logs", name)
            if "Ready on" in got.stdout + got.stderr:
                return
            time.sleep(2)
        print("your own relay didn't start: " + docker("logs", name).stderr[-300:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", default="HEAD", help="the commit to test (committed files only)")
    ap.add_argument("--paths", default=",".join(PATHS), help="some of: " + ", ".join(PATHS))
    ap.add_argument("--relay", default=SITE, help="the site for site-relay and site-tunnel")
    ap.add_argument("--domain", help="a name under your own tunnel's domain, to test through it too")
    ap.add_argument("--phone", action="store_true", help="leave the rooms up, with their links in a private file")
    ap.add_argument("--clean", action="store_true", help="remove what --phone left up")
    a = ap.parse_args()
    if a.clean:
        clean()
        if a.domain:
            Way("domain", Live(a)).tunnel("remove", a.domain)
        return print("removed")
    names = [x for x in a.paths.split(",") if x]
    if unknown := set(names) - set(PATHS):
        ap.error(f"no such path: {', '.join(sorted(unknown))}")
    if a.domain:
        names.append("domain")
    live, ran = Live(a), []
    try:
        live.build("own-relay" in names)
        if "own-relay" in names:
            live.start_relay()
        for name in names:
            way = Way(name, live)
            ran.append(way)
            try:
                way.run()
            except Exception as e:
                way.ok("setup", "the checks ran to the end", False, f"{type(e).__name__}: {e}")
            finally:
                way.close()
    finally:
        if not live.phone:
            clean(live.run)
            for tag in live.images:
                docker("rmi", "-f", tag)

    areas = ("setup", "host", "invites", "files", "agents", "keys", "restart", "revoke")
    print(f"\n### Live test of `{live.sha[:7]}`\n")
    print("| path | " + " | ".join(areas) + " |\n" + "|---" * (len(areas) + 1) + "|")
    for way in ran:
        cells = []
        for area in areas:
            got = [p for x, _, p in way.results if x == area]
            cell = f"{sum(got)}/{len(got)}" + ("" if all(got) else " FAIL") if got else "n/a"
            if area == "files" and way.relay and got and all(got):
                cell = "none (refused)"
            cells.append(cell)
        print(f"| {way.name} | " + " | ".join(cells) + " |")
    total = [p for way in ran for *_, p in way.results]
    print(f"\n{sum(total)} of {len(total)} checks passed.")
    if live.phone:
        fd, where = tempfile.mkstemp(prefix="shellphone-live-", suffix=".txt")  # 600: the links are keys
        with os.fdopen(fd, "w") as f:
            f.writelines(f"{way.name}: {way.link}\n" for way in ran if getattr(way, "link", None) and way.name not in ("local", "own-domain", "own-relay"))
        print(f"rooms left up for a phone: links (keys!) in {where}. Afterwards: live.py --clean" + (f" --domain {a.domain}" if a.domain else ""))
    sys.exit(0 if total and all(total) else 1)


if __name__ == "__main__":
    main()
