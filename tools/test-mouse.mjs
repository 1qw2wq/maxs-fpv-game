import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function testMouseMath() {
  const source = await readFile(new URL('../public/js/mouse-look.js', import.meta.url), 'utf8');
  const { MouseLook } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const k = .0022 * 57.2958;
  const look = new MouseLook();
  look.reset(0);
  for (const [x,y] of [[NaN,0],[0,Infinity],[4000,-3000],[150,0]]) look.push(x,y,k,10);
  assert.deepEqual(look.consume(1/60), {yaw:0,pitch:0});
  assert.equal(look.rejected, 4);
  look.push(10,-5,k,20); // Do not discard ordinary first movement.
  const first = look.consume(1/60);
  assert.ok(first.yaw > 0 && first.pitch > 0);
  look.reset(0);
  look.push(4000,3000,k,1000); // Also reject warps well after acquisition.
  assert.deepEqual(look.consume(1/60), {yaw:0,pitch:0});
  for (const hz of [24,60,144]) {
    look.reset(0);
    let yaw=0, pitch=0;
    for (let frame=0;frame<hz;frame++) {
      for(let packet=0;packet<8;packet++) look.push(32/hz/8,16/hz/8,k,1000);
      const delta=look.consume(1/hz);yaw+=delta.yaw;pitch+=delta.pitch;
    }
    for(let frame=0;frame<120;frame++) { const d=look.consume(1/hz);yaw+=d.yaw;pitch+=d.pitch; }
    assert.ok(Math.abs(yaw-32*k)<1e-8, `yaw precision at ${hz}Hz`);
    assert.ok(Math.abs(pitch+16*k)<1e-8, `pitch precision at ${hz}Hz`);
  }
  look.reset(0);
  for(let i=0;i<40;i++) look.push(10,0,k,1000); // A genuine 50-degree fast flick.
  let total=0;
  for(let i=0;i<60;i++) { const d=look.consume(1/60);assert.ok(Math.abs(d.yaw)<=18.00001);total+=d.yaw; }
  assert.ok(Math.abs(total-400*k)<1e-8, 'normal flick travel must not be lost');
  for(let i=0;i<8000;i++) look.push(20,-10,k,1000);
  assert.ok(Math.hypot(look.yaw,look.pitch)<=60.00001);
  assert.ok(Math.hypot(...Object.values(look.consume(5)))<=18.00001, 'stalled frame snaps');
  look.reset(0);
  assert.deepEqual(look.consume(1/60),{yaw:0,pitch:0},'release must clear deferred input');
  look.push(20,0,k,1000);
  assert.deepEqual(look.consume(NaN),{yaw:0,pitch:0});
  assert.deepEqual(look.consume(-1),{yaw:0,pitch:0});
  console.log('PASS: mouse spike/NaN/lock guards, 24/60/144Hz precision, fast flicks, bounded backlog and reset');
}

