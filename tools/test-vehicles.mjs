import assert from 'node:assert/strict';

export async function testVehicles(context, origin) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/__harness.html');
  const result = await page.evaluate(async () => {
    const T = await import('/vendor/three.module.js');
    const { CITY_VEHICLES } = await import('/engine/vehicles.js');
    const { extractCityKit, buildProcCity } = await import('/js/proc-city.js');
    const kit = await extractCityKit();
    const map = await (await fetch('/shared/maps/proc_city.json')).json();
    const tiles = map.tiles.filter(t => CITY_VEHICLES[t.meshName]);
    if (tiles.length !== map.parkedVehicles) throw Error('Vehicle count disagrees with shared map');
    if (Object.keys(map.vehicleCounts).length !== 7) throw Error('Vehicle variety missing');
    const models = [];
    for (const [name, spec] of Object.entries(CITY_VEHICLES)) {
      const mesh = kit.get(name);
      if (!mesh?.geometry.index?.count) throw Error(`${name}: uploaded model missing`);
      const g = mesh.geometry, count = g.index.count;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (g.groups.reduce((sum,v) => sum+v.count,0) !== count) throw Error(`${name}: merged material groups lost triangles`);
      if (g.groups.length > materials.length) throw Error(`${name}: materials not batched`);
      if (!g.hasAttribute('normal') || !g.hasAttribute('uv')) throw Error(`${name}: incompatible merged attributes`);
      g.computeBoundingBox();
      const bounds = g.boundingBox;
      if (bounds.min.distanceTo(new T.Vector3(-.5,0,-.5)) > 1e-4 || bounds.max.distanceTo(new T.Vector3(.5,1,.5)) > 1e-4) throw Error(`${name}: normalized origin/bounds wrong`);
      models.push({ name, triangles:count/3, draws:g.groups.length, instances:map.vehicleCounts[name] });
    }
    for (const tile of tiles) {
      const box = map.boxes.find(b => b.vehicle === tile.meshName && b.x === tile.x && b.z === tile.z);
      if (!box) throw Error('Vehicle has no authoritative cover collider');
      const [w,h,d] = CITY_VEHICLES[tile.meshName].size;
      if (Math.abs(box.w-w)>1e-5 || Math.abs(box.h-h)>1e-5 || Math.abs(box.d-d)>1e-5 || box.y !== h/2) throw Error('Vehicle visual/cover dimensions disagree');
    }
    const scene = new T.Scene(); scene.background = new T.Color(0x8497a7);
    const renderer = new T.WebGLRenderer({ antialias:true }); renderer.setSize(1000,700); renderer.setPixelRatio(.6); document.body.appendChild(renderer.domElement);
    scene.add(new T.HemisphereLight(0xe8f2ff,0x665c48,3));
    const sun = new T.DirectionalLight(0xffffff,3); sun.position.set(4,8,6); scene.add(sun);
    const ground = new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:0x77776c,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.02;scene.add(ground);
    const camera = new T.PerspectiveCamera(50,1000/700,.06,60);camera.position.set(7,4.5,7);camera.lookAt(0,.8,0);
    const preview = name => {
      scene.getObjectByName('vehicle-preview')?.removeFromParent();
      const mesh = kit.get(name).clone(); mesh.name='vehicle-preview'; mesh.scale.fromArray(CITY_VEHICLES[name].size);scene.add(mesh);renderer.render(scene,camera);
      if (renderer.info.render.triangles <= 2) throw Error('Uploaded car was not actually drawn');
    };
    preview('car_crashed');
    window.vehiclePreview = { preview, renderer, scene, camera };
    // Exercise actual instancing too, without allocating/rendering a second city.
    const instancedScene = new T.Scene(), city = buildProcCity(instancedScene,{tiles},kit);
    if (city.children.length !== 7 || city.children.some(m => !m.isInstancedMesh)) throw Error('Parked cars lost batching');
    return { models, vehicles:tiles.length };
  });
  for (const name of ['car_crashed','car_abandoned','car_f1']) {
    await page.evaluate(name => vehiclePreview.preview(name), name);
    if (process.env.VEHICLE_SCREENSHOT_DIR) await page.screenshot({ path:process.env.VEHICLE_SCREENSHOT_DIR+'/'+name+'.png' });
  }
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS: uploaded vehicle rendering, normalized proportions, material batching, all 82 cover colliders', result);
  return result;
}
