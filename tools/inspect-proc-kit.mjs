// Dependency-free Node inspection: uses the project's own Three math, not npm.
// node tools/inspect-proc-kit.mjs [file.glb ...]
import * as T from '../public/vendor/three.module.js';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
const base='public/models/maps/';
const files=process.argv.slice(2);
if(!files.length){
  for(const f of (await readdir(base+'GLB format')).sort())if(f.endsWith('.glb'))files.push(base+'GLB format/'+f);
  files.push(base+'house.glb',base+'inter.glb');
}
const categories=['floor','ceiling','wall_solid','wall_doorway','wall_window','stairs','cover_low','cover_high','decorative'];
const groups=Object.fromEntries(categories.map(k=>[k,[]]));
const meshes=[];
function category(name,size){
  const n=name.toLowerCase();
  if(/ceiling|tavan/.test(n))return 'ceiling';
  if(/floor|wood_tile|tile009|zemin|road-|pavement/.test(n))return 'floor';
  if(/stair|steps|step0/.test(n))return 'stairs';
  if(/wall.*door|doorway|door_hole/.test(n))return 'wall_doorway';
  if(/wall.*window|window_hole/.test(n))return 'wall_window';
  if(/pillar|column/.test(n)&&size[1]>=2)return 'cover_high';
  if(/wall|duvar|door_hole|window_hole/.test(n))return 'wall_solid';
  if(/wardrobe|cabinet|shelf|closet|vitrin/.test(n)&&size[1]>=2)return 'cover_high';
  if(/table|radiator|crate|sandbag|barrier|dumpster|pallet|masa|sehpa|kalorifer/.test(n))return 'cover_low';
  return 'decorative';
}
for(const file of files){
 const buf=await readFile(file);
 if(buf.toString('ascii',0,4)!=='glTF')throw Error(`Not GLB: ${file}`);
 const json=JSON.parse(buf.toString('utf8',20,20+buf.readUInt32LE(12)).trim());
 const local=n=>n.matrix?new T.Matrix4().fromArray(n.matrix):new T.Matrix4().compose(new T.Vector3().fromArray(n.translation||[0,0,0]),new T.Quaternion().fromArray(n.rotation||[0,0,0,1]),new T.Vector3().fromArray(n.scale||[1,1,1]));
 const walk=(idx,parent)=>{
  const n=json.nodes[idx],world=parent.clone().multiply(local(n));
  if(n.mesh!==undefined){
   const mesh=json.meshes[n.mesh],box=new T.Box3();
   for(const p of mesh.primitives){const a=json.accessors[p.attributes.POSITION];if(!a.min||!a.max)throw Error(`${file}: POSITION bounds missing`);box.union(new T.Box3(new T.Vector3().fromArray(a.min),new T.Vector3().fromArray(a.max)).applyMatrix4(world));}
   const size=box.getSize(new T.Vector3()).toArray().map(v=>+v.toFixed(6));
   const name=n.name||mesh.name||`mesh_${n.mesh}`;
   const row={file:'/'+file.replace(/^public\//,''),node:idx,meshName:name,min:box.min.toArray(),max:box.max.toArray(),size,category:category(basename(file)+' '+name,size)};
   meshes.push(row);groups[row.category].push(meshes.length-1);
  }
  for(const c of n.children||[])walk(c,world);
 };
 for(const i of json.scenes[json.scene||0].nodes)walk(i,new T.Matrix4());
}
const result={version:1,note:'Actual scene-space Box3 bounds including node transforms. Categories are candidates; openings/colliders are authored separately, never whole-mesh AABBs across a doorway.',meshes,groups};
await writeFile('public/shared/proc-kit.json',JSON.stringify(result,null,2)+'\n');
console.log(`Inspected ${files.length} GLBs / ${meshes.length} meshes with vendored Three.Box3`);
for(const [k,v]of Object.entries(groups))console.log(k,v.length);
