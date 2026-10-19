"""Actual WebGL death-presentation regression. Serve public/ on CITY_ORIGIN.
Test-only Python Playwright and CHROMIUM_EXECUTABLE; no frontend build.
"""
import os
from playwright.sync_api import sync_playwright
origin=os.environ.get('CITY_ORIGIN','http://127.0.0.1:8080')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'],headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1200,'height':800});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/__death_test__',lambda r:r.fulfill(content_type='text/html',body='<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><canvas></canvas>'))
    page.goto(origin+'/__death_test__')
    result=page.evaluate('''async()=>{
      const T=await import('/vendor/three.module.js');
      const {createGirl}=await import('/js/character.js');
      const {BUILTIN_SKINS,createExternalGirl,prepareTemplate,loadGltfFromUrl}=await import('/js/rig.js');
      const {ensureMotions}=await import('/js/motion.js');
      const d=await(await fetch('/shared/weapons.json')).json();
      d.teamById=Object.fromEntries(d.teams.map(t=>[t.id,t]));
      d.weaponsByClass=Object.fromEntries(d.classes.map(c=>[c.id,d.weapons.filter(w=>w.class===c.id)]));
      const scene=new T.Scene();scene.background=new T.Color('#667684');
      scene.add(new T.HemisphereLight(0xddeeff,0x665533,3));
      const key=new T.DirectionalLight(0xffffff,3);key.position.set(2,5,3);scene.add(key);
      const ground=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:0x48575d}));ground.rotation.x=-Math.PI/2;scene.add(ground);
      const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(1200,800);
      const camera=new T.PerspectiveCamera(45,1.5,.06,100);camera.position.set(2.5,2.8,4.0);camera.lookAt(0,.5,0);
      const girls=[createGirl(d.classes[0],d.teams[0],d)];
      for(const meta of Object.values(BUILTIN_SKINS)){
        const template=prepareTemplate((await loadGltfFromUrl(meta.file)).scene);
        await ensureMotions(template);
        girls.push(createExternalGirl({template,meta,data:d,team:d.teams[0]}));
      }
      let cases=0,minimum=Infinity;const materials=new Map();
      for(const girl of girls){
        scene.add(girl.root);girl.setWeapon(d.weapons[0]);
        await girl.root.getObjectByName('weapon-hand').parent.userData.modelReady;
        girl.root.traverse(o=>{if(o.material)for(const m of(Array.isArray(o.material)?o.material:[o.material]))materials.set(m,m.opacity);});
        for(const crouch of [false,true])for(const direction of [0,Math.PI/2,Math.PI,-Math.PI/2]){
          girl.setAlive(true);girl.root.position.set(0,0,0);girl.root.rotation.y=.3;
          const pose={speed:crouch?0:5,crouch,sprint:!crouch,pitch:15};
          for(let i=0;i<30;i++)girl.update(1/60,pose);
          const pos=girl.root.position.clone(),rot=girl.root.quaternion.clone();
          girl.setAlive(false,{direction,headshot:crouch,side:crouch?-1:1});
          for(let i=0;i<80;i++){
            girl.setAlive(false,{direction:99});girl.update(1/60,{speed:9,reloading:true});
            if(!girl.root.visible||girl.marker.visible)throw Error('Corpse vanished or kept faction marker');
            if(girl.root.position.distanceTo(pos)>1e-10||girl.root.quaternion.angleTo(rot)>1e-7)throw Error('Death moved gameplay root');
            if([5,25,50,75].includes(i)){
              scene.updateMatrixWorld(true);const inverse=girl.root.matrixWorld.clone().invert();
              girl.root.traverse(mesh=>{
                if(!mesh.isMesh||!mesh.geometry?.attributes.position||mesh===girl.shadow||mesh===girl.marker)return;
                if(mesh.isSkinnedMesh)mesh.skeleton.update();
                const count=mesh.geometry.attributes.position.count,v=new T.Vector3();
                for(let j=0;j<Math.min(384,count);j++){
                  mesh.getVertexPosition(Math.floor(j*(count-1)/Math.max(1,Math.min(384,count)-1)),v).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
                  if(!Number.isFinite(v.y))throw Error('Non-finite corpse vertices');
                  minimum=Math.min(minimum,v.y);
                  if(v.y<-.08)throw Error('Body penetrates support floor '+JSON.stringify({y:v.y,case:cases,i,name:mesh.name,type:mesh.geometry.type,visible:mesh.visible,parents:(()=>{let a=[];for(let n=mesh;n;n=n.parent)a.push([n.name,n.visible]);return a;})()}));
                }
              });
            }
          }
          if(girl.deathState.elapsed<1.3)throw Error('Repeated dead snapshots reset animation');
          const pivot=girl.root.getObjectByName('death-presentation');
          if(pivot.quaternion.angleTo(new T.Quaternion())<1)throw Error('Body never collapsed');
          const settled=pivot.matrix.elements.slice();girl.update(1,{speed:0});
          if(settled.some((x,i)=>Math.abs(x-pivot.matrix.elements[i])>1e-9))throw Error('Settled corpse keeps moving');
          girl.update(3,{speed:0});if(girl.root.visible)throw Error('Corpse lifetime not bounded');
          girl.setAlive(true);girl.update(0,{speed:0,pitch:0});
          if(!girl.root.visible||girl.deathState.visible||pivot.quaternion.angleTo(new T.Quaternion())>1e-7)throw Error('Respawn kept death transforms');
          cases++;
        }
        girl.root.visible=false;
      }
      for(const [m,opacity] of materials)if(m.opacity!==opacity)throw Error('Death mutated shared material opacity');
      // Leave one real imported corpse in view for optional visual inspection.
      const preview=girls[1];preview.setAlive(true);preview.update(0,{speed:0});preview.setAlive(false,{direction:.5,headshot:true});
      for(let i=0;i<65;i++)preview.update(1/60,{speed:0});
      renderer.render(scene,camera);window.deathPreview={scene,camera,renderer,girls};
      return {cases,minimum};
    }''')
    print('PASS: actual rigs',result,flush=True)
    if os.environ.get('DEATH_SCREENSHOT'):page.screenshot(path=os.environ['DEATH_SCREENSHOT'])
    # HUD security, multikill feedback, responsive sizing and reduced motion.
    page.evaluate('''async()=>{
      const html=await(await fetch('/index.html')).text();document.body.innerHTML=new DOMParser().parseFromString(html,'text/html').body.innerHTML;
      await new Promise(resolve=>{const css=document.createElement('link');css.rel='stylesheet';css.href='/css/style.css';css.onload=resolve;document.head.appendChild(css);});
      const d=await(await fetch('/shared/weapons.json')).json();d.secondaries=d.weapons.filter(w=>w.slot==='secondary');
      const {Hud}=await import('/js/hud.js');window.deathHud=new Hud(d);deathHud.screen('game');
      deathHud.confirmKill('<img src=x onerror=alert(1)>',true);
      if(document.querySelector('#kill-victim img'))throw Error('Unescaped victim name');
      deathHud.confirmKill('Second',false);
      if(!document.querySelector('#kill-streak').textContent.includes('2'))throw Error('Missing multi-kill chain');
      if(!document.querySelector('#hitmarker').classList.contains('kill'))throw Error('No authoritative kill marker');
    }''')
    for width,height in [(390,844),(844,390),(1200,800)]:
        page.set_viewport_size({'width':width,'height':height})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    page.emulate_media(reduced_motion='reduce')
    assert page.evaluate('getComputedStyle(document.querySelector("#kill-confirm")).animationName')=='kill-confirm-reduced'
    page.evaluate('deathHud.resetCombatFeedback()')
    assert not page.locator('#kill-confirm').evaluate('(e)=>e.classList.contains("show")')
    assert not errors,errors
    print('PASS: kill feedback, safe names, multi-kill, responsive HUD, reduced motion, cleanup; no page errors',flush=True)
    browser.close()
