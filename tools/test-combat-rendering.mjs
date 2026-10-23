// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(resolve(process.env.TEST_DEPS||'/tmp/maxs-fpv-browser-tests','package.json'));
const {chromium:pw}=require('playwright-core');
const {default:chromium,inflate,setupLambdaEnvironment}=await import(require.resolve('@sparticuz/chromium'));
if(process.platform==='linux'&&!process.env.CHROMIUM_EXECUTABLE){const libs=await inflate(fileURLToPath(new URL('../bin/al2023.tar.br',pathToFileURL(require.resolve('@sparticuz/chromium')))));setupLambdaEnvironment(resolve(libs,'lib'));}
const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.svg':'image/svg+xml','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
 const path=decodeURIComponent(new URL(req.url,'http://test').pathname);
 if(path==='/__harness.html'){res.setHeader('Content-Type','text/html');res.end('<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/"}}</script><canvas id="game"></canvas>');return;}
 const local=/^\/api\/(health|rooms|characters)$/.test(path)?path+'.json':path;
 const file=resolve(root,'.'+(local==='/'?'/index.html':local));
 if(!file.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await pw.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('disable-web-security')&&a!=='--single-process'),headless:true});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1100,height:750}});
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/__harness.html');
 const arms=await p.evaluate(async()=>{
  const T=await import('/vendor/three.module.js'),{loadConfig}=await import('/js/config.js');
  const {ViewModel}=await import('/js/viewmodel.js'),{gloveWrist}=await import('/js/handpose.js');
  const {FirstPersonPass}=await import('/js/first-person-pass.js');
  const d=await loadConfig(),scene=new T.Scene(),camera=new T.PerspectiveCamera(78,4/3,.06,100);
  scene.add(camera,new T.HemisphereLight(0xffffff,0x667788,3));
  const vm=new ViewModel(d);camera.add(vm.root);const pass=new FirstPersonPass();
  const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(640,480);const target=new T.WebGLRenderTarget(160,120),pixels=new Uint8Array(160*120*4);
  renderer.setClearColor(0x000000,0);
  let count=0,minPixels=Infinity;const end=new T.Vector3(),wrist=new T.Vector3();
  for(const cls of d.classes){
   vm.setClass(cls);
   for(const weapon of d.weapons){
    vm.setWeapon(weapon);await vm.gunMeshes.userData.modelReady;
    for(const aspect of [4/3,9/16])for(const phase of ['hip','ads','recoil','sprint','reload-start','reload-service','reload-seat','reload-recover']){
     camera.aspect=aspect;camera.updateProjectionMatrix();
     const progress={'reload-start':.18,'reload-service':.48,'reload-seat':.74,'reload-recover':.9}[phase];
     vm.recoil=vm.recoilRot=0;vm.ads=phase==='ads'?1:0;vm.sprint=phase==='sprint'?1:0;
     vm.syncReload(3000,progress===undefined?0:3000*(1-progress),progress!==undefined);
     if(phase==='recoil')vm.kick(1);
     vm.update(0,{ads:phase==='ads',sprinting:phase==='sprint',moveSpeed:2,viewFov:78,viewAspect:aspect});
     for(const rig of vm.armRigs){
      for(const segment of [rig.upper,rig.fore])if(segment.geometry.parameters.openEnded)throw Error('Open arm tube');
      wrist.copy(gloveWrist(rig.palm.position,rig.palm.quaternion));
      end.set(0,rig.fore.scale.y/2,0).applyQuaternion(rig.fore.quaternion).add(rig.fore.position);
      if(end.distanceTo(wrist)>1e-6||rig.elbowJoint.position.distanceTo(rig.elbow)>1e-6)throw Error('Disconnected wrist/elbow');
      if(!Number.isFinite(rig.fore.scale.y)||rig.fore.scale.y>.9)throw Error('Exploded arm');
     }
     // Hands must remain visible without the weapon hiding their defects.
     vm.gunMount.visible=false;renderer.setRenderTarget(target);pass.render(renderer,scene,camera,vm.root);
     renderer.readRenderTargetPixels(target,0,0,160,120,pixels);vm.gunMount.visible=true;
     let n=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>10)n++;minPixels=Math.min(n,minPixels);
     if(n<15)throw Error(`${cls.id}/${weapon.id}/${aspect}/${phase}: only ${n} hand pixels; ${vm.armRigs.map(r=>r.palm.position.toArray().join(',')).join(';')}`);
     count++;
    }
   }
  }
  vm.setClass(d.classes[0]);vm.setWeapon(d.weaponById.mp18);await vm.gunMeshes.userData.modelReady;
  vm.syncReload(3000,0,false);vm.ads=vm.sprint=vm.recoil=0;vm.update(0,{viewFov:78});camera.aspect=4/3;camera.updateProjectionMatrix();
  renderer.setRenderTarget(null);pass.render(renderer,scene,camera,vm.root);
  window.armPreview=renderer.domElement.toDataURL();renderer.dispose();return {count,minPixels};
 });
 if(process.env.COMBAT_SCREENSHOTS){const {writeFile}=await import('node:fs/promises');await writeFile('/tmp/closed-fp-arms.png',Buffer.from((await p.evaluate(()=>armPreview)).split(',')[1],'base64'));}
 console.log('PASS: all classes/weapons, portrait/landscape, ADS/recoil/sprint/reload: closed visible arms and connected joints',arms);await p.close();
 const live=await context.newPage();live.on('pageerror',e=>errors.push(e.message));await live.goto(origin+'/');
 await live.waitForFunction(()=>window.__trench?.app.keySettings,null,{timeout:90000});await live.locator('#boot').waitFor({state:'hidden'});
 await live.evaluate(async()=>{(await import('/js/i18n.js')).setLang('en');__trench.app.renderer.setPixelRatio(.4);__trench.app.renderer.shadowMap.enabled=false;});
 let release;const gate=new Promise(r=>release=r);
 await live.route('**/models/maps/cs_italy.glb',async route=>{await gate;await route.continue();});
 await live.click('.map-btn[data-id=italy]');await live.click('#bot-count button[data-n="0"]');await live.click('#btn-mode-solo');await live.click('#btn-deploy');
 await live.waitForFunction(()=>__trench.app.mapLoading&&__trench.app.net?.lastMe?.alive,null,{timeout:180000});
 // Deliberately deliver live poison during Italy's asynchronous GLB load.
 const queuedAt=await live.evaluate(()=>{
  const a=__trench.app;
  const pos=JSON.parse(a.net._engine.py.runPython(`__import__('json').dumps(_host.room.match.players[${a.myId}]['pos'])`));
  a.net._dispatch({t:'fx',fx:{k:'gas',eid:99001,p:pos,r:6.5,dur:14000,age:2000}});
  a.net._dispatch({t:'fx',fx:{k:'gas',eid:99002,p:pos,r:6.5,dur:1000,age:2000}}); // already expired
  a.net._dispatch({t:'fx',fx:{k:'heal',eid:99003,p:pos,r:3,dur:600000,persist:true,team:0}});
  a.net._dispatch({t:'fx',fx:{k:'remove',eid:99003}});
  return performance.now();
 });
 release();
 await live.waitForFunction(()=>__trench.app.playing&&__trench.app.mapId==='italy',null,{timeout:180000});
 await live.waitForFunction(()=>__trench.app.effects.some(e=>e.eid===99001&&e.density>0));
 const gas=await live.evaluate(queuedAt=>{
  const a=__trench.app,e=a.effects.find(e=>e.eid===99001);
  if(a.effects.some(e=>[99002,99003].includes(e.eid)))throw Error('Expired/removed effect resurrected after decode');
  const age=performance.now()-e.start,expected=2000+performance.now()-queuedAt;
  if(Math.abs(age-expected)>150)throw Error('Gas lifetime restarted on decode');
  if(!e.obj.visible||e.puffs.length!==36)throw Error('Yellow cloud lost after Italy decode');
  return {age,expected,position:e.obj.position.toArray()};
 },queuedAt);
 // Compare actual pixels on the imported Italy scene, not just color constants.
 const pixels=await live.evaluate(async()=>{
  const a=__trench.app,T=await import('/vendor/three.module.js');a.paused=true;
  const e=a.effects.find(e=>e.eid===99001);e.obj.position.copy(a.controls.pos);e.start=performance.now()-2000;
  const {updateSmokeCloud}=await import('/js/smoke.js');updateSmokeCloud(e,2000);
  const c=new T.PerspectiveCamera(70,4/3,.06,100);c.position.copy(e.obj.position).add(new T.Vector3(0,1.6,5));c.lookAt(e.obj.position.clone().add(new T.Vector3(0,1,0)));
  const target=new T.WebGLRenderTarget(320,240),on=new Uint8Array(320*240*4),off=new Uint8Array(on.length);
  const r=a.renderer;r.setRenderTarget(target);e.obj.visible=false;r.render(a.scene,c);r.readRenderTargetPixels(target,0,0,320,240,off);
  e.obj.visible=true;r.render(a.scene,c);r.readRenderTargetPixels(target,0,0,320,240,on);r.setRenderTarget(null);target.dispose();
  let changed=0,yellow=0;for(let i=0;i<on.length;i+=4){if(Math.abs(on[i]-off[i])+Math.abs(on[i+1]-off[i+1])+Math.abs(on[i+2]-off[i+2])>15){changed++;if(on[i]>on[i+2]*1.2&&on[i+1]>on[i+2]*1.2)yellow++;}}
  return {changed,yellow};
 });
 assert(pixels.changed>500&&pixels.yellow>500,JSON.stringify(pixels));
 assert(await live.evaluate(()=>!__trench.app.fpArms&&__trench.app.vm.armMeshes.visible),'Gameplay must not borrow open character sleeves');
 if(process.env.COMBAT_SCREENSHOTS)await live.screenshot({path:'/tmp/italy-gas.png'});
 console.log('PASS: actual Italy GLB decode, queued live poison survives, age preserved, expired/removed FX absent, yellow pixels on Italy',gas,pixels);
 // Actual skin arrivals cannot replace or reselect the camera arm pair.
 await live.evaluate(()=>{const a=__trench.app;for(const e of a.effects){e.start=performance.now()-e.dur-100;}a.paused=false;a.controls.setMobileMode(true);a.controls.requestLock();});
 await live.waitForFunction(()=>__trench.app.charTemplates.size>=4,null,{timeout:90000});
 const pair=await live.evaluate(()=>__trench.app.vm.armMeshes.uuid);
 for(const id of await live.evaluate(()=>[...__trench.app.charTemplates.keys()].filter(k=>k.startsWith('builtin-')))){
  await live.evaluate(id=>{__trench.app.loadout.skin=id;},id);
  await live.waitForFunction(({id,pair})=>{const a=__trench.app;return a.loadout.skin===id&&!a.fpArms&&a.vm.armMeshes.uuid===pair&&a.vm.armMeshes.visible;},{id,pair});
 }
 await live.keyboard.press('Digit2');await live.waitForFunction(()=>__trench.app.net.lastMe.slot==='secondary'&&__trench.app.vm.armMeshes.visible);
 await live.waitForFunction(()=>__trench.app.net.lastMe.equipIn<=0);
 await live.keyboard.press('Digit1');await live.waitForFunction(()=>__trench.app.net.lastMe.slot==='primary'&&__trench.app.vm.armMeshes.visible);
 await live.keyboard.press('KeyV');await live.waitForFunction(()=>!__trench.app.vm.root.visible&&!__trench.app.vm.armMeshes.visible);
 await live.keyboard.press('KeyV');await live.waitForFunction(()=>__trench.app.vm.root.visible&&__trench.app.vm.armMeshes.visible);
 await live.evaluate(()=>{const a=__trench.app;a.net._engine.py.runPython(`p=_host.room.match.players[${a.myId}]
p.update(cls='medic',weapon='ar15',primary='ar15',mag=30,reload_end=0,equip_until=0)`);});
 await live.waitForFunction(()=>__trench.app.vmWeapon==='ar15');
 await live.evaluate(()=>__trench.app.controls.mouse.right=true);
 await live.waitForFunction(()=>document.body.classList.contains('scope-active')&&!__trench.app.vm.root.visible&&!__trench.app.vm.armMeshes.visible);
 await live.evaluate(()=>__trench.app.controls.mouse.right=false);
 await live.waitForFunction(()=>__trench.app.vm.root.visible&&__trench.app.vm.armMeshes.visible);
 console.log('PASS: four real character skins keep one closed arm pair; acknowledged 1/2, third person and scoped ADS hide/restore it correctly');
 await live.close();await context.close();assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
