// Focused browser regression; test dependencies stay outside the repository.
// npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {testGrenades,testLiveGrenades} from './test-grenades.mjs';
import {testGrenadeModels} from './test-grenade-models.mjs';
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
try{
 const context=await browser.newContext({viewport:{width:1100,height:750}}),errors=[];
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await testGrenades(context,origin);await testGrenadeModels(context,origin);
 if(!process.env.GRENADE_ASSETS_ONLY){
  const p=await context.newPage();await p.goto(origin+'/');
  await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});
  await p.fill('#input-name','Grenade QA');await p.click('#btn-mode-solo');await p.click('#btn-deploy');
  await p.waitForFunction(()=>__trench.app.playing&&__trench.app.net.lastMe?.alive,null,{timeout:60000});
  await p.evaluate(()=>{const a=__trench.app;a.net._engine.py.runPython('_host.room.match.drop_bots(); _host.room.bots_on=False');a.world.group.visible=false;a.renderer.shadowMap.enabled=false;a.renderer.setPixelRatio(.25);});
  await p.click('#game',{position:{x:500,y:300},force:true});
  await p.waitForFunction(()=>__trench.app.controls.locked);
  await testLiveGrenades(p);
  if(process.env.GRENADE_FINAL_SCREENSHOT)await p.screenshot({path:process.env.GRENADE_FINAL_SCREENSHOT});
  // Inject the same aged FX shape carried by a welcome snapshot. This checks
  // main.js late presentation without inventing new authority/RTC behavior.
  await p.evaluate(()=>{const a=__trench.app;
    a.net._dispatch({t:'fx',fx:{k:'smoke',eid:99001,p:[3,.091,0],from:[0,1.58,0],path:[[0,0,1.58,0],[600,3,.091,0],[1800,3,.091,0]],delay:1800,dur:14000,age:3800,r:13}});
  });
  await p.waitForFunction(()=>{const e=__trench.app.effects.find(e=>e.eid===99001);return e?.proj?.userData.imported&&e.density>0;});
  assert(await p.evaluate(()=>{const e=__trench.app.effects.find(e=>e.eid===99001);return e.landed&&e.proj.visible&&e.obj.visible&&!e.playDetonation&&e.proj.position.distanceTo({x:3,y:.091,z:0})<.001&&performance.now()-e.start>=2000;}),'Aged smoke must retain its canister/remaining age without replaying ignition');
  await p.evaluate(()=>__trench.app.net._dispatch({t:'fx',fx:{k:'incendiary',eid:99002,p:[5,.091,0],dur:7000,age:1000,r:4}}));
  await p.waitForFunction(()=>__trench.app.grenadeLights.some(l=>l.intensity>0));
  console.log('PASS: main.js aged smoke snapshot retains the settled model and clock; active fire uses pooled lighting');
  await p.keyboard.press('Escape');await p.click('#btn-pause-leave');
  await p.waitForFunction(()=>!__trench.app.playing);
  assert(await p.evaluate(()=>{const a=__trench.app;return !a.effects.length&&a.grenadeLights.every(l=>l.intensity===0)&&!a.fxGroup.children.some(o=>o.name==='grenade-projectile');}),'Leaving must clear grenade bodies, particles and light');
  console.log('PASS: real leave-to-menu clears grenade bodies/particles and resets both pooled lights');
  await p.close();
 }
 assert.deepEqual(errors,[]);await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
