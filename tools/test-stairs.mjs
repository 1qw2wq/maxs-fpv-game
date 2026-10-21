// Exact shipped World/Controls, no browser or npm. Node >=22.15 for import hooks.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
const hook=registerHooks({resolve(s,c,n){return s==='three'?{url:new URL('../public/vendor/three.module.js',import.meta.url).href,shortCircuit:true}:n(s,c);}});
const [{World},{Controls},T]=await Promise.all([import('../public/js/map.js'),import('../public/js/controls.js'),import('../public/vendor/three.module.js')]);hook.deregister();
const map=JSON.parse(readFileSync(new URL('../public/shared/maps/proc_city.json',import.meta.url))),data=JSON.parse(readFileSync(new URL('../public/shared/weapons.json',import.meta.url)));
const world=new World(new T.Scene(),map,data.combat);
const parity=[];
for(const b of map.buildings)for(const r of b.ramps)for(const side of[-.7,0,.7])for(const down of[false,true]){
 const p=r.start,length=r.end[2]-p[2],point=t=>[p[0]+side,p[1]+t/length*3,p[2]+t];
 const old=point(down?3.3:.5),target=point(down?.5:3.3);
 const [x,z,y]=world.resolveMove(old[0],old[2],target[0],target[2],old[1],data.combat.playerHeight,{returnHeight:true});
 assert.ok(Math.hypot(x-target[0],z-target[2],y-target[1])<1e-8,`${b.id} delayed ${down?'down':'up'} stair packet stalled`);
 parity.push({old,target,result:[x,y,z],ceiling:world.ceilingAt(x,z,y)});
}
if(process.env.STAIR_PARITY_JSON){console.log(JSON.stringify(parity));}
else {
 // Event wiring is inert; no movement, collision or Three methods are mocked.
 const doc=globalThis.document,win=globalThis.window;
 globalThis.document={activeElement:null,addEventListener(){}};globalThis.window={addEventListener(){}};
 let count=0;
 try {
 const controls=new Controls({addEventListener(){}},world,data.combat,{});controls.enabled=true;
 for(const b of map.buildings)for(const r of b.ramps)for(const fps of[10,20,60,144])for(const offset of[-.7,0,.7,'diagonal'])for(const down of[false,true])for(const mode of['walk','sprint','crouch','jump']){
  const p=down?r.end:r.start,q=down?r.start:r.end,dir=down?-1:1;
  const x0=p[0]+(offset==='diagonal'?-.6:offset),x1=q[0]+(offset==='diagonal'?.6:offset),z0=p[2]-.7*dir,z1=q[2]+.7*dir;
  controls.keys.clear();controls.touchKeys.clear();controls.reset([x0,p[1],z0],Math.atan2(z1-z0,x1-x0)*180/Math.PI);
  controls.keys.add('KeyW');if(mode==='sprint')controls.keys.add('ShiftLeft');if(mode==='crouch')controls.keys.add('KeyC');
  let arrived=false;
  for(let i=0;i<fps*8;i++){
   if(mode==='jump'&&i===Math.floor(fps*.8))controls.keys.add('Space');if(i===Math.floor(fps*.8)+1)controls.keys.delete('Space');
   controls.update(1/fps,true,false);
   assert.equal(world.blocked(controls.pos.x,controls.pos.z,controls.pos.y,controls.bodyHeight),false,`${b.id}/${fps}/${offset}/${down}/${mode}: body intersects stair/ceiling`);
   if((controls.pos.z-q[2])*dir>=.5&&Math.abs(controls.pos.y-q[1])<.05){arrived=true;break;}
  }
  assert.ok(arrived,`${b.id}/${fps}/${offset}/${down}/${mode}: stuck ${controls.pos.toArray()}`);count++;
 }
 }finally{if(doc===undefined)delete globalThis.document;else globalThis.document=doc;if(win===undefined)delete globalThis.window;else globalThis.window=win;}
 console.log(`PASS: ${count} actual Controls stair traversals, all 163 flights, up/down, diagonal/edge lanes, walk/sprint/crouch/jump, 10/20/60/144Hz; ${parity.length} delayed packet sweeps`);
}
