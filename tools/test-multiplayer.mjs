// Strict static-host multiplayer regression: no backend, broker or external requests.
// Test-only: npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
// node tools/test-multiplayer.mjs
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(resolve(process.env.TEST_DEPS||'/tmp/maxs-fpv-browser-tests','package.json'));
const {chromium:playwright}=require('playwright-core');
const {default:chromium,inflate,setupLambdaEnvironment}=await import(require.resolve('@sparticuz/chromium'));
if(process.platform==='linux'&&!process.env.CHROMIUM_EXECUTABLE){const libs=await inflate(fileURLToPath(new URL('../bin/al2023.tar.br',pathToFileURL(require.resolve('@sparticuz/chromium')))));setupLambdaEnvironment(resolve(libs,'lib'));}
const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://test').pathname;
 if(path==='/__harness.html'){res.setHeader('Content-Type','text/html');res.end('<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/"}}</script><canvas></canvas>');return;}
 const local=/^\/api\/(health|rooms|characters)$/.test(path)?path+'.json':path;
 const file=resolve(root,'.'+(local==='/'?'/index.html':local));
 if(!file.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||await chromium.executablePath(),args:chromium.args.filter(a=>!a.includes('disable-web-security')&&a!=='--single-process'),headless:true});
const errors=[],unexpected=[];
async function context(){
 const c=await browser.newContext({viewport:{width:1100,height:750}});
 await c.addInitScript(()=>{window.BroadcastChannel=undefined;window.WebSocket=class{constructor(){throw Error('No backend allowed in static-host regression');}};});
 await c.route('**/*',r=>{if(r.request().url().startsWith(origin))r.continue();else{unexpected.push(r.request().url());r.abort();}});
 c.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')console.error('BROWSER',m.text());});});
 return c;
}
async function gamePage(c,name){
 const p=await c.newPage();await p.goto(origin+'/');
 await p.waitForFunction(()=>window.__trench?.app.hud&&__trench.app.localEngine,null,{timeout:90000});
 await p.evaluate(name=>{const a=__trench.app;a.hud.el.name.value=name;a.renderer.setPixelRatio(.25);},name);
 return p;
}
async function playing(p){
 try{await p.waitForFunction(()=>__trench.app.playing&&__trench.app.net?.lastMe?.alive,null,{timeout:45000});
 // Keep real collision/input/characters; scenery shader cost is not a transport test.
 await p.evaluate(()=>{const a=__trench.app;a.world.group.visible=false;a.renderer.shadowMap.enabled=false;});}
 catch(e){console.error('UI DIAGNOSTIC',await p.evaluate(()=>{const a=__trench.app;return {url:a.netUrl,playing:a.playing,paused:a.paused,peers:a.net?.peers,room:a.roomCode,relayHostCode:a.relayHostCode,mode:a.net?.mode,me:a.net?.lastMe,note:a.hud.el.menuError.textContent,invite:a.hud.el.inviteStatus.textContent};}));throw e;}
}
try{
 if(!process.env.MULTIPLAYER_MAPS_ONLY){
 const hc=await context(),gc=await context();
 const host=await gamePage(hc,'UI Host'),guest=await gamePage(gc,'UI Guest');
 await host.click('#btn-room-create');await host.waitForSelector('#btn-select-invite',{state:'visible'});
 const code=await host.evaluate(()=>__trench.app.relayHostCode);assert.match(code,/^\d{8}$/);
 await host.click('#btn-select-invite');await host.click('#btn-invite-gen');
 await host.waitForFunction(()=>document.querySelector('#invite-code').value.startsWith('TFi1.'),null,{timeout:20000});
 const invite=await host.locator('#invite-code').inputValue();
 await guest.click('#btn-room-invite');await guest.fill('#invite-code',invite);await guest.click('#btn-invite-join');
 await guest.waitForFunction(()=>document.querySelector('#invite-code').value.startsWith('TFa1.'),null,{timeout:20000});
 const answer=await guest.locator('#invite-code').inputValue();
 await host.fill('#invite-code',answer);await host.click('#btn-invite-accept');
 await host.waitForFunction(()=>__trench.app.roomChannel?.peerCount===1,null,{timeout:25000});
 await host.click('#btn-invite-close');await guest.click('#btn-invite-close');
 await host.evaluate(()=>__trench.app.hud.setServerAddress('stale.invalid:9999'));
 await host.click('#btn-deploy');await playing(host);
 // A stale optional backend address must not destroy an explicitly paired link.
 await guest.evaluate(()=>__trench.app.hud.setServerAddress('not a valid host !!'));
 await guest.click('#btn-mode-multi');await guest.click('#btn-deploy');await playing(guest);
 await guest.waitForFunction(()=>__trench.app.net.lastState?.ps?.length===2,null,{timeout:15000});
 assert.equal(await host.evaluate(()=>__trench.app.net.status().humans),2);
 assert.equal(await guest.evaluate(()=>__trench.app.net.peers),1);
 console.log('PASS: actual menu Create → invite → answer → pair → deploy, isolated contexts, no BroadcastChannel/backend/broker');
 // Use a clear, real map lane; only fixture placement bypasses movement.
 const ids={host:await host.evaluate(()=>__trench.app.myId),guest:await guest.evaluate(()=>__trench.app.myId)};
 // Wait for both actual frame loops to upload input; first-render shader work
 // can otherwise consume a whole fresh shield before keyboard input is possible.
 for(const p of [host,guest])await p.evaluate(()=>{const c=__trench.app.controls;c.setMobileMode(true);c.requestLock();});
 try{await host.waitForFunction(()=>__trench.app.net._engine.py.runPython("all(bool(p['flags']) for p in _relay.room.match.players.values())"),null,{polling:50,timeout:90000});}
 catch(e){for(const p of [host,guest])console.error('FRAME READY',await p.evaluate(()=>{const a=__trench.app;return {playing:a.playing,paused:a.paused,last:a.last,now:performance.now(),enabled:a.controls.enabled,me:a.net.lastMe};}));throw e;}
 // Fresh authoritative lives isolate action cancellation from elapsed joining time.
 await host.evaluate(()=>__trench.app.net._engine.py.runPython(`
_m=_relay.room.match
for _p in _m.players.values():
 _m.outbox.extend(_m._spawn(_p))
`));
 for(const p of [host,guest])await p.waitForFunction(()=>__trench.app.net.lastMe.life===2&&__trench.app.net.lastMe.shieldMs>0,null,{polling:50});
 await guest.evaluate(()=>{const c=__trench.app.controls;c.setMobileMode(true);c.requestLock();});
 await guest.keyboard.down('w');
 await guest.waitForFunction(()=>__trench.app.net.lastMe.shieldMs===0,null,{polling:50});
 await guest.keyboard.up('w');
 const shieldDebug=await host.evaluate(()=>{const a=__trench.app;return {me:a.net.lastMe,controls:{pos:a.controls.pos.toArray(),move:a.controls.moveSpeed},server:JSON.parse(a.net._engine.py.runPython("__import__('json').dumps([dict(id=p['id'],pos=p['pos'],motion=p['shield_motion'],cancelled=p['shield_cancelled'],flags=p['flags'],age=__import__('game').now_ms()-p['spawned_at']) for p in _relay.room.match.players.values()])"))};});
 assert(shieldDebug.me.shieldMs>0,JSON.stringify(shieldDebug));
 await host.waitForFunction(id=>__trench.app.net.sample().get(id)?.shieldMs===0,ids.guest,{polling:50});
 await host.evaluate(()=>__trench.app.net.send({t:'fire',d:[0,1,0]}));
 await host.waitForFunction(()=>__trench.app.net.lastMe.shieldMs===0,null,{polling:50});
 await guest.waitForFunction(id=>__trench.app.net.sample().get(id)?.shieldMs===0,ids.host,{polling:50});
 console.log('PASS: real keyboard movement cancels only the guest shield; host firing then cancels its own, replicated to both clients');
 async function duel(){
   const positions=await host.evaluate(async()=>{
     const {app:a}=__trench,{rayWorld}=await import('/js/ballistics.js'),T=await import('/vendor/three.module.js');
     const b=a.world.bounds||a.world.map?.bounds||{minX:-40,maxX:40,minZ:-30,maxZ:30};
     for(let x=(b.minX||-40)+5;x<(b.maxX||40)-10;x+=3)for(let z=(b.minZ||-30)+5;z<(b.maxZ||30)-5;z+=3){
       const y=a.world.floorAt(x,z,0);let clear=true;
       for(let t=0;t<=5;t+=.5)if(a.world.blocked(x+t,z,y)||Math.abs(a.world.floorAt(x+t,z,y)-y)>.02)clear=false;
       if(clear&&rayWorld(a.world,new T.Vector3(x,y+1.58,z),new T.Vector3(1,0,0),5)===null)return [[x,y,z],[x+5,y,z]];
     }throw Error('No clear duel lane');
   });
   await host.evaluate(({ids,positions})=>{
     const a=__trench.app;
     a.net._engine.py.runPython(`
import game
_m=_relay.room.match
for _id,_pos in ${JSON.stringify([[ids.host,positions[0]],[ids.guest,positions[1]]])}:
 _p=_m.players[_id]
 _p['pos']=_pos[:];_p['safe_pos']=_pos[:];_p['shield_until']=0;_p['hp']=100.;_p['last_shot']=0.
 _p['flags']={};_p['last_input']=game.now_ms()-200
 _p['recovery_seq']+=1;_p['recovery_pos']=_pos[:]
 game._seed_hist(_p,game.now_ms())
`);
   },{ids,positions});
   for(const [p,i] of [[host,0],[guest,1]])await p.evaluate(({pos,yaw})=>{
     const a=__trench.app;a.controls.reset(pos,yaw);a.controls.setMobileMode(true);a.controls.requestLock();
   },{pos:positions[i],yaw:i?180:0});
   await host.waitForFunction(({id,p})=>{const v=__trench.app.net.lastState?.ps?.find(v=>v.i===id);return v&&Math.abs(v.p[0]-p[0])<.05;},{id:ids.guest,p:positions[1]});
   for(const p of [host,guest])await p.waitForFunction(({ids,positions})=>{
     const ps=__trench.app.net.lastState?.ps||[];
     return [ids.host,ids.guest].every((id,i)=>{const row=ps.find(p=>p.i===id);return row&&!(row.f&1)&&Math.hypot(...row.p.map((v,k)=>v-positions[i][k]))<.04;});
   },{ids,positions});
   return positions;
 }
 await duel();
 await guest.keyboard.down('c');
 await host.waitForFunction(id=>__trench.app.net.lastState.ps.some(p=>p.i===id&&(p.f&1)),ids.guest);
 await host.waitForFunction(id=>__trench.app.remotes.get(id)?.crouchAmount>.85,ids.guest);
 await guest.keyboard.up('c');
 await host.waitForFunction(id=>__trench.app.net.lastState.ps.some(p=>p.i===id&&!(p.f&1)),ids.guest);
 const start=await guest.evaluate(()=>__trench.app.controls.pos.toArray());
 await guest.keyboard.down('w');
 await host.waitForFunction(({id,start})=>{const p=__trench.app.net.lastState.ps.find(p=>p.i===id);return Math.hypot(p.p[0]-start[0],p.p[2]-start[2])>.6;},{id:ids.guest,start});
 await guest.keyboard.up('w');
 console.log('PASS: real guest keyboard crouch/walk reaches host authority and rendered crouch');
 // Pausing only the guest must not lose its room seat at the silence boundary.
 await guest.keyboard.press('Escape');await guest.waitForFunction(()=>__trench.app.paused);
 await host.evaluate(()=>{const n=__trench.app.net;for(const sid of n._guestSids)n._seen.set(sid,performance.now()-29900);});
 await guest.evaluate(()=>__trench.app.net._checkHost());
 await host.waitForFunction(()=>{const n=__trench.app.net;return [...n._guestSids].every(s=>performance.now()-n._seen.get(s)<1000);});
 await guest.click('#btn-pause-resume');
 assert.equal(await guest.evaluate(()=>__trench.app.myId),ids.guest);
 console.log('PASS: paused guest heartbeat keeps the same authoritative seat at timeout boundary');
 // Pausing the host freezes authority and tells the guest immediately.
 await host.keyboard.press('Escape');await guest.waitForFunction(()=>__trench.app.net.hostPaused);
 const mag=await guest.evaluate(()=>__trench.app.net.lastMe.mag);
 await guest.evaluate(()=>__trench.app.net.send({t:'fire',d:[0,1,0]}));
 await host.evaluate(()=>new Promise(r=>setTimeout(r,150)));
 assert.equal(await guest.evaluate(()=>__trench.app.net.lastMe.mag),mag);
 await guest.evaluate(()=>__trench.app.net.chat('pause-liveness'));
 await host.waitForFunction(()=>document.querySelector('#chat-log').textContent.includes('pause-liveness'));
 assert.equal(await guest.evaluate(()=>__trench.app.net.hostPaused),true,'Chat frames must not falsely resume a paused authority');
 await host.click('#btn-pause-resume');await guest.waitForFunction(()=>!__trench.app.net.hostPaused);
 console.log('PASS: host pause is signalled, guest controls freeze, authority rejects paused shots, resume recovers');
 for(const [shooter,victim,sign] of [[guest,host,-1],[host,guest,1]]){
   await duel();
   const life=await victim.evaluate(()=>__trench.app.net.lastMe.life);
   // Real fire commands, real damage/kill messages and actual redeploy UI.
   for(let shot=0;shot<5&&await victim.evaluate(()=>!!__trench.app.net.lastMe.alive);shot++){
     const before=await shooter.evaluate(()=>__trench.app.net.lastMe.mag);
     await shooter.evaluate(sign=>{const a=__trench.app;a.net.send({t:'fire',d:[sign,0,0]});},sign);
     await shooter.waitForFunction(before=>__trench.app.net.lastMe.mag<before,before,{timeout:5000});
     await shooter.evaluate(()=>new Promise(r=>setTimeout(r,160)));
   }
   try{await victim.waitForFunction(()=>!__trench.app.net.lastMe.alive,null,{timeout:10000});}
   catch(e){console.error('DUEL',sign,await host.evaluate(()=>__trench.app.net._engine.py.runPython(`
import json,combat
json.dumps({'phase':_m.phase,'players':[{k:v for k,v in p.items() if k in ('id','pos','hp','alive','flags','mag','team','shield_until','weapon')} for p in _m.players.values()], 'ray':combat.ray_world(game.eye_pos(_m.players[1]),(1,0,0),8)})
`)));throw e;}
   await shooter.waitForFunction(()=>document.querySelector('#kill-confirm').classList.contains('show'));
   await victim.waitForFunction(()=>!document.body.classList.contains('death-sequence')&&__trench.app.deathCamera?.elapsed>1.05);
   await victim.locator('#death-loadout [data-secondary="deagle"]').click();
   await victim.waitForFunction(()=>!document.querySelector('#btn-respawn').disabled);
   await victim.click('#btn-respawn');await playing(victim);
   await victim.waitForFunction(life=>__trench.app.net.lastMe.life>life&&__trench.app.self.deathState.elapsed===0,life);
   assert.equal(await victim.evaluate(()=>__trench.app.net.lastMe.secondary),'deagle');
   assert.equal(await victim.evaluate(()=>__trench.app.net.peers),1);
 }
 console.log('PASS: host AND guest authoritative damage/kill/death animation/redeploy, life increments and chosen pistol, RTC link preserved');
 for(const p of [host,guest]){
   await p.evaluate(()=>__trench.app.net.switchWeapon('secondary'));
   await p.waitForFunction(()=>__trench.app.net.lastMe.w==='deagle'&&__trench.app.vm.weapon.id==='deagle');
   const before=await p.evaluate(()=>__trench.app.net.lastMe.mag);
   await p.evaluate(()=>__trench.app.net.send({t:'fire',d:[0,1,0]}));
   await p.waitForFunction(m=>__trench.app.net.lastMe.mag===m-1,before);
   // Record acknowledgements: a drawing-frame poll can miss the whole reload
   // while a heavy WebGL frame stalls, even though the authority completed it.
   await p.evaluate(()=>{
     const n=__trench.app.net;window.reloadAcks=[];window.savedOnMe=n.h.onMe;
     n.h.onMe=m=>{reloadAcks.push({reloading:m.reloading,mag:m.mag,reserve:m.reserve});savedOnMe?.(m);};
     n.reload();
   });
   try{
     await p.waitForFunction(()=>reloadAcks.some(m=>m.reloading),null,{polling:50,timeout:10000});
     await p.waitForFunction(m=>!__trench.app.net.lastMe.reloading&&__trench.app.net.lastMe.mag===m,before,{polling:50,timeout:10000});
   }catch(e){console.error('RELOAD ACKS',await p.evaluate(()=>({name:__trench.app.hud.el.name.value,me:__trench.app.net.lastMe,acks:reloadAcks,paused:__trench.app.paused,hostPaused:__trench.app.net.hostPaused})));throw e;}
   finally{await p.evaluate(()=>{__trench.app.net.h.onMe=savedOnMe;delete window.savedOnMe;delete window.reloadAcks;});}
 }
 console.log('PASS: both seats sidearm switch, real ammo decrement and reload acknowledgement');
 await guest.keyboard.press('Escape');await guest.click('#btn-pause-leave');
 await host.waitForFunction(()=>__trench.app.net.status().humans===1&&__trench.app.net.peers===0,null,{timeout:10000});
 console.log('PASS: real UI guest departure removes seat and peer');
 // A departed guest must be able to pair again without resetting the host.
 const hostLife=await host.evaluate(()=>__trench.app.net.lastMe.life);
 await host.keyboard.press('Escape');await host.click('#btn-pause-invite');
 await host.fill('#invite-code','');await host.click('#btn-invite-gen');
 await host.waitForFunction(()=>document.querySelector('#invite-code').value.startsWith('TFi1.'),null,{timeout:20000});
 const newInvite=await host.locator('#invite-code').inputValue();
 await guest.click('#btn-room-invite');await guest.fill('#invite-code',newInvite);await guest.click('#btn-invite-join');
 await guest.waitForFunction(()=>document.querySelector('#invite-code').value.startsWith('TFa1.'),null,{timeout:20000});
 await host.fill('#invite-code',await guest.locator('#invite-code').inputValue());await host.click('#btn-invite-accept');
 await host.waitForFunction(()=>__trench.app.net.peers===1,null,{timeout:25000});
 await host.click('#btn-invite-close');await guest.click('#btn-invite-close');
 await host.click('#btn-pause-resume');
 await guest.click('#btn-mode-multi');await guest.click('#btn-deploy');await playing(guest);
 await host.waitForFunction(()=>__trench.app.net.status().humans===2);
 assert.equal(await host.evaluate(()=>__trench.app.myId),ids.host);
 assert.equal(await host.evaluate(()=>__trench.app.net.lastMe.life),hostLife);
 await guest.evaluate(()=>__trench.app.net.chat('rejoined-rtc'));
 await host.waitForFunction(()=>document.querySelector('#chat-log').textContent.includes('rejoined-rtc'));
 console.log('PASS: departed guest re-pairs and rejoins via real menu, same host life/seat retained, RTC chat restored');

 await hc.close();await gc.close();
 }
 // Real RTC authority on every catalog map, without rendering-dependent shortcuts.
 for(const [index,map] of (process.env.MULTIPLAYER_MAP?[process.env.MULTIPLAYER_MAP]:['somme','italy','proc_city']).entries()){
   const a=await context(),b=await context(),h=await a.newPage(),g=await b.newPage();
   await h.goto(origin+'/__harness.html');await g.goto(origin+'/__harness.html');
   const room=String(70000000+index);
   for(const [p,role] of [[h,'host'],[g,'guest']])await p.evaluate(async({role,room})=>{
     const {RelayHostNet,RelayNet}=await import('/js/relay.js');window.events=[];window.welcomes=[];window.netErrors=[];
     window.net=new(role==='host'?RelayHostNet:RelayNet)({onMessage:m=>events.push(m),onWelcome:m=>welcomes.push(m),onError:e=>netErrors.push(e)},{code:room});
     await net.connect('',{code:room});
   },{role,room});
   const offer=await h.evaluate(()=>net.createInvite());
   const answer=await g.evaluate(async offer=>(await net.acceptInvite(offer)).answer,offer);
   await h.evaluate(answer=>net.acceptAnswer(answer),answer);
   await g.waitForFunction(()=>net.peers===1);
   await h.evaluate(()=>{window.requestAnimationFrame=()=>0;});
   // Guest deploys first, including a deliberately conflicting map request.
   await g.evaluate(room=>net.join('Early Guest','assault','mp18',true,15,'',false,'somme','guest-seat',room,'tdm','deagle'),room);
   await h.evaluate(map=>net.join('Map Host','assault','mp18',true,15,'',false,map,'host-seat','','control','g17'),map);
   try{await g.waitForFunction(()=>net.lastState?.ps?.length===2&&net.lastMe?.alive,null,{timeout:45000});}
   catch(e){for(const [name,p]of[['host',h],['guest',g]])console.error(map,name,await p.evaluate(()=>({id:net.id,connected:net.connected,peers:net.peers,status:net.status?.(),state:net.lastState,me:net.lastMe,errors:netErrors,welcomes})));throw e;}
   assert.equal(await h.evaluate(()=>net.status().map),map);
   assert.equal(await h.evaluate(()=>net.status().bots),0);
   assert.equal(await g.evaluate(()=>welcomes[0].mapId),map);
   assert.equal(await g.evaluate(()=>net.lastState.gameMode),'control');
   assert.equal(await g.evaluate(()=>net.lastMe.secondary),'deagle');
   await g.evaluate(()=>net.chat('rtc-map-check'));
   await h.waitForFunction(()=>events.some(m=>m.t==='chat'&&m.m==='rtc-map-check'),null,{polling:50,timeout:5000});
   await h.evaluate(()=>net._engine.py.runPython(`
_m=_relay.room.match
for _p in _m.players.values():
 _m.outbox.extend(_m._spawn(_p))
`));
   for(const p of [h,g])await p.waitForFunction(()=>net.lastMe.life===2&&net.lastMe.shieldMs>0,null,{polling:50});
   await g.evaluate(()=>{const row=net.lastState.ps.find(p=>p.i===net.id);net.input({x:row.p[0]+.08,y:row.p[1],z:row.p[2]},0,0,{move:true,ground:true});});
   await g.waitForFunction(()=>net.lastMe.shieldMs===0,null,{polling:50});
   assert(await h.evaluate(()=>net.lastMe.shieldMs>0),'An idle opponent keeps its own shield');
   const guestId=await g.evaluate(()=>net.id);
   await h.waitForFunction(id=>net.sample().get(id)?.shieldMs===0,guestId,{polling:50});
   for(const p of [h,g]){
     const count=await p.evaluate(()=>net.lastMe.mag);
     await p.evaluate(()=>net.send({t:'fire',d:[0,1,0]}));
     await p.waitForFunction(count=>net.lastMe.mag===count-1,count,{polling:50,timeout:5000});
   }
   for(const p of [h,g])await p.waitForFunction(()=>net.lastMe.shieldMs===0&&[...net.sample().values()].every(row=>row.shieldMs===0),null,{polling:50,timeout:10000});
   await h.evaluate(()=>net.close());
   await g.waitForFunction(()=>!net.connected&&netErrors.length>0,null,{timeout:5000});
   console.log(`PASS: ${map}: RTC early join, host map/control rules, zero multiplayer bots, private sidearm/ammo, bidirectional commands/chat, per-player movement/fire shield cancellation and host-close notification`);
   await a.close();await b.close();
 }

 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
