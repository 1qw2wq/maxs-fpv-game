// Seeded, bounded presentation. These particles never determine damage or LOS.
import * as THREE from 'three';
import { sweepThrow, sampleThrow } from './throwing.js';
import { smokeTexture } from './smoke.js';

let flameTexture, glowTexture;
function textures() {
  if(flameTexture)return;
  const make=flame=>{
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;
    const c=canvas.getContext('2d');
    const g=c.createRadialGradient(64,flame?204:128,2,64,flame?166:128,flame?100:64);
    g.addColorStop(0,flame?'rgba(255,255,230,1)':'rgba(255,255,255,1)');
    g.addColorStop(.25,flame?'rgba(255,222,100,.95)':'rgba(255,255,255,.95)');
    g.addColorStop(.6,flame?'rgba(255,90,15,.65)':'rgba(255,255,255,.45)');
    g.addColorStop(1,flame?'rgba(110,12,0,0)':'rgba(255,255,255,0)');
    c.fillStyle=g;
    if(flame){
      c.beginPath();c.moveTo(64,252);c.bezierCurveTo(5,246,9,184,35,126);
      c.bezierCurveTo(30,176,58,126,61,20);c.bezierCurveTo(108,114,77,132,101,110);
      c.bezierCurveTo(93,166,137,216,93,248);c.closePath();c.fill();
      const image=c.getImageData(0,0,128,256);
      for(let y=0;y<256;y++)for(let x=0;x<128;x++){
        // Turbulent detail breaks up a smooth, plastic-looking fire teardrop.
        const n=.70+.18*Math.sin(x*.31+Math.sin(y*.12)*3)+.12*Math.sin(y*.43+x*.17);
        image.data[(y*128+x)*4+3]*=n;
      }
      c.putImageData(image,0,0);
    }else c.fillRect(0,0,128,256);
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
  };
  flameTexture=make(true);glowTexture=make(false);
}
const random=seed=>{let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const grenadeVisualDuration=(kind,dur)=>Math.max(dur||1000,kind==='frag'?2400:0);
function sprite(map,color,additive=false){
  return new THREE.Sprite(new THREE.SpriteMaterial({map,color,transparent:true,opacity:0,depthWrite:false,
    blending:additive?THREE.AdditiveBlending:THREE.NormalBlending}));
}

export function buildGrenadeEffect(fx,world) {
  textures();
  const obj=new THREE.Group();obj.position.fromArray(fx.p);
  const rng=random((fx.eid||1)*7919),particles=[],dust=[];
  const burning=fx.k==='incendiary',flare=fx.k==='flare',smoke=fx.k==='smoke',flash=fx.k==='flash';
  const persistent=burning||flare,dur=grenadeVisualDuration(fx.k,fx.dur);
  const count=burning?30:flare?7:smoke?4:flash?1:8;
  const radius=burning?(fx.r||4):flare?.16:smoke?.08:.15;
  for(let i=0;i<count;i++){
    const angle=rng()*Math.PI*2,r=Math.sqrt(rng())*radius,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
    if(burning&&world&&sweepThrow(world,[fx.p[0],fx.p[1]+.4,fx.p[2]],[fx.p[0]+x,fx.p[1]+.4,fx.p[2]+z],.01))continue;
    const floor=burning&&world?world.floorAt(fx.p[0]+x,fx.p[2]+z,fx.p[1]-.1)-fx.p[1]:0;
    if(burning&&Math.abs(floor)>.65)continue;
    const s=sprite(smoke?smokeTexture():persistent?flameTexture:glowTexture,flash?0xffffff:smoke?0xb6bbba:flare?0xff6635:0xffbf65,!smoke&&!persistent);
    obj.add(s);
    particles.push({sprite:s,x,z,floor,phase:rng(),width:burning?.9+rng()*.55:.25,height:flare?.35+rng()*.4:.5+rng()*1.1,speed:.7+rng()*.8,
      vx:Math.cos(angle)*(1+rng()*3),vz:Math.sin(angle)*(1+rng()*3),vy:1+rng()*3});
  }
  // Non-emissive, irregular dust/smoke: a blast is not a long-lived orange ball.
  const dustCount=flash||smoke?0:burning?10:flare?3:20;
  for(let i=0;i<dustCount;i++){
    const angle=rng()*Math.PI*2,s=sprite(smokeTexture(),burning||flare?0x45433f:0x86796a);
    s.material.rotation=rng()*Math.PI*2;obj.add(s);
    dust.push({sprite:s,phase:rng(),angle,speed:.6+rng()*2.4,size:.45+rng()*.9,
      rise:.3+rng()*.8,spin:(rng()-.5)*.5});
  }
  const halo=sprite(glowTexture,flash?0xffffff:flare?0xff4725:0xffa94b,true);obj.add(halo);
  // Two instanced batches replace dozens of separate mesh/material draw calls.
  const sparkCount=flash?0:smoke?3:burning?12:flare?8:22;
  const sparks=new THREE.InstancedMesh(new THREE.BoxGeometry(.012,.012,.075),
    new THREE.MeshBasicMaterial({color:0xffd49c,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}),sparkCount);
  sparks.frustumCulled=false;obj.add(sparks);
  const sparkData=Array.from({length:sparkCount},()=>({v:new THREE.Vector3((rng()-.5)*9,1.5+rng()*5,(rng()-.5)*9),phase:rng()}));
  const fragmentCount=fx.k==='frag'?24:0;
  const fragments=new THREE.InstancedMesh(new THREE.BoxGeometry(.024,.016,.045),
    new THREE.MeshStandardMaterial({color:0x49453c,roughness:.8,metalness:.55,transparent:true}),fragmentCount);
  fragments.frustumCulled=false;obj.add(fragments);
  const fragmentPaths=[];
  for(let i=0;i<fragmentCount;i++){
    const v=[(rng()-.5)*17,2+rng()*7,(rng()-.5)*17],path=[[0,0,.08,0]];
    // Precompute short cosmetic fragment arcs once; solid hits stop them. This
    // stays deterministic at 20/60/144 Hz and is NOT a secondary damage ray.
    for(let step=1;step<=24;step++){
      const t=step*.04,prev=path[path.length-1],end=[v[0]*t,.08+v[1]*t-4.9*t*t,v[2]*t];
      const from=[fx.p[0]+prev[1],fx.p[1]+prev[2],fx.p[2]+prev[3]],to=end.map((a,j)=>a+fx.p[j]);
      const hit=world?sweepThrow(world,from,to,.012):null;
      if(hit){
        path.push([step*40,...end.map((a,j)=>prev[j+1]+(a-prev[j+1])*Math.max(0,hit[0]-.002))]);break;
      }
      path.push([step*40,...end]);
    }
    fragmentPaths.push({path,spin:rng()*8,seed:rng()*6});
  }
  const mark=new THREE.Mesh(new THREE.CircleGeometry(burning?radius*.65:flare?.13:.65,24),
    new THREE.MeshBasicMaterial({map:smokeTexture(),color:0x211c16,transparent:true,opacity:0,depthWrite:false}));
  mark.rotation.x=-Math.PI/2;
  const floor=world?world.floorAt(fx.p[0],fx.p[2],fx.p[1]):0;
  mark.position.y=world?floor-fx.p[1]+.012:-fx.p[1]+.012;
  mark.visible=!flash&&!smoke&&Math.abs(mark.position.y)<.65;
  if(world&&mark.visible){
    const r=burning?radius*.65:flare?.13:.65;
    // A flat soot card is inappropriate on a stair edge or sloping surface.
    for(const [x,z] of [[r,0],[-r,0],[0,r],[0,-r]])
      if(Math.abs(world.floorAt(fx.p[0]+x,fx.p[2]+z,fx.p[1])-floor)>.08)mark.visible=false;
  }
  obj.add(mark);
  return {obj,particles,dust,halo,sparks,sparkData,fragments,fragmentPaths,mark,
    dummy:new THREE.Object3D(),sample:new THREE.Vector3(),kind:fx.k,dur,burning,flare,smoke,flash,glow:0};
}

export function updateGrenadeEffect(e,age) {
  const t=Math.max(0,age)/1000,left=clamp((e.dur-age)/700),persistent=e.burning||e.flare;
  const envelope=clamp(t*12)*left;
  const core=(e.flash?Math.exp(-t/.025):e.smoke?Math.exp(-t/.06)*.12:Math.exp(-t/.045))*clamp(((e.flash?.12:.25)-t)/.04);
  for(const p of e.particles){
    const phase=(t*p.speed+p.phase)%1;
    if(persistent){
      p.sprite.position.set(p.x+Math.sin(t*3+p.phase*15)*.09,p.floor+.12+phase*p.height*.7,p.z);
      p.sprite.scale.set(p.width*(1-phase*.3),p.height*(.65+phase*.6),1);
      p.sprite.material.opacity=envelope*Math.sin(phase*Math.PI)*.85;
      p.sprite.material.color.setRGB(1,.3+(1-phase)*.42,.05+(1-phase)*.16);
    }else if(e.smoke){
      p.sprite.position.set(p.x+t*.08,.1+t*.7,p.z);
      p.sprite.scale.setScalar(.14+t*.6);p.sprite.material.opacity=clamp(1-t/.9)*.5*left;
    }else{
      p.sprite.position.set(p.vx*t*.25,.15+p.vy*t*.2,p.vz*t*.25);
      p.sprite.scale.setScalar(e.flash?.4+t*18:.35+t*6);p.sprite.material.opacity=core;
    }
  }
  for(const p of e.dust){
    const cycle=persistent?(t*.4+p.phase)%1:t/2.4;
    const life=persistent?cycle*2.4:t;
    const expand=persistent?.1+p.phase*(e.burning?2:.2):Math.min(t,1.1)*p.speed;
    p.sprite.position.set(Math.cos(p.angle)*expand+Math.sin(t*.5+p.phase)*.08,
      .12+life*p.rise,Math.sin(p.angle)*expand);
    p.sprite.scale.setScalar(p.size*(persistent?.4+cycle: .25+Math.min(t,1.6)*1.3));
    p.sprite.material.opacity=(persistent?envelope*Math.sin(Math.PI*cycle)*.24:clamp(t/.08)*Math.pow(clamp(1-t/2.4),1.4)*.65)*left;
    p.sprite.material.rotation=p.phase*6+t*p.spin;
  }
  e.halo.position.y=persistent?.2:.15;
  e.halo.scale.setScalar(e.burning?3:e.flare?.75:e.flash?1+t*18:.5+t*9);
  e.halo.material.opacity=persistent?envelope*(e.burning?.09:.35):core*.8;
  e.glow=persistent?envelope*(e.flare?1.4:.9)*(1+.18*Math.sin(t*19)):core*(e.flash?14:8);
  e.mark.material.opacity=(persistent?envelope:.5*clamp(t*8)*left)*.45;
  const dummy=e.dummy;
  for(let i=0;i<e.sparkData.length;i++){
    const p=e.sparkData[i],life=persistent?(t+p.phase*1.1)%1.1:t;
    dummy.position.set(p.v.x*life*.4,Math.max(.025,p.v.y*life-4.9*life*life),p.v.z*life*.4);
    dummy.rotation.set(life*3+p.phase,life*2,0);dummy.scale.setScalar(clamp(1-life/.7));dummy.updateMatrix();
    e.sparks.setMatrixAt(i,dummy.matrix);
  }
  e.sparks.instanceMatrix.needsUpdate=true;e.sparks.material.opacity=persistent?envelope*.8:clamp(1-t/.65);
  for(let i=0;i<e.fragmentPaths.length;i++){
    const p=e.fragmentPaths[i];sampleThrow(p.path,t*1000,e.sample);
    const spinTime=Math.min(t,p.path.at(-1)[0]/1000);
    dummy.position.copy(e.sample);dummy.rotation.set(p.seed+spinTime*p.spin,p.seed+spinTime*3,spinTime*4);
    dummy.scale.setScalar(1);dummy.updateMatrix();e.fragments.setMatrixAt(i,dummy.matrix);
  }
  e.fragments.instanceMatrix.needsUpdate=true;e.fragments.material.opacity=clamp((1.2-t)/.35);
}

// Fixed light count avoids shader recompiles and unbounded per-explosion lights.
export function createGrenadeLights(parent) {
  return Array.from({length:2},()=>{const light=new THREE.PointLight(0xffa34a,0,7,2);light.castShadow=false;parent.add(light);return light;});
}
export function updateGrenadeLights(lights,effects,eye) {
  let first=null,second=null,a=0,b=0;
  for(const e of effects){
    if(!e.landed||!e.detonation?.glow)continue;
    const score=e.detonation.glow/(1+eye.distanceToSquared(e.obj.position)*.04);
    if(score>a){second=first;b=a;first=e;a=score;}else if(score>b){second=e;b=score;}
  }
  for(let i=0;i<lights.length;i++){
    const e=i===0?first:second,l=lights[i];l.intensity=e?.detonation.glow||0;
    if(e){l.position.copy(e.obj.position);l.position.y+=.35;l.color.setHex(e.kind==='flash'?0xffffff:e.kind==='flare'?0xff6233:0xffb56c);}
  }
}
