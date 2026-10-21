// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {testLayouts} from './test-layout.mjs';
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
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),errors=[];
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await testLayouts(context,origin);
 const p=await context.newPage();await p.goto(origin+'/');
 await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});
 await p.locator('#boot').waitFor({state:'hidden'});
 await p.evaluate(async()=>{(await import('/js/i18n.js')).setLang('en');const a=__trench.app;a.renderer.setPixelRatio(.3);a.renderer.shadowMap.enabled=false;});
 // Native disclosure remains usable, and the optional address was not removed.
 assert.equal(await p.locator('#input-server').isVisible(),false);
 await p.click('.landing-help summary');await p.locator('#input-server').waitFor({state:'visible'});
 await p.click('.landing-help summary');
 for(const language of ['en','zh'])for(const viewport of [{width:1440,height:1100},{width:1024,height:768},{width:390,height:844},{width:320,height:568},{width:740,height:360}]){
  await p.setViewportSize(viewport);await p.evaluate(async language=>(await import('/js/i18n.js')).setLang(language),language);
  for(const selector of ['.landing-topbar','.landing-hero','.landing-setup','.landing-launch','.landing-bottom','.landing-footer']){
   assert(await p.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=-.5&&r.right<=innerWidth+.5;}),`${language} ${viewport.width} ${selector} viewport`);
  }
  for(const selector of ['#btn-mode-multi','#btn-mode-solo','#btn-mode-tutorial','#btn-mode-settings','.landing-help summary','.landing-footer a']){
   const target=p.locator(selector).first();await target.scrollIntoViewIfNeeded();
   assert(await target.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${language} ${viewport.width} ${selector} clickable`);
  }
  await p.click('.landing-help summary');
  assert(await p.locator('.landing-help').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${language} ${viewport.width} expanded advanced options`);
  await p.locator('#input-server').scrollIntoViewIfNeeded();
  assert(await p.locator('#input-server').isVisible());await p.click('.landing-help summary');
  await p.locator('.landing-topbar').scrollIntoViewIfNeeded();
  if(process.env.LANDING_SCREENSHOTS&&language==='en'&&(viewport.width===1440||viewport.width===390)){
   await p.screenshot({path:`/tmp/landing-${viewport.width}.png`});
   await p.locator('.landing-bottom').scrollIntoViewIfNeeded();await p.screenshot({path:`/tmp/landing-bottom-${viewport.width}.png`});
  }
 }
 await p.setViewportSize({width:1440,height:1100});await p.evaluate(async()=>(await import('/js/i18n.js')).setLang('en'));
 await p.fill('#input-name','Landing QA');await p.click('#btn-room-create');
 await p.waitForFunction(()=>__trench.app.roomLobby?.role==='host');
 assert(await p.locator('#screen-menu').isVisible());assert(await p.locator('#lobby-main').isVisible());
 assert.equal(await p.locator('#input-name').isDisabled(),true);
 await p.click('#btn-lobby-leave');await p.waitForFunction(()=>!__trench.app.roomLobby);
 // Settings and tutorial still open from their reorganized utility section.
 await p.click('#btn-mode-settings');assert(await p.locator('#screen-settings').isVisible());
 await p.evaluate(()=>__trench.app.hud.screen('menu'));
 await p.click('#btn-mode-tutorial');assert(await p.locator('#tutorial').isVisible());
 assert.deepEqual(errors,[]);
 console.log('PASS: redesigned desktop/mobile landing, 2 languages × 5 viewports, all bottom actions reachable, advanced disclosure, live room creation/leave, settings/tutorial, no JS errors');
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
