// Motion clips: retarget the Mixamo FBX run cycles onto a character template
// once, so every avatar instance can play them back through an AnimationMixer.
//
// This is the shipping half of the animation lab (anim-lab.html). The lab
// established two things this module depends on:
//   1. SkeletonUtils.retargetClip drops the source's bind-pose offset, so the
//      target's feet end up sole-up. Injecting the rest delta
//      (S_rest^-1 * T_rest) as a per-bone local offset fixes it.
//   2. These Genshin rips carry a second, parallel armature for the hair; only
//      the body skeleton (the one with legs) is baked here, the duplicate is
//      dragged along by rig.js's mirrorSecondary().
//
// Only rotations are baked: retargetClip emits a position track for the bone
// named exactly `options.hip` (default "hip"), which never matches these rigs,
// so the hip keeps its rest translation and the vertical bob stays the job of
// rig.js's foot grounding.

import * as THREE from 'three';
import { FBXLoader } from '../vendor/loaders/FBXLoader.js';
import { retargetClip, clone as cloneSkinned } from '../vendor/utils/SkeletonUtils.js';

/**
 * The run cycles in sector order: index 0 is straight ahead, each step turns
 * 45 degrees to the character's right (see rig.js sectorOf). Names match the
 * FBX files in /motions.
 */
export const RUN_SECTORS = [
  'run-forward', 'run-forward-right', 'run-right', 'run-backward-right',
  'run-backward', 'run-backward-left', 'run-left', 'run-forward-left',
];

/**
 * Upper-body actions, keyed by the state that asks for them. Baked as a second,
 * independent layer so the legs keep running underneath: `runHold` is the
 * rifle-in-hands pose the arms ride while running, `hold` the standing variant
 * parked on between shots, `fire` the recoil cycle, `reload`/`toss` take the
 * hands off the gun entirely.
 */
export const UPPER_SOURCES = {
  hold: 'shoot-rifle',
  runHold: 'shoot-rifle-when-running',
  fire: 'firing-rifle',
  reload: 'reload',
  toss: 'toss-grenade',
};

// Mixamo joint names split across the two layers. The legs belong to the run
// cycle; the spine chain travels with the arms. The pelvis is in neither: it is
// kept in the retarget stub so the spine's parent chain is solved against it,
// its track is then filtered out, and rig.js pins the bone to bind every frame —
// so both layers effectively bake against the same pelvis.
//
// The arms need a second correction on top of that. retargetClip transfers the
// source's world ORIENTATION, which only lands correctly on a rig whose rest pose
// matches the source's. Every Mixamo clip here binds in a T-pose while these rips
// bind in an A-pose with the arms ~38 degrees down, so the arm chain is re-offset
// to reproduce the source's limb DIRECTIONS instead — see the arm-chain alignment
// block in bakeOne. Without it the arms swing off the body and fold across the
// chest (the "hugging" pose).
//
// The sets are disjoint, which is what lets the two clips share one mixer
// without fighting over a bone.
const LOWER_SRC = new Set([
  'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg',
  'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase',
]);
const UPPER_SRC = new Set([
  'Spine', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm',
  'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand',
]);
// Neither layer drives these: finger/twist/prop bones carry no pose we want and
// only add bind-pose noise. Mixamo's *Twist/WristTwist and finger chains.
const NO_TOUCH = /(twist|thumb|index|middle|ring|little|pinky|finger)/i;

const loader = new FBXLoader();
const sources = new Map();   // motionId -> Promise<{ wrap, clip, rest }>

// ------------------------------------------------------------------- source

// Mixamo bone names arrive with the "mixamorig" stem, which survives
// PropertyBinding.sanitizeNodeName (it only drops [].:/) and would stop every
// track from binding. Same strip the lab applies.
const stripPrefix = (s) => s.replace(/^mixamorig[:_]?/i, '').replace(/:/g, '_');

/** AnimationMixer calls .getBoneByName on anything with a `.skeleton`. */
function fakeSkeleton(bones) {
  return { bones, getBoneByName: (n) => bones.find((b) => b.name === n) };
}

