"""Optional real WebGL smoke test. Test-only Python Playwright; no npm/build.
Set CHROMIUM_EXECUTABLE and optionally CITY_ORIGIN. Screenshots go to /tmp.
"""
import os,json
from playwright.sync_api import sync_playwright
origin=os.environ.get('CITY_ORIGIN','http://127.0.0.1:8080')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'],headless=True,args=['--no-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--experimental-wasm-eh','--experimental-wasm-reftypes','--experimental-wasm-return-call','--js-flags=--experimental-wasm-eh --experimental-wasm-reftypes --experimental-wasm-return-call'])
    context=browser.new_context(viewport={'width':1200,'height':800})
    context.add_init_script("Object.hasOwn ||= ((o,k)=>Object.prototype.hasOwnProperty.call(o,k));")
    page=context.new_page();errors=[];missing=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('response',lambda r:missing.append(r.url)if r.status>=400 and '/api/'not in r.url else None)
    page.on('console',lambda m:print('CONSOLE',m.text,flush=True)if m.type in ('error','warning')else None)
    page.route(origin+'/__assets_harness__',lambda r:r.fulfill(content_type='text/html',body='<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/"}}</script><canvas></canvas>'))
    if not os.environ.get('CITY_ONLY_LIVE'):
        page.goto(origin+'/__assets_harness__')
        result=page.evaluate('''async()=>{
          const T=await import('/vendor/three.module.js'),{World}=await import('/js/map.js');
          const data=await(await fetch('/shared/weapons.json')).json(),map=await(await fetch('/shared/maps/proc_city.json')).json();
          const scene=new T.Scene(),renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas')});renderer.setSize(1200,800);renderer.setPixelRatio(.7);
          const world=await World.create(scene,map,data.combat,renderer),camera=new T.PerspectiveCamera(65,1.5,.06,400);
          camera.position.set(115,150,150);camera.lookAt(0,0,0);const fog=scene.fog;scene.fog=null;renderer.render(scene,camera);scene.fog=fog;
          const city=world.group.getObjectByName('proc-city');
          if(city.children.some(o=>!o.isInstancedMesh))throw Error('Non-instanced city');
          for(const name of ['courtyard','asphalt','pavement','paint_white','paint_yellow']){const m=city.getObjectByName('city:'+name)?.material;if(!m||m.side!==T.FrontSide||!m.polygonOffset)throw Error('Ground/decal depth regression: '+name);}
          const nodes=Object.fromEntries(map.bot_nav.nodes.map(n=>[n.id,n.p]));let samples=0;
          for(const[a,b]of map.bot_nav.edges)for(const[from,to]of[[a,b],[b,a]]){let p=nodes[from],q=nodes[to],y=p[1],n=Math.max(1,Math.ceil(Math.hypot(p[0]-q[0],p[2]-q[2])/.12));for(let k=1;k<=n;k++){const t=k/n,x=p[0]+(q[0]-p[0])*t,z=p[2]+(q[2]-p[2])*t;if(world.blocked(x,z,y))throw Error(`Blocked ${from}->${to}`);const next=world.floorAt(x,z,y);if(Math.abs(next-y)>.65)throw Error('Step/drop');y=next;samples++;}}
          const {Controls}=await import('/js/controls.js');
          const controls=new Controls(document.querySelector('canvas'),world,data.combat,{});controls.enabled=true;
          let sprints=0;
          for(const fps of[20,60,144])for(const b of map.buildings.filter(b=>b.stories>1)){
            const p=b.ramp.start,q=b.ramp.end,dx=q[0]-p[0],dz=q[2]-p[2],length=Math.hypot(dx,dz);
            controls.reset([p[0]-.7*dx/length,0,p[2]-.7*dz/length],Math.atan2(dz,dx)*180/Math.PI);
            controls.keys.clear();controls.keys.add('KeyW');controls.keys.add('ShiftLeft');
            let top=0;
            for(let k=0;k<fps*3;k++){controls.update(1/fps,true,false);top=Math.max(top,controls.pos.y);}
            if(top<2.99)throw Error(`${b.id} ${fps}fps ramp sprint failed at ${top}`);sprints++;
          }
          window.qa={scene,renderer,camera,world,data};return{...city.userData,samples,sprints,drawCalls:renderer.info.render.calls};
        }''')
        page.screenshot(path='/tmp/expanded-city.png');print('CITY',json.dumps(result),flush=True)
        if os.environ.get('CITY_ONLY_MAP'):
            browser.close();raise SystemExit(0)
        result=page.evaluate('''async()=>{
          const T=await import('/vendor/three.module.js'),{ViewModel}=await import('/js/viewmodel.js'),{createGirl}=await import('/js/character.js');
          const{weaponViewPose,weaponSockets}=await import('/js/weaponpose.js');
          const {data,scene,renderer,world}=qa;world.group.visible=false;scene.background=new T.Color('#75828c');
          data.teamById=Object.fromEntries(data.teams.map(t=>[t.id,t]));data.weaponsByClass=Object.fromEntries(data.classes.map(c=>[c.id,data.weapons.filter(w=>w.class===c.id)]));
          const camera=new T.PerspectiveCamera(78,1.5,.04,10);scene.add(camera);
          const vm=new ViewModel(data);vm.setClass(data.classes[0]);camera.add(vm.root);
          const girl=createGirl(data.classes[0],data.teams[0],data);scene.add(girl.root);girl.root.position.x=-.7;
          const output=[];
          for(const w of data.weapons){
            vm.setWeapon(w);await vm.gunMeshes.userData.modelReady;girl.setWeapon(w);await girl.root.getObjectByName('weapon-muzzle').parent.userData.modelReady;
            if(!vm.gunMeshes.getObjectByName('gun-model-'+w.id))throw Error('Model fallback '+w.id);
            vm.update(1/60,{ads:false,moveSpeed:0});girl.update(1/60,{speed:0,pitch:0});scene.updateMatrixWorld(true);
            const gun=vm.gunMeshes.getObjectByName('gun-model-'+w.id),box=new T.Box3().setFromObject(gun,true),size=box.getSize(new T.Vector3());
            if(size.length()>3||size.length()<.1)throw Error('Wrong weapon dimensions '+w.id+': '+size.toArray());
            if(w.shape==='pistol'&&new T.Vector3().fromArray(weaponSockets(w).hand).distanceTo(new T.Vector3().fromArray(weaponSockets(w).fore))>.09)throw Error('Pistol uses rifle support grip');
            vm.update(.1,{ads:true,moveSpeed:0});
            output.push({id:w.id,size:size.toArray(),view:weaponViewPose(w)});
          }
          window.qa.vm=vm;window.qa.girl=girl;window.qa.gunCamera=camera;
          return output;
        }''')
        print('GUNS',json.dumps(result),flush=True)
        for id in ['g17','m170','gm6','flarepistol']:
            page.evaluate('''async id=>{const w=qa.data.weapons.find(w=>w.id===id);qa.vm.setWeapon(w);await qa.vm.gunMeshes.userData.modelReady;qa.vm.update(.3,{ads:false,moveSpeed:0});qa.renderer.render(qa.scene,qa.gunCamera);}''',id)
            page.screenshot(path='/tmp/weapon-'+id+'.png')
    page.goto(origin+'/');page.wait_for_selector('#btn-mode-solo',timeout=90000)
    page.click('#btn-mode-solo');page.wait_for_selector('#secondary-row .weapon-card')
    assert page.locator('#secondary-row .weapon-card').count()==4
    page.locator('#secondary-row .weapon-card').nth(2).click()
    selected=page.evaluate('window.__trench.app.hud.selected')
    assert selected['secondary']=='deagle',selected
    page.screenshot(path='/tmp/expanded-loadout.png')
    if os.environ.get('CITY_LIVE'):
        page.evaluate("()=>{const a=window.__trench.app;a.mapPick='proc_city';a.hud.el.name.value='Sidearm QA';}")
        page.click('#btn-deploy')
        page.wait_for_function("window.__trench.app.playing&&window.__trench.app.mapId==='proc_city'",timeout=180000)
        page.wait_for_function("window.__trench.app.net.lastMe?.secondary==='deagle'",timeout=15000)
        page.evaluate("()=>{const a=window.__trench.app;a.controls.setMobileMode(true);a.controls.requestLock();}")
        page.keyboard.press('Digit2')
        page.wait_for_function("window.__trench.app.net.lastMe?.w==='deagle'&&window.__trench.app.vm.weapon.id==='deagle'",timeout=15000)
        page.wait_for_function("!window.__trench.app.net.lastMe.equipIn")
        page.evaluate("()=>{const a=window.__trench.app;a.net.fire(a.controls.eye(),a.controls.aim());}")
        page.wait_for_function("window.__trench.app.net.lastMe.mag===6")
        page.evaluate("window.__trench.app.mobile.press('weapon')")
        page.wait_for_function("window.__trench.app.net.lastMe.w==='mp18'")
        page.wait_for_function("!window.__trench.app.net.lastMe.equipIn")
        page.keyboard.press('Digit2')
        page.wait_for_function("window.__trench.app.net.lastMe.w==='deagle'&&window.__trench.app.net.lastMe.mag===6")
        page.evaluate("document.body.classList.add('mobile-mode')")
        for width,height in[(360,780),(390,844),(844,390),(740,360)]:
            page.set_viewport_size(dict(width=width,height=height))
            page.wait_for_timeout(100)
            overlaps=page.evaluate("""()=>{
              const items=[...document.querySelectorAll('#mobile-controls [data-action],#mobile-controls .touch-stick')].map(e=>({key:e.dataset.action||'move',r:e.getBoundingClientRect()}));
              const bad=[];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j];if(Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>2&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>2)bad.push([a.key,b.key]);}return bad;
            }""")
            assert not overlaps,(width,height,overlaps)
        print('PASS: four portrait/landscape mobile layouts including the new weapon button, no control overlaps',flush=True)
        print('PASS: actual Solo/Pyodide city deploy; keyboard/touch switching; sidearm fire and independent ammunition; viewmodel acknowledgement',flush=True)
        page.evaluate("window.__trench.app.net.close()")
        host,guest=context.new_page(),context.new_page()
        for seat,role,side in[(host,'host','apx'),(guest,'guest','g17')]:
            seat.on('pageerror',lambda e:errors.append(str(e)))
            seat.route(origin+'/__net_harness__',lambda r:r.fulfill(content_type='text/html',body='<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>'))
            seat.goto(origin+'/__net_harness__')
            seat.evaluate("""async({role,side})=>{
              const{RelayHostNet,RelayNet}=await import('/js/relay.js');window.welcomes=[];window.netErrors=[];
              window.cityNet=new(role==='host'?RelayHostNet:RelayNet)({onWelcome:m=>welcomes.push(m),onError:e=>netErrors.push(e)},{code:'24682468'});
              await cityNet.connect('',{code:'24682468'});
              cityNet.join(role,'scout','m170',false,0,'',false,'proc_city','','24682468','tdm',side);
            }""",dict(role=role,side=side))
            seat.wait_for_function('cityNet.id!==null',timeout=180000)
            assert seat.evaluate('welcomes[0].secondary')==side
        guest.evaluate("cityNet.switchWeapon('secondary')")
        guest.wait_for_function("cityNet.lastMe?.w==='g17'")
        host.wait_for_function("cityNet._lastState?.ps.some(p=>p.w==='g17')")
        for seat in(host,guest):assert seat.evaluate('netErrors')==[]
        assert host.evaluate('cityNet.status().humans')==2
        host.evaluate('cityNet.close()');guest.evaluate('cityNet.close()')
        print('PASS: two real RelayHostNet/RelayNet seats on the enlarged city, distinct selected pistols, remote active-gun snapshot; no external backend',flush=True)
    assert not errors,errors
    assert not missing,missing
    print('PASS: '+('live Solo and two-seat multiplayer sidearms' if os.environ.get('CITY_ONLY_LIVE') else 'all thirty model loads, fitted poses, city collision and selectable sidearms')+'; no missing assets or uncaught errors',flush=True)
    browser.close()
