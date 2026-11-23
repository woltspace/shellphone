"""For tests/test_join_notify.py: one room in this process, with a stand-in for the push service that writes down
what it was asked to send. A guest comes in by an invite, an agent signs itself up, one signs up again; then the same
with no thread to be had for the notification. Prints one line of JSON."""
import argparse, json, os, shutil, sys, tempfile, time, types
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shellphone import cli
from shellphone.core import TUNNEL

r, data, url, token, code, server = cli.start(argparse.Namespace(keep=None, port=0, name="Hostess"))
HOST = cli.HOST_EMAIL
sent = []


class Push:
    class WebPushException(Exception):
        response = None

    @staticmethod
    def webpush(sub, body, **kw):
        sent.append([sub["to"], json.loads(body)["body"]])


class Now:
    """A thread that runs its work right away, in this one: what was sent is known as soon as the call returns."""
    def __init__(self, target, daemon=None):
        self.target = target

    def start(self):
        self.target()


class Never(Now):
    def start(self):
        raise RuntimeError("can't start new thread")


def sent_now():
    got = sorted(sent)
    sent.clear()
    return got


out = {}
try:
    r.pywebpush = Push
    r.threading = types.SimpleNamespace(Thread=Now)
    r.add_person("member@x.org", "Mem")
    with r.tx() as c:
        for email in (HOST, "member@x.org"):
            c.execute("insert into push (endpoint, email, sub, at) values (?, ?, ?, null)", (email, email, json.dumps({"to": email})))
    r.ACTIVE[HOST] = time.time()  # looking at the room right now: a join is told all the same

    mark = "t:test"
    status, made = r.CORE.make_invite(HOST, TUNNEL, mark)
    status, who, key = r.CORE.redeem(mark, made["token"], "Gus")
    out["guest"] = [status, sent_now()]
    out["agent"] = [r.join_wolt(r.key_hash(r.agent_code("member@x.org")), {"wolt": "rocky"})[0], sent_now()]
    out["agent_again"] = [r.join_wolt(r.key_hash(r.agent_code("member@x.org")), {"wolt": "rocky"})[0], sent_now()]

    r.threading = types.SimpleNamespace(Thread=Never)  # no thread for the notification: the join itself still stands
    status, made = r.CORE.make_invite(HOST, TUNNEL, mark)
    status, who, key = r.CORE.redeem(mark, made["token"], "Ida")
    out["guest_no_thread"] = [status, bool(key), sent_now()]
    status, body = r.join_wolt(r.key_hash(r.agent_code("member@x.org")), {"wolt": "otto"})[:2]
    out["agent_no_thread"] = [status, "key" in body, sent_now()]
finally:
    (Path(tempfile.gettempdir()) / f"{cli.POINTER}{os.getpid()}.json").unlink(missing_ok=True)  # as `shellphone room` leaves things when it closes
    server.server_close()
    r.CON.close()
    shutil.rmtree(data, ignore_errors=True)
print(json.dumps(out))
