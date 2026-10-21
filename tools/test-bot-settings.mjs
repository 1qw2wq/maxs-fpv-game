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
 const errors=[];
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(()=>{window.WebSocket=class{constructor(){throw Error('No backend');}};});
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 const p=await context.newPage();await p.goto(origin+'/');
 await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});await p.locator('#boot').waitFor({state:'hidden'});
 await p.evaluate(()=>{__trench.app.renderer.setPixelRatio(.25);__trench.app.renderer.shadowMap.enabled=false;});
 for(const language of ['en','zh'])for(const viewport of [{width:1440,height:1000},{width:800,height:600},{width:390,height:844},{width:320,height:568},{width:740,height:360}]){
  await p.setViewportSize(viewport);await p.evaluate(async lang=>(await import('/js/i18n.js')).setLang(lang),language);
  for(const selector of ['#bot-count button[data-n="0"]','#bot-count button[data-n="16"]','#multi-bot-count','#bot-difficulty']){
   const el=p.locator(selector);await el.scrollIntoViewIfNeeded();
   assert(await el.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=-.5&&r.right<=innerWidth+.5&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${language} ${viewport.width} ${selector}`);
  }
  if(process.env.BOT_SCREENSHOTS&&language==='en'&&(viewport.width===1440||viewport.width===390))await p.screenshot({path:`/tmp/bot-settings-${viewport.width}.png`});
 }
 await p.setViewportSize({width:1280,height:900});await p.evaluate(async()=>(await import('/js/i18n.js')).setLang('en'));
 const levels=['mixed','recruit','regular','veteran','elite'];
 for(const level of levels){
  await p.selectOption('#bot-difficulty',level);await p.click('#bot-count button[data-n="4"]');
  await p.click('#btn-mode-solo');await p.click('#btn-deploy');
  await p.waitForFunction(()=>__trench.app.playing&&__trench.app.net.lastState?.ps?.filter(p=>p.ai).length===4,null,{timeout:90000});
  const roster=await p.evaluate(()=>__trench.app.net.lastState.ps.filter(p=>p.ai));
  if(level==='mixed')assert(roster.some(p=>p.ai==='recruit')&&roster.some(p=>p.ai==='regular'));
  else assert(roster.every(p=>p.ai===level),`${level} real Pyodide roster`);
  const python=await p.evaluate(()=>JSON.parse(__trench.app.net._engine.py.runPython("json.dumps({'solo':_host.room.match.solo,'difficulty':_host.room.match.bot_difficulty})")));
  assert.equal(python.solo,true);assert.equal(python.difficulty,level);
  // Inspect the actual translated scoreboard tier, including the new Elite.
  await p.evaluate(()=>{const a=__trench.app;a.hud.scoreboard(true,a.net.lastState.ps,a.net.lastState,a.myId,a.myTeam);});
  assert((await p.locator('#scoreboard').textContent()).includes(level==='mixed'?'AI Recruit':`AI ${level==='recruit'?'Recruit':level==='regular'?'Regular':level==='veteran'?'Veteran':'Elite'}`));
  await p.evaluate(()=>{__trench.app.hud.scoreboard(false);__trench.app.hud.showPause({host:false});});
  await p.click('#btn-pause-leave');await p.waitForFunction(()=>!__trench.app.playing&&document.querySelector('#screen-menu').classList.contains('hidden')===false);
 }
 // 0 explicitly disables bots, even in Solo; tutorial remains independent.
 await p.click('#bot-count button[data-n="0"]');await p.click('#btn-mode-solo');await p.click('#btn-deploy');
 await p.waitForFunction(()=>__trench.app.playing&&__trench.app.net.lastState?.ps?.length===1,null,{timeout:90000});
 assert.equal(await p.evaluate(()=>__trench.app.net.status().bots),0);
 await p.evaluate(()=>__trench.app.hud.showPause({host:false}));await p.click('#btn-pause-leave');
 await p.selectOption('#multi-bot-count','5');await p.selectOption('#bot-difficulty','veteran');
 await p.reload();await p.waitForFunction(()=>window.__trench?.app.localEngine,null,{timeout:90000});await p.locator('#boot').waitFor({state:'hidden'});
 assert.equal(await p.inputValue('#multi-bot-count'),'5');assert.equal(await p.inputValue('#bot-difficulty'),'veteran');
 assert(await p.locator('#bot-count button[data-n="0"]').evaluate(el=>el.classList.contains('on')));
 // Invalid imported values are sanitized instead of starting an unknown tier.
 assert.deepEqual(await p.evaluate(async()=>{const m=await import('/js/profile.js');const s=m.sanitize({multiBots:999,botDifficulty:'cheat'});return [s.multiBots,s.botDifficulty];}),[16,'mixed']);
 assert.deepEqual(errors,[]);
 console.log('PASS: both languages x 5 viewport sizes; all five difficulty choices deploy to actual Solo/Pyodide rosters; translated tiers; zero bots; remembered settings/reload and invalid profile sanitization; no browser JS errors');
 await context.close();
} finally {await browser.close();await new Promise(r=>server.close(r));}
