import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function testGasAssets(context, origin) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin+'/__harness.html');
  const result = await page.evaluate(async capture => {
    const T = await import('/vendor/three.module.js');
    const {createGasMask,preloadGasMask,disposeGasMask,updateAvatarMask} = await import('/js/gas-mask.js');
    const {buildSmokeCloud,updateSmokeCloud} = await import('/js/smoke.js');
    const {loadConfig} = await import('/js/config.js');
    const {createGirl} = await import('/js/character.js');
    const {loadGltfFromUrl,prepareTemplate,createExternalGirl,BUILTIN_SKINS} = await import('/js/rig.js');
    const data = await loadConfig(); await preloadGasMask();
    const mask = createGasMask(); await mask.userData.modelReady;
    if(!mask.userData.imported)throw Error('Uploaded mask was not loaded');
    const size = new T.Box3().setFromObject(mask).getSize(new T.Vector3());
    if(Math.abs(size.y-.32)>1e-6||size.z>.2)throw Error('Mask orientation/scale is wrong');
    const renderer = new T.WebGLRenderer({canvas:document.getElementById('game'),preserveDrawingBuffer:true});
    renderer.setSize(640,640);
    const scene = new T.Scene();scene.background=new T.Color(0x17212a);
    scene.add(new T.HemisphereLight(0xffffff,0x92958d,3));
    const light = new T.DirectionalLight(0xffffff,3);light.position.set(1,3,4);scene.add(light);
    const camera = new T.PerspectiveCamera(36,1,.01,100);
    const pixels = new Uint8Array(640*640*4), blank = new Uint8Array(pixels.length);
    window.maskShots=[];const cases=[];
    const girls=[['fallback',createGirl(data.classById.assault,data.teamById[0],data)]];
    for(const meta of Object.values(BUILTIN_SKINS)){
      const gltf=await loadGltfFromUrl(meta.file),template=prepareTemplate(gltf.scene);
      girls.push([meta.id,createExternalGirl({template,meta,data,team:data.teamById[0]})]);
    }
    for(const [name,girl] of girls){
      scene.add(girl.root);
      girl.update(.016,{speed:0,pitch:0,crouch:false});updateAvatarMask(girl,true,0);
      await girl.gasMask.userData.modelReady;
      const pos=girl.gasMask.position.clone();
      if(pos.y<1.15||pos.y>1.75||Math.abs(pos.x)>.16||pos.z<-.05||pos.z>.4)throw Error(name+': mask is not at face '+pos.toArray());
      camera.position.set(0,pos.y,1.0);camera.lookAt(0,pos.y,.05);
      renderer.render(scene,camera);
      renderer.getContext().readPixels(0,0,640,640,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixels);
      if(capture)maskShots.push({name,data:renderer.domElement.toDataURL()});
      girl.gasMask.visible=false;renderer.render(scene,camera);
      renderer.getContext().readPixels(0,0,640,640,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,blank);
      let changed=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-blank[i])+Math.abs(pixels[i+1]-blank[i+1])+Math.abs(pixels[i+2]-blank[i+2])>20)changed++;
      if(changed<1000)throw Error(name+': uploaded mask is hidden/clipped '+changed);
      for(const pitch of [-60,0,60]){
        for(let i=0;i<25;i++)girl.update(.016,{speed:0,pitch,crouch:true});
        updateAvatarMask(girl,true,pitch);
        if(!girl.gasMask.position.toArray().every(Number.isFinite))throw Error('Invalid crouched mask pose');
        if(girl.gasMask.position.y>=pos.y-.1)throw Error(name+': mask does not follow crouch');
      }
      cases.push({name,pixels:changed,head:pos.toArray()});
      updateAvatarMask(girl,false);if(girl.gasMask.visible)throw Error('Mask stays visible when removed');
      disposeGasMask(girl.gasMask);girl.destroy();
    }
    const gas=buildSmokeCloud({k:'gas',eid:82,p:[0,.1,0],r:6.5,dur:12000});
    gas.dur=12000;scene.add(gas.obj);updateSmokeCloud(gas,1400);
    camera.position.set(12,7,12);camera.lookAt(0,1,0);renderer.render(scene,camera);
    renderer.getContext().readPixels(0,0,640,640,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixels);
    let yellow=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>65&&pixels[i+1]>60&&pixels[i+2]<pixels[i+1]*.82&&pixels[i]>pixels[i+1]*.9)yellow++;
    if(yellow<5000)throw Error('Poison smoke is not visibly yellow '+yellow);
    if(capture)maskShots.push({name:'yellow-cloud',data:renderer.domElement.toDataURL()});
    if(gas.puffs.length!==36)throw Error('Unbounded gas puff count');
    updateSmokeCloud(gas,12001);if(gas.puffs.some(p=>p.sprite.material.opacity!==0))throw Error('Gas does not expire');
    gas.obj.removeFromParent();for(const p of gas.puffs)p.sprite.material.dispose();
    const siblings=Array.from({length:32},()=>createGasMask());await Promise.all(siblings.map(m=>m.userData.modelReady));
    const geometries=new Set();let disposed=0;
    for(const m of siblings)m.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);o.geometry.addEventListener('dispose',()=>disposed++);}});
    for(const m of siblings)disposeGasMask(m);
    if(geometries.size!==1||disposed)throw Error('Mask duplicates/disposes shared geometry');
    const pending=createGasMask();disposeGasMask(pending);await pending.userData.modelReady;
    if(pending.children.length||pending.parent)throw Error('Disposed mask resurrected after asynchronous load');
    const downloads=performance.getEntriesByType('resource').filter(r=>r.name.endsWith('/gas_mask.glb')).length;
    if(downloads!==1)throw Error('Mask downloaded more than once: '+downloads);
    disposeGasMask(mask);renderer.dispose();return {cases,yellow,sharedGeometries:geometries.size};
  }, !!process.env.MASK_MODEL_SHOTS);
  if(process.env.MASK_MODEL_SHOTS)for(const shot of await page.evaluate(()=>maskShots))await writeFile(`${process.env.MASK_MODEL_SHOTS}-${shot.name}.png`,Buffer.from(shot.data.split(',')[1],'base64'));
  assert.deepEqual(errors,[]);await page.close();
  const failed=await context.newPage();await failed.route('**/gas_mask.glb',r=>r.abort());await failed.goto(origin+'/__harness.html');
  assert(await failed.evaluate(async()=>{const {createGasMask,disposeGasMask}=await import('/js/gas-mask.js');const mask=createGasMask();const ok=await mask.userData.modelReady;let meshes=0;mask.traverse(o=>{if(o.isMesh)meshes++;});disposeGasMask(mask);return !ok&&meshes>=4;}));
  await failed.close();console.log('PASS: uploaded gas mask on fallback + all four built-in rigs, crouch/pitch following, visible yellow gas, expiry, shared resources and failed/canceled loading',JSON.stringify(result));
}

