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
    const {buildGrenadeEffect,updateGrenadeEffect,createGrenadeLights,updateGrenadeLights}=await import('/js/grenadefx.js');
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
    for(const kind of ['frag','incendiary','smoke','flash','gas','flare']) {
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
      updateGrenadeEffect(fx,kind==='flash'?20:200);
      if(!fx.particles.some(p=>p.sprite.material.opacity>0)&&!fx.dust.some(p=>p.sprite.material.opacity>0)) throw new Error(`${kind}: invisible detonation`);
      if(kind==='flash'){
        if(fx.sparks.count||fx.fragments.count||fx.dust.length)throw Error('Flash must not contain orange fire/debris');
        updateGrenadeEffect(fx,200);
        if(fx.particles.some(p=>p.sprite.material.opacity>0)||fx.glow>0)throw Error('Flash must be a brief white blink');
      }
      effects.push(fx,duplicate);
      if(kind==='incendiary') scene.add(fx.obj);
    }
    const wallWorld={solid:[{t:'wall',x:.6,y:2,z:0,w:.08,h:4,d:20}],bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20},floorBase:0,floorAt:()=>0};
    let reference;
    for(const hz of [20,60,144]){
      const fx=buildGrenadeEffect({k:'frag',p:[0,.091,0],r:7,dur:1000,eid:82},wallWorld);
      if(fx.fragmentPaths.some(p=>p.path.some(row=>row[1]>.5481)))throw Error('Cosmetic fragments cross a solid wall');
      for(let i=0;i<=hz;i++)updateGrenadeEffect(fx,i/hz*1000);
      const matrix=Array.from(fx.fragments.instanceMatrix.array);
      if(reference&&matrix.some((v,i)=>Math.abs(v-reference[i])>1e-6))throw Error('Debris depends on frame rate');
      reference=matrix;effects.push(fx);
    }
    const fire=buildGrenadeEffect({k:'incendiary',p:[0,.091,0],r:4,dur:7000,eid:82},wallWorld);
    if(fire.particles.some(p=>p.x>.56))throw Error('Ground fire spreads through a wall');effects.push(fire);
    const poolParent=new T.Group(),lights=createGrenadeLights(poolParent);
    updateGrenadeLights(lights,[{landed:true,kind:'flash',obj:effects[0].obj,detonation:{glow:14}},{landed:true,kind:'incendiary',obj:fire.obj,detonation:{glow:1}}],new T.Vector3());
    if(lights.length!==2||lights[0].intensity!==14||lights.some(l=>l.castShadow))throw Error('Unbounded/incorrect explosion light pool');
    updateGrenadeLights(lights,[],new T.Vector3());if(lights.some(l=>l.intensity!==0))throw Error('Explosion light survives cleanup');
    renderer.render(scene,camera);
    if(renderer.getContext().getError()!==0)throw Error('Grenade effects caused a WebGL error');
    const pixels=new Uint8Array(640*400*4),gl=renderer.getContext();gl.readPixels(0,0,640,400,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let orange=0;for(let i=0;i<pixels.length;i+=4) if(pixels[i]>90&&pixels[i]>pixels[i+1]*1.15&&pixels[i+2]<pixels[i]*.75) orange++;
    if(orange<100) throw new Error(`Fire is not visibly rendered: ${orange} orange pixels`);
    const baseline=renderer.info.memory.geometries;
    for(const effect of effects) {
      effect.obj.removeFromParent();effect.obj.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.isMesh)o.geometry.dispose();o.material?.dispose();});
    }
    renderer.render(scene,camera);
    if(renderer.info.memory.geometries>=baseline) throw new Error('Detonation geometries leaked');
    const sprite=effects[2].particles[0].sprite;
    if(!sprite.geometry.attributes.position) throw new Error('Shared sprite geometry destroyed');
    renderer.dispose();
    return {tests,points,orange};
  },fixtures);
  assert.equal(result.tests, fixtures.worlds.reduce((n,w)=>n+w.cases.length,0));
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${result.tests} Python/JS throw parity cases (${result.points} sampled coordinates), sphere sweeps, ramp slopes, fuses, bounces and remote replay`);
  console.log(`PASS: typed grenade/flare lifetimes, 20/60/144 Hz debris, wall-stopped fragments/fire, pooled lights, visible WebGL flames (${result.orange} orange pixels) and resource disposal`);
  await page.close();
}

export async function testLiveGrenades(page) {
  // Prime art for this integration assertion; loading/failure fallback is tested
  // separately. Observe the brief blink in-frame, not after a CDP round trip.
  await page.evaluate(async()=>{
    const {preloadGrenadeModels}=await import('/js/grenade-models.js');
    const result=await preloadGrenadeModels();if(result.some(r=>r.status!=='fulfilled'))throw Error('Live grenade art preload failed');
  });
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
    if(kind==='flash')await page.evaluate(()=>{
      // Observe the rendered onset from BEFORE detonation. Under software WebGL,
      // CDP assertions after the particle check can arrive after the white hold.
      window.flashWitness={opaque:false,cover:false,active:true};
      const observe=()=>{
        const el=document.getElementById('flash-veil'),r=el.getBoundingClientRect(),s=getComputedStyle(el);
        if(Number(s.opacity)===1){flashWitness.opaque=true;flashWitness.cover=s.backgroundColor==='rgb(255, 255, 255)' && Number(s.zIndex)>=1000 && r.width===innerWidth && r.height===innerHeight;}
        if(flashWitness.active)requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    });
    await page.evaluate(kind=>{
      const after=Math.max(0,...__trench.app.effects.map(e=>e.eid));
      const w=window.grenadeWitness={imported:false,detonated:false,active:true};
      const observe=()=>{
        for(const e of __trench.app.effects)if(e.kind===kind&&e.eid>after){
          w.imported ||= !!e.proj?.userData.imported;
          w.detonated ||= !!(e.landed&&(e.detonation?.particles.some(p=>p.sprite.material.opacity>0)||e.detonation?.dust.some(p=>p.sprite.material.opacity>0)));
        }
        if(w.active)requestAnimationFrame(observe);
      };requestAnimationFrame(observe);
    },kind);
    await page.keyboard.down('g');
    await page.waitForFunction(()=>window.__trench.app.charge?.source==='grenade' && document.getElementById('grenade-chip').classList.contains('charging'));
    await page.keyboard.press('b'); // must not switch a grenade already in hand
    assert.equal(await page.evaluate(()=>window.__trench.app.grenadeKind),kind);
    if(kind==='flash')await page.evaluate(()=>{window.__trench.app.controls.pitch=-65;});
    const chargeTime=kind==='flash'?100:400;
    await page.waitForFunction(ms=>performance.now()-window.__trench.app.charge.t0>=ms,chargeTime);
    await page.keyboard.up('g');
    await page.waitForFunction(kind=>window.__trench.app.effects.some(e=>e.kind===kind && !e.landed && e.flyPath?.length>2),kind);
    await page.waitForFunction(()=>grenadeWitness.imported,null,{timeout:8000});
    try {await page.waitForFunction(()=>grenadeWitness.detonated,null,{timeout:8000});await page.evaluate(()=>{grenadeWitness.active=false;});}
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
      await page.waitForFunction(()=>flashWitness.opaque,null,{timeout:5000});
      assert.ok(await page.evaluate(()=>{flashWitness.active=false;return flashWitness.cover;}),'Flash must cover the full viewport with opaque white');
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
