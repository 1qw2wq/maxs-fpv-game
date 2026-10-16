import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateProcCity} from '../public/engine/proc_city.js';
import {CITY_VEHICLES} from '../public/engine/vehicles.js';
const saved=JSON.parse(readFileSync(new URL('../public/shared/maps/proc_city.json',import.meta.url)));
assert.deepEqual(generateProcCity(1942),saved,'Shared artifact must be exactly reproducible');
assert.throws(()=>generateProcCity(NaN));assert.throws(()=>generateProcCity(1.2));
const variants=new Set();
for(let seed=0;seed<32;seed++){
 const m=generateProcCity(seed*1000003);
 assert.equal(JSON.stringify(m),JSON.stringify(generateProcCity(seed*1000003)));
 variants.add(JSON.stringify(m.tiles));
 assert.ok(m.buildings.length===132);
 for(const b of m.boxes)for(const k of ['x','y','z','w','h','d'])assert.ok(Number.isFinite(b[k]));
 for(const b of m.buildings){assert.ok(b.stories>=1&&b.stories<=4);assert.equal(b.storyHeight,3);assert.equal(b.doors.length,2);assert.notEqual(b.doors[0].side,b.doors[1].side);for(const d of b.doors){assert.ok(d.width>=1.2&&d.height>=2.1);}}
 assert.ok(m.coverRuns>=80);
 assert.ok(m.parkedVehicles>=12);
 assert.equal(Object.values(m.vehicleCounts).reduce((a,b)=>a+b,0),m.parkedVehicles);
 for(const key of Object.keys(CITY_VEHICLES))assert.ok(m.vehicleCounts[key]>0,`Missing vehicle ${key}`);
 assert.equal(m.vehicleCounts.car_f1,1,'High-poly landmark budget');
 assert.ok(m.vehicleCounts.car_crashed<=2);
 for(const tile of m.tiles.filter(t=>CITY_VEHICLES[t.meshName])){
  const b=m.boxes.find(b=>b.vehicle===tile.meshName&&b.x===tile.x&&b.z===tile.z);
  assert.ok(b);assert.deepEqual([b.w,b.h,b.d],tile.scale);
 }
 assert.ok(m.tiles.some(t=>t.meshName==='paint_yellow'));
 assert.equal(m.roadsX.length+m.roadsZ.length,5);
 assert.equal(m.connectedPairs,66);
 assert.ok(m.footprintCoverage>.54);
 assert.ok(m.connections.length>=66);
 assert.equal(new Set(m.buildings.map(b=>b.stories)).size,4);
 for(const road of m.roadsZ)assert.ok(m.tiles.some(t=>t.meshName==='asphalt'&&t.x===0&&t.z===road&&t.scale[0]===224&&t.scale[2]===6));
 for(const road of m.roadsX)assert.ok(m.tiles.some(t=>t.meshName==='asphalt'&&t.x===road&&t.z===0&&t.scale[0]===6&&t.scale[2]===224));
 for(const c of m.connections){const a=m.buildings.find(b=>b.id===c.a),b=m.buildings.find(b=>b.id===c.b);assert.ok(Math.abs(a.x+a.w/2-(b.x-b.w/2))<1e-6,'Attached wall has no gap');assert.ok(c.width>=1.2);}
 assert.equal(m.tiles.filter(t=>t.meshName==='awning').length,132);
 assert.equal(m.bounds.maxX-m.bounds.minX,240);
 assert.equal(new Set(m.buildings.map(b=>b.variant)).size,8);
 assert.ok(new Set(m.buildings.map(b=>b.w+','+b.d)).size>=12);
 assert.ok(m.tiles.some(t=>t.meshName==='tree_birch'));
 assert.equal(m.boxes.filter(b=>b.t==='ramp').length,m.buildings.reduce((n,b)=>n+b.stories-1,0));
 assert.equal(m.floor_holes.length,m.buildings.reduce((n,b)=>n+b.stories-1,0));
}
assert.equal(variants.size,32);
console.log('PASS: 32 repeatable seeds, distinct layouts/cover, 132 attached buildings, 1–4 floors, eight interiors, five roads, ≥1.2m flanking doors, one smooth collider per flight, seven vehicle variants with matching collision and high-poly limits, canonical shared JSON');
