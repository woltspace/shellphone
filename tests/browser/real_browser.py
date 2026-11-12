"""Real room and built UI, two browser contexts; no mocked API responses."""
import sys, os, json, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_cli import Room, run, ENV
from playwright.sync_api import sync_playwright
BOARD = '''<!doctype html><h1>Launch plan</h1><ul id="items"></ul><button id="add">Add task</button><script>
shellphone.onChange((c, all) => { const l=document.querySelector('#items'); l.replaceChildren(); for(const x of all){ const n=document.createElement('li'); n.textContent=x.op.add+' · '+x.by.name; l.append(n); }});
document.querySelector('#add').onclick=()=>shellphone.change({add:'human task'});
</script>'''
output=Path(os.environ.get('BROWSER_RESULTS', '/tmp/shellphone-browser-results')); output.mkdir(parents=True, exist_ok=True)
results=[]
with tempfile.TemporaryDirectory() as temp, sync_playwright() as pw:
 for engine in ['chromium','webkit']:
  root=Path(temp)/engine; root.mkdir(); a=root/'a'; a.mkdir(); b=root/'b'; b.mkdir()
  r=Room('--name','Maya',env={**ENV,'SHELLPHONE_ACTIVITY_AFTER':'1'})
  browser=None
  try:
   for folder,name in [(a,'builder'),(b,'reviewer')]:
    p=run('join',r.agent,'--name',name,cwd=folder); assert p.returncode==0,p.stderr
   (a/'board.html').write_text(BOARD)
   p=run('post','--page','board.html','--title','Launch plan','--line','Shared board',cwd=a,stdin='Plan together'); assert p.returncode==0,p.stderr
   r.browser.open(r.open)
   pid=next(m['page']['id'] for m in r.state()['messages'] if m.get('page'))
   browser=getattr(pw,engine).launch()
   c1=browser.new_context(viewport={'width':390,'height':800}); c2=browser.new_context(viewport={'width':390,'height':800})
   p1=c1.new_page(); p2=c2.new_page()
   for page in [p1,p2]:
    page.goto(r.open); page.get_by_role('button',name='Launch plan Shared board page · v1 Open').click()
    page.frame_locator('iframe').locator('#add').wait_for()
   f1=p1.frame_locator('iframe'); f2=p2.frame_locator('iframe')
   f1.locator('#add').click()
   f2.locator('li').filter(has_text='human task · Maya').wait_for()
   changed=run('page','change',pid,cwd=b,stdin='{"add":"agent task"}'); assert changed.returncode==0,changed.stderr
   for f in [f1,f2]: f.locator('li').filter(has_text='agent task · reviewer').wait_for()
   # Changing HTML retains the complete ordered board in both clients.
   (b/'v2.html').write_text(BOARD.replace('Launch plan','Launch plan v2'))
   p=run('page','put',pid,'v2.html',cwd=b); assert p.returncode==0,p.stderr
   for page in [p1,p2]:
    f=page.frame_locator('iframe'); f.locator('h1').filter(has_text='Launch plan v2').wait_for()
    f.locator('li').filter(has_text='agent task · reviewer').wait_for(); assert f.locator('li').count()==2
   # Temporary outage on first GET must recover without a changed mark.
   p1.get_by_role('button',name='Close the page').click()
   attempts=[0]
   def fail_once(route):
    if route.request.method=='GET' and attempts[0]==0: attempts[0]+=1; route.abort()
    else: route.continue_()
   p1.route('**/api/page?*',fail_once)
   p1.get_by_role('button',name='Launch plan Shared board page · v1 Open').click()
   p1.get_by_text("Can't reach the room, trying again…",exact=True).wait_for()
   p1.frame_locator('iframe').locator('li').filter(has_text='agent task · reviewer').wait_for(timeout=10000)
   p1.unroute('**/api/page?*',fail_once)
   p1.screenshot(path=str(output/(engine+'-board.png')))
   p1.get_by_role('button',name='Close the page').click()
   p1.get_by_role('button').filter(has_text='changed Launch plan').first.wait_for(timeout=10000)
   # A late failed fetch must not resurrect polling after closing the viewer.
   held=[]
   def hold(route): held.append(route)
   p1.route('**/api/page?*',hold)
   p1.get_by_role('button',name='Launch plan Shared board page · v1 Open').click()
   p1.wait_for_timeout(500)
   assert len(held)==1, len(held)
   p1.get_by_role('button',name='Close the page').click()
   held[0].abort()
   p1.wait_for_timeout(7000)
   assert len(held)==1, 'requests continued after close'
   p1.unroute('**/api/page?*',hold)
   results.append({'engine':engine,'real_endpoints':True,'shared_human_agent_edits':True,'version_keeps_board':True,'retry_without_mark_change':True,'activity':True,'close_pending_fetch':True})
  finally:
   if browser: browser.close()
   r.close()
print(json.dumps(results,indent=2))
