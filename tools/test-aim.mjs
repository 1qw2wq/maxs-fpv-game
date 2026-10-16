import assert from 'node:assert/strict';

export async function testAim(context, origin) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/__harness.html');
  const result = await page.evaluate(async () => {
    const T = await import('/vendor/three.module.js');
    const { ViewModel } = await import('/js/viewmodel.js');
    const { Controls } = await import('/js/controls.js');
    const { World } = await import('/js/map.js');
    const data = await (await fetch('/shared/weapons.json')).json();
    const scopes=data.weapons.filter(w=>w.scope===true).map(w=>w.id);
    if(JSON.stringify(scopes)!==JSON.stringify(['sentinel','awp','longbow']))throw new Error('Only the three uploaded scoped rifles may use the scope overlay');
    for(const id of ['smle','m95','springfield']) {
      const w=data.weapons.find(w=>w.id===id);
      if(w.scope!==false || w.zoomFov<40)throw new Error(`${id}: iron-sight rifle still behaves like an optic`);
    }
    const camera = new T.PerspectiveCamera(55, 4/3, .2, 250);
    const vm = new ViewModel(data); vm.setClass(data.classes[0]); camera.add(vm.root);
    for (const weapon of data.weapons) {
      vm.setWeapon(weapon); await vm.gunMeshes.userData.modelReady;
      const model=vm.gunMeshes.getObjectByName(`gun-model-${weapon.id}`);
      if(!model)throw new Error(`${weapon.id}: actual GLB never replaced the placeholder`);
      if(weapon.id==='longbow')model.traverse(o=>{if(o.isMesh && !o.material.map)throw new Error('Longbow lost its legacy diffuse texture');});
      vm.ads = 1; vm.boltT = vm.reloadT = -1;
      for (let frame = 0; frame < 20; frame++) {
        vm.update(1/60, { ads:true, moveSpeed:frame%2 ? 0 : 3 });
        camera.updateMatrixWorld(true);
        const point = vm.anchors.sight.getWorldPosition(new T.Vector3()).project(camera);
        if (Math.hypot(point.x, point.y) > 1e-7) throw new Error(`${weapon.id}: ADS sight drifts off center`);
      }
      if (Math.abs(vm.gunMount.position.x - vm.muzzle.position.x) > 1e-6) throw new Error(`${weapon.id}: bore offset ignored`);
      // The actual imported meshes must leave the central aiming ray clear,
      // rather than making an arbitrary empty anchor line up on paper.
      const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0,0,-1), .2, 3);
      if (ray.intersectObject(vm.gunMeshes,true).length) throw new Error(`${weapon.id}: receiver/magazine blocks the reticle`);
    }
    const world = new World(new T.Scene(),{groundY:0,boxes:[{t:'ground',x:0,y:-.5,z:0,w:100,h:1,d:100}],bounds:{minX:-40,maxX:40,minZ:-40,maxZ:40}},data.combat);
    const controls = new Controls(document.querySelector('canvas'), world, data.combat, data);
    controls.setClass(data.classes[0]);
    controls.enabled = controls.locked = true;
    const turns = [];
    for (const fov of [78, 55, 18]) {
      controls.yaw = controls.pitch = 0; controls.mouseLook.reset(); controls.lookFov = fov;
      window.dispatchEvent(new MouseEvent('mousemove',{movementX:10,movementY:5}));
      controls.updateMouseLook(1/60);
      turns.push({yaw:controls.yaw,pitch:controls.pitch});
    }
    if (!(turns[0].yaw > turns[1].yaw && turns[1].yaw > turns[2].yaw && turns[2].yaw > 0)) throw new Error('Zoom has no precision scaling');
    const expected = Math.tan(18*Math.PI/360)/Math.tan(78*Math.PI/360);
    if (Math.abs(turns[2].yaw/turns[0].yaw-expected)>1e-6 || Math.abs(turns[2].pitch/turns[0].pitch-expected)>1e-6) throw new Error('Yaw/pitch zoom scale mismatch');
    controls.mouse.right = true;
    controls.update(1/60,true,false); if(!controls.ads)throw new Error('RMB does not aim');
    controls.update(1/60,true,false,true); if(controls.ads)throw new Error('Reload does not drop sights');
    controls.update(1/60,false,false); if(controls.ads)throw new Error('Dead player aims');
    controls.enabled=false;controls.update(1/60,true,false);if(controls.ads)throw new Error('Disabled player aims');controls.enabled=true;
    const input=document.createElement('input');document.body.appendChild(input);input.focus();
    controls.update(1/60,true,false);if(controls.ads)throw new Error('Chat keeps aiming');input.remove();
    controls.locked=false;controls.update(1/60,true,false);if(controls.ads)throw new Error('Unlocked player aims');controls.locked=true;
    controls.releaseLook(); world.dispose();
    if (controls.ads || controls.mouse.right || controls._aimHeld) throw new Error('Aim sticks after release');
    return {weapons:data.weapons.length};
  });
  assert.equal(result.weapons, 15); assert.deepEqual(errors, []);
  await page.close();
  console.log('PASS: all 15 imported ADS sight centers, clear reticle rays, stationary/moving stability and FOV-scaled mouse precision');
}

