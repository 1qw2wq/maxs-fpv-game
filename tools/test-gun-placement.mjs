// Pure data-contract tests: node tools/test-gun-placement.mjs (no dependencies).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {placement,exportPlacements,importPlacements} from '../public/js/third-person-placement.js';
const weapons=JSON.parse(readFileSync(new URL('../public/shared/weapons.json',import.meta.url))).weapons;
const values=Object.fromEntries(weapons.map((w,i)=>[w.id,{position:[.01,i/1000,-.02],rotation:[2,-3,4]}]));
const out=exportPlacements(values,weapons,{notes:'Gun positioning only'});
assert.deepEqual(importPlacements(JSON.stringify(out),weapons),values);
assert.equal(Object.keys(out.placements).length,weapons.length);
assert.equal(out.scope,'third-person-only');
const p=placement();p.position[0]=.2;assert.equal(placement().position[0],0);
const original=values[weapons[0].id],copy=placement(original);copy.rotation[0]=100;assert.equal(original.rotation[0],2);
for(const bad of [null,[],{position:[0,0],rotation:[0,0,0]},{position:[0,NaN,0],rotation:[0,0,0]},{position:[0,Infinity,0],rotation:[0,0,0]},{position:['0',0,0],rotation:[0,0,0]},{position:[.501,0,0],rotation:[0,0,0]},{position:[0,0,0],rotation:[181,0,0]}])assert.throws(()=>placement(bad));
for(const mutate of [x=>x.version=2,x=>x.scope='first-person',x=>x.frame='world',x=>x.units.rotation='radians',x=>x.placements.unknown=placement(),x=>x.placements[weapons[0].id].model='different-model',x=>x.placements[weapons[0].id].position=['bad',0,0]]){
 const invalid=structuredClone(out);mutate(invalid);assert.throws(()=>importPlacements(JSON.stringify(invalid),weapons));
}
assert.throws(()=>importPlacements('not json',weapons));assert.throws(()=>importPlacements(' '.repeat(200001),weapons));
assert.deepEqual(importPlacements(JSON.stringify(exportPlacements({},weapons)),weapons),{});
console.log(`PASS: ${weapons.length} per-gun round trips, strict schema/units/IDs/ranges/finite values, independent copies and empty records`);
