import assert from 'node:assert/strict';
export async function testArsenal(context, origin) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/__harness.html');
  const result = await page.evaluate(async () => {
    const T = await import('/vendor/three.module.js');
    const { ViewModel } = await import('/js/viewmodel.js');
    const { createGirl } = await import('/js/character.js');
    const { GunFx, gunStyle, remoteShotDue, tracerRound } = await import('/js/gunfx.js');
    const { Sfx } = await import('/js/audio.js');
    const { Net } = await import('/js/net.js');
    const data = await (await fetch('/shared/weapons.json')).json();
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(78, 4/3, 0.06, 100);
    scene.add(camera);
    const vm = new ViewModel(data); vm.setClass(data.classes[0]); camera.add(vm.root);
    const group = new T.Group(); scene.add(group);
    const fx = new GunFx({group, scene});
    const rigData = { ...data, teamById: Object.fromEntries(data.teams.map((t)=>[t.id,t])), weaponsByClass:Object.fromEntries(data.classes.map(c=>[c.id,data.weapons.filter(w=>w.class===c.id)])) };
    const girl = createGirl(data.classes[0], data.teams[0], rigData); scene.add(girl.root);
    const from=new T.Vector3(), eject=new T.Vector3(), dir=new T.Vector3();
    let shots=0;
    for (const weapon of data.weapons) {
      const style=gunStyle(weapon);
      vm.setWeapon(weapon); await vm.gunMeshes.userData.modelReady;
      girl.setWeapon(weapon); await girl.root.getObjectByName('weapon-muzzle').parent.userData.modelReady;
      for (const mode of ['fp','tp','remote']) {
        fx.clear(); vm.update(0,{moveSpeed:0,ads:false}); girl.update(0,{speed:0,pitch:12});
        let attachment;
        if (mode==='fp') { vm.shotWorld(from,eject); attachment=vm.muzzle; }
        else { girl.muzzleWorld(from); girl.ejectWorld(eject); attachment=girl.root.getObjectByName('weapon-muzzle'); }
        attachment.getWorldDirection(dir);
        const before={...fx.stats};
        if(mode==='remote') fx.remote(weapon,from,dir,{eject,attachment});
        else fx.fire(weapon,from,dir,{eject,attachment});
        // Even a slow 20fps frame must display every weapon's short flash.
        fx.update(0.05);
        const flash=fx.flashes.find(f=>f.live);
        if(!flash || !flash.meshes[0].visible || flash.mat.opacity<=0) throw new Error(`${weapon.id}/${mode}: missing first-frame flash`);
        if(flash.meshes[0].position.distanceTo(from)>1e-5) throw new Error('Flash is not attached to this gun muzzle');
        if(fx.stats.brass!==before.brass+1 || fx.stats.smoke!==before.smoke+style.smoke.count) throw new Error(`${weapon.id}/${mode}: missing brass/smoke`);
        const casing=fx.casings.find(c=>c.live);
        if(Math.abs(casing.mesh.scale.x-style.casing.size*(1-50/900*0.35))>1e-8) throw new Error('Casing loses weapon size after update');
        if(mode!=='remote' && (fx.punchPitch<=0 || !fx._lights.some(l=>l.intensity>0))) throw new Error('Missing local punch or muzzle light');
        if(mode==='remote' && fx.punchPitch!==0) throw new Error('Remote gun punches local camera');
        if(!Array.from({length:style.tracer.every},(_,i)=>i+1).some(n=>tracerRound(style,n))) throw new Error('Tracer never emits');
        fx.update(style.flash.ms/1000+0.01);
        if(fx.flashes.some(f=>f.live)) throw new Error('Flash never expires');
        fx.update(2);
        if(fx.casings.some(c=>c.live) || fx.smokes.some(s=>s.live) || fx._lights.some(l=>l.intensity)) throw new Error('Effects never clean up');
        shots++;
      }
      const state={};
      if(remoteShotDue(state,{alive:true,flags:0,shotSeq:8},weapon,0)) throw new Error('Joining replays historical shot');
      if(!remoteShotDue(state,{alive:true,flags:0,shotSeq:9},weapon,100)) throw new Error('Lost slow gun shot after flag expired');
      if(remoteShotDue(state,{alive:true,flags:8,shotSeq:9},weapon,3000)) throw new Error('Duplicate flash from repeated snapshot');
      if(remoteShotDue(state,{alive:false,flags:8,shotSeq:10},weapon,3100)) throw new Error('Dead player fires');
      remoteShotDue(state,{alive:true,flags:8,shotSeq:9},weapon,3200);
      if(remoteShotDue(state,{alive:true,flags:8,shotSeq:10},weapon,3300)) throw new Error('Out-of-order snapshot replays a shot');
      const legacy={};
      if(!remoteShotDue(legacy,{alive:true,flags:8},weapon,0) || remoteShotDue(legacy,{alive:true,flags:8},weapon,1)) throw new Error('Legacy cadence fallback broken');
    }
    for(let i=0;i<80;i++) { fx.fire(data.weapons[i%data.weapons.length],from,dir); fx.update(0.001); }
    if(fx.flashes.length>8 || fx.smokes.length>18 || fx.casings.length>16) throw new Error('Unbounded firing pools');
    fx.clear();
    if(fx.flashes.some(f=>f.meshes.some(m=>m.visible)) || fx._lights.some(l=>l.intensity)) throw new Error('Map change leaves flash/light');
    fx.dispose();
    // Discrete shot metadata must survive the same interpolation used by all
    // three transports, rather than being discarded by the visual client.
    const net=new Net(); net.interpDelay=0;
    net.snaps=[{t:performance.now(),s:{ps:[{i:9,p:[0,0,0],y:0,pi:0,f:8,al:1,sq:42,w:'mp18'}]}}];
    if(net.sample().get(9).shotSeq!==42) throw new Error('Network interpolation drops accepted shots');
    const audio=new Sfx();
    window.arsenalAudio=audio;
    window.arsenalWeapons=data.weapons;
    return {weapons:data.weapons.length,shots};
  });
  await page.waitForFunction(()=>arsenalWeapons.every(w=>arsenalAudio._guns[w.id]?.buf?.duration>0),null,{timeout:20000});
  await page.evaluate(async()=>{
    const {gunStyle}=await import('/js/gunfx.js');
    const audio=window.arsenalAudio;
    for(const w of window.arsenalWeapons) {
      let selected;
      const original=audio._playBuf;
      audio._playBuf=(record)=>{selected=record;return true;};
      audio.shot(w,gunStyle(w));
      if(selected!==audio._guns[w.id]) throw new Error(`${w.id}: wrong local sound sample`);
      audio.shotFar(w,gunStyle(w),25);
      if(selected!==audio._guns[w.id]) throw new Error(`${w.id}: wrong remote sound sample`);
      audio._playBuf=original;
      if(audio._guns[w.id].offset>=audio._guns[w.id].buf.duration) throw new Error('Sample trimmed past end');
    }
    await audio.ctx.close();
  });
  assert.equal(result.shots,result.weapons*3);
  assert.deepEqual(errors,[]);
  console.log('PASS: all 30 guns / 90 FP, TP and remote shots: flash at 20fps, smoke, brass sizing, light, recoil, tracer cadence, accepted-shot deduplication, bounded pools and decoded per-gun sound');
  await page.close();
}

