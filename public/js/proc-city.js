// Instanced city visuals. All collision remains in the shared map JSON.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/loaders/GLTFLoader.js';
import {mergeGeometries} from '../vendor/utils/BufferGeometryUtils.js';
import {fixImportedMaterials} from './lighting.js';

function citySurface(kind) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d');
  const base=({paint_white:'#e5e5cc',paint_yellow:'#e8bf53',curb:'#b1b2a8',street:'#595c58',asphalt:'#444b50',pavement:'#a4a59e',grass:'#617c46',planter:'#617c46',dirt:'#92775b'})[kind]||'#b2a58f';
  c.fillStyle=base;c.fillRect(0,0,512,512);
  if(kind==='street')for(let row=0;row<24;row++)for(let col=-1;col<24;col++){
    const shade=113+((row*73+col*37)&31);c.fillStyle=`rgb(${shade},${shade+2},${shade-3})`;
    c.fillRect(col*24+(row%2)*12+1,row*22+1,22,20);
  }
  else {
    // Deterministic grain, no camera-dependent texture crawl.
    for(let i=0;i<9000;i++){
      const x=(i*73)%512,y=(i*157+Math.floor(i/512)*17)%512;
      c.fillStyle=i%2?'#ffffff12':'#00000016';c.fillRect(x,y,kind==='dirt'?3:2,2);
    }
    if(kind==='grass'||kind==='planter')for(let i=0;i<1600;i++){
      const x=(i*71)%512,y=(i*131)%512;c.strokeStyle=i%2?'#a3b76e55':'#354e3455';c.beginPath();c.moveTo(x,y);c.lineTo(x+2,y-4);c.stroke();
    }
    if(kind==='pavement'){
      c.strokeStyle='#72766e';c.lineWidth=2;
      for(let n=0;n<=512;n+=128){c.beginPath();c.moveTo(n,0);c.lineTo(n,512);c.stroke();c.beginPath();c.moveTo(0,n);c.lineTo(512,n);c.stroke();}
    }
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}

const KIT='/models/maps/GLB format/';
export const CITY_KIT={
  awning:[KIT+'detail-awning-wide.glb','detail-awning-wide'],
  parked_truck:[KIT+'truck-grey.glb','truck-grey'],
  curb:[KIT+'road-asphalt-pavement.glb','road-asphalt-pavement','box'],
  paint_white:[KIT+'road-asphalt-center.glb','road-asphalt-center','box'],
  paint_yellow:[KIT+'road-asphalt-center.glb','road-asphalt-center','box'],
  truck:[KIT+'truck-green.glb','truck-green'],
  planter:[KIT+'grass.glb','grass','box'],
  wall_brick:[KIT+'wall-b-flat.glb','wall-b-flat','box'],
  wall_stone:[KIT+'wall-c-flat.glb','wall-c-flat','box'],
  wall_ochre:[KIT+'wall-a-flat-painted.glb','wall-a-flat-painted','box'],
  asphalt:[KIT+'road-asphalt-center.glb','road-asphalt-center','box'],
  pavement:[KIT+'road-asphalt-pavement.glb','road-asphalt-pavement','box'],
  dirt:[KIT+'road-dirt-center.glb','road-dirt-center','box'],
  grass:[KIT+'grass.glb','grass','box'],
  bench:[KIT+'detail-bench.glb','detail-bench'],
  dumpster:[KIT+'detail-dumpster-closed.glb','detail-dumpster-closed'],
  pallet:[KIT+'pallet.glb','pallet'],
  rubble:[KIT+'detail-bricks-type-a.glb','detail-bricks-type-a'],
  lamp:[KIT+'detail-light-single.glb','detail-light-single'],
  tree_park:[KIT+'tree-park-large.glb','tree-park-large'],
  tree_small:[KIT+'tree-small.glb','tree-small'],
  bush_kit:[KIT+'tree-shrub.glb','tree-shrub'],
  coffee:['/models/maps/inter.glb','SM_Orta_Sehpa_P1'],
  sofa:['/models/maps/inter.glb','SM_Koltuk_P1'],
  cabinet_wide:['/models/maps/inter.glb','SM_Vitrin_Uzun_P1'],
  painting_a:['/models/maps/inter.glb','SM_Tablo_1_P1'],
  painting_b:['/models/maps/inter.glb','SM_Tablo_3_P1'],
  wall_lamp:['/models/maps/inter.glb','SM_Aplik.004'],
  flowers:['/models/maps/inter.glb','SM_Ciceklik.001'],
  ceiling_trim:['/models/maps/inter.glb','SM_Tavan_Deseni_P1'],
  tree_oak:['/models/maps/vege/veg.glb','CommonTree_1'],
  tree_pine:['/models/maps/vege/veg.glb','PineTree_1'],
  tree_birch:['/models/maps/vege/veg.glb','BirchTree_2'],
  tree_autumn:['/models/maps/vege/veg.glb','CommonTree_Autumn_3'],
  tree_dead:['/models/maps/vege/veg.glb','BirchTree_Dead_3'],
  shrub:['/models/maps/vege/veg.glb','Bush_1'],
  berries:['/models/maps/vege/veg.glb','BushBerries_1'],
  fern:['/models/maps/vege/veg.glb','Plant_1'],
  flowers_patch:['/models/maps/vege/veg.glb','Flowers'],
  wall_solid:[KIT+'wall-a-flat.glb','wall-a-flat','box'],
  floor:['/models/maps/house.glb','Wood_Tile','box'],
  stair_slab:['/models/maps/house.glb','Wood_Tile','stairSlab'],
  courtyard:[KIT+'road-dirt-center.glb','road-dirt-center','box'],
  street:[KIT+'road-dirt-tile.glb','road-dirt-tile','box'],
  table:['/models/maps/inter.glb','M_Masa_P1'],
  cabinet:['/models/maps/inter.glb','SM_Vitrin_P1'],
  radiator:['/models/maps/inter.glb','SM_Kalorifer.001'],
  rug:['/models/maps/inter.glb','SM_Hali_P1'],
  chandelier:['/models/maps/inter.glb','SM_Avize'],
  stair_tread:['/models/maps/house.glb','step069'],
  rail:['/models/maps/house.glb','wood','box'],
  barrier:[KIT+'detail-barrier-strong-type-a.glb','detail-barrier-strong-type-a'],
};

