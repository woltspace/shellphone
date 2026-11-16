"""Real room/connector/CLI over HTTP; lodge lifecycle is a deterministic fixture.
No real agent, credentials, model calls or existing lodge data are used.
"""
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

from test_cli import CLI, ENV, Room


class SessionHTTP(unittest.TestCase):
    def test_pair_fresh_stop_resume_and_message_delivery(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            sessions = {'bot-original-123456': {'wolt':'bot','alive':True,'created_at':1700000000}}
            calls = []
            class LodgeAPI(http.server.BaseHTTPRequestHandler):
                def log_message(self,*a): pass
                def answer(self, body, code=200):
                    data=json.dumps(body).encode()
                    self.send_response(code); self.send_header('Content-Type','application/json')
                    self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
                def do_GET(self):
                    sid=self.path.rsplit('/',1)[-1]
                    self.answer(sessions[sid] if sid in sessions else {'error':'missing'},200 if sid in sessions else 404)
                def do_POST(self):
                    body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
                    calls.append((self.path,body))
                    if self.path=='/sessions/new/lodge':
                        if body.get('wolt')!='bot': return self.answer({'error':'wrong wolt'},403)
                        sessions['bot-fresh-123456']={'wolt':'bot','alive':True,'created_at':1700000010}
                        return self.answer({'name':'bot-fresh-123456'})
                    _,_,sid,action=self.path.split('/')
                    if action not in ('stop','resume') or sid not in sessions: return self.answer({},404)
                    sessions[sid]['alive']=action=='resume'
                    self.answer({'status':action})
            api=http.server.ThreadingHTTPServer(('127.0.0.1',0),LodgeAPI)
            thread=threading.Thread(target=api.serve_forever,daemon=True); thread.start()
            self.addCleanup(api.server_close); self.addCleanup(api.shutdown)
            bindir=work/'bin'; bindir.mkdir()
            delivered=work/'delivered.jsonl'
            executable=bindir/'woltspace'
            executable.write_text('#!'+sys.executable+'\n'+'''import json,sys,os
if '--version' in sys.argv:
    print('0.6.0')
else:
    with open(os.environ['TEST_DELIVERED'],'a') as f:
        f.write(json.dumps({'args':sys.argv[1:],'text':sys.stdin.read()})+'\\n')
''')
            executable.chmod(0o755)
            env={**ENV,'WOLTSPACE_API':f'http://127.0.0.1:{api.server_port}',
                 'PATH':str(bindir)+os.pathsep+os.environ['PATH'],'TEST_DELIVERED':str(delivered)}
            room=Room(env=env)
            self.addCleanup(lambda: room.close() if room.proc.poll() is None else None)
            room.browser.open(room.open).read()
            def cmd(*args):
                got=subprocess.run([*CLI,*args],cwd=work,env=env,text=True,capture_output=True,timeout=15)
                self.assertEqual(got.returncode,0,got.stdout+got.stderr)
                return got.stdout
            cmd('join',room.agent,'--name','bot')
            conf=work/'shellphone'/'lodge.json'
            cfg=json.loads(conf.read_text()); cfg['session']='bot-original-123456'; conf.write_text(json.dumps(cfg))
            log=(work/'connector.log').open('w')
            listener=subprocess.Popen([*CLI,'run','--config',str(conf),'--every','0.1'],cwd=work,env=env,stdout=log,stderr=subprocess.STDOUT)
            self.addCleanup(log.close)
            def stop_listener():
                if listener.poll() is None: listener.terminate()
                listener.wait(10)
            self.addCleanup(stop_listener)
            def wait(fn):
                end=time.time()+12
                while time.time()<end:
                    got=fn()
                    if got: return got
                    if listener.poll() is not None: break
                    time.sleep(.05)
                self.fail('timed out: '+(work/'connector.log').read_text())
            def post(path,body):
                req=urllib.request.Request(room.url+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
                return json.load(room.browser.open(req))
            wait(lambda: 'lodge' in room.state())
            self.assertEqual(room.state()['sessions'],{})
            pending=post('/api/lodge/connect',{})
            code=pending['lodge']['code']
            self.assertIn(code,cmd('sessions','pending','--config',str(conf)))
            cmd('sessions','approve','--config',str(conf),'--code',code)
            wait(lambda: room.state().get('sessions',{}).get('bot'))
            def action(name,cid):
                sid=room.state()['sessions']['bot']['id']
                result=post('/api/session/action',{'wolt':'bot','session':sid,'action':name,'cid':cid})
                self.assertEqual(result['state'],'queued')
                return wait(lambda: next((j for j in room.state()['session_jobs'] if j['id']==cid and j['state']=='done'),None))
            def received(text):
                if not delivered.exists(): return None
                return next((j for j in map(json.loads,delivered.read_text().splitlines()) if text in j['text']),None)
            post('/api/messages',{'text':'@bot first-route-check','cid':'message-1'})
            first=wait(lambda: received('first-route-check'))
            self.assertIn('bot-original-123456',first['args'])
            action('fresh','fresh-click')
            wait(lambda: room.state()['sessions']['bot']['id']=='bot-fresh-123456')
            post('/api/messages',{'text':'@bot new-route-check','cid':'message-2'})
            second=wait(lambda: received('new-route-check'))
            self.assertIn('bot-fresh-123456',second['args'])
            self.assertEqual(sum(p=='/sessions/new/lodge' for p,_ in calls),1)
            action('stop','stop-click')
            wait(lambda: 'resume' in room.state()['sessions']['bot']['actions'])
            post('/api/messages',{'text':'@bot pending-route-check','cid':'message-3'})
            time.sleep(.3)
            self.assertIsNone(received('pending-route-check'))
            action('resume','resume-click')
            resumed=wait(lambda: received('pending-route-check'))
            self.assertIn('bot-fresh-123456',resumed['args'])
            cmd('sessions','revoke','--config',str(conf))
            wait(lambda: room.state()['sessions']=={})
            self.assertFalse(room.state()['lodge']['connected'])


if __name__=='__main__': unittest.main()
