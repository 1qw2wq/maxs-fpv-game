// Imported rigs: load a skinned glTF/GLB, map its bones onto our joint names,
// normalise it to the server's 1.70 m hit capsule, and drive it with the same
// procedural walk cycle the built-in girl uses.
//
// The built-in character (character.js) is assembled from primitives; this
// module is the opposite case — someone else's skeleton, unknown rest pose and
// unknown bone axes. So every driven rotation is applied as a delta on top of
// the captured rest quaternion, which is the only thing that works across rigs.

import { placement } from './third-person-placement.js';
import { weaponReloadPose } from './reload-motion.js';
import { mountedGrips } from './weaponpose.js';
import { prepareHandGrip } from './handpose.js';
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { buildFactionOverlay } from './character.js';
import { buildWeapon } from './viewmodel.js';
import { ensureMotions, RUN_SECTORS } from './motion.js';
import { store } from './storage.js';
import { fixImportedMaterials } from './lighting.js';
import { apiUrl } from './api.js';
import { t, onLangChange } from './i18n.js';

/** Joint keys the game understands, in the order the settings UI shows them. */
export const JOINTS = [
  { key: 'hips', label: '髋部' },
  { key: 'spine', label: '脊柱' },
  { key: 'head', label: '头部' },
  { key: 'shoulderL', label: '左肩' },
  { key: 'shoulderR', label: '右肩' },
  { key: 'elbowL', label: '左肘' },
  { key: 'elbowR', label: '右肘' },
  { key: 'handL', label: '左手' },
  { key: 'handR', label: '右手' },
  { key: 'kneeL', label: '左膝' },
  { key: 'kneeR', label: '右膝' },
  { key: 'footL', label: '左脚' },
  { key: 'footR', label: '右脚' },
];

export const JOINT_KEYS = JOINTS.map((j) => j.key);
export const JOINT_LABEL = Object.fromEntries(JOINTS.map((j) => [j.key, j.label]));

/** Normalised standing height. Must stay in sync with COMBAT.playerHeight. */
export const TARGET_HEIGHT = 1.70;

const _down = new THREE.Vector3(0, -1, 0);
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Transverse-plane correction for the retargeted run cycle: each stepping leg is
 * yawed this far toward the centre line, per side, because the two legs do not
 * land symmetrically. The Mixamo cycles land duck-footed on these rips (the
 * T-pose/A-pose rest mismatch shows up as out-toeing), so the step has to be
 * pulled back in — and the right leg needs a touch more than the left.
 */
const STEP_TOE_IN = { L: 1 * DEG, R: 2 * DEG };

/**
 * Torso sway damper. The run clip rocks the pelvis and the upper-body clip adds
 * its own spine swing on top; the two together rock the whole torso much harder
 * than a person running with a rifle should. `TORSO_SWAY` blends each torso
 * bone's live rotation toward a slow average of itself, which attenuates the
 * back-and-forth (the AC part) while leaving the run's forward lean — the DC
 * part — exactly where the clip put it. 0 = untouched, 1 = fully flattened to
 * the average. TAU is that average's time constant in seconds.
 */
const TORSO_SWAY = 0.55;
const TORSO_SWAY_TAU = 0.45;

/** Wrap an angle into [-PI, PI] so a cyclic phase difference stays continuous. */
function wrapPi(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/**
 * Gaussian bump on the cyclic phase p, centred at mu with width sigma. The walk
 * cycle is built from a handful of these (knee loading response, knee swing
 * flexion, ankle push-off) rather than one sinusoid, because real gait is not
 * sinusoidal: the knee has two distinct flexion peaks per step, not one.
 */
function bump(p, mu, sigma) {
  const d = wrapPi(p - mu);
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

// Right-palm contact in the calibrated chest frame (metres at scale 1).
// Pitch rotates about this contact, never about the avatar/weapon origin.
const CARRY_HAND = new THREE.Vector3(-0.035, -0.06, 0.025);
const MAX_SUPPORT_SPAN = 0.28;
const SUPPORT_REACH_FRACTION = 0.7; // keep elbow bend even when aiming vertically

// ------------------------------------------------------------------ loading

/**
 * Parse a picked .glb/.gltf file.
 *
 * Only self-contained files work: a .gltf pointing at sibling .bin/textures
 * cannot resolve them because the file was never uploaded anywhere.
 */
export function loadGltfFromFile(file) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const isGlb = /\.glb$/i.test(file.name) || file.type === 'model/gltf-binary';
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('无法读取文件')));
    reader.onload = () => {
      loader.parse(reader.result, '', resolve, (err) => {
        reject(new Error(err?.message ? String(err.message)
          : t('模型解析失败（不支持 Draco / meshopt 压缩）')));
      });
    };
    if (isGlb) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  });
}

/** Parse a model that already lives on the server. */
export function loadGltfFromUrl(url) {
  return new GLTFLoader().loadAsync(url).then((gltf) => {
    // Uploaded rigs are usually unlit (anime rips) but a standard-material one
    // would otherwise inherit the same "metal with nothing to reflect" problem
    // the guns had; the pass is a no-op for unlit files.
    if (gltf.scene) fixImportedMaterials(gltf.scene);
    return gltf;
  });
}

/** Bone names of a model, in hierarchy order (parents before children). */
export function collectBones(scene) {
  const out = [];
  scene.traverse((o) => { if (o.isBone && o.name) out.push(o.name); });
  return out;
}

/** Scale + ground offset that puts the model at TARGET_HEIGHT with feet at y=0. */
export function fitToHeight(root, targetH = TARGET_HEIGHT) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const h = size.y > 1e-4 ? size.y : 1;
  const scale = targetH / h;
  return { scale, baseOffsetY: -box.min.y * scale };
}

// ---------------------------------------------------------- cape detachment
//
// On these rips the cape and its shoulder straps are parented under the
// shoulder bone, so the upper-body clip that swings the arm into the rifle hold
// drags the whole cape along. The cape has no arm influence in its skin weights
// (probe: armDriven=0 on every cloak vertex) — the bug is purely structural:
// the bone chain hangs off the arm. Re-hanging the chain onto the chest is what
// "unbinding" the cape means; no weights are touched.
// Only the arm bones themselves can wrongly hold cloth.
const CAPE_PARENT = /shoulder|arm|elbow|wrist/i;
// Whitelist, not a blacklist: the rigs carry far more than cape bones under the
// arm — the fingers and thumb hang off the wrist, and their names ("Thumb0_R",
// "IndexFinger1_R", …) contain none of arm/shoulder/sleeve/glove/elbow/wrist/
// twist/hand. A blacklist therefore reparented the finger roots to the chest and
// the glove mesh, skinned to them, stretched between the hand and the sternum.
// Naming the cloth families explicitly (probe-confirmed: Cloak_*, Cloth_*,
// Back<cloak>_*, Lope_*/Rope_*, Kollar_*, Collar_*, Strand_*) leaves every hand,
// sleeve and correction bone where it belongs.
const CAPE_CLOTH = /^(cloak|cloth|lope|rope|kollar|collar|strand|back)/i;

/**
 * Re-hang shoulder-parented cloth bones (cape roots, strap roots and the rope
 * chains under them) onto the chest, preserving each bone's world transform so
 * the bind pose — and with it the skinning — is untouched. Only the top-most
 * matching bone of a chain moves; its descendants ride along.
 *
 * Runs on the shared template, once, before any clone or motion bake, so every
 * avatar and every baked clip sees the detached hierarchy.
 */
function detachCapeFromArms(scene) {
  const bones = [];
  scene.traverse((o) => { if (o.isBone) bones.push(o); });
  // The chest the cape is re-hung under. Named for the Clorinde rig; the generic
  // fallback keeps the other rips working if one happens to hang cloth off an arm.
  const anchor = bones.find((b) => b.name === 'Chest_0175_439')
    || bones.find((b) => /(chest|spine|torso)/i.test(b.name) && !/(top|end|tip)/i.test(b.name));
  if (!anchor) return;

  // Collect first, then move: none of these is an ancestor of another, and the
  // anchor is always an ancestor of the arm, so no move can invalidate a later
  // world matrix or create a cycle.
  const matches = bones.filter((b) => {
    const p = b.parent;
    return !!p && p.isBone && CAPE_PARENT.test(p.name) && CAPE_CLOTH.test(b.name);
  });
  if (!matches.length) return;

  scene.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  for (const bone of matches) {
    // newLocal = inverse(newParent.matrixWorld) * bone.matrixWorld, so the
    // bone's world matrix — and therefore the skinned result — is unchanged.
    inv.copy(anchor.matrixWorld).invert();
    local.multiplyMatrices(inv, bone.matrixWorld);
    bone.parent.remove(bone);
    anchor.add(bone);
    bone.matrix.copy(local);
    local.decompose(bone.position, bone.quaternion, bone.scale);
    bone.updateMatrix();
  }
  scene.updateMatrixWorld(true);
}

/** Everything createExternalGirl needs, derived once per uploaded model. */
export function prepareTemplate(scene) {
  fixImportedMaterials(scene, {lightUnlit:true});
  detachCapeFromArms(scene);
  const fit = fitToHeight(scene);
  return { scene, normScale: fit.scale, baseOffsetY: fit.baseOffsetY };
}

// --------------------------------------------------------------- bone mapping

function sideOf(name) {
  const n = name.toLowerCase();
  if (n.includes('left')) return 'L';
  if (n.includes('right')) return 'R';
  if (/(^|[^a-z])l([^a-z]|$)/.test(n)) return 'L';
  if (/(^|[^a-z])r([^a-z]|$)/.test(n)) return 'R';
  return '';
}

