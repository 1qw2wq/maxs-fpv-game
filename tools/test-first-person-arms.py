"""Legacy imported-arm lab rendering plus current closed-glove gameplay checks.
Use test-combat-rendering.mjs for the current production viewmodel pixel suite.
Serve public/ on CITY_ORIGIN; test-only Python Playwright + CHROMIUM_EXECUTABLE.
Optional ARM_SCREENSHOT=/tmp/arms.png saves actual rig screenshots.
"""
import os
from playwright.sync_api import sync_playwright

origin = os.environ.get('CITY_ORIGIN', 'http://127.0.0.1:8080')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'], headless=True,
        args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 960, 'height': 720})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/__arm_test__', lambda r: r.fulfill(content_type='text/html', body=
        '<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><canvas></canvas>'))
    page.goto(origin + '/__arm_test__')
    if not os.environ.get('ARMS_LIVE_ONLY'):
        result = page.evaluate('''async()=>{
          const T=await import('/vendor/three.module.js');
          const {ViewModel}=await import('/js/viewmodel.js');
          const {ArmPresentation}=await import('/js/avatar-visibility.js');
          const {FirstPersonPass}=await import('/js/first-person-pass.js');
          const {BUILTIN_SKINS,createExternalGirl,prepareTemplate,loadGltfFromUrl}=await import('/js/rig.js');
          const d=await(await fetch('/shared/weapons.json')).json();
          d.teamById=Object.fromEntries(d.teams.map(t=>[t.id,t]));
          const scene=new T.Scene(),camera=new T.PerspectiveCamera(78,4/3,.06,100);
          scene.add(camera);scene.add(new T.HemisphereLight(0xffffff,0x556677,2.5));
          const sun=new T.DirectionalLight(0xffffff,1);sun.position.set(1,2,3);scene.add(sun);
          const flash=new T.PointLight(0xffcc99,0,9,2);scene.add(flash);
          const vm=new ViewModel(d);vm.setClass(d.classes[0]);camera.add(vm.root);
          const holder=new T.Group();holder.position.set(.03,-1.44,-.32);holder.rotation.y=Math.PI;vm.root.add(holder);
          const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
          renderer.setSize(960,720);renderer.setClearColor(0,0);
          const target=new T.WebGLRenderTarget(320,240),pixels=new Uint8Array(320*240*4),base=new Uint8Array(pixels.length);
          const pass=new FirstPersonPass(),hand=new T.Vector3(),fore=new T.Vector3(),rotation=new T.Quaternion();
          let poses=0,rendered=0,wallCases=0,minPixels=Infinity,maxReach=0;
          const originals=new Map(),snapshots=[];
          const wall=new T.Mesh(new T.PlaneGeometry(10,10),new T.MeshBasicMaterial({color:0x991155}));
          wall.position.z=-.08;camera.add(wall);wall.visible=false;
          function draw(){
            const parent=vm.root.parent,matrix=vm.root.matrix.clone(),auto=renderer.autoClear;
            renderer.setRenderTarget(target);pass.render(renderer,scene,camera,vm.root);
            renderer.readRenderTargetPixels(target,0,0,320,240,pixels);
            if(!pass.lights.some(pair=>pair.source===flash&&pair.copy.intensity===flash.intensity))throw Error('FP pass lost pooled muzzle-flash lighting');
            if(vm.root.parent!==parent||!matrix.equals(vm.root.matrix)||renderer.autoClear!==auto)throw Error('FP pass leaked a parent/matrix/renderer change');
          }
          function countAlpha(){let n=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>10)n++;return n;}
          function changed(){let n=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-base[i])+Math.abs(pixels[i+1]-base[i+1])+Math.abs(pixels[i+2]-base[i+2])>10)n++;return n;}
          function place(girl,selection,key,weapon){
            vm.gripWorld(hand,fore,rotation);
            const ok=girl.poseArms(hand,fore,rotation,weapon.shape,true);
            maxReach=Math.max(maxReach,girl.armReachError);
            const imported=selection.update(key,ok&&girl.hasArmGeometry?girl.armReachError:Infinity);
            if(!imported)throw Error(key+': character arms unexpectedly fell back; reach '+girl.armReachError);
            holder.visible=true;vm.armMeshes.visible=false;
          }
          for(const meta of Object.values(BUILTIN_SKINS)){
            const template=prepareTemplate((await loadGltfFromUrl(meta.file)).scene);
            template.scene.traverse(o=>{if(o.isMesh)for(const m of(Array.isArray(o.material)?o.material:[o.material]))originals.set(m,[m.depthTest,m.depthWrite,m.side,m.opacity,m.transparent].join('|'));});
            const girl=createExternalGirl({template,meta,data:d,team:d.teams[0]});
            holder.add(girl.root);girl.shadow.visible=girl.marker.visible=false;girl.setHeadHidden(true);
            if(!girl.setArmsOnly(true))throw Error(meta.id+': empty arm geometry');
            const selection=new ArmPresentation();
            for(const weapon of d.weapons){
              vm.setWeapon(weapon);await vm.gunMeshes.userData.modelReady;
              const key=meta.id+'|'+vm.gunMeshes.uuid;
              for(const aspect of [4/3,9/16])for(const phase of ['hip','ads','recoil','sprint','reload-start','reload-service','reload-seat','reload-recover']){
                camera.aspect=aspect;camera.fov=phase==='ads'&&!weapon.scope?weapon.zoomFov:78;camera.updateProjectionMatrix();
                vm.recoil=vm.recoilRot=0;vm.ads=phase==='ads'?1:0;vm.sprint=phase==='sprint'?1:0;
                const progress={'reload-start':.18,'reload-service':.48,'reload-seat':.74,'reload-recover':.9}[phase];
                vm.syncReload(3000,progress===undefined?0:3000*(1-progress),progress!==undefined);
                if(phase==='recoil')vm.kick(1);
                vm.update(0,{ads:phase==='ads',sprinting:phase==='sprint',moveSpeed:2,viewFov:camera.fov});
                place(girl,selection,key,weapon);poses++;
                vm.gunMount.visible=false;draw();vm.gunMount.visible=true;
                const n=countAlpha();rendered++;minPixels=Math.min(minPixels,n);
                if(n<40)throw Error(`${meta.id}/${weapon.id}/${aspect}/${phase}: arms exist but render only ${n} pixels`);
                if(weapon.id==='mp18'&&aspect===4/3&&['hip','reload-service'].includes(phase)){
                  renderer.setRenderTarget(null);pass.render(renderer,scene,camera,vm.root);
                  snapshots.push({name:meta.id+'-'+phase,url:renderer.domElement.toDataURL()});
                }
              }
              // Entire reloads and repeated recoil while camera transforms change;
              // never reselect a different hand model in the same equip cycle.
              for(const hz of [20,60,144])for(let frame=0;frame<=hz;frame++){
                const progress=frame/hz;
                camera.position.set(12+Math.sin(progress),2,7);camera.rotation.set(Math.sin(progress*6)*.9,progress*4,.03);
                camera.updateMatrixWorld(true);
                vm.syncReload(3000,3000*(1-progress),progress<1);
                if(frame%12===0)vm.kick(.7);
                vm.update(1/hz,{ads:false,sprinting:false,moveSpeed:4,viewFov:78});
                place(girl,selection,key,weapon);poses++;
              }
              camera.position.set(0,0,0);camera.rotation.set(0,0,0);camera.updateMatrixWorld(true);
              camera.aspect=4/3;camera.fov=78;camera.updateProjectionMatrix();
              vm.syncReload(3000,0,false);vm.ads=vm.sprint=0;vm.update(0,{ads:false,moveSpeed:0});place(girl,selection,key,weapon);
              // A close wall must not occlude either arm. Compare actual pixels to
              // the world-only framebuffer; do not just assert root.visible=true.
              vm.gunMount.visible=false;wall.visible=true;vm.root.visible=false;
              renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,320,240,base);
              vm.root.visible=true;renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,320,240,pixels);
              if(changed()>=40)throw Error('Wall fixture did not reproduce world-depth occlusion');
              draw();
              if(changed()<40)throw Error(meta.id+'/'+weapon.id+': nearby world geometry erased the arms');wallCases++;
              wall.visible=false;vm.gunMount.visible=true;
            }
            const valid=girl.root.position.clone();
            if(girl.poseArms(new T.Vector3(NaN,0,0),fore,rotation,'rifle',true)!==false||girl.root.position.distanceTo(valid)>1e-9)throw Error('Invalid contacts corrupted an arm rig');
            girl.setArmsOnly(false);
            if(girl.root.position.length()>1e-9)throw Error('FP fitting leaked into a third-person gameplay root');
            girl.setArmsOnly(true);
            const textures=new Set();girl.root.traverse(o=>{if(o.isSkinnedMesh&&o.skeleton.boneTexture)textures.add(o.skeleton.boneTexture);});
            if(!textures.size)throw Error('GPU skin textures were never exercised');
            let disposed=0;for(const texture of textures)texture.addEventListener('dispose',()=>disposed++);
            holder.remove(girl.root);girl.destroy();
            if(disposed!==textures.size)throw Error('Destroyed arm rig leaked skeleton textures');
          }
          // Missing/custom rigs retain connected procedural arms during all phases.
          holder.visible=false;vm.armMeshes.visible=true;
          for(const weapon of d.weapons){
            vm.setWeapon(weapon);await vm.gunMeshes.userData.modelReady;
            for(const progress of [0,.18,.48,.74,.9,1]){
              vm.ads=vm.sprint=0;vm.syncReload(3000,3000*(1-progress),progress>0&&progress<1);
              vm.update(0,{ads:false,moveSpeed:0});vm.gunMount.visible=false;draw();
              const n=countAlpha();minPixels=Math.min(minPixels,n);rendered++;
              if(n<40)throw Error(weapon.id+': procedural arms vanished at reload '+progress);
              vm.gunMount.visible=true;
            }
          }
          // Third-person/scope/death suppression still uses the normal root flag.
          vm.root.visible=false;draw();if(countAlpha()!==0)throw Error('Hidden first-person arms leaked into scope/death/third person');
          for(const [m,expected] of originals)if([m.depthTest,m.depthWrite,m.side,m.opacity,m.transparent].join('|')!==expected)throw Error('Shared third-person material was modified');
          window.armSnapshots=snapshots;
          renderer.setRenderTarget(null);
          return {characters:5,guns:d.weapons.length,poses,rendered,wallCases,minPixels,maxReach};
        }''')
        print('PASS first-person arms:', result, flush=True)
        if os.environ.get('ARM_SCREENSHOT'):
            import base64
            from pathlib import Path
            base_path = Path(os.environ['ARM_SCREENSHOT'])
            for shot in page.evaluate('armSnapshots'):
                base_path.with_name(base_path.stem+'-'+shot['name']+'.png').write_bytes(base64.b64decode(shot['url'].split(',')[1]))
    # Exercise the actual entry point as well: async skin replacement, real
    # weapon-switch keys, scope/third-person suppression and restored arms.
    page.goto(origin + '/')
    page.wait_for_selector('#btn-mode-solo', timeout=90000)
    page.locator('.map-btn[data-id=somme]').click()
    page.click('#btn-mode-solo')
    page.locator('#class-row .class-card').nth(1).click()
    page.locator('#weapon-row .weapon-card').filter(has_text='AR-15 Tactical').click()
    page.evaluate("()=>{__trench.app.renderer.setPixelRatio(.25);__trench.app.hud.el.name.value='Arms QA';}")
    page.click('#btn-deploy')
    page.wait_for_function('__trench.app.net?._engine?.py&&__trench.app.net.lastMe', timeout=180000)
    page.evaluate("__trench.app.net._engine.py.runPython('_host.room.match.drop_bots();_host.room.bots_on=False')")
    page.wait_for_function('__trench.app.playing&&__trench.app.net.lastMe.alive&&__trench.app.charTemplates.size>=4', timeout=90000)
    page.evaluate('()=>{const c=__trench.app.controls;c.setMobileMode(true);c.requestLock();}')
    skin_ids = page.evaluate('[...__trench.app.charTemplates.keys()].filter(id=>id.startsWith("builtin-"))')
    for skin_id in skin_ids:
        page.evaluate('id=>{__trench.app.loadout.skin=id;}', skin_id)
        page.wait_for_function('id=>{const a=__trench.app;return a.loadout.skin===id&&!a.fpArms&&a.vm.armMeshes.visible;}', arg=skin_id, polling=50)
        page.keyboard.press('2')
        page.wait_for_function('()=>{const a=__trench.app;return a.net.lastMe.slot==="secondary"&&!a.fpArms&&a.vm.armMeshes.visible;}', polling=50)
        page.wait_for_function('__trench.app.net.lastMe.equipIn<=0', polling=50)
        page.keyboard.press('1')
        page.wait_for_function('()=>{const a=__trench.app;return a.net.lastMe.w==="ar15"&&!a.fpArms&&a.vm.armMeshes.visible;}', polling=50)
        page.keyboard.press('v')
        page.wait_for_function('!__trench.app.vm.root.visible&&!__trench.app.vm.armMeshes.visible', polling=50)
        page.keyboard.press('v')
        page.wait_for_function('__trench.app.vm.root.visible&&__trench.app.vm.armMeshes.visible', polling=50)
        page.evaluate('__trench.app.controls.mouse.right=true')
        page.wait_for_function('document.body.classList.contains("scope-active")&&!__trench.app.vm.root.visible&&!__trench.app.vm.armMeshes.visible', polling=50)
        page.evaluate('__trench.app.controls.mouse.right=false')
        page.wait_for_function('__trench.app.vm.root.visible&&!__trench.app.fpArms&&__trench.app.vm.armMeshes.visible', polling=50)
        page.keyboard.press('Escape')
        page.wait_for_function('__trench.app.paused', polling=50)
        page.click('#btn-pause-resume')
        page.wait_for_function('!__trench.app.paused&&__trench.app.vm.armMeshes.visible', polling=50)
    page.evaluate("""id=>{const a=__trench.app;a.charTemplates.set('unavailable-custom-rig',a.charTemplates.get(id));a.loadout.skin='unavailable-custom-rig';}""", skin_ids[0])
    page.wait_for_function('!__trench.app.fpArms&&__trench.app.vm.armMeshes.visible', polling=50)
    page.evaluate("id=>{const a=__trench.app;a.charTemplates.delete('unavailable-custom-rig');a.loadout.skin=id;}", skin_ids[0])
    page.wait_for_function('!__trench.app.fpArms&&__trench.app.vm.armMeshes.visible', polling=50)
    page.keyboard.press('Escape')
    page.click('#btn-pause-leave')
    page.wait_for_function('!__trench.app.playing&&!__trench.app.vm.root.visible', polling=50)
    print('PASS live arms: four actual characters, authoritative primary/pistol switches, third person, scope, pause/resume, missing-skin fallback/recovery and leave cleanup', flush=True)
    assert not errors, errors
    browser.close()
