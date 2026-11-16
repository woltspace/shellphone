"""Local, opt-in session controller. Room data never selects a lodge URL or command.

Only the session saved in this connector's config may be controlled. A durable
local approval is required in addition to the room's person authentication.
"""
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import time
import threading
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Lodge:
    def __init__(self):
        self.base = os.environ.get('WOLTSPACE_API', 'http://127.0.0.1:7777').rstrip('/')
        u = urllib.parse.urlsplit(self.base)
        if u.scheme != 'http' or u.hostname not in ('localhost', '127.0.0.1', '::1') or u.username or u.password or u.path or u.query or u.fragment:
            raise ValueError('session management requires a local loopback lodge API')

    def call(self, method, path, body=None):
        req = urllib.request.Request(self.base+path, method=method, headers={'Content-Type':'application/json'},
                                     data=None if body is None else json.dumps(body).encode())
        with urllib.request.build_opener(NoRedirect).open(req, timeout=60) as response:
            return json.loads(response.read(1_000_000))

    def snapshot(self, cfg):
        sid = cfg.get('session')
        if not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', sid):
            raise ValueError('connector has no valid bound session')
        s = self.call('GET', '/sessions/'+sid)
        if s.get('wolt') != cfg['wolt']:
            raise ValueError('bound session does not belong to this wolt')
        alive = bool(s.get('alive'))
        return {'id': sid, 'started': s.get('created_at', s.get('started')), 'alive': alive,
                'actions': ['fresh', 'stop'] if alive else ['fresh', 'resume']}

    def act(self, cfg, action):
        # Recheck ownership immediately before the side effect. Never accept a
        # caller's arbitrary session ID, prompt, shell text or URL.
        snap = self.snapshot(cfg)
        if action not in snap['actions']:
            raise ValueError('action is no longer available')
        if action == 'fresh':
            result = self.call('POST', '/sessions/new/lodge', {'wolt': cfg['wolt'], 'from_wolt': 'shellphone',
                'from_session': '', 'prompt': "You are connected to a Shellphone room. Wait for its messages; reply using the instructions they contain."})
            sid = result.get('name')
            if not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', sid):
                raise ValueError('lodge did not return a session id; check the lodge before retrying')
            cfg['session'] = sid
            cfg['session_generation'] = cfg.get('session_generation', 0)+1
            cfg['recent'] = []
            cfg['session_stopped'] = False
        else:
            self.call('POST', '/sessions/'+cfg['session']+'/'+action, {})
            cfg['session_stopped'] = action == 'stop'


