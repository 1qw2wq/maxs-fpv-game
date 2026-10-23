// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import {testLayouts} from './test-layout.mjs';
import {testMobileFeatures} from './test-mobile-features.mjs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(resolve(process.env.TEST_DEPS||'/tmp/maxs-fpv-browser-tests','package.json'));
const {chromium:pw}=require('playwright-core');
const {default:chromium,inflate,setupLambdaEnvironment}=await import(require.resolve('@sparticuz/chromium'));
if(process.platform==='linux'&&!process.env.CHROMIUM_EXECUTABLE){const libs=await inflate(fileURLToPath(new URL('../bin/al2023.tar.br',pathToFileURL(require.resolve('@sparticuz/chromium')))));setupLambdaEnvironment(resolve(libs,'lib'));}
const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.svg':'image/svg+xml','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
 const path=decodeURIComponent(new URL(req.url,'http://test').pathname);
 if(path==='/__harness.html'){res.setHeader('Content-Type','text/html');res.end('<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/"}}</script><canvas id="game"></canvas>');return;}
 const local=/^\/api\/(health|rooms|characters)$/.test(path)?path+'.json':path;
 const file=resolve(root,'.'+(local==='/'?'/index.html':local));
 if(!file.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await pw.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('disable-web-security')&&a!=='--single-process'),headless:true});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await testLayouts(context,origin);
 await testMobileFeatures(context,origin);
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/js/main.js',r=>r.fulfill({contentType:'text/javascript',body:'// Deterministic HUD fixture'}));
 await p.goto(origin+'/');
 await p.evaluate(async()=>{
  const {loadConfig}=await import('/js/config.js'),{Hud}=await import('/js/hud.js');
  const {Controls}=await import('/js/controls.js'),{MobileControls}=await import('/js/mobile-controls.js');
  const {createKeySettings}=await import('/js/key-settings.js');
  window.lang=await import('/js/i18n.js');window.data=await loadConfig();window.hud=new Hud(data);
  window.c=new Controls(document.querySelector('#game'),null,data.combat,data);
  createKeySettings({controls:c,hud});window.mobile=new MobileControls(c,{parent:hud.el.hud});
  hud.screen('game');hud.setLoadout('assault','mp18');hud.setRoomCode('12345678');
  window.me={hp:100,hpMax:100,mag:18,magMax:25,reserve:125,alive:true,reloading:false,abilityIn:0,c:'assault',w:'mp18',grenades:2,grenadeIn:0};
  window.updateFixture=()=>{hud.updateMe(me);hud.updateGrenade('frag',me,null,c.mobileMode);};updateFixture();
  document.querySelector('#weapon-slot').textContent='1 · Primary weapon';
  document.querySelector('#spawn-shield-status').classList.remove('hidden');document.querySelector('#spawn-shield-status').textContent='Spawn protection · 5s';
  document.querySelector('#boot').classList.add('hidden');
  // A bright, textured field also exposes unwanted full-width backdrops.
  document.querySelector('#game').style.background='linear-gradient(140deg,#b4c0ce 0%,#e3e4e3 46%,#7e8d9a 47%,#a9b7bf 78%,#d9dfdf 79%)';
  window.inspectHud=()=>{
   const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
   const visible=el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
   const failures=[],selectors=['.hp-wrap','.ammo-wrap','#ability-chip','#grenade-chip','#topbar'];
   const els=selectors.map(s=>document.querySelector(s));
   for(let i=0;i<els.length;i++){
    const el=els[i],r=el.getBoundingClientRect();
    if(r.left<-.5||r.right>innerWidth+.5||r.top<-.5||r.bottom>innerHeight+.5)failures.push(selectors[i]+' outside viewport');
    for(let j=i+1;j<els.length;j++)if(overlap(r,els[j].getBoundingClientRect()))failures.push(selectors[i]+' overlaps '+selectors[j]);
    if(document.body.classList.contains('mobile-mode'))for(const button of document.querySelectorAll('#mobile-controls button,.touch-stick'))if(visible(button)&&overlap(r,button.getBoundingClientRect()))failures.push(selectors[i]+' overlaps touch '+(button.dataset.action||button.className));
   }
   return failures;
  };
 });
 const profiles=[{width:1920,height:1080,mobile:false},{width:1440,height:900,mobile:false},{width:1024,height:768,mobile:false},{width:800,height:600,mobile:false},{width:640,height:360,mobile:false},{width:320,height:568,mobile:true},{width:390,height:844,mobile:true},{width:480,height:320,mobile:true},{width:568,height:320,mobile:true},{width:844,height:390,mobile:true}];
 for(const language of ['en','zh'])for(const profile of profiles){
  await p.setViewportSize(profile);await p.evaluate(({language,profile})=>{lang.setLang(language);document.body.classList.toggle('mobile-mode',profile.mobile);c.enabled=true;c.setMobileMode(profile.mobile);mobile.update(profile.mobile);updateFixture();},{language,profile});
  const failures=await p.evaluate(()=>inspectHud());
  if(failures.length){console.log(await p.evaluate(()=>Object.fromEntries(['.ammo-wrap','.reserve-block','#ammo-mag','#weapon-slot','.touch-fire'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return[s,{x:r.x,y:r.y,w:r.width,h:r.height,padding:c.padding,lineHeight:c.lineHeight}]}))));await p.screenshot({path:'/tmp/hud-failure.png'});}
  assert.deepEqual(failures,[],`${language} ${profile.width}x${profile.height} HUD overlap`);
  assert(await p.evaluate(()=>{const s=getComputedStyle(document.querySelector('#statusbar'));return s.backgroundColor==='rgba(0, 0, 0, 0)'&&s.backgroundImage==='none'&&s.boxShadow==='none'&&s.backdropFilter==='none'&&parseFloat(s.borderTopWidth)===0;}),'Status rail must never paint a full-width backdrop');
  assert(await p.evaluate(()=>{const s=getComputedStyle(document.querySelector('.hp-wrap'));const [r,g,b]=s.backgroundColor.match(/[\d.]+/g).map(Number);return b>=g&&g>=r;}),'Cards use neutral/cool surfaces, not olive');
  if(process.env.HUD_SCREENSHOTS&&language==='en'&&[1440,390,568].includes(profile.width))await p.screenshot({path:`/tmp/hud-${profile.width}.png`});
 }
 // Real HUD state updates still drive health, low-health color, inventory and reload.
 await p.evaluate(()=>{me.hp=20;me.mag=0;me.reserve=0;me.reloading=true;me.reloadIn=500;me.reloadTotal=1000;updateFixture();});
 assert.equal(await p.locator('#hp-num').textContent(),'20');assert.equal(await p.locator('#ammo-mag').textContent(),'0');
 assert(await p.locator('.hp-bar').evaluate(el=>el.classList.contains('low')));
 assert(await p.locator('.ammo-wrap').evaluate(el=>el.classList.contains('empty')&&el.classList.contains('reloading')));
 assert(await p.locator('#ammo-reserve').evaluate(el=>el.classList.contains('dry')));
 assert.equal(await p.locator('#reload-fill').evaluate(el=>el.style.width),'50%');
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('#hp-fill').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await p.close();
 // Use the actual main.js/Pyodide match as well as deterministic state fixtures.
 const live=await context.newPage();live.on('pageerror',e=>errors.push(e.message));await live.setViewportSize({width:1440,height:900});await live.goto(origin+'/');
 await live.waitForFunction(()=>window.__trench?.app.keySettings,null,{timeout:90000});await live.locator('#boot').waitFor({state:'hidden'});
 await live.evaluate(async()=>{(await import('/js/i18n.js')).setLang('en');const a=__trench.app;a.renderer.setPixelRatio(.3);a.renderer.shadowMap.enabled=false;});
 await live.click('.map-btn[data-id=somme]');await live.click('#bot-count button[data-n="0"]');await live.click('#btn-mode-solo');await live.click('#btn-deploy');
 await live.waitForFunction(()=>__trench.app.playing&&__trench.app.net?.lastMe?.alive,null,{timeout:180000});
 await live.locator('#game').click({position:{x:700,y:400}});
 assert(await live.evaluate(()=>getComputedStyle(document.querySelector('#statusbar')).backgroundColor==='rgba(0, 0, 0, 0)'));
 assert(await live.evaluate(()=>Number(document.querySelector('#ammo-mag').textContent)===__trench.app.net.lastMe.mag));
 if(process.env.HUD_SCREENSHOTS)await live.screenshot({path:'/tmp/hud-gameplay.png'});
 await live.keyboard.press('Escape');await live.click('#btn-pause-settings');
 await live.click('[data-key-bind="primary"][data-slot="0"]');await live.keyboard.press('Digit3');
 await live.click('#rig-back');await live.click('#btn-pause-resume');
 await live.waitForFunction(()=>document.querySelector('#weapon-slot').textContent.startsWith('3 ·'),null,{timeout:10000});
 assert((await live.locator('#weapon-slot').getAttribute('title')).includes('Num 1'),'Alternate binding stays available in the slot tooltip');
 await live.close();await context.close();assert.deepEqual(errors,[]);
 console.log('PASS: transparent status rail, neutral compact HUD, 20 bilingual desktop/mobile profiles, no information/touch overlaps, health/ammo/reload states, reduced motion and actual Solo gameplay');
}finally{await browser.close();await new Promise(r=>server.close(r));}
