// Offline diagnostic, no npm/build. Optional SVG directory: node tools/test-gun-calibration.mjs /tmp/gun-audit
import * as T from '../public/vendor/three.module.js';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root));
import {weaponSockets} from '../public/js/weaponpose.js';
const src=read('public/js/guns.js').toString(),cfg=Function('return ('+src.match(/const MODELS = (\{[\s\S]*?\n\});/)[1]+')')(),weapons=JSON.parse(read('public/shared/weapons.json')).weapons,out={};
for(const w of weapons){const c=cfg[w.id],buf=read('public/models/guns/'+(c.file||w.id+'.glb')),len=buf.readUInt32LE(12),g=JSON.parse(buf.toString('utf8',20,20+len).trim()),start=28+len,points=[],triangles=[];
let root=new T.Matrix4().compose(new T.Vector3(...c.off.map((v,i)=>c.flip&&i!==1?-v:v)),new T.Quaternion().setFromEuler(new T.Euler(...c.rot.map(x=>x*Math.PI/180))),new T.Vector3().setScalar(c.scale));if(c.flip)root.premultiply(new T.Matrix4().makeRotationY(Math.PI));if(c.levelPitch)root.premultiply(new T.Matrix4().makeRotationX(c.levelPitch*Math.PI/180));
function walk(i,parent){let n=g.nodes[i],mat=n.matrix?new T.Matrix4().fromArray(n.matrix):new T.Matrix4().compose(new T.Vector3().fromArray(n.translation||[0,0,0]),new T.Quaternion().fromArray(n.rotation||[0,0,0,1]),new T.Vector3().fromArray(n.scale||[1,1,1]));mat.premultiply(parent);if(n.mesh!==undefined&&(!c.keepNodes||c.keepNodes.includes(i)))for(const p of g.meshes[n.mesh].primitives){let a=g.accessors[p.attributes.POSITION],v=g.bufferViews[a.bufferView];let first=points.length;for(let k=0;k<a.count;k++){const off=start+(v.byteOffset||0)+(a.byteOffset||0)+k*(v.byteStride||12);points.push(new T.Vector3(buf.readFloatLE(off),buf.readFloatLE(off+4),buf.readFloatLE(off+8)).applyMatrix4(mat).toArray());}if(p.indices!==undefined){const ia=g.accessors[p.indices],iv=g.bufferViews[ia.bufferView],bytes={5121:1,5123:2,5125:4}[ia.componentType];for(let j=0;j<ia.count;j++){let off=start+(iv.byteOffset||0)+(ia.byteOffset||0)+j*bytes;triangles.push(first+(bytes===1?buf.readUInt8(off):bytes===2?buf.readUInt16LE(off):buf.readUInt32LE(off)));}}else for(let j=0;j<a.count;j++)triangles.push(first+j);}for(const child of n.children||[])walk(child,mat);}
for(const i of g.scenes[g.scene||0].nodes)walk(i,root);out[w.id]={points,triangles,sockets:weaponSockets(w)};}
// Measure contacts on actual assembled triangles, not the placeholder bounds.
const triangle=new T.Triangle(),target=new T.Vector3(),closest=new T.Vector3();
const svgDir=process.argv[2];if(svgDir)mkdirSync(svgDir,{recursive:true});
for(const [id,g]of Object.entries(out)){
  const report={};
  for(const key of ['hand','fore']){
    target.fromArray(g.sockets[key]);let distance=Infinity;
    for(let i=0;i<g.triangles.length;i+=3){
      triangle.a.fromArray(g.points[g.triangles[i]]);triangle.b.fromArray(g.points[g.triangles[i+1]]);triangle.c.fromArray(g.points[g.triangles[i+2]]);
      triangle.closestPointToPoint(target,closest);distance=Math.min(distance,target.distanceTo(closest));
    }
    assert.ok(distance<.027,`${id}/${key}: palm floats ${(distance*100).toFixed(1)}cm off actual geometry`);
    report[key]=+(distance*100).toFixed(2);
  }
  assert.ok(g.sockets.fore[2]>=g.sockets.hand[2]-.01,`${id}: support behind trigger`);
  if(svgDir){
    let z0=Infinity,z1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const p of g.points){z0=Math.min(z0,p[2]);z1=Math.max(z1,p[2]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
    const scale=Math.min(720/(z1-z0),300/(y1-y0)),P=p=>[40+(p[2]-z0)*scale,40+(y1-p[1])*scale];
    const paths=[];
    for(let i=0;i<g.triangles.length;i+=3)paths.push('M'+g.triangles.slice(i,i+3).map(j=>P(g.points[j]).map(n=>n.toFixed(2)).join(',')).join('L')+'Z');
    const dots=['hand','fore'].map((key,i)=>{const[x,y]=P(g.sockets[key]);return `<circle cx="${x}" cy="${y}" r="5" fill="${i?'cyan':'red'}"/>`;});
    writeFileSync(resolve(svgDir,id+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#eef2f5"/><text x="20" y="22">${id}: muzzle right; red trigger, cyan support</text><path fill="#414956" d="${paths.join('')}"/>${dots.join('')}</svg>`);
  }
  console.log(id,JSON.stringify(report));
}
// Regression landmarks from the visual audit: not a longest-axis heuristic.
for(const[id,lo,hi]of[['gm6',-.24,-.14],['m170',-.38,-.30],['pmx',-.05,0],['mp5',-.065,-.025],['lr300',-.14,-.07],['flarepistol',-.14,-.08]])assert.ok(out[id].sockets.hand[2]>=lo&&out[id].sockets.hand[2]<=hi,`${id}: wrong handle region`);
assert.deepEqual(cfg.lr300.rot,[0,180,0],'LR300 barrel must face forward, not its stock');
console.log('PASS: all 30 assembled GLB contacts within 2.7cm; corrected handle regions and LR300 direction');