/** Extract one normalized prototype per selected asset; never include kit staging transforms. */
export async function extractCityKit() {
  const files=new Map(),loader=new GLTFLoader(),out=new Map();
  for(const [key,[url,name,mode]]of Object.entries(CITY_KIT)){
    if(!files.has(url))files.set(url,loader.loadAsync(url));
  }
  await Promise.all(files.values());
  for(const [key,[url,name,mode]]of Object.entries(CITY_KIT)){
    const g=await files.get(url);g.scene.updateMatrixWorld(true);
    let source;g.scene.traverse(o=>{
      const index=g.parser.associations.get(o)?.nodes;
      if(g.parser.json.nodes[index]?.name===name||o.name===name)source=o;
    });
    if(!source)throw Error(`City kit mesh missing: ${url} / ${name}`);
    const parts=[];source.traverse(o=>{if(o.isMesh)parts.push(o);});
    if(!parts.length)throw Error(`Empty city asset: ${name}`);
    const geometries=parts.map(o=>o.geometry.clone().applyMatrix4(o.matrixWorld));
    const materials=[],groups=[];let offset=0;
    parts.forEach((o,i)=>{
      const list=Array.isArray(o.material)?o.material:[o.material],base=materials.length;
      materials.push(...list.map(m=>m.clone()));
      const geo=geometries[i],count=geo.index?.count||geo.attributes.position.count;
      for(const group of geo.groups.length?geo.groups:[{start:0,count,materialIndex:0}])groups.push({start:offset+group.start,count:group.count,materialIndex:base+group.materialIndex});
      offset+=count;
    });
    const geometry=geometries.length===1?geometries[0]:mergeGeometries(geometries,false);
    if(!geometry)throw Error(`Incompatible city geometry: ${name}`);
    if(geometries.length>1)for(const geo of geometries)geo.dispose();
    geometry.clearGroups();for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);
    geometry.computeBoundingBox();
    const bounds=geometry.boundingBox,size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x,-bounds.min.y,-center.z);
    geometry.scale(1/Math.max(size.x,.000001),1/Math.max(size.y,.000001),1/Math.max(size.z,.000001));
    let shape=geometry;
    // Structural solids use closed, unit boxes with the uploaded kit material.
    // This guarantees visible slab/wall thickness EXACTLY matches the AABBs,
    // including the ceiling undersides; furniture retains its real geometry.
    if(mode==='box'||mode==='stairSlab'){
      const uv=geometry.attributes.uv;let u0=Infinity,v0=Infinity,u1=-Infinity,v1=-Infinity;
      for(let i=0;i<(uv?.count||0);i++){u0=Math.min(u0,uv.getX(i));u1=Math.max(u1,uv.getX(i));v0=Math.min(v0,uv.getY(i));v1=Math.max(v1,uv.getY(i));}
      geometry.dispose();shape=new THREE.BoxGeometry(1,1,1);shape.translate(0,.5,0);
      // Keep the floor/wood atlas crop instead of projecting the entire kit atlas.
      if(uv)for(let i=0;i<shape.attributes.uv.count;i++){
        const a=shape.attributes.uv;a.setXY(i,u0+a.getX(i)*(u1-u0),v0+a.getY(i)*(v1-v0));
      }
    }
    if(mode==='stairSlab'){
      const p=shape.attributes.position;
      for(let i=0;i<p.count;i++)p.setY(i,p.getZ(i)+.5+(p.getY(i)-1)*(.22/3));
      shape.computeVertexNormals();
    }
    if(mode==='box'||mode==='stairSlab')for(const mat of materials.splice(1))mat.dispose();
    for(const mat of materials){mat.side=THREE.DoubleSide;mat.shadowSide=THREE.DoubleSide;if(mode==='box'||mode==='stairSlab'){mat.transparent=false;mat.opacity=1;mat.alphaTest=0;mat.depthWrite=true;}}
    const prototype=new THREE.Mesh(shape,materials.length>1?materials:materials[0]);
    fixImportedMaterials(prototype,{lightUnlit:true,metalCap:.2});
    if(['wall_solid','wall_brick','wall_stone','wall_ochre','street','courtyard','asphalt','pavement','grass','planter','dirt','curb','paint_white','paint_yellow'].includes(key)) {
      // Closed structural solids need their own continuous surface, not the
      // kit's facade atlas (which would paint fake windows across door jambs).
      for(const mat of Array.isArray(prototype.material)?prototype.material:[prototype.material])mat.dispose();
      const uv=shape.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setXY(i,i%4===0||i%4===1?0:1,i%2===0?1:0);
      prototype.material=new THREE.MeshStandardMaterial({color:({courtyard:'#9a968a',wall_brick:'#b67b64',wall_stone:'#8a949b',wall_ochre:'#d2b777'})[key]||'#ffffff',map:citySurface(key),roughness:.92,metalness:0,side:THREE.DoubleSide});
      // Thin ground boxes must NOT draw their back/bottom faces: depth
      // quantization otherwise produces light/dark camouflage at city scale.
      // Offset the layered ground/decal passes, not the opaque building shells.
      const layer=({courtyard:4,grass:2,dirt:2,street:2,pavement:1,asphalt:0,paint_white:-1,paint_yellow:-1})[key];
      if(layer!==undefined){
        prototype.material.side=THREE.FrontSide;
        prototype.material.polygonOffset=true;
        prototype.material.polygonOffsetFactor=layer;
        prototype.material.polygonOffsetUnits=layer;
      }
    }
    out.set(key,prototype);
  }
  return out;
}

export function buildProcCity(scene,mapData,extractedKit) {
  const root=new THREE.Group();root.name='proc-city';
  const buckets=new Map();
  for(const tile of mapData.tiles){if(!buckets.has(tile.meshName))buckets.set(tile.meshName,[]);buckets.get(tile.meshName).push(tile);}
  const transform=new THREE.Object3D();
  for(const [name,tiles]of buckets){
    const source=extractedKit.get(name);
    if(!source)throw Error(`Unknown city tile: ${name}`);
    const instanced=new THREE.InstancedMesh(source.geometry,source.material,tiles.length);
    instanced.name='city:'+name;instanced.castShadow=!name.startsWith('paint_');instanced.receiveShadow=true;
    tiles.forEach((t,i)=>{
      transform.position.set(t.x,t.y,t.z);transform.rotation.set(0,t.rotY,0);transform.scale.fromArray(t.scale);transform.updateMatrix();instanced.setMatrixAt(i,transform.matrix);
    });
    instanced.instanceMatrix.needsUpdate=true;instanced.computeBoundingBox();instanced.computeBoundingSphere();root.add(instanced);
  }
  root.userData.instances=mapData.tiles.length;root.userData.batches=buckets.size;
  scene.add(root);return root;
}
