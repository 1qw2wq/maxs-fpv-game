"""Real five-second protection through the shipped browser/Pyodide engine on every map.
Test-only Python Playwright; see test-expanded-assets.py for environment variables.
"""
import json, os
from playwright.sync_api import sync_playwright

origin = os.environ.get('CITY_ORIGIN', 'http://127.0.0.1:8080')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'], headless=True, args=[
        '--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
        '--experimental-wasm-eh', '--experimental-wasm-reftypes', '--experimental-wasm-return-call',
        '--js-flags=--experimental-wasm-eh --experimental-wasm-reftypes --experimental-wasm-return-call'])
    context = browser.new_context()
    context.add_init_script('Object.hasOwn ||= ((o,k)=>Object.prototype.hasOwnProperty.call(o,k));')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route(origin+'/__shield_harness__', lambda r: r.fulfill(content_type='text/html', body='<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>'))
    page.goto(origin+'/__shield_harness__')
    registry = page.evaluate("async()=>await(await fetch('/shared/maps.json')).json()")
    for meta in registry['maps']:
        page.evaluate("""async map=>{
          window.shieldNet?.close();
          const {LocalNet}=await import('/js/local.js');
          window.shieldNet=new LocalNet({onWelcome:m=>window.shieldWelcome=m});
          await shieldNet.connect('');
          shieldNet.join('Shield QA','assault','mp18',false,0,'',true,map,'','','tdm','g17');
        }""", meta['id'])
        page.wait_for_function('shieldNet.lastMe?.alive&&shieldNet.lastMe.shieldMs>0', timeout=180000)
        assert page.evaluate('shieldWelcome.mapId') == meta['id']
        page.evaluate("""()=>shieldNet._engine.py.runPython(`
import combat, game
m=_host.room.match
p=m.players[1]
q=m.add_player('Target QA',None)
found=False
for spawn in combat.MAP_DATA['spawns']['0']:
    base=[spawn['x'],spawn['y'],spawn['z']]
    for dx,dz in ((3,0),(-3,0),(0,3),(0,-3),(5,0),(0,5)):
        pos=[base[0]+dx,combat.floor_at(base[0]+dx,base[2]+dz,base[1]),base[2]+dz]
        if combat.blocked(pos[0],pos[2],pos[1]):continue
        eye=[base[0],base[1]+1.58,base[2]]
        point=[pos[0],pos[1]+1.3,pos[2]]
        if not combat.has_line_of_sight(eye,point):continue
        d=combat.normalize(tuple(point[i]-eye[i] for i in range(3)))
        found=True
        break
    if found:break
assert found
p.update(pos=base,safe_pos=base,team=0,last_shot=0,mag=100)
q.update(pos=pos,safe_pos=pos,team=1,hp=1000)
game._seed_hist(q,game.now_ms())
m._on_fire(p,dict(d=d))
assert q['hp']==1000, 'fresh shield failed'
` )""")
        page.wait_for_function('shieldNet.lastMe.shieldMs===0&&shieldNet.lastState?.ps.some(q=>q.i===2&&q.sh===0)&&shieldNet.sample().get(2)?.shieldMs===0', timeout=15000)
        page.evaluate("""()=>{
          if(shieldNet.protection.remaining(performance.now())>0)throw Error('Own shield outlived authority');
          shieldNet._engine.py.runPython(`
p.update(last_shot=0,mag=100)
m._on_fire(p,dict(d=d))
assert q['hp']<1000, ('expired shield still blocks damage',m.phase,p['pos'],q['pos'],base,pos,game.shield_remaining(q,game.now_ms()),p['weapon'],p['team'],q['team'],combat.ray_world(game.eye_pos(p),d,10),d)
life=p['life']
p['pos']=[999,-999,999]
m._ensure_safe_position(p)
assert p['life']==life and game.shield_remaining(p,game.now_ms())==0
p.update(alive=False,respawn_at=0)
m._on_respawn(p,dict(c='scout',w='m170',secondary='deagle'))
assert p['life']==life+1
assert game.shield_remaining(p,game.now_ms())>4900
`);
        }""")
        page.wait_for_function('shieldNet.lastMe.life===2&&shieldNet.protection.remaining(performance.now())>0')
        print('PASS', meta['id'], 'real 5s expiry, damage before/after, remote shield, no recovery renewal, fresh life grant', flush=True)
    page.evaluate('shieldNet.close()')
    assert not errors, errors
    browser.close()
