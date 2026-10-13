// Animation lab: retarget Mixamo FBX clips (from `new motion/`) onto the
// Genshin girl GLBs that ship with the game.
//
// Why a separate page: the game rig (rig.js) drives these models with a hand
// written procedural walk cycle. Before swapping any of that out we need to see
// whether three's SkeletonUtils.retargetClip produces a usable pose on these
// skeletons at all, and how the source FBX has to be oriented. Everything here
// is throwaway exploration, kept out of the shipping bundle.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { FBXLoader } from '../vendor/loaders/FBXLoader.js';
import { retargetClip } from '../vendor/utils/SkeletonUtils.js';

const DEG = Math.PI / 180;

const MODELS = [
  { id: 'furina', name: '芙宁娜 Furina', url: '/models/genshin/furina.glb' },
  { id: 'navia', name: 'Navia', url: '/models/genshin/navia.glb' },
  { id: 'charlotte', name: '夏洛蒂 Charlotte', url: '/models/genshin/charlotte.glb' },
  { id: 'clorinde', name: '克洛琳德 Clorinde', url: '/models/genshin/clorinde.glb' },
];

const MOTIONS = [
  ['run-forward', '向前跑 Run Forward'],
  ['run-backward', '向后跑 Run Backward'],
  ['run-left', '左跑 Run Left'],
  ['run-right', '右跑 Run Right'],
  ['run-forward-left', '前左跑 Run Forward Left'],
  ['run-forward-right', '前右跑 Run Forward Right'],
  ['run-backward-left', '后左跑 Run Backward Left'],
  ['run-backward-right', '后右跑 Run Backward Right'],
  ['running-to-stop', '跑动停止 Running To Stop'],
  ['run-strafing-jump', '跑动横跳 Run Strafing Jump'],
  ['left-strafe-jump', '左横跳 Left Strafe Jump'],
  ['right-strafing-jump', '右横跳 Right Strafing Jump'],
  ['backward-jump', '向后跳 Backward Jump'],
  ['firing-rifle', '步枪开火 Firing Rifle'],
  ['shoot-rifle', '站姿射击 Shoot Rifle'],
  ['shoot-rifle-when-running', '奔跑射击 Shoot Rifle When Running'],
  ['reload', '换弹 Reload'],
  ['standing-still-reloading', '站姿换弹 Standing Still Reloading'],
  ['toss-grenade', '投弹 Toss Grenade'],
  ['run-and-throw-grenade', '奔跑投弹 Run And Throw Grenade'],
  ['rifle-run-to-dying', '奔跑中弹倒地 Rifle Run To Dying'],
  ['death', '死亡 Death'],
];

// 上半身动作：持枪/开火/换弹/投弹等，用于方案 A 的分层播放原型。
// 这些动作的腿/髋轨道会被丢弃，只保留胸/肩/臂/头，叠在跑动的下半身上。
const UPPER_MOTIONS = [
  ['', '（无 · 仅下半身）'],
  ['firing-rifle', '步枪开火 Firing Rifle'],
  ['shoot-rifle', '站姿射击 Shoot Rifle'],
  ['shoot-rifle-when-running', '奔跑射击 Shoot Rifle When Running'],
  ['reload', '换弹 Reload'],
  ['standing-still-reloading', '站姿换弹 Standing Still Reloading'],
  ['toss-grenade', '投弹 Toss Grenade'],
];

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('stage'), model: $('model'), motion: $('motion'), motionUpper: $('motion-upper'),
  play: $('play'), restep: $('restep'), probe: $('probe'), layerToggle: $('layer-toggle'),
  speed: $('speed'), speedV: $('speedV'), time: $('time'), timeV: $('timeV'),
  yaw: $('yaw'), yawV: $('yawV'), pitch: $('pitch'), pitchV: $('pitchV'),
  myaw: $('myaw'), myawV: $('myawV'), stat: $('stat'), log: $('log'),
  logwrap: $('logwrap'), logtoggle: $('logtoggle'), logfold: $('logfold'),
};

