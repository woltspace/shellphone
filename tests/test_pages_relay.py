"""Pages through a real local relay, room and browser transport."""
import json, re, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_pipe
from test_pipe import E2E
from test_cli import run

@E2E
class PagesThroughRelay(unittest.TestCase):
    setUpClass = classmethod(test_pipe.ThroughTheRelay.setUpClass.__func__)
    tearDownClass = classmethod(test_pipe.ThroughTheRelay.tearDownClass.__func__)
    setUp = test_pipe.ThroughTheRelay.setUp
    tearDown = test_pipe.ThroughTheRelay.tearDown
    link = test_pipe.ThroughTheRelay.link
    host = test_pipe.ThroughTheRelay.host
    page = test_pipe.ThroughTheRelay.page
    def test_shared_page_round_trip(self):
        link = self.link()
        host, banner = self.host(link)
        ask = self.page(link)
        ask(cmd='request', method='GET', path='/api/state?after=0')
        invite = re.search(r"join '([^']+)'", banner).group(1)
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            joined = run('join', invite, '--name', 'builder', cwd=work)
            self.assertEqual(joined.returncode, 0, joined.stderr)
            (work/'board.html').write_text('<h1>Relay board</h1>')
            posted = run('post','--page','board.html','--title','Relay board',cwd=work,stdin='Shared plan')
            self.assertEqual(posted.returncode, 0, posted.stderr)
            self.assertGreaterEqual(ask(cmd='news',atLeast=1)['news'],1)
            state=ask(cmd='request',method='GET',path='/api/state?after=0')['body']
            pid=next(m['page']['id'] for m in state['messages'] if m.get('page'))
            got=ask(cmd='request',method='GET',path=f'/api/page?id={pid}')
            self.assertEqual(got['status'],200)
            self.assertEqual(got['body']['html'],'<h1>Relay board</h1>')
            changed=ask(cmd='request',method='POST',path='/api/page',body={'id':pid,'op':{'add':'human task'},'by':{'name':'spoof'}})
            self.assertEqual(changed['status'],200)
            agent=run('page','change',pid,cwd=work,stdin='{"add":"agent task"}')
            self.assertEqual(agent.returncode,0,agent.stderr)
            got=ask(cmd='request',method='GET',path=f'/api/page?id={pid}&after=0&v=1')['body']
            self.assertNotIn('html',got)
            self.assertEqual([c['n'] for c in got['changes']],[1,2])
            self.assertEqual([c['by']['name'] for c in got['changes']],['Sam','builder'])
            self.assertEqual(ask(cmd='request',method='GET',path='/api/page?id=missing')['status'],404)
            for frame in ask(cmd='wire')['wire']:
                for plain in ['human task','agent task','Relay board','/api/page']:
                    self.assertNotIn(plain,frame)

if __name__=='__main__':
    unittest.main(defaultTest='PagesThroughRelay.test_shared_page_round_trip')
