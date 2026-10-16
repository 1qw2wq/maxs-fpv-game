import assert from 'node:assert/strict';
export async function testCamera(context, origin) {
  const page = await context.newPage();
  await page.goto(origin + '/__harness.html');
  const count = await page.evaluate(async () => {
    const T = await import('/vendor/three.module.js');
    const { resolveCamera, cameraRadius } = await import('/js/camera-collision.js');
    const { Controls } = await import('/js/controls.js');
    const { World } = await import('/js/map.js');
    const combat = (await (await fetch('/shared/weapons.json')).json()).combat;
    const vec = (x, y, z) => new T.Vector3(x, y, z);
    const ground = { t: 'ground', x: 0, y: -5.5, z: 0, w: 100, h: 1, d: 100 };
    const wall = { t: 'wall', x: -1.2, y: 2, z: 0, w: 0.04, h: 6, d: 10 };
    const camera = new T.PerspectiveCamera(78, 16 / 9, 0.06, 100);
    let tests = 0;
    const nearClear = (point, box, radius) => {
      const limits = [[box.x, box.w, point.x], [box.y, box.h, point.y], [box.z, box.d, point.z]];
      if (limits.every(([c, size, p]) => Math.abs(p - c) < size / 2 + radius - 0.001)) throw new Error('Camera near volume penetrates a solid');
    };
    const eye = vec(0, 1.58, 0), desired = vec(-3.1, 2.03, 0);
    const empty = { solid: [], ground };
    if (resolveCamera(empty, eye, desired, camera).distanceTo(desired) > 1e-8) throw new Error('Open-space camera distance changed');
    tests++;
    for (const aspect of [4/3, 16/9, 21/9]) {
      camera.aspect = aspect;
      for (const near of [0.06, 0.20]) {
        camera.near = near;
        const result = resolveCamera({ solid: [wall], ground }, eye, desired, camera);
        nearClear(result, wall, cameraRadius(camera));
        if (result.x < -1.18) throw new Error('Camera teleported through a thin wall');
        // FP: body is clear, but near-plane corners initially overlap the wall.
        const fpEye = vec(-0.80, 1.58, 0);
        const fp = resolveCamera({ solid: [wall], ground }, fpEye, fpEye, camera);
        nearClear(fp, wall, cameraRadius(camera));
        // A rapid orbital turn must not rely on last-frame camera position.
        for (let angle = 0; angle < 360; angle += 15) {
          const target = eye.clone().add(vec(Math.cos(angle * Math.PI / 180) * 3.1, 0.45, Math.sin(angle * Math.PI / 180) * 3.1));
          const orbit = resolveCamera({ solid: [wall], ground }, eye, target, camera);
          nearClear(orbit, wall, cameraRadius(camera));
          tests++;
        }
        tests += 2;
      }
    }
    camera.near = 0.2; camera.aspect = 16/9;
    const ceiling = { t: 'wall', x: 0, y: 2.1, z: 0, w: 8, h: 0.2, d: 8 };
    const crouchEye = vec(0, 1.8, 0);
    const below = resolveCamera({ solid: [ceiling], ground }, crouchEye, crouchEye, camera);
    nearClear(below, ceiling, cameraRadius(camera));
    if (below.y > 2) throw new Error('Ceiling resolution moved camera above the roof');
    const low = resolveCamera(empty, vec(0, -4, 0), vec(-3, -8, 0), camera);
    if (low.y < -5 + cameraRadius(camera)) throw new Error('Camera crossed the backstop floor');
    const ramp = { t: 'ramp', x: 0, y: 1, z: 0, w: 4, h: 2, d: 4, ax: 'x', y0: 0, y1: 2 };
    camera.near = 0.06;
    const aboveRamp = vec(-1, 1.1, 0);
    const unobstructed = resolveCamera({ solid: [ramp], ground }, aboveRamp, aboveRamp, camera);
    if (unobstructed.distanceTo(aboveRamp) > 1e-8) throw new Error('Ramp incorrectly treated as a full-height box');
    const hitRamp = resolveCamera({ solid: [ramp], ground }, vec(-3, 1, 0), vec(2, 0.3, 0), camera);
    if (hitRamp.y - (hitRamp.x * 0.5 + 1) < cameraRadius(camera) * Math.hypot(0.5, 1) - 0.01 && hitRamp.x > -2) throw new Error('Camera crossed ramp slope');
    tests += 4;
    // Real Controls jump path: a low ceiling must stop the head before the
    // camera correction is even needed. Standing/crouched both get checked.
    const world = new World(new T.Scene(), { boxes: [ceiling, { ...ground, y: -0.5 }], groundY: 0, bounds: {minX:-20,maxX:20,minZ:-20,maxZ:20} }, combat);
    const controls = new Controls(document.querySelector('canvas'), world, combat, {});
    controls.enabled = true;
    controls.eyeStand = combat.standEyeHeight; controls.eyeCrouch = combat.crouchEyeHeight;
    controls.keys.add('Space');
    for (let i = 0; i < 24; i++) {
      controls.update(1/30, true, false);
      controls.keys.delete('Space');
      if (controls.pos.y + controls.bodyHeight > 2.001) throw new Error('Jump pushed head through ceiling');
    }
    tests++;
    return tests;
  });
  assert.ok(count > 150);
  console.log(`PASS: ${count} camera checks (FP/TP, thin walls, orbit, wide aspect, ceiling jumps, floors and ramps)`);
  await page.close();
}

export async function testLiveCamera(page) {
  await page.evaluate(async () => {
    const { app } = window.__trench;
    const { World } = await import('/js/map.js');
    const T = await import('/vendor/three.module.js');
    window.savedCameraTest = { world: app.world, controlsWorld: app.controls.world, pos: app.controls.pos.clone(), yaw: app.controls.yaw, pitch: app.controls.pitch, mode: app.cameraMode, enabled: app.controls.enabled };
    const ground = { t:'ground',x:0,y:-0.5,z:0,w:100,h:1,d:100 };
    const wall = {t:'wall',x:-1.2,y:2,z:0,w:0.04,h:6,d:10};
    const world = new World(new T.Scene(), {boxes:[ground,wall], groundY:0, bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20}}, app.data.combat);
    app.world = app.controls.world = world;
    app.controls.pos.set(0,0,0); app.controls.eyeGround=0; app.controls.yaw=app.controls.pitch=0; app.controls.enabled=false;
    app.controls.mouse.left=false; app.cameraMode='tp';
  });
  await page.waitForFunction(() => {
    const { app } = window.__trench;
    return app.camera.position.x > -1.05 && app.camera.position.x < -0.5;
  });
  await page.evaluate(() => { window.__trench.app.controls.pos.x=-0.65; });
  await page.waitForFunction(() => !window.__trench.app.self.root.visible && window.__trench.app.camera.position.x>-1.1);
  await page.evaluate(() => { const { app } = window.__trench; app.cameraMode='fp'; app.controls.pos.x=-0.82; });
  await page.waitForFunction(() => window.__trench.app.camera.position.x > -0.80);
  await page.evaluate(() => {
    const { app } = window.__trench, saved = window.savedCameraTest;
    app.world=saved.world; app.controls.world=saved.controlsWorld; app.controls.pos.copy(saved.pos);
    app.controls.yaw=saved.yaw; app.controls.pitch=saved.pitch; app.controls.enabled=saved.enabled; app.controls.eyeGround=saved.pos.y; app.cameraMode=saved.mode;
    delete window.savedCameraTest;
  });
  console.log('PASS: actual main.js FP/TP render loop clamps cameras at walls');
}
