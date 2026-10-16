// Imported gun models.
//
// weapons.json carries a `model` id; this module maps it to a .glb under
// public/models/guns/ and drops a correctly oriented, length-matched clone into
// the group the procedural builder handed back. The procedural gun stays in
// place until the download finishes, so a weapon is never missing, and every
// clone shares the prototype's geometry, so each model is parsed only once.
//
// The transforms below were solved offline: for each file the longest axis was
// carried onto +Z, the muzzle end picked as the thinner of the two, and the
// result scaled so the overall length matches the procedural gun's envelope
// (smg 0.92 m, rifle 1.12 m, lmg 1.22 m, bolt 1.28 m). Hand contacts are
// measured on these normalized meshes in weaponpose.js, not on the placeholder.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { fixImportedMaterials } from './lighting.js';

const BASE = 'models/guns/';
const D2R = Math.PI / 180;

/**
 * rot: Euler XYZ in degrees, model space -> gun space (muzzle on +Z, up on +Y)
 * off: gun-space translation that re-centres the model on the mount origin
 * scale: absolute model-units -> metres
 * flip: the source file points the other way; turn the finished gun 180 deg
 *       about the mount's up axis (see place())
 *
 * hellriegel comes from a rebuilt, fully assembled asset (21 parts, 9k verts)
 * rather than the disassembled 28 MB showcase the first download turned out to
 * be, so it finally ships as a model instead of the procedural placeholder.
 */
const MODELS = {
  // Uploaded scoped rifles, normalized to the same 1.28 m carry envelope.
  sentinel: { file: 'sniper.glb', rot: [0, 0, 0], off: [0, -.06, -.331187], scale: 0.007624 },
  awp: { file: 'sniper_rifle_-_awp.glb', rot: [0, 180, 0], off: [-.0141, .03, -.30324], scale: 0.00561385 },
  longbow: { file: 'titanfall_2_weapon_longbow-dmr_sniper.glb', rot: [90, 0, 0], off: [0, -.14, -.054665], scale: 0.028769 },
  mp18:        { rot: [0, 90, 0],     off: [-0.099, -0.003, 0],        scale: 0.011274 },
  hellriegel:  { rot: [97.216, 77.144, -84.05], off: [-0.0097, -0.0335, 0.0906], scale: 0.001328326 },
  auto1918:    { rot: [180, 0, 180],  off: [0.006, -0.033, -0.169],    scale: 0.795572 },
  cei:         { rot: [180, 0, 180],  off: [-0.021, -0.002, 0.09],     scale: 0.093122, flip: true },
  rsc1917:     { rot: [0, -90, 0],    off: [0.008, 0.014, 0.013],      scale: 0.339654 },
  federov:     { rot: [90, 0, 0],     off: [-0.016, -0.01, -0.014],    scale: 0.000902, flip: true },
  lewis:       { rot: [180, 0, 180],  off: [0.006, -0.078, 0.094],     scale: 0.009372, flip: true },
  bar:         { rot: [0, 0, 0],      off: [-0.009, -0.519, -0.004],   scale: 0.451322, flip: true },
  chauchat:    { rot: [0, 90, 0],     off: [0, -0.189, 0],             scale: 0.015319, flip: true },
  smle:        { rot: [90, 0, 0],     off: [-0.007, -0.046, -0.007],   scale: 0.000362, flip: true },
  m95:         { rot: [0, -90, 0],    off: [0, 0, 0],                  scale: 0.64, flip: true },
  springfield: { rot: [180, 0, 180],  off: [0.04, 0.021, -0.331],      scale: 1.159914 },
};

const loader = new GLTFLoader();
// The uploaded Longbow uses the retired specular/glossiness extension. Restore
// its embedded albedo through the current loader rather than drawing it white.
loader.register((parser) => ({
  name: 'KHR_materials_pbrSpecularGlossiness',
  extendMaterialParams(index, params) {
    const legacy = parser.json.materials[index].extensions?.KHR_materials_pbrSpecularGlossiness;
    if (!legacy) return Promise.resolve();
    const color = legacy.diffuseFactor || [1, 1, 1, 1];
    params.color = new THREE.Color().fromArray(color);
    params.opacity = color[3];
    params.metalness = .15;
    params.roughness = Math.max(.35, 1 - (legacy.glossinessFactor ?? .5));
    return legacy.diffuseTexture
      ? parser.assignTexture(params, 'map', legacy.diffuseTexture, THREE.SRGBColorSpace)
      : Promise.resolve();
  },
}));
const cache = new Map();   // id -> Promise<THREE.Object3D>

