// Weapon models and the first-person viewmodel.
//
// The same low-poly weapon builder feeds both the player's own arms and the
// rifle every remote girl is visibly carrying, so a soldier seen across the
// trench is holding exactly what the scoreboard says she is.
//
// Weapons are built pointing down local +Z (muzzle at +Z) in third-person
// space; the first-person rig simply yaws the group 180 degrees.

import * as THREE from 'three';
import { part, joint, toonMat, flatMat, shift } from './toon.js';
import { attachGunModel } from './guns.js';
import { weaponReloadPose } from './reload-motion.js';
import { weaponSockets, weaponViewPose } from './weaponpose.js';
import { buildGripGlove, gripRotation, gloveWrist } from './handpose.js';

const GUNMETAL = '#2f343d';
const GUNMETAL_L = '#454c58';

// The sight anchor is calibrated from the normalized imported geometry. ADS
// cancels that anchor's X/Y offset, not the model origin (MP18 is off-axis).
const ADS_Z = -0.48;

/**
 * The soldier's bare arms. Shared by the third-person body (character.js) and
 * the first-person viewmodel so the two can never drift apart: same sleeve and
 * glove colours, same limb radii. The first-person pair is scaled up by
 * `fpScale` because it sits ~30 cm from the eye instead of metres away.
 */
export function soldierArms(cls) {
  return {
    sleeve: shift(cls.themeColor, -0.18),
    glove: '#3a3f4a',
    upperR: [0.045, 0.037],
    foreR: [0.036, 0.031],
    fpScale: 1.15,
  };
}