class Controller:
    def __init__(self, path, call, load, store, lodge=None):
        self.path, self.call, self.load, self.store = str(path), call, load, store
        self.local = str(Path(path).with_suffix('.sessions.json'))
        self._lodge = lodge
        self._lock = threading.RLock()
        self._depth = 0

    @property
    def lodge(self):
        if self._lodge is None:
            self._lodge = Lodge()
        return self._lodge

    @contextlib.contextmanager
    def locked(self):
        with self._lock:
            if self._depth:
                yield
                return
            with open(self.local+'.lock', 'a') as lock:
                os.chmod(self.local+'.lock', 0o600)
                fcntl.flock(lock, fcntl.LOCK_EX)
                self._depth = 1
                try:
                    yield
                finally:
                    self._depth = 0

    def persist(self, path, data):
        self.store(path, data)
        # The execution journal and new session binding must reach disk before
        # the next side effect/result: rename alone is not crash durability.
        with open(path, 'rb') as saved:
            os.fsync(saved.fileno())
        directory = os.open(str(Path(path).resolve().parent), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def local_state(self):
        return self.load(self.local) if Path(self.local).exists() else {'jobs': {}}

    def command(self, what, code=None, session=None):
        with self.locked():
            cfg = self.load(self.path)
            state = self.local_state()
            if what == 'revoke':
                state.pop('grant', None)
                self.persist(self.local, state)  # always local first, even with a broken lodge or room
                try:
                    self.call(cfg, 'POST', '/lodge/session/revoke', {})
                except Exception:
                    return 'Revoked locally. Room notification failed; its cached status will expire.'
                return 'Session access revoked for this connector.'
            if what == 'reconcile':
                if not session:
                    raise ValueError('Inspect the lodge, then supply --session with the session that should receive room messages.')
                chosen = {**cfg, 'session': session}
                snap = self.lodge.snapshot(chosen)  # requires this wolt's existing session
                cfg.update(session=session, session_stopped=not snap['alive'], recent=[],
                           session_generation=cfg.get('session_generation', 0)+1)
                cfg.pop('held', None)
                self.persist(self.path, cfg)
                state.pop('recovery_hold', None)
                for result in state.setdefault('jobs', {}).values():
                    if result.get('state') in ('running','uncertain'):
                        result.update(state='uncertain', result='Reconciled locally; not replayed.')
                self.persist(self.local, state)
                try:
                    self.call(cfg, 'POST', '/lodge/session/reconcile', {})
                except Exception:
                    return 'Reconciled locally; room notification failed. Retry reconcile when reachable.'
                return 'Session binding reconciled. No lifecycle action was replayed.'
            self.lodge.snapshot(cfg)  # ordinary agent configs cannot approve
            got = self.call(cfg, 'GET', '/lodge/session')
            if what == 'pending':
                p = got.get('pending')
                if not p:
                    return 'No pending connection request.'
                return json.dumps({'room': cfg.get('room_url') or cfg.get('relay'), 'wolt': cfg['wolt'],
                    'owner': got['owner'], 'code': p['code'], 'expires': p['expires']}, indent=2)
            p = got.get('pending')
            if not p or not isinstance(code, str) or code.upper() != p['code'] or p['expires'] <= time.time():
                raise ValueError('No matching unexpired pairing code. Read pending and compare it with your own browser.')
            # Bound to the configuration and keeper reviewed on this lodge.
            state.update(grant=secrets.token_hex(32), owner=got['owner'], wolt=cfg['wolt'],
                         room=cfg.get('room_url') or cfg.get('relay')+':'+cfg.get('room',''))
            self.persist(self.local, state)
            self.call(cfg, 'POST', '/lodge/session/approve', {'request': p['id'], 'code': code.upper(), 'grant': state['grant']})
            return 'Approved this wolt. Its running connector will report session status.'

    def step(self, cfg):
        """One serialized poll; returns true when a fresh session needs fresh context."""
        with self.locked():
            disk_cfg = self.load(self.path)
            rebound = disk_cfg.get('session_generation') != cfg.get('session_generation')
            if rebound:
                cfg.clear()
                cfg.update(disk_cfg)
            state = self.local_state()
            # Recover before ANY network operation, even when grants were revoked.
            for result in state.get('jobs', {}).values():
                if result.get('state') == 'running':
                    state['recovery_hold'] = True
                    result.update(state='uncertain', result='Connector restarted during action. Reconcile locally; not retried.')
            if state.get('recovery_hold'):
                cfg['session_stopped'] = True
                self.persist(self.path, cfg)
                self.persist(self.local, state)
            snap = self.lodge.snapshot(cfg)
            got = self.call(cfg, 'GET', '/lodge/session')
            approved = (state.get('grant') and state['grant'] == got.get('grant') and
                        state.get('owner') == got['owner'] and state.get('wolt') == cfg['wolt'] and
                        state.get('room') == (cfg.get('room_url') or cfg.get('relay')+':'+cfg.get('room','')))
            if not approved:
                self.call(cfg, 'POST', '/lodge/session/state', {})  # capability only, no session metadata
                return rebound
            grant = state['grant']
            fresh = rebound
            for job in got.get('jobs', []):
                jid = job['id']
                result = state.setdefault('jobs', {}).get(jid)
                if result:
                    if result['state'] == 'running':
                        result = {'state': 'uncertain', 'result': 'Connector restarted during action. Check the lodge; it was not retried.'}
                elif (state.get('recovery_hold') or job['grant_id'] != grant or job['owner'] != state['owner'] or job['wolt'] != cfg['wolt'] or
                      job['session_id'] != cfg['session'] or job['action'] not in snap['actions'] or cfg.get('held') or
                      job['created'] < time.time()-120):
                    result = {'state': 'failed', 'result': 'Session changed, request expired, or message delivery is pending.'}
                else:
                    # Room rechecks revocation; then persist admission BEFORE any side effect.
                    admitted = self.call(cfg, 'POST', '/lodge/session/result', {'id': jid, 'grant': grant, 'state': 'running'})
                    if admitted.get('state') != 'running':
                        raise ValueError('action was cancelled before execution')
                    state['jobs'][jid] = {'state': 'running'}
                    self.persist(self.local, state)
                    try:
                        self.lodge.act(cfg, job['action'])
                        self.persist(self.path, cfg)
                        fresh = job['action'] == 'fresh'
                        result = {'state': 'done', 'result': 'Action completed.'}
                    except Exception:
                        # A timeout can occur after a successful side effect: never replay automatically.
                        state['recovery_hold'] = True
                        cfg['session_stopped'] = True
                        self.persist(self.path, cfg)
                        result = {'state': 'uncertain', 'result': 'Could not confirm outcome. Delivery paused; check the lodge before another action.'}
                state['jobs'][jid] = result
                self.persist(self.local, state)
                self.call(cfg, 'POST', '/lodge/session/result', {'id': jid, 'grant': grant, **result})
            snap = self.lodge.snapshot(cfg)
            if state.get('recovery_hold'):
                snap.update(actions=[], recovery_required=True)
            self.call(cfg, 'POST', '/lodge/session/state', {'grant': grant, 'session': snap})
            return fresh
