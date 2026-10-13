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

const GUNMETAL = '#2f343d';
const GUNMETAL_L = '#454c58';

// ADS mount, in camera space. Most guns share one spot, but two imports are
// tall enough that at this height a part sat straight across the sight line, so
// they get mounted lower: the Chauchat's receiver and the Lewis's pan magazine.
// Measured by ray-casting the crosshair — both block every sample ray at the
// common height and none of them once lowered, while the barrel still runs
// forward.
const ADS_Y = -0.145;
const ADS_DROP = { chauchat: 0.06, lewis: 0.03 };

// Where the borrowed character arms must reach in first person, expressed in the
// weapon mount's own frame (which, because the gun group is yawed 180 degrees,
// runs the opposite way to the third-person mount: muzzle on -Z, stock on +Z).
// `hand` is the trigger grip; `fore` the support hand. `fore` cannot sit on the
// real muzzle-end handguard — that is a forearm's length out, past what the
// borrowed (petite) arms can reach, and the IK left the hand ~30 cm short of the
// gun. It is instead a point on the receiver, part way from the trigger grip to
// rig.js's GRIPS handguard, which keeps it on the weapon while staying in reach.
const FP_GRIPS = {
  smg: { hand: [0, -0.110, -0.02], fore: [0, -0.072, -0.10] },
  rifle: { hand: [0, -0.100, 0.06], fore: [0, -0.089, -0.075] },
  lmg: { hand: [0, -0.130, -0.02], fore: [0, -0.094, -0.13] },
  bolt: { hand: [0, -0.095, 0.04], fore: [0, -0.077, -0.104] },
};

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
    hand: [0.062, 0.075, 0.085],
    handDrop: 0.028,
    fpScale: 1.7,
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
 * @returns {{group: THREE.Group, muzzle: THREE.Object3D}}
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
      add(cyl(0, 0.10, 0.05, 0.032, 0.032, 0.24, 10), dark);  // scope
      add(box(0.055, 0.02, -0.10, 0.07, 0.022, 0.022), metal); // bolt handle
      break;
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, weapon.shape === 'bolt' ? 0.68 : weapon.shape === 'lmg' ? 0.62 : 0.5);
  group.add(muzzle);

  // swap in the imported model once it arrives; the procedural gun above is the
  // placeholder that keeps a weapon visible during the download
  attachGunModel(weapon, group, muzzle);

  group.traverse((o) => { o.frustumCulled = false; });
  return { group, muzzle };
}

// ------------------------------------------------------------------ viewmodel

