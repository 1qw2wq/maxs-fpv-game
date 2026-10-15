import assert from 'node:assert/strict';

async function touches(page) {
  const session=await page.context().newCDPSession(page), points=new Map();
  const send=type=>session.send('Input.dispatchTouchEvent',{type,touchPoints:[...points].map(([id,p])=>({id,...p,radiusX:6,radiusY:6,force:1}))});
  return {
    async down(id,x,y){points.set(id,{x,y});await send('touchStart');},
    async move(id,x,y){points.set(id,{x,y});await send('touchMove');},
    async up(id){const p=points.get(id);points.delete(id);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{id,...p}]});},
    async cancel(){points.clear();await send('touchCancel');},
    async tap(selector,id=20){const r=await page.locator(selector).boundingBox();assert.ok(r,selector);await this.down(id,r.x+r.width/2,r.y+r.height/2);await this.up(id);},
  };
}
const action=name=>`#mobile-controls [data-action="${name}"]`;
async function center(page,selector){const r=await page.locator(selector).boundingBox();assert.ok(r,selector);return {x:r.x+r.width/2,y:r.y+r.height/2,r:r.width*.36};}

export async function testMobile(browser, origin) {
  const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  await context.addInitScript(()=>{window.WebSocket=class{constructor(){throw Error('WebSocket disabled by test');}};});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(origin+'/__harness.html');
    await page.evaluate(async()=>{
      const meta=document.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';document.head.append(meta);
      const css=document.createElement('link');css.rel='stylesheet';css.href='/css/style.css';document.head.append(css);await new Promise(resolve=>css.onload=resolve);
      const T=await import('/vendor/three.module.js'),{Controls}=await import('/js/controls.js'),{World}=await import('/js/map.js'),{MobileControls}=await import('/js/mobile-controls.js');
      const data=await(await fetch('/shared/weapons.json')).json();
      const world=new World(new T.Scene(),{groundY:0,boxes:[{t:'ground',x:0,y:-.5,z:0,w:200,h:1,d:200}],bounds:{minX:-90,maxX:90,minZ:-90,maxZ:90}},data.combat);
      window.c=new Controls(document.querySelector('canvas'),world,data.combat,data);c.enabled=true;c.setClass(data.classes[0]);c.setMobileMode(true);c.reset([0,0,0],0);
      window.trace={};for(const [name,key] of Object.entries({fire:'onFireDown',reload:'onReload',ability:'onAbilityDown',abilityUp:'onAbilityUp',grenade:'onGrenadeDown',grenadeUp:'onGrenadeUp',cancel:'onAbilityCancel',cycle:'onGrenadeCycle',view:'onViewToggle'}))c[key]=()=>trace[name]=(trace[name]||0)+1;
      c.onScoreboard=show=>trace.score=show;
      window.mobile=new MobileControls(c,{onPause:()=>c.releaseLook()});mobile.update(true);document.body.classList.add('mobile-mode');
      window.lockRequests=0;c.canvas.requestPointerLock=()=>{lockRequests++;throw Error('Touch requested native lock');};
      window.flush=()=>{for(let i=0;i<60;i++)c.updateMouseLook(1/60);};
      // Analog speed, normalized diagonals, and touch jump share real physics.
      const runs=[];
      for(const hz of [30,60,144]){c.reset([0,0,0],0);c.touchMove.y=.4;for(let i=0;i<hz;i++)c.update(1/hz,true,false);runs.push(c.pos.x);}
      if(Math.max(...runs)-Math.min(...runs)>.05)throw Error('Touch movement depends on FPS: '+JSON.stringify(runs));
      const partial=runs[1];c.reset([0,0,0],0);c.touchMove.y=1;for(let i=0;i<60;i++)c.update(1/60,true,false);if(c.pos.x<partial*2.4)throw Error('Joystick loses analog magnitude');
      c.reset([0,0,0],0);c.touchKeys.add('Space');let jumps=0,ground=true;for(let i=0;i<240;i++){c.update(1/60,true,false);if(ground&&!c.grounded)jumps++;ground=c.grounded;}if(jumps!==1)throw Error('Touch jump auto-bounces');
      const turns=[];for(const fov of [78,18]){c.reset([0,0,0],0);c.lookFov=fov;c.touchLook(10,0);flush();turns.push(c.yaw);}if(Math.abs(turns[1]/turns[0]-Math.tan(18*Math.PI/360)/Math.tan(78*Math.PI/360))>1e-6)throw Error('Touch ADS sensitivity ignores zoom');
      c.lookFov=78;c.reset([0,0,0],0);
    });
    const touch=await touches(page),stick=await center(page,'.touch-stick');
    await touch.down(1,stick.x,stick.y);await touch.move(1,stick.x,stick.y-stick.r*1.5);
    assert.ok(await page.evaluate(()=>c.touchMove.y>.99 && Math.hypot(c.touchMove.x,c.touchMove.y)<=1.00001));
    await touch.down(2,490,235);await touch.move(2,550,215);
    await page.waitForFunction(()=>{c.update(1/60,true,false);return c.yaw>0 && c.pitch>0;});
    const fire=await center(page,action('fire'));
    await touch.down(3,fire.x,fire.y);
    assert.ok(await page.evaluate(()=>c.mouse.left && c.touchMove.y>.99 && trace.fire===1));
    await touch.up(2);await touch.up(3);
    assert.ok(await page.evaluate(()=>!c.mouse.left && c.touchMove.y>.99),JSON.stringify(await page.evaluate(()=>({move:c.touchMove,fire:c.mouse.left,pointers:[...mobile.pointers.values()].map(p=>p.action),trace}))));
    await page.evaluate(()=>flush());const yaw=await page.evaluate(()=>c.yaw);
    await touch.down(3,fire.x,fire.y);await touch.move(3,fire.x-30,fire.y+8);await page.waitForFunction(before=>{c.updateMouseLook(1/60);return c.yaw<before;},yaw);await page.evaluate(()=>flush());
    assert.ok(await page.evaluate(before=>c.mouse.left && c.yaw<before,yaw),'Fire finger must also aim');
    await touch.up(3);await touch.up(1);
    assert.equal(await page.evaluate(()=>Math.hypot(c.touchMove.x,c.touchMove.y)),0);
    for(const name of ['aim','crouch','reload','cycle','view'])await touch.tap(action(name));
    await page.evaluate(()=>{c.update(1/60,true,false);if(!c.ads || !c.crouch || trace.reload!==1 || trace.cycle!==1 || trace.view!==1)throw Error('Touch actions not wired');});
    await touch.tap(action('aim'));await touch.tap(action('crouch'));
    await touch.tap(action('grenade'));assert.equal(await page.evaluate(()=>trace.grenadeUp),1);
    const ability=await center(page,action('ability'));
    await touch.down(4,ability.x,ability.y);await touch.cancel();
    assert.ok(await page.evaluate(()=>trace.ability===1 && !trace.abilityUp && trace.cancel>0));
    const score=await center(page,action('score'));
    await touch.down(5,score.x,score.y);assert.equal(await page.evaluate(()=>trace.score),true);
    await touch.up(5);assert.equal(await page.evaluate(()=>trace.score),false);
    await touch.down(1,stick.x,stick.y-stick.r);await touch.down(3,fire.x,fire.y);
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await touch.cancel();
    assert.ok(await page.evaluate(()=>!c.mouse.left && !c.mouse.right && c.touchKeys.size===0 && c.touchMove.y===0 && mobile.pointers.size===0 && !c.canLook));
    await touch.down(1,stick.x,stick.y-stick.r);await touch.down(3,fire.x,fire.y);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await touch.cancel();
    assert.ok(await page.evaluate(()=>!c.canLook && !c.mouse.left && !c.touchMove.y && mobile.pointers.size===0));
    await touch.tap(action('pause'));
    assert.ok(await page.evaluate(()=>!c.canLook && mobile.pointers.size===0));
    await page.evaluate(()=>{if(lockRequests || document.pointerLockElement)throw Error('Touch mode used pointer lock');c.setMobileMode(false);mobile.update(true);const yaw=c.yaw;window.dispatchEvent(new MouseEvent('mousemove',{movementX:100}));c.updateMouseLook(1/60);if(c.canLook || c.yaw!==yaw || !mobile.root.classList.contains('hidden'))throw Error('Desktop fallback/cursor steering enabled');});
    console.log('PASS: real multi-touch joystick + aim/fire, analog/FPS/ADS precision, jump, all touch actions, cancellation/resize and desktop isolation');

    await page.goto(origin+'/');await page.locator('#boot').waitFor({state:'hidden',timeout:30000});
    assert.equal(await page.evaluate(()=>window.__trench.app.controls.mobileMode),true,'Coarse touch device not auto-detected');
    await page.locator('.control-mode').first().selectOption('mobile');await page.reload();await page.locator('#boot').waitFor({state:'hidden',timeout:30000});
    assert.equal(await page.locator('.control-mode').first().inputValue(),'mobile');
    await page.locator('#btn-mode-solo').tap();await page.locator('#btn-deploy').tap();
    await page.waitForFunction(()=>window.__trench?.app.playing && window.__trench.app.net.lastMe?.alive && window.__trench.app.mobile.visible,null,{timeout:45000});
    await page.evaluate(async()=>{
      const {app}=window.__trench,{World}=await import('/js/map.js');
      app.net._engine.py.runPython('_host.room.match.drop_bots();_host.room.bots_on=False');
      app.world.group.visible=false;app.renderer.setPixelRatio(.3);
      app.world=app.controls.world=new World(app.scene,{groundY:0,boxes:[{t:'ground',x:0,y:-.5,z:0,w:200,h:1,d:200}],bounds:{minX:-90,maxX:90,minZ:-90,maxZ:90}},app.data.combat);app.world.group.visible=false;
      app.controls.reset([0,0,0],0);app.grenadeKind='smoke';
      if(document.pointerLockElement || !app.controls.canLook || !app.hud.el.lock.classList.contains('hidden'))throw Error('Mobile deploy blocked by mouse lock');
      app.tut.open();if(!document.querySelector('#tutorial').textContent.match(/joystick|摇杆/i))throw Error('Tutorial still describes keyboard-only movement');app.tut.close();
    });
    const liveTouch=await touches(page),liveStick=await center(page,'.touch-stick');
    await liveTouch.down(1,liveStick.x,liveStick.y-liveStick.r);
    await page.waitForFunction(()=>window.__trench.app.controls.pos.x>1);
    await liveTouch.up(1);
    const mag=await page.evaluate(()=>window.__trench.app.net.lastMe.mag);
    await liveTouch.tap(action('fire'));
    await page.waitForFunction(before=>window.__trench.app.net.lastMe.mag<before,mag);
    await liveTouch.tap(action('reload'));await page.waitForFunction(()=>window.__trench.app.net.lastMe.reloading);
    await liveTouch.tap(action('aim'));await page.waitForFunction(()=>window.__trench.app.controls.mouse.right);
    await liveTouch.tap(action('view'));assert.equal(await page.evaluate(()=>window.__trench.app.cameraMode),'tp');
    await liveTouch.tap(action('cycle'));
    const inventory=await page.evaluate(()=>window.__trench.app.net.lastMe.grenades),grenade=await center(page,action('grenade'));
    await liveTouch.down(4,grenade.x,grenade.y);
    await page.waitForFunction(()=>window.__trench.app.charge?.source==='grenade');
    await liveTouch.up(4);await page.waitForFunction(before=>window.__trench.app.net.lastMe.grenades===before-1,inventory);
    // Pause while charging: cancellation, not an unintended extra throw.
    await liveTouch.down(4,grenade.x,grenade.y);await page.waitForFunction(()=>!!window.__trench.app.charge);
    await liveTouch.tap(action('pause'),5);await liveTouch.cancel();
    await page.waitForFunction(()=>window.__trench.app.paused && !window.__trench.app.mobile.visible);
    assert.ok(await page.evaluate(()=>!window.__trench.app.charge && !window.__trench.app.controls.mouse.left && window.__trench.app.controls.touchKeys.size===0));
    await page.locator('#btn-pause-resume').tap();await page.waitForFunction(()=>!window.__trench.app.paused && window.__trench.app.controls.canLook && window.__trench.app.mobile.visible);
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>window.__trench.app.mobile.visible);
    for(const name of ['fire','aim','reload','jump','ability','grenade','crouch','cycle','score','view','chat','pause']) {
      const box=await page.locator(action(name)).boundingBox();assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=390.1 && box.y+box.height<=844.1,`${name} is outside portrait viewport`);
    }
    if(process.env.MOBILE_SCREENSHOT)await page.screenshot({path:process.env.MOBILE_SCREENSHOT});
    const liveScore=await center(page,action('score'));
    await liveTouch.down(7,liveScore.x,liveScore.y);await page.locator('#scoreboard').waitFor({state:'visible'});
    await liveTouch.up(7);await page.locator('#scoreboard').waitFor({state:'hidden'});
    await liveTouch.tap(action('chat'));await page.locator('input[maxlength="120"]').fill('Mobile chat check');await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#chat-log').textContent.includes('Mobile chat check'));
    const portraitFire=await center(page,action('fire'));
    await liveTouch.down(6,portraitFire.x,portraitFire.y);
    await page.evaluate(()=>{const {app}=window.__trench;app.net._engine.py.runPython(`import game\np=_host.room.match.players[${app.myId}];p['alive']=False;p['hp']=0;p['respawn_at']=game.now_ms()-1`);});
    await page.waitForFunction(()=>window.__trench.app.deathShown && !window.__trench.app.mobile.visible);await liveTouch.cancel();
    assert.ok(await page.evaluate(()=>!window.__trench.app.controls.mouse.left && !window.__trench.app.controls.canLook));
    await page.locator('#btn-respawn').tap();await page.waitForFunction(()=>!window.__trench.app.deathShown && window.__trench.app.mobile.visible && window.__trench.app.controls.canLook);

    await page.evaluate(()=>{const s=document.querySelector('.control-mode');s.value='desktop';s.dispatchEvent(new Event('change'));});
    await page.waitForFunction(()=>!window.__trench.app.mobile.visible);
    assert.equal(await page.evaluate(()=>window.__trench.app.controls.mobileMode),false);
    await page.evaluate(()=>{const s=document.querySelector('.control-mode');s.value='mobile';s.dispatchEvent(new Event('change'));});await page.waitForFunction(()=>window.__trench.app.mobile.visible);
    await liveTouch.tap(action('pause'));await page.locator('#btn-pause-leave').tap();
    await page.waitForFunction(()=>!window.__trench.app.playing && !window.__trench.app.mobile.visible && !window.__trench.app.controls.enabled);

    assert.deepEqual(errors,[]);
    console.log('PASS: actual mobile auto-detect/saved mode, touch deploy/movement/fire/reload/ADS/view/grenades/pause, portrait buttons and no pointer-lock prompt');
  } finally {
    // The bundled Chromium uses --single-process. Destroying an isolated
    // context while other WebRTC contexts are live can crash that process;
    // close the page now and let the runner's browser.close() own the context.
    await page.close();
  }
}
