// Directly exercise the shipped browser collision code in Node. No npm, DOM or
// build step (Node 22.15+ for this test only); the temporary import hook supplies the browser's Three import map.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
const hook=registerHooks({resolve(specifier,context,next){
  if(specifier==='three')return {url:new URL('../public/vendor/three.module.js',import.meta.url).href,shortCircuit:true};
  return next(specifier,context);
}});
const [{World},T,{rayWorld,raySolid}]=await Promise.all([
  import('../public/js/map.js'),import('../public/vendor/three.module.js'),import('../public/js/ballistics.js')
]);
hook.deregister();
const map=JSON.parse(readFileSync(new URL('../public/shared/maps/proc_city.json',import.meta.url)));
const weapons=JSON.parse(readFileSync(new URL('../public/shared/weapons.json',import.meta.url)));
function validate(map){
const world=new World(new T.Scene(),map,weapons.combat);
const nodes=new Map(map.bot_nav.nodes.map(n=>[n.id,n.p]));
let samples=0,openingRays=0,wallRays=0;
for(const [a,b] of map.bot_nav.edges)for(const [from,to] of [[a,b],[b,a]]){
  const p=nodes.get(from),q=nodes.get(to),count=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[2]-p[2])/.1));
  let y=p[1];
  for(let k=1;k<=count;k++){
    const t=k/count,x=p[0]+(q[0]-p[0])*t,z=p[2]+(q[2]-p[2])*t;
    assert.equal(world.blocked(x,z,y),false,`${from}->${to} blocked at ${x},${y},${z}`);
    const next=world.floorAt(x,z,y);assert.ok(Math.abs(next-y)<=.65,`${from}->${to} step/drop`);y=next;samples++;
  }
  assert.ok(Math.abs(y-q[1])<1e-6,`${from}->${to} wrong floor`);
}
const normals={n:[0,-1],s:[0,1],w:[-1,0],e:[1,0]};
for(const b of map.buildings){
  const walls=world.solid.filter(w=>w.t==='wall'&&w.building===b.id);
  for(const o of b.openings){
    const [nx,nz]=normals[o.side],direction=new T.Vector3(-nx,0,-nz),axis=nx===0?'x':'z';
    for(const [u,v] of [[0,.5],[-.45,.1],[.45,.1],[-.45,.9],[.45,.9]]){
      const point=new T.Vector3(o.x+nx,o.y+o.height*v,o.z+nz);point[axis]+=u*o.width;
      for(const wall of walls)assert.equal(raySolid(point,direction,wall,1.3),null,`${b.id} ${o.kind} ${o.side} blocked by facade`);
      openingRays++;
    }
  }
}
const key=values=>values.map(v=>v.toFixed(8)).join(',');
const visualWalls=new Set(map.tiles.filter(t=>t.meshName.startsWith('wall_')).map(t=>key([t.x,t.y+t.scale[1]/2,t.z,...t.scale])));
for(const wall of world.solid.filter(w=>w.t==='wall')){
  assert.ok(visualWalls.has(key([wall.x,wall.y,wall.z,wall.w,wall.h,wall.d])),'Collider does not match a rendered wall piece');
  const axis=wall.w<wall.d?'x':'z',width=axis==='x'?wall.w:wall.d;
  for(const sign of [-1,1]){
    const origin=new T.Vector3(wall.x,wall.y,wall.z),direction=new T.Vector3();origin[axis]+=sign*(width/2+.25);direction[axis]=-sign;
    const hit=rayWorld(world,origin,direction,width+.5);assert.ok(hit!==null&&hit<=.250001,'Bullet crossed a solid wall');wallRays++;
  }
}
console.log(`PASS: seed ${map.seed}, shipped JS collision: ${samples} route samples, ${openingRays} aperture rays, ${wallRays} solid-wall rays; every wall visual matches its collider`);

}
validate(map);
const extraSeeds=Number(process.env.CITY_COLLISION_SEEDS||0);
assert.ok(Number.isSafeInteger(extraSeeds)&&extraSeeds>=0&&extraSeeds<=32);
if(extraSeeds){
  const {generateProcCity}=await import('../public/engine/proc_city.js');
  for(let seed=0;seed<extraSeeds;seed++)validate(generateProcCity(seed*1000003));
}
