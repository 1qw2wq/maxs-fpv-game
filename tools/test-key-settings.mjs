// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
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
const bind=(p,id,slot=0)=>p.locator(`[data-key-bind="${id}"][data-slot="${slot}"]`);
const clear=(p,id,slot=0)=>p.locator(`[data-key-clear="${id}"][data-slot="${slot}"]`);
async function ready(context){
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/');
 await p.waitForFunction(()=>window.__trench?.app.keySettings,null,{timeout:90000});await p.locator('#boot').waitFor({state:'hidden',timeout:90000});
 await p.evaluate(async()=>{(await import('/js/i18n.js')).setLang('en');__trench.app.renderer.setPixelRatio(.25);__trench.app.renderer.shadowMap.enabled=false;});
 await p.click('#btn-mode-settings');return p;
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const p=await ready(context);
 assert.equal(await p.locator('.key-binding-row').count(),22);
 assert.equal(await bind(p,'forward').textContent(),'W');
 // Native Settings keyboard focus is not swallowed by gameplay Tab bindings.
 await bind(p,'forward').focus();const active=await p.evaluate(()=>document.activeElement.dataset.keyBind);await p.keyboard.press('Tab');
 assert.notEqual(await p.evaluate(()=>document.activeElement.dataset.keyBind),active);
 await p.evaluate(()=>{const c=__trench.app.controls;c.enabled=true;window.hits=[];window.savedCallbacks={};for(const key of ['onReload','onGrenadeDown','onGrenadeUp','onViewToggle']){savedCallbacks[key]=c[key];c[key]=()=>hits.push(key);}});
 await bind(p,'forward').click();await p.keyboard.press('KeyI');assert.equal(await bind(p,'forward').textContent(),'I');
 assert(await p.locator('#keyboard-settings [role=status]').textContent().then(x=>x.includes('saved')));
 await bind(p,'backward').click();await p.keyboard.press('KeyI');
 assert((await p.locator('#keyboard-settings [role=status]').textContent()).includes('already bound'));
 assert.equal(await p.evaluate(()=>__trench.app.controls.bindings.backward[0]),'KeyS');
 await p.keyboard.press('Escape');assert.equal(await bind(p,'backward').textContent(),'S');
 await bind(p,'reload').click();await p.keyboard.press('AltLeft');
 assert((await p.locator('#keyboard-settings [role=status]').textContent()).includes('reserved'));await p.keyboard.press('Escape');
 await bind(p,'grenade').click();await p.keyboard.press('KeyT');assert.equal(await bind(p,'grenade').textContent(),'T');
 assert.equal(await p.locator('[data-key-action=grenade]').textContent(),'T');
 await bind(p,'primary').click();await p.keyboard.press('Digit3');assert((await p.locator('.slot-help').textContent()).includes('3 / Num 1'));
 await clear(p,'crouch',1).click();assert.equal(await bind(p,'crouch',1).textContent(),'Unbound');
 await clear(p,'reload').click();assert.equal(await bind(p,'reload').textContent(),'Unbound');
 // Binding an alternate on an entirely unbound action must not create holes/nulls.
 await bind(p,'reload',1).click();await p.keyboard.press('KeyU');assert.equal(await bind(p,'reload').textContent(),'U');
 assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('tf.keyBindings.v1')).bindings.reload),['KeyU']);
 assert.deepEqual(await p.evaluate(()=>hits),[],'Capturing and typing in Settings cannot invoke gameplay');
 await p.evaluate(()=>{const a=__trench.app;Object.assign(a.controls,savedCallbacks);a.controls.enabled=false;a.tut.open();});
 assert((await p.locator('#tutorial').textContent()).includes('I A S D'),'Tutorial follows remapped movement');
 assert((await p.locator('#tutorial').textContent()).includes('U'),'Tutorial follows remapped reload');
 await p.click('#tutorial [data-act=skip]');
 // Two languages and narrow/landscape widths; all key slots remain reachable.
 for(const lang of ['zh','en'])for(const size of [{width:1440,height:1000},{width:390,height:844},{width:320,height:568},{width:740,height:360}]){
  await p.setViewportSize(size);await p.evaluate(async lang=>(await import('/js/i18n.js')).setLang(lang),lang);
  await p.evaluate(()=>__trench.app.settings.open());
  if(lang==='en')assert(!/[\u4e00-\u9fff]/.test(await p.locator('.key-binding-rows').innerText()),'All action labels translated');
  for(const id of ['forward','reload','lookDown'])for(const slot of [0,1]){
   const b=bind(p,id,slot);await b.scrollIntoViewIfNeeded();assert(await b.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.height>=43&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`Reachable ${lang} ${size.width} ${id}/${slot}`);
  }
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const reset=p.locator('#key-bindings-reset');await reset.scrollIntoViewIfNeeded();assert(await reset.isVisible());
  if(process.env.KEY_SETTINGS_SCREENSHOTS&&lang==='en'&&(size.width===1440||size.width===390)){await p.evaluate(()=>document.querySelector('.settings-inner').scrollTop=0);await p.screenshot({path:`/tmp/key-settings-${size.width}.png`});}
 }
 await p.setViewportSize({width:1440,height:1000});await p.evaluate(async()=>(await import('/js/i18n.js')).setLang('en'));
 await p.reload();await p.waitForFunction(()=>window.__trench?.app.keySettings,null,{timeout:90000});await p.locator('#boot').waitFor({state:'hidden'});await p.click('#btn-mode-settings');
 assert.equal(await bind(p,'forward').textContent(),'I');assert.equal(await bind(p,'grenade').textContent(),'T');assert.equal(await bind(p,'reload').textContent(),'U');
 await p.click('#key-bindings-reset');assert.equal(await bind(p,'forward').textContent(),'W');assert.equal(await bind(p,'grenade').textContent(),'G');assert.equal(await bind(p,'reload').textContent(),'R');
 await bind(p,'forward').click();await p.keyboard.press('KeyI');
 const [download]=await Promise.all([p.waitForEvent('download'),p.click('#local-export')]);
 const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.deepEqual(exported.keyBindings.forward,['KeyI']);
 p.once('dialog',dialog=>dialog.accept());await p.click('#local-reset');assert.equal(await bind(p,'forward').textContent(),'W','Clear local data also resets bindings');
 await bind(p,'forward').click();await p.keyboard.press('KeyI');await p.click('#rig-back');
 // Real Solo integration: native configured movement -> engine authoritative snapshot.
 await p.locator('[data-map=somme],.map-btn[data-id=somme]').first().click();await p.locator('#bot-count button[data-n="0"]').click();await p.click('#btn-mode-solo');await p.click('#btn-deploy');
 await p.waitForFunction(()=>__trench.app.playing&&__trench.app.net?.lastMe?.alive,null,{timeout:180000});
 await p.evaluate(()=>{const a=__trench.app;a.renderer.setPixelRatio(.2);a.renderer.shadowMap.enabled=false;window.beforeMove=a.controls.pos.clone();});
 await p.locator('#game').click({position:{x:100,y:100}});
 await p.keyboard.down('KeyI');await p.waitForTimeout(700);await p.keyboard.up('KeyI');
 assert(await p.evaluate(()=>__trench.app.controls.pos.distanceTo(beforeMove)>.15),'Remapped movement reaches the actual match');
 await p.keyboard.press('Escape');await p.click('#btn-pause-settings');
 await bind(p,'grenade').click();await p.keyboard.press('KeyT');assert.equal(await bind(p,'grenade').textContent(),'T');
 await p.keyboard.press('KeyV');assert(await p.evaluate(()=>!document.getElementById('screen-settings').classList.contains('hidden')),'Settings remain usable mid-match');
 await p.click('#rig-back');assert(await p.locator('#pause').isVisible());await p.click('#btn-pause-resume');assert(await p.locator('#pause').isHidden());assert(await p.evaluate(()=>__trench.app.playing&&!__trench.app.paused&&!__trench.app.settings.visible));
 await p.close();await context.close();
 // Corrupt storage falls back to a whole default layout without blocking startup.
 const corrupt=await browser.newContext();await corrupt.addInitScript(()=>localStorage.setItem('tf.keyBindings.v1','{"version":1,"bindings":{"forward":["Escape"]}}'));
 const bad=await ready(corrupt);assert.equal(await bind(bad,'forward').textContent(),'W');
 await bad.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError');};Storage.prototype.getItem=function(){throw new DOMException('blocked','SecurityError');};});
 await bind(bad,'forward').click();await bad.keyboard.press('KeyI');assert.equal(await bind(bad,'forward').textContent(),'I');assert((await bad.locator('#keyboard-settings [role=status]').textContent()).includes('Storage unavailable'),'Failures after the initial storage probe must not claim success');
 await bad.close();await corrupt.close();
 // Storage denial still allows in-memory edits and explicitly warns against persistence.
 const denied=await browser.newContext();await denied.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});});
 const d=await ready(denied);await bind(d,'forward').click();await d.keyboard.press('KeyI');assert.equal(await bind(d,'forward').textContent(),'I');
 assert((await d.locator('#keyboard-settings [role=status]').textContent()).includes('Storage unavailable'));
 await d.close();await denied.close();assert.deepEqual(errors,[]);
 console.log('PASS: real Settings UI, 22 translated actions, remap/conflict/reserved/cancel/clear/alternate/reset, native Tab, dynamic HUD/tutorial hints, storage/reload/corruption/denial, bilingual responsive hit targets and actual Solo/pause-menu remapping');
}finally{await browser.close();await new Promise(r=>server.close(r));}
