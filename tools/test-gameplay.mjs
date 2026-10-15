import assert from 'node:assert/strict';

export async function testGameplay(context,origin) {
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/__harness.html');
  const result=await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js');
    const {Controls}=await import('/js/controls.js'),{World}=await import('/js/map.js');
    const {Tutorial,TUTORIAL_STEPS}=await import('/js/tutorial.js');
    const {fixImportedMaterials,updateContactShadow}=await import('/js/lighting.js');
    const data=await(await fetch('/shared/weapons.json')).json(),combat=data.combat;
    const world=new World(new T.Scene(),{groundY:0,boxes:[{t:'ground',x:0,y:-.5,z:0,w:200,h:1,d:200}],bounds:{minX:-90,maxX:90,minZ:-90,maxZ:90}},combat);
    const create=()=>{const c=new Controls(document.getElementById('game'),world,combat);c.enabled=true;c.setClass(data.classes[0]);c.reset([0,0,0],0);return c;};
    let checks=0;
    const runs=[];
    for(const hz of [30,60,144]) {
      const c=create();c.keys.add('KeyW');for(let i=0;i<hz;i++)c.update(1/hz,true,false);
      const velocity=c.vel.x,range=c.pos.x;
      c.keys.clear();for(let i=0;i<Math.ceil(hz*.4);i++)c.update(1/hz,true,false);
      if(c.moveSpeed>.02)throw new Error(`${hz} Hz: sliding after release`);
      runs.push({velocity,range});checks++;
    }
    if(Math.max(...runs.map(r=>r.velocity))-Math.min(...runs.map(r=>r.velocity))>1e-4)throw new Error('Frame-dependent acceleration');
    if(Math.max(...runs.map(r=>r.range))-Math.min(...runs.map(r=>r.range))>.1)throw new Error('Frame-dependent movement distance');
    const c=create();c.keys.add('Space');let jumps=0,grounded=true;
    for(let i=0;i<240;i++){c.update(1/60,true,false);if(grounded&&!c.grounded)jumps++;grounded=c.grounded;}
    if(jumps!==1||!c.grounded)throw new Error('Held jump auto-bounces');checks++;
    c.keys.clear();c.update(1/60,true,false);c.pos.y=.03;c.grounded=false;c._coyote=0;c.vy=-1;c.keys.add('Space');
    c.update(1/60,true,false);c.update(1/60,true,false);c.update(1/60,true,false);
    if(c.vy<=0)throw new Error('Buffered landing jump lost');checks++;
    c.reset([0,0,0],0);c.grounded=false;c._coyote=.08;c.keys.add('Space');c.update(1/60,true,false);
    if(c.vy<=0)throw new Error('Coyote jump lost');checks++;
    c.keys.add('KeyW');c.update(.05,true,false);c.enabled=false;c.update(.05,true,false);
    if(c.moveSpeed||c.vel.length())throw new Error('Disabled player retains velocity');checks++;
    const chat=document.createElement('input');document.body.append(chat);chat.focus();c.enabled=true;
    for(let i=0;i<30;i++)c.update(1/60,true,false);if(c.moveSpeed)throw new Error('Chat input moves the character');chat.blur();chat.remove();checks++;

    const tutorial=new Tutorial({hud:{toast(){}},onFinish:()=>{}});tutorial.start();
    const ctx={speed:3,yaw:0,ads:false,crouch:false,airborne:false,objectivesOwned:0};
    tutorial.update(1.3,ctx);tutorial.update(.016,ctx);ctx.yaw=75;tutorial.update(.016,ctx);
    tutorial.notify('fire');tutorial.update(.016,ctx);ctx.ads=true;tutorial.update(.5,ctx);
    tutorial.notify('reload');tutorial.update(.016,ctx);ctx.crouch=true;tutorial.update(.6,ctx);ctx.airborne=true;tutorial.update(.016,ctx);
    tutorial.notify('ability');tutorial.update(.016,ctx);
    if(tutorial.current.id!=='grenade')throw new Error('Grenade lesson missing');
    tutorial.notify('grenadeCycle');tutorial.update(.016,ctx);
    if(tutorial.current.id!=='grenade')throw new Error('Switch alone completes a throw lesson');
    tutorial.notify('grenade');tutorial.update(.016,ctx);
    if(tutorial.current.id!=='capture')throw new Error('Point capture lesson missing');
    tutorial.update(10,ctx);if(tutorial.current.id!=='capture')throw new Error('Capture lesson auto-completes from a timer');
    ctx.objectivesOwned=1;tutorial.update(.016,ctx);tutorial.notify('view');tutorial.notify('score');tutorial.update(.016,ctx);
    if(!tutorial.current.last)throw new Error('Tutorial cannot reach room lesson');tutorial.finish(false);
    if(!tutorial.finished||TUTORIAL_STEPS.length!==11)throw new Error('Tutorial completion is not recorded');checks+=11;
    if(TUTORIAL_STEPS.some(s=>s.tip?.includes('拖动')))throw new Error('Tutorial still advertises drag steering');

    const map=new T.Texture(),source=new T.MeshBasicMaterial({map,color:0xaaccdd,transparent:true,alphaTest:.3,side:T.DoubleSide});
    const root=new T.Group();root.add(new T.Mesh(new T.BoxGeometry(),source));root.add(new T.Mesh(new T.BoxGeometry(),source));
    fixImportedMaterials(root,{lightUnlit:true});
    const lit=root.children[0].material;
    if(!lit.isMeshStandardMaterial||lit.map!==map||lit.emissiveMap!==map||!lit.transparent||lit.alphaTest!==.3||lit.side!==T.DoubleSide||lit.color.getHex()!==source.color.getHex())throw new Error('Lighting destroyed original texture/tint/alpha');
    if(root.children[1].material!==lit)throw new Error('Shared character materials duplicated');checks++;
    let destroyed=false;const girl={root:new T.Group(),destroy(){destroyed=true;}};world.scene.add(girl.root);
    updateContactShadow(girl,world,true);const near=girl.contactShadow.material.opacity;
    girl.root.position.y=2;updateContactShadow(girl,world,true);
    if(girl.contactShadow.position.y>=0||girl.contactShadow.material.opacity>=near)throw new Error('Contact shadow floats during jumps');
    updateContactShadow(girl,world,false);if(girl.contactShadow.visible)throw new Error('Dead avatar casts a contact blob');
    let disposed=0;girl.contactShadow.geometry.addEventListener('dispose',()=>disposed++);girl.destroy();
    if(!destroyed||disposed!==1)throw new Error('Contact shadow lifecycle leaked');checks++;
    tutorial._el.remove();world.dispose();return {checks};
  });
  assert.equal(result.checks,21);assert.deepEqual(errors,[]);
  console.log('PASS: 21 gameplay checks: 30/60/144 Hz movement, braking, jump edge/buffer/coyote, chat freeze, all 11 tutorial lessons, texture/alpha-safe character lighting and grounded shadow cleanup');
  await page.close();
}