export async function testMouseControls(context, origin) {
  await testMouseMath();
  const page=await context.newPage();
  await page.goto(origin+'/__harness.html');
  await page.evaluate(async()=>{
    const {Controls}=await import('/js/controls.js');
    window.controls=new Controls(document.querySelector('canvas'),null,{},{});
    controls.enabled=true;
  });
  await page.locator('canvas').click();
  await page.waitForFunction(()=>controls.locked && document.pointerLockElement===controls.canvas);
  await page.evaluate(()=>{
    const c=controls, move=(x,y=0)=>window.dispatchEvent(new MouseEvent('mousemove',{movementX:x,movementY:y}));
    const flush=()=>{ for(let i=0;i<60;i++) c.updateMouseLook(1/60); };
    c.mouseLook.reset();c.yaw=c.pitch=0;
    move(1200,800);flush();
    if(c.yaw!==0 || c.pitch!==0)throw Error('Native lock warp moved the view');
    move(10,-5);c.update(1/60,true,false);
    if(!(c.yaw>0 && c.pitch>0))throw Error('Normal locked mouse input lost');
    c.mouseLook.reset();c.yaw=c.pitch=0;c.mouseLook.guardUntil=0;
    for(let i=0;i<40;i++)move(10);
    const before=c.yaw;c.updateMouseLook(1/60);
    if(c.yaw-before>18.00001)throw Error('Burst snapped the camera');
    flush();
    if(Math.abs(c.yaw-400*c.sensitivity*57.2958)>1e-6)throw Error('Fast flick lost precision');
    c.mouseLook.reset();c.yaw=c.pitch=0;
    move(10,-10);window.dispatchEvent(new Event('resize'));flush();
    if(c.yaw || c.pitch)throw Error('Resize retained stale deltas');
    c.pitch=87.9;move(0,-90);flush();
    if(c.pitch!==88 || c.mouseLook.pitch!==0)throw Error('Pitch limit retains deferred upward motion');
    move(0,1);flush();if(c.pitch>=88)throw Error('Pitch sticks at limit');
    move(40);c.releaseLook();c.updateMouseLook(1/60);
    if(c.mouseLook.yaw || c.mouseLook.pitch)throw Error('Release retains deltas');
    const yaw=c.yaw;move(10);flush();if(c.yaw!==yaw)throw Error('Unlocked cursor steers view');
  });
  await page.close();
  console.log('PASS: actual native-lock mouse integration, spike/flick/resize/pitch/reset and no unlocked steering');
}

if(process.argv[1]===fileURLToPath(import.meta.url)) await testMouseMath();

export async function testMouseSettings(context, origin) {
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/');
  await page.locator('#btn-mode-solo').waitFor({state:'visible',timeout:30000});
  await page.locator('#boot').waitFor({state:'hidden',timeout:30000});
  await page.evaluate(()=>{
    const slider=document.querySelector('.mouse-sensitivity');slider.value='65';slider.dispatchEvent(new Event('input'));
    if(Math.abs(window.__trench.app.controls.sensitivity-.0022*.65)>1e-10)throw Error('Sensitivity not applied');
    for(const s of document.querySelectorAll('.mouse-sensitivity'))if(s.value!=='65' || s.closest('label').querySelector('output').textContent!=='65%')throw Error('Menu/pause sensitivity out of sync');
  });
  await page.reload();
  await page.locator('#btn-mode-solo').waitFor({state:'visible',timeout:30000});
  await page.locator('#boot').waitFor({state:'hidden',timeout:30000});
  assert.equal(await page.locator('.mouse-sensitivity').first().inputValue(),'65');
  assert.ok(Math.abs(await page.evaluate(()=>window.__trench.app.controls.sensitivity)-.0022*.65)<1e-10);
  // Restore the shared test context's default for subsequent gun/aim tests.
  await page.evaluate(()=>{const s=document.querySelector('.mouse-sensitivity');s.value='100';s.dispatchEvent(new Event('input'));});
  await page.locator('#btn-mode-solo').click();await page.locator('#btn-deploy').click();
  await page.waitForFunction(()=>window.__trench?.app.playing && window.__trench.app.net.lastState?.ps?.some(p=>p.ai),null,{timeout:45000});
  await page.evaluate(()=>{
    const {app}=window.__trench,rows=app.net.lastState.ps;
    const tiers=new Set(rows.filter(p=>p.ai).map(p=>p.ai));
    if(tiers.size<2 || !tiers.has('recruit') || !tiers.has('regular'))throw Error('Live roster lacks mixed skill bots');
    if(rows.filter(p=>p.ai==='veteran').length>=rows.filter(p=>p.ai).length/2)throw Error('Veterans dominate the roster');
    app.hud.scoreboard(true,rows,app.net.lastState,app.myId,app.myTeam);
    const text=document.querySelector('#scoreboard').textContent;
    if(!/AI (Recruit|新兵)/.test(text) || !/AI (Regular|普通)/.test(text))throw Error('Scoreboard omits bot skill labels');
  });
  assert.deepEqual(errors,[]);await page.close();
  console.log('PASS: saved/synced menu + pause mouse sensitivity and live mixed-skill AI scoreboard labels');
}
