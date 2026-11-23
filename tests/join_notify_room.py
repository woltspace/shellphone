"""For tests/test_join_notify.py: one room in this process, with a stand-in for the push service that writes down
what it was asked to send. A guest comes in by an invite, an agent signs itself up, one signs up again. Prints one
line of JSON: every notification sent, as (to whom, what it said)."""
import argparse, json, sys, time
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


r.pywebpush = Push
r.add_person("member@x.org", "Mem")
with r.tx() as c:
    for email in (HOST, "member@x.org"):
        c.execute("insert into push (endpoint, email, sub, at) values (?, ?, ?, null)", (email, email, json.dumps({"to": email})))
r.ACTIVE[HOST] = time.time()  # looking at the room right now: a join is told all the same


def settle():
    time.sleep(0.5)  # notifications go out on a thread of their own
    got = sorted(sent)
    sent.clear()
    return got


out = {}
mark = "t:test"
status, made = r.CORE.make_invite(HOST, TUNNEL, mark)
status, who, key = r.CORE.redeem(mark, made["token"], "Gus")
out["guest"] = [status, settle()]
out["agent"] = [r.join_wolt(r.key_hash(r.agent_code("member@x.org")), {"wolt": "rocky"})[0], settle()]
out["agent_again"] = [r.join_wolt(r.key_hash(r.agent_code("member@x.org")), {"wolt": "rocky"})[0], settle()]
print(json.dumps(out))