export async function testLiveAim(context, origin) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('AIM PAGE:',e.stack); });
  await page.goto(origin + '/');
  await page.locator('#btn-mode-solo').waitFor({state:'visible',timeout:30000});
  await page.locator('#btn-mode-solo').click(); await page.locator('#btn-deploy').click();
  await page.waitForFunction(()=>window.__trench?.app.playing && window.__trench.app.net.lastMe?.alive,null,{timeout:45000});
  await page.evaluate(async()=>{
    const {app}=window.__trench, {World}=await import('/js/map.js');
    app.net._engine.py.runPython("_host.room.match.drop_bots();_host.room.bots_on=False\nimport combat, game\ncombat.SOLID=[];combat._build_grid();combat.GROUND_Y=combat.FLOOR_BASE=0\ntarget=_host.room.match.add_player('Aim target',None)\ntarget['team']=1-_host.room.match.players[1]['team']\ntarget['pos']=[24,0,0]\ngame._seed_hist(target,game.now_ms())");
    app.world.group.visible=false; app.renderer.setPixelRatio(.3);
    app.world=app.controls.world=new World(app.scene,{groundY:0,boxes:[{t:'ground',x:0,y:-.5,z:0,w:150,h:1,d:150}],bounds:{minX:-60,maxX:60,minZ:-60,maxZ:60}},app.data.combat);
    app.world.group.visible=false;
    app.controls.reset([0,0,0],0);
    app.net._engine.py.runPython(`_host.room.match.players[${app.myId}]['pos']=[0,0,0]`);
  });
  // The same held RMB that obtains native lock must enter ADS, not get lost.
  await page.mouse.move(500,300); await page.mouse.down({button:'right'});
  await page.waitForFunction(()=>window.__trench.app.controls.locked && window.__trench.app.controls.ads);
  await page.mouse.up({button:'right'});
  for (const mode of ['fp','tp']) for (const id of ['mp18','lewis','smle','m95','springfield','sentinel','awp','longbow']) {
    await page.evaluate(({mode,id})=>{
      const {app}=window.__trench,w=app.data.weaponById[id];app.cameraMode=mode;
      app.controls.reset([0,0,0],0);app.boltWait=false;app.nextShot=0;app.gunfx.clear();
      app.net._engine.py.runPython(`p=_host.room.match.players[${app.myId}]\np['weapon']='${id}';p['cls']='${w.class}';p['mag']=100;p['reserve']=100;p['last_shot']=0;p['reload_end']=0\ntarget['hp']=100;target['alive']=True;target['shield_until']=0;target['last_hit_ms']=game.now_ms()`);
    },{mode,id});
    await page.waitForFunction(id=>window.__trench.app.vm.weapon.id===id && window.__trench.app.net.lastMe.w===id,id);
    await page.evaluate(async()=>await window.__trench.app.vm.gunMeshes.userData.modelReady);
    await page.mouse.down({button:'right'});
    await page.evaluate(()=>{const c=window.__trench.app.controls;c.mouseLook.reset();c.yaw=c.pitch=0;});
    await page.waitForFunction(()=>{const {app}=window.__trench;return app.controls.ads && app.vm.ads>.995 && Math.abs(app.camera.fov-app.vm.weapon.zoomFov)<.15;});
    const centered = await page.evaluate(async()=>{
      const {app}=window.__trench,T=await import('/vendor/three.module.js');
      const point=app.controls.eye().addScaledVector(app.controls.aim(),24).project(app.camera);
      const scoped=app.vm.weapon.scope===true;
      if (app.vm.root.visible===scoped || app.self.root.visible || document.getElementById('scope-overlay').classList.contains('hidden')===scoped) throw new Error('Wrong ADS scope/body rendering');
      if (!document.getElementById('crosshair').classList.contains('aiming')) throw new Error('Aim reticle missing');
      return Math.hypot(point.x,point.y);
    });
    assert.ok(centered<1e-6, `${mode}/${id}: crosshair and shot ray differ (${centered})`);
    if (process.env.AIM_SCREENSHOT && mode==='fp' && id==='mp18') await page.screenshot({path:process.env.AIM_SCREENSHOT});
    // CDP sends stale absolute coordinates for extra buttons under pointer
    // lock. Dispatch through the real canvas binding without that test-only warp.
    await page.evaluate(()=>{const {app}=window.__trench;app.controls.yaw=app.controls.pitch=0;document.getElementById('game').dispatchEvent(new MouseEvent('mousedown',{button:0}));});
    try { await page.waitForFunction(()=>window.__trench.app.net._engine.py.runPython("target['hp'] < 100"),null,{timeout:8000}); }
    catch(error) { console.error('AIM HIT',mode,id,await page.evaluate(()=>{const {app}=window.__trench;return {ads:app.controls.ads,mouse:app.controls.mouse,locked:app.controls.locked,me:app.net.lastMe,eye:app.controls.eye().toArray(),aim:app.controls.aim().toArray(),engine:app.net._engine.py.runPython("str([(p['id'],p['pos'],p['team'],p['hp'],p['shot_seq']) for p in _host.room.match.players.values()])")};}));throw error; }
    assert.ok(await page.evaluate(()=>{
      const {app}=window.__trench;
      return app.controls.pitch>0 && app.camera.getWorldDirection(app.controls.aim().clone()).dot(app.controls.aim())>1-1e-8;
    }),'Real shots must lift aim while the rendered reticle and next shot ray remain aligned');
    await page.evaluate(()=>window.dispatchEvent(new MouseEvent('mouseup',{button:0})));
    await page.mouse.up({button:'right'});
    await page.waitForFunction(mode=>{const {app}=window.__trench;return !app.controls.ads && (mode!=='tp' || (!app.vm.root.visible && app.self.root.visible));},mode);
  }
  await page.waitForFunction(()=>Math.abs(window.__trench.app.camera.fov-78)<.15);
  // Reload temporarily drops ADS, then holding RMB resumes it automatically.
  await page.evaluate(()=>{const {app}=window.__trench;app.net._engine.py.runPython(`p=_host.room.match.players[${app.myId}];p['mag']=1;p['reload_end']=game.now_ms()+5000;p['reload_total']=5000`);});
  await page.mouse.down({button:'right'});
  await page.waitForFunction(()=>{const {app}=window.__trench;return app.net.lastMe.reloading && !app.controls.ads;});
  await page.evaluate(()=>window.__trench.app.net._engine.py.runPython("p['reload_end']=0"));
  await page.waitForFunction(()=>window.__trench.app.controls.ads);
  await page.mouse.up({button:'right'});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!window.__trench.app.controls.ads && !window.__trench.app.controls.mouse.right);
  assert.deepEqual(errors,[]); await page.close();
  console.log('PASS: native RMB lock/ADS, FP+TP aim-ray alignment and real authoritative hits with SMG/LMG/bolt rifles, view restoration, reload resume and Esc cleanup');
}