let logLines = 0;
function log(msg, cls) {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = msg + '\n';
  el.log.append(span);
  if (++logLines > 400) { el.log.firstChild?.remove(); logLines--; }
  el.log.scrollTop = el.log.scrollHeight;
}

// ----------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1016);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2f3c, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(3, 6, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x88bbff, 0.7);
rim.position.set(-4, 3, -3);
scene.add(rim);
scene.add(new THREE.GridHelper(8, 16, 0x3a4457, 0x232a36));

const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);

// ------------------------------------------------ minimal orbit (no OrbitControls vendored)
const cam = { yaw: 0.7, pitch: 0.12, dist: 3.4, target: new THREE.Vector3(0, 0.95, 0) };
let dragging = false, lastX = 0, lastY = 0;
el.canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; el.canvas.setPointerCapture(e.pointerId); });
el.canvas.addEventListener('pointerup', (e) => { dragging = false; el.canvas.releasePointerCapture?.(e.pointerId); });
el.canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  cam.yaw -= (e.clientX - lastX) * 0.008;
  cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch + (e.clientY - lastY) * 0.006));
  lastX = e.clientX; lastY = e.clientY;
});
el.canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = Math.max(0.8, Math.min(12, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
}, { passive: false });

// ------------------------------------------------------------- FBX name QoL

// Mixamo names bones "mixamorig:Hips". FBXLoader runs names through
// PropertyBinding.sanitizeNodeName, which drops the reserved characters [].:/
// outright, so they actually arrive as "mixamorigHips". Either way the
// "mixamorig" stem has to go or nothing binds, because ':'/'.' are track
// syntax and the stem only ever appears in Mixamo bones.
const stripPrefix = (s) => s.replace(/^mixamorig[:_]?/i, '').replace(/:/g, '_');

/**
 * AnimationMixer's PropertyBinding.findNode() sees a truthy `.skeleton` and
 * calls `.getBoneByName()` on it, so a hand-rolled skeleton stand-in has to
 * provide that method, not just `.bones`.
 */
function fakeSkeleton(bones) {
  return { bones, getBoneByName: (n) => bones.find((b) => b.name === n) };
}

// ---------------------------------------------------------- model -> mixamo map

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
 * rather than matching names globally.
 *
 * These Genshin rips ship as two skeletons -- the body rig and a full duplicate
 * that carries the hair/hat/ponytail bones -- and the body rig parents the arms
 * to the Hips instead of the shoulders. A global "closest name" search therefore
 * grabs a bone from the wrong rig (and junk leaves like Head_053_0). Anchoring on
 * the actual roots and descending keeps every skeleton's chain coherent.
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
    // the body rig hangs the arm off the hips, so fall back to a whole-skeleton search
    const arm = (shoulder && findDescendant(shoulder, (b) => /arm/i.test(b.name) && notFore(b) && side(b)))
      || shallowest(bones, (b) => /arm/i.test(b.name) && notFore(b) && side(b));
    const elbow = arm && findDescendant(arm, (b) => /elbow|forearm/i.test(b.name) && !/twist/i.test(b.name) && side(b));
    const wrist = elbow && findDescendant(elbow, (b) => /wrist|hand/i.test(b.name) && notFinger(b) && side(b));
    add(shoulder, S + 'Shoulder'); add(arm, S + 'Arm'); add(elbow, S + 'ForeArm'); add(wrist, S + 'Hand');

    const thigh = findDescendant(hips, (b) => /(leg|thigh)/i.test(b.name)
      && !/(knee|shin|calf|ankle|foot|toe|twist|skirt)/i.test(b.name) && side(b));
    const knee = thigh && findDescendant(thigh, (b) => /(knee|shin|calf)/i.test(b.name) && side(b));
    const ankle = knee && findDescendant(knee, (b) => /(ankle|foot)/i.test(b.name) && !/toe/i.test(b.name) && side(b));
    const toe = ankle && findDescendant(ankle, (b) => /toe/i.test(b.name) && !/(base|end)/i.test(b.name) && side(b));
    add(thigh, S + 'UpLeg'); add(knee, S + 'Leg'); add(ankle, S + 'Foot'); add(toe, S + 'ToeBase');
  }

  // hierarchy order (parents first) — retarget relies on it
  const order = new Map(bones.map((b, i) => [b, i]));
  mapped.sort((a, b) => order.get(a) - order.get(b));
  return { names, mapped, hips };
}

