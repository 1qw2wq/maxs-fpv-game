import assert from 'node:assert/strict';

// Render actual HTML/HUD/cards without the game loop: deterministic layout
// coverage must include menus and multiplayer/control HUD, not only solo TDM.
export async function testLayouts(context, origin) {
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/js/main.js',route=>route.fulfill({contentType:'text/javascript',body:'// Layout fixture owns the HUD.'}));
  try {
    await page.goto(origin+'/');
    await page.evaluate(async()=>{
      const {loadConfig}=await import('/js/config.js'),{Hud}=await import('/js/hud.js');
      const {Controls}=await import('/js/controls.js'),{MobileControls}=await import('/js/mobile-controls.js');
      window.lang=await import('/js/i18n.js');window.originalLang=lang.getLang();window.data=await loadConfig();window.hud=new Hud(data);
      hud.buildSelect(id=>hud.selectClass(id,0),()=>{},()=>{});hud.selectClass('assault',0);hud.pickWeapon('assault','mp18');
      hud.buildMaps(data.maps,data.defaultMapId);hud.screen('menu');
      window.c=new Controls(document.querySelector('#game'),null,data.combat,data);c.enabled=true;
      window.mobile=new MobileControls(c,{parent:hud.el.hud});
      window.inspectLayout=(scope,selector='button,input:not([type="hidden"]),select,.class-card,.weapon-card')=>{
        const root=document.querySelector(scope), els=[...root.querySelectorAll(selector)].filter(el=>el.getClientRects().length && el.getBoundingClientRect().width>0);
        const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.75 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.75;
        const visibleRect=el=>{
          const r=el.getBoundingClientRect(),out={left:Math.max(0,r.left),right:Math.min(innerWidth,r.right),top:Math.max(0,r.top),bottom:Math.min(innerHeight,r.bottom)};
          for(let p=el.parentElement;p;p=p.parentElement) {
            const style=getComputedStyle(p),box=p.getBoundingClientRect();
            if(/auto|scroll|hidden|clip/.test(style.overflowY)){out.top=Math.max(out.top,box.top);out.bottom=Math.min(out.bottom,box.bottom);}
            if(/auto|scroll|hidden|clip/.test(style.overflowX)){out.left=Math.max(out.left,box.left);out.right=Math.min(out.right,box.right);}
          }
          return out;
        };
        const failures=[];
        for(let i=0;i<els.length;i++) {
          const el=els[i],r=el.getBoundingClientRect(),name=el.id||el.dataset.action||el.className;
          if(r.left<-.5 || r.right>innerWidth+.5)failures.push(name+' overflows viewport');
          if(el.matches('button,select') && el.scrollWidth>el.clientWidth+2)failures.push(name+' has overflowing label');
          for(const other of els.slice(i+1))if(!el.contains(other) && !other.contains(el) && overlap(visibleRect(el),visibleRect(other)))failures.push(name+' overlaps '+(other.id||other.className));
        }
        return failures;
      };
      window.headerChecks=()=>{
        const pairs=[['#topbar','#room-chip'],['#room-chip','#objective-hud'],['#ability-chip','#grenade-chip'],['#spawn-shield-status','#topbar'],['#spawn-shield-status','.hp-bar'],['#spawn-shield-status','#ability-chip']];
        const failures=[];
        for(const [a,b] of pairs) {
          const x=document.querySelector(a).getBoundingClientRect(),y=document.querySelector(b).getBoundingClientRect();
          if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>.5 && Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>.5)failures.push(a+' overlaps '+b);
        }
        return failures;
      };
    });
    let checks=0;
    const profiles=[{width:1920,height:1080,mobile:false},{width:1366,height:768,mobile:false},{width:800,height:600,mobile:false},{width:640,height:360,mobile:false},{width:320,height:568,mobile:true},{width:390,height:844,mobile:true},{width:480,height:320,mobile:true},{width:568,height:320,mobile:true},{width:844,height:390,mobile:true}];
    for(const language of ['en','zh'])for(const profile of profiles) {
      const label=`${language} ${profile.mobile?'mobile':'PC'} ${profile.width}x${profile.height}`;
      await page.setViewportSize(profile);
      await page.evaluate(({language,profile})=>{lang.setLang(language);document.body.classList.toggle('mobile-mode',profile.mobile);c.setMobileMode(profile.mobile);mobile.update(false);hud.hidePause();hud.closeInvite();hud.screen('menu');hud.setRoomMode('join','12345678');}, {language,profile});
      assert.deepEqual(await page.evaluate(()=>inspectLayout('#screen-menu')),[],label+' menu');checks++;
      await page.locator('#btn-mode-solo').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#btn-mode-solo').isVisible(),label+' scroll to mode');
      assert.ok(await page.evaluate(()=>{const el=document.querySelector('#btn-mode-solo'),r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),label+' mode covered');checks++;
      await page.evaluate(()=>{hud.screen('select');hud.setRoomCode('12345678');hud.selectClass('assault',0);});
      assert.deepEqual(await page.evaluate(()=>inspectLayout('#screen-select')),[],label+' select');
      assert.ok(await page.evaluate(()=>document.querySelector('.weapon-row').getBoundingClientRect().bottom<=document.querySelector('#screen-select .select-foot').getBoundingClientRect().top),label+' weapon/deploy separation');checks++;
      await page.locator('#btn-deploy').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>{const el=document.querySelector('#btn-deploy'),r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),label+' deploy covered');checks++;
      await page.evaluate(()=>hud.screen('settings'));
      assert.deepEqual(await page.evaluate(()=>inspectLayout('#screen-settings')),[],label+' settings');checks++;
      await page.evaluate(()=>{hud.screen('game');hud.showPause({host:true});});
      assert.deepEqual(await page.evaluate(()=>inspectLayout('#pause')),[],label+' pause');
      await page.locator('#btn-pause-leave').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>{const el=document.querySelector('#btn-pause-leave'),r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),label+' pause covered');checks++;
      await page.evaluate(()=>{hud.hidePause();hud.openInvite('host',{room:'12345678'});});
      assert.deepEqual(await page.evaluate(()=>inspectLayout('#invite')),[],label+' invite');checks++;
      await page.evaluate(()=>{
        hud.closeInvite();hud.screen('game');hud.setRoomCode('12345678');hud.setLoadout('assault','mp18');hud.updateGrenade('smoke',{grenades:2},null,c.mobileMode);
        const shield=document.getElementById('spawn-shield-status');shield.classList.remove('hidden');shield.textContent=lang.t('出生保护 · {seconds}秒',{seconds:5});
        const objective=document.querySelector('#objective-hud');objective.classList.remove('hidden');
        document.querySelector('#objective-cards').innerHTML=['A','B','C'].map(id=>`<div class="objective-card"><b>${id}</b><span class="objective-distance">125 m</span><small>CONTESTED</small><div class="objective-progress"><i></i></div></div>`).join('');
        document.querySelector('#objective-status').textContent=lang.t('占领全部据点并守住 {n} 秒',{n:15});
        mobile.update(c.mobileMode);window.roomTaps=0;document.querySelector('#room-chip').onclick=()=>roomTaps++;
      });
      assert.deepEqual(await page.evaluate(()=>headerChecks()),[],label+' HUD stack');
      assert.deepEqual(await page.evaluate(()=>inspectLayout('#screen-hud','button')),[],label+' HUD buttons');checks++;
      await page.locator('#room-chip').click();assert.equal(await page.evaluate(()=>roomTaps),1,label+' room button covered');checks++;
      if(profile.mobile) {
        const styleFailures=await page.evaluate(()=>[...mobile.buttons,hud.el.roomChip].flatMap(button=>{
          const failures=[];
          for(const held of [false,true]) {
            button.classList.toggle('held',held);
            const style=getComputedStyle(button),r=button.getBoundingClientRect();
            const alpha=Number(style.backgroundColor.match(/[\d.]+/g)?.[3] ?? 1);
            if(alpha>.3 || parseFloat(style.borderTopLeftRadius)<Math.min(r.width,r.height)/2)failures.push((button.dataset.action||button.id)+' not transparent/rounded');
          }
          button.classList.remove('held');
          return failures;
        }));
        assert.deepEqual(styleFailures,[],label+' translucent round controls');checks++;
        if(process.env.LAYOUT_SCREENSHOT && language==='en' && profile.width===390)await page.screenshot({path:process.env.LAYOUT_SCREENSHOT});
      }
    }
    await page.evaluate(()=>lang.setLang(originalLang));
    assert.deepEqual(errors,[]);
    console.log(`PASS: ${checks} English/Chinese PC/mobile menu, selection, settings, modal and multiplayer-control HUD layout checks; transparent round touch buttons`);
  } finally {await page.close();}
}
