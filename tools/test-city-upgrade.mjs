import assert from 'node:assert/strict';
export async function testCityUpgrade(context,origin){
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/__harness.html');
  const result=await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js'),{World}=await import('/js/map.js');
    const map=await(await fetch('/shared/maps/proc_city.json')).json(),data=await(await fetch('/shared/weapons.json')).json();
    const scene=new T.Scene(),renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(1100,750);renderer.setPixelRatio(.8);
    const pending=World.create(scene,map,data.combat,renderer);
    renderer.render(scene,new T.PerspectiveCamera(65,1,.06,400));
    const world=await pending,city=world.group.getObjectByName('proc-city'),kit=new Map(city.children.map(m=>[m.userData.asset,m]));
    const lamp=world.group.children.find(o=>o.isDirectionalLight&&o.castShadow);
    if(!lamp?.shadow.needsUpdate)throw Error('Loading-frame shadow was not invalidated');
    const details=city.children.filter(m=>/^(chandelier|ceiling_trim|painting_|wall_lamp|flowers$|rug)/.test(m.userData.asset));
    if(details.length!==city.userData.detailBatches||details.length<32)throw Error('Decorative LOD missing');
    city.userData.updateDetail(new T.Vector3(10000,10000,10000),true);
    if(details.some(m=>m.visible)||city.children.some(m=>!details.includes(m)&&!m.visible))throw Error('LOD hid physical cover or failed to hide distant ornaments');
    const detail=details[0],sphere=detail.boundingSphere;
    for(const [distance,visible]of [[49,true],[55,true],[61,false],[55,false],[49,true]]){
      city.userData.updateDetail(sphere.center.clone().add(new T.Vector3(sphere.radius+distance,0,0)),true);
      if(detail.visible!==visible)throw Error('Decorative LOD hysteresis flickers');
    }
    const camera=new T.PerspectiveCamera(65,1100/750,.06,400);camera.position.set(70,100,100);camera.lookAt(0,0,0);
    city.userData.updateDetail(camera.position,true);
    renderer.render(scene,camera);renderer.render(scene,camera);
    const sun=world.group.children.find(o=>o.isDirectionalLight&&o.castShadow);
    if(!sun||sun.shadow.autoUpdate!==false||sun.shadow.needsUpdate)throw Error('Static shadow pass repeats');
    const count=Object.values(map.vehicleCounts).reduce((s,n)=>s+n,0);if(count!==8)throw Error('Too many parked vehicles');
    const oldCounts={parked_truck:14,truck_green:13,truck_flat:14,truck_cargo:12,car_crashed:2,car_abandoned:26,car_f1:1};
    let oldTriangles=0,newTriangles=0;
    for(const [key,n]of Object.entries(oldCounts)){const tri=kit.get(key).geometry.index.count/3;oldTriangles+=tri*n;newTriangles+=tri*(map.vehicleCounts[key]||0);}
    if(newTriangles>=oldTriangles*.6)throw Error('Detailed vehicle triangle budget did not improve');
    if(!city.children.every(m=>m.isInstancedMesh&&m.instanceColor))throw Error('Tinted instancing lost');
    const treeBatches=city.children.filter(m=>m.userData.asset?.startsWith('tree_'));
    if(!treeBatches.length||!treeBatches.some(m=>m.name.includes('@')))throw Error('Vegetation cannot cull locally');
    for(const mesh of treeBatches){const size=mesh.boundingBox.getSize(new T.Vector3());if(size.x>85||size.z>85)throw Error('Tree batch has map-sized bounds');}
    if(new Set(map.tiles.filter(t=>t.meshName.startsWith('wall_')).map(t=>t.tint)).size<5)throw Error('Building surface tints repeat');
    if(!kit.get('park_path')?.material.map)throw Error('Park path texture missing');
    if(map.park.x!==0||map.park.z!==0||map.park.trees<10)throw Error('Central park missing');
    // Compare identical geometry/materials using local batches vs the former
    // one-map-sized-batch-per-alias layout. This is a culling budget, not FPS.
    const overview={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    camera.position.set(0,1.65,2);camera.lookAt(0,1.6,-60);city.userData.updateDetail(camera.position,true);renderer.render(scene,camera);
    const local={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    const global=new T.Group(),groups=new Map(),matrix=new T.Matrix4(),color=new T.Color();
    for(const mesh of city.children){const name=mesh.userData.asset;if(!groups.has(name))groups.set(name,[]);groups.get(name).push(mesh);}
    for(const meshes of groups.values()){
      const mesh=new T.InstancedMesh(meshes[0].geometry,meshes[0].material,meshes.reduce((n,m)=>n+m.count,0));let offset=0;
      for(const source of meshes)for(let i=0;i<source.count;i++){source.getMatrixAt(i,matrix);source.getColorAt(i,color);mesh.setMatrixAt(offset,matrix);mesh.setColorAt(offset++,color);}
      mesh.computeBoundingBox();mesh.computeBoundingSphere();global.add(mesh);
    }
    city.visible=false;world.group.add(global);renderer.render(scene,camera);
    const oldGlobal={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    if(local.triangles>=oldGlobal.triangles*.75)throw Error('Spatial batching does not reduce submitted geometry');
    world.group.remove(global);for(const mesh of global.children)mesh.dispose();city.visible=true;camera.position.set(50,65,85);camera.lookAt(0,0,0);city.userData.updateDetail(camera.position,true);renderer.render(scene,camera);
    window.cityUpgrade={world,renderer,scene,camera};
    const costly=[...groups].map(([name,meshes])=>[name,meshes.reduce((sum,m)=>sum+(m.geometry.index?.count||m.geometry.attributes.position.count)/3*m.count,0)]).sort((a,b)=>b[1]-a[1]).slice(0,10);
    return {detailBatches:details.length,costly,overview,local,oldGlobal,instances:city.userData.instances,batches:city.userData.batches,aliases:city.userData.aliases,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,newVehicleTriangles:newTriangles,oldVehicleTriangles:oldTriangles,vehicles:count,park:map.park,treeBatches:treeBatches.length};
  });
  if(process.env.CITY_UPGRADE_SCREENSHOT)await page.screenshot({path:process.env.CITY_UPGRADE_SCREENSHOT});
  assert.deepEqual(errors,[]);await page.evaluate(()=>{cityUpgrade.world.dispose();cityUpgrade.renderer.dispose();cityUpgrade.renderer.forceContextLoss();});await page.close();console.log('PASS: rendered park, varied textures/tints, static lighting and spatial culling',result);return result;
}