/** Group the model's skinned meshes by the Skeleton they use. */
function skeletonGroups(skinned) {
  const map = new Map();
  for (const m of skinned) {
    if (!m.skeleton) continue;
    let e = map.get(m.skeleton);
    if (!e) { e = { bones: m.skeleton.bones, meshes: [] }; map.set(m.skeleton, e); }
    e.meshes.push(m);
  }
  return [...map.values()];
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

// -------------------------------------------------------------------- state

const state = {
  modelEntry: MODELS[0], gltf: null, modelRoot: null, modelBones: [], skinned: [],
  motionId: MOTIONS[0][0], srcWrap: null, srcClip: null, srcNames: new Set(), srcRest: null,
  upperId: '', upperWrap: null, upperClip: null, upperRest: null,
  layered: true,
  mixer: null, action: null, upperAction: null, baked: null, playing: true, duration: 1, ready: false,
};

// ------------------------------------------------------------------ loaders

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

async function loadModel(entry) {
  log(`加载模型 ${entry.name} …`);
  const gltf = await gltfLoader.loadAsync(entry.url);
  const root = gltf.scene;

  const bones = [];
  const skinned = [];
  // PropertyBinding sanitises track names (spaces -> '_', reserved chars like
  // [] . : / dropped), so the bones have to be renamed the same way or the
  // mixer can never bind them. Furina/Navia/Charlotte ship names such as
  // "Left arm_059" with real spaces, Hu Tao uses "Left_arm_086".
  const sane = (s) => s.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
  root.traverse((o) => {
    if (o.isBone) { o.name = sane(o.name); bones.push(o); }
    if (o.isSkinnedMesh) skinned.push(o);
  });

  // normalise: feet on the floor, centred on the origin, roughly 1.7 m tall so
  // the camera framing is stable no matter how the source GLB is laid out.
  // Measure from a clean transform: exporter scenes routinely carry their own
  // offset/rotation, and Box3 accounts for it, which throws the centring off.
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); box.getSize(size);
  const s = size.y > 1e-4 ? 1.70 / size.y : 1;
  root.scale.setScalar(s);
  // scaling the root scales the geometry, so the offsets have to be scaled too
  root.position.set(
    -(box.min.x + box.max.x) * 0.5 * s,
    -box.min.y * s,
    -(box.min.z + box.max.z) * 0.5 * s,
  );
  root.updateMatrixWorld(true);

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  // frame the camera off the fitted height so units do not matter. The left
  // panel covers the first ~300 px, so look slightly to the side of the model
  // to push it into the clear part of the viewport.
  cam.target.set(0, 0.85, 0);
  cam.dist = 3.2;

  state.gltf = gltf; state.modelRoot = root; state.modelBones = bones; state.skinned = skinned;
  log(`  ${bones.length} 根骨骼 / ${skinned.length} 个蒙皮网格 / 原始高度 ${size.y.toFixed(3)}（缩放 ${s.toFixed(3)}）`, 'ok');
  if (skinned.length > 1) log(`  注意：该模型有多套骨架，次要骨架（头发等）不会被重定向`, 'err');
}

