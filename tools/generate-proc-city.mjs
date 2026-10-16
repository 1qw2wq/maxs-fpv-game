// Optional MAP AUTHORING tool, never a frontend/deployment build requirement.
// Both engines read the committed JSON directly. Regenerate it when changing
// the deployment's shared seed; never independently randomize a client match.
import {writeFileSync,readFileSync} from 'node:fs';
import {generateProcCity} from '../public/engine/proc_city.js';
const seed=process.argv[2]===undefined?1942:Number(process.argv[2]);
if(!Number.isSafeInteger(seed))throw Error('Pass an integer seed');
const path=new URL('../public/shared/maps/proc_city.json',import.meta.url);
const map=generateProcCity(seed);
writeFileSync(path,JSON.stringify(map,null,2)+'\n');
const registryPath=new URL('../public/shared/maps.json',import.meta.url);
const registry=JSON.parse(readFileSync(registryPath));
const meta=registry.maps.find(m=>m.id==='proc_city');
if(meta){meta.seed=map.seed;meta.desc=`种子 ${map.seed} · 双层楼房与交叉街道`;meta.descEn=`Seed ${map.seed} · enterable two-story urban blocks`;writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');}
console.log(`proc_city seed ${map.seed}: ${map.buildings.length} buildings, ${map.boxes.length} colliders, ${map.tiles.length} visual instances`);
