"""Real WebGL/UI regression for gun-lab.html. Test-only Python Playwright.
Serve public/, set CHROMIUM_EXECUTABLE (and optionally CITY_ORIGIN), then run.
No npm/frontend build required. Optional GUN_LAB_SCREENSHOT=/tmp/lab.png.
"""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
weapons=json.loads((ROOT/'public/shared/weapons.json').read_text())['weapons']
origin=os.environ.get('CITY_ORIGIN','http://127.0.0.1:8080')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ['CHROMIUM_EXECUTABLE'],headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    context=browser.new_context(viewport={'width':1400,'height':900},accept_downloads=True)
    page=context.new_page();errors=[];missing=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('response',lambda r:missing.append(r.url)if r.status>=400 else None)
    page.goto(origin+'/gun-lab.html')
    page.wait_for_function('window.gunLab?.ready',timeout=120000)
    assert page.locator('#gun option').count()==len(weapons)
    assert page.locator('#download').is_disabled()
    checked=0
    for skin in ['builtin-furina','builtin-navia','builtin-charlotte','builtin-clorinde','procedural']:
        page.select_option('#skin',skin)
        page.wait_for_function('(skin)=>gunLab.ready&&document.querySelector("#load-status").textContent.includes(skin)',arg=skin,timeout=120000)
        for weapon in weapons:
            page.select_option('#gun',weapon['id'])
            page.wait_for_function('(id)=>gunLab.ready&&gunLab.gun.id===id',arg=weapon['id'],timeout=120000)
            result=page.evaluate('''()=>{
              const g=gunLab.girl,anchor=g.root.getObjectByName('weapon-hand'),T=gunLab.camera.position.constructor;
              const old=g.getWeaponPlacement();
              g.setWeaponPlacement({position:[0,0,0],rotation:[0,0,0]});g.update(0,{speed:0,pitch:0});
              const before=anchor.getWorldPosition(new T());
              g.setWeaponPlacement({position:[0,0,0],rotation:[5,10,-5]});g.update(0,{speed:0,pitch:0});
              const after=anchor.getWorldPosition(new T());
              if(before.distanceTo(after)>1e-6)throw Error('Rotation moved the trigger pivot');
              g.setWeaponPlacement({position:[.01,0,0],rotation:[0,0,0]});g.update(0,{speed:0,pitch:0});
              const delta=anchor.getWorldPosition(new T()).distanceTo(before);
              if(Math.abs(delta-.01)>1e-6)throw Error('Translation units/frame wrong: '+delta);
              const copy=g.getWeaponPlacement();copy.position[0]=.5;
              if(g.getWeaponPlacement().position[0]!==.01)throw Error('Placement getter aliases live data');
              g.setWeaponPlacement(old);return true;
            }''')
            assert result;checked+=1
    page.select_option('#gun',weapons[0]['id'])
    page.wait_for_function('(id)=>gunLab.ready&&gunLab.gun.id===id',arg=weapons[0]['id'])
    page.locator('[aria-label="position X number"]').fill('0.6')
    assert page.locator('#record').is_disabled()
    assert page.evaluate('gunLab.draft.position[0]')==0
    page.locator('[aria-label="position X number"]').fill('0.025')
    page.locator('[aria-label="rotation Y number"]').fill('7')
    page.click('#record');records=page.evaluate('gunLab.records')
    assert records[weapons[0]['id']]==dict(position=[.025,0,0],rotation=[0,7,0])
    page.locator('#baseline').hover();page.mouse.down()
    page.wait_for_function('gunLab.girl.getWeaponPlacement().position[0]===0')
    page.mouse.up();page.wait_for_function('gunLab.girl.getWeaponPlacement().position[0]===.025')
    page.select_option('#gun',weapons[1]['id']);page.wait_for_function('(id)=>gunLab.ready&&gunLab.gun.id===id',arg=weapons[1]['id'])
    assert page.evaluate('gunLab.draft.position[0]')==0
    page.select_option('#gun',weapons[0]['id']);page.wait_for_function('(id)=>gunLab.ready&&gunLab.gun.id===id',arg=weapons[0]['id'])
    assert page.evaluate('gunLab.draft.position[0]')==.025
    page.locator('#notes').fill('Keep this grip; check on all skins.')
    with page.expect_download() as info:page.click('#download')
    payload=json.loads(Path(info.value.path()).read_text())
    assert payload['placements'][weapons[0]['id']]['position']==[.025,0,0]
    assert payload['scope']=='third-person-only'
    assert payload['context']['notes']=='Keep this grip; check on all skins.'
    bad={**payload,'version':999}
    page.locator('#import').set_input_files(dict(name='bad.json',mimeType='application/json',buffer=json.dumps(bad).encode()))
    page.wait_for_function('document.querySelector("#message").textContent.startsWith("Import rejected")')
    assert page.evaluate('gunLab.records')==records
    # Valid import overwrites just its gun record, not other drafts.
    payload['placements'][weapons[0]['id']]['position'][0]=.03
    page.locator('#import').set_input_files(dict(name='good.json',mimeType='application/json',buffer=json.dumps(payload).encode()))
    page.wait_for_function('gunLab.draft.position[0]===.03')
    page.reload();page.wait_for_function('window.gunLab?.ready',timeout=120000)
    assert page.evaluate('gunLab.draft.position[0]')==.03
    assert page.evaluate('gunLab.records')[weapons[0]['id']]['position'][0]==.03
    # Storage failure is explicit and must never prevent editing/export.
    page.evaluate("()=>{Storage.prototype.setItem=function(){throw Error('quota')};}")
    page.locator('[aria-label="position X number"]').fill('0.035');page.click('#record')
    assert 'unavailable/full' in page.locator('#storage-status').inner_text()
    assert page.evaluate('gunLab.records')[weapons[0]['id']]['position'][0]==.035
    for width,height in [(390,844),(844,390),(1400,900)]:
        page.set_viewport_size(dict(width=width,height=height))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    if os.environ.get('GUN_LAB_SCREENSHOT'):page.screenshot(path=os.environ['GUN_LAB_SCREENSHOT'])
    assert not errors,errors
    assert not missing,missing
    print(f'PASS: {checked} real gun/character placement pairs, trigger pivots, millimetre translation, IK pipeline, record/download/import, invalid-import atomicity, baseline compare, persistence, storage denial and responsive layouts')
    browser.close()