async function loadMotionSource(id) {
  const url = `/motions/${id}.fbx`;
  const fbx = await fbxLoader.loadAsync(url);

  const bones = [];
  fbx.traverse((o) => { if (o.isBone) { o.name = stripPrefix(o.name); bones.push(o); } });
  fbx.skeleton = fakeSkeleton(bones);

  const clips = fbx.animations || [];
  const clip = clips.reduce((a, b) => (b.tracks.length > (a ? a.tracks.length : -1) ? b : a), null);
  if (!clip) throw new Error('FBX 里没有动画轨道');
  for (const t of clip.tracks) t.name = stripPrefix(t.name);

  const wrap = new THREE.Group();
  wrap.add(fbx);
  wrap.skeleton = fakeSkeleton(bones);

  wrap.rotation.set(0, 0, 0);
  wrap.updateMatrixWorld(true);
  const rest = new Map();
  for (const b of bones) rest.set(b.name, b.getWorldQuaternion(new THREE.Quaternion()));

  return { wrap, clip, rest, bones, clips };
}

async function loadMotion(id) {
  log(`加载动作 ${id}.fbx …`);
  const s = await loadMotionSource(id);
  for (const c of s.clips) log(`  clip "${c.name}" → ${c.tracks.length} 条轨道 / ${c.duration.toFixed(2)}s`);
  state.srcRest = s.rest;
  state.srcWrap = s.wrap; state.srcClip = s.clip;
  state.srcNames = new Set(s.bones.map((b) => b.name));
  log(`  ${s.bones.length} 根骨骼 / ${s.clip.tracks.length} 条轨道 / ${s.clip.duration.toFixed(2)}s`, 'ok');
}

async function loadUpperMotion(id) {
  if (!id) { state.upperWrap = null; state.upperClip = null; state.upperRest = null; return; }
  log(`加载上半身动作 ${id}.fbx …`);
  const s = await loadMotionSource(id);
  state.upperRest = s.rest;
  state.upperWrap = s.wrap; state.upperClip = s.clip;
  log(`  上半身 ${s.bones.length} 根骨骼 / ${s.clip.tracks.length} 条轨道 / ${s.clip.duration.toFixed(2)}s`, 'ok');
}

// -------------------------------------------------------------------- bake

// 下半身 / 上半身的 Mixamo 关节名集合，用于轨道过滤。
// Hips 归到下半身（跑动时髋部有扭转和起伏），上半身动作里 Hips 轨道被丢弃。
const LOWER_SRC = new Set([
  'Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg',
  'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase',
]);
const UPPER_SRC = new Set([
  'Spine', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm',
  'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand',
]);

/**
 * 对一套骨架执行一次重定向烘焙，返回 { tracks, pairs, namesMap }。
 * tracks 已经改名为 "boneName.quaternion"，pairs 用于 verifyRetarget，
 * namesMap 是 boneName -> mixamoName，供轨道过滤用。
 */
function retargetGroup(g, srcWrap, srcClip, srcRest, label) {
  const m = buildSkeletonMap(g.bones);
  if (!m) return null;
  const stub = makeTargetStub(state.modelRoot, m.mapped);
  stub.restore();
  const localOffsets = {};
  const wq = new THREE.Quaternion();
  const pairs = [];
  for (const b of m.mapped) {
    const sRest = srcRest && srcRest.get(m.names[b.name]);
    if (!sRest) continue;
    b.getWorldQuaternion(wq);
    pairs.push({ bone: b, srcName: m.names[b.name], tRest: wq.clone(), sRest: sRest.clone() });
    if (state.noRestFix) continue;
    localOffsets[b.name] = new THREE.Matrix4()
      .makeRotationFromQuaternion(sRest.clone().invert().multiply(wq));
  }
  let clip;
  try {
    clip = retargetClip(stub, srcWrap, srcClip, {
      names: m.names, localOffsets, preserveBonePositions: true, fps: 30,
    });
  } catch (err) {
    log(`  ${label} 骨架烘焙失败：${err.message}`, 'err');
    stub.restore();
    return null;
  }
  stub.restore();
  const tracks = [];
  for (const t of clip.tracks) {
    t.name = t.name.replace(/^\.bones\[([^\]]+)\]/, '$1');
    tracks.push(t);
  }
  return { tracks, pairs, namesMap: m.names };
}

