// Fixed-step preview counterpart of engine/throwing.py. No rendering state or
// random numbers: the host's sampled path is authoritative for actual flight.
const planeCache = new WeakMap();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function planes(b) {
  if (planeCache.has(b)) return planeCache.get(b);
  const x0=b.x-b.w/2, x1=b.x+b.w/2, y0=b.y-b.h/2, y1=b.y+b.h/2, z0=b.z-b.d/2, z1=b.z+b.d/2;
  const out=[[1,0,0,x1],[-1,0,0,-x0],[0,-1,0,-y0],[0,0,1,z1],[0,0,-1,-z0]];
  if(b.t==='ramp') {
    const z=b.ax==='z', slope=(b.y1-b.y0)/Math.max(1e-6,z?b.d:b.w), length=Math.hypot(slope,1);
    out.push([z?0:-slope/length,1/length,z?-slope/length:0,(b.y0-slope*(z?z0:x0))/length]);
  } else out.push([0,1,0,y1]);
  planeCache.set(b,out);
  return out;
}
export function sweepThrow(world, origin, end, radius) {
  const delta=end.map((v,i)=>v-origin[i]);
  const reach=Math.hypot(delta[0],delta[2])/2+radius;
  const boxes=world._near?world._near((origin[0]+end[0])/2,(origin[2]+end[2])/2,reach):world.solid;
  const shapes=boxes.map(planes);
  shapes.push([[0,1,0,world.floorBase??0]]);
  let best=1, normal=null;
  for(const shape of shapes) {
    let enter=0, leave=best, n=null, hit=true;
    for(const plane of shape) {
      const start=plane[0]*origin[0]+plane[1]*origin[1]+plane[2]*origin[2]-plane[3]-radius;
      const speed=plane[0]*delta[0]+plane[1]*delta[1]+plane[2]*delta[2];
      if(Math.abs(speed)<1e-10) { if(start>0) {hit=false;break;} }
      else {
        const t=-start/speed;
        if(speed<0 && t>=enter) {enter=t;n=plane.slice(0,3);}
        else if(speed>0) leave=Math.min(leave,t);
        if(enter>leave) {hit=false;break;}
      }
    }
    if(hit && n && enter>=0 && enter<=best && leave>=0) {best=enter;normal=n;}
  }
  for(const [axis,lo,hi] of [[0,world.bounds.minX,world.bounds.maxX],[2,world.bounds.minZ,world.bounds.maxZ]]) {
    if(Math.abs(delta[axis])<1e-10) continue;
    const bound=delta[axis]>0?hi-radius:lo+radius, t=(bound-origin[axis])/delta[axis];
    if(t>=0 && t<=best) {best=t;normal=[0,0,0];normal[axis]=delta[axis]>0?-1:1;}
  }
  return normal?[best,normal]:null;
}
const round=(v,n=4)=>Number(v.toFixed(n));
export function simulateThrow(world, origin, direction, power, kind, cfg, definitions, inherited=[0,0,0], maxMoveSpeed=5.7) {
  const spec=definitions.find(g=>g.id===kind)||{fuseMs:3500,impact:true};
  const length=Math.hypot(...direction), d=length?direction.map(v=>v/length):[1,0,0];
  power=clamp(Number.isFinite(power)?power:0.5,0,1);
  const speed=cfg.minSpeed+((kind==='flare'?cfg.flareSpeed:cfg.maxSpeed)-cfg.minSpeed)*power;
  const cap=maxMoveSpeed*1.35;
  let velocity=d.map((v,i)=>v*speed+clamp(inherited[i],-cap,cap)*0.45);
  velocity[1]+=cfg.upBoost*(1-Math.abs(d[1])*0.5);
  let position=[...origin], rest=false, bounces=0, time=0;
  const path=[[0,...position.map(v=>round(v))]], dt=1/cfg.stepHz, steps=Math.ceil(spec.fuseMs/1000/dt);
  for(let step=1;step<=steps;step++) {
    let hit=false;
    if(!rest) {
      velocity[1]-=cfg.gravity*dt;
      let remaining=dt;
      for(let i=0;i<4;i++) {
        const target=position.map((v,j)=>v+velocity[j]*remaining);
        const collision=sweepThrow(world,position,target,cfg.radius);
        if(!collision) {position=target;break;}
        const [fraction,normal]=collision;
        position=position.map((v,j)=>v+(target[j]-v)*fraction+normal[j]*0.001);
        const vn=velocity.reduce((sum,v,j)=>sum+v*normal[j],0), friction=normal[1]>0.45?cfg.friction:0.9;
        velocity=velocity.map((v,j)=>(v-normal[j]*vn)*friction-normal[j]*vn*cfg.restitution);
        bounces++;hit=true;remaining*=1-fraction;
        if(normal[1]>0.45 && Math.hypot(...velocity)<1.3) {velocity=[0,0,0];rest=true;break;}
        if(spec.impact && step*dt>=0.08) break;
      }
    }
    time=round(step*dt*1000,3);
    if(step%4===0 || hit || step===steps) path.push([time,...position.map(v=>round(v))]);
    if(hit && spec.impact && step*dt>=0.08) break;
  }
  if(path[path.length-1][0]!==time) path.push([time,...position.map(v=>round(v))]);
  return {path,delay:time,p:position.map(v=>round(v)),bounces};
}

/** Binary-search a host path; also works for late joins and dropped frames. */
export function sampleThrow(path, elapsed, out) {
  let lo=0,hi=path.length-1;
  while(lo+1<hi) {const mid=(lo+hi)>>1;if(path[mid][0]<=elapsed)lo=mid;else hi=mid;}
  const a=path[lo],b=path[hi],k=clamp((elapsed-a[0])/Math.max(0.001,b[0]-a[0]),0,1);
  return out.set(a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k,a[3]+(b[3]-a[3])*k);
}
