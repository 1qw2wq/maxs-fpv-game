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
          for(const fps of[20,60,144])for(const b of map.buildings)for(const ramp of b.ramps||[]){
            const p=ramp.start,q=ramp.end,dx=q[0]-p[0],dz=q[2]-p[2],length=Math.hypot(dx,dz);
            controls.reset([p[0]-.7*dx/length,p[1],p[2]-.7*dz/length],Math.atan2(dz,dx)*180/Math.PI);
            controls.keys.clear();controls.keys.add('KeyW');controls.keys.add('ShiftLeft');
            let top=0;
            for(let k=0;k<fps*3;k++){controls.update(1/fps,true,false);top=Math.max(top,controls.pos.y);}
            if(top<q[1]-.01)throw Error(`${b.id} ${fps}fps ramp sprint failed at ${top}`);sprints++;
          }
          const {rayWorld,raySolid}=await import('/js/ballistics.js');let wallRays=0,stairRays=0;
          for(const b of map.boxes.filter(b=>b.t==='ramp'))for(const [offset,solid]of[[-.11,true],[-.5,false],[.1,false]]){const hit=raySolid(new T.Vector3(b.x-b.w/2-1,(b.y0+b.y1)/2+offset,b.z),new T.Vector3(1,0,0),b,b.w+2);if((hit!==null)!==solid)throw Error('Stair slab bullet volume mismatch');stairRays++;}
          for(const b of map.boxes.filter(b=>b.t==='wall'))for(const sign of[-1,1]){
            const axis=b.w<b.d?'x':'z',size=axis==='x'?b.w:b.d,o=new T.Vector3(b.x,b.y,b.z),d=new T.Vector3();o[axis]+=sign*(size/2+.25);d[axis]=-sign;
            const hit=rayWorld(world,o,d,size+.5);if(hit===null||hit>.250001)throw Error('Bullet crossed solid wall');wallRays++;
          }
          for(const c of map.connections){const hit=rayWorld(world,new T.Vector3(c.x-.75,c.y+1.58,c.z),new T.Vector3(1,0,0),1.5);if(hit!==null)throw Error('Connected door blocked');}
          window.qa={scene,renderer,camera,world,data};return{...city.userData,samples,sprints,wallRays,stairRays,drawCalls:renderer.info.render.calls};
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
        page.evaluate("()=>{const a=window.__trench.app;a.mapPick='proc_city';a.hud.el.name.value='Sidearm QA';a.renderer.setPixelRatio(.25);}")
        page.click('#btn-deploy')
        # This section tests controls/inventory, not combat. Stop autonomous
        # opponents as soon as the real Solo engine exists, so slow software
        # WebGL asset compilation cannot turn it into a spawn-death race.
        page.wait_for_function("window.__trench.app.net?._engine?.py&&window.__trench.app.net.lastMe",timeout=180000)
        page.evaluate("window.__trench.app.net._engine.py.runPython('_host.room.match.drop_bots();_host.room.bots_on=False')")
        page.wait_for_function("window.__trench.app.playing&&window.__trench.app.mapId==='proc_city'&&window.__trench.app.net.lastMe?.alive",timeout=180000)
        page.wait_for_function("window.__trench.app.net.lastMe?.secondary==='deagle'",timeout=15000)
        page.evaluate("()=>{const a=window.__trench.app;document.activeElement?.blur();a.controls.setMobileMode(true);a.controls.requestLock();}")
        page.keyboard.press('Digit2')
        try:page.wait_for_function("window.__trench.app.net.lastMe?.w==='deagle'&&window.__trench.app.vm.weapon.id==='deagle'",timeout=15000)
        except Exception:
            print('SWITCH DIAGNOSTIC',page.evaluate("()=>{const a=window.__trench.app;return{playing:a.playing,paused:a.paused,me:a.net.lastMe,enabled:a.controls.enabled,canLook:a.controls.canLook,vm:a.vm.weapon?.id,tracked:a.vmWeapon,focus:document.activeElement?.tagName};}"),flush=True)
            raise
        # Reproduce a stale visual rebuild without changing inventory: an
        # acknowledged packet must repair the actual VM, not just bookkeeping.
        page.evaluate("()=>{const a=window.__trench.app;a.vm.setWeapon(a.data.weaponById.mp18);a.net.h.onMe({...a.net.lastMe});if(a.vm.weapon.id!=='deagle')throw Error('Stale viewmodel not repaired');}")
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
        # A viewport resize legitimately resets rendering quality. Restore the
        # test-only software-GPU override before the animation/death sequence.
        page.evaluate("window.__trench.app.renderer.setPixelRatio(.25)")
        page.evaluate("window.__trench.app.net._engine.py.runPython('import game;_host.room.match.start_ms=game.now_ms()')")
        # Exercise the production syncFpArms path, not just the pure latch:
        # alternate valid/invalid reach reports while real animation still runs.
        page.wait_for_function("window.__trench.app.fpArms&&window.__trench.app.net.lastMe.alive",timeout=60000)
        presentation=page.evaluate("""async()=>{
          const a=window.__trench.app,rig=a.fpArms,pose=rig.poseArms,reach=Object.getOwnPropertyDescriptor(rig,'armReachError');
          a.cameraMode='fp';a.controls.ads=false;
          a.vm.setWeapon(a.data.weaponById[a.net.lastMe.w]);await a.vm.gunMeshes.userData.modelReady;
          let calls=0,changes=0,last=null;
          rig.poseArms=function(...args){pose.apply(this,args);return ++calls%2===1;};
          Object.defineProperty(rig,'armReachError',{configurable:true,get:()=>.01});
          try {
            for(let i=0;i<40;i++) {
              await new Promise(requestAnimationFrame);
              const imported=rig.holder.visible,procedural=a.vm.armMeshes.visible;
              if(imported===procedural)throw Error('Both/neither arm pairs drawn while alive');
              if(last!==null&&imported!==last)changes++;
              last=imported;
            }
            if(changes>1)throw Error('Production arm presentation flashes across reach threshold');
            return{frames:40,changes,calls};
          } finally {rig.poseArms=pose;Object.defineProperty(rig,'armReachError',reach);}
        }""")
        print('PASS: actual frame-loop arm fallback stays stable under alternating reach reports',presentation,flush=True)
        # Drive a real authoritative death, then choose a different class,
        # primary and secondary and redeploy through the real button/network.
        page.evaluate("window.__trench.app.net._engine.py.runPython('_p=next(iter(_host.room.match.players.values()));_host.room.match._kill(_p,_p,False)')")
        page.wait_for_function("!window.__trench.app.net.lastMe.alive&&!document.querySelector('#death-panel').classList.contains('hidden')")
        page.wait_for_function("!window.__trench.app.vm.root.visible&&!window.__trench.app.fpArms.holder.visible&&!window.__trench.app.vm.armMeshes.visible")
        # Advance past the former forced-redeploy deadline without waiting in
        # real time: the authoritative human must remain in the open picker.
        page.evaluate("window.__trench.app.net._engine.py.runPython('_p[\"respawn_at\"]=game.now_ms()-9000')")
        page.wait_for_function("!window.__trench.app.net.lastMe.alive&&window.__trench.app.net.lastMe.respawnIn===0")
        try:
            page.locator('#death-loadout [data-cls="scout"]').click()
        except Exception:
            print('DEATH PICKER DIAGNOSTIC',page.evaluate("""()=>{
              const a=window.__trench.app,cls=document.querySelector('#death-loadout [data-cls="scout"]'),panel=document.querySelector('.panel.death-panel');
              return{phase:a.net.lastState?.phase,playing:a.playing,paused:a.paused,deathShown:a.deathShown,me:a.net.lastMe,body:document.body.className,cls:cls?.getBoundingClientRect().toJSON(),panel:panel?.getBoundingClientRect().toJSON(),overlay:document.querySelector('#death-panel').className,loadout:document.querySelector('#death-loadout').getBoundingClientRect().toJSON()};
            }"""),flush=True)
            page.screenshot(path='/tmp/death-picker-live-failed.png')
            raise
        page.locator('#death-loadout [data-weapon="m170"]').click()
        page.locator('#death-loadout [data-secondary="g17"]').click()
        page.evaluate("async()=>{const{setLang}=await import('/js/i18n.js');setLang('zh');setLang('en');}")
        assert page.evaluate('window.__trench.app.hud.deathSelection')==dict(cls='scout',weapon='m170',secondary='g17')
        page.wait_for_function("!document.querySelector('#btn-respawn').disabled",timeout=15000)
        page.click('#btn-respawn')
        page.wait_for_function("window.__trench.app.net.lastMe.alive&&window.__trench.app.net.lastMe.primary==='m170'&&window.__trench.app.net.lastMe.secondary==='g17'",timeout=30000)
        page.evaluate("()=>{const a=window.__trench.app;document.activeElement?.blur();a.controls.requestLock();}")
        page.keyboard.press('Digit2')
        page.wait_for_function("window.__trench.app.net.lastMe.w==='g17'&&window.__trench.app.vm.weapon.id==='g17'",timeout=15000)
        print('PASS: real death hides FP meshes; bilingual death picker preserves both slots; authoritative respawn equips selected M170/G17 and switches to G17',flush=True)
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
