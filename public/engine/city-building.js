// Pure deterministic map authoring. No DOM, npm, clock or Math.random.
// The checked-in JSON is the SAME artifact consumed by Python and Pyodide.
export function generateCityTemplates(seed=1942,stories=2) {
  if(!Number.isInteger(seed))throw new TypeError('City seed must be an integer');
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const m={id:'proc_city',name:'程序化旧城',nameEn:'Procedural City',seed:seed>>>0,generatorVersion:1,
    bounds:{minX:-30,maxX:30,minZ:-30,maxZ:30},groundY:0,
    style:{skyTop:'#7094b5',skyBottom:'#ccd7dd',fog:'#bec9ca',fogNear:42,fogFar:125,sunColor:'#fff1d5',ambientColor:'#aabed0',mud:'#77776c'},
    skybox:'/models/maps/Skyboxes/skybox-day.png',procedural:'proc_city',
    spawns:{'0':[-3,0,3].map(z=>({x:-27,y:0,z,yaw:0,team:0})), '1':[-3,0,3].map(z=>({x:27,y:0,z,yaw:180,team:1}))},
    boxes:[],tiles:[],buildings:[],floor_holes:[],navPoints:[],bot_nav:{nodes:[],edges:[]},decor:[]};
  const box=(x,y,z,w,h,d,t='wall',extra={})=>{const b={x,y,z,w,h,d,t,...extra};m.boxes.push(b);return b;};
  const tile=(meshName,x,y,z,w,h,d,rotY=0)=>m.tiles.push({meshName,x,y,z,rotY,scale:[w,h,d]});
  const solid=(x,y,z,w,h,d,kind='wall')=>{box(x,y,z,w,h,d,kind);tile(kind==='floor'?'floor':'wall_solid',x,y-h/2,z,w,h,d);};
  const node=(id,x,y,z,kind='route')=>{m.bot_nav.nodes.push({id,p:[x,y,z],kind});return id;};
  const edge=(a,b)=>m.bot_nav.edges.push([a,b]);
  const outdoor=new Map();
  function street(x,z){const k=x+','+z;if(!outdoor.has(k))outdoor.set(k,node('street:'+k,x,0,z));return outdoor.get(k);}
  for(const z of [-24,0,24]){let prev;for(const x of [-27,-24,-18,-10,0,10,18,24,27]){const n=street(x,z);if(prev)edge(prev,n);prev=n;}}
  for(const x of [-24,0,24]){edge(street(x,-24),street(x,0));edge(street(x,0),street(x,24));}
  box(0,-.5,0,64,1,64,'ground');tile('courtyard',0,-.04,0,64,.02,64);
  for(let x=-28;x<=28;x+=4)for(let z=-28;z<=28;z+=4)if(Math.abs(x)<=4||Math.abs(z)<=4||Math.abs(x)>=24||Math.abs(z)>=24)tile('street',x,-.02,z,4,.02,4);
  // Perimeter prevents stepping off the authored world; spawn lanes remain clear.
  solid(-30.3,1.25,0,.6,2.5,61);solid(30.3,1.25,0,.6,2.5,61);
  solid(0,1.25,-30.3,61,2.5,.6);solid(0,1.25,30.3,61,2.5,.6);
  let bi=0;
  const count=2+Math.floor(random()*3);
  for(const [cx,cz]of [[-14,-14],[14,14],[-14,14],[14,-14]].slice(0,count)){
    const id='house'+bi++,prefix=id+':';
    const begin={boxes:m.boxes.length,tiles:m.tiles.length,nodes:m.bot_nav.nodes.length,edges:m.bot_nav.edges.length};
    const variant=(seed>>>0)%4;
    const b={id,variant,x:cx,z:cz,w:12,d:12,stories,storyHeight:3,doors:[],ramp:{x:cx+3,z:cz-.5,z0:cz-3.5,z1:cz+2.5,w:2.2},rooms:[]};m.buildings.push(b);
    const S=(x,y,z,w,h,d,kind)=>solid(cx+x,y,cz+z,w,h,d,kind);
    // 4 m facade modules, 3 m stories. Door/window geometry is split into jambs,
    // sill and lintel: neither rendering nor collision bridges an opening.
    for(const y of (stories===1?[0]:[0,3]))for(const side of ['n','s','e','w'])for(const c of [-4,0,4]){
      const door=y===0&&(side==='n'||side==='s')&&c===-4;
      const win=!door&&(y===3||c!==0);
      const wall=(u,v,width,height)=>{
        if(side==='n'||side==='s')S(u,y+v,side==='n'?-6:6,width,height,.24);
        else S(side==='w'?-6:6,y+v,u,.24,height,width);
      };
      if(door||win){
        const opening=door?1.8:2.2,lo=door?0:1.05,hi=door?2.5:2.5,jamb=(4-opening)/2;
        wall(c-(opening+jamb)/2,1.5,jamb,3);wall(c+(opening+jamb)/2,1.5,jamb,3);
        if(lo)wall(c,lo/2,opening,lo);
        wall(c,(hi+3)/2,opening,3-hi);
        if(door)b.doors.push({x:cx+c,y:0,z:cz+(side==='n'?-6:6),width:opening,height:hi,side});
      }else wall(c,1.5,4,3);
    }
    // Ground floor is at zero. Slab top at Y=3; the entire flight stays open.
    S(0,-.1,0,12,.2,12,'floor');
    if(stories>1){
    S(-2.25,2.9,0,7.5,.2,12,'floor');S(5.25,2.9,0,1.5,.2,12,'floor');
    S(3,2.9,-5.25,3,.2,1.5,'floor');S(3,2.9,4.25,3,.2,3.5,'floor');
    m.floor_holes.push({building:id,x:cx+3,z:cz-1,w:3,d:7,y:3});
    }
    S(0,stories*3+.1,0,12.3,.2,12.3,'floor');
    // Two left rooms plus stair hall on both floors; 1.8 m partition doors.
    for(const y of (stories===1?[0]:[0,3])){
      const doorZ=y===0?3:4;
      for(const [a,e]of [[-6,doorZ-.9],[doorZ+.9,6]])if(e>a)S(0,y+1.5,(a+e)/2,.2,3,e-a);
      S(0,y+2.75,doorZ,.2,.5,1.8);
      if(!((variant===1&&y===0)||(variant===2&&y===3)||variant===3)){S(-4.95,y+1.5,0,2.1,3,.2);S(-1.05,y+1.5,0,2.1,3,.2);S(-3,y+2.75,0,1.8,.5,.2);}
      for(const rz of [-3,3]){
        b.rooms.push({x:cx-3,y,z:cz+rz});
        const tableW=1.6+Math.floor(random()*3)*.1;
        box(cx-4.5,y+.475,cz+rz,tableW,.95,1,'cover');tile(['table','coffee','sofa','table'][variant],cx-4.5,y,cz+rz,tableW,.95,1);
        box(cx-5.35,y+1.1,cz+rz+1.25,1,2.2,.55,'cover');tile(variant===3?'cabinet_wide':'cabinet',cx-5.35,y,cz+rz+1.25,1,2.2,.55);
        if(variant!==3)tile('rug',cx-2.5,y+.012,cz+rz,2.4,.018,2.2);
        if(variant===3)tile('flowers',cx-5.55,y,cz+rz-.7,.35,.8,.35);
        else tile(['painting_a','painting_b','wall_lamp'][variant],cx-5.75,y+.9,cz+rz,.7,.8,.12,Math.PI/2);
        tile(variant===2?'ceiling_trim':'chandelier',cx-3,y+2.35,cz+rz,.6,.55,.6);
      }
      b.rooms.push({x:cx+5,y,z:cz+(y===0?-4:4.5)});
      const rz=y===0?-4:4.5;
      box(cx+5.35,y+.5,cz+rz,.35,1,1.3,'cover');tile('radiator',cx+5.35,y,cz+rz,1.3,1,.35,Math.PI/2);
    }
    if(stories>1){
    box(cx+3,1.5,cz-.5,2.2,3,6,'ramp',{ax:'z',y0:0,y1:3});
    // Visual treads only; one smooth wedge is the sole staircase collider.
    for(let step=0;step<18;step++)tile('stair_tread',cx+3,(step+1)/6-.08,cz-3.5+(step+.5)/3,2.2,.08,1/3);
    // Upper well guard rails, never across the entry/exit of the flight.
    for(const x of [1.5,4.5]){box(cx+x,3.5,cz-1,.10,1,7,'cover');tile('rail',cx+x,3,cz-1,.10,1,7);}
    }
    const N=(key,x,y,z,kind)=>node(prefix+key,cx+x,y,cz+z,kind);
    const dn=N('northDoor',-4,0,-7),rn=N('northRoom',-3,0,-3),rm=N('roomDoor',-3,0,0),rs=N('southRoom',-3,0,3),ds=N('southDoor',-4,0,7);
    edge(dn,rn);edge(rn,rm);edge(rm,rs);edge(rs,ds);
    for(const [n,z]of [[dn,cz-7],[ds,cz+7]]){
      const line=Math.abs(z)<14?0:Math.sign(z)*24;
      edge(n,street(cx-4,line));edge(street(cx-4,line),street(0,line));
    }
    const hall=N('hall',1,0,3),entry=N('entry',1,0,-4.4),start=N('stairStart',3,0,-4.4),foot=N('stairFoot',3,0,-3.5);
    edge(rs,hall);edge(hall,entry);edge(entry,start);edge(start,foot);
    if(stories>1){
    let prev=foot;
    for(let k=1;k<=12;k++){const n=N('ramp'+k,3,k/4,-3.5+k/2);edge(prev,n);prev=n;}
    const landing=N('landing',3,3,3.7),upperDoor=N('upperDoor',-1,3,4),upperSouth=N('upperSouth',-3,3,3),upperMid=N('upperMid',-3,3,0),upperNorth=N('upperNorth',-3,3,-3),look=N('lookout',-3,3,-4.8,'lookout');
    edge(prev,landing);edge(landing,upperDoor);edge(upperDoor,upperSouth);edge(upperSouth,upperMid);edge(upperMid,upperNorth);edge(upperNorth,look);
    }
    b.ranges={begin,end:{boxes:m.boxes.length,tiles:m.tiles.length,nodes:m.bot_nav.nodes.length,edges:m.bot_nav.edges.length}};
  }
  // Seeded cover never crosses the graph's street centre lines or spawn runouts.
  for(const [x,z]of [[-5,-5],[5,5],[-5,5],[5,-5],[-22,-10],[22,10]]){
    const w=1.5+Math.floor(random()*3)*.25;
    box(x,.5,z,w,1,.7,'cover');tile('barrier',x,0,z,w,1,.7,random()>.5?0:Math.PI);
  }
  m.navPoints=m.bot_nav.nodes.map(n=>({x:n.p[0],y:n.p[1],z:n.p[2]}));
  return m;
}
