import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function testGrenadeModels(context,origin){
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/__harness.html');
 const result=await page.evaluate(async capture=>{
  window.grenadeShots=[];
  const T=await import('/vendor/three.module.js');
  const {createGrenadeProjectile,updateGrenadeProjectile,disposeGrenadeProjectile,preloadGrenadeModels,GRENADE_MODELS}=await import('/js/grenade-models.js');
  const loaded=await preloadGrenadeModels();if(loaded.some(p=>p.status!=='fulfilled'))throw Error('An uploaded model failed to load');
  const renderer=new T.WebGLRenderer({canvas:document.getElementById('game'),preserveDrawingBuffer:true});renderer.setSize(640,480);
  const scene=new T.Scene();scene.background=new T.Color(0x17212a);
  scene.add(new T.HemisphereLight(0xe7f1ff,0x5d5444,3));
  const light=new T.DirectionalLight(0xffffff,4);light.position.set(2,3,4);scene.add(light);
  const camera=new T.PerspectiveCamera(32,640/480,.01,10);camera.position.set(.24,.12,.37);camera.lookAt(0,0,0);
  const pixels=new Uint8Array(640*480*4),cases=[];
  let sharedDisposed=0;
  for(const kind of Object.keys(GRENADE_MODELS)){
   const model=createGrenadeProjectile(kind,71);await model.userData.modelReady;
   if(!model.userData.imported)throw Error(`${kind}: fallback instead of uploaded art`);
   scene.add(model);model.updateMatrixWorld(true);
   const bounds=new T.Box3().setFromObject(model),sphere=bounds.getBoundingSphere(new T.Sphere());
   if(sphere.radius+sphere.center.length()>.09001)throw Error(`${kind}: art exceeds collision sphere ${sphere.radius+sphere.center.length()}`);
   renderer.render(scene,camera);
   if(capture)grenadeShots.push({kind,data:renderer.domElement.toDataURL()});
   const gl=renderer.getContext();gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   // Compare against a blank render rather than depending on color management.
   model.visible=false;renderer.render(scene,camera);
   const blank=new Uint8Array(pixels.length);gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,blank);
   let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-blank[i])+Math.abs(pixels[i+1]-blank[i+1])+Math.abs(pixels[i+2]-blank[i+2])>15)count++;
   if(count<500)throw Error(`${kind}: invisible uploaded model (${count} pixels)`);
   model.visible=true;
   model.traverse(o=>{if(o.isMesh){o.geometry.addEventListener('dispose',()=>sharedDisposed++);for(const m of [].concat(o.material))m.addEventListener('dispose',()=>sharedDisposed++);}});
   cases.push({kind,file:GRENADE_MODELS[kind].file,pixels:count,radius:sphere.radius});
   disposeGrenadeProjectile(model);
  }
  const path=[[0,0,1.58,0],[100,1,1.2,0],[200,1,.091,0],[600,1,.091,0],[1000,1,.091,0]];
  let samples=0;
  for(const hz of [20,60,144]){
   const model=createGrenadeProjectile('frag',71);await model.userData.modelReady;
   for(let f=0;f<=hz;f++){updateGrenadeProjectile(model,path,f/hz*1000);if(![...model.position,...model.quaternion].every(Number.isFinite))throw Error('Non-finite grenade pose');samples++;}
   updateGrenadeProjectile(model,path,200);const q=model.quaternion.clone();updateGrenadeProjectile(model,path,950);
   if(q.angleTo(model.quaternion)>1e-7)throw Error('Grenade keeps spinning while at rest');
   if(model.position.distanceTo(new T.Vector3(1,.091,0))>1e-7)throw Error('Position differs from authoritative samples');
   disposeGrenadeProjectile(model);
  }
  const pending=createGrenadeProjectile('smoke',99);disposeGrenadeProjectile(pending);await pending.userData.modelReady;
  if(pending.children.length||pending.parent)throw Error('Async load resurrected disposed grenade');
  const siblings=Array.from({length:32},(_,i)=>createGrenadeProjectile('frag',i));await Promise.all(siblings.map(s=>s.userData.modelReady));
  const geometries=new Set();for(const s of siblings)s.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});
  for(const s of siblings)disposeGrenadeProjectile(s);
  if(geometries.size>8||sharedDisposed)throw Error('Repeated throws duplicate/dispose cached art');
  const flare=createGrenadeProjectile('flare',0);await flare.userData.modelReady;
  let flareParts=0;flare.traverse(o=>{if(o.isMesh)flareParts++;});
  if(flareParts<4)throw Error('Flare must have a detailed cartridge fallback');disposeGrenadeProjectile(flare);
  const resources=performance.getEntriesByType('resource').filter(r=>/granade.*\.glb/.test(r.name));
  if(resources.length!==3)throw Error(`Models downloaded ${resources.length} times instead of three cached files`);
  renderer.dispose();return {cases,samples,sharedGeometries:geometries.size};
 },!!process.env.GRENADE_MODEL_SHOTS);
 if(process.env.GRENADE_MODEL_SHOTS)for(const image of await page.evaluate(()=>grenadeShots))await writeFile(`${process.env.GRENADE_MODEL_SHOTS}-${image.kind}.png`,Buffer.from(image.data.split(',')[1],'base64'));
 assert.deepEqual(errors,[]);console.log('PASS: uploaded throwable models, physical envelope, actual pixels, rest/late paths, shared-resource disposal, pending-load cancellation',JSON.stringify(result));
 await page.close();
 const failed=await context.newPage();failed.on('pageerror',e=>errors.push(e.message));
 await failed.route('**/models/guns/granade_m26.glb',r=>r.abort());await failed.goto(origin+'/__harness.html');
 assert(await failed.evaluate(async()=>{
  const {createGrenadeProjectile,disposeGrenadeProjectile}=await import('/js/grenade-models.js');
  const g=createGrenadeProjectile('frag');const ready=await g.userData.modelReady;
  let count=0;g.traverse(o=>{if(o.isMesh)count++;});disposeGrenadeProjectile(g);
  return ready===false&&count>=4;
 }),'Missing model must retain its detailed mechanical fallback');
 assert.deepEqual(errors,[]);await failed.close();
 console.log('PASS: failed model download retains a visible mechanical grenade fallback');
}
