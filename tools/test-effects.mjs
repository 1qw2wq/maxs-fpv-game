// Invoked by test-vercel.mjs using its static server/browser. No game backend.
import assert from 'node:assert/strict';
import { testLiveArsenal } from './test-arsenal.mjs';
import { testLiveCamera } from './test-camera.mjs';
import { testLiveGrenades } from './test-grenades.mjs';
import { testLiveSurvival } from './test-survival.mjs';
import { testLiveWeaponHold } from './test-live-weapon-hold.mjs';
export async function testEffects(context, origin) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/__harness.html');
  const result = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { ViewModel } = await import('/js/viewmodel.js');
    const { gripRotation, gloveWrist } = await import('/js/handpose.js');
    const { createGirl } = await import('/js/character.js');
    const { GunFx } = await import('/js/gunfx.js');
    const { weaponSockets, mountedGrips, reloadPose } = await import('/js/weaponpose.js');
    const { buildSmokeCloud, updateSmokeCloud, smokeDensity } = await import('/js/smoke.js');
    const data = await (await fetch('/shared/weapons.json')).json();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(78, 4 / 3, 0.06, 100);
    camera.position.set(2, 1.6, -3);
    camera.rotation.set(0.05, 0.3, 0.01);
    scene.add(camera);
    const vm = new ViewModel(data);
    vm.setClass(data.classes[0]);
    camera.add(vm.root);
    const hand = new THREE.Vector3(), fore = new THREE.Vector3(), muzzle = new THREE.Vector3(), eject = new THREE.Vector3();
    const byClass = Object.fromEntries(data.classes.map((cls) => [cls.id, data.weapons.filter((w) => w.class === cls.id)]));
    const girl = createGirl(data.classes[0], data.teams[0], { weaponsByClass: byClass, teamById: Object.fromEntries(data.teams.map((t) => [t.id, t])) });
    scene.add(girl.root);
    girl.root.position.set(3, 0, 1);
    let maxPalmError = 0, maxThirdPersonError = 0, checked = 0;
    for (const weapon of data.weapons) {
      vm.setWeapon(weapon);
      await vm.gunMeshes.userData.modelReady;
      if (vm.gunMeshes.children.filter((c) => c.isGroup).length !== 1) throw new Error(`${weapon.id}: imported model missing`);
      for (const key of ['hand', 'fore', 'reload', 'eject']) {
        if (vm.anchors[key].parent !== vm.gunMeshes) throw new Error(`${weapon.id}: ${key} socket lost during model swap`);
      }
      const model = vm.gunMeshes.children.find((c) => c.isGroup);
      // Compare barrel tip in normalized gun space, not world/camera space.
      vm.gunMeshes.updateWorldMatrix(true, true);
      const inverse = new THREE.Matrix4().copy(vm.gunMeshes.matrixWorld).invert();
      model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3();
      const point = new THREE.Vector3();
      model.traverse((mesh) => {
        const positions = mesh.isMesh && mesh.geometry?.attributes.position;
        if (!positions) return;
        const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        for (let i = 0; i < positions.count; i++) bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(matrix));
      });
      if (Math.abs(vm.muzzle.position.z - bounds.max.z - 0.005) > 0.001) throw new Error(`${weapon.id}: barrel tip is not calibrated`);
      girl.setWeapon(weapon);
      girl.update(1 / 60, { speed: 2, crouch: true, pitch: 15 });
      girl.root.updateMatrixWorld(true);
      for (const [side, socket] of [['R', 'hand'], ['L', 'fore']]) {
        const wrist = girl.root.getObjectByName(`wrist-${side}`).getWorldPosition(new THREE.Vector3());
        const socketNode = girl.root.getObjectByName(`weapon-${socket}`);
        const rotation = gripRotation(socketNode.getWorldQuaternion(new THREE.Quaternion()), side);
        const target = gloveWrist(socketNode.getWorldPosition(new THREE.Vector3()), rotation);
        const wristNode = girl.root.getObjectByName(`wrist-${side}`);
        if (wristNode.getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation) > 1e-6) throw new Error(`${weapon.id}: third-person wrist twist`);
        maxThirdPersonError = Math.max(maxThirdPersonError, wrist.distanceTo(target));
        if (wrist.distanceTo(target) > 0.07) throw new Error(`${weapon.id}: third-person wrist misses grip`);
      }
      // These must be real mesh contacts, not arbitrary empty anchor nodes.
      // Shoot upward from below the fore-end: the palm sits 13mm below that
      // surface, its padded glove touching it instead of floating in midair.
      const support = weaponSockets(weapon).fore;
      const ray = new THREE.Raycaster(new THREE.Vector3(support[0], bounds.min.y - 0.1, support[2]), new THREE.Vector3(0, 1, 0));
      model.updateWorldMatrix(true, true);
      const origin = ray.ray.origin.clone().applyMatrix4(vm.gunMeshes.matrixWorld);
      const direction = ray.ray.direction.clone().transformDirection(vm.gunMeshes.matrixWorld);
      ray.set(origin, direction);
      const hit = ray.intersectObject(model, true)[0];
      if (!hit) throw new Error(`${weapon.id}: support grip misses gun geometry`);
      const surface = hit.point.clone().applyMatrix4(inverse);
      if (Math.abs(surface.y - support[1]) > 0.025) throw new Error(`${weapon.id}: support palm floats off handguard`);
      const sockets = weaponSockets(weapon), mounted = mountedGrips(weapon);
      if (Math.abs(mounted.hand[2] - sockets.hand[2] - 0.06) > 1e-8) throw new Error('FP/TP grip frame mismatch');
      for (const phase of ['hip', 'ads', 'recoil', 'reload-start', 'reload-service', 'reload-seat', 'reload-end']) {
        vm.syncReload(2500, 0, false);
        vm.recoil = vm.recoilRot = 0;
        if (phase === 'recoil') vm.kick(1);
        if (phase.startsWith('reload')) {
          const p = { 'reload-start': 0, 'reload-service': 0.48, 'reload-seat': 0.74, 'reload-end': 0.999 }[phase];
          vm.syncReload(2500, 2500 * (1 - p), true);
        }
        vm.update(0, { ads: phase === 'ads', sprinting: false, moveSpeed: 2 });
        // Force full ADS to test the endpoint, not just an initial interpolation.
        if (phase === 'ads') { vm.ads = 1; vm.update(0, { ads: true, moveSpeed: 0 }); }
        vm.gripWorld(hand, fore);
        for (const rig of vm.armRigs) {
          const actual = rig.palm.getWorldPosition(new THREE.Vector3());
          const error = actual.distanceTo(rig.side === 1 ? hand : fore);
          maxPalmError = Math.max(maxPalmError, error);
          if (error > 1e-6) throw new Error(`${weapon.id}/${phase}: palm drift ${error}`);
          const expected = gripRotation(vm.gunMeshes.getWorldQuaternion(new THREE.Quaternion()), rig.side === 1 ? 'R' : 'L');
          if (rig.palm.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected) > 1e-6) throw new Error(`${weapon.id}/${phase}: glove faces away from grip`);
          for (let i = 0; i < 4; i++) if (!rig.palm.getObjectByName(`finger-${i}-2`)) throw new Error('Missing curled glove finger');
          if (!rig.palm.getObjectByName('thumb')) throw new Error('Missing opposed thumb');
          const wrist = gloveWrist(actual, expected);
          const tip = new THREE.Vector3(0, 0.5, 0).applyMatrix4(rig.fore.matrixWorld);
          if (Math.min(tip.distanceTo(wrist), new THREE.Vector3(0, -0.5, 0).applyMatrix4(rig.fore.matrixWorld).distanceTo(wrist)) > 1e-6) throw new Error('Sleeve ends in palm, not wrist');
        }
        vm.shotWorld(muzzle, eject);
        if (![...muzzle.toArray(), ...eject.toArray()].every(Number.isFinite)) throw new Error('Nonfinite shot socket');
        checked++;
      }
    }
    for (const p of [0, 1]) {
      const pose = reloadPose(p);
      if (pose.present !== 0 || pose.reach !== 0 || pose.service !== 0) throw new Error('Reload endpoint snaps');
    }
    vm.syncReload(2500, 1300, true);
    vm.syncReload(2500, 0, false);
    if (vm.reloadT !== -1) throw new Error('Interrupted reload keeps animating');
    vm.setWeapon(data.weapons[0]);
    await vm.gunMeshes.userData.modelReady;
    vm.update(0, { ads: false, moveSpeed: 0 });
    const preKick = vm.muzzle.getWorldPosition(new THREE.Vector3()).y;
    vm.kick(1); vm.update(0, { ads: false, moveSpeed: 0 });
    if (vm.muzzle.getWorldPosition(new THREE.Vector3()).y <= preKick) throw new Error('Recoil drives barrel down');
    const group = new THREE.Group(); scene.add(group);
    const fx = new GunFx({ group, scene });
    vm.shotWorld(muzzle, eject);
    fx.fire(data.weapons[0], muzzle, vm.muzzle.getWorldDirection(new THREE.Vector3()), { eject, attachment: vm.muzzle });
    if (fx.flashes[0].mat.opacity !== 1) throw new Error('Reused flash starts invisible');
    camera.position.x += 0.5;
    vm.update(0.01, { ads: false, moveSpeed: 0 });
    fx.update(0.01);
    vm.shotWorld(muzzle, eject);
    if (fx.flashes[0].meshes[0].position.distanceTo(muzzle) > 1e-6) throw new Error('Flash detaches from animated muzzle');
    const ejection = fx.casings[0].mesh.position.clone();
    if (ejection.distanceTo(eject) > 0.7) throw new Error('Brass ejected from barrel instead of receiver');
    fx.dispose();
    const a = { ...buildSmokeCloud({ eid: 41, p: [0, 0, 0], r: 13, dur: 14000 }), dur: 14000 };
    const b = { ...buildSmokeCloud({ eid: 41, p: [0, 0, 0], r: 13, dur: 14000 }), dur: 14000 };
    for (let t = 0; t <= 5000; t += 1000 / 30) updateSmokeCloud(a, t);
    updateSmokeCloud(a, 5000); updateSmokeCloud(b, 5000);
    if (a.puffs.length !== 36) throw new Error('Unbounded smoke card budget');
    for (let i = 0; i < a.puffs.length; i++) {
      if (a.puffs[i].sprite.position.distanceTo(b.puffs[i].sprite.position) > 1e-8) throw new Error('Smoke differs by frame rate or client');
    }
    if (smokeDensity(0, 14000) !== 0 || smokeDensity(1000, 14000) !== 1 || smokeDensity(14000, 14000) !== 0) throw new Error('Smoke lifetime mismatch');
    if (!(smokeDensity(13000, 14000) < smokeDensity(12000, 14000))) throw new Error('No smoke dissipation');
    // Render one actual model with the new arms and a fully deployed smoke cloud.
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
    renderer.setSize(800, 600);
    scene.background = new THREE.Color(0x718493);
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x665849, 3));
    const sun = new THREE.DirectionalLight(0xffffff, 4); sun.position.set(3, 5, 2); scene.add(sun);
    camera.position.set(0, 1.6, 4); camera.rotation.set(0, 0, 0);
    vm.recoil = vm.recoilRot = vm.ads = 0;
    vm.update(0, { ads: false, moveSpeed: 0 });
    a.obj.position.set(-3, 0, -14); scene.add(a.obj);
    renderer.render(scene, camera);
    window.effectPreview = { renderer, scene, camera, vm, cloud: a };
    return { weapons: data.weapons.length, poses: checked, maxPalmError, maxThirdPersonError };
  });
  assert.equal(result.weapons, 15);
  assert.equal(result.poses, result.weapons*7);
  assert.deepEqual(errors, []);
  console.log(`PASS: ${result.weapons} imported guns, ${result.poses} grip/ADS/recoil/reload poses; max palm error ${result.maxPalmError.toExponential(2)} m`);
  console.log(`PASS: third-person built-in wrists track shared grips (max error ${result.maxThirdPersonError.toExponential(2)} m)`);
  console.log('PASS: calibrated muzzle, receiver ejection, attached flash, reload cancellation, deterministic smoke lifecycle and WebGL render');
  if (process.env.EFFECT_SCREENSHOT) await page.screenshot({ path: process.env.EFFECT_SCREENSHOT });
  await page.close();

  // Exercise the actual main.js render/input wiring, not only isolated maths.
  const game = await context.newPage();
  const gameErrors = [];
  game.on('pageerror', (e) => { gameErrors.push(e.message); console.error('LIVE PAGE:', e.stack); });
  game.on('console', m=>{if(m.type()==='error') console.error('LIVE CONSOLE:',m.text());});
  await game.goto(origin + '/');
  await game.locator('#btn-mode-solo').waitFor({ state: 'visible', timeout: 30000 });
  await game.locator('#input-name').fill('Effects QA');
  await game.locator('#btn-mode-solo').click();
  await game.locator('#btn-deploy').click();
  await game.waitForFunction(() => window.__trench?.app.playing && window.__trench.app.net.lastMe?.alive, null, { timeout: 45000 });
  await game.evaluate(() => {
    const { app } = window.__trench;
    app.net._engine.py.runPython('_host.room.match.drop_bots(); _host.room.bots_on = False');
    // Software WebGL can skip an entire short reload while drawing scenery.
    // Keep the real map collisions/input, but spend rendering time on the
    // weapon/arms/effects this fixture actually asserts.
    app.world.group.visible = false;
    app.renderer.setPixelRatio(.35);
  });
  await game.locator('#game').click({ position: { x: 500, y: 300 } });
  await game.waitForFunction(() => window.__trench.app.controls.locked);
  await game.mouse.down();
  await game.waitForFunction(() => window.__trench.app.gunfx.stats.flashes > 1);
  await game.mouse.up();
  // Record the real authority -> viewmodel transition before dispatching R.
  // A slow CDP key-up round trip can otherwise finish after the whole 2.1s
  // reload, making a successful reload look like a timeout on software WebGL.
  await game.evaluate(() => {
    const {app}=window.__trench;
    app.reloadObserved=false;app.reloadSyncOriginal=app.vm.syncReload;
    app.vm.syncReload=function(...args) {
      app.reloadSyncOriginal.apply(this,args);
      if(args[2] && this.reloadT>=0)app.reloadObserved=true;
    };
  });
  try { await Promise.all([
    game.waitForFunction(() => window.__trench.app.reloadObserved, null, { timeout: 8000 }),
    game.keyboard.press('r'),
  ]); }
  catch (error) {
    console.error('LIVE RELOAD STATE', await game.evaluate(() => { const { app } = window.__trench; return { me: app.net.lastMe, paused: app.paused, focused: document.activeElement?.tagName, enabled: app.controls.enabled, keys: [...app.controls.keys], reloadT: app.vm.reloadT }; }));
    throw error;
  } finally {
    await game.evaluate(()=>{const {app}=window.__trench;app.vm.syncReload=app.reloadSyncOriginal;delete app.reloadSyncOriginal;});
  }
  if (process.env.EFFECT_SCREENSHOT) {
    await game.evaluate(() => { const { app } = window.__trench; app.paused = app.net.paused = true; app.vm.syncReload(2500, 1300, true); app.vm.update(0, { ads: false, moveSpeed: 0 }); app.renderer.render(app.scene, app.camera); });
    await game.screenshot({ path: process.env.EFFECT_SCREENSHOT.replace(/\.png$/, '-reload.png') });
    await game.evaluate(() => { const { app } = window.__trench; app.paused = app.net.paused = false; });
  }
  await game.evaluate(() => window.__trench.app.net.ability({ x: 0, y: 0, z: 1 }));
  await game.waitForFunction(() => window.__trench.app.effects.some((e) => e.puffs && e.landed && e.density > 0.5));
  await game.evaluate(() => {
    const { app } = window.__trench;
    if (!Number.isFinite(app.vm.gunMount.position.y)) throw new Error('Invalid live reload pose');
    if (app.fpArms?.holder.visible && app.vm.armMeshes.visible) throw new Error('Duplicate first-person arms');
  });
  await testLiveArsenal(game);
  await testLiveWeaponHold(game);
  await testLiveCamera(game);
  await testLiveGrenades(game);
  await testLiveSurvival(game);
  assert.deepEqual(gameErrors, []);
  console.log('PASS: real main.js solo deploy, native mouse firing, reload and landed smoke rendering');
  await game.close();
}
