import assert from 'node:assert/strict';

// Real DOM editor plus movement/fullscreen boundary tests, without an engine.
export async function testMobileFeatures(context, origin) {
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:844,height:390});
  await page.route('**/js/main.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.goto(origin+'/');
  const movement = await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js');
    const {Controls}=await import('/js/controls.js'),{World}=await import('/js/map.js');
    const {MobileControls}=await import('/js/mobile-controls.js');
    const {loadConfig}=await import('/js/config.js'),{Hud}=await import('/js/hud.js');
    window.profile=await import('/js/profile.js');
    const data=await loadConfig(), combat=data.combat;
    const world=new World(new T.Scene(),{groundY:0,boxes:[{t:'ground',x:0,y:-.5,z:0,w:200,h:1,d:200}],bounds:{minX:-90,maxX:90,minZ:-90,maxZ:90}},combat);
    window.c=new Controls(document.getElementById('game'),world,combat,data);
    c.enabled=true; c.setClass(data.classes[0]); c.setMobileMode(true); c.requestLock();
    let now=1000; c.inputNow=()=>now;
    const run=()=>{for(let i=0;i<120;i++)c.update(1/120,true,false);return c.moveSpeed;};
    c.keys.add('KeyW'); const walk=run();
    c.keys.add('ShiftLeft'); const sprint=run();
    if(!c.sprinting || c.crouch || Math.abs(sprint/walk-combat.sprintMult)>.001)throw new Error('Shift must sprint, not crouch');
    c.mouse.right=true;const ads=run();
    if(c.sprinting || !c.ads || Math.abs(ads/walk-combat.adsMoveMult)>.001)throw new Error('ADS must override sprint and slow movement');
    c.mouse.right=false;c.keys.add('KeyC');run();
    if(c.sprinting || !c.crouch)throw new Error('C must crouch and prevent sprint');
    c.keys.clear();c.touchMove.y=1;run();
    now+=1499;run();if(c.sprinting)throw new Error('Touch sprint started before 1.5 seconds');
    now+=2;run();if(!c.sprinting)throw new Error('Touch sprint did not start after 1.5 seconds');
    c.mouse.right=true;run();if(c.sprinting || c.touchSprintAt!==null)throw new Error('Touch ADS retained sprint');
    c.releaseLook();if(c.sprinting || c.touchSprintAt!==null)throw new Error('Release retained sprint timer');
    c.mouse.right=false;c.requestLock();c.touchMove.y=1;run();
    if(c.sprinting)throw new Error('Touch sprint timer did not reset');
    c.touchMove.y=0;run();if(c.sprinting || c.touchSprintAt!==null)throw new Error('Neutral joystick retained sprint');
    const bad=profile.sanitize({touchLayout:{landscape:{fire:{x:Infinity,y:0},move:{x:-2,y:4},evil:{x:1,y:1}}}}).touchLayout;
    if(bad.landscape.fire || bad.landscape.evil || bad.landscape.move.x!==0 || bad.landscape.move.y!==1)throw new Error('Invalid touch layout accepted');
    window.hud=new Hud(data);hud.screen('game');document.body.classList.add('mobile-mode');
    window.mobile=new MobileControls(c,{parent:hud.el.hud,onLayoutSave:touchLayout=>profile.save({touchLayout})});
    mobile.update(true);mobile.editLayout(()=>{});
    return {walk,sprint,ads};
  });
  assert.ok(movement.sprint>movement.walk && movement.ads<movement.walk);
  // Native pointer events/capture drag a real button without firing the gun.
  const dragTarget=await page.evaluate(()=>{
    const fire=mobile.root.querySelector('[data-action="fire"]'),a=fire.getBoundingClientRect();
    const rects=mobile.items.filter(el=>el!==fire).map(el=>el.getBoundingClientRect());
    for(let y=180;y<innerHeight-70;y+=45)for(let x=250;x<innerWidth-160;x+=50) {
      if(rects.every(b=>x+a.width/2+6<b.left || x-a.width/2-6>b.right || y+a.height/2+6<b.top || y-a.height/2-6>b.bottom))return {sx:a.x+a.width/2,sy:a.y+a.height/2,x,y};
    }
    throw new Error('No free layout target');
  });
  await page.mouse.move(dragTarget.sx,dragTarget.sy);await page.mouse.down();
  await page.mouse.move(dragTarget.x,dragTarget.y,{steps:8});await page.mouse.up();
  assert.ok(await page.evaluate(()=>!c.mouse.left && !c.touchFirePending && mobile.layout.landscape.fire));
  await page.locator('[data-layout="save"]').click();
  assert.ok(await page.evaluate(()=>!mobile.editing && !document.body.classList.contains('layout-editing')));
  const saved=await page.evaluate(()=>profile.load().touchLayout.landscape.fire);
  assert.ok(Math.abs(saved.x*844-dragTarget.x)<1);
  await page.evaluate(()=>{
    const p=profile.load();p.touchLayout.landscape.fire.x=0;
    if(profile.load().touchLayout.landscape.fire.x===0)throw new Error('Profile layout leaks mutable state');
    mobile.editLayout(()=>{});
    mobile.layout.landscape.aim={...mobile.layout.landscape.fire};mobile.applyLayout();
  });
  await page.locator('[data-layout="save"]').click();
  assert.ok(await page.evaluate(()=>mobile.editing && !!mobile.editor.querySelector('.layout-status').textContent));
  await page.locator('[data-layout="cancel"]').click();
  assert.deepEqual(await page.evaluate(()=>mobile.layout.landscape.fire),saved);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>!Object.keys(mobile.layout.portrait).length));
  await page.setViewportSize({width:844,height:390});
  assert.deepEqual(await page.evaluate(()=>mobile.layout.landscape.fire),saved);
  await page.evaluate(()=>mobile.editLayout(()=>{}));
  await page.locator('[data-layout="reset"]').click();await page.locator('[data-layout="save"]').click();
  assert.ok(await page.evaluate(()=>!Object.keys(profile.load().touchLayout.landscape).length));
  const fullscreen=await page.evaluate(async()=>{
    const {requestMobileFullscreen}=await import('/js/mobile-fullscreen.js');
    let calls=0, notes=[];const root=document.documentElement;
    const native=root.requestFullscreen, webkit=root.webkitRequestFullscreen;
    root.requestFullscreen=async options=>{calls++;if(options.navigationUI!=='hide')throw new Error('Wrong fullscreen options');};
    await requestMobileFullscreen(false);if(calls)throw new Error('Desktop requested mobile fullscreen');
    if(!await requestMobileFullscreen(true))throw new Error('Supported fullscreen rejected');
    root.requestFullscreen=async()=>{throw new Error('Iframe permission denied');};
    if(await requestMobileFullscreen(true,text=>notes.push(text)))throw new Error('Denied fullscreen reported success');
    root.requestFullscreen=undefined;root.webkitRequestFullscreen=undefined;
    if(await requestMobileFullscreen(true,text=>notes.push(text)))throw new Error('Unsupported fullscreen reported success');
    root.requestFullscreen=native;root.webkitRequestFullscreen=webkit;
    return {calls,notes:notes.length};
  });
  assert.deepEqual(fullscreen,{calls:1,notes:2});
  assert.deepEqual(errors,[]);await page.close();
  console.log('PASS: Shift/timed joystick sprint, ADS/crouch priority, editor drag/save/cancel/reset/collision/rotation, persistent sanitized layouts, fullscreen support/denial');
}