function bake() {
  if (!state.modelRoot || !state.srcWrap) return;

  state.srcWrap.rotation.set(
    Number(el.pitch.value) * DEG, Number(el.yaw.value) * DEG, 0,
  );
  state.srcWrap.updateMatrixWorld(true);
  if (state.upperWrap) {
    state.upperWrap.rotation.set(
      Number(el.pitch.value) * DEG, Number(el.yaw.value) * DEG, 0,
    );
    state.upperWrap.updateMatrixWorld(true);
  }

  const viewYaw = Number(el.myaw.value) * DEG;
  state.modelRoot.rotation.y = 0;
  state.modelRoot.updateMatrixWorld(true);

  const groups = skeletonGroups(state.skinned);
  log(`模型含 ${groups.length} 套骨架`);

  // ---- 下半身（跑动） -------------------------------------------------------
  const lowerTracks = [];
  const allPairs = [];
  let lowerBaked = 0;
  for (const g of groups) {
    const r = retargetGroup(g, state.srcWrap, state.srcClip, state.srcRest, '下半身');
    if (!r) continue;
    allPairs.push(...r.pairs);
    // 过滤：只留下半身关节
    for (const t of r.tracks) {
      const boneName = t.name.replace('.quaternion', '');
      if (LOWER_SRC.has(r.namesMap[boneName])) lowerTracks.push(t);
    }
    lowerBaked++;
  }
  log(`下半身烘焙：${lowerBaked} 套骨架 / ${lowerTracks.length} 条轨道`, 'ok');

  // ---- 上半身（开火/换弹/投弹） ----------------------------------------------
  let upperTracks = [];
  let upperBaked = 0;
  if (state.layered && state.upperWrap && state.upperClip) {
    for (const g of groups) {
      const r = retargetGroup(g, state.upperWrap, state.upperClip, state.upperRest, '上半身');
      if (!r) continue;
      for (const t of r.tracks) {
        const boneName = t.name.replace('.quaternion', '');
        if (UPPER_SRC.has(r.namesMap[boneName])) upperTracks.push(t);
      }
      upperBaked++;
    }
    log(`上半身烘焙：${upperBaked} 套骨架 / ${upperTracks.length} 条轨道`, 'ok');
  }

  // 非分层模式：保留主动作的全部轨道（原有行为）
  const mainTracks = state.layered ? lowerTracks : (() => {
    const all = [];
    for (const g of groups) {
      const r = retargetGroup(g, state.srcWrap, state.srcClip, state.srcRest, '全身');
      if (r) all.push(...r.tracks);
    }
    return all;
  })();

  if (!mainTracks.length && !upperTracks.length) { log('没有可用的轨道', 'err'); return; }

  state.modelRoot.rotation.y = viewYaw;
  state.modelRoot.updateMatrixWorld(true);

  if (state.mixer) state.mixer.stopAllAction();
  state.mixer = new THREE.AnimationMixer(state.modelRoot);

  const mainClip = new THREE.AnimationClip('lower', -1, mainTracks);
  state.action = state.mixer.clipAction(mainClip);
  state.action.reset();
  state.action.play();

  state.upperAction = null;
  if (upperTracks.length) {
    const upClip = new THREE.AnimationClip('upper', -1, upperTracks);
    state.upperAction = state.mixer.clipAction(upClip);
    state.upperAction.reset();
    state.upperAction.play();
  }

  state.baked = mainClip;
  state.duration = Math.max(0.001, mainClip.duration);

  el.time.max = String(state.duration);
  el.time.value = '0';
  el.timeV.textContent = `0.00s`;
  applyTimeScale();
  log(`烘焙完成：下半身 ${mainTracks.length} 轨${upperTracks.length ? ` + 上半身 ${upperTracks.length} 轨` : ''} / ${state.duration.toFixed(2)}s`, 'ok');
  state.pairs = allPairs;
  verifyRetarget();
  updateStat();
}

