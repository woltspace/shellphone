"""Opt-in lodge session control for trusted rooms, never for shared-secret guests.

The room authenticates a person; a local lodge approval separately grants access
for that person's wolt. This is not protection against the room's administrator.
The connector owns execution and checks its locally saved grant on every job.
"""
import hmac
import json
import re
import secrets
import time

SCHEMA = '''
create table if not exists session_devices(wolt text primary key, owner text not null,
    credential text not null, seen real not null, grant_id text, snapshot text);
create table if not exists session_pairings(owner text primary key, id text not null,
    code text not null, expires real not null);
create table if not exists session_jobs(id text primary key, owner text not null,
    wolt text not null, grant_id text not null, session_id text not null,
    action text not null, state text not null, created real not null, result text);
'''
ACTIONS = {'fresh', 'resume', 'stop'}
FRESH_FOR = 30
PAIR_FOR = 300
JOB_FOR = 120


def valid_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{1,120}', value))


class Controls:
    def __init__(self, room):
        self.r = room

    def allowed(self, req, owner):
        person = self.r.people().get(owner)
        return bool(getattr(req, 'trusted_person', False) and person and not person.get('guest'))

    def devices(self, owner):
        return self.r.q('''select d.* from session_devices d join wolts w on w.wolt=d.wolt
            where d.owner=? and w.owner=d.owner and w.key_hash=d.credential''', owner)

    def state(self, req, owner):
        if not self.allowed(req, owner):
            return {}
        ds = self.devices(owner)
        if not ds:
            return {}
        now = time.time()
        p = self.r.q('select * from session_pairings where owner=? and expires>?', owner, now)
        sessions = {}
        for d in ds:
            if not d['grant_id'] or not d['snapshot']:
                continue
            snap = json.loads(d['snapshot'])
            online = d['seen'] > now - FRESH_FOR
            busy = self.r.q("select id from session_jobs where wolt=? and state in ('queued','running')", d['wolt'])
            sessions[d['wolt']] = {**snap, 'online': online, 'actions': snap.get('actions', []) if online and not busy else []}
        jobs = self.r.q('select id,wolt,action,state,result,created as at from session_jobs where owner=? order by created desc limit 10', owner)
        jobs = [{**j, 'error': j['result'] if j['state'] in ('failed','uncertain') else None} for j in jobs]
        return {'lodge': {'connected': any(d['grant_id'] for d in ds), 'pending': bool(p),
                          'wolts': {d['wolt']: {'approved': bool(d['grant_id']), 'online': d['seen'] > now-FRESH_FOR} for d in ds},
                          'code': p[0]['code'] if p else None, 'expires': p[0]['expires'] if p else None,
                          'command': None, 'approval': 'On your lodge, run shellphone sessions pending --config PATH, then approve the matching code.'},
                'sessions': sessions, 'session_jobs': jobs}

    def person(self, req, owner):
        r = self.r
        if not self.allowed(req, owner):
            return r.reply(403, {'error': 'session controls require verified room login; guests and dev/header-only login are unsupported'})
        if req.method != 'POST':
            return r.reply(405, {'error': 'POST required'})
        data = json.loads(req.read(4096))
        if not isinstance(data, dict):
            return r.reply(400, {'error': 'send a JSON object'})
        now = time.time()
        with r.tx() as c:
            devices = self.devices(owner)
            if req.path == '/api/lodge/connect':
                if not any(d['seen'] > now-FRESH_FOR for d in devices):
                    return r.reply(409, {'error': 'no online lodge connector for your wolts'})
                p = r.q('select * from session_pairings where owner=? and expires>?', owner, now)
                if not p:
                    c.execute('insert or replace into session_pairings values (?,?,?,?)',
                              (owner, secrets.token_hex(16), secrets.token_hex(6).upper(), now+PAIR_FOR))
                return r.reply(200, self.state(req, owner))
            if req.path == '/api/lodge/disconnect':
                c.execute('delete from session_pairings where owner=?', (owner,))
                c.execute('update session_devices set grant_id=null,snapshot=null where owner=?', (owner,))
                c.execute("update session_jobs set state='cancelled' where owner=? and state='queued'", (owner,))
                c.execute("update session_jobs set state='uncertain',result='Disconnected during execution; reconcile on the lodge.' where owner=? and state='running'", (owner,))
                return r.reply(200, self.state(req, owner))
            if req.path != '/api/session/action':
                return r.reply(404, {'error': 'not found'})
            wolt, action, sid, cid = (data.get(k) for k in ('wolt', 'action', 'session', 'cid'))
            if not all(valid_id(v) for v in (wolt, sid, cid)) or action not in ACTIONS:
                return r.reply(400, {'error': 'wolt, session, cid and a supported action are required'})
            old = r.q('select * from session_jobs where id=?', cid)
            if old:
                j = old[0]
                if (j['owner'], j['wolt'], j['session_id'], j['action']) != (owner, wolt, sid, action):
                    return r.reply(409, {'error': 'request id already used'})
                return r.reply(200, {'id': cid, 'state': j['state']})
            d = next((d for d in devices if d['wolt'] == wolt), None)
            if not d or not d['grant_id'] or not d['snapshot']:
                return r.reply(403, {'error': 'approve this wolt on its lodge first'})
            s = json.loads(d['snapshot'])
            if d['seen'] <= now-FRESH_FOR or s.get('id') != sid or action not in s.get('actions', []):
                return r.reply(409, {'error': 'session changed, offline, or action unavailable; refresh'})
            if r.q("select id from session_jobs where wolt=? and state in ('queued','running')", wolt):
                return r.reply(409, {'error': 'a session action is already pending'})
            c.execute('insert into session_jobs values (?,?,?,?,?,?,?,?,?)',
                      (cid, owner, wolt, d['grant_id'], sid, action, 'queued', now, None))
            return r.reply(202, {'id': cid, 'state': 'queued'})

    def agent(self, req, agent):
        r = self.r
        wolt, owner = agent['wolt'], agent['owner']
        if not r.people().get(owner) or r.people()[owner].get('guest'):
            return r.reply(403, {'error': 'guest lodge management is unsupported'})
        rows = r.q('select key_hash from wolts where wolt=? and owner=?', wolt, owner)
        if not rows:
            return r.reply(403, {'error': 'wolt removed'})
        credential = rows[0]['key_hash']
        now = time.time()
        if req.method == 'GET':
            pair = r.q('select id,code,expires from session_pairings where owner=? and expires>?', owner, now)
            d = r.q('select * from session_devices where wolt=? and credential=?', wolt, credential)
            jobs = []
            if d and d[0]['grant_id']:
                with r.tx() as c:
                    c.execute("update session_jobs set state='expired' where wolt=? and state='queued' and created<?", (wolt, now-JOB_FOR))
                    jobs = r.q("select * from session_jobs where wolt=? and owner=? and grant_id=? and state in ('queued','running') order by created limit 1", wolt, owner, d[0]['grant_id'])
            return r.reply(200, {'owner': owner, 'pending': pair[0] if pair else None,
                                  'grant': d[0]['grant_id'] if d else None, 'jobs': jobs})
        if req.method != 'POST':
            return r.reply(405, {'error': 'POST required'})
        data = json.loads(req.read(8192))
        if not isinstance(data, dict):
            return r.reply(400, {'error': 'send a JSON object'})
        with r.tx() as c:
            d = r.q('select * from session_devices where wolt=?', wolt)
            if not d or d[0]['credential'] != credential or d[0]['owner'] != owner:
                c.execute("update session_jobs set state='cancelled' where wolt=? and state in ('queued','running')", (wolt,))
                c.execute('insert or replace into session_devices values (?,?,?,?,null,null)', (wolt, owner, credential, now))
            if req.path == '/lodge/session/approve':
                p = r.q('select * from session_pairings where owner=? and expires>?', owner, now)
                if not p or not isinstance(data.get('code'), str) or not hmac.compare_digest(p[0]['code'], data['code']) or data.get('request') != p[0]['id']:
                    return r.reply(403, {'error': 'pairing expired or code does not match'})
                if not isinstance(data.get('grant'), str) or not re.fullmatch(r'[0-9a-f]{64}', data['grant']):
                    return r.reply(400, {'error': 'invalid grant'})
                c.execute('update session_devices set grant_id=?,snapshot=null where wolt=?', (data['grant'], wolt))
                # Keep the pairing until all currently advertised own wolts are approved.
                if not any(not d['grant_id'] for d in self.devices(owner)):
                    c.execute('delete from session_pairings where owner=?', (owner,))
                return r.reply(200, {'approved': True})
            d = r.q('select * from session_devices where wolt=?', wolt)[0]
            if req.path == '/lodge/session/reconcile':
                c.execute("update session_jobs set state='uncertain',result='Checked locally; session binding reconciled.' where wolt=? and state='running'", (wolt,))
                c.execute('update session_devices set snapshot=null where wolt=?', (wolt,))
                return r.reply(200, {'reconciled': True})
            if req.path == '/lodge/session/revoke':
                c.execute('update session_devices set grant_id=null,snapshot=null where wolt=?', (wolt,))
                c.execute("update session_jobs set state='cancelled' where wolt=? and state='queued'", (wolt,))
                c.execute("update session_jobs set state='uncertain',result='Revoked during execution; reconcile on the lodge.' where wolt=? and state='running'", (wolt,))
                return r.reply(200, {'revoked': True})
            if req.path == '/lodge/session/state':
                snap = data.get('session')
                if snap is not None:
                    if not d['grant_id'] or data.get('grant') != d['grant_id']:
                        return r.reply(403, {'error': 'local approval required'})
                    if not isinstance(snap, dict) or not valid_id(snap.get('id')) or type(snap.get('alive')) is not bool:
                        return r.reply(400, {'error': 'invalid session state'})
                    snap = {'id': snap['id'], 'alive': snap['alive'], 'started': snap.get('started') if isinstance(snap.get('started'), (int,float,str)) else None,
                            'actions': [a for a in snap.get('actions', []) if a in ACTIONS],
                            'recovery_required': snap.get('recovery_required') is True}
                c.execute('update session_devices set seen=?,snapshot=? where wolt=?', (now, json.dumps(snap) if snap else None, wolt))
                return r.reply(200, {'ok': True})
            if req.path == '/lodge/session/result':
                job = r.q('select * from session_jobs where id=? and wolt=?', data.get('id'), wolt)
                if not job or not d['grant_id'] or data.get('grant') != d['grant_id'] or job[0]['grant_id'] != d['grant_id']:
                    return r.reply(403, {'error': 'grant revoked or wrong job'})
                state = data.get('state')
                if state not in ('running','done','failed','uncertain'):
                    return r.reply(400, {'error': 'invalid result'})
                if job[0]['state'] not in ('queued','running'):
                    return r.reply(200, {'state': job[0]['state']})
                if state == 'running' and job[0]['state'] == 'queued' and job[0]['created'] < now-JOB_FOR:
                    c.execute("update session_jobs set state='expired' where id=?", (data['id'],))
                    return r.reply(409, {'error': 'job expired'})
                c.execute('update session_jobs set state=?,result=? where id=?', (state, str(data.get('result',''))[:200], data['id']))
                return r.reply(200, {'state': state})
            return r.reply(404, {'error': 'not found'})