function loadSource(id) {
  if (sources.has(id)) return sources.get(id);
  const p = (async () => {
    const fbx = await loader.loadAsync(`/motions/${id}.fbx`);
    const bones = [];
    fbx.traverse((o) => { if (o.isBone) { o.name = stripPrefix(o.name); bones.push(o); } });
    fbx.skeleton = fakeSkeleton(bones);

    const clips = fbx.animations || [];
    // some exports carry an empty extra stack; take whichever has the most curves
    const clip = clips.reduce((a, b) => (b.tracks.length > (a ? a.tracks.length : -1) ? b : a), null);
    if (!clip) throw new Error(`${id}: FBX 里没有动画轨道`);
    for (const t of clip.tracks) t.name = stripPrefix(t.name);

    // wrapper fed to retargetClip; its world matrices are the source pose. The
    // correction rotation is left at identity — the lab verified the Mixamo
    // forward already lines up with these rigs' +Z.
    const wrap = new THREE.Group();
    wrap.add(fbx);
    wrap.skeleton = fakeSkeleton(bones);
    wrap.updateMatrixWorld(true);

    // bind (rest) world orientation + position per bone, read before any mixer runs
    const rest = new Map();
    const restPos = new Map();
    for (const b of bones) {
      rest.set(b.name, b.getWorldQuaternion(new THREE.Quaternion()));
      restPos.set(b.name, b.getWorldPosition(new THREE.Vector3()));
    }
    return { wrap, clip, rest, restPos };
  })();
  sources.set(id, p);
  return p;
}

// --------------------------------------------------------------- bone mapping

function sideOf(name) {
  if (/(^|[^a-z])left/i.test(name) || /(^|_)l(_|$|\d)/i.test(name)) return 'L';
  if (/(^|[^a-z])right/i.test(name) || /(^|_)r(_|$|\d)/i.test(name)) return 'R';
  return '';
}

const boneKids = (b) => b.children.filter((c) => c.isBone);
const depthOf = (b) => { let d = 0, p = b; while (p.parent && p.parent.isBone) { d++; p = p.parent; } return d; };

function subtreeSize(b) {
  let n = 1;
  for (const c of boneKids(b)) n += subtreeSize(c);
  return n;
}

/** Shallowest descendant (BFS) matching `pred`, or null. */
function findDescendant(start, pred) {
  const q = boneKids(start).slice();
  while (q.length) {
    const b = q.shift();
    if (pred(b)) return b;
    for (const c of boneKids(b)) q.push(c);
  }
  return null;
}

function collectDescendants(start, pred) {
  const out = [];
  const stack = boneKids(start).slice();
  while (stack.length) {
    const b = stack.pop();
    if (pred(b)) out.push(b);
    for (const c of boneKids(b)) stack.push(c);
  }
  return out;
}

function findAncestor(start, pred) {
  let p = start.parent;
  while (p) { if (p.isBone && pred(p)) return p; p = p.parent; }
  return null;
}