export async function testLiveGas(page) {
  await page.evaluate(async()=>{
    const a=__trench.app,T=await import('/vendor/three.module.js'),{World}=await import('/js/map.js');
    await (await import('/js/grenade-models.js')).preloadGrenadeModels();
    await (await import('/js/gas-mask.js')).preloadGasMask();
    a.world.group.visible=false;a.renderer.shadowMap.enabled=false;a.renderer.setPixelRatio(.35);
    a.world=a.controls.world=new World(a.scene,{boxes:[{t:'ground',x:0,y:-.5,z:0,w:120,h:1,d:120}],groundY:0,bounds:{minX:-50,maxX:50,minZ:-50,maxZ:50}},a.data.combat);
    a.net._engine.py.runPython(`import combat\n_host.room.match.drop_bots()\n_host.room.bots_on=False\ncombat.SOLID=[]\ncombat._build_grid()\ncombat.GROUND_BOX=None\ncombat.GROUND_Y=combat.FLOOR_BASE=0\ncombat.BOUNDS=dict(minX=-50,maxX=50,minZ=-50,maxZ=50)\np=_host.room.match.players[${a.myId}]\np.update(pos=[0,0,0],hp=100,grenades=2,mask_on=False,mask_ready=0,gas_until=0,shield_until=0,shield_cancelled=True)`);
    a.controls.pos.set(0,0,0);a.controls.vel.set(0,0,0);a.controls.vy=0;a.controls.eyeGround=0;a.controls.pitch=-80;a.controls.yaw=0;a.cameraMode='fp';a.grenadeKind='frag';
  });
  await page.waitForFunction(()=>__trench.app.net.lastMe.hp===100&&!__trench.app.net.lastMe.mask);
  await page.keyboard.press('KeyM');await page.waitForFunction(()=>__trench.app.net.lastMe.maskProtected===1);
  await page.locator('#gas-mask-view').waitFor({state:'visible'});
  for(let i=0;i<4;i++)await page.keyboard.press('KeyB');
  assert.equal(await page.evaluate(()=>__trench.app.grenadeKind),'gas');
  await page.keyboard.down('KeyG');await page.waitForFunction(()=>__trench.app.charge?.kind==='gas');await page.keyboard.up('KeyG');
  await page.waitForFunction(()=>__trench.app.net.lastMe.gas===1&&__trench.app.effects.some(e=>e.kind==='gas'&&e.landed&&e.proj?.userData.imported));
  await page.waitForFunction(()=>__trench.app.smokeOn&&__trench.app.world.scene.fog.color.r>__trench.app.world.scene.fog.color.b);
  const hp=await page.evaluate(()=>__trench.app.net.lastMe.hp);
  const protectedTick=await page.evaluate(()=>__trench.app.net.lastMe.tick);
  await page.waitForFunction(t=>__trench.app.net.lastMe.tick>t+5,protectedTick);
  assert.equal(await page.evaluate(()=>__trench.app.net.lastMe.hp),hp);
  await page.keyboard.press('KeyM');await page.waitForFunction(()=>__trench.app.net.lastMe.mask===0&&__trench.app.net.lastMe.hp<100);
  await page.locator('#gas-mask-view').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.getElementById('mask-status').classList.contains('danger'));
  await page.keyboard.press('KeyM');await page.waitForFunction(()=>__trench.app.net.lastMe.maskProtected===1);
  const sealedHp=await page.evaluate(()=>__trench.app.net.lastMe.hp), tick=await page.evaluate(()=>__trench.app.net.lastMe.tick);
  await page.waitForFunction(t=>__trench.app.net.lastMe.tick>t+15,tick);
  assert.equal(await page.evaluate(()=>__trench.app.net.lastMe.hp),sealedHp);
  await page.keyboard.press('KeyV');await page.waitForFunction(()=>__trench.app.self?.gasMask?.visible&&__trench.app.self.gasMask.userData.imported);
  await page.locator('#gas-mask-view').waitFor({state:'hidden'});
  await page.keyboard.press('KeyV');await page.waitForFunction(()=>!document.getElementById('gas-mask-view').classList.contains('hidden'));
  // Aged welcome effect: retain canister and clock, never replay a fresh fuse.
  await page.evaluate(()=>__trench.app.net._dispatch({t:'fx',fx:{k:'gas',eid:99003,p:[20,.091,0],from:[0,1.58,0],path:[[0,0,1.58,0],[1800,20,.091,0]],delay:1800,dur:12000,age:3800,r:6.5}}));
  await page.waitForFunction(()=>{const e=__trench.app.effects.find(e=>e.eid===99003);return e?.landed&&e.proj?.userData.imported&&e.proj.visible&&e.density>0&&!e.playDetonation;});
  // Removing/expiring the authoritative cloud stops damage; visual fog also restores.
  await page.evaluate(()=>{const a=__trench.app;a.net._engine.py.runPython('_host.room.match.effects=[]');for(const e of a.effects){e.persist=false;e.start=performance.now()-e.dur-1000;}a.net.mask(false);});
  await page.waitForFunction(()=>!__trench.app.net.lastMe.gas&&!__trench.app.smokeOn&&!__trench.app.effects.length);
  assert.equal(await page.locator('#mask-status').evaluate(el=>el.classList.contains('danger')),false);
  console.log('PASS: real Solo/Pyodide native M/B/G/V controls, self-poison, sealed protection/removal/reseal, visor, third-person uploaded mask, yellow fog, aged canister and expiry cleanup');
}

