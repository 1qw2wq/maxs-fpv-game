import * as THREE from 'three';
import {DeathClock,DEATH_SETTLE} from './death-motion.js';

/** Bounded keyframed collapse, not a physics ragdoll. Owns no shared materials.
 * The gameplay root stays fixed; only its presentation children fall.
 * A small deformed-vertex probe keeps the visible body above its support floor.
 */
export class DeathAnimation {
  constructor(root,nodes,{height=1.7,joints=[],pose=()=>{}}={}) {
    this.root=root;this.clock=new DeathClock();this.poseJoints=pose;this.ground=0;
    this.joints=[...new Set(joints.filter(Boolean))];this.saved=[];
    this.pivot=new THREE.Group();this.pivot.name='death-presentation';
    this.content=new THREE.Group();this.content.name='death-body';
    this.centre=height*.50;
    this.pivot.position.y=this.centre;this.content.position.y=-this.centre;
    root.add(this.pivot);this.pivot.add(this.content);
    nodes.forEach(n=>this.content.add(n));
    this.point=new THREE.Vector3();this.inverse=new THREE.Matrix4();
    this.axis=new THREE.Vector3();this.rotation=new THREE.Quaternion();
    // Only inspect geometry while a collapse is moving, not for every corpse.
    this.probes=[];
  }
  collectProbes(){
    // Imported gun geometry can arrive after avatar construction.
    this.probes=[];
    this.content.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
      if(!mesh.isSkinnedMesh){
        if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
        const {min,max}=mesh.geometry.boundingBox,points=[];
        for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z])points.push(new THREE.Vector3(x,y,z));
        this.probes.push({mesh,points});return;
      }
      const count=mesh.geometry.attributes.position.count,indices=[];
      for(let i=0;i<Math.min(192,count);i++)indices.push(Math.floor(i*(count-1)/Math.max(1,Math.min(192,count)-1)));
      this.probes.push({mesh,indices});
    });
  }
  setAlive(alive,impact) {
    if(!this.clock.setAlive(alive,impact))return;
    if(alive){
      this.pivot.rotation.set(0,0,0);this.pivot.position.set(0,this.centre,0);
      for(const {bone,q} of this.saved)bone.quaternion.copy(q);
      this.saved.length=0;this.probes.length=0;this.content.visible=true;this.ground=0;
    }else{
      this.lastTime=performance.now();
      this.collectProbes();
      this.saved=this.joints.map(bone=>({bone,q:bone.quaternion.clone()}));
      this.content.visible=true;
    }
  }
  setGround(offset){if(Number.isFinite(offset))this.ground=offset;}
  update(dt) {
    if(!this.clock.dead)return;
    const wasSettled=this.clock.elapsed>=DEATH_SETTLE;
    const now=performance.now(),elapsed=Math.max(dt,(now-this.lastTime)/1000);
    this.lastTime=now;
    const p=this.clock.update(elapsed);this.content.visible=p.visible;
    if(!p.visible||wasSettled)return;
    this.pivot.quaternion.identity();this.pivot.position.set(0,this.centre,0);
    this.root.updateWorldMatrix(true,true);
    for(const {bone,q} of this.saved)bone.quaternion.copy(q);
    this.poseJoints(p);
    const direction=this.clock.impact.direction;
    this.axis.set(Math.cos(direction),0,-Math.sin(direction));
    this.rotation.setFromAxisAngle(this.axis,p.tilt);
    this.pivot.quaternion.copy(this.rotation);
    this.pivot.rotateZ(p.roll);
    this.pivot.position.set(0,this.centre*(1-p.drop),0);
    this.root.updateWorldMatrix(true,true);
    this.inverse.copy(this.root.matrixWorld).invert();
    let minimum=Infinity;
    this.content.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
    for(const {mesh,indices,points} of this.probes){
      // Hidden FP-only geometry/accessories must not prop up a corpse.
      let visible=true;for(let n=mesh;n&&n!==this.content;n=n.parent)if(!n.visible){visible=false;break;}
      if(!visible)continue;
      for(const sample of points||indices){
        if(points)this.point.copy(sample);else mesh.getVertexPosition(sample,this.point);
        this.point.applyMatrix4(mesh.matrixWorld).applyMatrix4(this.inverse);
        minimum=Math.min(minimum,this.point.y);
      }
    }
    if(Number.isFinite(minimum))this.pivot.position.y+=Math.max(0,this.ground+.012-minimum);
    this.root.updateMatrixWorld(true);
  }
  get visible(){return this.clock.visible;}
  get elapsed(){return this.clock.elapsed;}
}
