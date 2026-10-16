"""Browser integration; optional existing Python Playwright + CHROMIUM_EXECUTABLE.
No npm/build step, and no test dependency is imported by the frontend.
Run against the normal static preview with CITY_ORIGIN=http://127.0.0.1:8080.
"""
import json,os
from playwright.sync_api import sync_playwright
ORIGIN=os.environ.get('CITY_ORIGIN','http://127.0.0.1:8080')
CHROME=os.environ['CHROMIUM_EXECUTABLE']
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    context=browser.new_context(viewport={'width':1000,'height':700})
    page=context.new_page();errors=[];missing=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:print('BROWSER:',m.text,flush=True)if m.type in ('error','warning') else None)
    page.on('response',lambda r:missing.append(r.url)if r.status>=400 else None)
    page.set_default_timeout(120000)
    page.goto(ORIGIN+'/')
    page.wait_for_selector('#btn-mode-solo',state='visible')
    assert page.locator('.map-btn[data-id="proc_city"]').count()==1
    print('PASS: proc_city is available in the actual main-menu map selector',flush=True)
    # Build an isolated real WebGL city without requiring any special HTTP test route.
    page.route(ORIGIN+'/__city_harness__',lambda route:route.fulfill(content_type='text/html',body='<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/"}}</script><canvas id="city"></canvas>'))
    page.goto(ORIGIN+'/__city_harness__')
    result=page.evaluate('''async()=>{
      const T=await import('/vendor/three.module.js');
      const {World}=await import('/js/map.js');
      const map=await(await fetch('/shared/maps/proc_city.json')).json();
      const data=await(await fetch('/shared/weapons.json')).json();
      const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(1000,700);renderer.setPixelRatio(.7);
      const scene=new T.Scene(),world=await World.create(scene,map,data.combat,renderer);
      const camera=new T.PerspectiveCamera(65,1000/700,.1,160);camera.position.set(29,25,34);camera.lookAt(0,1,0);
      renderer.render(scene,camera);
      const city=world.group.getObjectByName('proc-city');
      if(!city||city.children.some(o=>!o.isInstancedMesh))throw Error('Not fully instanced');
      for(const o of city.children)for(const mat of Array.isArray(o.material)?o.material:[o.material])if(mat.side!==T.DoubleSide)throw Error('Single sided interior material');
      if(!scene.background?.isTexture||!scene.environment?.isTexture)throw Error('Missing panorama/PMREM');
      let samples=0;
      const nodes=Object.fromEntries(map.bot_nav.nodes.map(n=>[n.id,n.p]));
      for(const [a,b]of map.bot_nav.edges)for(const [from,to]of [[a,b],[b,a]]){
        let p=nodes[from],q=nodes[to],y=p[1],n=Math.max(1,Math.ceil(Math.hypot(p[0]-q[0],p[2]-q[2])/.1));
        for(let k=1;k<=n;k++){
          const t=k/n,x=p[0]+(q[0]-p[0])*t,z=p[2]+(q[2]-p[2])*t;
          if(world.blocked(x,z,y))throw Error(`Blocked JS nav edge ${from} -> ${to}`);
          const next=world.floorAt(x,z,y);if(Math.abs(next-y)>.65)throw Error('Stair jitter/drop');y=next;samples++;
        }
      }
      const {Controls}=await import('/js/controls.js');
      const controls=new Controls(document.querySelector('canvas'),world,data.combat,{});controls.enabled=true;
      for(const fps of [20,60,144])for(const b of map.buildings) {
        controls.reset([b.ramp.x,0,b.ramp.z0-.7],90);controls.keys.clear();controls.keys.add('KeyW');controls.keys.add('ShiftLeft');
        let top=0;
        for(let k=0;k<fps*2;k++){controls.update(1/fps,true,false);top=Math.max(top,controls.pos.y);}
        if(top<2.99)throw Error(`${fps}fps: sprint never reached upper floor`);
      }
      window.cityTest={renderer,scene,camera,world,map};
      return {...city.userData,samples,drawCalls:renderer.info.render.calls};
    }''')
    page.screenshot(path='/tmp/proc-city-overview.png')
    print('PASS: uploaded materials/skybox, PMREM, instancing, 20/60/144fps stair sprints and every JS graph edge: '+json.dumps(result),flush=True)
    # Release the isolated scene and disable harness interception before loading
    # main.js (whose normal HTMLImage texture fallback uses blob URLs).
    page.evaluate("()=>{cityTest.world.dispose();cityTest.renderer.dispose();cityTest.renderer.forceContextLoss();}")
    page.unroute(ORIGIN+'/__city_harness__')
    # Load actual main.js, not just a mocked renderer or independent interpreter.
    page.goto(ORIGIN+'/')
    page.wait_for_selector('#btn-mode-solo',state='visible')
    page.locator('#input-name').fill('City QA')
    page.locator('.map-btn[data-id="proc_city"]').click();page.locator('#btn-mode-solo').click();page.locator('#btn-deploy').click()
    try:page.wait_for_function("window.__trench?.app.playing&&window.__trench.app.mapId==='proc_city'",timeout=180000)
    except Exception:
        print('BOOT STATE',page.evaluate("()=>{const a=window.__trench.app;return {playing:a.playing,map:a.mapId,pick:a.mapPick,netKeys:Object.keys(a.net||{}),netError:a.net?._fail?.message,engine:!!a.net?._engine?.py,me:a.net?.lastMe,children:a.scene.children.map(c=>({type:c.type,name:c.name,children:c.children.length})),loading:a.mapLoading,text:document.body.innerText.slice(0,700),resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('pyodide')||r.name.includes('/models/')).map(r=>({name:r.name,duration:r.duration,size:r.decodedBodySize}))}}"),errors,flush=True)
        raise
    live=page.evaluate('''()=>{
      const {app}=window.__trench;
      const result=JSON.parse(app.net._engine.py.runPython("__import__('json').dumps({'map':_host.room.map_id,'boxes':len(__import__('combat').SOLID)})"));
      if(result.map!=='proc_city')throw Error('Authority chose another map');
      const nodes=app.world.map.bot_nav.nodes.filter(n=>n.kind==='lookout');
      app.world.group.visible=false;app.renderer.setPixelRatio(.25);
      const reached=app.net._engine.py.runPython(`
import bots as _city_bots, combat as _city_combat
_m=_host.room.match
_m.drop_bots()
_host.room.bots_on=False
_p=_m.add_player('City bot',None,cls='scout',bot=True)
_p['team']=_m.players[${app.myId}]['team']
_p['pos']=[-27,0,0]
_p['bot_state']=None
_reached=False
for _i in range(3000):
    _city_bots.think(_m,_p,33)
    if _p['pos'][1]>=2.99:
        _reached=True
        break
_reached
`);
      if(!reached)throw Error('Pyodide bot never ascended');
      return result;
    }''')
    print('PASS: actual Solo main.js/Pyodide proc_city deploy and bot stair ascent: '+json.dumps(live),flush=True)
    host,guest=context.new_page(),context.new_page()
    for seat,role in [(host,'host'),(guest,'guest')]:
        seat.on('pageerror',lambda e:errors.append(str(e)))
        seat.route(ORIGIN+'/__city_net__',lambda r:r.fulfill(content_type='text/html',body='<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>'))
        seat.goto(ORIGIN+'/__city_net__');seat.unroute(ORIGIN+'/__city_net__')
        seat.evaluate("""async role=>{
          const {RelayHostNet,RelayNet}=await import('/js/relay.js');window.welcomes=[];window.netErrors=[];
          window.cityNet=new (role==='host'?RelayHostNet:RelayNet)({onWelcome:m=>welcomes.push(m),onError:e=>netErrors.push(e)},{code:'24682468'});
          await cityNet.connect('',{code:'24682468'});
          cityNet.join(role,'scout','sentinel',false,0,'',false,'proc_city','','24682468');
        }""",role)
        seat.wait_for_function('cityNet.id!==null',timeout=180000)
    guest.wait_for_function('cityNet._lastState?.ps?.length===2',timeout=15000)
    for seat in (host,guest):
        assert seat.evaluate("welcomes[0].mapId")=='proc_city'
        assert seat.evaluate('netErrors')==[]
    assert host.evaluate('cityNet.status().humans')==2
    host.evaluate('cityNet.close()');guest.evaluate('cityNet.close()')
    print('PASS: actual Vercel-only RelayHostNet/RelayNet two-player city welcome/state; no external backend',flush=True)
    assert not errors,errors
    assert not missing,missing
    print('PASS: no missing assets or uncaught browser errors',flush=True)
    browser.close()