/**
 * Independent correctness check with no assumptions about which way a foot
 * should point: for every mapped bone, compare the ROTATION DELTA the target
 * actually receives (W_now * W_rest^-1) against the source bone's own delta at
 * the same clip time. If the retarget (including our rest-delta offset) is
 * right, the two deltas agree and the mesh deforms exactly like the source;
 * a sole-up foot shows up as a ~180deg disagreement on the foot/toe bones.
 * Reports the worst bone over the clip. Both deltas live in the lab's world
 * frame, so the view/correction sliders do not affect the number.
 */
function verifyRetarget() {
  const pairs = state.pairs;
  if (!pairs || !pairs.length || !state.mixer || !state.action || !state.srcClip) return;
  const sm = new THREE.AnimationMixer(state.srcWrap);
  const sa = sm.clipAction(state.srcClip);
  sa.play();
  const dur = Math.min(state.duration, state.srcClip.duration) || state.duration;
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const worst = new Map();
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = dur * i / N;
    state.mixer.timeScale = 0;
    state.action.time = t;
    if (state.upperAction) state.upperAction.time = t;
    state.mixer.update(0);
    state.modelRoot.updateMatrixWorld(true);
    sm.timeScale = 0;
    sa.time = t;
    sm.update(0);
    state.srcWrap.updateMatrixWorld(true);
    for (const p of pairs) {
      p.bone.getWorldQuaternion(qa);
      const dt = qa.clone().multiply(p.tRest.clone().invert());   // target delta
      const sb = state.srcWrap.skeleton.getBoneByName(p.srcName);
      if (!sb) continue;
      sb.getWorldQuaternion(qb);
      const ds = qb.clone().multiply(p.sRest.clone().invert());   // source delta
      const dot = Math.min(1, Math.abs(qa.copy(dt).dot(ds)));
      const deg = 2 * Math.acos(dot) / DEG;
      if (!worst.has(p.srcName) || deg > worst.get(p.srcName)) worst.set(p.srcName, deg);
    }
  }
  if (state.playing) state.mixer.timeScale = Number(el.speed.value);
  const rows = [...worst.entries()].sort((a, b) => b[1] - a[1]);
  const maxDeg = rows.length ? rows[0][1] : 0;
  const bad = rows.filter(([, d]) => d > 25);
  const head = `重定向误差 最大 ${maxDeg.toFixed(1)}° @${rows[0] ? rows[0][0] : '-'}`;
  log(`${head}${bad.length ? '  ⚠ ' + bad.map(([n, d]) => `${n}:${d.toFixed(0)}°`).join(' ') : '  ✓ 全部关节一致'}`,
    bad.length ? 'err' : 'ok');
  for (const [n, d] of rows.slice(0, 6)) log(`    ${n}  Δ误差 ${d.toFixed(1)}°`);
  document.title = `ERR|${state.modelEntry.id}|${state.motionId}|max=${maxDeg.toFixed(1)}|` +
    rows.map(([n, d]) => `${n}=${d.toFixed(0)}`).join(',');
}

function applyTimeScale() {
  if (state.mixer) state.mixer.timeScale = state.playing ? Number(el.speed.value) : 0;
}

function updateStat() {
  if (!state.baked) { el.stat.textContent = '等待加载…'; return; }
  const upperInfo = state.upperAction ? ` · 上半身 <b>${state.upperId}</b> (${state.upperAction.getClip().tracks.length}轨)` : '';
  el.stat.innerHTML =
    `模型 <b>${state.modelEntry.name}</b> · 下半身 <b>${state.motionId}</b>${upperInfo}<br>` +
    `时长 <b>${state.duration.toFixed(2)}s</b> · 轨道 <b>${state.baked.tracks.length}</b>` +
    (state.playing ? '' : ' · <b>已暂停</b>');
}

