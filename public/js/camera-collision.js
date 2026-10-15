// Render-camera collision only: never moves the player's authoritative body or
// shooting ray. Sweep a near-plane-sized volume, not just a centre-line ray.
import * as THREE from 'three';
const cache = new WeakMap();
const EPS = 0.003;

function planes(box) {
  let result = cache.get(box);
  if (result) return result;
  const x0 = box.x - box.w / 2, x1 = box.x + box.w / 2;
  const y0 = box.y - box.h / 2, y1 = box.y + box.h / 2;
  const z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
  result = [[1, 0, 0, x1], [-1, 0, 0, -x0], [0, -1, 0, -y0], [0, 0, 1, z1], [0, 0, -1, -z0]];
  if (box.t === 'ramp') {
    const alongZ = box.ax === 'z';
    const slope = (box.y1 - box.y0) / Math.max(1e-6, alongZ ? box.d : box.w);
    const length = Math.hypot(slope, 1);
    result.push([alongZ ? 0 : -slope / length, 1 / length, alongZ ? -slope / length : 0,
      (box.y0 - slope * (alongZ ? z0 : x0)) / length]);
  } else result.push([0, 1, 0, y1]);
  cache.set(box, result);
  return result;
}
const distance = (p, plane) => plane[0] * p.x + plane[1] * p.y + plane[2] * p.z - plane[3];
const inside = (p, shape, radius) => shape.every((plane) => distance(p, plane) < radius - EPS * 0.5);

export function cameraRadius(camera) {
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max(0.14, camera.near * Math.sqrt(1 + vertical ** 2 * (1 + camera.aspect ** 2)) + 0.015);
}

/** Keep a camera's near plane outside walls/floors, including thin walls and ramps. */
export function resolveCamera(world, eye, desired, camera, out = new THREE.Vector3()) {
  const radius = cameraRadius(camera);
  const reach = eye.distanceTo(desired) + radius + 0.5;
  const boxes = world._near ? [...new Set(world._near(eye.x, eye.z, reach))] : world.solid;
  const shapes = boxes.map(planes);
  if (world.ground) shapes.push(planes(world.ground));
  const anchor = eye.clone();
  // Eye smoothing, crouching and an abrupt map/stance change can start inside
  // the padded volume. Resolve that before sweeping; rays alone miss this case.
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const shape of shapes) {
      if (!inside(anchor, shape, radius)) continue;
      let best = Infinity, normal;
      for (const plane of shape) {
        const push = radius - distance(anchor, plane) + EPS;
        if (push < best) { best = push; normal = plane; }
      }
      anchor.x += normal[0] * best; anchor.y += normal[1] * best; anchor.z += normal[2] * best;
      changed = true;
    }
    if (!changed) break;
  }
  // FP only needs depenetration. Do not sweep back toward the unsafe original
  // eye after moving it away from a nearby wall/ceiling.
  if (eye.distanceToSquared(desired) < 1e-10) return out.copy(anchor);
  const delta = desired.clone().sub(anchor);
  let fraction = 1;
  for (const shape of shapes) {
    let enter = 0, exit = fraction, hit = true;
    for (const plane of shape) {
      const start = distance(anchor, plane) - radius;
      const speed = plane[0] * delta.x + plane[1] * delta.y + plane[2] * delta.z;
      if (Math.abs(speed) < 1e-10) { if (start > 0) { hit = false; break; } }
      else {
        const t = -start / speed;
        if (speed < 0) enter = Math.max(enter, t);
        else exit = Math.min(exit, t);
        if (enter > exit) { hit = false; break; }
      }
    }
    if (hit && enter >= 0 && enter <= fraction && exit >= 0) fraction = Math.max(0, enter - EPS / Math.max(EPS, delta.length()));
  }
  return out.copy(anchor).addScaledVector(delta, fraction);
}
