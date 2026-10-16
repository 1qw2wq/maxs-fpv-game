import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateProcCity} from '../public/engine/proc_city.js';
const saved=JSON.parse(readFileSync(new URL('../public/shared/maps/proc_city.json',import.meta.url)));
assert.deepEqual(generateProcCity(1942),saved,'Shared artifact must be exactly reproducible');
assert.throws(()=>generateProcCity(NaN));assert.throws(()=>generateProcCity(1.2));
const variants=new Set();
for(let seed=0;seed<32;seed++){
 const m=generateProcCity(seed*1000003);
 assert.equal(JSON.stringify(m),JSON.stringify(generateProcCity(seed*1000003)));
 variants.add(JSON.stringify(m.tiles));
 assert.ok(m.buildings.length===64);
 for(const b of m.boxes)for(const k of ['x','y','z','w','h','d'])assert.ok(Number.isFinite(b[k]));
 for(const b of m.buildings){assert.ok(b.stories===1||b.stories===2);assert.equal(b.storyHeight,3);assert.equal(b.doors.length,2);assert.notEqual(b.doors[0].side,b.doors[1].side);for(const d of b.doors){assert.ok(d.width>=1.2&&d.height>=2.1);}}
 assert.ok(m.coverRuns>=80);
 assert.ok(m.parkedVehicles>=12);
 assert.ok(m.tiles.some(t=>t.meshName==='paint_yellow'));
 assert.equal(m.roads.length,9);
 for(const road of m.roads){
  assert.ok(m.tiles.some(t=>t.meshName==='asphalt'&&t.x===0&&t.z===road&&t.scale[0]===224&&t.scale[2]===6),'Continuous horizontal road');
  assert.ok(m.tiles.some(t=>t.meshName==='asphalt'&&t.x===road&&t.z===0&&t.scale[0]===6&&t.scale[2]===224),'Continuous vertical road');
 }
 assert.equal(m.boxes.filter(b=>b.t==='curb').length,288);
 assert.equal(m.tiles.filter(t=>t.meshName==='awning').length,64);
 assert.equal(m.bounds.maxX-m.bounds.minX,240);
 assert.equal(new Set(m.buildings.map(b=>b.variant)).size,4);
 assert.ok(new Set(m.buildings.map(b=>b.w+','+b.d)).size>=12);
 assert.ok(m.tiles.some(t=>t.meshName==='tree_birch'));
 assert.equal(m.boxes.filter(b=>b.t==='ramp').length,m.buildings.filter(b=>b.stories>1).length);
 assert.equal(m.floor_holes.length,m.buildings.filter(b=>b.stories>1).length);
}
assert.equal(variants.size,32);
console.log('PASS: 32 repeatable seeds, distinct layouts/cover, 64 mixed-height/footprint/interior buildings, ≥1.2m flanking doors, single ramps, canonical shared JSON');
