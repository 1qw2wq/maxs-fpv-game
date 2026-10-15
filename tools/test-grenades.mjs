import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export async function testGrenades(context, origin) {
  const fixtures=JSON.parse(execFileSync('python',['tools/test-grenades.py','--fixtures'],{maxBuffer:16*1024*1024,encoding:'utf8'}));
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/__harness.html');
  const result=await page.evaluate(async fixtures=>{
    const T=await import('/vendor/three.module.js');
    const {World}=await import('/js/map.js');
    const {simulateThrow,sampleThrow}=await import('/js/throwing.js');
    const {buildGrenadeEffect,updateGrenadeEffect}=await import('/js/grenadefx.js');
    let tests=0, points=0;
    for(const fixture of fixtures.worlds) {
      const world=Object.assign(Object.create(World.prototype),fixture);world.grid=world._buildGrid();
      for(const c of fixture.cases) {
        const a=simulateThrow(world,c.origin,c.direction,c.power,c.kind,fixtures.config,fixtures.definitions,c.inherited,fixtures.maxSpeed), b=c.expected;
        if(a.bounces!==b.bounces || a.path.length!==b.path.length || Math.abs(a.delay-b.delay)>0.001) throw new Error(`${fixture.id}/${c.kind}: host/preview collision mismatch`);
        for(let i=0;i<a.path.length;i++) for(let j=0;j<4;j++) {
          if(Math.abs(a.path[i][j]-b.path[i][j])>0.00011) throw new Error(`${fixture.id}/${c.kind}: sample ${i}/${j}: ${a.path[i][j]} vs ${b.path[i][j]}`);
          points++;
        }
        const end=sampleThrow(a.path,a.delay,new T.Vector3());
        if(end.distanceTo(new T.Vector3(...a.p))>0.0001) throw new Error('Remote path ends away from impact');
        const mid=sampleThrow(a.path,a.delay/2,new T.Vector3());
        if(!mid.toArray().every(Number.isFinite)) throw new Error('Nonfinite remote flight');
        tests++;
      }
    }
    const renderer=new T.WebGLRenderer({canvas:document.getElementById('game'),preserveDrawingBuffer:true});renderer.setSize(640,400);
    const scene=new T.Scene();scene.background=new T.Color(0x111722);
    const camera=new T.PerspectiveCamera(65,1.6,.06,100);camera.position.set(7,5,9);camera.lookAt(0,.5,0);
    const effects=[];
    for(const kind of ['frag','incendiary','smoke','flash','flare']) {
      const spec=fixtures.definitions.find(g=>g.id===kind)||{dur:9000,radius:.3};
      const fx=buildGrenadeEffect({k:kind,p:[0,.091,0],r:spec.radius,dur:spec.dur,eid:42});
      const duplicate=buildGrenadeEffect({k:kind,p:[0,.091,0],r:spec.radius,dur:spec.dur,eid:42});
      if(fx.particles[0].phase!==duplicate.particles[0].phase) throw new Error('Flame seeding is nondeterministic');
      for(const age of [0,100,350,1000,4500,spec.dur+1]) {
        updateGrenadeEffect(fx,age);
        if(!fx.particles.every(p=>[...p.sprite.position.toArray(),...p.sprite.scale.toArray(),p.sprite.material.opacity].every(Number.isFinite))) throw new Error('Invalid flame animation');
      }
      updateGrenadeEffect(fx,4500);
      if((kind==='incendiary'||kind==='flare') !== fx.particles.some(p=>p.sprite.material.opacity>0)) throw new Error(`${kind}: wrong flame persistence`);
      updateGrenadeEffect(fx,200);
      if(!fx.particles.some(p=>p.sprite.material.opacity>0)) throw new Error(`${kind}: invisible detonation`);
      effects.push(fx,duplicate);
      if(kind==='incendiary') scene.add(fx.obj);
    }
    renderer.render(scene,camera);
    const pixels=new Uint8Array(640*400*4),gl=renderer.getContext();gl.readPixels(0,0,640,400,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let orange=0;for(let i=0;i<pixels.length;i+=4) if(pixels[i]>90&&pixels[i]>pixels[i+1]*1.15&&pixels[i+2]<pixels[i]*.75) orange++;
    if(orange<100) throw new Error(`Fire is not visibly rendered: ${orange} orange pixels`);
    const baseline=renderer.info.memory.geometries;
    for(const effect of effects) {
      effect.obj.removeFromParent();effect.obj.traverse(o=>{if(o.isMesh)o.geometry.dispose();o.material?.dispose();});
    }
    renderer.render(scene,camera);
    if(renderer.info.memory.geometries>=baseline) throw new Error('Detonation geometries leaked');
    const sprite=effects[2].particles[0].sprite;
    if(!sprite.geometry.attributes.position) throw new Error('Shared sprite geometry destroyed');
    renderer.dispose();
    return {tests,points,orange};
  },fixtures);
  assert.equal(result.tests,150);
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${result.tests} Python/JS throw parity cases (${result.points} sampled coordinates), sphere sweeps, ramp slopes, fuses, bounces and remote replay`);
  console.log(`PASS: all grenade/flare fire lifetimes, seeded effects, visible WebGL flames (${result.orange} orange pixels) and resource disposal`);
  await page.close();
}

export async function testLiveGrenades(page) {
  await page.evaluate(async()=>{
    const {app}=window.__trench;
    const T=await import('/vendor/three.module.js'),{World}=await import('/js/map.js');
    app.world.group.visible=false;app.renderer.shadowMap.enabled=false;app.renderer.setPixelRatio(.35);
    const ground={t:'ground',x:0,y:-.5,z:0,w:120,h:1,d:120};
    app.world=app.controls.world=new World(app.scene,{boxes:[ground],groundY:0,bounds:{minX:-50,maxX:50,minZ:-50,maxZ:50}},app.data.combat);
    app.net._engine.py.runPython(`import combat\ncombat.SOLID=[]\ncombat._build_grid()\ncombat.GROUND_BOX=None\ncombat.GROUND_Y=combat.FLOOR_BASE=0\ncombat.BOUNDS=dict(minX=-50,maxX=50,minZ=-50,maxZ=50)\np=_host.room.match.players[${app.myId}]\np.update(pos=[0,0,0],cls='assault',weapon='mp18',hp=100,alive=True,grenades=2,grenade_ready=0,ability_charges=2,ability_ready=0,velocity=[0,0,0])`);
    app.controls.pos.set(0,0,0);app.controls.eyeGround=0;app.controls.vel.set(0,0,0);app.controls.vy=0;app.controls.yaw=0;app.controls.pitch=12;
    app.controls.enabled=true;app.cameraMode='fp';app.grenadeKind='frag';
  });
  await page.waitForFunction(()=>window.__trench.app.net.lastMe?.c==='assault');
  assert.equal(await page.evaluate(()=>window.__trench.app.controls.canLook),true);
  for(const kind of ['frag','incendiary','smoke','flash']) {
    await page.evaluate(()=>{const {app}=window.__trench;app.net._engine.py.runPython(`p=_host.room.match.players[${app.myId}];p['grenades']=2;p['grenade_ready']=0`);});
    await page.waitForFunction(()=>window.__trench.app.net.lastMe.grenades===2);
    assert.equal(await page.evaluate(()=>window.__trench.app.grenadeKind),kind);
    await page.keyboard.down('g');
    await page.waitForFunction(()=>window.__trench.app.charge?.source==='grenade' && document.getElementById('grenade-chip').classList.contains('charging'));
    await page.keyboard.press('b'); // must not switch a grenade already in hand
    assert.equal(await page.evaluate(()=>window.__trench.app.grenadeKind),kind);
    const chargeTime=kind==='flash'?100:400;
    await page.waitForFunction(ms=>performance.now()-window.__trench.app.charge.t0>=ms,chargeTime);
    await page.keyboard.up('g');
    await page.waitForFunction(kind=>window.__trench.app.effects.some(e=>e.kind===kind && !e.landed && e.flyPath?.length>2),kind);
    try {await page.waitForFunction(kind=>window.__trench.app.effects.some(e=>e.kind===kind && e.landed && e.detonation?.particles.some(p=>p.sprite.material.opacity>0)),kind,{timeout:8000});}
    catch(error) {console.error('GRENADE STATE',await page.evaluate(()=>{const {app}=window.__trench;return {me:app.net.lastMe,paused:app.paused,flash:app.flash,now:performance.now(),effects:app.effects.map(e=>({kind:e.kind,start:e.start,dur:e.dur,landed:e.landed,alpha:e.detonation?.particles[0]?.sprite.material.opacity}))};}));throw error;}

    assert.equal(await page.evaluate(()=>window.__trench.app.charge),null);
    if(kind==='incendiary') {
      const eid=await page.evaluate(()=>window.__trench.app.effects.find(e=>e.kind==='incendiary').eid);
      await page.waitForFunction(eid=>{const e=window.__trench.app.effects.find(e=>e.eid===eid);return e&&performance.now()-e.start>1000&&e.detonation.particles.some(p=>p.sprite.material.opacity>0);},eid);
      if(process.env.GRENADE_SCREENSHOT) await page.screenshot({path:process.env.GRENADE_SCREENSHOT});
      // Observe actual expiry, rather than removing it through a test-only path.
      await page.waitForFunction(eid=>!window.__trench.app.effects.some(e=>e.eid===eid),eid,{timeout:9000});
    }
    if(kind==='flash') {
      await page.waitForFunction(()=>Number(document.getElementById('flash-veil').style.opacity)>.05);
      await page.waitForFunction(()=>!window.__trench.app.flash && Number(document.getElementById('flash-veil').style.opacity)<.01,null,{timeout:5000});
    }
    await page.keyboard.press('b');
  }
  // Hold cancellation through the real Esc / pause / native-lock handlers.
  await page.keyboard.down('g');
  await page.waitForFunction(()=>!!window.__trench.app.charge);
  const before=await page.evaluate(()=>window.__trench.app.net.lastMe.grenades);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.__trench.app.paused && !window.__trench.app.charge);
  await page.keyboard.up('g');
  assert.equal(await page.evaluate(()=>window.__trench.app.net.lastMe.grenades),before);
  await page.waitForFunction(()=>performance.now()>window.__trench.app.controls._lockCooldownUntil);
  await page.locator('#btn-pause-resume').click();
  await page.locator('#game').click({position:{x:500,y:300}});
  await page.waitForFunction(()=>window.__trench.app.controls.canLook);
  const inventory=await page.evaluate(()=>window.__trench.app.net.lastMe.grenades);
  const lastId=await page.evaluate(()=>Math.max(0,...window.__trench.app.effects.map(e=>e.eid)));

  await page.keyboard.down('q');
  await page.waitForFunction(()=>window.__trench.app.charge?.source==='ability');
  await page.keyboard.up('q');
  await page.waitForFunction(id=>window.__trench.app.effects.some(e=>e.kind==='smoke'&&e.eid>id),lastId);
  assert.equal(await page.evaluate(()=>window.__trench.app.net.lastMe.grenades),inventory);
  console.log('PASS: actual main.js native G/B input, charged throws, all four detonations, persistent fire/expiry, flash fade, Esc cancellation and separate Q inventory');
}
