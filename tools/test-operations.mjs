// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {testDeathLoadout} from './test-death-loadout.mjs';
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
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await testDeathLoadout(context,origin);
 const p=await context.newPage();await p.goto(origin+'/');
 await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});await p.locator('#boot').waitFor({state:'hidden'});
 await p.evaluate(async()=>{(await import('/js/i18n.js')).setLang('en');__trench.app.renderer.setPixelRatio(.3);__trench.app.renderer.shadowMap.enabled=false;});
 await p.click('#btn-mode-solo');
 // Native keyboard selection must use the same loadout callbacks as a pointer click.
 await p.locator('#class-row button').nth(1).focus();await p.keyboard.press('Enter');
 assert.equal(await p.locator('#class-row [aria-pressed=true]').count(),1);
 const first=await p.evaluate(()=>__trench.app.hud.selected);
 await p.locator('#weapon-row button').nth(1).focus();await p.keyboard.press('Space');
 assert.notEqual(await p.evaluate(()=>__trench.app.hud.selected.weapon),first.weapon);
 assert.equal(await p.locator('#weapon-row [aria-pressed=true]').count(),1);
 await p.locator('#secondary-row button').nth(1).focus();await p.keyboard.press('Enter');
 assert.equal(await p.locator('#secondary-row [aria-pressed=true]').count(),1);
 const selected=await p.evaluate(()=>({...__trench.app.hud.selected}));
 await p.evaluate(async()=>(await import('/js/i18n.js')).setLang('zh'));
 assert.deepEqual(await p.evaluate(()=>__trench.app.hud.selected),selected);
 assert.equal(await p.locator('#class-row [aria-pressed=true]').count(),1);
 await p.evaluate(async()=>(await import('/js/i18n.js')).setLang('en'));
 if(process.env.OPS_SCREENSHOTS){
  await p.evaluate(()=>document.querySelector('.select-inner').scrollTop=0);
  await p.screenshot({path:'/tmp/ops-loadout.png'});
 }
 const profiles=[{width:1440,height:1000},{width:800,height:600},{width:390,height:844},{width:320,height:568},{width:740,height:360}];
 async function reachable(selector){const el=p.locator(selector).first();await el.scrollIntoViewIfNeeded();assert(await el.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=-.5&&r.right<=innerWidth+.5&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`Reachable ${selector}`);}
 for(const language of ['en','zh'])for(const viewport of profiles){
  await p.setViewportSize(viewport);await p.evaluate(async language=>(await import('/js/i18n.js')).setLang(language),language);
  await p.evaluate(()=>__trench.app.hud.screen('select'));
  for(const selector of ['#class-row button','#weapon-row button','#secondary-row button','#btn-back','#btn-deploy'])await reachable(selector);
  assert(await p.evaluate(()=>document.querySelector('.weapon-block').getBoundingClientRect().bottom<=document.querySelector('#screen-select .select-foot').getBoundingClientRect().top));
  await p.evaluate(()=>__trench.app.settings.open());
  for(const selector of ['#rig-file','#lang-en','#local-export','#rig-back','#rig-upload'])await reachable(selector);
  await p.evaluate(()=>{const a=__trench.app;a.hud.screen('game');a.hud.showPause({host:true});});
  for(const selector of ['#btn-pause-resume','#btn-pause-settings','#btn-pause-invite','#btn-pause-leave'])await reachable(selector);
  await p.evaluate(()=>{const h=__trench.app.hud;h.hidePause();h.openInvite('host',{room:'12345678'});});
  for(const selector of ['#invite-code','#btn-invite-gen','#btn-invite-close'])await reachable(selector);
  await p.evaluate(()=>{const h=__trench.app.hud;h.closeInvite();h.openInvite('guest');});
  await reachable('#btn-invite-join');await reachable('#btn-invite-close');
  await p.evaluate(()=>{const a=__trench.app;a.hud.closeInvite();a.hud.screen('menu');a.tut.index=0;a.tut.done.clear();a.tut.inGame=false;a.tut.open();});
  for(const selector of ['#tutorial [data-act=skip]','#tutorial [data-act=go]'])await reachable(selector);
  await p.click('#tutorial [data-act=skip]');
 }
 await p.setViewportSize({width:1440,height:1000});await p.evaluate(async()=>(await import('/js/i18n.js')).setLang('en'));
 if(process.env.OPS_SCREENSHOTS){
  await p.evaluate(()=>{__trench.app.settings.open();document.querySelector('.settings-inner').scrollTop=0;});await p.screenshot({path:'/tmp/ops-settings.png'});
  await p.evaluate(()=>{__trench.app.hud.screen('game');__trench.app.hud.showPause({host:true});});await p.screenshot({path:'/tmp/ops-pause.png'});
  await p.evaluate(()=>{__trench.app.hud.hidePause();__trench.app.hud.openInvite('host',{room:'12345678'});});await p.screenshot({path:'/tmp/ops-invite.png'});
 }
 await p.close();
 console.log('PASS: EN/ZH keyboard class/primary/pistol choices, preserved selected states, 10 desktop/mobile profiles across loadout/workshop/pause/invite/tutorial, reachable actions and non-overlapping deploy footer');
 // Utility pages retain their actual scripts/previews; animation assertions cover the shell layout, not clip correctness.
 for(const file of ['debug.html','colorfixer.html','gun-lab.html?skin=procedural','anim-lab.html']){
  const t=await context.newPage();
  await t.goto(origin+'/'+file);
  if(file.startsWith('gun-lab')){
   await t.waitForFunction(()=>window.gunLab?.ready,null,{timeout:90000});
   await t.click('#record');assert(await t.locator('#record-count').textContent().then(s=>s.includes('1')));
   assert(await t.locator('#download').isEnabled());assert(await t.inputValue('#json'));
  }
  for(const viewport of profiles){
   await t.setViewportSize(viewport);
   assert(await t.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${file} ${viewport.width} horizontal overflow`);
   const back=t.locator(file.startsWith('gun-lab')?'body > header > a':'.ops-tool-back');await back.scrollIntoViewIfNeeded();
   assert(await back.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${file} back link`);
  }
  await t.setViewportSize({width:1440,height:1000});
  if(process.env.OPS_SCREENSHOTS)await t.screenshot({path:'/tmp/ops-'+file.split('.')[0]+'.png'});
  await t.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: diagnostics, color repair, actual Gun Lab record/export availability and animation-preview shell, 5 viewport sizes; no browser JavaScript errors');
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
