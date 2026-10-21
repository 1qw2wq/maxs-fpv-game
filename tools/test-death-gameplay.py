"""Real Solo/Pyodide lifecycle check for kill/death camera and redeployment.
Run with public/ served at CITY_ORIGIN, test-only Playwright+Chromium.
"""
import os
from playwright.sync_api import sync_playwright
origin=os.environ.get('CITY_ORIGIN','http://127.0.0.1:8080')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'],headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1100,'height':750});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(origin+'/');page.wait_for_selector('#btn-mode-solo',timeout=90000)
    page.locator('.map-btn[data-id=somme]').click();page.click('#btn-mode-solo')
    page.wait_for_selector('#btn-deploy');page.evaluate("()=>{const a=__trench.app;a.renderer.setPixelRatio(.25);a.hud.el.name.value='Death QA';}")
    page.click('#btn-deploy')
    page.wait_for_function('window.__trench.app.playing&&window.__trench.app.net?._engine?.py&&window.__trench.app.net.lastMe?.alive',timeout=180000)
    page.evaluate('''()=>{
      const a=__trench.app;
      a.net._engine.py.runPython(`
_host.room.match.drop_bots();_host.room.bots_on=False
_m=_host.room.match
_me=next(p for p in _m.players.values() if not p['bot'])
_enemy=_m.add_player('Death Target',None)
_enemy['team']=1-_me['team']
_enemy['pos']=[_me['pos'][0]+3,_me['pos'][1],_me['pos'][2]]
_enemy['safe_pos']=_enemy['pos'][:]
`);
    }''')
    page.wait_for_function('__trench.app.remotes.size>=1',timeout=30000)
    # Authoritative engine emits a kill; ordinary message/snapshot paths render it.
    page.evaluate("__trench.app.net._engine.py.runPython('_m.outbox.extend(_m._kill(_me,_enemy,True))')")
    page.wait_for_function('document.querySelector("#kill-confirm").classList.contains("headshot")',timeout=15000)
    page.wait_for_function('[...__trench.app.remotes.values()].some(g=>g.deathState.elapsed>.2)',timeout=15000)
    assert page.locator('#kill-victim').inner_text()=='Death Target'
    page.evaluate("__trench.app.net._engine.py.runPython('_m.outbox.extend(_m._kill(_enemy,_me,False))')")
    page.wait_for_function('__trench.app.deathCamera?.elapsed>.1',timeout=15000)
    assert page.evaluate('document.body.classList.contains("player-dead")')
    assert page.evaluate('!__trench.app.vm.root.visible&&(!__trench.app.fpArms||!__trench.app.fpArms.holder.visible)')
    # Verify no camera helper changes controls/body authority, including near walls.
    saved=page.evaluate('''()=>{const a=__trench.app;return{p:a.controls.pos.toArray(),yaw:a.controls.yaw,pitch:a.controls.pitch};}''')
    page.wait_for_function('__trench.app.deathCamera?.elapsed>1.1',timeout=20000)
    assert not page.evaluate('document.body.classList.contains("death-sequence")')
    assert saved==page.evaluate('''()=>{const a=__trench.app;return{p:a.controls.pos.toArray(),yaw:a.controls.yaw,pitch:a.controls.pitch};}''')
    assert page.evaluate('''()=>{const a=__trench.app;return a.camera.position.toArray().every(Number.isFinite)&&a.camera.position.distanceTo(a.controls.eye())>.25;}''')
    assert page.locator('#death-panel').is_visible()
    if os.environ.get('DEATH_GAME_SCREENSHOT'):page.screenshot(path=os.environ['DEATH_GAME_SCREENSHOT'])
    page.wait_for_function('!document.querySelector("#btn-respawn").disabled',timeout=20000)
    page.click('#btn-respawn')
    page.wait_for_function('__trench.app.net.lastMe.alive&&!__trench.app.deathCamera&&__trench.app.self.deathState.elapsed===0',timeout=20000)
    assert not page.evaluate('document.body.classList.contains("player-dead")')
    assert page.evaluate('__trench.app.self.root.getObjectByName("death-presentation").quaternion.w')==1
    page.emulate_media(reduced_motion='reduce')
    page.evaluate("__trench.app.net._engine.py.runPython('_m.outbox.extend(_m._kill(_enemy,_me,False))')")
    page.wait_for_function('__trench.app.deathCamera?.elapsed>.1',timeout=15000)
    assert not page.evaluate('document.body.classList.contains("death-sequence")')
    assert page.locator('#death-panel .death-panel').evaluate('(e)=>Number(getComputedStyle(e).opacity)')==1
    # Leave through the normal pause menu; effects must not leak to the next match.
    page.keyboard.press('Escape')
    page.wait_for_selector('#btn-pause-leave',state='visible',timeout=15000)
    page.click('#btn-pause-leave')
    page.wait_for_function('!__trench.app.playing&&!__trench.app.deathCamera',timeout=15000)
    assert not page.evaluate('document.body.classList.contains("player-dead")')
    assert not errors,errors
    print('PASS: real Solo/Pyodide confirmed headshot, remote collapse, local death camera, hidden FP arms, unchanged controls, timely death picker/countdown, respawn reset, reduced-motion camera and leave cleanup; no page errors',flush=True)
    browser.close()