// Checked top-down: the first rule that claims a bone wins, so narrow patterns
// (knee) must come before broad ones (hips).
const RULES = [
  { key: 'knee', side: true, re: /(shin|calf|knee|lowerleg|(^|[^a-z])leg([^a-z]|$))/i, not: /(upleg|upperleg|thigh)/i },
  { key: 'foot', side: true, re: /(foot|ankle|toe)/i, not: /(toebase|toe_?end)/i },
  { key: 'shoulder', side: true, re: /(shoulder|clavicle)/i, not: null },
  { key: 'elbow', side: true, re: /(forearm|lowerarm|elbow)/i, not: null },
  { key: 'hand', side: true, re: /(hand|wrist)/i, not: /(thumb|index|middle|ring|pinky|finger)/i },
  { key: 'spine', side: false, re: /(spine|chest|torso)/i, not: /(top|end|tip)/i },
  { key: 'hips', side: false, re: /(hips?|pelvis)/i, not: /(upleg|upperleg|thigh)/i },
  { key: 'head', side: false, re: /head/i, not: /(top|end|tip)/i },
];

/**
 * Best-effort mapping from a rig's bone names onto our joint keys.
 * Shorter names win, which reliably prefers "LeftArm" over "LeftArmTwist1".
 * @returns {Record<string, string>} jointKey -> bone name (unmapped keys absent)
 */
export function autoMapJointNames(bones) {
  const map = {};
  const used = new Set();
  for (const rule of RULES) {
    const sides = rule.side ? ['L', 'R'] : [''];
    for (const side of sides) {
      const key = rule.key + side;
      const pool = bones.filter((n) => {
        if (used.has(n) || !rule.re.test(n)) return false;
        if (rule.not && rule.not.test(n)) return false;
        if (rule.side) return sideOf(n) === side;
        return true;
      });
      if (!pool.length) continue;
      // prefer a name with no side marker, then the shortest name
      pool.sort((a, b) => (sideOf(a) ? 1 : 0) - (sideOf(b) ? 1 : 0) || a.length - b.length);
      map[key] = pool[0];
      used.add(pool[0]);
    }
  }
  return map;
}

// ------------------------------------------------------------------- cloning

/**
 * Deep-clone a skinned hierarchy and rebuild each Skeleton against the cloned
 * bones. Equivalent to what SkeletonUtils.clone does, without vendoring it.
 */
function cloneSkinned(source) {
  const clone = source.clone(true);
  const srcBones = [];
  const dstBones = [];
  source.traverse((o) => { if (o.isBone) srcBones.push(o); });
  clone.traverse((o) => { if (o.isBone) dstBones.push(o); });
  const pair = new Map();
  for (let i = 0; i < srcBones.length; i++) pair.set(srcBones[i], dstBones[i]);

  clone.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const skel = o.skeleton;
    const bones = skel.bones.map((b) => pair.get(b) || b);
    o.bind(new THREE.Skeleton(bones, skel.boneInverses), o.bindMatrix);
  });
  return clone;
}

// -------------------------------------------------------------- driven rig

const _euler = new THREE.Euler();
const _delta = new THREE.Quaternion();

// Derivatives share immutable vertex attributes with the template, but own their
// cropped index buffers and material groups. Reuse them across respawns; never
// edit the original geometry also used by third-person/network avatars.
const firstPersonGeometry = new WeakMap();
function armsGeometry(mesh, armBones) {
  const source = mesh.geometry;
  const joints = mesh.skeleton.bones.map(b => armBones.has(b));
  const signature = joints.map((arm, i) => arm ? i : '').join(',');
  let variants = firstPersonGeometry.get(source);
  if (!variants) firstPersonGeometry.set(source, variants = new Map());
  if (variants.has(signature)) return variants.get(signature);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) out.setAttribute(name, attr);
  out.morphAttributes = source.morphAttributes;
  out.morphTargetsRelative = source.morphTargetsRelative;
  const skin = source.getAttribute('skinIndex'), weights = source.getAttribute('skinWeight');
  const count = source.index ? source.index.count : source.getAttribute('position').count;
  const belongs = new Uint8Array(source.getAttribute('position').count);
  if (skin && weights) {
    for (let v = 0; v < belongs.length; v++) {
      let armWeight = 0;
      for (let j = 0; j < skin.itemSize; j++) if (joints[skin.getComponent(v, j)]) armWeight += weights.getComponent(v, j);
      belongs[v] = armWeight >= 0.35;
    }
  }
  const indices = [];
  for (const group of source.groups.length ? source.groups : [{ start:0, count, materialIndex:0 }]) {
    const start = indices.length, end = Math.min(count, group.start + group.count);
    for (let i = group.start; i + 2 < end; i += 3) {
      const a = source.index ? source.index.getX(i) : i;
      const b = source.index ? source.index.getX(i+1) : i+1;
      const c = source.index ? source.index.getX(i+2) : i+2;
      if (belongs[a] && belongs[b] && belongs[c]) indices.push(a,b,c);
    }
    if (indices.length > start) out.addGroup(start, indices.length-start, group.materialIndex);
  }
  out.setIndex(indices);
  out.userData.armsOnly = true;
  variants.set(signature, out);
  return out;
}

/**
 * An imported character, exposed with exactly the same surface as createGirl:
 * { root, marker, shadow, height, setWeapon, setAlive, destroy, update }.
 *
 * Retargeted clips drive the body, with a procedural fallback. The weapon is
 * attached to the calibrated animated torso; two-bone IK and anatomical hand
 * frames fit the arms/fingers independently of the uploaded bone axes.
 *
 * @param {{scene:THREE.Object3D, normScale:number, baseOffsetY:number}} template
 * @param {object} meta uploaded metadata: { bones, offsets, scale, rotY }
 */