function shallowest(bones, pred) {
  let best = null, bd = Infinity;
  for (const b of bones) {
    if (!pred(b)) continue;
    const d = depthOf(b);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/**
 * Map one skeleton's bones onto Mixamo joint names by WALKING THE HIERARCHY
 * rather than matching names globally — these rips parent the arms off the
 * hips, so a global "closest name" search grabs a bone from the wrong chain.
 * @returns {{names:Record<string,string>, mapped:THREE.Bone[], hips:THREE.Bone}|null}
 */
function buildSkeletonMap(bones) {
  const isHips = (b) => /hips|pelvis/i.test(b.name) && !/(upleg|thigh|leg)/i.test(b.name);
  const hips = shallowest(bones, isHips);
  if (!hips) return null;

  const notTip = (b) => !/(top|end|tip)/i.test(b.name);
  const spine = findDescendant(hips, (b) => /spine/i.test(b.name) && notTip(b));
  const chest = spine && findDescendant(spine, (b) => /chest/i.test(b.name));

  // among the head candidates pick the real one: the branch that carries the
  // eyes/hair, i.e. the largest subtree (junk leaves like Head_053_0 have none)
  let head = null;
  if (chest) {
    for (const h of collectDescendants(chest, (b) => /head/i.test(b.name) && notTip(b))) {
      if (!head || subtreeSize(h) > subtreeSize(head)) head = h;
    }
  }
  const neck = head && findAncestor(head, (b) => /neck/i.test(b.name));

  const names = {};
  const mapped = [];
  const add = (bone, src) => { if (bone && !names[bone.name]) { names[bone.name] = src; mapped.push(bone); } };

  add(hips, 'Hips'); add(spine, 'Spine'); add(chest, 'Spine2'); add(neck, 'Neck'); add(head, 'Head');

  for (const [s, S] of [['L', 'Left'], ['R', 'Right']]) {
    const side = (b) => sideOf(b.name) === s;
    const notFore = (b) => !/(forearm|twist)/i.test(b.name);
    const notFinger = (b) => !/(thumb|index|middle|ring|little|pinky|finger)/i.test(b.name);

    const shoulder = chest && findDescendant(chest, (b) => /shoulder|clavicle/i.test(b.name) && side(b));
    const arm = (shoulder && findDescendant(shoulder, (b) => /arm/i.test(b.name) && notFore(b) && side(b)))
      || shallowest(bones, (b) => /arm/i.test(b.name) && notFore(b) && side(b));
    const elbow = arm && findDescendant(arm, (b) => /elbow|forearm/i.test(b.name) && !/twist/i.test(b.name) && side(b));
    // These rips hang a "zHandTwist_*" helper off the arm as well; it matches
    // /hand/ and sits above the real wrist in the BFS, so without excluding it
    // the clip ends up driving the twist bone while rig.js drives the wrist —
    // two different bones, and the twist is never rewound when the clip stops.
    const notTwist = (b) => !/twist/i.test(b.name);
    const wrist = elbow && findDescendant(elbow, (b) => /wrist|hand/i.test(b.name) && notFinger(b) && notTwist(b) && side(b));

    // these rigs name the thigh "leg", the knee "shin"/"leg_...", the foot
    // "ankle"/"foot"; the exclusion list keeps the chain one joint per level
    const thigh = findDescendant(hips, (b) => /(leg|thigh)/i.test(b.name)
      && !/(knee|shin|calf|ankle|foot|toe|twist|skirt)/i.test(b.name) && side(b));
    const knee = thigh && findDescendant(thigh, (b) => /(knee|shin|calf)/i.test(b.name) && side(b));
    const ankle = knee && findDescendant(knee, (b) => /(ankle|foot)/i.test(b.name) && !/toe/i.test(b.name) && side(b));
    const toe = ankle && findDescendant(ankle, (b) => /toe/i.test(b.name) && !/(base|end)/i.test(b.name) && side(b));

    add(shoulder, S + 'Shoulder'); add(arm, S + 'Arm'); add(elbow, S + 'ForeArm');
    add(wrist, S + 'Hand');
    add(thigh, S + 'UpLeg'); add(knee, S + 'Leg'); add(ankle, S + 'Foot'); add(toe, S + 'ToeBase');
  }

  // hierarchy order (parents first) — retarget relies on it
  const order = new Map(bones.map((b, i) => [b, i]));
  mapped.sort((a, b) => order.get(a) - order.get(b));
  return { names, mapped, hips };
}

/** Group the model's skinned meshes by the armature they drive. */
function skeletonGroups(skinned) {
  // A Skeleton is per-mesh: rig.js's clone rebinds every skinned mesh with its
  // own Skeleton object even when they all drive the same bones, so keying on
  // the Skeleton would split one body into three groups. The root bone is the
  // real armature identity — a genuinely separate rig (hair/hat) roots elsewhere.
  const armatureRoot = (skel) => {
    let b = skel.bones[0];
    if (!b) return skel;
    while (b.parent && b.parent.isBone) b = b.parent;
    return b;
  };
  const map = new Map();
  for (const m of skinned) {
    if (!m.skeleton) continue;
    const key = armatureRoot(m.skeleton);
    let e = map.get(key);
    if (!e) { e = { bones: m.skeleton.bones, meshes: [] }; map.set(key, e); }
    e.meshes.push(m);
  }
  return [...map.values()];
}

/**
 * The body skeleton: the one group whose map reaches the legs. Hair/hat rigs
 * are duplicates with no leg chain, and driving them here would fight
 * rig.js's mirrorSecondary().
 */
function pickBodyMap(groups) {
  let best = null;
  for (const g of groups) {
    const m = buildSkeletonMap(g.bones);
    if (!m) continue;
    const hasLegs = Object.values(m.names).some((v) => /UpLeg/.test(v));
    if (!hasLegs) continue;
    if (!best || m.mapped.length > best.m.mapped.length) best = { m, group: g };
  }
  return best;
}

/**
 * retargetClip wants `target.skeleton.bones` and pokes `.isObject3D`,
 * `.matrixWorld` and `.skeleton.pose()` on it. A Group has no skeleton, a
 * SkinnedMesh only carries one skin's bones, so feed it a stub that exposes
 * exactly the mapped bones and can reset them to their rest pose.
 */
function makeTargetStub(root, bones) {
  const rest = bones.map((b) => ({
    q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone(),
  }));
  const restore = () => {
    for (let i = 0; i < bones.length; i++) {
      bones[i].quaternion.copy(rest[i].q);
      bones[i].position.copy(rest[i].p);
      bones[i].scale.copy(rest[i].s);
    }
    root.updateMatrixWorld(true);
  };
  return {
    isObject3D: true,
    matrixWorld: new THREE.Matrix4(),
    children: [],
    updateMatrixWorld() {},
    skeleton: { bones, pose: restore },
    restore,
  };
}

// -------------------------------------------------------------------- baking

function bakeOne(template, src, motionId, keep, exclude) {
  // bake on a throwaway clone: the retarget poses the target bones, and the
  // shared template must stay on its bind pose for every clone that spawns
  // while these bakes are still running
  const scene = cloneSkinned(template.scene);
  const skinned = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  const groups = skeletonGroups(skinned);
  const picked = pickBodyMap(groups);
  if (!picked) return null;
  const { m } = picked;

  // A second armature sharing bone names with the body would make the mixer's
  // name lookup ambiguous — fall back to the procedural cycle rather than
  // driving the wrong bones. rig.js mirrors those duplicates by position anyway.
  const bodyNames = new Set(Object.keys(m.names));
  for (const g of groups) {
    if (g === picked.group) continue;
    if (g.bones.some((b) => bodyNames.has(b.name))) return null;
  }

  // Both layers now keep Hips in the stub. retargetClip solves each bone's world
  // ORIENTATION from the source, so whether Hips takes part decides what the
  // limbs are measured against. The lower layer OWNS the pelvis: its Hips track
  // is kept in the output so the run clip drives the pelvis at runtime, and the
  // legs are baked against that same animated pelvis so they land right. The
  // upper layer keeps Hips in the stub so the spine chain solves against the
  // source's running pelvis, then drops its Hips track — only one layer may
  // write the bone, and the legs own it.
  const stubBones = m.mapped;
  const stub = makeTargetStub(scene, stubBones);
  // reading the target bind world rotation: rewind every mapped bone first
  stub.restore();
  const localOffsets = {};
  const wq = new THREE.Quaternion();
  for (const b of m.mapped) {
    const sRest = src.rest.get(m.names[b.name]);
    if (!sRest) continue;
    b.getWorldQuaternion(wq);
    // offset = S_rest^-1 * T_rest, the rest-delta retargetClip omits
    localOffsets[b.name] = new THREE.Matrix4()
      .makeRotationFromQuaternion(sRest.clone().invert().multiply(wq));
  }

  // ---- arm-chain direction alignment ---------------------------------------
  // retargetClip writes each bone's world rotation as R_src * S_rest^-1 * T_rest,
  // which reproduces the source's ORIENTATION only while the two rigs share a
  // rest pose. They do not: every Mixamo clip here binds in a T-pose (arms
  // straight out, +-X) while these Genshin rips bind in an A-pose with the arms
  // ~38 degrees down. The resulting error is pose-dependent, so the arms swing
  // off the body and fold across the chest no matter how the pelvis is handled.
  //
  // For the arm chain the offset is therefore built from the bone->child
  // DIRECTION instead: A = S_rest^-1 * (child - bone) rotated onto the same
  // vector in the target's frame. Fed in as a local offset, retargetClip then
  // makes the limb point where the source's limb points, which is invariant to
  // where each rig happens to bind. Bones whose rest already agrees (spine,
  // legs) keep the orientation offset above.
  const mappedSet = new Set(m.mapped);
  const chainChild = (b) => {
    const q = b.children.filter((c) => c.isBone);
    while (q.length) {
      const c = q.shift();
      if (mappedSet.has(c)) return c;
      for (const k of c.children) if (k.isBone) q.push(k);
    }
    return null;
  };
  const _q = new THREE.Quaternion();
  const _pt = new THREE.Vector3();
  const _ps = new THREE.Vector3();
  const _vo = new THREE.Vector3();
  for (const b of m.mapped) {
    const srcName = m.names[b.name];
    if (!/Shoulder|Arm|ForeArm/i.test(srcName || '')) continue;
    const c = chainChild(b);
    const srcChild = c && m.names[c.name];
    if (!c || !srcChild) continue;
    const sPos = src.restPos.get(srcName);
    const sChild = src.restPos.get(srcChild);
    if (!sPos || !sChild) continue;
    // target bone->child direction, in the bone's own frame
    b.getWorldQuaternion(_q).invert();
    c.getWorldPosition(_pt);
    b.getWorldPosition(_ps);
    _vo.copy(_pt).sub(_ps).normalize().applyQuaternion(_q);
    // source bone->child direction, in the source bone's own frame
    _ps.copy(sChild).sub(sPos).normalize();
    _ps.applyQuaternion(src.rest.get(srcName).clone().invert());
    localOffsets[b.name] = new THREE.Matrix4()
      .makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(_vo, _ps));
  }

  let clip;
  try {
    clip = retargetClip(stub, src.wrap, src.clip, {
      names: m.names, localOffsets, preserveBonePositions: true, fps: 30,
    });
  } finally {
    // leave the clone on its bind pose even if the retarget threw
    stub.restore();
  }
  // retargetClip names tracks ".bones[NAME].quaternion"; rebind to the plain
  // bone name so a mixer rooted at the cloned rig can find them. `keep` restricts
  // the result to one layer's joints (the source name comes back via m.names) so
  // a lower- and an upper-body clip can share a mixer without overlap.
  const isLower = keep === LOWER_SRC;
  const tracks = [];
  for (const t of clip.tracks) {
    t.name = t.name.replace(/^\.bones\[([^\]]+)\]/, '$1');
    const boneName = t.name.replace('.quaternion', '');
    const srcName = m.names[boneName];
    if (keep && !keep.has(srcName)) {
      // The lower layer claims the pelvis: let the Hips track through so the
      // run clip can drive it. The upper layer drops it (only the legs own
      // the bone; two writers would fight).
      if (!(isLower && srcName === 'Hips')) continue;
    }
    if (exclude && exclude.test(srcName || '')) continue;
    tracks.push(t);
  }
  if (!tracks.length) return null;
  const out = new THREE.AnimationClip(motionId, -1, tracks);
  out.resetDuration();
  return out;
}

