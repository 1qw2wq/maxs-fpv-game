import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function testPerformance(context,origin) {
  const fixtures=JSON.parse(execFileSync('python',[fileURLToPath(new URL('./test-shooting.py',import.meta.url)),'--fixtures'],{maxBuffer:8*1024*1024}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/__harness.html');
  const result=await page.evaluate(async fixtures=>{
    const T=await import('/vendor/three.module.js'),{World}=await import('/js/map.js');
    const {rayWorld,safeMuzzle,clipTracer}=await import('/js/ballistics.js');
    const {AdaptiveResolution,poseInterval}=await import('/js/performance.js');
    const data=await(await fetch('/shared/weapons.json')).json();
    const vec=a=>new T.Vector3(...a),bounds={minX:-150,maxX:150,minZ:-150,maxZ:150};
    let rays=0,tested=0,linear=0;
    for(const fixture of fixtures) {
      const boxes=[...fixture.boxes,...(fixture.ground?[fixture.ground]:[])];
      const world=new World(new T.Scene(),{boxes,groundY:0,bounds},data.combat);
      for(const ray of fixture.rays) {
        const stats={},actual=rayWorld(world,vec(ray.o),vec(ray.d),220,stats);
        if((actual===null)!==(ray.t===null) || (actual!==null&&Math.abs(actual-ray.t)>1e-6))throw new Error(`${fixture.map}: authority/visual collision mismatch (${actual}/${ray.t})`);
        const brute=rayWorld({solid:fixture.boxes,ground:fixture.ground},vec(ray.o),vec(ray.d),220);
        if((actual===null)!==(brute===null)||(actual!==null&&Math.abs(actual-brute)>1e-6))throw new Error('Grid skipped a solid');
        rays++;tested+=stats.tested||0;linear+=boxes.length;
      }
      world.dispose();
    }
    if(tested>linear*.15)throw new Error('Ray broad phase still scans the whole map');
    const wall={t:'wall',x:.025,y:2,z:0,w:.002,h:4,d:8},world={solid:[wall]};
    const eye=vec([0,1.58,0]),muzzle=vec([1,1.58,0]);
    if(safeMuzzle(world,eye,muzzle)||muzzle.distanceTo(eye)>1e-9)throw new Error('Barrel starts past cover');
    if(clipTracer(world,muzzle,vec([10,1.58,0])).x>=.024)throw new Error('Tracer penetrates near cover');
    const inside=vec([.025,1.58,0]);
    if(clipTracer(world,inside,vec([10,1.58,0])).distanceTo(inside)>1e-9)throw new Error('Embedded tracer shoots out of wall');

    let ratio=1;
    const fake={setPixelRatio(r){ratio=r;},getPixelRatio(){return ratio;}};
    const quality=new AdaptiveResolution(fake,{width:1920,height:1080,dpr:2});
    if(1920*1080*ratio*ratio>2000001)throw new Error('Initial buffer exceeds pixel budget');
    const initial=ratio;let now=0;
    for(let i=0;i<100;i++)quality.update(35,now+=35);
    if(ratio>=initial || ratio<quality.min)throw new Error('Slow frames do not lower resolution safely');
    const low=ratio;
    for(let i=0;i<1100;i++)quality.update(10,now+=10);
    if(ratio<=low || ratio>initial)throw new Error('Fast frames do not recover quality safely');
    const before=ratio;quality.update(15000,now+=15000,false);
    if(ratio!==before)throw new Error('Background stall changed quality');
    fake.setPixelRatio(.3);for(let i=0;i<100;i++)quality.update(40,now+=40);
    if(ratio!==.3)throw new Error('Explicit render override was overwritten');
    if(!(poseInterval(5)<poseInterval(30)&&poseInterval(30)<poseInterval(60)&&poseInterval(60)<poseInterval(120)))throw new Error('Avatar animation has no distance budget');

    // Compare the exact same scene/triangles: expand the instance batches back
    // into individual meshes, reproducing the old per-box draw submission.
    const scene=new T.Scene(),map=await(await fetch('/shared/map.json')).json();
    const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas')});renderer.setSize(160,120);
    const scenery=await World.create(scene,map,data.combat,renderer);
    let dynamic=0;scenery.group.traverse(o=>{if(o.matrixAutoUpdate||o.matrixWorldAutoUpdate)dynamic++;});
    if(dynamic)throw new Error('Static map matrices still recomposed');
    const camera=new T.PerspectiveCamera(78,4/3,.1,1000);camera.position.set(0,160,0);camera.lookAt(0,0,0);
    renderer.render(scene,camera);const after=renderer.info.render.calls,triangles=renderer.info.render.triangles;
    const expanded=scenery.group.clone(true),instances=[];expanded.traverse(o=>{if(o.isInstancedMesh)instances.push(o);});
    const matrix=new T.Matrix4();
    for(const inst of instances){for(let i=0;i<inst.count;i++) {inst.getMatrixAt(i,matrix);const mesh=new T.Mesh(inst.geometry,inst.material);mesh.applyMatrix4(matrix);inst.parent.add(mesh);}inst.removeFromParent();}
    scenery.group.visible=false;scene.add(expanded);renderer.render(scene,camera);
    const beforeCalls=renderer.info.render.calls;
    if(renderer.info.render.triangles!==triangles)throw new Error('Batching dropped visual triangles');
    if(after>=beforeCalls*.8)throw new Error(`Static batching ineffective: ${beforeCalls} -> ${after}`);
    expanded.removeFromParent();scenery.dispose();renderer.dispose();
    return {rays,tested,linear,beforeCalls,after,triangles};
  },fixtures);
  assert.equal(result.rays,612);assert.deepEqual(errors,[]);
  console.log(`PASS: ${result.rays} Python/JS cover rays; grid tested ${result.tested}/${result.linear} candidates; identical Somme triangles with ${result.beforeCalls} -> ${result.after} draws; static matrices and adaptive/animation budgets`);
  await page.close();
}

export async function testLiveCover(context,origin) {
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/');await page.locator('#btn-mode-solo').waitFor({state:'visible',timeout:30000});
  await page.locator('#btn-mode-solo').click();await page.locator('#btn-deploy').click();
  await page.waitForFunction(()=>window.__trench?.app.playing&&window.__trench.app.net.lastMe?.alive,null,{timeout:45000});
  await page.evaluate(async()=>{
    const {app}=window.__trench,{World}=await import('/js/map.js');
    app.net._engine.py.runPython("import combat,game\n_host.room.match.drop_bots();_host.room.bots_on=False\ncombat.SOLID=[dict(t='wall',x=1.2,y=2,z=0,w=.02,h=4,d=10)];combat._build_grid();combat.GROUND_Y=combat.FLOOR_BASE=0\np=_host.room.match.players[1];p['pos']=[0,0,0]\ncover_target=_host.room.match.add_player('Covered',None);cover_target['team']=1-p['team'];cover_target['pos']=[10,0,0];cover_target['hp']=1000\ngame._seed_hist(cover_target,game.now_ms())");
    app.world.group.visible=false;app.renderer.setPixelRatio(.3);
    app.world=app.controls.world=new World(app.scene,{groundY:0,bounds:{minX:-60,maxX:60,minZ:-60,maxZ:60},boxes:[{t:'ground',x:0,y:-.5,z:0,w:150,h:1,d:150},{t:'wall',x:1.2,y:2,z:0,w:.02,h:4,d:10}]},app.data.combat);
    app.controls.reset([0,0,0],0);
    app.coverTraceEnds=[];
    const push=app.tracers.push.bind(app.tracers);
    app.tracers.push=(...entries)=>{for(const t of entries){const m=t.mesh,q=m.quaternion;app.coverTraceEnds.push(m.position.x+m.scale.z*(q.x*q.z+q.w*q.y));}return push(...entries);};
  });
  await page.locator('#game').click({position:{x:500,y:300}});await page.waitForFunction(()=>window.__trench.app.controls.locked);
  await page.evaluate(()=>{const {app}=window.__trench;app.controls.yaw=app.controls.pitch=0;app.controls.mouse.left=true;app.clickPending=true;});
  await page.waitForFunction(()=>window.__trench.app.tracerStats.spawned>0);
  await page.evaluate(()=>{
    const {app}=window.__trench;app.controls.mouse.left=false;
    if(!app.coverTraceEnds.length)throw new Error('No tracer inspected');
    for(const endpoint of app.coverTraceEnds)if(endpoint>1.191)throw new Error(`Tracer crossed cover: ${endpoint}`);
    if(!app.net._engine.py.runPython("cover_target['hp']==1000"))throw new Error('Live shot damaged a covered player');
    // Claim a nearby firing origin across a close thin wall. The authority
    // must reject the cover hop even when it is inside positional tolerance.
    app.net._engine.py.runPython("combat.SOLID=[dict(t='wall',x=.55,y=2,z=0,w=.02,h=4,d=10)];combat._build_grid();p['last_shot']=0");
    app.coverSeq=app.net._engine.py.runPython("p['shot_seq']");
    app.net.fire({x:1.1,y:1.58,z:0},{x:1,y:0,z:0});
  });
  await page.waitForFunction(()=>{const {app}=window.__trench;return app.net._engine.py.runPython("p['shot_seq']")>app.coverSeq;});
  assert.equal(await page.evaluate(()=>window.__trench.app.net._engine.py.runPython("cover_target['hp']==1000")),true);
  await page.evaluate(()=>{
    const {app}=window.__trench;app.net._engine.py.runPython("combat.SOLID=[];combat._build_grid();p['last_shot']=0");app.world.solid=[];app.world.grid.clear();
    app.controls.yaw=app.controls.pitch=0;app.controls.mouse.left=true;app.clickPending=true;
  });
  await page.waitForFunction(()=>window.__trench.app.net._engine.py.runPython("cover_target['hp']<1000"));
  await page.evaluate(()=>{const {app}=window.__trench;app.controls.mouse.left=false;app.controls.yaw=180;app.controls.pitch=0;});
  await page.waitForFunction(()=>window.__trench.app.performance.stats.poseSkips>0);
  assert.deepEqual(errors,[]);await page.close();
  console.log('PASS: actual-main covered shots/tracers stop at wall, forged origin cannot hop cover, open shots still hit and off-screen avatar poses are skipped');
}