export function createExternalGirl({ template, meta, data, team }) {
  const root = new THREE.Group();
  const holder = new THREE.Group();
  root.add(holder);

  const rig = cloneSkinned(template.scene);
  holder.add(rig);

  const k = Math.max(0.2, Math.min(5, Number(meta?.scale) || 1));
  holder.scale.setScalar(template.normScale * k);
  holder.rotation.y = THREE.MathUtils.degToRad(Number(meta?.rotY) || 0);
  const baseY = template.baseOffsetY * k;
  holder.position.y = baseY;

  // capture rest poses and per-joint offsets for every mapped bone
  const bones = meta?.bones || {};
  const offsets = meta?.offsets || {};
  // GLTFLoader sanitises whitespace/dots in node names to '_', so a hand-written
  // map entry like 'Right shoulder_084' has to resolve against 'Right_shoulder_084'.
  const norm = (s) => s.replace(/[\s.]+/g, '_');
  const boneIndex = new Map();
  rig.traverse((o) => { if (o.isBone) boneIndex.set(norm(o.name), o); });
  const driven = {};
  for (const key of JOINT_KEYS) {
    const name = bones[key];
    if (!name) continue;
    const bone = rig.getObjectByName(name) || boneIndex.get(norm(name));
    if (!bone) continue;
    const o = offsets[key] || [0, 0, 0];
    driven[key] = {
      bone,
      rest: bone.quaternion.clone(),
      offX: THREE.MathUtils.degToRad(Number(o[0]) || 0),
      offY: THREE.MathUtils.degToRad(Number(o[1]) || 0),
      offZ: THREE.MathUtils.degToRad(Number(o[2]) || 0),
    };
  }

  // Capture fingers before any animation mixer or procedural arm pose runs.
  const handGrips = {
    R: prepareHandGrip(driven.handR?.bone, 'R'),
    L: prepareHandGrip(driven.handL?.bone, 'L'),
  };
  const gripGunRotation = new THREE.Quaternion();
  function solveGrip(side, contact, pole, gunRotation, shape=st.weapon?.shape) {
    if (!driven['hand' + side]) return Infinity;
    const grip = handGrips[side];
    const target = grip && gunRotation ? grip.targetFor(contact, gunRotation, shape) : contact;
    solveArm(side, target, pole);
    if (grip && gunRotation) grip.apply();
    return driven['hand' + side].bone.getWorldPosition(new THREE.Vector3()).distanceTo(target);
  }

  let lastArmReachError = Infinity;
  let armsOnly = false;
  let hasArmGeometry = false;
  const fullBodyMeshes = new Map();

  const { marker, shadow } = buildFactionOverlay(root, team, data, root, TARGET_HEIGHT * k + 0.40);
  // The gun hangs off the body root, never a hand bone: bone scale and unknown
  // local axes would stretch and twist it. update() parks it on the chest and
  // then solves both arms onto its two grips.
  const weaponMount = new THREE.Group();
  weaponMount.name = 'third-person-weapon-mount';
  root.add(weaponMount);

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  const st = { phase: Math.random() * 6.28, t: Math.random() * 10, crouch: 0, gait: 0, weapon: null, dead: false, lastWeaponPose: {} };

  // ---- retargeted run + upper-body clips -----------------------------------
  // The lower body runs off a baked Mixamo cycle once it is ready; the arms are
  // driven by the upper-body layer of the same bake when the player is firing,
  // reloading or throwing, and by the gun IK otherwise. Standing still drops back
  // to the procedural cycle, which owns the legs but still hands the arms to
  // whichever of those two is active.
  const boneRest = [];
  rig.traverse((o) => { if (o.isBone) boneRest.push([o, o.quaternion.clone()]); });
  const motion = {
    ready: false, run: null, upper: null,
    on: false,                       // hysteretic "clip mode" latch (see update)
    mixer: null, action: null, id: null, active: false,
    upperMixer: null, upperAction: null, upperId: null,
    prev: root.position.clone(), hasPrev: false,
  };
  ensureMotions(template).then((clips) => {
    if (!clips) return;
    motion.run = clips.run;
    motion.upper = clips.upper;
    motion.ready = true;
  });

  // ---- derived leg chains ---------------------------------------------------
  // Auto-mapping stops at one joint per limb and on every rig here that joint is
  // the thigh. A believable walk needs the whole chain (thigh -> knee -> ankle ->
  // toe), so the rest of it is read off the hierarchy, which is the one thing all
  // these skeletons agree on regardless of how the bones are named.
  const legs = {};
  function findDown(bone, re, depth) {
    if (!bone || depth <= 0) return null;
    const kids = bone.children.filter((c) => c.isBone);
    for (const kid of kids) if (re.test(kid.name)) return kid;
    for (const kid of kids) { const hit = findDown(kid, re, depth - 1); if (hit) return hit; }
    return null;
  }
  for (const sfx of ['L', 'R']) {
    const thigh = driven['knee' + sfx] ? driven['knee' + sfx].bone : null;
    if (!thigh) continue;
    const knee = findDown(thigh, /knee/i, 2);
    const ankle = findDown(thigh, /ankle/i, 3);
    const toe = findDown(thigh, /toe/i, 4);
    // rest quaternions: rotateSide() premultiplies a world-space delta, so the
    // chain has to be wound back to its bind pose every frame or the rotations
    // integrate and the leg spins off the body.
    legs[sfx] = {
      thigh, knee, ankle, toe,
      rest: [thigh, knee, ankle, toe].map((b) => (b ? b.quaternion.clone() : null)),
    };
  }

  // The pelvis, which the lower layer's clip now drives. Resolved here while the
  // rig is still on its bind pose; the sway damper in update() attenuates its
  // rotation and compensates the thighs for whatever it takes away.
  const pelvisBone = (driven.hips && driven.hips.bone)
    || (legs.L && legs.L.thigh && legs.L.thigh.parent && legs.L.thigh.parent.isBone ? legs.L.thigh.parent : null)
    || (legs.R && legs.R.thigh && legs.R.thigh.parent && legs.R.thigh.parent.isBone ? legs.R.thigh.parent : null);

  // Torso chain (spine up to head) for the sway damper. Read off the hierarchy
  // so it works for every rig: walk from the head up to the spine. Chest and
  // neck carry no local animation on these rips, so damping them is a no-op —
  // they are in the list so the chain stays correct if that ever changes.
  const torsoChain = [];
  if (driven.spine && driven.head) {
    let b = driven.head.bone;
    while (b) { torsoChain.push(b); if (b === driven.spine.bone) break; b = b.parent; }
  }
  const swayAvg = new Map();            // bone -> its own slow-average local rotation
  const _swA = new THREE.Quaternion();
  const _swP = new THREE.Quaternion();
  const _swQ = new THREE.Quaternion();

  // Height of the lower ankle in the rest pose. Keeping it pinned at that height
  // is what grounds the feet: as the knee bends the ankle rises, the hips are
  // pushed down by the same amount, and the up/down bob falls out for free.
  const _ankleLocal = new THREE.Vector3();
  holder.position.y = baseY;
  root.updateMatrixWorld(true);
  let groundAnkleY = null;
  for (const sfx of ['L', 'R']) {
    const ch = legs[sfx];
    if (!ch || !ch.ankle) continue;
    ch.ankle.getWorldPosition(_ankleLocal);
    root.worldToLocal(_ankleLocal);
    groundAnkleY = groundAnkleY === null ? _ankleLocal.y : Math.min(groundAnkleY, _ankleLocal.y);
  }

  // ---- mirrored duplicate armatures -----------------------------------------
  // Some rips ship a second, parallel armature: a material — the hair —
  // bound to its own copy of the skeleton, rooted at a sibling of the body's
  // root and carrying none of the names we map. Left alone it stays welded to
  // the bind pose while the body animates, so the head turns out from under the
  // hair and the bare scalp shows. Mirror the driven bone's world-space rotation
  // change onto the matching bone of every other armature, matched by rest world
  // position: the two copies sit on top of each other there whatever roll each
  // individual bone carries, which is what makes the match reliable.
  const mirrorPairs = [];
  // roots of the other armatures, kept so first person can collapse them too
  const secondaryRoots = [];
  {
    const seed = JOINT_KEYS.map((key) => driven[key] && driven[key].bone).find(Boolean);
    if (seed) {
      let primary = seed;
      while (primary.parent && primary.parent.isBone) primary = primary.parent;
      const others = [];
      root.traverse((o) => { if (o.isBone && !(o.parent && o.parent.isBone) && o !== primary) others.push(o); });
      if (others.length) {
        secondaryRoots.push(...others);
        root.updateMatrixWorld(true);
        const pBones = [];
        const pPos = [];
        const pQuat = [];
        primary.traverse((o) => {
          if (!o.isBone) return;
          pBones.push(o);
          pPos.push(o.getWorldPosition(new THREE.Vector3()));
          pQuat.push(o.getWorldQuaternion(new THREE.Quaternion()));
        });
        const MATCH = 0.005;   // the copies coincide to within a few millimetres
        const _p = new THREE.Vector3();
        for (const other of others) {
          other.traverse((sb) => {
            if (!sb.isBone) return;
            sb.getWorldPosition(_p);
            let best = -1;
            let bestD = MATCH * MATCH;
            for (let i = 0; i < pBones.length; i++) {
              const d = pPos[i].distanceToSquared(_p);
              if (d <= bestD) { bestD = d; best = i; }
            }
            if (best < 0) return;
            mirrorPairs.push({
              s: sb,
              p: pBones[best],
              pRest: pQuat[best],
              sRest: sb.getWorldQuaternion(new THREE.Quaternion()),
            });
          });
        }
      }
    }
  }

  const _mNow = new THREE.Quaternion();
  const _mDelta = new THREE.Quaternion();
  const _mTmp = new THREE.Quaternion();
  const _mParentQ = new THREE.Quaternion();
  const _mIdent = new THREE.Matrix4();

  /** Keep every duplicate armature in lockstep with the one we actually drive. */
  function mirrorSecondary() {
    if (!mirrorPairs.length) return;
    root.updateMatrixWorld(true);
    for (const pr of mirrorPairs) {
      pr.p.getWorldQuaternion(_mNow);
      _mDelta.copy(_mNow).multiply(_mTmp.copy(pr.pRest).invert());
      _mTmp.copy(_mDelta).multiply(pr.sRest);
      if (pr.s.parent) pr.s.parent.getWorldQuaternion(_mParentQ); else _mParentQ.identity();
      pr.s.quaternion.copy(_mParentQ.invert()).multiply(_mTmp);
      pr.s.matrix.compose(pr.s.position, pr.s.quaternion, pr.s.scale);
      pr.s.matrixWorld.multiplyMatrices(pr.s.parent ? pr.s.parent.matrixWorld : _mIdent, pr.s.matrix);
    }
  }

  function apply(key, ex, ey, ez) {
    const d = driven[key];
    if (!d) return;
    _euler.set(ex + d.offX, ey + d.offY, ez + d.offZ);
    _delta.setFromEuler(_euler);
    d.bone.quaternion.copy(d.rest).multiply(_delta);
  }

  // ---- two-bone arm IK -----------------------------------------------------
  // Imported rigs share no bone axes, so nothing here assumes one: every rotation
  // is a world-space delta derived from where the joints actually are (child head
  // minus parent head), which holds for any humanoid skeleton.

  const _pQ = new THREE.Quaternion();
  const _invQ = new THREE.Quaternion();
  const _dq = new THREE.Quaternion();
  const _wq = new THREE.Quaternion();
  const _sA = new THREE.Vector3();
  const _sB = new THREE.Vector3();
  const _sC = new THREE.Vector3();
  const _dirA = new THREE.Vector3();
  const _dirB = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const _pick = new THREE.Vector3();
  const _chest = new THREE.Vector3();
  const _chestAlt = new THREE.Vector3();
  const _grip = new THREE.Vector3();
  const _fore = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _poleR = new THREE.Vector3();
  const _poleL = new THREE.Vector3();
  const _axisSide = new THREE.Vector3();

  /** World-space rotate: new world = dq * old world, written back as a local quat. */
  function applyWorldDelta(bone, dq) {
    const parent = bone.parent;
    if (!parent) { bone.quaternion.premultiply(dq).normalize(); return; }
    parent.getWorldQuaternion(_pQ).normalize();
    _invQ.copy(_pQ).invert();
    bone.quaternion.premultiply(_pQ).premultiply(dq).premultiply(_invQ).normalize();
  }

  /**
   * Rotate a leg bone about the character's own left-right axis. Every joint of
   * the leg turns about that single axis (the sagittal plane), and because the
   * axis is expressed in world space it does not matter how the rig named or
   * oriented the bone: a positive angle always swings the limb tip backwards
   * (hip extension, knee flexion, ankle plantarflexion).
   */
  function rotateSide(bone, angle) {
    if (!bone || !angle) return;
    root.getWorldQuaternion(_wq);
    _axisSide.set(1, 0, 0).applyQuaternion(_wq);
    _dq.setFromAxisAngle(_axisSide, angle);
    applyWorldDelta(bone, _dq);
    root.updateMatrixWorld(true);
  }

  /**
   * Yaw a leg bone about the character's own up axis — the transverse-plane
   * rotation that turns a step in or out. Kept separate from rotateSide, which
   * owns the sagittal swing: a positive angle here turns the limb toward +X,
   * i.e. the character's LEFT, so callers mirror the sign per leg.
   */
  function rotateUp(bone, angle) {
    if (!bone || !angle) return;
    root.getWorldQuaternion(_wq);
    _axisSide.set(0, 1, 0).applyQuaternion(_wq);
    _dq.setFromAxisAngle(_axisSide, angle);
    applyWorldDelta(bone, _dq);
    root.updateMatrixWorld(true);
  }

  /**
   * Bend one arm so its hand reaches `target`, with the elbow pushed toward
   * `pole`. Solved analytically rather than by aiming the upper arm straight at
   * the target, which would lock the elbow and read as a mannequin.
   */
  function solveArm(sfx, target, pole) {
    const el = driven['elbow' + sfx];
    const hd = driven['hand' + sfx];
    if (!el || !hd) return;
    const up = upperArm(sfx);
    if (!up) return;

    const A = up.getWorldPosition(_sA).clone();
    const B0 = el.bone.getWorldPosition(_sB).clone();
    const C0 = hd.bone.getWorldPosition(_sC).clone();
    const l1 = A.distanceTo(B0);
    const l2 = B0.distanceTo(C0);
    if (l1 < 1e-4 || l2 < 1e-4) return;

    const toT = target.clone().sub(A);
    let d = toT.length();
    if (d < 1e-4) return;
    const u = toT.divideScalar(d);
    d = Math.max(Math.min(d, (l1 + l2) * 0.995), Math.abs(l1 - l2) + l1 * 0.05);

    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const alpha = Math.acos(cosA);
    _axis.crossVectors(u, pole);
    if (_axis.lengthSq() < 1e-8) _axis.set(0, 1, 0).cross(u);
    _axis.normalize();

    // two mirror-image elbow spots; keep the one on the pole side
    const e1 = u.clone().applyAxisAngle(_axis, alpha).multiplyScalar(l1).add(A);
    const e2 = u.clone().applyAxisAngle(_axis, -alpha).multiplyScalar(l1).add(A);
    const pick1 = _pick.copy(e1).sub(A).dot(pole);
    const pick2 = _pick.copy(e2).sub(A).dot(pole);
    const E = pick1 >= pick2 ? e1 : e2;

    // 1) upper arm points at the elbow
    const B1 = el.bone.getWorldPosition(_sB).clone();
    _dirA.copy(B1).sub(A).normalize();
    _dirB.copy(E).sub(A).normalize();
    _dq.setFromUnitVectors(_dirA, _dirB);
    applyWorldDelta(up, _dq);
    root.updateMatrixWorld(true);

    // 2) forearm points at the target, which drops the hand exactly on it
    const B2 = el.bone.getWorldPosition(_sB).clone();
    const C1 = hd.bone.getWorldPosition(_sC).clone();
    _dirA.copy(C1).sub(B2).normalize();
    _dirB.copy(target).sub(B2).normalize();
    _dq.setFromUnitVectors(_dirA, _dirB);
    applyWorldDelta(el.bone, _dq);
    root.updateMatrixWorld(true);
  }

  /**
   * The bone that actually swings the arm: the forearm's parent. The mapped
   * "shoulder" cannot be trusted — on one rig it is a clavicle, on another an
   * unrelated torso bone that is not even an ancestor of the elbow.
   */
  function upperArm(sfx) {
    const el = driven['elbow' + sfx];
    if (!el) return null;
    if (el.bone.parent && el.bone.parent.isBone) return el.bone.parent;
    return driven['shoulder' + sfx] ? driven['shoulder' + sfx].bone : null;
  }

  /** Midpoint of the two shoulders — roughly the top of the chest. */
  function chestCenter(out) {
    const ul = upperArm('L');
    const ur = upperArm('R');
    if (ul && ur) {
      ul.getWorldPosition(out);
      ur.getWorldPosition(_chestAlt);
      return out.add(_chestAlt).multiplyScalar(0.5);
    }
    const sp = driven.spine;
    return sp ? sp.bone.getWorldPosition(out) : null;
  }

  // Attach to the lowest COMMON TORSO ancestor, not an arm/wrist and not the
  // unanimated avatar root. Retargeted clips rotate/lean this chest independently
  // of root yaw. Capture its bind frame before any mixer/IK writes it. Keeping
  // the mount under root avoids inheriting the GLB bone's arbitrary scale/axes.
  const armL = upperArm('L'), armR = upperArm('R');
  const rightAncestors = new Set();
  for (let b = armR; b; b = b.parent) rightAncestors.add(b);
  let weaponChest = armL?.parent;
  while (weaponChest && !rightAncestors.has(weaponChest)) weaponChest = weaponChest.parent;
  weaponChest = weaponChest?.isBone ? weaponChest : driven.spine?.bone || null;
  root.updateMatrixWorld(true);
  const chestBindInverse = weaponChest ? weaponChest.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
  const chestBindPoint = chestCenter(new THREE.Vector3()) || new THREE.Vector3(0,TARGET_HEIGHT*k*.78,0);
  if (weaponChest) weaponChest.worldToLocal(chestBindPoint);
  const carryRotation = new THREE.Quaternion(), rootRotation = new THREE.Quaternion();
  const holdRotation = new THREE.Quaternion(), carryContact = new THREE.Vector3();
  let weaponPlacement=placement();
  const placementRotation=new THREE.Quaternion();
  const placementReach={right:0,left:0};
  // A short character must grip nearer the receiver rather than stretch the
  // support arm off the gun. This selects another point along the fore-stock;
  // it does not shrink the weapon to fit or change FP sockets/ballistics.
  const supportSpan = armL && driven.elbowL && driven.handL
    ? Math.min(MAX_SUPPORT_SPAN, SUPPORT_REACH_FRACTION*(armL.getWorldPosition(new THREE.Vector3()).distanceTo(driven.elbowL.bone.getWorldPosition(new THREE.Vector3()))
      + driven.elbowL.bone.getWorldPosition(new THREE.Vector3()).distanceTo(driven.handL.bone.getWorldPosition(new THREE.Vector3())))/k) : MAX_SUPPORT_SPAN;

  /** Seat the rifle on its trigger contact in the animated chest's frame. */
  function placeWeapon(s) {
    root.getWorldQuaternion(rootRotation);
    if (weaponChest) {
      weaponChest.getWorldQuaternion(carryRotation).multiply(chestBindInverse);
      carryRotation.premultiply(rootRotation.invert()).normalize();
      weaponChest.localToWorld(_chest.copy(chestBindPoint));
      root.worldToLocal(_chest);
    } else {
      carryRotation.identity();
      _chest.copy(chestBindPoint);
    }
    // No accumulated Euler increments or procedural circular side/forward sway.
    const reload=st.reloadPose;
    holdRotation.setFromEuler(_euler.set(-.08-THREE.MathUtils.degToRad(s.pitch || 0)+(reload?.rotation[0]||0),reload?.rotation[1]||0,-.03+(reload?.rotation[2]||0)));
    holdRotation.multiply(placementRotation);
    weaponMount.quaternion.copy(carryRotation).multiply(holdRotation);
    weaponMount.scale.setScalar(k);
    carryContact.copy(CARRY_HAND);
    if(st.weapon?.shape==='pistol'){carryContact.y-=.025;carryContact.z+=.20;}
    if(reload){carryContact.x+=reload.position[0];carryContact.y+=reload.present*.045;}
    carryContact.add(_grip.fromArray(weaponPlacement.position));
    carryContact.multiplyScalar(k).applyQuaternion(carryRotation).add(_chest);
    _grip.fromArray(st.grips.hand).multiplyScalar(k).applyQuaternion(weaponMount.quaternion);
    weaponMount.position.copy(carryContact).sub(_grip);
    root.updateMatrixWorld(true);
  }

  /** Solve both arms onto the gun's two grips. */
  function solveArms(support = true) {
    const g = st.grips;
    _grip.set(g.hand[0], g.hand[1], g.hand[2]);
    weaponMount.localToWorld(_grip);
    if(st.reloadPose){const v=st.reloadPose.fore;_fore.set(v[0]+.04,v[1]-.03,v[2]+.06);}
    else _fore.set(g.fore[0], g.fore[1], g.fore[2]);
    weaponMount.localToWorld(_fore);

    // elbows splay outwards and down; the left-to-right axis comes from the
    // elbows themselves, since the mapped "shoulder" bones may sit on the spine
    const eL = driven.elbowL && driven.elbowL.bone.getWorldPosition(_sA).clone();
    const eR = driven.elbowR && driven.elbowR.bone.getWorldPosition(_sB).clone();
    if (!eL || !eR) return;
    _right.copy(eR).sub(eL).normalize();
    _poleR.copy(_right).multiplyScalar(0.7).add(_down).normalize();
    _poleL.copy(_right).multiplyScalar(-0.55).add(_down).normalize();

    weaponMount.getWorldQuaternion(gripGunRotation);
    placementReach.right=solveGrip('R', _grip, _poleR, gripGunRotation);
    placementReach.left=support?solveGrip('L', _fore, _poleL, gripGunRotation):null;
  }

  /** Put the gun where the current body/arm pose wants it. */
  function layWeapon(s, upperKey) {
    if (st.dead || !st.weapon) return;
    // Never derive the next mount from wrists that IK modified last frame:
    // frozen/crossfaded clips do not rewrite every wrist, causing feedback and
    // an orbiting rifle. Use the animated torso bind frame, including rotation,
    // not just its position with the unanimated root's orientation.
    st.reloadPose=s.reloading?weaponReloadPose(st.weapon,s.reloadProgress||0,st.foreBase):null;
    if(st.foreAnchor)st.foreAnchor.position.fromArray(st.reloadPose?.fore||st.foreBase);
    placeWeapon(s);
    // The weapon hand NEVER follows the throw/reload clip away from its grip.
    // Only the support hand may leave for the gesture.
    solveArms(upperKey !== 'toss');
  }

  /**
   * Pose one leg for the point in the cycle `p` (0 = heel strike, PI = toe-off),
   * then swing. Angles are the classic gait curves:
   *   hip   — flexed forward at strike, extended behind at toe-off
   *   knee  — small loading flex just after strike, deep flex through swing
   *   ankle — dorsiflexed at strike, plantarflexed to push off, dorsiflexed again
   *           in swing so the toe clears the ground
   *   toe   — rolls up over the foot at toe-off instead of scraping
   * Every leg keeps a few degrees of knee flex, because a locked-straight leg is
   * the single thing that makes a walk read as a sliding mannequin.
   */
  function poseLeg(sfx, p, a) {
    const chain = legs[sfx];
    if (!chain) return;
    const chainBones = [chain.thigh, chain.knee, chain.ankle, chain.toe];
    for (let i = 0; i < chainBones.length; i++) {
      if (chainBones[i]) chainBones[i].quaternion.copy(chain.rest[i]);
    }
    // the offsets dialled in on the settings screen for the two mapped leg
    // joints still ride on top of the rest pose
    for (const [key, b] of [['knee' + sfx, chain.thigh], ['foot' + sfx, chain.ankle]]) {
      const d = driven[key];
      if (!d || !b || (!d.offX && !d.offY && !d.offZ)) continue;
      _euler.set(d.offX, d.offY, d.offZ);
      _delta.setFromEuler(_euler);
      b.quaternion.multiply(_delta);
    }
    const g = a.gait;
    const hip = (-a.hip * Math.cos(p)) * g + a.cHip;
    const knee = (0.10
      + 16 * DEG * bump(p, 0.30 * Math.PI, 0.35)
      + a.knee * bump(p, 1.35 * Math.PI, 0.55)) * g + a.cKnee;
    const ankle = (-4 * DEG
      + a.push * bump(p, 0.95 * Math.PI, 0.45)
      - 6 * DEG * bump(p, 0.45 * Math.PI, 0.5)) * g + a.cAnkle;
    const toe = (-a.toe * bump(p, Math.PI, 0.35)) * g;

    rotateSide(chain.thigh, hip);
    rotateSide(chain.knee, knee);
    rotateSide(chain.ankle, ankle);
    rotateSide(chain.toe, toe);
  }

  // ---- run-clip playback ---------------------------------------------------

  /** Put every bone back on its bind rotation, so the procedural pose starts clean. */
  function restoreRest() {
    for (const [b, q] of boneRest) b.quaternion.copy(q);
    root.updateMatrixWorld(true);
  }

  /**
   * Damp the torso sway of the run clip. Each torso bone — and the pelvis, which
   * is the root the whole upper body hangs from — keeps a slow average of its own
   * local rotation; the live value is blended toward that average, so the
   * back-and-forth oscillation shrinks while the mean pose (the run's forward
   * lean) survives untouched. See TORSO_SWAY.
   *
   * The pelvis needs care: the legs were baked against the clip's own pelvis, so
   * damping it would drag them off by the same delta. Pre-multiplying each thigh
   * by P^-1 * A (P the damped pelvis, A the clip's) restores their world
   * orientation exactly, so the legs keep running as before while the torso calms.
   */
  function dampSway(dt) {
    const a = 1 - Math.exp(-dt / TORSO_SWAY_TAU);
    const avgOf = (b) => {
      let sm = swayAvg.get(b);
      if (!sm) { sm = b.quaternion.clone(); swayAvg.set(b, sm); }
      return sm;
    };
    for (const b of torsoChain) {
      _swA.copy(b.quaternion);
      const sm = avgOf(b);
      sm.slerp(_swA, a);
      b.quaternion.copy(_swA).slerp(sm, TORSO_SWAY);
    }
    if (!pelvisBone) return;
    _swA.copy(pelvisBone.quaternion);              // A: the clip's pelvis
    const sm = avgOf(pelvisBone);
    sm.slerp(_swA, a);
    _swP.copy(_swA).slerp(sm, TORSO_SWAY);         // P: damped pelvis
    pelvisBone.quaternion.copy(_swP);
    _swQ.copy(_swP).invert().multiply(_swA);       // Q = P^-1 * A, in the hips frame
    for (const sfx of ['L', 'R']) {
      const ch = legs[sfx];
      if (ch && ch.thigh) ch.thigh.quaternion.premultiply(_swQ);
    }
  }

  /**
   * Which run cycle to play for a world-space step of (dx, dz): expressed in the
   * character's own frame (model faces +Z, right is -X), the heading rounds to
   * the nearest of the eight sectors.
   */
  const _mQ = new THREE.Quaternion();
  const _mL = new THREE.Vector3();
  function sectorOf(dx, dz) {
    root.getWorldQuaternion(_mQ);
    _mL.set(dx, 0, dz).applyQuaternion(_mQ.invert());
    const angle=Math.atan2(-_mL.x,_mL.z)/DEG;
    const current=RUN_SECTORS.indexOf(motion.id);
    if(current>=0 && Math.abs(((angle-current*45+540)%360)-180)<30)return current;
    let idx = Math.round(angle / 45) % 8;
    if (idx < 0) idx += 8;
    return idx;
  }

  /** Start (or keep) the run cycle for `id`, crossfading when the direction changes. */
  function playRun(id, speed, dt) {
    const run = motion.run;
    const clip = run[id] || run[RUN_SECTORS[0]];
    if (!clip) return;
    if (!motion.mixer) motion.mixer = new THREE.AnimationMixer(rig);
    const rate = THREE.MathUtils.clamp(speed / 4.8, 0.25, 1.5);
    const next = motion.mixer.clipAction(clip);
    if (motion.action === next) {
      next.setEffectiveTimeScale(rate);
    } else {
      const phase=motion.action ? (motion.action.time/motion.action.getClip().duration)%1 : 0;
      next.reset();
      next.time=phase*clip.duration;
      next.enabled = true;
      next.setEffectiveTimeScale(rate);
      next.setEffectiveWeight(1);
      next.play();
      if (motion.action) {
        next.crossFadeFrom(motion.action, 0.15, false);
      } else {
        // fadeIn scales the action's own weight by a 0->1 ramp, so the weight
        // must already be 1 (set above) or the ramp multiplies to nothing.
        next.fadeIn(0.18);
      }
      motion.action = next;
      motion.id = id;
    }
    motion.mixer.update(dt);
  }

  /** Baked arm chain per side, so leaving the upper layer can rewind it cleanly. */
  const armBones = [];
  for (const sfx of ['L', 'R']) {
    for (const b of [driven['shoulder' + sfx] && driven['shoulder' + sfx].bone,
      upperArm(sfx),
      driven['elbow' + sfx] && driven['elbow' + sfx].bone,
      driven['hand' + sfx] && driven['hand' + sfx].bone]) {
      if (b && !armBones.includes(b)) armBones.push(b);
    }
  }
  const armRest = armBones.map((b) => b.quaternion.clone());

  /** Rewind the arms to bind, so the gun IK (or nothing) starts from a clean pose. */
  function restoreArms() {
    for (let i = 0; i < armBones.length; i++) armBones[i].quaternion.copy(armRest[i]);
    root.updateMatrixWorld(true);
  }

  /**
   * Play the upper-body layer for the requested pose key, crossfading between
   * them. Lives on its own mixer so it runs in both the clip-driven and the
   * procedural branch without the two mixers writing the same bone.
   */
  function playUpper(key, dt) {
    const clips = motion.upper;
    if (!clips) return;
    const clip = clips[key] || clips.hold;
    if (!clip) return;
    if (!motion.upperMixer) motion.upperMixer = new THREE.AnimationMixer(rig);
    const next = motion.upperMixer.clipAction(clip);
    // The standing pose (`hold`, the shoot-rifle clip) is held on a single frozen
    // frame instead of played: it is a full idle cycle, so looping it made the
    // torso and arms drift while the player stood still doing nothing. Paused and
    // parked on its first frame, it still drives every joint — the body just
    // stops moving. Everything else (run/fire/reload/toss) animates as before.
    const frozen = key === 'hold';
    if (next !== motion.upperAction) {
      next.reset();
      next.enabled = true;
      next.paused = frozen;
      next.setEffectiveTimeScale(frozen ? 0 : 1);
      next.time = 0;
      next.setEffectiveWeight(1);
      next.play();
      if (motion.upperAction) next.crossFadeFrom(motion.upperAction, 0.15, false);
      else next.fadeIn(0.18);   // weight is already 1; the ramp blends in from rest
      motion.upperAction = next;
      motion.upperId = key;
    }
    motion.upperMixer.update(dt);
  }

  /** Stop the upper layer and put the arms back so the gun IK can take over. */
  function stopUpper() {
    if (motion.upperMixer) motion.upperMixer.stopAllAction();
    motion.upperAction = null;
    motion.upperId = null;
  }

  /**
   * Drive the upper layer from the requested pose key, or hand the arms back to
   * the gun IK once the gesture finishes. Returns nothing; the caller decides
   * whether to solve the arms onto the gun afterwards (it only does so when this
   * returned no active key).
   */
  function updateUpper(key, dt) {
    if (key) {
      playUpper(key, dt);
    } else if (motion.upperAction) {
      stopUpper();
      restoreArms();
    }
  }

  /**
   * Ground the lower ankle at its standing height. As a knee bends the ankle
   * rises, the hips are pushed down by the same amount, and the vertical bob
   * appears on its own — no hand-tuned sine, and the feet never float or sink
   * through the floor.
   */
  function groundFeet() {
    holder.position.y = baseY;
    root.updateMatrixWorld(true);
    if (groundAnkleY === null) return;
    let low = Infinity;
    for (const sfx of ['L', 'R']) {
      const ch = legs[sfx];
      if (!ch || !ch.ankle) continue;
      ch.ankle.getWorldPosition(_ankleLocal);
      root.worldToLocal(_ankleLocal);
      if (_ankleLocal.y < low) low = _ankleLocal.y;
    }
    if (low < Infinity) {
      holder.position.y = baseY + THREE.MathUtils.clamp(groundAnkleY - low, -0.055, 0.030);
    }
  }

  return {
    root, marker, shadow,
    skinId: '',
    height: TARGET_HEIGHT * k,

    setWeapon(weapon) {
      if (st.weapon === weapon) return;
      st.weapon = weapon;
      weaponPlacement=placement();placementRotation.identity();
      weaponMount.clear();
      const built = buildWeapon(weapon);
      built.group.position.set(0.04, -0.03, 0.06);
      weaponMount.add(built.group);
      const grips = mountedGrips(weapon);
      const hand = new THREE.Vector3().fromArray(grips.hand);
      const span = new THREE.Vector3().fromArray(grips.fore).sub(hand);
      if (span.length() > supportSpan) span.setLength(supportSpan);
      st.grips = { hand: grips.hand, fore: hand.add(span).toArray() };
      st.foreBase=st.grips.fore.map((v,i)=>v-[.04,-.03,.06][i]);
      st.foreAnchor=built.anchors.fore;
      built.anchors.fore.position.fromArray(st.foreBase);
      built.group.traverse((o) => { o.frustumCulled = false; });
      // Same contract as the built-in girl: this is where her shots flash from.
      st.muzzle = built.muzzle;
      st.eject = built.anchors.eject;
      // A newly spawned or LOD-throttled remote may not get update() this frame.
      // Seat a replacement immediately instead of drawing it at the old origin.
      const pose = st.lastWeaponPose;
      layWeapon(pose, pose.ability ? 'toss' : pose.reloading ? 'reload' : null);
      mirrorSecondary();
    },

    // Developer preview only: no global overrides or first-person changes.
    setWeaponPlacement(value) {
      weaponPlacement=placement(value);
      placementRotation.setFromEuler(_euler.set(weaponPlacement.rotation[0]*DEG,weaponPlacement.rotation[1]*DEG,weaponPlacement.rotation[2]*DEG));
      const s=st.lastWeaponPose;
      layWeapon(s,s.ability?'toss':s.reloading?'reload':null);
    },
    getWeaponPlacement() { return placement(weaponPlacement); },
    get weaponPlacementReach() { return {...placementReach}; },

    /** World position of this character's muzzle; false when she has no gun. */
    muzzleWorld(out) {
      if (!st.muzzle) return false;
      st.muzzle.getWorldPosition(out);
      return true;
    },

    ejectWorld(out) {
      if (!st.eject) return false;
      st.eject.getWorldPosition(out);
      return true;
    },

    setAlive(alive) {
      st.dead = !alive;
      root.visible = alive;
    },

    // Hide torso, legs, head, capes and static accessories by their actual skin
    // influences, not by hoping they stay behind the camera's near plane.
    setArmsOnly(enabled) {
      if (armsOnly === enabled) return hasArmGeometry;
      armsOnly = enabled;
      hasArmGeometry = false;
      if (enabled) {
        const armBones = new Set();
        for (const side of ['R', 'L']) {
          const upper = driven['elbow' + side]?.bone.parent;
          if (upper?.isBone) upper.traverse(b => { if (b.isBone) armBones.add(b); });
        }
        rig.traverse(mesh => {
          if (!mesh.isMesh) return;
          fullBodyMeshes.set(mesh, { geometry:mesh.geometry, visible:mesh.visible });
          if (mesh.isSkinnedMesh) {
            mesh.geometry = armsGeometry(mesh, armBones);
            mesh.visible = mesh.visible && mesh.geometry.index.count > 0;
            if (mesh.visible) hasArmGeometry = true;
          } else mesh.visible = false;
        });
      } else {
        for (const [mesh, original] of fullBodyMeshes) {
          mesh.geometry = original.geometry;
          mesh.visible = original.visible;
        }
        fullBodyMeshes.clear();
      }
      return hasArmGeometry;
    },
    get hasArmGeometry() { return hasArmGeometry; },
    get armReachError() { return lastArmReachError; },

    /**
     * First-person arms only. The rig is mounted with its eye at the lens, so the
     * head, hair and (on a hat-wearing rig like Navia's) the whole brim sit right
     * across the sight line, a few centimetres past the near plane where nothing
     * else can crop them. Collapsing the head bone pulls its entire subtree into a
     * point at the neck — hair and hat bones are its children on every rig here —
     * which drops it behind the near plane. The arms hang off the chest, so they
     * are untouched, and they are the only part first person ever shows.
     *
     * A rig may carry its hair on a second, parallel armature rather than under
     * the head bone, so collapsing the head alone would leave a full-size scalp
     * in front of the lens; those roots are collapsed here too (they are
     * mirrored, never driven, so nothing else depends on their scale).
     */
    setHeadHidden(hidden) {
      const h = driven.head;
      const s = hidden ? 0.001 : 1;
      for (const b of secondaryRoots) b.scale.setScalar(s);
      if (!h) {
        root.updateMatrixWorld(true);
        return false;
      }
      h.bone.scale.setScalar(s);
      root.updateMatrixWorld(true);
      return true;
    },

    /**
     * First-person arms only. This instance carries no weapon of its own — the
     * first-person gun lives in the viewmodel — so instead of parking a gun on
     * the chest we solve both arms straight onto two world-space grip points the
     * caller hands in, plus the live gun rotation for wrist/finger posing.
     * Returns false for missing arms or unreachable contacts so the caller can
     * keep the shaped glove pair instead of showing a disconnected hand.
     */
    poseArms(handTarget, foreTarget, gunRotation, shape) {
      lastArmReachError = Infinity;
      if (!driven.elbowR || !driven.handR || !driven.elbowL || !driven.handL) return false;
      root.updateMatrixWorld(true);
      const eL = driven.elbowL.bone.getWorldPosition(_sA).clone();
      const eR = driven.elbowR.bone.getWorldPosition(_sB).clone();
      _right.copy(eR).sub(eL).normalize();
      _poleR.copy(_right).multiplyScalar(0.7).add(_down).normalize();
      _poleL.copy(_right).multiplyScalar(-0.55).add(_down).normalize();
      const rightError = solveGrip('R', handTarget, _poleR, gunRotation, shape);
      const leftError = solveGrip('L', foreTarget, _poleL, gunRotation, shape);
      lastArmReachError = Math.max(rightError, leftError);
      return lastArmReachError < 0.07;
    },

    destroy() {
      shadow.geometry.dispose();shadow.material.dispose();
      marker.geometry.dispose();marker.material.dispose();
      root.removeFromParent();
    },

    update(dt, s) {
      st.lastWeaponPose = s;
      st.t += dt;
      const speed = s.speed || 0;

      // Clip mode is latched with hysteresis: enter above 0.6 but only leave
      // below 0.3. Without it a speed hovering on the threshold flips modes every
      // frame, and each leave rewinds every bone to bind (restoreRest) and each
      // re-entry fades a clip back in — the character visibly freezes mid-stride
      // and slides forward. (The other half of that bug was a stale action
      // reference on the exit path; see the note there.)
      if (!motion.on && speed > 0.6) motion.on = true;
      else if (motion.on && speed < 0.3) motion.on = false;
      const run = motion.on;
      const sprint = !!s.sprint;

      // Upper-body pose this frame: reload and the throw gesture take the hands
      // off the gun entirely, firing has its own cycle, running rides the
      // running-rifle clip, and an idle body keeps the standing rifle clip
      // (shoot-rifle) too rather than dropping back to the procedural gun IK —
      // the IK hold did not match the clip hold, so the arms snapped between two
      // different poses every time the player stopped. The IK survives only as
      // the fallback for a rig whose upper clips failed to bake (motion.upper
      // is null until they resolve, so the very first frames still use it).
      const upperKey = st.dead ? null
        : s.reloading ? 'reload'
          : s.ability ? 'toss'
            : s.firing ? 'fire'
              : run ? 'runHold'
                : motion.upper ? 'hold' : null;

      // Cadence rises with speed but is clamped to a human band. The game drives
      // the avatar near its sprint speed almost always, so tying footfall rate to
      // speed outright would spin it like a wind-up toy; clamped, the same cycle
      // reads as a brisk walk that turns into a run.
      const stepHz = THREE.MathUtils.clamp(0.85 + speed * 0.20, 0.85, 3.2);
      st.phase += dt * TAU * stepHz * 0.5 * (run ? (sprint ? 1.1 : 1) : 0.18);

      st.crouch += ((s.crouch ? 1 : 0) - st.crouch) * Math.min(1, dt * 12);
      st.gait += ((run ? 1 : 0) - st.gait) * Math.min(1, dt * 8);

      // ---- clip-driven run ---------------------------------------------------
      // Once the baked cycles are ready, running is played from them: pelvis,
      // spine, head and legs come from the clip, so the procedural joint writes
      // below are skipped. The arms are handed to the upper layer when it is
      // active and to the gun IK otherwise.
      if (motion.ready && run && !st.dead) {
        const dx = root.position.x - motion.prev.x;
        const dz = root.position.z - motion.prev.z;
        const len = Math.hypot(dx, dz);
        // guard a teleport (respawn) from masquerading as a heading
        const stepped = motion.hasPrev && len > 1e-4 && len < speed * dt * 4 + 0.35;
        const id = stepped ? RUN_SECTORS[sectorOf(dx, dz)] : (motion.id || RUN_SECTORS[0]);
        motion.prev.copy(root.position);
        motion.hasPrev = true;
        playRun(id, speed, dt);
        updateUpper(upperKey, dt);
        // The run clip (lower layer) owns the pelvis now, so it is no longer
        // pinned to bind — the running pelvis rotation drives the whole body.
        // Tame that plus the upper layer's spine swing so the torso stops rocking.
        dampSway(dt);

        root.updateMatrixWorld(true);
        if (st.crouch > 0.01) {
          const c = st.crouch;
          for (const sfx of ['L', 'R']) {
            const ch = legs[sfx];
            if (!ch) continue;
            rotateSide(ch.thigh, c * 0.22);
            rotateSide(ch.knee, c * 0.95);
            rotateSide(ch.ankle, -c * 0.55);
          }
        }
        // Pull the step in. +Y turns a limb toward +X (the character's left), so
        // the right leg takes the positive angle and the left the negative one,
        // which tucks both feet toward the centre line instead of splaying out.
        for (const sfx of ['L', 'R']) {
          const ch = legs[sfx];
          if (ch && ch.thigh) rotateUp(ch.thigh, (sfx === 'R' ? 1 : -1) * STEP_TOE_IN[sfx]);
        }
        groundFeet();
        marker.position.y = TARGET_HEIGHT * k + 0.40;
        layWeapon(s, upperKey);
        mirrorSecondary();
        motion.active = true;
        return;
      }

      // leaving a clip: rewind to the bind pose so the procedural cycle starts
      // from a clean slate rather than the clip's last frame
      if (motion.active) {
        motion.active = false;
        motion.id = null;
        motion.hasPrev = false;
        if (motion.mixer) motion.mixer.stopAllAction();
        // Drop the action reference too. clipAction() caches per clip, so
        // leaving it set made the next entry take the `motion.action === next`
        // branch and skip .play() — the action stayed disabled by
        // stopAllAction() and the body froze on its bind pose while still
        // sliding forward. That was the "animation disappears" bug.
        motion.action = null;
        // Drop the sway averages too: a stale average from the last run would
        // yank the torso toward a pose from a different clip on the next entry.
        swayAvg.clear();
        restoreRest();
      }
      motion.prev.copy(root.position);
      motion.hasPrev = true;

      // walk -> run blend, plus the crouch offsets folded into the same joints
      const t = THREE.MathUtils.clamp((speed - 1.2) / 6, 0, 1);
      const amp = {
        gait: st.gait,
        // Amplitudes are kept modest on purpose. The avatar always travels at
        // 9.5 m/s (13 m/s sprinting), so a full-length stride would swing the
        // legs so far that the grounded foot would drag the pelvis through a
        // 14 cm bounce. Reined in, the same cycle reads as a purposeful run.
        hip: THREE.MathUtils.lerp(0.22, 0.38, t),
        knee: THREE.MathUtils.lerp(0.60, 0.90, t),
        push: THREE.MathUtils.lerp(12, 20, t) * DEG,
        toe: THREE.MathUtils.lerp(14, 22, t) * DEG,
        cHip: st.crouch * 0.22,
        cKnee: st.crouch * 0.95,
        cAnkle: -st.crouch * 0.55,
      };

      const ph = st.phase;
      // pelvis and thorax twist in opposite directions; the head stays put
      const twist = Math.sin(ph) * 0.10 * st.gait;
      apply('spine', st.crouch * 0.26 + (run ? 0.10 : 0.02) + Math.sin(st.t * 1.9) * 0.008,
        -twist * 1.5, Math.sin(ph) * 0.035 * st.gait);
      apply('head', -THREE.MathUtils.degToRad(Math.max(-70, Math.min(70, s.pitch || 0))) * 0.55,
        twist * 0.6, 0);
      apply('hips', 0, twist, Math.sin(ph) * 0.03 * st.gait);

      poseLeg('L', ph, amp);
      poseLeg('R', ph + Math.PI, amp);

      groundFeet();

      marker.position.y = TARGET_HEIGHT * k + 0.40;

      updateUpper(upperKey, dt);
      layWeapon(s, upperKey);
      // after the body is posed, drag any duplicate armature along with it
      mirrorSecondary();
    },
  };
}

