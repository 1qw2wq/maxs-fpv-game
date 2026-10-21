// No DOM/build dependencies: exact shipped viewmodel/glove matrices.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {RELOAD_PROFILES,weaponReloadPose} from '../public/js/reload-motion.js';
import {weaponSockets} from '../public/js/weaponpose.js';
const hook=registerHooks({resolve(s,c,n){return s==='three'?{url:new URL('../public/vendor/three.module.js',import.meta.url).href,shortCircuit:true}:n(s,c);}});
const [{ViewModel},T]=await Promise.all([import('../public/js/viewmodel.js'),import('../public/vendor/three.module.js')]);hook.deregister();
const data=JSON.parse(readFileSync(new URL('../public/shared/weapons.json',import.meta.url)));
// Contact audit uses real GLBs in test-gun-calibration. This test bypasses only
// asynchronous art loading to exhaustively sample actual animation/glove math.
const vm=new ViewModel(data);vm.setClass(data.classes[0]);const signatures=new Set();let frames=0,maxJump=0;
const a=new T.Vector3(),b=new T.Vector3(),actual=new T.Vector3();
for(const weapon of data.weapons){
 assert.ok(RELOAD_PROFILES[weapon.id],`Missing reload for ${weapon.id}`);
 signatures.add(JSON.stringify([.2,.4,.6,.8].map(p=>weaponReloadPose(weapon,p))));
 for(const p of [0,1])assert.deepEqual(weaponReloadPose(weapon,p).fore,weaponSockets(weapon).fore,'Endpoints return to actual handguard');
 vm.setWeapon({...weapon,model:undefined});let previous;
 for(let step=0;step<=300;step++){
  const p=step/300,pose=weaponReloadPose(weapon,p);
  assert.ok([...pose.fore,...pose.rotation,...pose.position].every(Number.isFinite));
  if(previous){const jump=Math.hypot(...pose.fore.map((v,i)=>v-previous[i]));maxJump=Math.max(maxJump,jump);assert.ok(jump<.035,`${weapon.id} hand teleport`);}previous=pose.fore;
  vm.syncReload(3000,3000*(1-p),p<1);vm.update(0,{ads:false,sprinting:false,moveSpeed:0});
  vm.gripWorld(a,b);
  for(const rig of vm.armRigs){rig.palm.getWorldPosition(actual);assert.ok(actual.distanceTo(rig.side===1?a:b)<1e-6,'Glove detached from animated contact');}
  frames++;
 }
 vm.syncReload(3000,1000,true);vm.update(0,{moveSpeed:0});vm.syncReload(3000,0,false);vm.update(0,{moveSpeed:0});
 assert.deepEqual(vm.anchors.fore.position.toArray(),weaponSockets(weapon).fore,'Cancelled reload leaves a service pose');
}
assert.equal(signatures.size,30,'Every gun needs a distinct trajectory, not one shared animation');
console.log(`PASS: 30 unique reload profiles, ${frames} real viewmodel/glove frames, continuous paths, cancellation, max per-frame hand travel ${(maxJump*100).toFixed(2)}cm`);

// Remote peers must continue the authoritative clock between snapshots, then
// stop at expiry/cancellation instead of restarting a generic reload clip.
const {Net}=await import('../public/js/net.js');
const performanceDescriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=1000;
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
try {
 const net=new Net();
 const row=(rt,ri)=>({i:2,life:1,sh:0,al:1,p:[0,0,0],y:0,pi:0,f:0,rt,ri});
 net._dispatch({t:'state',tick:1,ps:[row(3000,2400)]});
 assert.equal(net.sample().get(2).reloading,true);
 assert.ok(Math.abs(net.sample().get(2).reloadProgress-.2)<1e-9);
 now+=600;assert.ok(Math.abs(net.sample().get(2).reloadProgress-.4)<1e-9);
 now+=1800;assert.equal(net.sample().get(2).reloading,false);
 assert.equal(net.sample().get(2).reloadProgress,1);
 net._dispatch({t:'state',tick:2,ps:[row(3000,1800)]});
 assert.equal(net.sample().get(2).reloading,true);
 net._dispatch({t:'state',tick:3,ps:[row(0,0)]});
 now+=net.interpDelay; // Let the render-time snapshot pair reach cancellation.
 assert.equal(net.sample().get(2).reloading,false);
 assert.equal(net.sample().get(2).reloadProgress,0);
}finally{Object.defineProperty(globalThis,'performance',performanceDescriptor);}
console.log('PASS: remote authoritative reload clocks extrapolate, expire and cancel');