export async function testLiveControl(context,origin) {
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('CONTROL PAGE:',e.stack);});
  await page.goto(origin+'/');await page.locator('#btn-mode-solo').waitFor({state:'visible',timeout:30000});
  await page.selectOption('#game-mode','control');await page.locator('#btn-mode-solo').click();await page.locator('#btn-deploy').click();
  await page.waitForFunction(()=>window.__trench?.app.playing&&window.__trench.app.net.lastMe?.alive,null,{timeout:45000});
  await page.evaluate(async()=>{
    const {app}=window.__trench;const T=await import('/vendor/three.module.js'),{World}=await import('/js/map.js');
    app.net._engine.py.runPython("_host.room.match.drop_bots();_host.room.bots_on=False;_host.room.match.set_mode('control','somme')");
    app.world.group.visible=false;app.renderer.setPixelRatio(.3);
    app.world=app.controls.world=new World(app.scene,{groundY:0,boxes:[{t:'ground',x:0,y:-.5,z:0,w:150,h:1,d:150}],bounds:{minX:-60,maxX:60,minZ:-60,maxZ:60}},app.data.combat);
    app.net._engine.py.runPython('import combat\ncombat.SOLID=[]\ncombat._build_grid()\ncombat.GROUND_Y=combat.FLOOR_BASE=0');
  });
  await page.waitForFunction(()=>window.__trench.app.net.lastState.gameMode==='control'&&window.__trench.app.objectiveView.markers.size===3);
  assert.equal(await page.locator('.objective-card').count(),3);
  await page.locator('#game').click({position:{x:500,y:300}});await page.waitForFunction(()=>window.__trench.app.controls.locked);
  // Start at the new grenade lesson; earlier controls are covered above and in
  // the existing actual-main arsenal/camera tests. This checks the real wiring.
  await page.evaluate(()=>{const {app}=window.__trench;app.tut.start();app.tut.index=7;app.tut._render();app.controls.pitch=20;});
  await page.keyboard.press('b');await page.keyboard.down('g');
  await page.waitForFunction(()=>window.__trench.app.charge?.source==='grenade');
  await page.waitForFunction(()=>performance.now()-window.__trench.app.charge.t0>400);
  await page.keyboard.up('g');await page.waitForFunction(()=>window.__trench.app.tut.current.id==='capture');
  for(const id of ['A','B','C']) {
    await page.evaluate(id=>{
      const {app}=window.__trench,p=app.net.lastState.objectives.points.find(p=>p.id===id).p;
      const start=[p[0]-5.3,0,p[2]];app.controls.reset(start,0);
      app.net._engine.py.runPython(`p=_host.room.match.players[${app.myId}];p['pos']=${JSON.stringify(start)};p['hp']=100`);
    },id);
    await page.keyboard.down('w');await page.waitForFunction(id=>window.__trench.app.net.lastState.objectives.points.find(p=>p.id===id).progress>0,id);
    await page.keyboard.up('w');
    await page.waitForFunction(id=>{const {app}=window.__trench;return app.net.lastState.objectives.points.find(p=>p.id===id).owner===app.myTeam;},id,{timeout:20000});
    if(id==='A')await page.waitForFunction(()=>window.__trench.app.tut.current.id==='round');
  }
  await page.waitForFunction(()=>window.__trench.app.net.lastState.objectives.holdTeam>=0);
  const score=await page.evaluate(()=>window.__trench.app.net.lastState.s);
  assert.equal(Math.max(...score),3);
  // Pressure at any owned point interrupts the final hold, even before a flag
  // has finished neutralizing. Exercise authoritative state -> HUD delivery.
  await page.evaluate(()=>{
    const {app}=window.__trench;
    app.net._engine.py.runPython(`enemy=_host.room.match.add_player('Contester',None)\nenemy['team']=1-${app.myTeam}\nenemy['pos']=list(_host.room.match.control.points[0]['p'])`);
  });
  await page.waitForFunction(()=>window.__trench.app.net.lastState.objectives.holdTeam===-1);
  assert.equal(await page.evaluate(()=>window.__trench.app.net.lastState.objectives.holdRemaining),15000);
  await page.evaluate(()=>window.__trench.app.net._engine.py.runPython("_host.room.match.remove_player(enemy['id'])"));
  await page.waitForFunction(()=>window.__trench.app.net.lastState.objectives.holdTeam>=0);
  if(process.env.CONTROL_SCREENSHOT)await page.screenshot({path:process.env.CONTROL_SCREENSHOT});
  await page.waitForFunction(()=>window.__trench.app.net.lastState.phase==='ended',null,{timeout:35000});
  assert.equal(await page.evaluate(()=>window.__trench.app.net.lastState.reason),'all_points');
  assert.equal(await page.evaluate(()=>window.__trench.app.net.lastState.winner===window.__trench.app.myTeam),true);
  await page.waitForFunction(()=>{const {app}=window.__trench;return app.net.lastState.phase==='live'&&app.net.lastState.s.every(n=>n===0)&&!app.resultShown;},null,{timeout:20000});
  assert.equal(await page.evaluate(()=>window.__trench.app.net.lastState.objectives.points.every(p=>p.owner===-1)),true);
  assert.equal(await page.evaluate(()=>Math.abs(window.__trench.app.controls.pos.x)>40),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: actual mode picker/deploy, 3 world flags/HUD, native G/B tutorial acceptance, WASD capture, objective tutorial completion, pressure reset, 15s all-point victory and clean round restart');
  await page.close();
}
