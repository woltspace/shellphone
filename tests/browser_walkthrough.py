"""The whole way through, in a real (headless) browser at phone size, against the relay on this computer:
home page -> Start a room -> the agent's command -> the page opens the room -> both sides talk -> the room is closed.

    uv run --with playwright --with cryptography --with websockets python tests/browser_walkthrough.py [FOLDER FOR SCREENSHOTS]

Needs node (for the relay's local simulator) and a Chromium that playwright can start: `playwright install chromium`,
or point PLAYWRIGHT_CHROMIUM at one. Not part of `unittest discover`: it downloads and starts too much for that.
"""
import json, os, re, signal, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
import tempfile
from pathlib import Path
REPO, PORT = str(Path(__file__).resolve().parent.parent), 8793
OUT, EXE = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="shellphone-walkthrough-")), os.environ.get("PLAYWRIGHT_CHROMIUM")
BASE = f"http://127.0.0.1:{PORT}"
relay = subprocess.Popen(["npx", "-y", "wrangler@4", "dev", "--local", "--port", str(PORT), "--var", "HOST_KEY:e2e-key"], cwd=REPO + "/relay", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
host = None
def step(name, ok=True, note=""): print(("PASS  " if ok else "FAIL  ") + name + (f"  ({note})" if note else ""), flush=True); assert ok, name
try:
    for _ in range(90):
        try: urllib.request.urlopen(BASE + "/", timeout=2); break
        except OSError: time.sleep(1)
    with sync_playwright() as p:
        b = p.chromium.launch(**({"executable_path": EXE} if EXE else {}))
        pg = b.new_page(viewport={"width": 390, "height": 760}, device_scale_factor=2)
        errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(BASE + "/"); step("home page loads", "The group chat for people and their agents" in pg.inner_text("h1"))
        step("home fits a phone", pg.evaluate("document.documentElement.scrollWidth") == 390)
        pg.screenshot(path=OUT + "/1-home.png")
        pg.locator("a.btn.go").first.click(); pg.wait_for_url("**/start")
        pg.fill("#key", "e2e-key")
        msg = pg.inner_text("#message"); step("the message for the agent has the command and the link", "shellphone host '" in msg and "SHELLPHONE_RELAY_KEY='e2e-key'" in msg)
        link = re.search(r"host '([^']+)'", msg).group(1)
        step("waiting for the agent", "Waiting for your agent" in pg.inner_text("#status"))
        pg.screenshot(path=OUT + "/2-start.png")
        # the agent runs the command (from this checkout instead of uvx)
        host = subprocess.Popen([sys.executable, "-m", "shellphone.cli", "host", link, "--port", "0", "--name", "jerpint"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                env={**os.environ, "PYTHONPATH": REPO, "PYTHONUNBUFFERED": "1", "SHELLPHONE_RELAY_KEY": "e2e-key"})
        banner = ""
        while "Stop it (Ctrl-C)" not in banner:
            line = host.stdout.readline(); assert line, banner; banner += line
        step("the agent's command brings the room up", "shellphone room is up" in banner)
        pg.wait_for_url(re.compile(r".*/r/[A-Za-z0-9_-]{22}$"), timeout=15000)
        step("the waiting page opens the room by itself, and the key leaves the address bar", "#" not in pg.url, pg.url.replace(BASE, ""))
        # the agent joins its own room and says hello
        local = re.search(r"join '([^']+)'", banner).group(1); os.makedirs(OUT, exist_ok=True); work = tempfile.mkdtemp(prefix="agent-", dir=OUT)  # the agent's own folder, new each run
        env = {**os.environ, "PYTHONPATH": REPO}
        subprocess.run([sys.executable, "-m", "shellphone.cli", "join", local, "--name", "helper"], cwd=work, env=env, check=True, capture_output=True)
        subprocess.run([sys.executable, "-m", "shellphone.cli", "wait", "--timeout", "1"], cwd=work, env=env, capture_output=True)  # start listening from now
        subprocess.run([sys.executable, "-m", "shellphone.cli", "post"], cwd=work, env=env, input="Your room is up. I'm in it and listening.", text=True, check=True, capture_output=True)
        pg.wait_for_selector("text=Your room is up. I'm in it and listening.", timeout=15000)
        step("the agent's message shows on the phone")
        box = pg.locator("textarea, input[type=text]").first; box.fill("@helper hello from my phone, through the relay"); box.press("Enter")
        pg.wait_for_selector("text=hello from my phone, through the relay", timeout=15000)
        heard = subprocess.run([sys.executable, "-m", "shellphone.cli", "wait", "--timeout", "10"], cwd=work, env=env, capture_output=True, text=True).stdout
        step("the agent hears what was typed on the phone, as its own human asking", "hello from my phone, through the relay" in heard and "This is your own human asking." in heard)
        pg.screenshot(path=OUT + "/3-room.png")
        step("the room page fits a phone", pg.evaluate("document.documentElement.scrollWidth") == 390)
        host.send_signal(signal.SIGINT); out = host.communicate(timeout=15)[0]; host = None
        step("stopping the agent's command deletes the room", "Room closed and deleted." in out)
        pg.wait_for_selector("text=offline", timeout=20000)
        step("the phone says the room is offline")
        pg.screenshot(path=OUT + "/4-offline.png")
        step("no errors in the page", not errors, "; ".join(errors)[:300])
        b.close()
    print(f"ALL GOOD. Screenshots in {OUT}")
finally:
    if host and host.poll() is None: host.kill()
    os.killpg(relay.pid, signal.SIGTERM)