/** A tapered limb between two points. Cheaper and more robust than solving IK. */
function boneBetween(a, b, r0, r1, mat, outline = true) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, 7, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const g = new THREE.Group();
  g.add(mesh);
  if (outline) {
    const o = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a1420, side: THREE.BackSide }));
    o.position.copy(mesh.position);
    o.quaternion.copy(mesh.quaternion);
    o.scale.setScalar(1.1);
    g.add(o);
  }
  return g;
}

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
  }

  setClass(cls) {
    this.cls = cls;
    if (this.armMeshes) this.arms.remove(this.armMeshes);
    this.armMeshes = new THREE.Group();

    // The first-person arms are the character's own arms — the very same spec
    // the third-person body is built from — just scaled up for the short lens.
    const a = soldierArms(cls);
    const k = a.fpScale;
    const sleeve = toonMat(a.sleeve);
    const glove = toonMat(a.glove);
    const skin = toonMat('#fbe3d4');

    // Hand anchor points, in camera space. Positive X is right, -Z forward.
    const gripR = new THREE.Vector3(0.085, -0.135, -0.33);
    const gripL = new THREE.Vector3(-0.02, -0.10, -0.52);
    this.gripR = gripR;
    this.gripL = gripL;

    const elbowR = new THREE.Vector3(0.30, -0.50, -0.12);
    const elbowL = new THREE.Vector3(-0.30, -0.52, -0.24);
    const shoulderR = new THREE.Vector3(0.42, -0.66, 0.16);
    const shoulderL = new THREE.Vector3(-0.42, -0.68, 0.10);

    const push = (g) => { this.armMeshes.add(g); return g; };

    push(boneBetween(shoulderR, elbowR, a.upperR[0] * k, a.upperR[1] * k, sleeve));
    // the forearm wears the glove, exactly as it does on the character body
    push(boneBetween(elbowR, gripR, a.foreR[0] * k, a.foreR[1] * k, glove));
    push(boneBetween(shoulderL, elbowL, a.upperR[0] * k, a.upperR[1] * k, sleeve));
    push(boneBetween(elbowL, gripL, a.foreR[0] * k, a.foreR[1] * k, glove));

    for (const h of [gripR, gripL]) {
      const g = new THREE.Group();
      const geo = new THREE.BoxGeometry(a.hand[0] * k, a.hand[1] * k, a.hand[2] * k);
      const m = new THREE.Mesh(geo, glove);
      m.position.copy(h);
      g.add(m);
      const o = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a1420, side: THREE.BackSide }));
      o.position.copy(h);
      o.scale.setScalar(1.08);
      g.add(o);
      this.armMeshes.add(g);
    }
    // knuckle hint, so the hands do not read as blocks
    for (const h of [gripR, gripL]) {
      const kw = a.hand[0] * k * 1.04, kh = a.hand[1] * k * 0.23, kd = a.hand[2] * k * 0.75;
      const kn = new THREE.Mesh(new THREE.BoxGeometry(kw, kh, kd), skin);
      kn.position.copy(h).add(new THREE.Vector3(0, a.handDrop * k, 0.01));
      this.armMeshes.add(kn);
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
    this.gunMeshes.rotation.y = Math.PI;      // +Z muzzle -> -Z forward
    this.gunMesh = built.group;
    this.gunMount.add(built.group);
    // Hip fire holds the gun out to the lower right rather than up at the eye:
    // the imported models are bulky, and a centred one covers the very lane the
    // player is trying to look down. ADS brings it back in low and centred.
    this._base = new THREE.Vector3(0.20, -0.26, -0.36);
    // IK anchors for the borrowed character arms, on the mount itself, so the
    // hands ride the gun through ADS, recoil and bob instead of drifting above it
    const grips = FP_GRIPS[weapon.shape] || FP_GRIPS.rifle;
    this.gunR = new THREE.Vector3().fromArray(grips.hand);
    this.gunL = new THREE.Vector3().fromArray(grips.fore);
    // ADS parks the gun LOW rather than dead centre: the imported models are
    // bulkier than the procedural placeholder, and centring them put the whole
    // receiver across the sight line. Keeping the mount well below the eye line
    // leaves the crosshair clear while the barrel still runs forward.
    this._adsPos = new THREE.Vector3(0.0, ADS_Y - (ADS_DROP[weapon.id] || 0), -0.335);
    this._applyPose(0);
    this.gunMount.traverse((o) => { o.frustumCulled = false; });
    return this.muzzle;
  }

  /**
   * World-space positions of the two hand anchors. The procedural arms use them
   * directly; when the player's own character model supplies the arms instead
   * (main.js), they are what that rig's IK is solved onto — so the borrowed
   * arms track ADS, recoil and bob exactly like the placeholder pair did.
   */
  gripWorld(outHand, outFore) {
    if (!this.gunR) return false;
    this.gunMount.updateMatrixWorld(true);
    outHand.copy(this.gunR).applyMatrix4(this.gunMount.matrixWorld);
    outFore.copy(this.gunL).applyMatrix4(this.gunMount.matrixWorld);
    return true;
  }

  kick(strength = 1) {
    this.recoil = Math.min(1.35, this.recoil + strength);
    this.recoilRot = Math.min(0.42, this.recoilRot + 0.22 * strength);
  }

  startReload(ms) {
    this.reloadMs = ms;
    this.reloadT = 0;
  }

  /** A short bolt-cycle dip, played the moment a new round is chambered. */
  cycleBolt(ms = 640) {
    this.boltMs = ms;
    this.boltT = 0;
  }

  _applyPose(adsFactor) {
    if (!this._base) return;
    const p = this._base.clone().lerp(this._adsPos, adsFactor);
    this.gunMount.position.copy(p);
    this.gunMount.rotation.set(
      -this.recoilRot + (this.sprint * 0.5),
      (1 - adsFactor) * -0.05,
      (1 - adsFactor) * 0.06 + this.sprint * 0.9,
    );
    this.arms.position.copy(p).sub(this._base);
    this.arms.rotation.copy(this.gunMount.rotation);
  }

  update(dt, st) {
    this.t += dt;
    const moving = st.moveSpeed > 0.6;
    if (moving) this.bobT += dt * (st.sprinting ? 15.5 : 10.0);
    else this.bobT += dt * 1.6;

    this.recoil = Math.max(0, this.recoil - dt * 11.0);
    this.recoilRot = Math.max(0, this.recoilRot - dt * 3.6);

    // ADS blend: sprint always wins, sprinting pins the gun down at the hip.
    this.sprint += ((st.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 8);
    const wantAds = st.ads && !st.sprinting ? 1 : 0;
    this.ads += (wantAds - this.ads) * Math.min(1, dt * 11);

    let reloadDrop = 0;
    if (this.reloadT >= 0) {
      this.reloadT += dt * 1000;
      const k = this.reloadT / this.reloadMs;
      if (k >= 1) { this.reloadT = -1; }
      else reloadDrop = Math.sin(Math.min(1, k) * Math.PI);
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

    this.gunMount.position.x += bobX * (1 - this.ads * 0.7) + breathe;
    this.gunMount.position.y += bobY * (1 - this.ads * 0.7) + breathe + reloadDrop * 0.34
      - boltDrop * 0.045;
    this.gunMount.position.z += this.recoil * 0.075;
    this.gunMount.rotation.x += reloadDrop * 1.15 + boltDrop * 0.14 + Math.sin(this.bobT * 0.5) * 0.006;
    this.gunMount.rotation.z += Math.sin(this.bobT * 0.5) * 0.02 - reloadDrop * 0.5 + boltDrop * 0.24;

    this.arms.position.copy(this.gunMount.position).sub(this._base);
    this.arms.rotation.copy(this.gunMount.rotation);
  }
}
