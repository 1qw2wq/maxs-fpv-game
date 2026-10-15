// Actual shipped skeletons, not just empty palm objects at weapon sockets.
import assert from 'node:assert/strict';
export async function testHands(context, origin) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.goto(origin + '/__harness.html');
  const result = await page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const { ViewModel } = await import('/js/viewmodel.js');
    const { BUILTIN_SKINS, createExternalGirl, loadGltfFromUrl, prepareTemplate } = await import('/js/rig.js');
    const { prepareHandGrip } = await import('/js/handpose.js');
    const { ensureMotions } = await import('/js/motion.js');
    const data = await (await fetch('/shared/weapons.json')).json();
    const rigData = { ...data, teamById: Object.fromEntries(data.teams.map((t) => [t.id, t])) };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x647481);
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x665849, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(2, 5, 3); scene.add(light);
    const camera = new THREE.PerspectiveCamera(78, 4 / 3, 0.2, 50);
    camera.position.set(2, 1.6, -3); camera.rotation.set(0.05, 0.3, 0.01); scene.add(camera);
    const vm = new ViewModel(data); vm.setClass(data.classes[0]); camera.add(vm.root);
    const holder = new THREE.Group(); holder.position.set(0.03, -1.58, -0.18); holder.rotation.y = Math.PI; vm.root.add(holder);
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
    renderer.setSize(1000, 750);
    let poses = 0, usable = 0, maxReachError = 0;
    const hand = new THREE.Vector3(), fore = new THREE.Vector3(), gun = new THREE.Quaternion();
    const previews = [];
    if (prepareHandGrip(new THREE.Bone(), 'R') !== null) throw new Error('Fingerless uploads must retain positional fallback');
    for (const meta of Object.values(BUILTIN_SKINS)) {
      const gltf = await loadGltfFromUrl(meta.file);
      const template=prepareTemplate(gltf.scene);
      const girl = createExternalGirl({ template, meta, data: rigData, team: data.teams[0] });
      girl.marker.visible = girl.shadow.visible = false;
      girl.setHeadHidden(true);
      holder.add(girl.root);
      const wrists = {};
      for (const side of ['R', 'L']) {
        const wrist = girl.root.getObjectByName(meta.bones['hand' + side].replace(/[\s.]+/g, '_'));
        const grip = prepareHandGrip(wrist, side);
        if (!grip || grip.joints.length !== 15) throw new Error(`${meta.id}: missing finger chains`);
        wrists[side] = grip;
      }
      for (const weapon of data.weapons) {
        vm.setWeapon(weapon); await vm.gunMeshes.userData.modelReady;
        for (const phase of ['hip', 'ads', 'recoil', 'sprint', 'reload-start', 'reload-service', 'reload-seat', 'reload-end']) {
          vm.syncReload(2500, 0, false); vm.recoil = vm.recoilRot = vm.sprint = vm.ads = 0;
          if (phase === 'recoil') vm.kick(1);
          if (phase === 'ads') vm.ads = 1;
          if (phase === 'sprint') vm.sprint = 1;
          if (phase.startsWith('reload')) {
            const p = { 'reload-start': 0, 'reload-service': 0.48, 'reload-seat': 0.74, 'reload-end': 0.999 }[phase];
            vm.syncReload(2500, 2500 * (1 - p), true);
          }
          vm.update(0, { ads: phase === 'ads', sprinting: phase === 'sprint', moveSpeed: 2 });
          vm.gripWorld(hand, fore, gun);
          const expected = Object.fromEntries(['R', 'L'].map((side) => {
            const grip = wrists[side];
            const target = grip.targetFor(side === 'R' ? hand : fore, gun).clone();
            return [side, { target, rotation: grip.rotation.clone() }];
          }));
          const ok = girl.poseArms(hand, fore, gun);
          usable += Number(ok);
          for (const side of ['R', 'L']) {
            const grip = wrists[side], exp = expected[side];
            const error = grip.wrist.getWorldPosition(new THREE.Vector3()).distanceTo(exp.target);
            maxReachError = Math.max(maxReachError, error);
            if (ok && error >= 0.07) throw new Error(`${meta.id}/${weapon.id}/${phase}: disconnected wrist shown`);
            if (grip.wrist.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(exp.rotation.clone().normalize()) > 1e-5) throw new Error(`${meta.id}/${weapon.id}/${phase}/${side}: wrist orientation lost`);
            for (const joint of grip.joints) {
              if (joint.bone.quaternion.angleTo(joint.rest.clone().multiply(joint.curl).normalize()) > 1e-6) throw new Error(`${meta.id}/${weapon.id}/${phase}: ${joint.bone.name} finger pose lost`);
            }
          }
          const before = wrists.R.wrist.getWorldQuaternion(new THREE.Quaternion());
          girl.poseArms(hand, fore, gun); girl.poseArms(hand, fore, gun);
          if (before.normalize().angleTo(wrists.R.wrist.getWorldQuaternion(new THREE.Quaternion()).normalize()) > 1e-5) throw new Error('Wrist rotation accumulates across frames');
          poses++;
        }
      }
      // Normal third-person hold/run/fire also finish the wrists and fingers,
      // including when the asynchronously baked upper-body clips are ready.
      await ensureMotions(template);
      girl.setWeapon(data.weapons[0]);
      for (const state of [{ speed: 0 }, { speed: 3 }, { speed: 0, firing: true }]) {
        for (let i = 0; i < 30; i++) girl.update(1 / 60, state);
        girl.root.updateMatrixWorld(true);
        const socket = girl.root.getObjectByName('weapon-hand');
        socket.getWorldQuaternion(gun);
        for (const [side, key] of [['R', 'hand'], ['L', 'fore']]) {
          const grip = wrists[side];
          const contact = girl.root.getObjectByName(`weapon-${key}`).getWorldPosition(new THREE.Vector3());
          grip.targetFor(contact, gun);
          if (grip.wrist.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(grip.rotation.clone().normalize()) > 1e-5) throw new Error(`${meta.id}: world-character wrist twist`);
          for (const joint of grip.joints) if (joint.bone.quaternion.angleTo(joint.rest.clone().multiply(joint.curl).normalize()) > 1e-6) throw new Error(`${meta.id}: world-character open fingers`);
        }
      }
      const mount=girl.root.getObjectByName('weapon-hand').parent.parent;
      for(let frame=0;frame<180;frame++) {
        const phase=Math.floor(frame/30);
        girl.root.rotation.y=frame*.04;
        girl.update(1/60,{speed:phase===1 || phase===5 ? 5 : 0,sprint:phase===5,firing:phase===2,reloading:phase===3,ability:phase===4});
        girl.root.updateMatrixWorld(true);
        const local=girl.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(mount.getWorldQuaternion(new THREE.Quaternion()));
        const barrel=new THREE.Vector3(0,0,1).applyQuaternion(local);
        if(barrel.z<.94 || Math.abs(mount.position.x)>.5 || mount.position.z<0 || mount.position.z>.7)throw new Error(`${meta.id}: third-person weapon orbits body in phase ${phase}`);
      }
      girl.root.rotation.y=0;
      holder.remove(girl.root);
      previews.push(girl);
    }
    vm.setWeapon(data.weapons[0]); await vm.gunMeshes.userData.modelReady;
    vm.syncReload(2500, 0, false); vm.recoil = vm.recoilRot = vm.sprint = vm.ads = 0;
    vm.update(0, { ads: false, moveSpeed: 0 });
    previews[0].root.getObjectByName('weapon-hand').parent.parent.visible = false;
    holder.add(previews[0].root);
    vm.gripWorld(hand, fore, gun);
    if (!previews[0].poseArms(hand, fore, gun)) throw new Error('Default first-person skin cannot reach normal hold');
    vm.armMeshes.visible = false;
    renderer.render(scene, camera);
    window.handPreview = { vm, holder, girl: previews[0], camera, renderer, scene, hand, fore, gun };
    return { skins: previews.length, poses, usable, maxReachError };
  });
  assert.deepEqual(errors, []);
  assert.equal(result.skins, 4);
  assert.equal(result.poses, 384);
  console.log(`PASS: ${result.skins} imported skeletons / ${result.poses} poses: wrist orientation, 30 finger joints, repeat-frame stability and reach fallback (${result.usable} reachable)`);
  if (process.env.HAND_SCREENSHOT) {
    await page.screenshot({ path: process.env.HAND_SCREENSHOT });
    for (const phase of ['ads', 'reload']) {
      await page.evaluate((phase) => {
        const { vm, girl, renderer, scene, camera, hand, fore, gun, holder } = window.handPreview;
        holder.visible = true;
        vm.ads = phase === 'ads' ? 1 : 0;
        vm.syncReload(2500, phase === 'reload' ? 1300 : 0, phase === 'reload');
        vm.update(0, { ads: phase === 'ads', moveSpeed: 0 });
        vm.gripWorld(hand, fore, gun);
        const ok = girl.poseArms(hand, fore, gun);
        holder.visible = ok; vm.armMeshes.visible = !ok;
        renderer.render(scene, camera);
      }, phase);
      await page.screenshot({ path: process.env.HAND_SCREENSHOT.replace(/\.png$/, `-${phase}.png`) });
    }
    await page.evaluate(() => {
      const { vm, holder, renderer, scene, camera } = window.handPreview;
      vm.ads = 0; vm.syncReload(2500, 0, false); vm.update(0, { ads: false, moveSpeed: 0 });
      holder.visible = false; vm.armMeshes.visible = true; renderer.render(scene, camera);
    });
    await page.screenshot({ path: process.env.HAND_SCREENSHOT.replace(/\.png$/, '-gloves.png') });
  }
  if (process.env.TP_SCREENSHOT) {
    await page.evaluate(()=>{
      const {vm,girl,renderer,scene,camera}=window.handPreview;
      vm.root.visible=false;scene.add(girl.root);girl.root.position.set(0,0,0);girl.root.rotation.set(0,0,0);
      girl.setHeadHidden(false);girl.root.getObjectByName('weapon-hand').parent.parent.visible=true;
      camera.position.set(2,1.5,3);camera.lookAt(0,.95,0);
      for(let i=0;i<60;i++)girl.update(1/60,{speed:0});
      renderer.render(scene,camera);
    });
    await page.screenshot({path:process.env.TP_SCREENSHOT});
  }
  await page.close();
}