// -------------------------------------------------------------------- wiring

for (const m of MODELS) {
  const o = document.createElement('option');
  o.value = m.id; o.textContent = m.name; el.model.append(o);
}
for (const [id, label] of MOTIONS) {
  const o = document.createElement('option');
  o.value = id; o.textContent = label; el.motion.append(o);
}
for (const [id, label] of UPPER_MOTIONS) {
  const o = document.createElement('option');
  o.value = id; o.textContent = label; el.motionUpper.append(o);
}
// 默认上半身动作：站姿射击
el.motionUpper.value = 'shoot-rifle';

el.play.addEventListener('click', () => {
  state.playing = !state.playing;
  el.play.classList.toggle('on', state.playing);
  el.play.textContent = state.playing ? '暂停' : '播放';
  applyTimeScale();
  updateStat();
});
el.restep.addEventListener('click', () => bake());

async function probeMotions() {
  log('=== 检测全部动作 ===');
  const parts = [];
  const withTimeout = (p, ms) => Promise.race([
    p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
  for (const [id] of MOTIONS) {
    try {
      const fbx = await withTimeout(fbxLoader.loadAsync(`/motions/${id}.fbx`), 8000);
      const clips = fbx.animations || [];
      const desc = clips.map((c) => `${c.tracks.length}@${c.duration.toFixed(2)}`).join(',');
      const best = clips.reduce((a, b) => (b.tracks.length > (a ? a.tracks.length : -1) ? b : a), null);
      const n = best ? best.tracks.length : 0;
      parts.push(`${id}:${desc}`);
      log(`${id.padEnd(24)} clips=${clips.length}  [${desc}]  best=${n}`, n ? 'ok' : 'err');
    } catch (e) {
      parts.push(`${id}:ERR(${e.message})`);
      log(`${id}  加载失败：${e.message}`, 'err');
    }
  }
  log('=== 检测结束 ===');
  // Surface the compact result somewhere both readable and quotable: the status
  // line and the tab title (short strings survive being copied out of a tool).
  el.stat.textContent = parts.join(' | ');
  document.title = parts.join(' | ');
}
el.probe.addEventListener('click', probeMotions);
el.speed.addEventListener('input', () => {
  el.speedV.textContent = `${Number(el.speed.value).toFixed(2)}×`;
  applyTimeScale();
});
el.time.addEventListener('input', () => {
  const t = Number(el.time.value);
  el.timeV.textContent = `${t.toFixed(2)}s`;
  if (state.action) {
    const wasPlaying = state.playing;
    state.mixer.timeScale = 0;
    state.action.time = t;
    if (state.upperAction) state.upperAction.time = t;
    state.mixer.update(0);
    if (wasPlaying) state.mixer.timeScale = Number(el.speed.value);
  }
});
for (const [r, v] of [['yaw', 'yawV'], ['pitch', 'pitchV'], ['myaw', 'myawV']]) {
  el[r].addEventListener('input', () => {
    el[v].textContent = `${el[r].value}°`;
    if (r === 'myaw') { if (state.modelRoot) state.modelRoot.rotation.y = Number(el.myaw.value) * DEG; }
    else bake();
  });
}
el.logtoggle.addEventListener('click', () => {
  const folded = el.logwrap.classList.toggle('folded');
  el.logfold.textContent = folded ? '展开' : '收起';
});

async function selectModel(id) {
  if (state.modelRoot) scene.remove(state.modelRoot);
  state.modelRoot = null; state.baked = null; state.mixer = null; state.action = null;
  state.modelEntry = MODELS.find((m) => m.id === id) || MODELS[0];
  try {
    await loadModel(state.modelEntry);
    scene.add(state.modelRoot);
    state.modelRoot.rotation.y = Number(el.myaw.value) * DEG;
    if (state.srcWrap) bake();
  } catch (err) {
    log(`模型加载失败：${err.message}`, 'err');
  }
}

async function selectMotion(id) {
  state.motionId = id;
  state.baked = null;
  try {
    await loadMotion(id);
    bake();
  } catch (err) {
    log(`动作加载失败：${err.message}`, 'err');
  }
}

async function selectUpperMotion(id) {
  state.upperId = id;
  try {
    await loadUpperMotion(id);
    if (state.srcWrap) bake();
  } catch (err) {
    log(`上半身动作加载失败：${err.message}`, 'err');
  }
}

el.model.addEventListener('change', () => selectModel(el.model.value));
el.motion.addEventListener('change', () => selectMotion(el.motion.value));
el.motionUpper.addEventListener('change', () => selectUpperMotion(el.motionUpper.value));
el.layerToggle.addEventListener('click', () => {
  state.layered = !state.layered;
  el.layerToggle.classList.toggle('on', state.layered);
  el.layerToggle.textContent = state.layered ? '分层模式：开' : '分层模式：关';
  if (state.srcWrap) bake();
});

// ---------------------------------------------------------------------- loop

function resize() {
  const w = innerWidth, h = innerHeight;
  if (el.canvas.width !== w || el.canvas.height !== h) {
    renderer.setSize(w, h, false);
    // Render the left slice of a wider frustum. That pushes the projection
    // centre ~2/3 across the canvas, so the model lands in the clear space to
    // the right of the control panel instead of hiding behind it. setViewOffset
    // also fixes up camera.aspect for us.
    const gutter = Math.min(360, w * 0.4);
    camera.setViewOffset(w + gutter, h, 0, 0, w, h);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  resize();

  if (state.mixer) state.mixer.update(dt);

  // scrub readout follows playback
  if (state.playing && state.action) {
    const t = state.action.time % state.duration;
    el.time.value = String(t);
    el.timeV.textContent = `${t.toFixed(2)}s`;
  }

  const cx = Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
  const cy = Math.sin(cam.pitch) * cam.dist;
  const cz = Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
  camera.position.set(cx + cam.target.x, cy + cam.target.y, cz + cam.target.z);
  camera.lookAt(cam.target);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// --------------------------------------------------------------------- start

(async function main() {
  try {
    const q = new URLSearchParams(location.search);
    const m0 = MODELS.find((m) => m.id === q.get('model')) || MODELS[0];
    const mo0 = MOTIONS.find(([id]) => id === q.get('motion')) || MOTIONS[0];
    const up0 = q.get('upper') || 'shoot-rifle';
    state.modelEntry = m0;
    state.motionId = mo0[0];
    state.upperId = up0;
    if (q.has('nofix')) state.noRestFix = true;   // diagnostics: pre-fix behaviour
    el.model.value = m0.id;
    el.motion.value = mo0[0];
    el.motionUpper.value = UPPER_MOTIONS.some(([id]) => id === up0) ? up0 : 'shoot-rifle';
    await loadModel(m0);
    scene.add(state.modelRoot);
    await loadMotion(mo0[0]);
    await loadUpperMotion(state.upperId);
    bake();
    // optional camera framing for scripted inspection: &cy=&cp=&cd=&ct=
    if (q.has('cy')) cam.yaw = Number(q.get('cy')) * DEG;
    if (q.has('cp')) cam.pitch = Number(q.get('cp')) * DEG;
    if (q.has('cd')) cam.dist = Number(q.get('cd'));
    if (q.has('ct')) cam.target.y = Number(q.get('ct'));
    state.ready = true;
    requestAnimationFrame(loop);
    if (q.has('probe')) probeMotions();
  } catch (err) {
    log(`启动失败：${err.message}`, 'err');
    console.error(err);
  }
})();