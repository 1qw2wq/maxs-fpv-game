// Pure seeded authoring. Both engines consume the same committed JSON artifact.
import {generateCityTemplates} from './city-building.js';
import {CITY_VEHICLES,cityVehicle} from './vehicles.js';
export function generateProcCity(seed=1942){
  if(!Number.isSafeInteger(seed))throw new TypeError('Integer seed required');
  let state=seed>>>0;const rand=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const base=generateCityTemplates(seed),m={...base,seed:seed>>>0,generatorVersion:7,
    bounds:{minX:-120,maxX:120,minZ:-120,maxZ:120},boxes:[],tiles:[],buildings:[],floor_holes:[],navPoints:[],bot_nav:{nodes:[],edges:[]}};
  m.style={...base.style,skyTop:'#83abc7',skyBottom:'#e2e4d4',ambientColor:'#c2cbd0',sunColor:'#fff0ce',fogNear:65,fogFar:190};
  m.recommendedBots=15;
  m.park={x:0,z:0,w:72,d:18,pathWidth:3};
  m.spawns={'0':[-3,0,3].map(z=>({x:-115,y:0,z,yaw:0,team:0})),'1':[-3,0,3].map(z=>({x:115,y:0,z,yaw:180,team:1}))};
  const box=(x,y,z,w,h,d,t='wall',extra={})=>m.boxes.push({x,y,z,w,h,d,t,...extra});
  const tile=(meshName,x,y,z,w,h,d,rotY=0)=>m.tiles.push({meshName,x,y,z,rotY,scale:[w,h,d]});
  const nodes=new Map();
  const node=(id,p,kind='route')=>{if(!nodes.has(id)){const n={id,p,kind};nodes.set(id,n);m.bot_nav.nodes.push(n);}return id;};
  const edge=(a,b)=>{if(a!==b)m.bot_nav.edges.push([a,b]);};
  // Only five vehicular streets. The inner network is narrow pedestrian alleys.
  const roadsX=[-112,0,112],roadsZ=[-112,112];
  const lanesX=[-112,-74.5,-39.5,0,39.5,74.5,112],lanesZ=[-112,-90,-70,-50,-30,-10,10,30,50,70,90,112];
  const roads=[...new Set([...roadsX,...roadsZ])];
  const roadNode=(x,z)=>node(`street:${x},${z}`,[x,0,z]);
  for(const z of lanesZ)for(let i=1;i<lanesX.length;i++)edge(roadNode(lanesX[i-1],z),roadNode(lanesX[i],z));
  for(const x of lanesX)for(let i=1;i<lanesZ.length;i++)edge(roadNode(x,lanesZ[i-1]),roadNode(x,lanesZ[i]));
  function alleyAttach(p,line){
    const id=roadNode(p[0],line),lo=[...lanesX].reverse().find(v=>v<=p[0])??lanesX[0],hi=lanesX.find(v=>v>=p[0])??lanesX.at(-1);
    edge(id,roadNode(lo,line));edge(id,roadNode(hi,line));return id;
  }
  box(0,-.5,0,244,1,244,'ground');tile('courtyard',0,-.05,0,244,.02,244);
  const pairs=[],plots=[[-106,-76],[-73,-41],[-38,-6],[6,38],[41,73],[76,106]];
  let index=0;
  for(let cz=-100,row=0;cz<=100;cz+=20,row++)for(const [lo,hi]of plots){
    if(cz===0&&lo>=-38&&hi<=38)continue; // Central pocket park, not another block.
    const split=lo+(hi-lo)*(.45+rand()*.1),depth=14.4+rand()*2.6,sz=depth/12,duo=[];
    for(const [cx,width,side]of[[(lo+split)/2,split-lo,'e'],[(split+hi)/2,hi-split,'w']]){
      const stories=[1,2,3,2,4,3,1][index%7],source=generateCityTemplates((seed+index*7919)>>>0,stories),b=source.buildings[0],r=b.ranges;
      const sx=width/12,id=`block${index++}`,q=0;
      const P=p=>[cx+(p[0]-b.x)*sx,p[1],cz+(p[2]-b.z)*sz];
      const sharedX=b.x+(side==='e'?6:-6);
      for(const old of source.boxes.slice(r.begin.boxes,r.end.boxes)){
        if(old.t==='wall'&&Math.abs(old.x-sharedX)<1e-6)continue;
        const p=P([old.x,old.y,old.z]);m.boxes.push({...old,x:p[0],z:p[2],w:Math.min(old.w,12)*sx,d:old.d*sz,building:id});
      }
      const wall=['wall_solid','wall_brick','wall_stone','wall_ochre'][index%4];
      for(const old of source.tiles.slice(r.begin.tiles,r.end.tiles)){
        if(old.meshName==='wall_solid'&&Math.abs(old.x-sharedX)<1e-6)continue;
        const p=P([old.x,old.y,old.z]),turned=Math.abs(Math.sin(old.rotY))>.5;
        const scale=[Math.min(old.scale[0],12)*(turned?sz:sx),old.scale[1],old.scale[2]*(turned?sx:sz)];
        m.tiles.push({...old,meshName:old.meshName==='wall_solid'?wall:old.meshName,x:p[0],z:p[2],scale,
          tint:['#ffffff','#e9dfd1','#dce5de','#f0dfc4','#e0d9de','#e1e0d6'][(index+Math.floor(old.y/3))%6]});
      }
      const selected=source.bot_nav.nodes.slice(r.begin.nodes,r.end.nodes).filter(n=>n.id.startsWith(b.id+':')),names=new Set(selected.map(n=>n.id));
      for(const n of selected)node(id+':'+n.id.split(':').slice(1).join(':'),P(n.p),n.kind);
      for(const [a,e]of source.bot_nav.edges.slice(r.begin.edges,r.end.edges))if(names.has(a)&&names.has(e))edge(id+':'+a.split(':').slice(1).join(':'),id+':'+e.split(':').slice(1).join(':'));
      const doors=b.doors.map(d=>{const p=P([d.x,0,d.z]);return {...d,x:p[0],z:p[2],width:d.width*sx};});
      for(const [key,line]of[['northDoor',lanesZ[row]],['southDoor',lanesZ[row+1]]])edge(id+':'+key,alleyAttach(nodes.get(id+':'+key).p,line));
      const ramps=Array.from({length:stories-1},(_,i)=>({start:P([b.ramp.x,i*3,b.ramp.z0]),end:P([b.ramp.x,(i+1)*3,b.ramp.z1]),w:2.2*sx}));
      const openings=b.openings.filter(o=>o.side!==side).map(o=>{const p=P([o.x,o.y,o.z]);return {...o,x:p[0],y:p[1],z:p[2],width:o.width*(o.side==='n'||o.side==='s'?sx:sz)};});
      const nb={facadeStyle:b.facadeStyle,openings,id,x:cx,z:cz,w:width,d:depth,stories,storyHeight:3,height:stories*3+.2,scale:[sx,sz],variant:b.variant,type:['Apartment','Cafe','Office','Warehouse','Library','Lounge','Workshop','Vacant'][b.variant],doors,rooms:b.rooms.map(room=>{const p=P([room.x,room.y,room.z]);return{x:p[0],y:p[1],z:p[2]};}),ramp:ramps[0]||{start:P([b.ramp.x,0,b.ramp.z0]),end:P([b.ramp.x,3,b.ramp.z1]),w:2.2*sx},ramps,orientation:q,attachedSide:side};
      m.buildings.push(nb);duo.push(nb);
      for(const hole of source.floor_holes.filter(h=>h.building===b.id)){const hp=P([hole.x,hole.y,hole.z]);m.floor_holes.push({...hole,building:id,x:hp[0],z:hp[2],w:hole.w*sx,d:hole.d*sz});}
    }
    pairs.push(duo);
  }
  m.connections=[];
  for(const [left,right]of pairs){
    const x=left.x+left.w/2,z=left.z,d=left.d,sz=left.scale[1],common=Math.min(left.stories,right.stories),height=Math.max(left.stories,right.stories);
    const wall=(cz,y,depth,h)=>{box(x,y,cz,.28,h,depth,'wall',{partyWall:true});tile('wall_stone',x,y-h/2,cz,.28,h,depth);};
    for(let floor=0;floor<height;floor++){
      const y=floor*3,pattern=(seed+Number(left.id.slice(5))*7+floor*11)>>>0;
      const doorZ=z+[1.2,1.45,1.7][pattern%3]*sz,opening=[1.4,1.6,1.8][Math.floor(pattern/3)%3]*sz,doorHeight=[2.2,2.35,2.5][Math.floor(pattern/9)%3];
      if(floor>=common){wall(z,y+1.5,d,3);continue;}
      const lower=z-d/2,upper=z+d/2,a=doorZ-opening/2,b=doorZ+opening/2;
      wall((lower+a)/2,y+1.5,a-lower,3);wall((b+upper)/2,y+1.5,upper-b,3);wall(doorZ,y+(3+doorHeight)/2,opening,3-doorHeight);
      const Lkey=floor===0?'hall':floor===1?'landing':`L${floor}:landing`,Rkey=floor===0?'roomDoor':floor===1?'upperMid':`L${floor}:upperMid`;
      const hall=node(`${left.id}:partyHall${floor}`,[left.x+5.2*left.scale[0],y,z+3.7*sz]),aNode=node(`${left.id}:partyDoor${floor}`,[left.x+5.2*left.scale[0],y,doorZ]),bNode=node(`${right.id}:partyDoor${floor}`,[right.x-5*right.scale[0],y,doorZ]);
      // Turn toward the room door only after clearing the partition corner.
      // A diagonal from the party portal clips the jamb on narrower footprints.
      const approach=node(`${right.id}:partyHall${floor}`,[right.x-3*right.scale[0],y,doorZ]);
      edge(left.id+':'+Lkey,hall);edge(hall,aNode);edge(aNode,bNode);edge(bNode,approach);edge(approach,right.id+':'+Rkey);
      m.connections.push({a:left.id,b:right.id,x,z:doorZ,y,width:opening,height:doorHeight});
    }
  }
  // Continuous asphalt/cobblestone avenues, paved walks, grassy gardens and dirt yards.
  for(let x=-118;x<=118;x+=4)for(let z=-118;z<=118;z+=4){
    if(m.buildings.some(b=>Math.abs(x-b.x)<b.w/2+1&&Math.abs(z-b.z)<b.d/2+1))continue;
    const distance=Math.min(...roads.map(v=>Math.min(Math.abs(x-v),Math.abs(z-v))));
    if(Math.abs(x)<38&&Math.abs(z)<10)continue;
    const kind=Math.abs(x)<32&&Math.abs(z)<32?'street':distance<5?'pavement':distance<7?'pavement':((Math.floor((x+120)/30)+Math.floor((z+120)/30))%3===0?'dirt':'grass');
    tile(kind,x,-.025,z,4,.02,4);
  }
  // Asphalt is limited to the perimeter and one spine. Alley junctions get
  // curb cuts, not another full-width traffic road between every pair of houses.
  for(const axis of ['x','z'])for(const v of axis==='x'?roadsX:roadsZ){
    const put=(name,along,y,offset,w,h,d)=>{
      if(axis==='x'&&v===0&&along===0&&w===224){
        tile(name,offset,y,-62,d,h,100);tile(name,offset,y,62,d,h,100);return;
      }
      return axis==='x'?tile(name,v+offset,y,along,d,h,w):tile(name,along,y,v+offset,w,h,d);
    };
    put('asphalt',0,-.003,0,224,.008,6);
    for(const sign of[-1,1])put('pavement',0,-.001,sign*3.85,224,.006,1.7);
    const cuts=[...new Set(axis==='x'?[...lanesZ,-3,0,3]:[...lanesX,...m.buildings.filter(b=>Math.abs(b.z)===100).flatMap(b=>b.doors.map(d=>d.x))])].sort((a,b)=>a-b);
    for(let along=-109;along<110;along+=6){if(axis==='x'&&v===0&&Math.abs(along)<14)continue;if(cuts.some(r=>Math.abs(along-r)<3))continue;put('paint_yellow',along,.008,0,2.5,.004,.12);}
    for(let i=1;i<cuts.length;i++){
      const a=cuts[i-1]+2,b=cuts[i]-2,length=b-a;if(length<=0||axis==='x'&&v===0&&a<12&&b>-12)continue;
      for(const sign of[-1,1]){
        const x=axis==='x'?v+sign*3.12:(a+b)/2,z=axis==='x'?(a+b)/2:v+sign*3.12,w=axis==='x'?.2:length,d=axis==='x'?length:.2;
        box(x,.05,z,w,.1,d,'curb');tile('curb',x,0,z,w,.1,d);
      }
    }
  }
  for(const x of roadsX)for(const z of roadsZ){
    tile('asphalt',x,.005,z,6,.004,6);
    for(const sign of[-1,1])for(let offset=-2.1;offset<=2.2;offset+=.7){tile('paint_white',x+sign*5,.009,z+offset,1.7,.004,.35);tile('paint_white',x+offset,.010,z+sign*5,.35,.004,1.7);}
  }
  // Grass, intersecting accessible paths, varied vegetation and low rubble.
  tile('grass',0,-.009,0,72,.006,18);
  tile('park_path',0,.001,0,3,.004,18);
  tile('park_path',0,.002,0,72,.004,2.4);
  const centre=node('park:centre',[0,0,0]);
  edge(centre,roadNode(0,-10));edge(centre,roadNode(0,10));
  for(const sign of [-1,1]){
    const entry=node(`park:entry${sign}`,[sign*34,0,0]);edge(centre,entry);
    edge(entry,alleyAttach([sign*34,0,0],-10));edge(entry,alleyAttach([sign*34,0,0],10));
  }
  let parkTrees=0;
  for(const x of [-29,-21,-11,11,21,29])for(const sign of [-1,1]){
    const z=sign*5.8,h=4.2+(parkTrees%3)*.65;
    tile(['tree_birch','tree_oak','tree_autumn'][parkTrees%3],x,0,z,h*.55,h,h*.55,parkTrees*.7);
    box(x,1.2,z,.4,2.4,.4,'tree',{park:true});parkTrees++;
    tile(parkTrees%2?'flowers_patch':'fern',x+1.2,0,z-sign*.4,1.3,.45,1.1);
    tile('shrub',x-1.1,0,z+sign*.7,1.3,.8,1.1);
  }
  for(const x of [-17,17])for(const sign of [-1,1]){
    tile('bench',x,0,sign*5,2,.85,.65,sign<0?0:Math.PI);box(x,.425,sign*5,2,.85,.65,'cover',{park:true});
    tile('lamp',x+3,0,sign*6.8,.55,3.4,.55); // Emissive, no per-lamp shadow pass.
    tile('rubble',x-3,0,sign*7.5,1.4,.45,1.1);box(x-3,.225,sign*7.5,1.4,.45,1.1,'cover',{park:true});
  }
  m.park.trees=parkTrees;
  // Real uploaded canopies overlap the sidewalk, without lowering door clearance.
  for(const b of m.buildings){
    const d=b.doors[0],normal=({n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]})[d.side],x=d.x+normal[0]*.7,z=d.z+normal[1]*.7,turn=normal[0]!==0;
    const width=d.width+.9;
    tile('awning',x,2.68,z,width,.32,1.6,turn?Math.PI/2:0);
    box(x,2.94,z,turn?1.6:width,.12,turn?width:1.6,'cover');
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
  m.vehicleCounts={};
  // Yard walls create staggered, overlapping cover instead of isolated islands.
  for(const b of m.buildings)for(const sign of[-1,1])for(const axis of['x','z']){
    const x=b.x+(axis==='x'?sign*(b.w/2+1.0):sign*b.w*.18),z=b.z+(axis==='z'?sign*(b.d/2+1.0):-sign*b.d*.18);
    const w=axis==='x'?.4:Math.min(4.5,b.w*.35),d=axis==='z'?.4:Math.min(4.5,b.d*.35);
    if(!rectClear(x,z,w,d))continue;
    box(x,.53,z,w,1.06,d,'cover');tile('wall_stone',x,0,z,w,1.06,d);coverRuns++;
  }
  // Park in paired bays along the street edges; always leave door approaches open.
  for(const v of roadsX)for(let along=-100;along<=100;along+=10)for(const sign of[-1,1]){
    if(v===0||![-90,-30,30,90].includes(along)||sign!==(v<0?-1:1))continue;
    const at=v+sign*2.55,vertical=true;
    const kind=cityVehicle(parkedVehicles),size=CITY_VEHICLES[kind].size;
    const [vw,vh,vd]=size;
    const x=vertical?at:along,z=vertical?along:at,w=vertical?vw:vd,d=vertical?vd:vw;
    if(!rectClear(x,z,w,d))continue;
    // Both directions face along the curb. Wrecks retain their genuine width,
    // including opened bodywork, instead of stretching every model into a truck.
    const yaw=(vertical?0:Math.PI/2)+(sign>0?Math.PI:0);
    box(x,vh/2,z,w,vh,d,'cover',{vehicle:kind});tile(kind,x,0,z,vw,vh,vd,yaw);
    m.vehicleCounts[kind]=(m.vehicleCounts[kind]||0)+1;parkedVehicles++;
  }
  const clear=(x,z,r)=>{
    if(Math.abs(x)<38&&Math.abs(z)<10)return false; // Authored park, never random dumpsters/cars.
    if(Math.abs(x)>116||Math.abs(z)>116||Math.abs(z)<5&&Math.abs(x)>106)return false;
    if(m.buildings.some(b=>Math.abs(x-b.x)<b.w/2+r+.15&&Math.abs(z-b.z)<b.d/2+r+.15))return false;
    for(const [a,b]of m.bot_nav.edges){const p=nodes.get(a).p,q=nodes.get(b).p;if(p[1]>.1||q[1]>.1)continue;const dx=q[0]-p[0],dz=q[2]-p[2],t=Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[2])*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(x-p[0]-t*dx,z-p[2]-t*dz)<r+.8)return false;}
    return !m.boxes.some(b=>b.t!=='ground'&&b.t!=='curb'&&Math.abs(x-b.x)<b.w/2+r&&Math.abs(z-b.z)<b.d/2+r);
  };
  // All the uploaded asset collections contribute: street kit, house/interiors,
  // old trees, and the new 150-mesh vegetation collection. Foliage is decorative;
  // tree trunks and solid street furniture have explicit AABB collision.
  const decor=['tree_oak','tree_pine','tree_birch','tree_autumn','tree_dead','shrub','berries','fern','flowers_patch','tree_park','tree_small','bush_kit','bench','dumpster','barrier','pallet','rubble','lamp','planter','planter'];
  let placed=0;
  for(let i=0;i<8000&&placed<240;i++){
    const x=-114+rand()*228,z=-114+rand()*228,k=decor[placed%decor.length],tree=k.startsWith('tree'),solid=tree||['bench','dumpster','barrier','pallet','rubble','truck','planter'].includes(k),r=tree?.6:k==='lamp'?.35:k==='bench'?1.05:k==='planter'?1.3:solid?.9:.4;
    if(!clear(x,z,r))continue;
    const h=tree?4+rand()*4:k==='truck'?2.8:k==='planter'?.18:k==='lamp'?4.5:k==='dumpster'?1.45:k==='bench'?.9:.45+rand()*.6;
    const w=k==='truck'?2.2:k==='planter'?2.5:tree?h*.55:k==='bench'?2:k==='lamp'?.6:1.5,d=k==='truck'?5.8:k==='planter'?2.5:tree?w:k==='bench'?.6:1.2;
    const yaw=Math.floor(rand()*4)*Math.PI/2;
    tile(k,x,0,z,w,h,d,yaw);
    if(solid){if(tree)box(x,1.2,z,.4,2.4,.4,'tree');else box(x,h/2,z,Math.abs(Math.sin(yaw))>.5?d:w,h,Math.abs(Math.sin(yaw))>.5?w:d,'cover');}
    placed++;
  }
  for(const [x,z,w,d]of [[-120.3,0,.6,241],[120.3,0,.6,241],[0,-120.3,241,.6],[0,120.3,241,.6]]){box(x,1.25,z,w,2.5,d);tile('wall_stone',x,0,z,w,2.5,d);}
  for(const x of [-112,112]){edge(roadNode(x,0),roadNode(x,-10));edge(roadNode(x,0),roadNode(x,10));}
  for(const team of ['0','1'])for(const p of m.spawns[team])edge(node(`spawn:${team}:${p.z}`,[p.x,0,p.z]),roadNode(team==='0'?-112:112,0));
  m.navPoints=m.bot_nav.nodes.map(n=>({x:n.p[0],y:n.p[1],z:n.p[2]}));
  m.districts=pairs.length;m.connectedPairs=pairs.length;m.roadsX=roadsX;m.roadsZ=roadsZ;m.footprintCoverage=m.buildings.reduce((a,b)=>a+b.w*b.d,0)/(240*240);m.vegetationAndStreetProps=placed;m.coverRuns=coverRuns;m.parkedVehicles=parkedVehicles;m.roads=roads;return m;
}