export async function testLiveArsenal(page) {
  // A pistol's catalog class is `secondary`, not a playable character class.
  const weapons=await page.evaluate(()=>window.__trench.app.data.weapons.map(w=>({id:w.id,cls:w.slot==='secondary'?'assault':w.class})));
  for(const mode of ['fp','tp']) for(const w of weapons) {
    await page.evaluate(({w,mode})=>{
      const {app}=window.__trench;
      app.cameraMode=mode;
      app.net._engine.py.runPython(`p = _host.room.match.players[${app.myId}]\np['weapon'] = '${w.id}'\np['cls'] = '${w.cls}'\np['mag'] = 100\np['reserve'] = 100\np['reload_end'] = 0\np['last_shot'] = 0`);
      app.boltWait=false; app.pendingBolt=null; app.nextShot=0;
    },{w,mode});
    await page.waitForFunction(id=>window.__trench.app.net.lastMe.w===id && window.__trench.app.vm.weapon.id===id,w.id);
    await page.evaluate(async()=>{await window.__trench.app.vm.gunMeshes.userData.modelReady;});
    const before=await page.evaluate(()=>{
      const {app}=window.__trench;
      const count=app.gunfx.stats.flashes;
      app.clickPending=true; app.controls.mouse.left=true;
      return count;
    });
    await page.waitForFunction(before=>{
      const {app}=window.__trench;
      if(app.gunfx.stats.flashes<=before) return false;
      app.controls.mouse.left=false;
      if(!app.gunfx.stats.brass || !app.gunfx.stats.smoke) throw new Error('Actual shot has no brass/smoke');
      return true;
    },before);
  }
  console.log(`PASS: actual main.js fires every gun in both first- and third-person (${weapons.length*2} weapon/mode cases)`);
}
