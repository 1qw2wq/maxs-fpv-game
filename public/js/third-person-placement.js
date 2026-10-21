// Tool/runtime contract: offsets relative to the shipping third-person mount.
// No storage or first-person dependencies. Import is data, never executable JS.
export const PLACEMENT_SCHEMA='trench-front/third-person-gun-placement';
export const PLACEMENT_FRAME='animated-chest-translation; trigger-pivot-local-XYZ-rotation';
export function placement(value={position:[0,0,0],rotation:[0,0,0]}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Placement must be an object');
  const result={};
  for(const [key,limit]of [['position',.5],['rotation',180]]){
    if(!Array.isArray(value[key])||value[key].length!==3||value[key].some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>limit))throw Error(`${key}: expected three finite numbers within ±${limit}`);
    result[key]=value[key].map(n=>Math.round(n*1e6)/1e6);
  }
  return result;
}
export function exportPlacements(values,weapons,context={}){
  const known=new Map(weapons.map(w=>[w.id,w]));const entries={};
  for(const id of Object.keys(values).sort()){
    if(!known.has(id))throw Error(`Unknown gun: ${id}`);
    const w=known.get(id);entries[id]={...placement(values[id]),name:w.nameEn||w.name,model:w.model||null};
  }
  return {schema:PLACEMENT_SCHEMA,version:1,frame:PLACEMENT_FRAME,units:{position:'metres-at-avatar-scale-1',rotation:'degrees'},scope:'third-person-only',context,placements:entries};
}
export function importPlacements(text,weapons){
  if(typeof text!=='string'||text.length>200000)throw Error('JSON must be text under 200 KB');
  const data=JSON.parse(text);
  if(data?.schema!==PLACEMENT_SCHEMA||data.version!==1||data.frame!==PLACEMENT_FRAME||data.scope!=='third-person-only'||data.units?.position!=='metres-at-avatar-scale-1'||data.units?.rotation!=='degrees')throw Error('Unsupported format, units or coordinate frame');
  if(!data.placements||typeof data.placements!=='object'||Array.isArray(data.placements))throw Error('Missing placements');
  const known=new Map(weapons.map(w=>[w.id,w])),result={};
  for(const [id,value]of Object.entries(data.placements)){
    if(!known.has(id))throw Error(`Unknown gun: ${id}`);
    if(value?.model!==undefined&&value.model!==(known.get(id).model||null))throw Error(`Gun model changed: ${id}`);
    result[id]=placement(value);
  }
  return result;
}