/**
 * A couple of the rips (SMLE, Fedorov) ship skinned, with bind data that does
 * not survive the export: the skeleton collapses the mesh to a centimetre-wide
 * sliver and the gun vanishes, while the geometry itself is exported in its
 * final pose and measures exactly right. A gun is a rigid prop nothing ever
 * animates, so drop the skinning and draw the geometry as a plain static mesh —
 * which also makes the per-instance clone safe, since no skeleton is shared.
 */
function deSkin(root) {
  const skinned = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  for (const sm of skinned) {
    const m = new THREE.Mesh(sm.geometry, sm.material);
    m.name = sm.name;
    m.renderOrder = sm.renderOrder;
    m.frustumCulled = sm.frustumCulled;
    sm.matrix.decompose(m.position, m.quaternion, m.scale);
    sm.parent.add(m);
    while (sm.children.length) m.add(sm.children[0]);
    sm.removeFromParent();
  }
}

function load(id) {
  let p = cache.get(id);
  if (!p) {
    p = loader.loadAsync(BASE + (MODELS[id].file || id + '.glb')).then((g) => {
      deSkin(g.scene);
      // These files are PBR with a metallicRoughness map: without an
      // environment they render black, so the scene's baked environment and a
      // sane envMapIntensity are what make the gun readable in the viewmodel.
      fixImportedMaterials(g.scene, { envMapIntensity: 1.15 });
      return g.scene;
    });
    cache.set(id, p);
  }
  return p;
}

function place(scene, cfg) {
  const outer = new THREE.Group();
  const holder = new THREE.Group();
  outer.add(holder);
  holder.add(scene);

  const r = cfg.rot;
  holder.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
  holder.scale.setScalar(cfg.scale);

  const o = cfg.off;
  // a flipped gun is yawed 180 deg by the outer group, so mirroring the offset's
  // x/z here keeps the mesh centred on the same mount point
  holder.position.set(cfg.flip ? -o[0] : o[0], o[1], cfg.flip ? -o[2] : o[2]);
  if (cfg.flip) outer.rotation.y = Math.PI;

  outer.traverse((obj) => { obj.frustumCulled = false; });
  return outer;
}


/** Find the front barrel opening after the imported model's normalization.
 * A placeholder length is not a muzzle socket: it was floating ahead of some
 * guns and buried inside others. Sample the foremost 2% in gun-local space.
 */
export function calibrateMuzzle(holder, muzzle, sight) {
  holder.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(holder, true);
  if (bounds.isEmpty()) return;
  const front = bounds.max.z - Math.max(0.008, (bounds.max.z - bounds.min.z) * 0.02);
  const cap = new THREE.Box3();
  const point = new THREE.Vector3();
  holder.traverse((mesh) => {
    const positions = mesh.isMesh && mesh.geometry?.attributes.position;
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (point.z >= front) cap.expandByPoint(point);
    }
  });
  if (!cap.isEmpty()) {
    cap.getCenter(muzzle.position);
    muzzle.position.z = bounds.max.z + 0.005;
  }
  if (sight) {
    // Use only the bore's lane, not an offset magazine/bipod. Keep the reticle
    // just above the tallest obstruction in that lane (including pan-fed guns).
    let top = -Infinity;
    holder.traverse((mesh) => {
      const positions = mesh.isMesh && mesh.geometry?.attributes.position;
      if (!positions) return;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(point.x - muzzle.position.x) < .035 && point.z > bounds.min.z + .15) top = Math.max(top, point.y);
      }
    });
    if (Number.isFinite(top)) sight.position.set(muzzle.position.x, top + .006, .2);
  }
}

/**
 * Swap the procedural gun for the imported model once it is available.
 *
 * @param {object} weapon  entry from weapons.json (needs `model`)
 * @param {THREE.Group} group  the gun group buildWeapon returned
 * @param {THREE.Object3D} muzzle  calibrated to the imported barrel opening
 */
export function attachGunModel(weapon, group, muzzle) {
  const id = weapon && weapon.model;
  const cfg = id ? MODELS[id] : null;
  if (!cfg) return;

  const procedural = group.children.filter((c) => c.isMesh);
  group.userData.modelReady = load(id).then((scene) => {
    const holder = place(scene.clone(true), cfg);
    holder.name = `gun-model-${id}`;
    calibrateMuzzle(holder, muzzle, group.userData.anchors?.sight);
    for (const c of procedural) group.remove(c);
    group.add(holder);
  }).catch((err) => {
    console.warn('[guns] failed to load model', id, err && err.message ? err.message : err);
  });
}