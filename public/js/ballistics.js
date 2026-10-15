// Continuous hitscan intersections, matching engine/combat.py. Rendering never
// decides damage, but must stop at the same solid surfaces as the authority.
const rampPlanes = new WeakMap();
export function raySolid(o, d, b, maxT) {
  if (b.t === 'ramp') {
    let shape = rampPlanes.get(b);
    if (!shape) {
      const x0=b.x-b.w/2,x1=b.x+b.w/2,z0=b.z-b.d/2,z1=b.z+b.d/2;
      const alongZ=b.ax==='z', slope=(b.y1-b.y0)/Math.max(1e-6,alongZ?b.d:b.w);
      shape=[[1,0,0,x1],[-1,0,0,-x0],[0,0,1,z1],[0,0,-1,-z0],[0,-1,0,-(b.y-b.h/2)],
        [alongZ?0:-slope,1,alongZ?-slope:0,b.y0-slope*(alongZ?z0:x0)]];
      rampPlanes.set(b,shape);
    }
    let enter=0,leave=maxT;
    for (const [nx,ny,nz,offset] of shape) {
      const start=nx*o.x+ny*o.y+nz*o.z-offset,speed=nx*d.x+ny*d.y+nz*d.z;
      if (Math.abs(speed)<1e-9) { if(start>0)return null; }
      else if(speed<0)enter=Math.max(enter,-start/speed);
      else leave=Math.min(leave,-start/speed);
      if(enter>leave)return null;
    }
    return enter;
  }
  let enter=0,leave=maxT;
  for (const [axis,size] of [['x','w'],['y','h'],['z','d']]) {
    const lo=b[axis]-b[size]/2,hi=b[axis]+b[size]/2;
    if(Math.abs(d[axis])<1e-9) { if(o[axis]<lo||o[axis]>hi)return null; }
    else {
      let a=(lo-o[axis])/d[axis],z=(hi-o[axis])/d[axis];
      if(a>z)[a,z]=[z,a];
      enter=Math.max(enter,a);leave=Math.min(leave,z);
      if(enter>leave)return null;
    }
  }
  return enter;
}

/** Nearest distance, including zero for an embedded origin. Grid DDA, not O(map). */
export function rayWorld(world, o, d, maxT=220, stats=null) {
  if (![o.x,o.y,o.z,d.x,d.y,d.z,maxT].every(Number.isFinite) || maxT<0) return 0;
  let best=null;
  const seen=new Set();
  const test=b=>{
    if(seen.has(b))return;seen.add(b);
    if(stats)stats.tested=(stats.tested||0)+1;
    const t=raySolid(o,d,b,best??maxT);
    if(t!==null && (best===null||t<best))best=t;
  };
  if(world.grid) {
    const c=world.gridCell||2;
    let ix=Math.floor(o.x/c),iz=Math.floor(o.z/c),enter=0;
    const sx=d.x>0?1:-1,sz=d.z>0?1:-1;
    let tx=Math.abs(d.x)>1e-9?((ix+(d.x>0?1:0))*c-o.x)/d.x:Infinity;
    let tz=Math.abs(d.z)>1e-9?((iz+(d.z>0?1:0))*c-o.z)/d.z:Infinity;
    const dx=Math.abs(d.x)>1e-9?c/Math.abs(d.x):Infinity,dz=Math.abs(d.z)>1e-9?c/Math.abs(d.z):Infinity;
    while(enter<=maxT && (best===null||enter<=best)) {
      for(const b of world.grid.get(ix+','+iz)||[])test(b);
      if(tx===Infinity&&tz===Infinity)break;
      if(tx<tz){enter=tx;tx+=dx;ix+=sx;}else{enter=tz;tz+=dz;iz+=sz;}
    }
  } else for(const b of world.solid||[])test(b);
  if(world.ground)test(world.ground);
  return best;
}

/** A barrel animated beyond cover may not start a streak on the far side. */
export function safeMuzzle(world, eye, muzzle) {
  const direction=muzzle.clone().sub(eye),length=direction.length();
  if(length<1e-6)return true;
  direction.multiplyScalar(1/length);
  if(rayWorld(world,eye,direction,length)!==null){muzzle.copy(eye);return false;}
  return true;
}

export function clipTracer(world, from, to) {
  const direction=to.clone().sub(from),length=direction.length();
  if(length<1e-6)return to.clone();
  direction.multiplyScalar(1/length);
  const hit=rayWorld(world,from,direction,length);
  return hit===null?to.clone():from.clone().addScaledVector(direction,Math.max(0,hit-.002));
}