function box(x, y, z, w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function cyl(x, y, z, r1, r2, len, seg = 10, axis = 'z') {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * @returns {{group: THREE.Group, muzzle: THREE.Object3D, anchors: object}}
 */
export function buildWeapon(weapon) {
  const group = new THREE.Group();
  const metal = toonMat(GUNMETAL);
  const metalL = toonMat(GUNMETAL_L);
  const wood = toonMat(weapon.wood || '#8a5a2b');
  const dark = flatMat('#171a20');

  const add = (geo, mat, outline = true) => {
    const m = part(group, geo, { material: mat, outline, outlineScale: 1.07 });
    return m;
  };

  switch (weapon.shape) {
    case 'pistol':
      add(box(0,0,.01,.035,.045,.19),metal);
      add(box(0,-.065,-.055,.032,.11,.045),wood);
      add(box(0,.028,-.05,.025,.012,.015),dark);
      break;
    case 'smg':
      add(cyl(0, 0, 0.14, 0.016, 0.016, 0.34), metalL);       // barrel
      add(box(0, 0.005, -0.06, 0.055, 0.095, 0.36), metal);   // receiver
      add(box(0, -0.02, -0.30, 0.05, 0.10, 0.20), wood);      // stock
      add(box(0, -0.115, -0.11, 0.04, 0.19, 0.075), metal);   // magazine
      add(box(0, -0.11, 0.02, 0.042, 0.12, 0.05), wood);      // grip
      add(box(0, 0.065, -0.02, 0.028, 0.03, 0.14), dark);     // rear sight
      add(cyl(0, -0.035, 0.24, 0.012, 0.012, 0.10), metalL);  // muzzle
      break;

    case 'rifle':
      add(cyl(0, 0, 0.30, 0.014, 0.014, 0.46), metalL);
      add(box(0, 0.01, -0.02, 0.06, 0.10, 0.46), metal);
      add(box(0, -0.03, -0.36, 0.055, 0.13, 0.26), wood);
      add(box(0, -0.075, 0.24, 0.05, 0.055, 0.30), wood);     // handguard
      add(box(0, -0.10, -0.06, 0.04, 0.14, 0.06), wood);      // grip
      add(box(0, 0.075, 0.02, 0.026, 0.028, 0.20), dark);
      break;

    case 'lmg':
      add(cyl(0, 0, 0.26, 0.028, 0.028, 0.52, 12), metalL);   // cooling jacket
      add(box(0, 0.02, -0.14, 0.075, 0.115, 0.44), metal);
      add(cyl(0, -0.115, -0.06, 0.115, 0.115, 0.085, 14, 'y'), metal); // pan/drum
      add(box(0, -0.05, -0.42, 0.06, 0.12, 0.28), wood);
      add(box(0, -0.13, 0.02, 0.045, 0.14, 0.06), metal);
      add(cyl(0, -0.07, 0.30, 0.014, 0.014, 0.30), metalL);
      add(box(0, 0.09, -0.02, 0.03, 0.032, 0.24), dark);
      break;

    case 'bolt':
    default:
      add(cyl(0, 0, 0.36, 0.014, 0.014, 0.62), metalL);
      add(box(0, 0.015, -0.06, 0.055, 0.10, 0.42), metal);
      add(box(0, -0.035, -0.40, 0.05, 0.15, 0.30), wood);
      add(box(0, -0.055, 0.28, 0.048, 0.06, 0.30), wood);
      add(box(0, -0.095, -0.04, 0.04, 0.13, 0.055), wood);
      if (weapon.scope) add(cyl(0, 0.10, 0.05, 0.032, 0.032, 0.24, 10), dark); // optic only when equipped
      add(box(0.055, 0.02, -0.10, 0.07, 0.022, 0.022), metal); // bolt handle
      break;
  }

  const muzzle = new THREE.Object3D();
  muzzle.name = 'weapon-muzzle';
  muzzle.position.set(0, 0, weapon.shape === 'pistol' ? .11 : weapon.shape === 'bolt' ? 0.68 : weapon.shape === 'lmg' ? 0.62 : 0.5);
  group.add(muzzle);

  // swap in the imported model once it arrives; the procedural gun above is the
  // placeholder that keeps a weapon visible during the download
  const sockets = weaponSockets(weapon);
  const anchors = { muzzle };
  for (const key of ['hand', 'fore', 'reload', 'eject']) {
    const node = new THREE.Object3D();
    node.name = `weapon-${key}`;
    node.position.fromArray(sockets[key]);
    group.add(node);
    anchors[key] = node;
  }
  const sight = new THREE.Object3D();
  sight.name = 'weapon-sight';
  sight.position.set(0, weapon.shape === 'lmg' ? .105 : .075, .2);
  group.add(sight);
  anchors.sight = sight;
  group.userData.anchors = anchors;
  attachGunModel(weapon, group, muzzle);

  group.traverse((o) => { o.frustumCulled = false; });
  return { group, muzzle, anchors };
}

// ------------------------------------------------------------------ viewmodel

export class ViewModel {
  constructor(data) {
    this.data = data;
    this.root = new THREE.Group();
    this.root.renderOrder = 5;

    this.gunMount = new THREE.Group();
    this.root.add(this.gunMount);

    this.arms = new THREE.Group();
    this.root.add(this.arms);

    this.weapon = null;
    this.t = 0;
    this.bobT = 0;
    this.recoil = 0;
    this.recoilRot = 0;
    this.reloadT = -1;
    this.boltT = -1;
    this.ads = 0;
    this.sprint = 0;
    this._armMatrix = new THREE.Matrix4();
    this._armTarget = new THREE.Vector3();
    this._armDelta = new THREE.Vector3();
    this._armUp = new THREE.Vector3(0, 1, 0);
  }

  setClass(cls) {
    this.cls = cls;
    if (this.armMeshes) this.arms.remove(this.armMeshes);
    this.armMeshes = new THREE.Group();

    // The first-person arms are the character's own arms — the very same spec
    // the third-person body is built from, with only a modest sleeve allowance.
    const a = soldierArms(cls);
    const k = a.fpScale;
    const sleeve = toonMat(a.sleeve);
    const glove = toonMat(a.glove);

    // Keep the shoulders camera-local, but solve each limb to the gun's live
    // attachment every frame. Rotating a static pair around the camera origin
    // made the palms slide off the receiver during ADS/recoil/reloads.
    this.armRigs = [];
    for (const side of [1, -1]) {
      const shoulder = new THREE.Vector3(side * 0.32, -0.46, 0.06);
      const elbow = new THREE.Vector3(side * 0.28, -0.43, -0.15);
      const material = (mat, radius) => {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius, 1, 8), mat);
        this.armMeshes.add(mesh);
        return mesh;
      };
      const upper = material(sleeve, a.upperR[0] * k * 0.8);
      const fore = material(glove, a.foreR[0] * k * 0.8);
      const palm = buildGripGlove(glove, side === 1 ? 'R' : 'L');
      this.armMeshes.add(palm);
      this.armRigs.push({ side, shoulder, elbow, upper, fore, palm });
    }

    this.arms.add(this.armMeshes);
    this.arms.traverse((o) => { o.frustumCulled = false; });
  }

  setWeapon(weapon) {
    // An unknown id (e.g. the server still holding a loadout from before a
    // weapons.json rename) must never leave the previous gun on screen.
    if (!weapon) return this.muzzle;
    this.weapon = weapon;
    if (this.gunMeshes) this.gunMount.remove(this.gunMeshes);
    const built = buildWeapon(weapon);
    this.gunMeshes = built.group;
    this.muzzle = built.muzzle;
    this.anchors = built.anchors;
    this.reloadT = this.boltT = -1;
    this.recoil = this.recoilRot = 0;
    this.gunMeshes.rotation.y = Math.PI;      // +Z muzzle -> -Z forward
    this.gunMesh = built.group;
    this.gunMount.add(built.group);
    // Hip fire holds the gun out to the lower right rather than up at the eye:
    // the imported models are bulky, and a centred one covers the very lane the
    // player is trying to look down. ADS instead uses the calibrated sight anchor.
    this._viewPose = weaponViewPose(weapon);
    this._base = new THREE.Vector3().fromArray(this._viewPose.hip);
    this._adsPos = new THREE.Vector3(0, -.075, ADS_Z);
    this._applyPose(0);
    this.gunMount.traverse((o) => { o.frustumCulled = false; });
    return this.muzzle;
  }

  /**
   * World-space contact points and optional live gun orientation. The palms
   * wrap these points, with the wrist offset behind the palm; when the player's own character model supplies the arms instead
   * (main.js), they are what that rig's IK is solved onto — so the borrowed
   * arms track ADS, recoil and bob with the correct palm and finger direction.
   */
  gripWorld(outHand, outFore, outRotation) {
    if (!this.anchors) return false;
    this.root.updateWorldMatrix(true, true);
    this.anchors.hand.getWorldPosition(outHand);
    this.anchors.fore.getWorldPosition(outFore);
    if (outRotation) this.gunMeshes.getWorldQuaternion(outRotation);
    return true;
  }

  /** Current barrel and ejection points, including this frame's animation. */
  shotWorld(outMuzzle, outEject) {
    if (!this.anchors) return false;
    this.root.updateWorldMatrix(true, true);
    this.muzzle.getWorldPosition(outMuzzle);
    this.anchors.eject.getWorldPosition(outEject);
    return true;
  }

  _updateArms() {
    if (!this.armRigs || !this.anchors) return;
    // Local matrices only: there is no dependency on camera/world update order.
    this.gunMount.updateMatrix();
    this.gunMeshes.updateMatrix();
    const matrix = this._armMatrix.multiplyMatrices(this.gunMount.matrix, this.gunMeshes.matrix);
    const up = this._armUp;
    const aim = (mesh, from, to) => {
      const d = this._armDelta.subVectors(to, from);
      mesh.position.copy(from).addScaledVector(d, 0.5);
      mesh.scale.y = d.length();
      mesh.quaternion.setFromUnitVectors(up, d.normalize());
    };
    for (const rig of this.armRigs) {
      const node = rig.side === 1 ? this.anchors.hand : this.anchors.fore;
      const target = this._armTarget.copy(node.position).applyMatrix4(matrix);
      rig.elbow.set(rig.side * 0.28, Math.min(-0.38, target.y - 0.13), (target.z + 0.06) * 0.38);
      aim(rig.upper, rig.shoulder, rig.elbow);
      rig.palm.position.copy(target);
      const gunRotation = this.gunMount.quaternion.clone().multiply(this.gunMeshes.quaternion);
      gripRotation(gunRotation, rig.side === 1 ? 'R' : 'L', rig.palm.quaternion,this.weapon?.shape);
      // End the sleeve at the wrist, not through the middle of the palm.
      aim(rig.fore, rig.elbow, gloveWrist(target, rig.palm.quaternion));
    }
  }

  kick(strength = 1) {
    this.recoil = Math.min(1.35, this.recoil + strength);
    this.recoilRot = Math.min(0.18, this.recoilRot + 0.065 * strength);
  }

  startReload(ms) {
    this.reloadMs = Math.max(1, ms || 1);
    this.reloadT = 0;
    this.boltT = -1;
  }

  syncReload(total, remaining, active) {
    if (!active) { this.reloadT = -1; return; }
    this.reloadMs = Math.max(1, total || remaining || 1);
    this.reloadT = Math.max(0, this.reloadMs - remaining);
  }

  /** A short bolt-cycle dip, played the moment a new round is chambered. */
  cycleBolt(ms = 640) {
    this.boltMs = ms;
    this.boltT = 0;
  }

  _applyPose(adsFactor) {
    if (!this._base) return;
    const sight = this.anchors?.sight;
    if (sight) this._adsPos.set(sight.position.x, -sight.position.y, this._viewPose?.adsZ ?? ADS_Z);
    const p = this._base.clone().lerp(this._adsPos, adsFactor);
    this.gunMount.position.copy(p);
    this.gunMount.rotation.set(
      this.recoilRot + (this.sprint * 0.5),
      (1 - adsFactor) * -0.05,
      (1 - adsFactor) * 0.06 + this.sprint * 0.9,
    );

  }

  update(dt, st) {
    this.t += dt;
    const moving = st.moveSpeed > 0.6;
    if (moving) this.bobT += dt * (st.sprinting ? 15.5 : 10.0);
    else this.bobT += dt * 1.6;

    this.recoil *= Math.exp(-dt * 18);
    this.recoilRot *= Math.exp(-dt * 16);

    // ADS blend: sprint always wins, sprinting pins the gun down at the hip.
    this.sprint += ((st.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    const wantAds = st.ads && !st.sprinting && this.reloadT < 0 ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 11);

    let reload = weaponReloadPose(this.weapon,0);
    if (this.reloadT >= 0) {
      this.reloadT += dt * 1000;
      const k = this.reloadT / this.reloadMs;
      if (k >= 1) { this.reloadT = -1; }
      else reload = weaponReloadPose(this.weapon,k);
    }

    let boltDrop = 0;
    if (this.boltT >= 0) {
      this.boltT += dt * 1000;
      const k = this.boltT / this.boltMs;
      if (k >= 1) this.boltT = -1;
      else boltDrop = Math.sin(Math.min(1, k) * Math.PI);
    }

    const amp = moving ? (st.sprinting ? 1.5 : 1.0) : 0.28;
    const bobX = Math.sin(this.bobT) * 0.014 * amp;
    const bobY = Math.abs(Math.cos(this.bobT)) * 0.011 * amp;
    const breathe = Math.sin(this.t * 1.7) * 0.004;

    this._applyPose(this.ads);

    this.gunMount.position.x += bobX * (1 - this.ads) + breathe * (1 - this.ads) + reload.position[0];
    this.gunMount.position.y += bobY * (1 - this.ads) + breathe * (1 - this.ads) + reload.position[1]
      - boltDrop * 0.045;
    this.gunMount.position.z += this.recoil * 0.045;
    this.gunMount.rotation.y += reload.rotation[1];
    this.gunMount.rotation.x += reload.rotation[0] + boltDrop * 0.14 + Math.sin(this.bobT * 0.5) * 0.006 * (1 - this.ads);
    this.gunMount.rotation.z += Math.sin(this.bobT * 0.5) * 0.02 * (1 - this.ads) + reload.rotation[2] + boltDrop * 0.24;

    if (this.anchors) {
      const sockets = weaponSockets(this.weapon);
      this.anchors.hand.position.fromArray(sockets.hand);
      if (this.weapon?.shape === 'bolt' && !reload.present) {
        this.anchors.hand.position.x -= boltDrop * 0.04;
        this.anchors.hand.position.y += boltDrop * 0.09;
        this.anchors.hand.position.z -= boltDrop * 0.06;
      }
      this.anchors.fore.position.fromArray(reload.fore);
    }
    // Keep both service contacts inside the lower viewport during a reload.
    // The per-gun drop/roll used to put whole arms below the near-screen edge;
    // bone reach tests alone cannot detect that. Do not disturb ADS calibration.
    if(reload.present>0&&this.anchors){
      this.gunMount.updateMatrix();this.gunMeshes.updateMatrix();
      const matrix=this._armMatrix.multiplyMatrices(this.gunMount.matrix,this.gunMeshes.matrix);
      const tangent=Math.tan(THREE.MathUtils.degToRad(st.viewFov||78)*.5)*.72;
      let lift=0;
      for(const anchor of [this.anchors.hand,this.anchors.fore]){
        const contact=this._armTarget.copy(anchor.position).applyMatrix4(matrix);
        lift=Math.max(lift,-Math.max(.12,-contact.z)*tangent-contact.y);
      }
      this.gunMount.position.y+=lift*reload.present;
    }
    this._updateArms();
  }
}
