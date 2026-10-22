// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {testGasAssets,testLiveGas} from './test-poison-gas.mjs';
import {testMobile} from './test-mobile.mjs';
const require=createRequire(resolve(process.env.TEST_DEPS||'/tmp/maxs-fpv-browser-tests','package.json'));
const {chromium:pw}=require('playwright-core');
const {default:chromium,inflate,setupLambdaEnvironment}=await import(require.resolve('@sparticuz/chromium'));
if(process.platform==='linux'&&!process.env.CHROMIUM_EXECUTABLE){const libs=await inflate(fileURLToPath(new URL('../bin/al2023.tar.br',pathToFileURL(require.resolve('@sparticuz/chromium')))));setupLambdaEnvironment(resolve(libs,'lib'));}
const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary'};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://test').pathname;
 if(path==='/__harness.html'){res.setHeader('Content-Type','text/html');res.end('<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/"}}</script><canvas id="game"></canvas>');return;}
 const local=/^\/api\/(health|rooms|characters)$/.test(path)?path+'.json':path;
 const file=resolve(root,'.'+(local==='/'?'/index.html':local));
 if(!file.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await pw.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('disable-web-security')&&a!=='--single-process'),headless:true});
try {
 const context=await browser.newContext({viewport:{width:1100,height:750}}),errors=[];
 await context.addInitScript(()=>{window.WebSocket=class{constructor(){throw Error('No backend in static test');}};});
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 if(!process.env.GAS_MOBILE_ONLY)await testGasAssets(context,origin);
 if(!process.env.GAS_ASSETS_ONLY&&!process.env.GAS_MOBILE_ONLY){
  const p=await context.newPage();await p.goto(origin+'/');
  await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});
  await p.evaluate(async()=>{(await import('/js/i18n.js')).setLang('en');__trench.app.renderer.setPixelRatio(.3);__trench.app.renderer.shadowMap.enabled=false;});
  await p.fill('#input-name','Gas QA');await p.click('#btn-mode-solo');await p.click('#btn-deploy');
  await p.waitForFunction(()=>__trench.app.playing&&__trench.app.net.lastMe?.alive,null,{timeout:60000});
  await p.click('#game',{position:{x:500,y:300},force:true});await p.waitForFunction(()=>__trench.app.controls.locked);
  try { await testLiveGas(p); } catch(error) {
    console.log('GAS DEBUG',await p.evaluate(()=>{const a=__trench.app;return {me:a.net?.lastMe,locked:a.controls.locked,paused:a.paused,kind:a.grenadeKind,effects:a.effects.map(e=>({kind:e.kind,density:e.density,dur:e.dur,age:performance.now()-e.start,landed:e.landed,imported:e.proj?.userData.imported})),position:a.controls.pos.toArray()};}));
    await p.screenshot({path:'/tmp/gas-browser-failure.png'});throw error;
  }
  await p.close();
 }
 assert.deepEqual(errors,[]);await context.close();
 if(!process.env.GAS_ASSETS_ONLY)await testMobile(browser,origin);
 console.log('PASS: poison-gas browser integration without an external backend or JavaScript errors');
} finally { await browser.close();await new Promise(r=>server.close(r)); }
