// Pure seeded authoring. Both engines consume the same committed JSON artifact.
import {generateCityTemplates} from './city-building.js';
export function generateProcCity(seed=1942){
  if(!Number.isSafeInteger(seed))throw new TypeError('Integer seed required');
  let state=seed>>>0;const rand=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const base=generateCityTemplates(seed),m={...base,seed:seed>>>0,generatorVersion:3,
    bounds:{minX:-120,maxX:120,minZ:-120,maxZ:120},boxes:[],tiles:[],buildings:[],floor_holes:[],navPoints:[],bot_nav:{nodes:[],edges:[]}};
  m.style={...base.style,fogNear:60,fogFar:190};
  m.spawns={'0':[-3,0,3].map(z=>({x:-115,y:0,z,yaw:0,team:0})),'1':[-3,0,3].map(z=>({x:115,y:0,z,yaw:180,team:1}))};
  const box=(x,y,z,w,h,d,t='wall',extra={})=>m.boxes.push({x,y,z,w,h,d,t,...extra});
  const tile=(meshName,x,y,z,w,h,d,rotY=0)=>m.tiles.push({meshName,x,y,z,rotY,scale:[w,h,d]});
  const nodes=new Map();
  const node=(id,p,kind='route')=>{if(!nodes.has(id)){const n={id,p,kind};nodes.set(id,n);m.bot_nav.nodes.push(n);}return id;};
  const edge=(a,b)=>{if(a!==b)m.bot_nav.edges.push([a,b]);};
  const roads=[-112,-90,-60,-30,0,30,60,90,112];
  const lots=roads.slice(1).map((v,i)=>({center:(v+roads[i])/2,lo:roads[i],hi:v}));
  const roadNode=(x,z)=>node(`street:${x},${z}`,[x,0,z]);
  for(const z of roads)for(let i=1;i<roads.length;i++)edge(roadNode(roads[i-1],z),roadNode(roads[i],z));
  for(const x of roads)for(let i=1;i<roads.length;i++)edge(roadNode(x,roads[i-1]),roadNode(x,roads[i]));
  function roadAttach(p,axis,line){
    const x=axis==='x'?line:p[0],z=axis==='z'?line:p[2],id=roadNode(x,z),value=axis==='x'?z:x;
    const lower=[...roads].reverse().find(v=>v<=value)??roads[0],upper=roads.find(v=>v>=value)??roads.at(-1);
    edge(id,axis==='x'?roadNode(line,lower):roadNode(lower,line));edge(id,axis==='x'?roadNode(line,upper):roadNode(upper,line));return id;
  }
  box(0,-.5,0,244,1,244,'ground');
  tile('courtyard',0,-.05,0,244,.02,244);
  // Eight tight blocks each way. Sidewalk-sized setbacks, not broad empty fields.
  let index=0;
  for(const lx of lots)for(const lz of lots){
    const cx=lx.center,cz=lz.center;
    const type=index%4,source=generateCityTemplates((seed+index*7919)>>>0,index%4===3?1:2),b=source.buildings[0],r=b.ranges;
    const q=Math.floor(rand()*4),angle=q*Math.PI/2;
    const maxX=((q%2?lz:lx).hi-(q%2?lz:lx).lo-10)/12,maxZ=((q%2?lx:lz).hi-(q%2?lx:lz).lo-10)/12;
    const sx=Math.min(maxX,[1,1.2,1.4,1.6][Math.floor(rand()*4)]),sz=Math.min(maxZ,[.9,1.1,1.35,1.6][Math.floor(rand()*4)]);
    const c=Math.round(Math.cos(angle)),s=Math.round(Math.sin(angle)),id=`block${index++}`;
    const P=p=>{const x=(p[0]-b.x)*sx,z=(p[2]-b.z)*sz;return [cx+c*x+s*z,p[1],cz-s*x+c*z];};
    const dimensions=(w,d)=>q%2?[d*sz,w*sx]:[w*sx,d*sz];
    for(const old of source.boxes.slice(r.begin.boxes,r.end.boxes)){
      const p=P([old.x,old.y,old.z]),[w,d]=dimensions(old.w,old.d),out={...old,x:p[0],z:p[2],w,d};
      if(old.t==='ramp'){out.ax=q%2?'x':'z';if(q===2||q===3){out.y0=old.y1;out.y1=old.y0;}}
      m.boxes.push(out);
    }
    const wall=['wall_solid','wall_brick','wall_stone','wall_ochre'][type];
    for(const old of source.tiles.slice(r.begin.tiles,r.end.tiles)){
      const p=P([old.x,old.y,old.z]),turned=Math.abs(Math.sin(old.rotY))>.5;
      const scale=[old.scale[0]*(turned?sz:sx),old.scale[1],old.scale[2]*(turned?sx:sz)];
      m.tiles.push({...old,meshName:old.meshName==='wall_solid'?wall:old.meshName,x:p[0],z:p[2],rotY:old.rotY+angle,scale});
    }
    const selected=source.bot_nav.nodes.slice(r.begin.nodes,r.end.nodes).filter(n=>n.id.startsWith(b.id+':'));
    const names=new Set(selected.map(n=>n.id));
    for(const n of selected)node(id+':'+n.id.split(':').slice(1).join(':'),P(n.p),n.kind);
    for(const [a,e]of source.bot_nav.edges.slice(r.begin.edges,r.end.edges))if(names.has(a)&&names.has(e))edge(id+':'+a.split(':').slice(1).join(':'),id+':'+e.split(':').slice(1).join(':'));
    const doors=b.doors.map(d=>{const p=P([d.x,0,d.z]);return {...d,x:p[0],z:p[2],width:d.width*sx,side:['n','e','s','w'][(['n','e','s','w'].indexOf(d.side)-q+4)%4]};});
    for(const [key,sign]of [['northDoor',-1],['southDoor',1]]){
      const p=nodes.get(id+':'+key).p,normal=[s*sign,c*sign];
      const axis=Math.abs(normal[0])>.5?'x':'z',center=axis==='x'?cx:cz,dir=axis==='x'?normal[0]:normal[1];
      const lot=axis==='x'?lx:lz,line=dir<0?lot.lo:lot.hi;edge(id+':'+key,roadAttach(p,axis,line));
    }
    const [w,d]=dimensions(12,12),start=P([b.ramp.x,0,b.ramp.z0]),end=P([b.ramp.x,3,b.ramp.z1]);
    const nb={id,x:cx,z:cz,w,d,stories:b.stories,storyHeight:3,scale:[sx,sz],variant:b.variant,type:['Townhouse','Cafe','Office','Depot'][b.variant],doors,rooms:b.rooms.map(room=>{const p=P([room.x,room.y,room.z]);return{x:p[0],y:p[1],z:p[2]};}),ramp:{start,end,w:2.2*sx},orientation:q};
    m.buildings.push(nb);
    const hole=source.floor_holes[0];if(hole){const hp=P([hole.x,hole.y,hole.z]),[hw,hd]=dimensions(hole.w,hole.d);m.floor_holes.push({...hole,building:id,x:hp[0],z:hp[2],w:hw,d:hd});}
  }
  // Continuous asphalt/cobblestone avenues, paved walks, grassy gardens and dirt yards.
  for(let x=-118;x<=118;x+=4)for(let z=-118;z<=118;z+=4){
    if(m.buildings.some(b=>Math.abs(x-b.x)<b.w/2+1&&Math.abs(z-b.z)<b.d/2+1))continue;
    const distance=Math.min(...roads.map(v=>Math.min(Math.abs(x-v),Math.abs(z-v))));
    const kind=Math.abs(x)<32&&Math.abs(z)<32?'street':distance<5?'pavement':distance<7?'pavement':((Math.floor((x+120)/30)+Math.floor((z+120)/30))%3===0?'dirt':'grass');
    tile(kind,x,-.025,z,4,.02,4);
  }
  // Connected two-lane roads, curbs and continuous walks.
  // Markings stop at intersections; zebra crossings give junctions a real scale.
  for(const v of roads){
    const half=3;
    tile('asphalt',0,-.004,v,224,.008,half*2);
    tile('asphalt',v,-.003,0,half*2,.008,224);
    for(const sign of[-1,1]){
      tile('pavement',0,-.002,v+sign*(half+.85),224,.006,1.7);
      tile('pavement',v+sign*(half+.85),-.001,0,1.7,.006,224);
    }
    for(let along=-109;along<110;along+=6){
      if(roads.some(r=>Math.abs(along-r)<6))continue;
      tile('paint_yellow',along,.006,v,2.5,.004,.12);
      tile('paint_yellow',v,.007,along,.12,.004,2.5);
    }
    for(let i=1;i<roads.length;i++){
      const a=roads[i-1]+5.5,b=roads[i]-5.5,mid=(a+b)/2,length=b-a;
      for(const sign of[-1,1]){
        const at=v+sign*(half+.12);
        box(mid,.05,at,length,.1,.2,'curb');tile('curb',mid,0,at,length,.1,.2);
        box(at,.05,mid,.2,.1,length,'curb');tile('curb',at,0,mid,.2,.1,length);
      }
    }
  }
  for(const x of roads.slice(1,-1))for(const z of roads.slice(1,-1))for(const sign of[-1,1])for(let offset=-2.1;offset<=2.2;offset+=.7){
    tile('paint_white',x+sign*5.0,.009,z+offset,1.7,.004,.35);
    tile('paint_white',x+offset,.010,z+sign*5.0,.35,.004,1.7);
  }
  // Pavement ribbons yield to asphalt at every connected intersection.
  for(const x of roads)for(const z of roads)tile('asphalt',x,.005,z,6,.004,6);
  // Real uploaded canopies overlap the sidewalk, without lowering door clearance.
  for(const b of m.buildings){
    const d=b.doors[0],normal=({n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]})[d.side],x=d.x+normal[0]*.7,z=d.z+normal[1]*.7,turn=normal[0]!==0;
    tile('awning',x,2.68,z,3.4,.32,1.6,turn?Math.PI/2:0);
    box(x,2.94,z,turn?1.6:3.4,.12,turn?3.4:1.6,'cover');
  }
  const graphSegments=m.bot_nav.edges.map(([a,b])=>[nodes.get(a).p,nodes.get(b).p]).filter(([a,b])=>a[1]<=.1&&b[1]<=.1);
  function rectClear(x,z,w,d){
    if(Math.abs(x)+w/2>117||Math.abs(z)+d/2>117||Math.abs(z)<5&&Math.abs(x)>107)return false;
    if(m.boxes.some(b=>!['ground','curb'].includes(b.t)&&b.y-b.h/2<1.8&&Math.abs(x-b.x)<(w+b.w)/2+.25&&Math.abs(z-b.z)<(d+b.d)/2+.25))return false;
    const lo=[x-w/2-.65,z-d/2-.65],hi=[x+w/2+.65,z+d/2+.65];
    for(const[a,b]of graphSegments){
      let enter=0,exit=1;
      for(let i=0;i<2;i++){const k=i*2,delta=b[k]-a[k];if(Math.abs(delta)<1e-9){if(a[k]<lo[i]||a[k]>hi[i]){enter=2;break;}}else{const u=(lo[i]-a[k])/delta,v=(hi[i]-a[k])/delta;enter=Math.max(enter,Math.min(u,v));exit=Math.min(exit,Math.max(u,v));}}
      if(enter<=exit)return false;
    }
    return true;
  }
  let coverRuns=0,parkedVehicles=0;
  // Yard walls create staggered, overlapping cover instead of isolated islands.
  for(const b of m.buildings)for(const sign of[-1,1])for(const axis of['x','z']){
    const x=b.x+(axis==='x'?sign*(b.w/2+1.0):sign*b.w*.18),z=b.z+(axis==='z'?sign*(b.d/2+1.0):-sign*b.d*.18);
    const w=axis==='x'?.4:Math.min(4.5,b.w*.35),d=axis==='z'?.4:Math.min(4.5,b.d*.35);
    if(!rectClear(x,z,w,d))continue;
    box(x,.53,z,w,1.06,d,'cover');tile('wall_stone',x,0,z,w,1.06,d);coverRuns++;
  }
  // Park in paired bays along the street edges; always leave door approaches open.
  for(const v of roads.slice(1,-1))for(let along=-99;along<=99;along+=15)for(const sign of[-1,1]){
    const at=v+sign*(3+1.25),vertical=((Math.round(along)+Math.round(v))&1)===0;
    const x=vertical?at:along,z=vertical?along:at,w=vertical?2.0:4.5,d=vertical?4.5:2.0;
    if(!rectClear(x,z,w,d))continue;
    box(x,.95,z,w,1.9,d,'cover');tile('parked_truck',x,0,z,2,1.9,4.5,vertical?0:Math.PI/2);parkedVehicles++;
  }
  const clear=(x,z,r)=>{
    if(Math.abs(x)>116||Math.abs(z)>116||Math.abs(z)<5&&Math.abs(x)>106)return false;
    if(m.buildings.some(b=>Math.abs(x-b.x)<b.w/2+r+1&&Math.abs(z-b.z)<b.d/2+r+1))return false;
    for(const [a,b]of m.bot_nav.edges){const p=nodes.get(a).p,q=nodes.get(b).p;if(p[1]>.1||q[1]>.1)continue;const dx=q[0]-p[0],dz=q[2]-p[2],t=Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[2])*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(x-p[0]-t*dx,z-p[2]-t*dz)<r+.8)return false;}
    return !m.boxes.some(b=>b.t!=='ground'&&b.t!=='curb'&&Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r);
  };
  // All the uploaded asset collections contribute: street kit, house/interiors,
  // old trees, and the new 150-mesh vegetation collection. Foliage is decorative;
  // tree trunks and solid street furniture have explicit AABB collision.
  const decor=['tree_oak','tree_pine','tree_birch','tree_autumn','tree_dead','shrub','berries','fern','flowers_patch','tree_park','tree_small','bush_kit','bench','dumpster','barrier','pallet','rubble','lamp','planter','planter'];
  let placed=0;
  for(let i=0;i<7000&&placed<500;i++){
    const x=-114+rand()*228,z=-114+rand()*228,k=decor[placed%decor.length],tree=k.startsWith('tree'),solid=tree||['bench','dumpster','barrier','pallet','rubble','truck','planter'].includes(k),r=k==='truck'?3.5:tree?.6:1.4;
    if(!clear(x,z,r))continue;
    const h=tree?4+rand()*4:k==='truck'?2.8:k==='planter'?.18:k==='lamp'?4.5:k==='dumpster'?1.45:k==='bench'?.9:.45+rand()*.6;
    const w=k==='truck'?2.2:k==='planter'?2.5:tree?h*.55:k==='bench'?2:k==='lamp'?.6:1.5,d=k==='truck'?5.8:k==='planter'?2.5:tree?w:k==='bench'?.6:1.2;
    const yaw=Math.floor(rand()*4)*Math.PI/2;
    tile(k,x,0,z,w,h,d,yaw);
    if(solid){if(tree)box(x,1.2,z,.4,2.4,.4,'tree');else box(x,h/2,z,Math.abs(Math.sin(yaw))>.5?d:w,h,Math.abs(Math.sin(yaw))>.5?w:d,'cover');}
    placed++;
  }
  for(const [x,z,w,d]of [[-120.3,0,.6,241],[120.3,0,.6,241],[0,-120.3,241,.6],[0,120.3,241,.6]]){box(x,1.25,z,w,2.5,d);tile('wall_stone',x,0,z,w,2.5,d);}
  for(const team of ['0','1'])for(const p of m.spawns[team])edge(node(`spawn:${team}:${p.z}`,[p.x,0,p.z]),roadNode(team==='0'?-112:112,0));
  m.navPoints=m.bot_nav.nodes.map(n=>({x:n.p[0],y:n.p[1],z:n.p[2]}));
  m.districts=64;m.vegetationAndStreetProps=placed;m.coverRuns=coverRuns;m.parkedVehicles=parkedVehicles;m.roads=roads;return m;
}
