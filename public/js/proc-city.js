// Instanced city visuals. All collision remains in the shared map JSON.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/loaders/GLTFLoader.js';
import {fixImportedMaterials} from './lighting.js';

function citySurface(kind) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d');c.fillStyle=kind==='street'?'#595c58':'#a29984';c.fillRect(0,0,512,512);
  if(kind==='street')for(let row=0;row<24;row++)for(let col=-1;col<24;col++){
    const shade=113+((row*73+col*37)&31);c.fillStyle=`rgb(${shade},${shade+2},${shade-3})`;
    c.fillRect(col*24+(row%2)*12+1,row*22+1,22,20);
  }
  else for(let i=0;i<5000;i++){const x=(i*73)%512,y=(i*157+Math.floor(i/512)*17)%512;c.fillStyle=i%2?'#a79d88':'#b1a58f';c.fillRect(x,y,2,2);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}

const KIT='/models/maps/GLB format/';
export const CITY_KIT={
  wall_solid:[KIT+'wall-a-flat.glb','wall-a-flat','box'],
  floor:['/models/maps/house.glb','Wood_Tile','box'],
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
      if(o.isMesh&&(g.parser.json.nodes[index]?.name===name||o.name===name))source=o;
    });
    if(!source)throw Error(`City kit mesh missing: ${url} / ${name}`);
    const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);
    geometry.computeBoundingBox();
    const bounds=geometry.boundingBox,size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x,-bounds.min.y,-center.z);
    geometry.scale(1/Math.max(size.x,.000001),1/Math.max(size.y,.000001),1/Math.max(size.z,.000001));
    let shape=geometry;
    // Structural solids use closed, unit boxes with the uploaded kit material.
    // This guarantees visible slab/wall thickness EXACTLY matches the AABBs,
    // including the ceiling undersides; furniture retains its real geometry.
    if(mode==='box'){
      const uv=geometry.attributes.uv;let u0=Infinity,v0=Infinity,u1=-Infinity,v1=-Infinity;
      for(let i=0;i<(uv?.count||0);i++){u0=Math.min(u0,uv.getX(i));u1=Math.max(u1,uv.getX(i));v0=Math.min(v0,uv.getY(i));v1=Math.max(v1,uv.getY(i));}
      geometry.dispose();shape=new THREE.BoxGeometry(1,1,1);shape.translate(0,.5,0);
      // Keep the floor/wood atlas crop instead of projecting the entire kit atlas.
      if(uv)for(let i=0;i<shape.attributes.uv.count;i++){
        const a=shape.attributes.uv;a.setXY(i,u0+a.getX(i)*(u1-u0),v0+a.getY(i)*(v1-v0));
      }
    }
    const materials=(Array.isArray(source.material)?source.material:[source.material]).map(m=>m.clone());
    for(const mat of materials){mat.side=THREE.DoubleSide;mat.shadowSide=THREE.DoubleSide;if(mode==='box'){mat.transparent=false;mat.opacity=1;mat.alphaTest=0;mat.depthWrite=true;}}
    const prototype=new THREE.Mesh(shape,Array.isArray(source.material)?materials:materials[0]);
    fixImportedMaterials(prototype,{lightUnlit:true,metalCap:.2});
    if(['wall_solid','street','courtyard'].includes(key)) {
      // Closed structural solids need their own continuous surface, not the
      // kit's facade atlas (which would paint fake windows across door jambs).
      for(const mat of Array.isArray(prototype.material)?prototype.material:[prototype.material])mat.dispose();
      const uv=shape.attributes.uv;
      for(let i=0;i<uv.count;i++)uv.setXY(i,i%4===0||i%4===1?0:1,i%2===0?1:0);
      prototype.material=new THREE.MeshStandardMaterial({color:key==='courtyard'?'#9a968a':'#ffffff',map:citySurface(key),roughness:.92,metalness:0,side:THREE.DoubleSide});
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
    instanced.name='city:'+name;instanced.castShadow=true;instanced.receiveShadow=true;
    tiles.forEach((t,i)=>{
      transform.position.set(t.x,t.y,t.z);transform.rotation.set(0,t.rotY,0);transform.scale.fromArray(t.scale);transform.updateMatrix();instanced.setMatrixAt(i,transform.matrix);
    });
    instanced.instanceMatrix.needsUpdate=true;instanced.computeBoundingBox();instanced.computeBoundingSphere();root.add(instanced);
  }
  root.userData.instances=mapData.tiles.length;root.userData.batches=buckets.size;
  scene.add(root);return root;
}
