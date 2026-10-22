// Uploaded rigid face accessory. Art never grants protection: only game.py does.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { fixImportedMaterials } from './lighting.js';

let pending, fallback;
const head = new THREE.Vector3(), offset = new THREE.Vector3();
export function preloadGasMask() {
  if (!pending) pending = new GLTFLoader().loadAsync('/models/guns/gas_mask.glb').then(gltf => {
    const art = gltf.scene;
    fixImportedMaterials(art);
    art.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(art), size = box.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 1e-6) throw Error('Empty gas mask model');
    // This upload is already Y-up/+Z-forward, like all four built-in characters.
    const center = box.getCenter(new THREE.Vector3());
    const normalized = new THREE.Group(); normalized.add(art);
    art.position.sub(center);
    normalized.scale.setScalar(.32 / size.y);
    art.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    return normalized;
  }).catch(error => { pending = null; throw error; });
  return pending;
}
function fallbackMask() {
  if (fallback) return fallback;
  fallback = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({color:0x29342b, roughness:.85});
  const glass = new THREE.MeshStandardMaterial({color:0x606f59, roughness:.3, metalness:.2});
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1,16,12),rubber);
  shell.scale.set(.14,.155,.045); fallback.add(shell);
  for (const x of [-.065,.065]) {
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(.047,.047,.016,16),glass);
    eye.rotation.x = Math.PI/2; eye.position.set(x,.04,.045); fallback.add(eye);
  }
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(.048,.048,.05,12),rubber);
  filter.rotation.x = Math.PI/2; filter.position.set(0,-.065,.067); fallback.add(filter);
  return fallback;
}
export function createGasMask() {
  const root = new THREE.Group(); root.name = 'gas-mask';
  root.add(fallbackMask().clone(true));
  root.userData.modelReady = preloadGasMask().then(art => {
    if (root.userData.disposed) return false;
    root.clear(); root.add(art.clone(true)); root.userData.imported = true;
    return true;
  }).catch(() => false);
  return root;
}
export function disposeGasMask(root) {
  if (!root) return;
  root.userData.disposed = true; root.removeFromParent(); root.clear();
  // Instances share immutable cached art, including fallback geometry/materials.
}
export function updateAvatarMask(girl, on, pitch = 0) {
  if (!girl.gasMask && !on) return;
  if (!girl.gasMask) { girl.gasMask = createGasMask(); girl.root.add(girl.gasMask); }
  const mask = girl.gasMask;
  mask.visible = !!on;
  if (!on || !girl.root.visible) return;
  girl.root.updateMatrixWorld(true);
  girl.maskHeadPosition(head);
  const crouch = girl.crouchAmount || 0;
  mask.rotation.set(-THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitch,-70,70))*.55-crouch*.28,0,0);
  offset.set(0,-.015,.13).applyEuler(mask.rotation);
  mask.position.copy(head).add(offset);
}
