// Bounded, seeded detonation effects. Incendiary flames persist; frag flames
// are a brief fireball, smoke has only a small ignition puff, flash has no fire.
import * as THREE from 'three';
import { sweepThrow } from './throwing.js';

let flameTexture, glowTexture;
function textures() {
  if (flameTexture) return;
  const make = (flame) => {
    const canvas = document.createElement('canvas'); canvas.width=128; canvas.height=256;
    const c=canvas.getContext('2d');
    if(flame) {
      const gradient=c.createRadialGradient(64,192,2,64,156,96);
      gradient.addColorStop(0,'rgba(255,255,225,1)'); gradient.addColorStop(0.23,'rgba(255,225,65,.95)');
      gradient.addColorStop(0.55,'rgba(255,95,12,.75)'); gradient.addColorStop(1,'rgba(120,12,0,0)');
      c.fillStyle=gradient;
      c.beginPath();c.moveTo(64,250);c.bezierCurveTo(4,245,10,174,36,126);c.bezierCurveTo(36,160,56,132,58,32);
      c.bezierCurveTo(104,106,78,126,100,109);c.bezierCurveTo(94,152,139,208,94,244);c.closePath();c.fill();
    } else {
      const gradient=c.createRadialGradient(64,128,0,64,128,64);
      gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(0.3,'rgba(255,235,180,.65)');gradient.addColorStop(1,'rgba(255,135,20,0)');
      c.fillStyle=gradient;c.fillRect(0,0,128,256);
    }
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
  };
  flameTexture=make(true);glowTexture=make(false);
}
const random=(seed)=>{let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};};

export function buildGrenadeEffect(fx, world) {
  textures();
  const obj=new THREE.Group();obj.position.fromArray(fx.p);
  const rng=random((fx.eid||1)*7919), particles=[];
  const burning=fx.k==='incendiary', flare=fx.k==='flare', smoke=fx.k==='smoke', flash=fx.k==='flash';
  const count=burning?38:flare?9:smoke?6:flash?12:30;
  const radius=burning?(fx.r||4):flare?0.3:smoke?0.25:1;
  for(let i=0;i<count;i++) {
    const angle=rng()*Math.PI*2, r=Math.sqrt(rng())*radius;
    const x=Math.cos(angle)*r,z=Math.sin(angle)*r;
    if(burning && world && sweepThrow(world,[fx.p[0],fx.p[1]+0.4,fx.p[2]],[fx.p[0]+x,fx.p[1]+0.4,fx.p[2]+z],0.01)) continue;
    const mat=new THREE.SpriteMaterial({map:flash?glowTexture:flameTexture,color:flash?0xfff4db:flare?0xff632f:0xffcd87,
      transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
    const sprite=new THREE.Sprite(mat);sprite.frustumCulled=false;obj.add(sprite);
    const floor=burning && world?world.floorAt(fx.p[0]+x,fx.p[2]+z,fx.p[1]-0.1)-fx.p[1]:0;
    particles.push({sprite,x,z,floor,phase:rng(),height:0.8+rng()*1.1,speed:0.7+rng()*0.8,
      vx:Math.cos(angle)*(2+rng()*5),vz:Math.sin(angle)*(2+rng()*5),vy:2+rng()*5});
  }
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:flash?0xffffff:flare?0xff341b:0xffa43a,
    transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));
  halo.frustumCulled=false;obj.add(halo);
  const sparks=new THREE.Group();obj.add(sparks);
  for(let i=0;i<(burning?14:flash?5:18);i++) {
    const spark=new THREE.Mesh(new THREE.SphereGeometry(0.025,4,3),new THREE.MeshBasicMaterial({color:0xffd881,transparent:true,depthWrite:false}));
    spark.userData.velocity=new THREE.Vector3((rng()-.5)*9,2+rng()*6,(rng()-.5)*9);
    sparks.add(spark);
  }
  return {obj,particles,halo,sparks,kind:fx.k,dur:fx.dur||1000,burning,flare,smoke,flash};
}

export function updateGrenadeEffect(effect, age) {
  const t=Math.max(0,age)/1000;
  const envelope=Math.min(1,t*12)*Math.min(1,Math.max(0,(effect.dur-age)/900));
  const transient=effect.smoke?0.25:effect.flash?0.28:0.55;
  const alpha=effect.burning||effect.flare?envelope:Math.max(0,1-t/transient);
  for(const p of effect.particles) {
    const phase=(t*p.speed+p.phase)%1;
    if(effect.burning||effect.flare) {
      p.sprite.position.set(p.x+Math.sin(t*3+p.phase*15)*0.12,p.floor+0.35+phase*p.height*0.8,p.z);
      p.sprite.scale.set((effect.flare?0.35:0.65)*(1-phase*.5),p.height*(0.65+phase*.7),1);
      p.sprite.material.opacity=alpha*(0.55+Math.sin(phase*Math.PI)*0.35)*(1-phase*.45);
    } else {
      p.sprite.position.set(p.x*t+p.vx*t*0.4,0.2+p.vy*t-3*t*t,p.z*t+p.vz*t*0.4);
      const size=effect.flash?2+t*10:effect.smoke?0.35+t:0.8+t*4;
      p.sprite.scale.set(size,size*1.4,1);p.sprite.material.opacity=alpha*0.85;
    }
  }
  effect.halo.position.y=effect.burning?0.35:effect.flare?0.3:0.6;
  effect.halo.scale.setScalar(effect.burning?7:effect.flare?2:effect.flash?3+t*18:1+t*12);
  effect.halo.material.opacity=alpha*(effect.burning?0.25:effect.flare?0.55:0.85);
  for(const spark of effect.sparks.children) {
    const v=spark.userData.velocity;
    const life=effect.burning||effect.flare?(t+v.y)%1.3:t;
    spark.position.set(v.x*life*.5,Math.max(0.03,v.y*life-4*life*life),v.z*life*.5);
    spark.material.opacity=alpha*Math.max(0,1-life/1.3);
    spark.visible=spark.material.opacity>0;
  }
}
