import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from shellphone.session_agent import Controller

ROOT = Path(__file__).resolve().parents[1]


class Sessions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        spec = importlib.util.spec_from_file_location('session_room_test', ROOT/'room.py')
        self.r = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.r)
        self.r.DATA = Path(self.tmp.name)
        self.r.DB = self.r.DATA/'room.db'
        self.r.add_person('owner@example.test', 'Owner')
        self.r.add_person('other@example.test', 'Other')
        self.guest = self.r.add_guest('Guest')
        self.addCleanup(lambda: self.r.CON.close())
        with self.r.tx() as c:
            for w, owner in [('bot', 'owner@example.test'), ('otherbot', 'other@example.test'), ('guestbot', self.guest)]:
                c.execute('insert into wolts(wolt,owner,key_hash) values (?,?,?)', (w, owner, 'key-'+w))
        self.owner = 'owner@example.test'

    def request(self, method, path, data=None, trusted=True):
        raw = json.dumps(data or {}).encode()
        return self.r.Request(method, path, lambda limit: raw, trusted_person=trusted)

    def person(self, path, data=None, owner=None, trusted=True, method='POST'):
        return self.r.for_person(self.request(method,path,data,trusted), owner or self.owner)[:2]

    def agent(self, path, data=None, wolt='bot', method='POST'):
        a = self.r.q('select * from wolts where wolt=?', wolt)[0]
        return self.r.for_wolt(self.request(method,path,data), a)[:2]

    def state(self, owner=None, trusted=True):
        return self.person('/api/state', owner=owner, trusted=trusted, method='GET')[1]

    def pair(self):
        self.assertEqual(self.agent('/lodge/session/state')[0], 200)
        status, data = self.person('/api/lodge/connect')
        self.assertEqual(status, 200)
        code = data['lodge']['code']
        request = self.agent('/lodge/session', method='GET')[1]['pending']['id']
        self.grant = 'a'*64
        self.assertEqual(self.agent('/lodge/session/approve', {'request':request,'code':code,'grant':self.grant})[0],200)
        self.report()
        return request,code

    def report(self):
        return self.agent('/lodge/session/state', {'grant':self.grant,'session':{'id':'bot-session-123456','alive':True,'actions':['fresh','stop']}})

    def action(self, cid='click-1', **extra):
        return self.person('/api/session/action', {'wolt':'bot','session':'bot-session-123456','action':'fresh','cid':cid, **extra})

    def test_metadata_hidden_until_local_approval_and_from_every_other_identity(self):
        self.assertNotIn('lodge',self.state())
        self.agent('/lodge/session/state')
        self.assertEqual(self.state()['sessions'],{})
        self.assertNotIn('lodge', self.state(trusted=False))
        self.assertEqual(self.person('/api/lodge/connect',trusted=False)[0],403)
        self.pair()
        self.assertTrue(self.state()['sessions']['bot']['alive'])
        self.assertNotIn('sessions',self.state('other@example.test'))
        self.assertNotIn('sessions',self.state(self.guest))
        self.assertEqual(self.person('/api/session/action', {'wolt':'bot','session':'bot-session-123456','action':'stop','cid':'other'},owner='other@example.test')[0],403)
        self.assertEqual(self.person('/api/lodge/connect',owner=self.guest)[0],403)
        self.assertEqual(self.agent('/lodge/session/state',wolt='guestbot')[0],403)

    def test_spoofed_capability_cannot_publish_session_without_approval(self):
        self.grant='x'*64
        self.assertEqual(self.report()[0],403)
        self.assertEqual(self.state()['sessions'],{})

    def test_wrong_expired_and_cross_wolt_codes_rejected(self):
        self.agent('/lodge/session/state')
        p=self.person('/api/lodge/connect')[1]['lodge']
        request=self.agent('/lodge/session',method='GET')[1]['pending']['id']
        body={'request':request,'code':p['code'],'grant':'a'*64}
        self.assertEqual(self.agent('/lodge/session/approve',{**body,'code':'wrong'})[0],403)
        self.assertEqual(self.agent('/lodge/session/approve',body,wolt='otherbot')[0],403)
        with self.r.tx() as c:
            c.execute('update session_pairings set expires=0')
        self.assertEqual(self.agent('/lodge/session/approve',body)[0],403)

    def test_retries_return_same_job_and_conflicts_are_rejected(self):
        self.pair()
        self.assertEqual(self.action()[0],202)
        self.assertEqual(self.action()[0],200)
        self.assertEqual(self.action(action='stop')[0],409)
        self.assertEqual(self.action(cid='another')[0],409)
        self.assertEqual(len(self.r.q('select * from session_jobs')),1)
        self.assertEqual(self.state()['sessions']['bot']['actions'],[])

    def test_disconnect_blocks_queued_jobs_and_reconnect_requires_approval(self):
        self.pair(); self.action()
        self.assertEqual(self.person('/api/lodge/disconnect')[0],200)
        self.assertEqual(self.agent('/lodge/session',method='GET')[1]['jobs'],[])
        self.assertEqual(self.report()[0],403)
        self.assertEqual(self.state()['sessions'],{})
        self.person('/api/lodge/connect')
        self.assertEqual(self.action(cid='new')[0],403)

    def test_replaced_wolt_key_does_not_inherit_approval(self):
        self.pair()
        with self.r.tx() as c:
            c.execute("update wolts set key_hash='replacement' where wolt='bot'")
        self.assertNotIn('sessions',self.state())
        self.assertEqual(self.report()[0],403)

    def test_offline_and_stale_session_reject_actions(self):
        self.pair()
        self.assertEqual(self.action(session='old-session')[0],409)
        with self.r.tx() as c:
            c.execute('update session_devices set seen=0')
        self.assertEqual(self.state()['sessions']['bot']['actions'],[])
        self.assertFalse(self.state()['sessions']['bot']['online'])
        self.assertEqual(self.action()[0],409)

    def test_queued_job_expiry(self):
        self.pair(); self.action()
        with self.r.tx() as c:
            c.execute('update session_jobs set created=0')
        self.assertEqual(self.agent('/lodge/session',method='GET')[1]['jobs'],[])
        self.assertEqual(self.r.q('select state from session_jobs')[0]['state'],'expired')

    def test_controller_real_protocol_local_approval_execution_and_no_replay(self):
        self.agent('/lodge/session/state')
        code=self.person('/api/lodge/connect')[1]['lodge']['code']
        conf=Path(self.tmp.name)/'lodge.json'
        cfg={'wolt':'bot','session':'bot-session-123456','owner':self.owner,'room_url':'http://room.test'}
        def store(path,data): Path(path).write_text(json.dumps(data))
        def load(path): return json.loads(Path(path).read_text())
        store(conf,cfg)
        def call(cfg,method,path,body=None):
            status,result=self.agent(path,body,method=method)
            if status>=400: raise ValueError(result['error'])
            return result
        class FakeLodge:
            calls=0
            def snapshot(self,cfg):
                return {'id':cfg['session'],'alive':True,'actions':['fresh','stop']}
            def act(self,cfg,action):
                self.calls+=1
                cfg['session']='bot-fresh-123456'
        lodge=FakeLodge()
        controller=Controller(conf,call,load,store,lodge)
        with self.assertRaises(ValueError): controller.command('approve','wrong')
        controller.command('approve',code)
        controller.step(cfg)
        self.assertEqual(self.action()[0],202)
        self.assertTrue(controller.step(cfg))
        self.assertEqual(lodge.calls,1)
        self.assertEqual(load(conf)['session'],'bot-fresh-123456')
        self.assertEqual(self.action()[0],200)
        controller.step(cfg)
        self.assertEqual(lodge.calls,1)
        self.assertEqual(self.state()['session_jobs'][0]['state'],'done')
        controller.command('revoke')
        self.assertEqual(self.state()['sessions'],{})

    def controller_fixture(self, lodge):
        self.agent('/lodge/session/state')
        code=self.person('/api/lodge/connect')[1]['lodge']['code']
        conf=Path(self.tmp.name)/'controller.json'
        cfg={'wolt':'bot','session':'bot-session-123456','owner':self.owner,'room_url':'http://room.test'}
        def store(path,data): Path(path).write_text(json.dumps(data))
        def load(path): return json.loads(Path(path).read_text())
        store(conf,cfg)
        def call(cfg,method,path,body=None):
            status,result=self.agent(path,body,method=method)
            if status>=400: raise ValueError(result['error'])
            return result
        controller=Controller(conf,call,load,store,lodge)
        controller.command('approve',code)
        controller.step(cfg)
        return controller,cfg,conf

    def test_revoke_clears_local_grant_before_any_network_call(self):
        class FakeLodge:
            def snapshot(self,cfg): return {'id':cfg['session'],'alive':True,'actions':['fresh']}
        ctl,cfg,conf=self.controller_fixture(FakeLodge())
        def offline(*args):
            self.assertNotIn('grant',ctl.local_state())
            raise OSError('offline')
        ctl.call=offline
        ctl._lodge=object()  # even a completely unusable lodge must not block revoke
        self.assertIn('Revoked locally',ctl.command('revoke'))
        self.assertNotIn('grant',ctl.local_state())

    def test_crash_recovery_holds_before_network_and_requires_local_reconciliation(self):
        class CrashingLodge:
            calls=0
            def snapshot(self,cfg): return {'id':cfg['session'],'alive':True,'actions':['fresh','stop']}
            def act(self,cfg,action):
                self.calls+=1
                raise SystemExit('crash after possible side effect')
        lodge=CrashingLodge()
        ctl,cfg,conf=self.controller_fixture(lodge)
        self.action()
        with self.assertRaises(SystemExit): ctl.step(cfg)
        original_call=ctl.call
        def offline(*args): raise OSError('offline')
        ctl.call=offline
        with self.assertRaises(OSError): ctl.step(cfg)
        self.assertTrue(json.loads(conf.read_text())['session_stopped'])
        self.assertTrue(ctl.local_state()['recovery_hold'])
        ctl.call=original_call
        ctl.step(cfg)
        self.assertEqual(lodge.calls,1)
        snap=self.state()['sessions']['bot']
        self.assertTrue(snap['recovery_required'])
        self.assertEqual(snap['actions'],[])
        self.assertEqual(self.state()['session_jobs'][0]['state'],'uncertain')
        ctl.command('reconcile',session='bot-checked-123456')
        self.assertTrue(ctl.step(cfg))
        self.assertEqual(cfg['session'],'bot-checked-123456')
        self.assertFalse(cfg['session_stopped'])
        self.assertFalse(self.state()['sessions']['bot']['recovery_required'])

    def test_disconnect_running_job_reapproval_and_reconciliation(self):
        class CrashingLodge:
            def snapshot(self,cfg): return {'id':cfg['session'],'alive':True,'actions':['fresh']}
            def act(self,cfg,action): raise SystemExit('crash')
        ctl,cfg,conf=self.controller_fixture(CrashingLodge())
        self.action()
        with self.assertRaises(SystemExit): ctl.step(cfg)
        self.person('/api/lodge/disconnect')
        self.assertEqual(self.state()['session_jobs'][0]['state'],'uncertain')
        code=self.person('/api/lodge/connect')[1]['lodge']['code']
        ctl.command('approve',code)
        ctl.step(cfg)
        self.assertTrue(self.state()['sessions']['bot']['recovery_required'])
        self.assertEqual(self.action(cid='held')[0],409)
        ctl.command('reconcile',session='bot-session-123456')
        ctl.step(cfg)
        self.assertEqual(self.action(cid='after-check')[0],202)

    def test_timeout_pauses_delivery_and_does_not_replay(self):
        class TimeoutLodge:
            calls=0
            def snapshot(self,cfg): return {'id':cfg['session'],'alive':True,'actions':['fresh']}
            def act(self,cfg,action):
                self.calls+=1
                raise TimeoutError('might have spawned')
        lodge=TimeoutLodge()
        ctl,cfg,conf=self.controller_fixture(lodge)
        self.action(); ctl.step(cfg); ctl.step(cfg)
        self.assertEqual(lodge.calls,1)
        self.assertTrue(cfg['session_stopped'])
        self.assertEqual(self.state()['sessions']['bot']['actions'],[])
        self.assertTrue(self.state()['sessions']['bot']['recovery_required'])

    def test_relay_host_and_guest_identity_boundary_and_unlink(self):
        from shellphone.link import Link
        link=Link(self.r,self.owner,'http://relay.invalid',say=lambda *a:None)
        link.open=True
        link.guests['guest-token']=self.guest
        self.pair()
        status,body=link.answer('h','GET','/api/state',None,link.token)
        self.assertEqual(status,200)
        self.assertIn('bot',body['sessions'])
        status,body=link.answer('i','GET','/api/state',None,'guest-token')
        self.assertEqual(status,200)
        self.assertNotIn('sessions',body)
        self.assertEqual(link.answer('i','POST','/api/lodge/connect',{},'guest-token')[0],403)
        self.assertEqual(link.answer('h','POST','/api/lodge/connect',{},'guest-token')[0],403)
        link.stop()
        self.assertEqual(link.answer('h','POST','/api/lodge/connect',{},link.token)[0],503)

    def test_execution_never_starts_if_journal_cannot_be_flushed(self):
        class CountingLodge:
            calls=0
            def snapshot(self,cfg): return {'id':cfg['session'],'alive':True,'actions':['fresh']}
            def act(self,cfg,action): self.calls+=1
        lodge=CountingLodge()
        ctl,cfg,conf=self.controller_fixture(lodge)
        self.action()
        with patch('shellphone.session_agent.os.fsync',side_effect=OSError('disk failure')):
            with self.assertRaises(OSError): ctl.step(cfg)
        self.assertEqual(lodge.calls,0)
        ctl.step(cfg)
        self.assertTrue(cfg['session_stopped'])
        self.assertEqual(lodge.calls,0)

    def test_lodge_endpoint_and_session_cannot_be_selected_by_room(self):
        from shellphone.session_agent import Lodge
        for url in ('https://evil.test','http://127.0.0.1.evil.test','http://user@localhost:7777','http://localhost:7777/elsewhere'):
            with patch.dict('os.environ',{'WOLTSPACE_API':url}):
                with self.assertRaises(ValueError): Lodge()
        with patch.dict('os.environ',{'WOLTSPACE_API':'http://127.0.0.1:7777'}):
            lodge=Lodge()
        with patch.object(lodge,'call',return_value={'wolt':'someone-else','alive':True}) as request:
            with self.assertRaises(ValueError): lodge.act({'wolt':'bot','session':'other-123456'},'stop')
            self.assertEqual(request.call_count,1)
            self.assertEqual(request.call_args.args[0],'GET')


if __name__=='__main__': unittest.main()
