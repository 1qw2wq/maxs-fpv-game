// Rigid throwable art only. Collision, fuse and landing positions stay host-owned.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { fixImportedMaterials } from './lighting.js';
import { sampleThrow } from './throwing.js';

export const GRENADE_MODELS = Object.freeze({
  frag: {file:'granade_m26.glb', band:0xc2b878},
  incendiary: {file:'hand_granade.glb', band:0xe06b30},
  smoke: {file:'smoke_granade.glb', band:0xaeb8b9},
  flash: {file:'flashbang_grenade.glb', band:0xe4dfca},
  gas: {file:'gas_grenade.glb', band:0xd6c54a},
});
const loader=new GLTFLoader(), files=new Map(), variants=new Map(), fallbacks=new Map();
const radius=.0825; // All art fits INSIDE the unchanged .09 m collision sphere.

function fit(root) {
  root.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(root), size=box.getSize(new THREE.Vector3());
  if(!Number.isFinite(size.length()) || size.length()<1e-8)throw Error('Empty grenade model');
  if(size.z>size.y*1.1 && size.z>size.x)root.rotation.x+=Math.PI/2;
  else if(size.x>size.y*1.1)root.rotation.z+=Math.PI/2;
  root.updateMatrixWorld(true);box.setFromObject(root);
  const sphere=box.getBoundingSphere(new THREE.Sphere());
  const mount=new THREE.Group();mount.add(root);
  root.position.sub(sphere.center);
  mount.scale.setScalar(radius/sphere.radius);
  mount.updateMatrixWorld(true);
  return mount;
}
function fallback(kind) {
  if(fallbacks.has(kind))return fallbacks.get(kind);
  const root=new THREE.Group(), color=GRENADE_MODELS[kind]?.band??0xa43f2c;
  const body=new THREE.MeshStandardMaterial({color:kind==='frag'?0x4b5231:kind==='flare'?0x8f3226:0x62665a,roughness:.72,metalness:.3});
  const metal=new THREE.MeshStandardMaterial({color:0x454945,roughness:.4,metalness:.7});
  const add=(geo,mat,y)=>{const m=new THREE.Mesh(geo,mat);m.position.y=y;root.add(m);return m;};
  if(kind==='flare'){
    add(new THREE.CylinderGeometry(.012,.013,.12,10),body,0);
    add(new THREE.CylinderGeometry(.013,.013,.009,10),metal,.063);
    add(new THREE.CylinderGeometry(.014,.014,.008,10),metal,-.063);
    add(new THREE.CylinderGeometry(.0135,.0135,.012,10),new THREE.MeshStandardMaterial({color:0xe1b887,roughness:.7}),-.035);
    const model=fit(root);fallbacks.set(kind,model);return model;
  }
  add(new THREE.CylinderGeometry(.032,.035,.085,12),body,0);
  add(new THREE.CylinderGeometry(.025,.03,.022,12),metal,.052);
  add(new THREE.BoxGeometry(.014,.012,.064),metal,.069).rotation.x=.25;
  const ring=add(new THREE.TorusGeometry(.018,.003,5,12),metal,.052);ring.position.x=.03;
  add(new THREE.CylinderGeometry(.0355,.0355,.012,12),new THREE.MeshStandardMaterial({color,roughness:.7}),-.01);
  const model=fit(root);fallbacks.set(kind,model);return model;
}
function loadFile(file) {
  if(!files.has(file))files.set(file,loader.loadAsync('models/guns/'+file).then(gltf=>{
    const root=gltf.scene;
    if(file==='gas_grenade.glb') {
      // The upload is a showcase of TWO complete canisters (upright + lying).
      // Throw just the upright body, not both models and the space between them.
      root.updateMatrixWorld(true);
      const bodies=[];root.traverse(o=>{if(o.isMesh)bodies.push(o);});
      if(bodies.length===2) {
        const height=o=>new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y;
        const keep=height(bodies[0])>=height(bodies[1])?bodies[0]:bodies[1];
        for(const body of bodies)if(body!==keep)body.removeFromParent();
      }
    }
    // Toon upload includes expanded black backface shells: omit those outlines,
    // not the actual detailed body, to match the game's lit/PBR presentation.
    root.traverse(o=>{if(o.isMesh){
      const mats=Array.isArray(o.material)?o.material:[o.material];
      if(file==='toon_granade.glb' && mats.every(m=>m.name==='Material.001'))o.visible=false;
      o.castShadow=false;o.receiveShadow=true;
    }});
    fixImportedMaterials(root);
    return fit(root);
  }).catch(error=>{files.delete(file);throw error;}));
  return files.get(file);
}
export function loadGrenadeModel(kind) {
  const spec=GRENADE_MODELS[kind];
  if(!spec)return Promise.resolve(fallback(kind));
  if(!variants.has(kind))variants.set(kind,loadFile(spec.file).then(template=>{
    const model=template.clone(true);
    // One small identification collar; preserve uploaded textures and metal.
    model.updateMatrixWorld(true);
    let beltRadius=.02;const vertex=new THREE.Vector3();
    model.traverse(o=>{if(!o.isMesh||!o.visible)return;const p=o.geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        vertex.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);
        if(Math.abs(vertex.y+.01)<.01)beltRadius=Math.max(beltRadius,Math.hypot(vertex.x,vertex.z));
      }
    });
    const band=new THREE.Mesh(new THREE.CylinderGeometry(Math.min(.055,beltRadius+.0006),Math.min(.055,beltRadius+.0006),.005,20),
      new THREE.MeshStandardMaterial({color:spec.band,roughness:.68,metalness:.15}));
    band.position.y=-.01;
    const result=new THREE.Group();result.add(model,band);return fit(result);
  }).catch(error=>{variants.delete(kind);throw error;}));
  return variants.get(kind);
}
export function preloadGrenadeModels() {
  return Promise.allSettled(Object.keys(GRENADE_MODELS).map(loadGrenadeModel));
}
export function createGrenadeProjectile(kind, eid=0) {
  const root=new THREE.Group();root.name='grenade-projectile';
  root.userData.kind=kind;root.userData.seed=(Number(eid)||1)*.731;
  root.add(fallback(kind).clone(true));
  root.userData.modelReady=loadGrenadeModel(kind).then(model=>{
    if(root.userData.disposed)return false;
    root.clear();root.add(model.clone(true));root.userData.imported=!!GRENADE_MODELS[kind];return true;
  }).catch(()=>false); // Retain the mechanical fallback, never an invisible ball.
  return root;
}
export function updateGrenadeProjectile(root, path, elapsed) {
  if(root.userData.disposed)return;
  let active=Math.max(0,elapsed), distance=0;
  if(path?.length>1){
    if(root.userData.path!==path){
      const times=[0],distances=[0];
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],d=Math.hypot(b[1]-a[1],b[2]-a[2],b[3]-a[3]);
        times.push(times[i-1]+(d>1e-5?b[0]-a[0]:0));distances.push(distances[i-1]+d);
      }
      Object.assign(root.userData,{path,times,distances});
    }
    sampleThrow(path,elapsed,root.position);
    let lo=0,hi=path.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(path[m][0]<=elapsed)lo=m;else hi=m;}
    const f=THREE.MathUtils.clamp((elapsed-path[lo][0])/Math.max(.001,path[hi][0]-path[lo][0]),0,1);
    const {times,distances}=root.userData;
    active=THREE.MathUtils.lerp(times[lo],times[hi],f);distance=THREE.MathUtils.lerp(distances[lo],distances[hi],f);
  }
  const phase=active*.005+distance*.7,seed=root.userData.seed;
  root.rotation.set(seed+phase,seed*.3+phase*.61,phase*.23);
}
export function disposeGrenadeProjectile(root) {
  if(!root)return;
  root.userData.disposed=true;root.removeFromParent();root.clear();
  // Template geometries/materials/textures are shared across all throws/maps.
  delete root.userData.path;delete root.userData.times;delete root.userData.distances;
}