// ------------------------------------------------------------- settings screen

const LOCAL_KEY = 'tf.rig';
const SKIN_ID_KEY = 'tf.skinId';
const SKIN_NAME_KEY = 'tf.skinName';

/**
 * The "设置模式" screen: import a rig, map its bones, tune offsets, preview it
 * and publish it to the server so every player can pick it.
 *
 * @param {{data:object, hud:object, onUse:(skin:{id:string,name:string})=>void}} deps
 */
export function createSettings({ data, hud, onUse }) {
  const $ = (id) => document.getElementById(id);
  const el = {
    canvas: $('rig-preview'), file: $('rig-file'), status: $('rig-status'), name: $('rig-name'),
    bones: $('rig-bones'), scale: $('rig-scale'), scaleOut: $('rig-scale-out'),
    rotY: $('rig-rotY'), rotYOut: $('rig-rotY-out'), heightOut: $('rig-height-out'),
    offsets: $('rig-offset'), offsetTarget: $('rig-offset-target'), play: $('rig-play'),
    back: $('rig-back'), reset: $('rig-reset'), local: $('rig-local'), upload: $('rig-upload'),
    shared: $('rig-shared'),
  };

  const state = {
    file: null, template: null, bones: [], map: {}, offsets: {},
    scale: 1, rotY: 0, name: '', play: false, active: 'shoulderR', using: '',
  };

  // ---- preview viewport (its own context: the game canvas sits behind it) ----
  const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2f3c, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(3, 6, 4);
  scene.add(key);
  const grid = new THREE.GridHelper(6, 12, 0x4a5570, 0x2a3040);
  scene.add(grid);

  let visible = false;
  let preview = null;
  let pending = false;
  let camAngle = 0.6;
  let lastW = 0;
  let lastH = 0;

  // ------------------------------------------------------------------ preview

  function currentMeta() {
    return { bones: state.map, offsets: state.offsets, scale: state.scale, rotY: state.rotY };
  }

  function rebuild() {
    if (preview) { preview.destroy(); preview = null; }
    if (!state.template) return;
    try {
      preview = createExternalGirl({
        template: state.template, meta: currentMeta(), data, team: data.teamById[0],
      });
      scene.add(preview.root);
    } catch (err) {
      setStatus(t('预览失败：{why}', { why: err.message }), true);
    }
  }

  function scheduleRebuild() {
    pending = true;
  }

  function setStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.classList.toggle('error', !!isError);
    el.status.classList.toggle('hint', !isError);
    el.status.classList.toggle('dim', !isError);
  }

  function syncTransformReadouts() {
    el.scaleOut.textContent = state.scale.toFixed(2);
    el.rotYOut.textContent = `${Math.round(state.rotY)}°`;
    el.heightOut.textContent = state.template
      ? t('高度 {h} m', { h: (TARGET_HEIGHT * state.scale).toFixed(2) })
      : t('高度 —');
  }

  // ------------------------------------------------------------- bone mapping

  function buildBoneRows() {
    el.bones.innerHTML = '';
    for (const j of JOINTS) {
      const row = document.createElement('div');
      row.className = 'rig-bone-row';
      row.dataset.key = j.key;

      const label = document.createElement('span');
      label.textContent = t(j.label);

      const sel = document.createElement('select');
      const none = document.createElement('option');
      none.value = '';
      none.textContent = t('— 未映射 —');
      sel.append(none);
      for (const name of state.bones) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.append(opt);
      }
      sel.value = state.map[j.key] || '';
      sel.addEventListener('change', () => {
        if (sel.value) state.map[j.key] = sel.value;
        else delete state.map[j.key];
        setActiveJoint(j.key);
        scheduleRebuild();
      });

      row.append(label, sel);
      row.addEventListener('click', (e) => { if (e.target !== sel) setActiveJoint(j.key); });
      el.bones.append(row);
    }
  }

  function buildOffsetSliders() {
    const o = state.offsets[state.active] || [0, 0, 0];
    el.offsetTarget.textContent = t(JOINT_LABEL[state.active] || state.active);
    el.offsets.innerHTML = '';
    ['X', 'Y', 'Z'].forEach((axis, i) => {
      const field = document.createElement('label');
      field.className = 'field';
      const span = document.createElement('span');
      span.textContent = `${axis} `;
      const val = document.createElement('b');
      val.textContent = `${Math.round(o[i])}°`;
      span.append(val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '-90';
      input.max = '90';
      input.step = '1';
      input.value = String(o[i]);
      input.addEventListener('input', () => {
        const cur = state.offsets[state.active] || [0, 0, 0];
        cur[i] = Number(input.value);
        state.offsets[state.active] = cur;
        val.textContent = `${Math.round(cur[i])}°`;
        scheduleRebuild();
      });
      field.append(span, input);
      el.offsets.append(field);
    });
  }

  function setActiveJoint(target) {
    state.active = target;
    for (const row of el.bones.children) row.classList.toggle('on', row.dataset.key === target);
    buildOffsetSliders();
  }

  // ------------------------------------------------------------------- shared

  async function refreshShared() {
    el.shared.innerHTML = '';
    let list = [];
    try {
      const res = await fetch(apiUrl('/api/characters'));
      list = (await res.json()).characters || [];
    } catch {
      el.shared.innerHTML = `<span class="hint dim">${t('无法连接服务器，暂时看不到共享角色')}</span>`;
      return;
    }
    if (!list.length) {
      el.shared.innerHTML = `<span class="hint dim">${t('还没有人上传角色')}</span>`;
      return;
    }
    for (const m of list) {
      const row = document.createElement('div');
      row.className = 'rig-shared-row' + (state.using === m.id ? ' on' : '');
      const name = document.createElement('b');
      name.textContent = m.name;
      const by = document.createElement('em');
      by.textContent = m.author ? `by ${m.author}` : '';
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'mini-btn';
      use.textContent = state.using === m.id ? t('使用中') : t('使用');
      use.addEventListener('click', () => selectShared(m));
      const dl = document.createElement('a');
      dl.className = 'mini-btn';
      dl.href = m.file;
      dl.download = `${m.name || 'character'}.glb`;
      dl.textContent = t('下载');
      row.append(name, by, use, dl);
      el.shared.append(row);
    }
  }

  function selectShared(m) {
    state.using = m.id;
    store.set(SKIN_ID_KEY, m.id);
    store.set(SKIN_NAME_KEY, m.name || '');
    onUse?.({ id: m.id, name: m.name });
    refreshShared();
    setStatus(t('已选用「{name}」。对局中其他玩家会看到这个模型；想再改就先导入同一个文件。',
      { name: m.name || m.id }));
  }

  // ---------------------------------------------------------------- importing

  async function importFile(file) {
    setStatus(t('正在解析模型…'));
    try {
      const gltf = await loadGltfFromFile(file);
      state.file = file;
      state.template = prepareTemplate(gltf.scene);
      state.bones = collectBones(gltf.scene);
      if (!state.bones.length) {
        setStatus(t('这个模型没有骨骼（不是蒙皮模型），无法用于角色替换。'), true);
        state.template = null;
        scheduleRebuild();
        return;
      }
      const guess = autoMapJointNames(state.bones);
      state.map = { ...guess, ...state.map };
      for (const k of Object.keys(state.map)) if (!state.bones.includes(state.map[k])) delete state.map[k];
      if (!state.name) state.name = file.name.replace(/\.(glb|gltf)$/i, '');
      el.name.value = state.name;
      buildBoneRows();
      syncTransformReadouts();
      scheduleRebuild();
      setStatus(t('已导入 {bones} 根骨骼，自动匹配 {joints} 个关节。肩肘手为静止姿态，请用偏移滑杆调整持枪姿势。',
        { bones: state.bones.length, joints: Object.keys(state.map).length }));
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  // -------------------------------------------------------------- persistence

  function saveLocal() {
    store.set(LOCAL_KEY, JSON.stringify({
      name: state.name, map: state.map, offsets: state.offsets,
      scale: state.scale, rotY: state.rotY,
    }));
    setStatus(t('映射与偏移已保存在本机浏览器。要跨设备使用请点「上传共享」。'));
  }

  function loadLocal() {
    try {
      const raw = store.get(LOCAL_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.map) state.map = s.map;
        if (s.offsets) state.offsets = s.offsets;
        if (s.name) { state.name = s.name; el.name.value = s.name; }
        if (typeof s.scale === 'number') state.scale = s.scale;
        if (typeof s.rotY === 'number') state.rotY = s.rotY;
      }
    } catch { /* corrupt entry: start clean */ }
    state.using = store.get(SKIN_ID_KEY) || '';
    el.scale.value = String(state.scale);
    el.rotY.value = String(state.rotY);
    syncTransformReadouts();
  }

  async function upload() {
    if (!state.file) {
      setStatus(t('请先导入模型文件，再上传共享。'), true);
      return;
    }
    if (!Object.keys(state.map).length) {
      setStatus(t('至少映射一个关节再上传。'), true);
      return;
    }
    const fd = new FormData();
    fd.append('meta', JSON.stringify({
      name: (state.name || t('自定义角色')).slice(0, 24),
      author: hud.playerName,
      bones: state.map, offsets: state.offsets,
      scale: state.scale, rotY: state.rotY,
    }));
    fd.append('model', state.file, state.file.name);
    setStatus(t('正在上传…'));
    try {
      const res = await fetch(apiUrl('/api/character'), { method: 'POST', body: fd });
      // A static upload (Vercel) has no endpoint to receive this: the answer is
      // an HTML 404/405, so say what is missing instead of failing to parse it.
      let json = null;
      try { json = await res.json(); } catch { /* not a server that stores rigs */ }
      if (!json) {
        setStatus(t('上传失败：{why}', {
          why: `HTTP ${res.status} — ${t('这台托管只提供静态文件。')}`
            + t('共享角色需要一台带服务端的部署（Render / Docker 跑 server/server.py），'
              + '或在菜单里填上那台服务器的地址。'),
        }), true);
        return;
      }
      if (!json.ok) {
        setStatus(t('上传失败：{why}', { why: json.error || res.status }), true);
        return;
      }
      setStatus(t('上传成功，服务器编号 {id}，现在所有玩家都能选用它。', { id: json.meta.id }));
      selectShared(json.meta);
    } catch (err) {
      setStatus(t('上传失败：{why}', { why: err.message }), true);
    }
  }

  function reset() {
    state.file = null;
    state.template = null;
    state.bones = [];
    state.map = {};
    state.offsets = {};
    state.scale = 1;
    state.rotY = 0;
    state.name = '';
    state.play = false;
    el.file.value = '';
    el.name.value = '';
    el.scale.value = '1';
    el.rotY.value = '0';
    el.play.setAttribute('aria-pressed', 'false');
    el.bones.innerHTML = '';
    el.offsets.innerHTML = '';
    el.offsetTarget.textContent = t(JOINT_LABEL[state.active]);
    store.remove(LOCAL_KEY);
    syncTransformReadouts();
    scheduleRebuild();
    setStatus(t('已重置。请重新导入模型。'));
  }

  // ------------------------------------------------------------------ wiring

  el.file.addEventListener('change', () => {
    const f = el.file.files?.[0];
    if (f) importFile(f);
  });
  el.name.addEventListener('input', () => { state.name = el.name.value.trim(); });
  el.scale.addEventListener('input', () => {
    state.scale = Number(el.scale.value);
    syncTransformReadouts();
    scheduleRebuild();
  });
  el.rotY.addEventListener('input', () => {
    state.rotY = Number(el.rotY.value);
    syncTransformReadouts();
    scheduleRebuild();
  });
  el.play.addEventListener('click', () => {
    state.play = !state.play;
    el.play.setAttribute('aria-pressed', String(state.play));
    el.play.classList.toggle('on', state.play);
  });
  el.back.addEventListener('click', () => { visible = false; hud.screen('menu'); });
  el.reset.addEventListener('click', reset);
  el.local.addEventListener('click', saveLocal);
  el.upload.addEventListener('click', upload);

  loadLocal();
  buildOffsetSliders();

  return {
    get visible() { return visible; },

    open() {
      visible = true;
      hud.screen('settings');
      loadLocal();
      refreshShared();
      if (!state.template) setStatus(t('尚未导入模型。仅支持未压缩的 glTF/GLB（不支持 Draco / meshopt）。'));
      rebuild();
    },

    render(dt) {
      if (!visible) return;
      const w = el.canvas.clientWidth | 0;
      const h = el.canvas.clientHeight | 0;
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        lastW = w;
        lastH = h;
      }
      if (pending) { pending = false; rebuild(); }
      if (preview) preview.update(dt, { speed: state.play ? 4.2 : 0, sprint: false, crouch: false, pitch: 0 });
      camAngle += dt * 0.4;
      camera.position.set(Math.cos(camAngle) * 2.9, 1.55, Math.sin(camAngle) * 2.9);
      camera.lookAt(0, 0.92, 0);
      renderer.render(scene, camera);
    },
  };
}

