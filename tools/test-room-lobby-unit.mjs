import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BOT_DIFFICULTIES,cleanBotSettings} from '../public/js/bot-settings.js';
const {RoomLobby}=await import(new URL('../public/js/room-lobby.js',import.meta.url));
const channels=[],lobbies=[];let dropped=0,starts=0,approved=0,left=0,closed='';
function channel(wire){const c={_wireId:wire,send(topic,text){const m=JSON.parse(text);if(m.cmd==='ready'&&dropped){dropped--;return;}for(const other of channels)if(other!==c)queueMicrotask(()=>other.lobby?.receive(text,wire));}};channels.push(c);return c;}
function create(role,id,callbacks={}){const l=new RoomLobby({role,id,code:'12345678',name:id,channel:channel(id+'-wire'),...callbacks});lobbies.push(l);return l;}
const settle=()=>new Promise(r=>setImmediate(r));
try{
 const config=JSON.parse(await readFile(new URL('../public/shared/bots.json',import.meta.url)));
 assert.deepEqual(BOT_DIFFICULTIES,['mixed',...Object.keys(config.skills)]);
 assert.deepEqual(cleanBotSettings({botCount:Infinity,botDifficulty:'bad'}),{botCount:0,botDifficulty:'mixed'});
 assert.equal(cleanBotSettings({botCount:999}).botCount,16);
 const h=create('host','Host',{onStart:()=>starts++,onLeave:()=>left++});
 const g=create('guest','Guest',{onApproved:()=>approved++,onStart:()=>starts++});await settle();
 assert.equal(h.pending.size,1);assert.equal(g.selfStatus,'pending');assert.equal(g.configure({map:'italy'}),false);
 assert.equal(h.allows(g.id,g.channel._wireId),false);assert.equal(g.start(),false);
 assert(h.approve(g.id));await settle();assert.equal(approved,1);assert.equal(g.selfStatus,'approved');assert.equal(h.start(),false);
 h.configure({map:'proc_city',gameMode:'control'});await settle();assert.deepEqual(g.config,{map:'proc_city',gameMode:'control',botCount:0,botDifficulty:'mixed'});
 dropped=1;g.ready(true,{cls:'medic',weapon:'m1907'});await settle();assert.equal(h.canStart,false);
 g.pulse();await settle();assert.equal(h.canStart,true);assert.equal(g.selfReady,true);assert.equal(g.readyIntent,undefined);
 const oldBotConfig=`${g.config.botCount}:${g.config.botDifficulty}`;
 h.configure({botCount:6,botDifficulty:'elite'});await settle();
 assert.equal(h.canStart,false);assert.equal(g.selfReady,false);assert.equal(g.config.botDifficulty,'elite');
 assert.equal(g.configure({botCount:0,botDifficulty:'recruit'}),false);
 h.receive(JSON.stringify({v:1,k:'lobby',room:h.code,cmd:'ready',id:g.id,ready:true,seq:g.readySeq+1,botConfig:oldBotConfig}),g.channel._wireId);
 assert.equal(h.canStart,false,'a delayed Ready for older bot settings cannot launch');
 g.ready(true);await settle();assert.equal(h.canStart,true);
 // Delayed old readiness must not undo a newer click, and pulse retries a lost acknowledgement.
 g.ready(false);g.ready(true,{cls:'scout'});await settle();
 h.receive(JSON.stringify({v:1,k:'lobby',room:h.code,cmd:'ready',id:g.id,ready:false,seq:g.readySeq-1}),g.channel._wireId);
 assert.equal(h.members.get(g.id).ready,true);
 g.receive('null',h.owner);g.receive('{broken',h.owner);h.receive('[]',g.channel._wireId);
 g.receive(JSON.stringify({v:1,k:'lobby',room:h.code,cmd:'state',owner:h.owner,epoch:h.epoch,rev:h.rev,members:[null],config:h.config,phase:'waiting'}),h.owner);
 assert.equal(g.selfStatus,'approved');
 const rev=g.lastRev;g.receive(JSON.stringify({v:1,k:'lobby',room:h.code,owner:h.owner,epoch:h.epoch,cmd:'state',rev:rev-1,phase:'started',config:h.config,members:[]}),h.owner);
 assert.equal(g.selfStatus,'approved');assert.equal(g.phase,'waiting');
 // Another guest cannot act as host or hijack an approved session id on a different wire.
 g.receive(JSON.stringify({v:1,k:'lobby',room:h.code,owner:'other-wire',cmd:'closed'}),'other-wire');assert.equal(g.closed,false);
 h.receive(JSON.stringify({v:1,k:'lobby',room:h.code,cmd:'leave',id:g.id}),'other-wire');assert.equal(h.members.size,1);
 const rejected=create('guest','Rejected',{onClosed:r=>closed=r});await settle();h.reject(rejected.id);await settle();assert.equal(closed,'denied');
 const pending=create('guest','Pending',{onClosed:r=>closed=r});await settle();assert.equal(h.pending.size,1);
 assert(h.start());await settle();assert.equal(closed,'started');assert.equal(pending.closed,true);assert.equal(starts,1);
 assert.equal(g.phase,'starting');assert.equal(g.launched,false);assert.equal(h.allows(g.id,g.channel._wireId),false);
 // Failed engine boot returns to the same waiting lobby without releasing guests.
 h.failed();await settle();assert.equal(h.phase,'waiting');assert.equal(g.phase,'waiting');assert(h.start());await settle();
 h.started();await settle();h.broadcast();await settle();assert.equal(starts,3);assert.equal(g.launched,true);assert.deepEqual(g.selection,{cls:'scout'});
 assert.equal(h.allows(g.id,g.channel._wireId),true);assert.equal(h.allows(g.id,'other-wire'),false);assert.equal(h.allows(g.id),false);
 assert.equal(h.configure({map:'italy'}),false);assert.equal(h.start(),false);
 g.close();await settle();assert.equal(left,1);assert.equal(h.members.size,0);
 const late=create('guest','Late',{onClosed:r=>closed=r});await settle();assert.equal(late.closed,true);assert.equal(closed,'started');
 h.close(false);
 const cryptoDescriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 let h2;try{Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}});h2=create('host','Host2');}
 finally{Object.defineProperty(globalThis,'crypto',cryptoDescriptor);}
 assert.equal(typeof h2.epoch,'string');
 const g2=create('guest','Guest2',{onClosed:r=>closed=r});await settle();h2.approve(g2.id);await settle();
 h2.members.get(g2.id).seen=Date.now()-31001;h2.pulse();await settle();assert.equal(g2.selfStatus,'pending');
 g2.pulse();await settle();assert.equal(h2.pending.size,1);h2.approve(g2.id);await settle();
 g2.lastHost=Date.now()-46000;g2.pulse();await settle();assert.equal(closed,'timeout');
 const g3=create('guest','Guest3',{onClosed:r=>closed=r});await settle();h2.close();await settle();assert.equal(g3.closed,true);assert.equal(closed,'closed');
 console.log('PASS: lobby approval, host-only config, retry/sequence, spoof/old-state rejection, readiness gate, load-before-release, failed-boot retry, exactly-once start, leave and late admission');
}finally{for(const l of lobbies)l.close(false);}
