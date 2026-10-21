import assert from 'node:assert/strict';

// Run with the same import-map /__harness.html fixture as test-hands.mjs.
export async function testDeathLoadout(context, origin) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/__harness.html');
  const result = await page.evaluate(async () => {
    const html = await (await fetch('/index.html')).text();
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    await new Promise(resolve => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/style.css'; css.onload = resolve; document.head.appendChild(css);
    });
    const data = await (await fetch('/shared/weapons.json')).json();
    data.classById = Object.fromEntries(data.classes.map(c => [c.id,c]));
    data.teamById = Object.fromEntries(data.teams.map(c => [c.id,c]));
    data.weaponsByClass = Object.fromEntries(data.classes.map(c => [c.id,data.weapons.filter(w => w.class === c.id)]));
    data.secondaries = data.weapons.filter(w => w.slot === 'secondary');
    const { Hud } = await import('/js/hud.js');
    const { setLang } = await import('/js/i18n.js');
    const hud = new Hud(data);
    hud.screen('game');
    const primary = data.weaponsByClass.assault[1].id;
    const pistol = data.secondaries.at(-1).id;
    hud.showDeath('<script>bad</script>', 'test gun', 'assault', primary, pistol);
    if (document.querySelector('#death-by script')) throw Error('Killer name is not escaped');
    if (hud.deathSelection.secondary !== pistol) throw Error('Carried pistol not selected after death');
    if (document.querySelector('#death-loadout select')) throw Error('Unstyled native secondary select remains');
    if (document.querySelectorAll('[data-secondary]').length !== data.secondaries.length) throw Error('Missing secondary options');
    let choices = 0;
    for (const cls of data.classes) {
      document.querySelector(`[data-cls="${cls.id}"]`).click();
      if (hud.deathSelection.secondary !== pistol) throw Error('Changing class reset the pistol');
      const weapons = data.weaponsByClass[cls.id];
      document.querySelector(`[data-weapon="${weapons.at(-1).id}"]`).click();
      for (const side of data.secondaries) {
        document.querySelector(`[data-secondary="${side.id}"]`).click();
        const expected = { cls:cls.id, weapon:weapons.at(-1).id, secondary:side.id };
        for (const lang of ['zh','en']) {
          setLang(lang);
          if (JSON.stringify(hud.deathSelection) !== JSON.stringify(expected)) throw Error('Language change reset redeploy choices');
          if (document.querySelectorAll('#death-loadout [aria-pressed="true"]').length !== 3) throw Error('Selected state does not mark all three choices');
          if (document.querySelector('.dl-secondary').getAttribute('aria-label') !== (lang === 'en' ? 'Secondary · choose one pistol' : '副武器 · 选择一把手枪')) throw Error('Death picker was not translated');
        }
        choices++;
      }
      document.querySelector(`[data-secondary="${pistol}"]`).click();
    }
    let deployed = null;
    hud.setRespawnReady(2, () => { deployed = hud.deathSelection; });
    if (!hud.el.respawn.disabled) throw Error('Countdown permits early deploy');
    hud.setRespawnReady(0, () => { deployed = hud.deathSelection; });
    const chosen = hud.deathSelection;
    hud.el.respawn.click();
    if (JSON.stringify(deployed) !== JSON.stringify(chosen)) throw Error('Respawn did not submit both slots');
    hud.hideDeath();
    hud.showDeath(null, null, chosen.cls, chosen.weapon, chosen.secondary);
    if (JSON.stringify(hud.deathSelection) !== JSON.stringify(chosen)) throw Error('Next death reset the carried loadout');
    window.deathTest = { hud, setLang, data };
    return { choices, pistols:data.secondaries.length };
  });
  const layouts = [];
  for (const [width,height,mobile] of [[1280,800,false],[390,844,true],[360,640,true],[320,568,true],[844,390,true],[667,375,true],[740,360,true]]) {
    await page.setViewportSize({ width,height });
    for (const [lang,seconds] of [['en',3],['en',0],['zh',3],['zh',0]]) {
      const layout = await page.evaluate(async ({ mobile, lang, seconds }) => {
        document.body.classList.toggle('mobile-mode', mobile);
        deathTest.setLang(lang);
        deathTest.hud.setRespawnReady(seconds, () => {});
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const panel = document.querySelector('.panel.death-panel'), submit = document.querySelector('#btn-respawn');
        const rect = panel.getBoundingClientRect(), button = submit.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > innerHeight + 1 || rect.left < 0 || rect.right > innerWidth + 1) throw Error('Death panel extends outside viewport');
        if (button.bottom > rect.bottom || button.top < rect.top) throw Error('Deploy button is off-screen');
        if (panel.scrollWidth > panel.clientWidth + 1) throw Error('Horizontal panel overflow');
        let checked = 0;
        for (const choice of document.querySelectorAll('.dl-btn')) {
          choice.scrollIntoView({ block:'nearest' });
          const r = choice.getBoundingClientRect(), scroll = document.querySelector('#death-loadout').getBoundingClientRect();
          if (r.height < 44 || r.width < 44) throw Error('Picker target below touch size');
          if (r.left < rect.left || r.right > rect.right || r.top < scroll.top - 1 || r.bottom > scroll.bottom + 1) throw Error('A loadout choice cannot be scrolled into view');
          if (r.bottom > button.top) throw Error('A loadout choice overlaps Deploy');
          checked++;
        }
        return { width:innerWidth, height:innerHeight, mobile, lang, seconds, checked };
      }, { mobile, lang, seconds });
      layouts.push(layout);
    }
  }
  assert.deepEqual(errors, []);
  await page.close();
  console.log(`PASS: death picker: ${result.choices} class/pistol combinations; ${layouts.length} bilingual desktop/mobile layouts; preserved redeploy selection`);
  return { ...result, layouts };
}