/**
 * Bake every clip this model needs onto `template`, once. Resolves to
 * `{ run, upper }` — the eight direction cycles filtered to the lower body, and
 * the upper-body actions filtered to the arms/head — or null when the model
 * cannot be retargeted at all. Cached on the template, which is shared by every
 * avatar wearing the same skin.
 *
 * When the upper actions fail to bake (a missing FBX), the run clips are re-baked
 * unfiltered so the arms still animate off the run cycle rather than freezing.
 */
export function ensureMotions(template) {
  if (!template) return Promise.resolve(null);
  if (template._motions) return template._motions;
  template._motions = (async () => {
    const run = {};
    for (const id of RUN_SECTORS) {
      try { run[id] = bakeOne(template, await loadSource(id), id, LOWER_SRC, NO_TOUCH); }
      catch { /* one bad clip must not sink the rest */ }
    }
    if (!Object.values(run).some(Boolean)) return null;

    const upper = {};
    for (const [key, srcId] of Object.entries(UPPER_SOURCES)) {
      try { upper[key] = bakeOne(template, await loadSource(srcId), key, UPPER_SRC, NO_TOUCH); }
      catch { /* a missing action just leaves that pose unanimated */ }
    }
    if (!Object.values(upper).some(Boolean)) {
      for (const id of RUN_SECTORS) {
        try { run[id] = bakeOne(template, await loadSource(id), id); } catch { /* */ }
      }
    }
    return { run, upper };
  })().catch(() => null);
  return template._motions;
}