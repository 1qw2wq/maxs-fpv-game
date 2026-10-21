"""Actual imported/procedural squat regression. Serve public/ on CITY_ORIGIN.
Test-only Python Playwright, CHROMIUM_EXECUTABLE; no frontend build.
"""
import os
from playwright.sync_api import sync_playwright
origin=os.environ.get('CITY_ORIGIN','http://127.0.0.1:8080')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'],headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1200,'height':800});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/__crouch_test__',lambda r:r.fulfill(content_type='text/html',body='<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><canvas></canvas>'))
    page.goto(origin+'/__crouch_test__')
    result=page.evaluate('''async()=>{
      const T=await import('/vendor/three.module.js');
      const {createGirl}=await import('/js/character.js');
      const {BUILTIN_SKINS,createExternalGirl,prepareTemplate,loadGltfFromUrl}=await import('/js/rig.js');
      const {ensureMotions}=await import('/js/motion.js');
      const data=await(await fetch('/shared/weapons.json')).json();
      data.teamById=Object.fromEntries(data.teams.map(t=>[t.id,t]));
      data.weaponsByClass=Object.fromEntries(data.classes.map(c=>[c.id,data.weapons.filter(w=>w.class===c.id)]));
      const scene=new T.Scene();scene.background=new T.Color('#667684');
      scene.add(new T.HemisphereLight(0xddeeff,0x665533,3));
      const key=new T.DirectionalLight(0xffffff,3);key.position.set(2,5,3);scene.add(key);
      const ground=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:0x48575d}));ground.rotation.x=-Math.PI/2;scene.add(ground);
      const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(1200,800);
      const camera=new T.PerspectiveCamera(40,1.5,.06,100);camera.position.set(3,1.1,2);camera.lookAt(0,.65,0);
      const specs=[{id:'procedural',girl:createGirl(data.classes[0],data.teams[0],data)}];
      for(const meta of Object.values(BUILTIN_SKINS)){
        const template=prepareTemplate((await loadGltfFromUrl(meta.file)).scene);await ensureMotions(template);
        const girl=createExternalGirl({template,meta,data,team:data.teams[0]});
        const bone=k=>girl.root.getObjectByName(meta.bones[k]?.replace(/[\\s.]+/g,'_'));
        specs.push({id:meta.id,girl,head:bone('head')});
      }
      const metrics=[];let frames=0;
      for(const spec of specs){
        const {girl,id}=spec;scene.add(girl.root);girl.setWeapon(data.weapons[0]);
        await girl.root.getObjectByName('weapon-hand').parent.userData.modelReady;
        girl.root.rotation.y=.2;girl.marker.visible=false;
        const head=spec.head||girl.headG;
        for(let i=0;i<120;i++)girl.update(1/60,{speed:0,pitch:0});
        const standing=head.getWorldPosition(new T.Vector3()).y;
        for(let i=0;i<120;i++)girl.update(1/60,{speed:0,pitch:0,crouch:true});
        const squatting=head.getWorldPosition(new T.Vector3()).y;
        metrics.push({id,standing,squatting,drop:standing-squatting});
        if(standing-squatting<.45)throw Error(id+': squat did not lower the body enough '+JSON.stringify(metrics.at(-1)));
        if(squatting<.40||squatting>1.10)throw Error(id+': crouched head does not fit combat stance '+squatting);
        // Clip-driven standing movement must transition into/out of squat safely.
        for(let i=0;i<90;i++)girl.update(1/60,{speed:4,pitch:0,crouch:false});
        for(const crouch of [true,false,true,false]){
          let before=head.getWorldPosition(new T.Vector3());
          for(let i=0;i<90;i++){
            girl.update(1/60,{speed:2.5,pitch:0,crouch});
            const after=head.getWorldPosition(new T.Vector3());
            if(after.distanceTo(before)>.18)throw Error(id+': run/squat transition snaps '+JSON.stringify({crouch,i,amount:girl.crouchAmount,after:after.toArray(),before:before.toArray(),delta:after.distanceTo(before)}));
            before.copy(after);
          }
        }
        for(let i=0;i<90;i++)girl.update(1/60,{speed:0,pitch:0,crouch:true});
        const rootPosition=girl.root.position.clone(),rootRotation=girl.root.quaternion.clone();
        for(const hz of [20,60,144])for(const speed of [0,2.5]){
          let previous=head.getWorldPosition(new T.Vector3());
          for(let f=0;f<hz*2;f++){
            girl.update(1/hz,{speed,pitch:0,crouch:true});
            const point=head.getWorldPosition(new T.Vector3());
            if(!Number.isFinite(point.y)||point.y<.35||point.y>1.12)throw Error(id+': unstable crouch '+point.y);
            if(point.distanceTo(previous)>.14)throw Error(id+': crouch gait snaps '+JSON.stringify({hz,speed,f,delta:point.distanceTo(previous),point:point.toArray(),previous:previous.toArray(),metrics}));previous.copy(point);frames++;
          }
        }
        if(girl.root.position.distanceTo(rootPosition)>1e-9||girl.root.quaternion.angleTo(rootRotation)>1e-7)throw Error('Stance moved gameplay root');
        for(let i=0;i<120;i++)girl.update(1/60,{speed:0,pitch:0});
        if(Math.abs(head.getWorldPosition(new T.Vector3()).y-standing)>.03)throw Error(id+': failed to stand back up');
        girl.update(1/60,{speed:0,pitch:0,crouch:true});
        for(let i=0;i<120;i++)girl.update(1/60,{speed:0,pitch:0,crouch:true});
        girl.root.visible=false;
      }
      specs[1].girl.root.visible=true;renderer.render(scene,camera);
      window.crouchPreview={scene,renderer,camera,specs};return {metrics,frames};
    }''')
    print(result,flush=True)
    if os.environ.get('CROUCH_SCREENSHOT'):page.screenshot(path=os.environ['CROUCH_SCREENSHOT'])
    assert not errors,errors
    browser.close()
