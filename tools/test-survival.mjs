import assert from 'node:assert/strict';

export async function testSurvival(context, origin) {
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/__harness.html');
  const result=await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js');
    const {World}=await import('/js/map.js'), {Controls}=await import('/js/controls.js');
    const {gunStyle}=await import('/js/gunfx.js');
    const {updateSpawnShield}=await import('/js/spawn-shield.js');
    const {Net}=await import('/js/net.js');
    const data=await (await fetch('/shared/weapons.json')).json();
    const registry=await (await fetch('/shared/maps.json')).json();
    const canvas=document.getElementById('game');
    const flat=new World(new T.Scene(),{groundY:0,bounds:{minX:-30,maxX:30,minZ:-30,maxZ:30},boxes:[{t:'ground',x:0,y:-.5,z:0,w:100,h:1,d:100},{t:'wall',x:2,y:2,z:0,w:.002,h:4,d:20}]},data.combat);
    const c=new Controls(canvas,flat,data.combat,data);c.enabled=true;c.setClass(data.classes[0]);
    let poses=0, kicks=0;
    for(const w of data.weapons)for(const ads of [false,true]) {
      c.reset([0,0,0],0);c.ads=ads;
      const k=gunStyle(w).kick;
      for(let i=0;i<5;i++)c.applyRecoil(k,()=>.5);
      const expected=5*k.punch*(ads?.65:1);
      if(Math.abs(c.pitch-expected)>1e-8 || c.yaw!==0 || c.pitch<=0)throw new Error(`${w.id}: recoil does not move real aim`);
      c.pitch=87.9;c.applyRecoil(k,()=>.5);
      if(c.pitch>88)throw new Error('Recoil escaped pitch limits');
      kicks++;
    }
    for(const endz of [-3,0,3]) {
      const [x,z]=flat.resolveMove(0,0,8,endz,0,1.7);
      if(x>=1.65 || Math.abs(z-endz)>1e-8)throw new Error('Continuous wall collision/slide failed');
    }
    for(const bad of [[999,0,0],[0,-999,0],[NaN,0,0],[0,Infinity,0]]) {
      c.reset([0,0,0],0);c.pos.fromArray(bad);c.update(1/60,true,false);
      if(!c.pos.toArray().every(Number.isFinite)||c.pos.length()>1e-6||!c.grounded)throw new Error('Client failed fall/non-finite recovery');
    }
    const model=new World(new T.Scene(),{scene:{model:'/map.glb'},groundY:0,bounds:flat.bounds,boxes:[{t:'ground',x:0,y:-3.5,z:0,w:100,h:1,d:100},{t:'floor',x:10,y:-.1,z:0,w:4,h:.2,d:4},{t:'floor',x:0,y:-2.1,z:0,w:4,h:.2,d:4}]},data.combat);
    c.world=model;c.reset([10,0,0],0);c.pos.set(-6,-3,0);c.update(1/60,true,false);
    if(c.pos.distanceTo(new T.Vector3(10,0,0))>.001)throw new Error('Invisible model backstop failed to recover player');
    c.reset([0,-2,0],0);c.update(1/60,true,false);
    if(Math.abs(c.pos.y+2)>.001)throw new Error('Legitimate basement was treated as void');
    for(const meta of registry.maps) {
      const map={...await (await fetch(meta.file)).json(),scene:meta.scene};
      const world=new World(new T.Scene(),map,data.combat);
      c.world=world;
      for(const fps of [20,60,144])for(const yaw of [0,90,180,270]) {
        const s=map.spawns['0'][0];c.reset([s.x,s.y,s.z],yaw);c.keys.clear();c.keys.add('KeyW');c.keys.add('ShiftLeft');
        for(let i=0;i<fps*3;i++) {
          if(i===fps)c.keys.add('Space');if(i===fps+1)c.keys.delete('Space');
          c.update(1/fps,true,false);const p=c.pos,b=world.bounds;
          if(!p.toArray().every(Number.isFinite)||p.y<world.floorBase-1e-6||p.x<b.minX+1.5-1e-8||p.x>b.maxX-1.5+1e-8||p.z<b.minZ+1.5-1e-8||p.z>b.maxZ-1.5+1e-8)throw new Error(`${meta.id}/${fps}: escaped map`);
          poses++;
        }
      }
    }
    const scene=new T.Scene(), girl={root:new T.Group()};scene.add(girl.root);
    updateSpawnShield(girl,true,100);const shield=girl.spawnShield;
    if(!shield||shield.material.depthWrite||shield.material.opacity<=0)throw new Error('Shield not visibly rendered');
    let disposed=0;shield.geometry.addEventListener('dispose',()=>disposed++);shield.material.addEventListener('dispose',()=>disposed++);
    scene.remove(girl.root);
    if(girl.spawnShield||disposed!==2)throw new Error('Removed avatar leaks shield resources');
    const net=new Net();net._dispatch({t:'state',ps:[{i:2,p:[0,0,0],y:0,pi:0,al:1,sh:5000}]});
    if(net.sample().get(2).shieldMs<4900)throw new Error('Remote shield not replicated');
    const stale=new Net();stale._dispatch({t:'state',ps:[{i:2,p:[0,0,0],y:0,pi:0,al:1,sh:5000}]},performance.now()-6000);
    if(stale.sample().get(2).shieldMs!==0)throw new Error('Stale remote snapshot keeps shield alive');
    return {poses,kicks};
  });
  assert.deepEqual(errors,[]);await page.close();
  console.log(`PASS: ${result.kicks} real-aim recoil cases, thin-wall sweeps, client void recovery, ${result.poses} real-map sprint/jump frames at 20/60/144fps, replicated shield expiry and disposal`);
}

