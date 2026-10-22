import assert from 'node:assert/strict';

async function touches(page) {
  const session=await page.context().newCDPSession(page), points=new Map();
  const send=type=>session.send('Input.dispatchTouchEvent',{type,touchPoints:[...points].map(([id,p])=>({id,...p,radiusX:6,radiusY:6,force:1}))});
  return {
    async down(id,x,y){points.set(id,{x,y});await send('touchStart');},
    async move(id,x,y){points.set(id,{x,y});await send('touchMove');},
    async up(id){const p=points.get(id);points.delete(id);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:points.size?[{id,...p}]:[]});},
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
      window.trace={};for(const [name,key] of Object.entries({fire:'onFireDown',reload:'onReload',ability:'onAbilityDown',abilityUp:'onAbilityUp',grenade:'onGrenadeDown',grenadeUp:'onGrenadeUp',cancel:'onAbilityCancel',cycle:'onGrenadeCycle',mask:'onMaskToggle',view:'onViewToggle'}))c[key]=()=>trace[name]=(trace[name]||0)+1;
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
    await page.evaluate(()=>flush());const handoffYaw=await page.evaluate(()=>c.yaw);
    await touch.up(2);await touch.move(3,fire.x-25,fire.y);
    await page.waitForFunction(before=>{c.updateMouseLook(1/60);return c.yaw<before;},handoffYaw);
    assert.ok(await page.evaluate(()=>c.mouse.left && c.touchMove.y>.99),'Aim handoff must retain fire and movement');
    await touch.up(3);
    assert.ok(await page.evaluate(()=>!c.mouse.left && c.touchMove.y>.99),JSON.stringify(await page.evaluate(()=>({move:c.touchMove,fire:c.mouse.left,pointers:[...mobile.pointers.values()].map(p=>p.action),trace}))));
    await page.evaluate(()=>flush());const yaw=await page.evaluate(()=>c.yaw);
    await touch.down(3,fire.x,fire.y);await touch.move(3,fire.x-30,fire.y+8);await page.waitForFunction(before=>{c.updateMouseLook(1/60);return c.yaw<before;},yaw);await page.evaluate(()=>flush());
    assert.ok(await page.evaluate(before=>c.mouse.left && c.yaw<before,yaw),'Fire finger must also aim');
    await touch.up(3);await touch.up(1);
    assert.equal(await page.evaluate(()=>Math.hypot(c.touchMove.x,c.touchMove.y)),0);
    for(const name of ['aim','crouch','reload','cycle','mask','view'])await touch.tap(action(name));
    await page.evaluate(()=>{c.update(1/60,true,false);if(!c.ads || !c.crouch || trace.reload!==1 || trace.cycle!==1 || trace.mask!==1 || trace.view!==1)throw Error('Touch actions not wired');});
    await touch.tap(action('aim'));await touch.tap(action('crouch'));
    await page.evaluate(()=>c.reset([0,0,0],0));
    await touch.tap(action('jump'));
    await page.evaluate(()=>{c.update(1/60,true,false);if(c.grounded || c.vy<=0)throw Error('Quick touch jump was lost between frames');c.reset([0,0,0],0);});
    await page.evaluate(()=>{
      mobile.press('fire');mobile.release('fire',false);
      if(c.mouse.left || !c.touchFirePending)throw Error('Quick fire tap was lost');
      c.releaseLook();if(c.touchFirePending)throw Error('Released controls retained a queued shot');
      c.requestLock();mobile.press('fire');mobile.release('fire',true);
      if(c.touchFirePending)throw Error('Canceled touch queued a shot');
      mobile.press('jump');mobile.release('jump',true);c.update(1/60,true,false);
      if(!c.grounded)throw Error('Canceled touch queued a jump');
    });
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
    console.log('PASS: real multi-touch aim handoff, quick jump/fire/cancel, joystick + aim/fire, analog/FPS/ADS precision, jump, all touch actions, cancellation/resize and desktop isolation');

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
    await page.waitForFunction(()=>{const {app}=window.__trench;return app.controls.sprinting && app.net._engine.py.runPython(`_host.room.match.players[${app.myId}]['flags'].get('sprint',False)`);});
    await liveTouch.tap(action('aim'),2);
    await page.waitForFunction(()=>{const {app}=window.__trench;return app.controls.ads && !app.controls.sprinting && app.controls.moveSpeed<app.data.combat.maxMoveSpeed*.75;});
    await liveTouch.tap(action('aim'),2);
    await page.waitForFunction(()=>!window.__trench.app.controls.ads && !window.__trench.app.controls.sprinting);
    await liveTouch.up(1);
    assert.ok(await page.evaluate(()=>window.__trench.app.controls.touchSprintAt===null));
    const mag=await page.evaluate(()=>window.__trench.app.net.lastMe.mag);
    await liveTouch.tap(action('fire'));
    await page.waitForFunction(before=>window.__trench.app.net.lastMe.mag<before,mag);
    // Begin/end the trigger in one JS task, so no render frame can see held
    // state. The live authority must still accept exactly one queued tap.
    await page.waitForFunction(()=>!window.__trench.app.controls.mouse.left && ![...window.__trench.app.mobile.pointers.values()].some(p=>p.action==='fire'));
    const quickMag=await page.evaluate(()=>{
      const {app}=window.__trench;
      // Settle earlier commands and open both rate gates. This test isolates
      // a between-frame tap, not client/engine clock skew on software WebGL.
      app.net._flush();app.nextShot=0;
      const before=Number(app.net._engine.py.runPython(`p=_host.room.match.players[${app.myId}];p['last_shot']=0\nint(p['mag'])`));
      app.mobile.press('fire');app.mobile.release('fire',false);
      return before;
    });
    try { await page.waitForFunction(before=>window.__trench.app.net.lastMe.mag===before-1,quickMag); }
    catch(error) {
      console.error('MOBILE QUICK TAP',await page.evaluate(()=>{const {app}=window.__trench;return {me:app.net.lastMe,pending:app.controls.touchFirePending,held:app.controls.mouse.left,look:app.controls.canLook,paused:app.paused,click:app.clickPending,visible:app.mobile.visible,queue:app.net._queue,authority:app.net._engine.py.runPython(`str(_host.room.match.players[${app.myId}]['mag'])`)};}));
      throw error;
    }
    const original=await page.evaluate(()=>{const me=window.__trench.app.net.lastMe;return {c:me.c,w:me.w,mag:me.mag,reserve:me.reserve};});
    await page.evaluate(()=>{const {app}=window.__trench;app.net._engine.py.runPython(`p=_host.room.match.players[${app.myId}];p['cls']='scout';p['weapon']='sentinel';p['mag']=5;p['reserve']=40;p['last_shot']=0`);});
    await page.waitForFunction(()=>window.__trench.app.net.lastMe.w==='sentinel' && window.__trench.app.vm.weapon.id==='sentinel');
    await page.evaluate(()=>{const {app}=window.__trench;app.nextShot=0;app.boltWait=false;app.mobile.press('fire');app.mobile.release('fire',false);});
    await page.waitForFunction(()=>window.__trench.app.net.lastMe.mag===4);
    await liveTouch.tap(action('aim'));
    await page.waitForFunction(()=>document.body.classList.contains('scope-active'));
    assert.ok(await page.evaluate(()=>{
      const {app}=window.__trench,button=document.querySelector('#mobile-controls [data-action="aim"]'),b=button.getBoundingClientRect(),lens=document.querySelector('.scope-lens').getBoundingClientRect();
      return !app.vm.root.visible && !app.fpArms?.holder.visible && Math.abs(lens.width-lens.height)<1 && document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===button;
    }),'Mobile scope must stay circular and leave touch controls visible/clickable');
    await liveTouch.tap(action('aim'));
    await page.waitForFunction(()=>document.getElementById('scope-overlay').classList.contains('hidden'));
    // Scope ownership is per weapon, not the Scout class, on touch too.
    for(const id of ['awp','longbow','smle','m95','springfield']) {
      await page.evaluate(id=>{const {app}=window.__trench;app.net._engine.py.runPython(`p['weapon']='${id}'`);},id);
      await page.waitForFunction(id=>{const {app}=window.__trench;return app.net.lastMe.w===id && app.vm.weapon.id===id;},id);
      await liveTouch.tap(action('aim'));
      await page.waitForFunction(()=>window.__trench.app.controls.ads);
      assert.ok(await page.evaluate(()=>{
        const {app}=window.__trench,expected=app.vm.weapon.scope===true;
        return document.body.classList.contains('scope-active')===expected && app.vm.root.visible!==expected;
      }),`${id}: incorrect touch scope/iron-sight presentation`);
      await liveTouch.tap(action('aim'));
      await page.waitForFunction(()=>!window.__trench.app.controls.ads);
    }
    await page.evaluate(saved=>{const {app}=window.__trench;app.boltWait=false;app.nextShot=0;app.net._engine.py.runPython(`p=_host.room.match.players[${app.myId}];p['cls']='${saved.c}';p['weapon']='${saved.w}';p['mag']=${saved.mag};p['reserve']=${saved.reserve};p['last_shot']=0`);},original);
    await page.waitForFunction(id=>window.__trench.app.net.lastMe.w===id && window.__trench.app.vm.weapon.id===id,original.w);
    await liveTouch.tap(action('reload'));await page.waitForFunction(()=>window.__trench.app.net.lastMe.reloading);
    await liveTouch.tap(action('aim'));await page.waitForFunction(()=>window.__trench.app.controls.mouse.right);
    await liveTouch.tap(action('view'));assert.equal(await page.evaluate(()=>window.__trench.app.cameraMode),'tp');
    await liveTouch.tap(action('mask'));
    await page.waitForFunction(()=>__trench.app.net.lastMe.maskProtected===1);
    assert.equal(await page.locator(action('mask')).getAttribute('aria-pressed'),'true');
    await liveTouch.tap(action('mask'));
    await page.waitForFunction(()=>__trench.app.net.lastMe.mask===0);
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
    // Exercise the actual pause-menu editor with real touch capture, not only
    // a mouse-driven layout fixture. A drag must not fire while paused.
    const beforeEdit=await page.evaluate(()=>window.__trench.app.net.lastMe.mag);
    await page.locator('#btn-touch-layout').tap();
    await page.waitForFunction(()=>window.__trench.app.mobile.editing && window.__trench.app.mobile.visible);
    const editFire=await center(page,action('fire'));
    await liveTouch.down(8,editFire.x,editFire.y);await liveTouch.move(8,300,200);await liveTouch.up(8);
    assert.ok(await page.evaluate(()=>window.__trench.app.mobile.layout.landscape.fire && !window.__trench.app.controls.mouse.left));
    await page.locator('[data-layout="save"]').tap();
    await page.waitForFunction(()=>!window.__trench.app.mobile.editing && !document.getElementById('pause').classList.contains('hidden'));
    assert.equal(await page.evaluate(()=>window.__trench.app.net.lastMe.mag),beforeEdit);
    assert.ok(await page.evaluate(async()=>!!(await import('/js/profile.js')).load().touchLayout.landscape.fire));
    // Restore native placement for the viewport/overlap checks below.
    await page.locator('#btn-touch-layout').tap();await page.locator('[data-layout="reset"]').tap();await page.locator('[data-layout="save"]').tap();
    await page.locator('#btn-pause-resume').tap();await page.waitForFunction(()=>!window.__trench.app.paused && window.__trench.app.controls.canLook && window.__trench.app.mobile.visible);
    // Deploy/Resume now really enter fullscreen. Exit it before Playwright's
    // desktop-window resize used to emulate orientation changes.
    await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>window.__trench.app.mobile.visible);
    for(const name of ['fire','aim','reload','jump','ability','grenade','crouch','cycle','mask','score','view','chat','pause']) {
      const box=await page.locator(action(name)).boundingBox();assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=390.1 && box.y+box.height<=844.1,`${name} is outside portrait viewport`);
    }
    for(const viewport of [{width:320,height:568},{width:568,height:320},{width:844,height:390},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      const failures=await page.evaluate(()=>{
        const {app}=window.__trench;
        document.querySelector('#tb-score-0').textContent='75';document.querySelector('#tb-score-1').textContent='75';
        const errors=[], rect=el=>el.getBoundingClientRect();
        const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
        const buttons=[...document.querySelectorAll('#mobile-controls button')];
        for(const button of buttons) {
          const r=rect(button),name=button.dataset.action;
          if(r.width<44 || r.height<44 || r.left<0 || r.top<0 || r.right>innerWidth+.1 || r.bottom>innerHeight+.1)errors.push(name+' out of bounds or too small');
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          if(hit!==button)errors.push(name+' is covered by '+hit?.className);
          for(const other of buttons)if(other!==button && overlap(r,rect(other)))errors.push(name+' overlaps '+other.dataset.action);
          if(overlap(r,rect(app.mobile.stick)))errors.push(name+' overlaps joystick');
        }
        for(const tool of document.querySelectorAll('.touch-tools button'))if(overlap(rect(tool),rect(document.querySelector('#topbar'))))errors.push('Tools overlap score HUD');
        if(overlap(rect(document.querySelector('.touch-fire')),rect(document.querySelector('.ammo-wrap'))))errors.push('Fire covers ammo');
        if(overlap(rect(app.mobile.stick),rect(document.querySelector('#grenade-chip'))))errors.push('Joystick covers grenade inventory');
        return errors;
      });
      assert.deepEqual(failures,[],`Mobile layout at ${viewport.width}x${viewport.height}`);
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
    console.log('PASS: actual mobile auto-detect/saved mode, native fullscreen, timed sprint/ADS, sniper scope, touch drag/save editor, combat/pause, 320px/short-landscape targets and no pointer-lock prompt');
  } catch(error) {
    console.log('MOBILE DEBUG',await page.evaluate(()=>{const a=window.__trench?.app;return {width:innerWidth,height:innerHeight,editing:a?.mobile.editing,status:document.querySelector('.layout-status')?.textContent,items:a?.mobile.items.map(el=>({name:el.dataset.action||el.dataset.touch,rect:el.getBoundingClientRect().toJSON()}))};}));
    await page.screenshot({path:'/tmp/gas-mobile-failure.png'});throw error;
  } finally {
    // The bundled Chromium uses --single-process. Destroying an isolated
    // context while other WebRTC contexts are live can crash that process;
    // close the page now and let the runner's browser.close() own the context.
    await page.close();
  }
}
