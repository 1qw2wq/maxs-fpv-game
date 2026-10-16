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
 assert.ok(m.buildings.length>=2&&m.buildings.length<=4);
 for(const b of m.boxes)for(const k of ['x','y','z','w','h','d'])assert.ok(Number.isFinite(b[k]));
 for(const b of m.buildings){assert.equal(b.stories,2);assert.equal(b.storyHeight,3);assert.equal(b.doors.length,2);assert.notEqual(b.doors[0].side,b.doors[1].side);for(const d of b.doors){assert.ok(d.width>=1.2&&d.height>=2.1);}}
 assert.equal(m.boxes.filter(b=>b.t==='ramp').length,m.buildings.length);
 assert.equal(m.floor_holes.length,m.buildings.length);
}
assert.equal(variants.size,32);
console.log('PASS: 32 repeatable seeds, distinct layouts/cover, 2–4 two-story buildings, 1.8m flanking doors, single ramps, canonical shared JSON');
