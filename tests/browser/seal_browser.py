"""Verify frame boundaries with a local HTTP tripwire, never an outside destination."""
import sys, tempfile, threading, json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_cli import Room,run,ENV
from playwright.sync_api import sync_playwright
hits=[]
class Sink(BaseHTTPRequestHandler):
 def do_GET(self):
  hits.append(self.path); self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
 def log_message(self,*a): pass
sink=ThreadingHTTPServer(('127.0.0.1',0),Sink); threading.Thread(target=sink.serve_forever,daemon=True).start()
url='http://127.0.0.1:'+str(sink.server_port)
board='''<h1>Boundary test</h1><pre id=result></pre><button id=nav>Navigate</button><script>
const checks={};try{parent.document.body;checks.parent=false}catch{checks.parent=true}
try{localStorage.setItem('x','1');checks.storage=false}catch{checks.storage=true}
checks.rtc=typeof RTCPeerConnection==='undefined';
try{const f=document.createElement('iframe');document.body.append(f);checks.nestedRTC=!f.contentWindow.RTCPeerConnection}catch{checks.nestedRTC=true}
fetch('SINK/fetch').catch(()=>{});let img=new Image();img.src='SINK/image';
document.querySelector('#nav').onclick=()=>location.href='SINK/nav?board=secret';
document.querySelector('#result').textContent=JSON.stringify(checks);
</script>'''.replace('SINK',url)
results=[]
try:
 with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
  for engine in ['chromium','webkit']:
   work=Path(tmp)/engine;work.mkdir(); r=Room(env=ENV); browser=None
   try:
    assert run('join',r.agent,'--name','builder',cwd=work).returncode==0
    (work/'seal.html').write_text(board)
    assert run('post','--page','seal.html','--title','Boundary test',cwd=work,stdin='Boundary test').returncode==0
    browser=getattr(pw,engine).launch();p=browser.new_page();p.goto(r.open)
    p.get_by_role('button',name='Boundary test page · v1 Open').click()
    f=p.frame_locator('iframe').first
    f.locator('#result').wait_for(); checks=json.loads(f.locator('#result').inner_text()); assert all(checks.values()),checks
    f.locator('#nav').click(); p.wait_for_timeout(1000)
    assert not hits,hits
    results.append({'engine':engine,'checks':checks,'tripwire_requests':len(hits)})
   finally:
    if browser:browser.close()
    r.close()
finally:sink.shutdown()
print(json.dumps(results,indent=2))