export async function testLiveSurvival(page) {
  // Runs after the native-grenade fixture, which leaves an empty flat arena.
  await page.evaluate(()=>{
    const {app}=window.__trench;
    app.controls.mouse.left=false;app.controls.keys.clear();app.cameraMode='tp';
    app.net._engine.py.runPython(`import game\np=_host.room.match.players[${app.myId}]\np['alive']=False;p['respawn_at']=0`);
    app.net.respawn(app.loadout.cls,app.loadout.weapon);
  });
  await page.waitForFunction(()=>window.__trench.app.net.lastMe.shieldMs>0 && !document.getElementById('spawn-shield-status').classList.contains('hidden'));
  await page.evaluate(()=>{
    const {app}=window.__trench;app.controls.reset([0,0,0],0);
    app.net._engine.py.runPython(`p['pos']=[0,0,0];p['safe_pos']=[0,0,0];game._seed_hist(p,game.now_ms())\nqa=_host.room.match.add_player('Shield QA',None)\nqa.update(team=1-p['team'],pos=[6,0,0],safe_pos=[6,0,0])\nassert game.shield_remaining(p,game.now_ms())>0\n_host.room.match._on_fire(qa,dict(d=[-1,0,0]))\nassert p['hp']==game.max_hp(_host.room.match,p)`);
    app.qaShieldId=app.net._engine.py.runPython("qa['id']");
  });
  await page.waitForFunction(()=>{const {app}=window.__trench;return app.self?.spawnShield && app.remotes.get(app.qaShieldId)?.spawnShield;});
  await page.waitForFunction(()=>{const {app}=window.__trench;return app.net.lastMe.shieldMs===0 && !app.self.spawnShield && !app.remotes.get(app.qaShieldId)?.spawnShield && document.getElementById('spawn-shield-status').classList.contains('hidden');},null,{timeout:8000});
  await page.evaluate(()=>{const c=window.__trench.app.controls;c.pos.set(999,-999,999);});
  await page.waitForFunction(()=>{const c=window.__trench.app.controls;return c.pos.y>=c.world.floorBase && c.pos.length()<1;});
  await page.evaluate(()=>{
    const {app}=window.__trench;
    app.net._engine.py.runPython("p['safe_pos']=[3,0,2];p['pos']=[0,-999,0]");
  });
  await page.waitForFunction(()=>{const {app}=window.__trench;return app.lastRecoverySeq>0 && app.controls.pos.distanceTo({x:3,y:0,z:2})<.01;});
  assert.equal(await page.evaluate(()=>window.__trench.app.net.lastMe.shieldMs),0,'Fall recovery must not grant another shield');
  await page.evaluate(()=>{const {app}=window.__trench;app.net._engine.py.runPython("_host.room.match.remove_player(qa['id'])");delete app.qaShieldId;});
  console.log('PASS: actual main.js respawn shield/HUD + remote bubble, damage immunity/expiry, local fall recovery and host-to-client safe-position correction without renewed immunity');
}
