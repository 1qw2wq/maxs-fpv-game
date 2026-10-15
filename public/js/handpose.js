// Anatomical hand frames shared by the camera arms and world characters.
// In this frame +Y runs from wrist to knuckles and +Z faces into the grip.
// A weapon socket is a CONTACT point, not the wrist joint or palm centre.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/utils/BufferGeometryUtils.js';

const matrix = new THREE.Matrix4();
const frame = (forward, normal) => new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(forward, normal), forward, normal),
);
const rotations = {
  R: frame(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)),
  L: frame(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)),
};
export const GLOVE_WRIST = new THREE.Vector3(0, -0.042, -0.028);
export function gripRotation(gunRotation, side, out = new THREE.Quaternion()) {
  return out.copy(gunRotation).multiply(rotations[side]);
}
export function gloveWrist(contact, rotation, out = new THREE.Vector3()) {
  return out.copy(contact).add(GLOVE_WRIST.clone().applyQuaternion(rotation));
}
export function setWorldRotation(node, rotation) {
  node.parent.getWorldQuaternion(node.quaternion).normalize().invert().multiply(rotation).normalize();
  node.updateWorldMatrix(false, true);
}

/** Compact rounded glove, separate thumb and three bent phalanges per finger. */
export function buildGripGlove(material, side) {
  const root = new THREE.Group();
  root.name = `grip-glove-${side}`;
  const add = (parent, radius, length, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 3, 6), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const palm = add(root, 0.022, 0.071, 0, -0.006, -0.028);
  palm.scale.set(1.42, 1, 0.55);
  const cuff = add(root, 0.022, 0.025, 0, -0.043, -0.028);
  cuff.scale.set(1.1, 1, 0.75);
  for (let i = 0; i < 4; i++) {
    const index = i === 3;
    let parent = root;
    const lengths = [0.026, 0.022, 0.017].map((l) => l * (i === 0 ? 0.83 : 1));
    const bends = side === 'R' && index ? [0.25, 0.55, 0.65] : [0.65, 1.15, 0.9];
    for (let j = 0; j < 3; j++) {
      const pivot = new THREE.Group();
      pivot.name = `finger-${i}-${j}`;
      pivot.position.set(j ? 0 : (i - 1.5) * 0.016, j ? lengths[j - 1] : 0.024, j ? 0 : -0.026);
      pivot.rotation.x = bends[j];
      parent.add(pivot);
      add(pivot, 0.008, lengths[j], 0, lengths[j] / 2, 0);
      parent = pivot;
    }
  }
  const thumb = new THREE.Group();
  thumb.name = 'thumb';
  thumb.position.set(side === 'R' ? 0.031 : -0.031, -0.018, -0.014);
  thumb.rotation.set(0.55, side === 'R' ? -0.5 : 0.5, side === 'R' ? -0.8 : 0.8);
  root.add(thumb);
  add(thumb, 0.010, 0.035, 0, 0.016, 0);
  const tip = new THREE.Group();
  tip.position.y = 0.03;
  tip.rotation.x = 0.85;
  thumb.add(tip);
  add(tip, 0.009, 0.025, 0, 0.01, 0);
  // This grip is static: keep the named pivots for inspection, but render one
  // merged mesh per glove rather than 16 draws per hand on every remote player.
  root.updateMatrixWorld(true);
  const pieces = [], meshes = [];
  root.traverse((o) => {
    if (o.isMesh) { pieces.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); meshes.push(o); }
  });
  const geometry = mergeGeometries(pieces);
  for (const mesh of meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  for (const piece of pieces) piece.dispose();
  root.add(new THREE.Mesh(geometry, material));
  return root;
}

/** Infer each imported hand's axes from its own skeleton, never Euler guesses.
 * Unknown/uploaded rigs without fingers retain positional IK unchanged.
 */
export function prepareHandGrip(wrist, side) {
  if (!wrist) return null;
  wrist.updateWorldMatrix(true, true);
  const chains = {};
  for (const name of ['Index', 'Middle', 'Ring', 'Little', 'Thumb']) {
    let first;
    wrist.traverse((o) => {
      if (o.isBone && new RegExp(`^${name}(?:Finger)?${name === 'Thumb' ? '0' : '1'}(?:_|$)`, 'i').test(o.name)) first = o;
    });
    if (!first) continue;
    const chain = [];
    for (let bone = first; bone && chain.length < 3; bone = bone.children.find((b) => b.isBone)) chain.push(bone);
    chains[name] = chain;
  }
  if (!chains.Middle || !chains.Index || !chains.Little) return null;
  const local = (bone) => wrist.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  const middle = local(chains.Middle[0]);
  const forward = middle.clone().normalize();
  const across = local(chains.Index[0]).sub(local(chains.Little[0])).normalize();
  const normal = across.clone().cross(forward).normalize().multiplyScalar(side === 'R' ? 1 : -1);
  const transverse = forward.clone().cross(normal).normalize();
  const basis = new THREE.Quaternion().setFromRotationMatrix(matrix.makeBasis(transverse, forward, normal));
  const inverseBasis = basis.invert();
  const palm = middle.clone().multiplyScalar(0.55);
  const inverseWrist = wrist.getWorldQuaternion(new THREE.Quaternion()).invert();
  const joints = [];
  for (const [name, chain] of Object.entries(chains)) {
    chain.forEach((bone, i) => {
      const relative = inverseWrist.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(relative);
      const axis = direction.cross(normal).normalize().applyQuaternion(relative.clone().invert());
      const angles = name === 'Thumb' ? [0.25, 0.7, 0.65]
        : side === 'R' && name === 'Index' ? [0.25, 0.55, 0.65] : [0.65, 1.15, 0.9];
      joints.push({ bone, rest: bone.quaternion.clone().normalize(), curl: new THREE.Quaternion().setFromAxisAngle(axis, angles[i]) });
    });
  }
  const rotation = new THREE.Quaternion();
  const target = new THREE.Vector3();
  const scale = new THREE.Vector3();
  return {
    wrist, joints, target, rotation,
    targetFor(contact, gunRotation) {
      const desired = gripRotation(gunRotation, side, rotation);
      target.set(0, 0, -0.028).applyQuaternion(desired).add(contact);
      desired.multiply(inverseBasis);
      wrist.getWorldScale(scale);
      target.sub(palm.clone().multiply(scale).applyQuaternion(desired));
      return target;
    },
    apply() {
      setWorldRotation(wrist, rotation);
      for (const { bone, rest, curl } of joints) bone.quaternion.copy(rest).multiply(curl).normalize();
      wrist.updateWorldMatrix(false, true);
    },
  };
}