export async function testMultiplayerGas(host, guest) {
  // Use actual guest commands and the room transport, not injected client damage.
  for(const page of [host,guest])await page.evaluate(async()=>{await (await import('/js/grenade-models.js')).preloadGrenadeModels();await (await import('/js/gas-mask.js')).preloadGasMask();});
  await guest.evaluate(()=>__trench.app.net.mask(true));
  await guest.waitForFunction(()=>__trench.app.net.lastMe.maskProtected===1);
  const id=await guest.evaluate(()=>__trench.app.myId);
  await host.waitForFunction(id=>__trench.app.net.lastState.ps.some(p=>p.i===id&&p.mk===1),id);
  const hp=await guest.evaluate(()=>__trench.app.net.lastMe.hp);
  await guest.evaluate(async()=>{const T=await import('/vendor/three.module.js');__trench.app.net.grenade(new T.Vector3(0,-1,0),'gas',0);});
  await host.waitForFunction(id=>__trench.app.effects.some(e=>e.kind==='gas'&&e.landed),id);
  try { await guest.waitForFunction(()=>__trench.app.net.lastMe.gas===1&&__trench.app.effects.some(e=>e.kind==='gas'&&e.landed),null,{timeout:6000}); }
  catch(error) {
    console.log('NETWORK GAS DEBUG',await host.evaluate(id=>{const a=__trench.app;return {status:a.net.status(),python:a.net._engine.py.runPython(`import json\nm=_host.room.match\np=m.players[${id}]\njson.dumps(dict(p={k:p[k] for k in ['id','pos','hp','alive','mask_on','mask_ready','gas_until','shield_until']},now=__import__('game').now_ms(),effects=m.effects))`)};},id));throw error;
  }
  assert.equal(await guest.evaluate(()=>__trench.app.net.lastMe.hp),hp);
  await guest.evaluate(()=>__trench.app.net.mask(false));
  await guest.waitForFunction(hp=>__trench.app.net.lastMe.hp<hp&&!__trench.app.net.lastMe.maskProtected,hp);
  await host.waitForFunction(id=>__trench.app.net.lastState.ps.some(p=>p.i===id&&p.mk===0),id);
  await guest.evaluate(()=>__trench.app.net.mask(true));await guest.waitForFunction(()=>__trench.app.net.lastMe.maskProtected===1);
  const sealed=await guest.evaluate(()=>({hp:__trench.app.net.lastMe.hp,tick:__trench.app.net.lastMe.tick}));
  await guest.waitForFunction(t=>__trench.app.net.lastMe.tick>t+15,sealed.tick);
  assert.equal(await guest.evaluate(()=>__trench.app.net.lastMe.hp),sealed.hp);
  await host.waitForFunction(id=>__trench.app.remotes.get(id)?.gasMask?.userData.imported,id);
  console.log('PASS: actual multiplayer guest gas throw and mask state, host/guest yellow FX, self-damage only when unsealed, reseal stops damage, remote uploaded mask');
}
