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
try {
 const errors=[],issues=[];
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await context.addInitScript(()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedReport=text;}}});
 });
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 for(const language of ['en','zh']) {
  const p=await context.newPage(),requests=[];
  const cdp=await context.newCDPSession(p);await cdp.send('Audits.enable');
  cdp.on('Audits.issueAdded',event=>issues.push(event.issue));
  p.on('request',r=>requests.push(new URL(r.url()).pathname));
  await p.goto(`${origin}/debug.html?lang=${language}`);
  await p.waitForFunction(()=>document.querySelector('#logs').textContent.includes('---- done ----'));
  const expected=language==='en'?'Not started on this diagnostics page (expected)':'此诊断页不启动 main.js（正常）';
  assert((await p.locator('#t-net').textContent()).includes(expected));
  assert.equal(await p.locator('#t-net .bad, #t-net .ok').count(),0,'unobserved game is neither an error nor a successful boot');
  assert.equal(await p.evaluate(()=>typeof window.__trench),'undefined');
  assert.equal(requests.some(path=>path.endsWith('/main.js')||path.endsWith('.wasm')),false,'diagnostics must not start the game/engine');
  assert.equal(await p.locator('#t-api tr').count(),3);
  assert.equal(await p.locator('#t-api .bad').count(),0);
  await p.click('#copy');await p.waitForFunction(()=>!!window.__copiedReport);
  const report=await p.evaluate(()=>JSON.parse(window.__copiedReport));
  assert.equal(report.multiplayer.scope,'current-document-only');
  assert.equal(report.multiplayer.runtimeStatus,'not-applicable-on-diagnostics-page');
  assert.equal(report.multiplayer.engine,null);
  // Re-probing must not bring back the false warning.
  await p.click('#run');await p.waitForFunction(()=>document.querySelectorAll('#t-api tr').length===3);
  assert((await p.locator('#t-net').textContent()).includes(expected));
  // Exercise the actual Peer offer/answer path; no fake WebRTC objects.
  await p.click('#p2p');await p.waitForFunction(()=>!document.querySelector('#p2p').disabled,null,{timeout:45000});
  assert.equal(await p.locator('#t-p2p .bad').count(),0,'real same-browser peer self-test');
  const text=await p.locator('#t-p2p').textContent();
  assert(text.includes(language==='en'?'works (one message each way)':'通了（来回各一条消息）'));
  assert(text.includes(language==='en'?'Passing does not verify game startup':'通过不代表游戏已经启动'));
  for(const width of [1280,390,320]){
   await p.setViewportSize({width,height:844});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`diagnostics ${language} ${width} overflow`);
   await p.locator('#back').scrollIntoViewIfNeeded();
   assert(await p.locator('#back').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  }
  if(process.env.DIAGNOSTICS_SCREENSHOTS&&language==='en'){
   await p.setViewportSize({width:1280,height:900});await p.locator('#h-net').scrollIntoViewIfNeeded();
   await p.screenshot({path:'/tmp/diagnostics-runtime.png'});
  }
  // A real API failure still gets a red error; the fix must not hide it.
  await p.route('**/api/health',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
  await p.click('#run');await p.waitForFunction(()=>document.querySelector('#t-api .bad')?.textContent==='503');
  assert((await p.locator('#t-net').textContent()).includes(expected));
  await p.unroute('**/api/health');
  // Keep the optional same-document developer view/report working.
  await p.evaluate(()=>{window.__trench={app:{localEngine:true,roomMode:'solo'}};});
  await p.click('#run');await p.waitForFunction(()=>document.querySelector('#t-net').textContent.includes('Pyodide'));
  await p.evaluate(()=>{window.__copiedReport='';});await p.click('#copy');await p.waitForFunction(()=>!!window.__copiedReport);
  assert.equal(await p.evaluate(()=>JSON.parse(window.__copiedReport).multiplayer.runtimeStatus),'app-handle-present');
  await p.evaluate(()=>delete window.__trench);
  // Follow the actual Back link: index.html must load real main.js and boot.
  if(language==='en'){
   await p.click('#back');await p.waitForURL('**/index.html');
   await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});
   await p.locator('#boot').waitFor({state:'hidden',timeout:90000});
   assert(await p.locator('#screen-menu').isVisible());
   assert(requests.includes('/js/main.js'));
  }
  await p.close();
 }
 assert.deepEqual(errors,[],'browser JavaScript errors');
 assert.equal(issues.some(issue=>/LateImportRule|ImportNotFirst|@import/i.test(JSON.stringify(issue))),false,'no late @import issue from these pages');
 console.log('PASS: EN/ZH standalone diagnostics has no false main.js error or implied successful boot; scoped copy reports; actual bidirectional P2P self-test; 3 widths; genuine API failures remain visible; Back opens and boots real main.js; no JS errors or late-import issues');
 await context.close();
} finally {await browser.close();await new Promise(r=>server.close(r));}
