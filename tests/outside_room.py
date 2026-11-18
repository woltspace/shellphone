"""For tests/test_outside.py: a room on this computer that believes it is linked through a tunnel at HOST, without
any tunnel or site. Prints one line of JSON (its port and the keys a test needs), then serves until it is stopped."""
import argparse, json, sys, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import cli
from shellphone.outside import Outside

HOST = "room-under-test.trycloudflare.com"
r, data, url, token, code, server = cli.start(argparse.Namespace(keep=None, port=0, name="Hostess"))
out = Outside(r, data, False, "https://site.example", server.server_address[1], cli.HOST_EMAIL)
out.room, out.secret, out.host_token, out.invite_token, out.host, out.open = "synthetic-room", "synthetic-secret", "host-key-" + "h" * 24, "invite-" + "i" * 24, HOST, True
r.LINKER = r.OUTSIDE = out
print(json.dumps({"port": server.server_address[1], "local": token, "code": code, "host": out.host_token, "invite": out.invite_token}), flush=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
for line in sys.stdin:  # "unlink": what the host's switch does, without the tunnel and the site it would tell
    if line.strip() == "unlink":
        out._tell = lambda *a, **kw: None
        out.off()
        print("unlinked", flush=True)
