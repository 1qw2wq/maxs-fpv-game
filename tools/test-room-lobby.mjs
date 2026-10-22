// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import './test-room-lobby-unit.mjs';
import {testMultiplayerGas} from './test-poison-gas.mjs';
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
const errors=[],contexts=[];
const botCount=process.env.BOT_LOBBY_TEST?4:0;
async function context(isolated=false){
 const c=await browser.newContext({viewport:{width:1100,height:800}});contexts.push(c);
 await c.addInitScript(isolated=>{window.WebSocket=class{constructor(){throw Error('No backend');}};if(isolated)window.BroadcastChannel=class{constructor(){throw Error('RTC only');}};},isolated);
 await c.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return c;
}
async function page(c,name){const p=await c.newPage();await p.goto(origin+'/');await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});await p.locator('#boot').waitFor({state:'hidden'});await p.evaluate(async()=>{(await import('/js/i18n.js')).setLang('en');const a=__trench.app;a.renderer.setPixelRatio(.3);a.renderer.shadowMap.enabled=false;});await p.fill('#input-name',name);return p;}
async function approve(host){await host.waitForFunction(()=>__trench.app.roomLobby?.pending.size===1);await host.click('[data-lobby-action="approve"]');}
async function readyAndStart(host,guest){
 await guest.locator('#screen-select').waitFor({state:'visible'});
 assert.equal(await host.locator('#screen-menu').isVisible(),true);
 assert.equal(await guest.locator('#btn-deploy').textContent(),'Ready');
 await guest.locator('.class-card').nth(await guest.evaluate(()=>__trench.app.data.classes.findIndex(c=>c.id==='medic'))).click();
 await host.click('#map-row button[data-id="proc_city"]');
 await host.selectOption('#game-mode','control');
 if(botCount){
  await host.selectOption('#multi-bot-count',String(botCount));await host.selectOption('#bot-difficulty','elite');
  await guest.waitForFunction(()=>__trench.app.roomLobby.config.botDifficulty==='elite');
  assert.equal(await guest.locator('#multi-bot-count').isDisabled(),true);
  assert.equal(await guest.locator('#bot-difficulty').isDisabled(),true);
 }
 await guest.waitForFunction(()=>__trench.app.mapPick==='proc_city'&&document.getElementById('game-mode').value==='control');
 assert.equal(await guest.locator('#game-mode').isDisabled(),true);
 assert.equal(await guest.locator('#map-row button:not(:disabled)').count(),0);
 // Choose a smaller rendered map for the actual synchronized match; config must propagate a second time.
 await host.click('#map-row button[data-id="somme"]');
 await host.click('#btn-lobby-choose');assert.equal(await host.locator('#btn-deploy').isDisabled(),true);
 await guest.click('#btn-deploy');await host.waitForFunction(()=>__trench.app.roomLobby.canStart);
 // Editing a readied pistol or backing out must revoke Ready and retain the draft's primary.
 await guest.locator('#secondary-row button').nth(1).click();
 await host.waitForFunction(()=>!__trench.app.roomLobby.canStart);
 await guest.click('#btn-deploy');await host.waitForFunction(()=>__trench.app.roomLobby.canStart);
 const primary=await guest.evaluate(()=>__trench.app.hud.selected.weapon);
 await guest.click('#btn-back');await host.waitForFunction(()=>!__trench.app.roomLobby.canStart);
 await guest.click('#btn-lobby-choose');
 assert.equal(await guest.evaluate(()=>__trench.app.hud.selected.weapon),primary);
 await guest.click('#btn-deploy');await host.waitForFunction(()=>__trench.app.roomLobby.canStart);
 assert.equal(await guest.evaluate(()=>__trench.app.playing),false);
 // Simulate an engine boot failure AFTER RelayHostNet adopts the menu channel.
 // The same room, approvals and any RTC pairing must survive the retry.
 const wire=await host.evaluate(()=>__trench.app.roomChannel._wireId);
 await host.evaluate(async()=>{const {LocalNet}=await import('/js/local.js');const connect=LocalNet.prototype.connect;LocalNet.prototype.connect=async function(){LocalNet.prototype.connect=connect;throw Error('Intentional one-time QA engine failure');};});
 await host.click('#btn-deploy');
 await host.waitForFunction(()=>__trench.app.roomLobby?.phase==='waiting'&&!__trench.app.net);
 assert.equal(await guest.evaluate(()=>__trench.app.playing),false);
 assert.equal(await host.evaluate(()=>__trench.app.roomChannel._wireId),wire);
 await host.click('#btn-deploy');
 await host.waitForFunction(()=>__trench.app.playing&&__trench.app.roomLobby.phase==='started',null,{timeout:90000});
 await guest.waitForFunction(n=>__trench.app.playing&&__trench.app.net.lastState?.ps?.length===2+n,botCount,{timeout:90000});
 assert.equal(await host.evaluate(()=>__trench.app.net.status().bots),botCount);
 if(botCount){
  const rows=await guest.evaluate(()=>__trench.app.net.lastState.ps.filter(p=>p.ai));
  assert(rows.every(p=>p.ai==='elite'));
  await guest.evaluate(()=>__trench.app.net.send({t:'bots',on:false,n:0,difficulty:'recruit'}));
  const tick=await host.evaluate(()=>__trench.app.net.status().tick);
  await host.waitForFunction(tick=>__trench.app.net.status().tick>tick+3,tick);
  assert.equal(await host.evaluate(()=>__trench.app.net.status().bots),botCount,'guest cannot clear host bots');
 }
 assert.equal(await host.evaluate(()=>__trench.app.net.status().humans),2);
 assert.equal(await guest.evaluate(()=>__trench.app.loadout.cls),'medic');
 assert.equal(await guest.evaluate(()=>__trench.app.mapId),'somme');
 assert.equal(await host.evaluate(()=>__trench.app.net._lastState.gameMode),'control');
 if(process.env.GAS_LOBBY_TEST)await testMultiplayerGas(host,guest);
}
try{
 const c=await context(),host=await page(c,'Host QA'),guest=await page(c,'Guest QA');
 await host.click('#btn-room-create');await host.waitForFunction(()=>__trench.app.roomLobby?.role==='host');
 assert.equal(await host.locator('#screen-menu').isVisible(),true);assert.equal(await host.evaluate(()=>__trench.app.net),null);
 const code=await host.evaluate(()=>__trench.app.roomLobby.code);
 await guest.click('#btn-room-join');await guest.fill('#input-room',code);await guest.click('#btn-mode-multi');
 await host.waitForFunction(()=>__trench.app.roomLobby.pending.size===1);
 assert.equal(await guest.locator('#screen-menu').isVisible(),true);assert.equal(await guest.evaluate(()=>__trench.app.net.id),null);
 assert.match(await host.locator('#lobby-requests').textContent(),/Guest QA/);
 // Reject returns a waiting guest to the main menu with feedback; retry is a fresh request.
 await host.click('[data-lobby-action="reject"]');
 await guest.waitForFunction(()=>!__trench.app.roomLobby);
 assert.match(await guest.locator('#menu-error').textContent(),/declined/);
 await guest.click('#btn-mode-multi');await host.waitForFunction(()=>__trench.app.roomLobby.pending.size===1);
 for(const viewport of [{width:360,height:740},{width:740,height:360}]){
  await host.setViewportSize(viewport);await host.locator('#btn-lobby-choose').scrollIntoViewIfNeeded();
  assert(await host.evaluate(()=>{const panel=document.getElementById('lobby-main').getBoundingClientRect();const scroll=document.querySelector('.menu-inner');return panel.left>=0&&panel.right<=innerWidth&&scroll.scrollWidth<=scroll.clientWidth+1;}));
 }
 await host.setViewportSize({width:1100,height:800});
 if(process.env.LOBBY_SCREENSHOT)await host.screenshot({path:process.env.LOBBY_SCREENSHOT});
 // Main-page approve, selection Ready, and a host click are the only launch gestures.
 await approve(host);await readyAndStart(host,guest);
 const sid=await guest.evaluate(()=>__trench.app.net.sid);
 // An approved seat can still auto-rejoin after the authority drops it; no second approval/start.
 const previous=await guest.evaluate(()=>__trench.app.net.id);
 await host.evaluate(sid=>__trench.app.net._dropGuest(sid),sid);
 await guest.waitForFunction(previous=>__trench.app.playing&&__trench.app.net.id!==null&&__trench.app.net.id!==previous,previous);
 await host.waitForFunction(()=>__trench.app.net.status().humans===2);
 assert.equal(await host.evaluate(()=>__trench.app.net.status().bots),botCount,'approved rejoin retains host AI');
 const rogue=await c.newPage();await rogue.goto(origin+'/__harness.html');
 await rogue.evaluate(async code=>{const {RelayNet}=await import('/js/relay.js');window.rogueErrors=[];window.rogue=new RelayNet({onMessage:m=>rogueErrors.push(m)}, {code});await rogue.connect('',{code});rogue.join('Unapproved','assault','mp18',false,0,'',false,'somme','',code);},code);
 await rogue.waitForFunction(()=>rogueErrors.some(m=>m.t==='joinError'&&m.why==='approval'));
 assert.equal(await rogue.evaluate(()=>rogue.id),null);
 await rogue.evaluate(({sid,code})=>rogue.channel.send(`trench-front/v1/r/${code}`,JSON.stringify({v:1,k:'bye',sid})),{sid,code});
 await host.waitForFunction(sid=>__trench.app.net._guestSids.has(sid),sid);
 assert.equal(await host.evaluate(()=>__trench.app.net.status().humans),2);
 await rogue.evaluate(()=>rogue.close());await rogue.close();
 // Language changes recreate map buttons: the guest's host-only lock must survive.
 await guest.evaluate(async()=>{(await import('/js/i18n.js')).setLang('zh');});
 assert.equal(await guest.locator('#map-row button:not(:disabled)').count(),0);
 // Main-page lobby also fits narrow portrait and short landscape without horizontal overflow.
 for(const viewport of [{width:360,height:740},{width:740,height:360}]){
  await host.setViewportSize(viewport);
  assert(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await host.setViewportSize({width:1100,height:800});
 await guest.evaluate(()=>{const a=__trench.app;a.controls.releaseLock();a.hud.showPause({mobile:false});});
 await guest.click('#btn-pause-leave');await host.waitForFunction(()=>__trench.app.net.status().humans===1);
 await host.evaluate(()=>{const a=__trench.app;a.controls.releaseLock();a.hud.showPause({mobile:false});});await host.click('#btn-pause-leave');
 assert.equal(await host.evaluate(()=>__trench.app.roomLobby),null);
 console.log('PASS: native main-menu approval/automatic selection, shared map/rules, Ready gate, host-only synchronized launch, unapproved engine join/spoofed leave rejected, bilingual lock and live leave');
 await c.close();
 // Separate storage contexts + no BroadcastChannel: actual manual WebRTC, no backend, broker or discovery.
 const hc=await context(true),gc=await context(true),h=await page(hc,'RTC Host'),g=await page(gc,'RTC Guest');
 await h.click('#btn-room-create');await h.waitForFunction(()=>__trench.app.roomLobby?.role==='host');
 const wire=await h.evaluate(()=>__trench.app.roomChannel._wireId);
 await h.click('#btn-lobby-invite');await h.click('#btn-invite-gen');await h.waitForFunction(()=>document.getElementById('invite-code').value.startsWith('TF'));
 const invite=await h.inputValue('#invite-code');await h.click('#btn-invite-close');
 await g.click('#btn-room-invite');await g.fill('#invite-code',invite);await g.click('#btn-invite-join');
 // Wait on the answer status instead of reading the pasted offer back during gathering.
 await g.waitForFunction(()=>document.getElementById('invite-status').textContent.includes('Answer ready'),null,{timeout:30000});
 const answer=await g.inputValue('#invite-code');await h.click('#btn-lobby-invite');await h.fill('#invite-code',answer);await h.click('#btn-invite-accept');await h.click('#btn-invite-close');
 await h.waitForFunction(()=>__trench.app.roomChannel.peerCount===1,null,{timeout:30000});
 await approve(h);await readyAndStart(h,g);
 assert.equal(await h.evaluate(()=>__trench.app.net.channel._wireId),wire);
 assert.equal(await g.evaluate(()=>__trench.app.net.channel.peerCount),1);
 assert.equal(await g.evaluate(()=>__trench.app.roomLobby.launched),true);
 await g.evaluate(()=>__trench.app.net.chat('RTC lobby launch works'));await h.waitForFunction(()=>document.getElementById('chat-log').textContent.includes('RTC lobby launch works'));
 await h.evaluate(()=>{const a=__trench.app;a.controls.releaseLock();a.hud.showPause({mobile:false});});await h.click('#btn-pause-leave');
 await g.waitForFunction(()=>!__trench.app.playing&&!__trench.app.roomLobby);
 assert.equal(await g.locator('#screen-menu').isVisible(),true);assert.match(await g.locator('#menu-error').textContent(),/closed|lost/);
 console.log('PASS: actual offer/answer UI, separate browsers with BroadcastChannel/WebSocket disabled, host and guest retain paired RTC channel through automatic match launch and chat');
 assert.deepEqual(errors,[]);console.log('PASS: no browser JavaScript errors');
}finally{for(const c of contexts)await c.close().catch(()=>{});await browser.close();await new Promise(r=>server.close(r));}
