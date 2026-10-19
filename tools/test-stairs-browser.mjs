import assert from 'node:assert/strict';
export async function testStairs(context,origin){
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/__harness.html');
 const result=await page.evaluate(async()=>{
  const T=await import('/vendor/three.module.js'),{World}=await import('/js/map.js'),{Controls}=await import('/js/controls.js');
  const map=await(await fetch('/shared/maps/proc_city.json')).json(),data=await(await fetch('/shared/weapons.json')).json();
  const world=new World(new T.Scene(),map,data.combat),controls=new Controls(document.querySelector('canvas'),world,data.combat,{});controls.enabled=true;
  let traversals=0;
  for(const b of map.buildings)for(const r of b.ramps)for(const down of[false,true])for(const mode of['walk','sprint','crouch','jump','touch']){
   const p=down?r.end:r.start,q=down?r.start:r.end,dir=down?-1:1;
   controls.setMobileMode(mode==='touch');controls.keys.clear();controls.reset([p[0],p[1],p[2]-.7*dir],dir*90);if(mode==='touch')controls.touchMove.y=1;else controls.keys.add('KeyW');
   if(mode==='sprint')controls.keys.add('ShiftLeft');if(mode==='crouch')controls.keys.add('KeyC');
   let arrived=false;controls.inputNow=()=>clock;let clock=0;
   for(let i=0;i<160;i++){
    if(mode==='jump'&&i===16)controls.keys.add('Space');if(i===17)controls.keys.delete('Space');clock+=50;controls.update(.05,true,false);
    if(world.blocked(controls.pos.x,controls.pos.z,controls.pos.y,controls.bodyHeight))throw Error(`${b.id}/${down}/${mode}: head/body inside stair geometry`);
    if((controls.pos.z-q[2])*dir>=.5&&Math.abs(controls.pos.y-q[1])<.05){arrived=true;break;}
   }
   if(!arrived)throw Error(`${b.id}/${down}/${mode}: stairs stalled`);traversals++;
  }
  return{flights:map.buildings.reduce((n,b)=>n+b.ramps.length,0),traversals};
  });
 assert.equal(result.traversals,1630);assert.deepEqual(errors,[]);await page.close();console.log('PASS: real browser stair controls',result);return result;
}
