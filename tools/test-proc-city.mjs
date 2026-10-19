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
 assert.ok(m.buildings.length===128);
 for(const b of m.boxes)for(const k of ['x','y','z','w','h','d'])assert.ok(Number.isFinite(b[k]));
 for(const b of m.boxes)assert.ok(b.w>0&&b.h>0&&b.d>0,'No degenerate jambs');
 for(const b of m.buildings){assert.ok(b.stories>=1&&b.stories<=4);assert.equal(b.storyHeight,3);assert.equal(b.doors.length,2);assert.notEqual(b.doors[0].side,b.doors[1].side);for(const d of b.doors){assert.ok(d.width>=1.2&&d.height>=2.1);}}
 const openings=m.buildings.flatMap(b=>b.openings);
 assert.equal(new Set(m.buildings.map(b=>b.facadeStyle)).size,6,'Six facade rhythms');
 assert.equal(openings.filter(o=>o.kind==='door').length,256,'Two escape doors per building');
 const windows=openings.filter(o=>o.kind==='window');
 const oldWindowCount=m.buildings.length*4+m.buildings.reduce((sum,b)=>sum+(b.stories-1)*9,0);
 assert.ok(windows.length<oldWindowCount*.6,'At least 40% fewer exterior window apertures');
 const doorOffsets=new Set(),windowShapes=new Set(),rhythms=new Set();
 for(const b of m.buildings){
  assert.ok(b.openings.every(o=>o.side!==b.attachedSide),'No phantom party-wall windows');
  for(const o of b.openings){
   assert.ok(o.width>0&&o.height>0);
   assert.ok(o.floor>=0&&o.floor<b.stories);
   if(o.kind==='window')windowShapes.add([o.width/(o.side==='n'||o.side==='s'?b.scale[0]:b.scale[1]),o.height,o.y-o.floor*3].map(v=>v.toFixed(3)).join(','));
  }
  rhythms.add(JSON.stringify(b.openings.map(o=>[o.side,o.floor,o.bay,o.kind])));
  for(const d of b.doors)doorOffsets.add(((d.x-b.x)/b.scale[0]).toFixed(2));
  for(const side of ['n','s'])assert.equal(b.openings.filter(o=>o.floor===0&&o.side===side&&o.kind==='window').length,1,'Ground front/rear are not perforated grids');
 }
 assert.ok(doorOffsets.size>=5,'Left and middle doorway positions vary');
 assert.ok(windowShapes.size>=12,'Window widths, sills and heights vary');
 const upperNorth=new Set(m.buildings.flatMap(b=>Array.from({length:b.stories-1},(_,i)=>b.openings.filter(o=>o.side==='n'&&o.floor===i+1).map(o=>o.bay).join(','))));
 assert.ok(upperNorth.size>=3,'Upper front windows do not always repeat the left column');
 assert.ok(rhythms.size>=35,'Do not reuse one facade mask throughout the city');
 assert.ok(new Set(m.connections.map(c=>c.height)).size===3,'Party-wall lintel heights vary');
 assert.ok(new Set(m.connections.map(c=>c.width.toFixed(3))).size>=9);
 assert.ok(m.coverRuns>=80);
 assert.ok(m.parkedVehicles===8);
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
 assert.equal(m.connectedPairs,64);
 assert.ok(m.footprintCoverage>.53);
 assert.ok(m.connections.length>=64);
 assert.equal(new Set(m.buildings.map(b=>b.stories)).size,4);
 for(const road of m.roadsZ)assert.ok(m.tiles.some(t=>t.meshName==='asphalt'&&t.x===0&&t.z===road&&t.scale[0]===224&&t.scale[2]===6));
 for(const road of m.roadsX)assert.ok(m.tiles.some(t=>t.meshName==='asphalt'&&t.x===road&&t.scale[0]===6));
 assert.equal(m.recommendedBots,15);assert.deepEqual([m.park.x,m.park.z],[0,0]);assert.ok(m.park.trees>=10);
 assert.ok(!m.buildings.some(b=>Math.abs(b.x)<36&&Math.abs(b.z)<9));
 assert.equal(m.tiles.filter(t=>t.meshName==='park_path').length,2);
 assert.equal(m.boxes.filter(b=>b.park&&b.t==='tree').length,m.park.trees);
 for(const c of m.connections){const a=m.buildings.find(b=>b.id===c.a),b=m.buildings.find(b=>b.id===c.b);assert.ok(Math.abs(a.x+a.w/2-(b.x-b.w/2))<1e-6,'Attached wall has no gap');assert.ok(c.width>=1.2);}
 assert.equal(m.tiles.filter(t=>t.meshName==='awning').length,128);
 assert.equal(m.bounds.maxX-m.bounds.minX,240);
 assert.equal(new Set(m.buildings.map(b=>b.variant)).size,8);
 assert.ok(new Set(m.buildings.map(b=>b.w+','+b.d)).size>=12);
 assert.ok(m.tiles.some(t=>t.meshName==='tree_birch'));
 assert.equal(m.boxes.filter(b=>b.t==='ramp').length,m.buildings.reduce((n,b)=>n+b.stories-1,0));
 assert.equal(m.floor_holes.length,m.buildings.reduce((n,b)=>n+b.stories-1,0));
}
assert.equal(variants.size,32);
console.log('PASS: 32 repeatable seeds, distinct layouts/cover, 128 attached buildings and a central park, 1–4 floors, eight interiors, six less-perforated facade styles, offset doors/windows, varied party portals, five roads, ≥1.2m flanking doors, one smooth collider per flight, eight vehicles in seven variants with matching collision and high-poly limits, canonical shared JSON');