// ------------------------------------------------------------ built-in skins

/**
 * Class skins that ship with the client. Same shape as an uploaded meta
 * ({ bones, offsets, scale, rotY }), but the model is served from /models.
 *
 * Bone names were read out of each GLB. Every rig is a Genshin/MMD-style
 * skeleton whose "leg" bone is the thigh and whose "ankle" bone is the foot,
 * so the mapping names them knee/foot while the walk cycle reads the real knee
 * and toe bones off the hierarchy (thigh -> knee -> ankle -> toe).
 *
 * All four rigs face +Z, which is the convention yawToRotation already assumes
 * for the built-in girl, hence rotY 0 for all of them.
 */
export const BUILTIN_SKINS = {
  'builtin-furina': {
    id: 'builtin-furina', name: '芙宁娜', nameEn: 'Furina', file: '/models/genshin/furina.glb',
    bones: {
      hips: 'Hips_02', spine: 'Spine_03', head: 'Head_06',
      shoulderL: 'Left shoulder_058', shoulderR: 'Right shoulder_084',
      elbowL: 'Left elbow_061', elbowR: 'Right elbow_087',
      handL: 'Left wrist_063', handR: 'Right wrist_089',
      kneeL: 'Left leg_0119', kneeR: 'Right leg_0123',
      footL: 'Left ankle_0121', footR: 'Right ankle_0125',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
  'builtin-navia': {
    id: 'builtin-navia', name: 'Navia', nameEn: 'Navia', file: '/models/genshin/navia.glb',
    bones: {
      hips: 'Hips_07', spine: 'Spine_08', head: 'Head_011',
      shoulderL: 'Left shoulder_045', shoulderR: 'Right shoulder_083',
      elbowL: 'Left elbow_047', elbowR: 'Right elbow_085',
      handL: 'Left wrist_049', handR: 'Right wrist_087',
      kneeL: 'Left leg_0667', kneeR: 'Right leg_0671',
      footL: 'Left ankle_0669', footR: 'Right ankle_0673',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
  'builtin-charlotte': {
    id: 'builtin-charlotte', name: '夏洛蒂', nameEn: 'Charlotte', file: '/models/genshin/charlotte.glb',
    bones: {
      hips: 'Hips_02', spine: 'Spine_03', head: 'Head_06',
      shoulderL: 'Left shoulder_034', shoulderR: 'Right shoulder_056',
      elbowL: 'Left elbow_037', elbowR: 'Right elbow_059',
      handL: 'Left wrist_039', handR: 'Right wrist_061',
      kneeL: 'Left leg_087', kneeR: 'Right leg_091',
      footL: 'Left ankle_089', footR: 'Right ankle_093',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
  'builtin-clorinde': {
    id: 'builtin-clorinde', name: '克洛琳德', nameEn: 'Clorinde', file: '/models/genshin/clorinde.glb',
    bones: {
      hips: 'Hips_03_441', spine: 'Spine_0174_440', head: 'Head_0177_194',
      shoulderL: 'Left_shoulder_0179_312', shoulderR: 'Right_shoulder_0316_391',
      elbowL: 'Left_elbow_0202_216', elbowR: 'Right_elbow_0299_333',
      handL: 'Left_wrist_0204_213', handR: 'Right_wrist_0321_330',
      kneeL: 'Left_leg_04_4', kneeR: 'Right_leg_08_8',
      footL: 'Left_ankle_06_2', footR: 'Right_ankle_010_6',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
};

/** Which built-in skin a class wears when the player picked no custom one. */
export const DEFAULT_CLASS_SKIN = {
  assault: 'builtin-clorinde',
  medic: 'builtin-furina',
  support: 'builtin-navia',
  scout: 'builtin-charlotte',
};