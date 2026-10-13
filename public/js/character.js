// The playable girls.
//
// No skinning, no imported models: every character is assembled from primitives
// onto a small joint hierarchy, then animated by driving joint rotations with
// sines. That keeps the download at zero bytes of art while still producing the
// things that actually read as "anime" at 20 metres:
//
//   * ~5.7 head-tall proportions (1.70 m tall, 0.30 m head) — slim, not chibi
//   * a stepped toon ramp plus an ink outline on every closed mesh
//   * oversized glossy eyes drawn straight onto the head cap
//   * a light "highlight band" arcing across the hair (the single strongest cue)
//   * four unmistakable silhouettes: short bob / long curls / high ponytail / long straight
//
// Engineering note: the hit capsule on the server is 1.70 m and never includes
// hair, so hair volumes are kept thin and a crouch only lowers the body a
// little — the visible head has to stay where the server says it is.

import * as THREE from 'three';
import { part, joint, toonMat, flatMat, shift } from './toon.js';
import { makeFaceTexture } from './face.js';
import { buildWeapon, soldierArms } from './viewmodel.js';
import { contactShadow } from './map.js';

const TAU = Math.PI * 2;

// body plan (metres above the feet)
const HIP_Y = 0.98;
const TORSO_Y = 1.04;
const SHOULDER_Y = 1.335;
const NECK_Y = 1.37;
const HEAD_Y = 1.445;
const HEAD_R = 0.135;
const HEAD_SCALE = [0.95, 1.06, 0.98];
// face cap: centred on +Z, sized so the features land inside the visible band
const CAP_PHI = [Math.PI / 2 - 0.95, 1.9];
const CAP_THETA = [Math.PI / 2 - 0.95, 1.9];

function glowShell(parent, geo, color, opacity = 0.42, scale = 1.14) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.BackSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.scale.setScalar(scale);
  parent.add(m);
  return m;
}

/** Thin arc standing proud of the hair; the anime hair highlight. */
function hairBand(parent, radius, y, color, halfDeg = 62, height = 0.026, opacity = 0.95) {
  const half = (halfDeg * Math.PI) / 180;
  const geo = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true, -half, half * 2);
  const m = new THREE.Mesh(geo, flatMat(color, { transparent: true, opacity, side: THREE.DoubleSide }));
  m.position.y = y;
  parent.add(m);
  return m;
}

function addHat(parent, kind, cls, team) {
  const h = HEAD_Y;
  switch (kind) {
    case 'adrian': { // assault: khaki-steel Adrian helmet, worn at a tilt
      const dome = new THREE.SphereGeometry(0.163, 18, 12, 0, TAU, 0, Math.PI * 0.52);
      const d = part(parent, dome, { color: '#8d9ba6', outline: true, outlineScale: 1.05 });
      d.position.set(0, h + 0.052, 0);
      d.rotation.set(-0.10, 0, 0.09);
      const brim = new THREE.CylinderGeometry(0.176, 0.181, 0.022, 18, 1, true);
      const b = part(parent, brim, { color: '#7a8792', outline: false });
      b.position.set(0, h + 0.012, 0);
      b.rotation.set(-0.10, 0, 0.09);
      const crest = part(parent, new THREE.BoxGeometry(0.022, 0.055, 0.10), { color: cls.accentColor, outline: false });
      crest.position.set(0, h + 0.145, 0.01);
      break;
    }
    case 'cap': { // support: field cap
      const crown = new THREE.SphereGeometry(0.152, 16, 10, 0, TAU, 0, Math.PI * 0.5);
      const c = part(parent, crown, { color: '#4c4a32', outline: true, outlineScale: 1.05 });
      c.position.set(0, h + 0.062, 0);
      const band = new THREE.CylinderGeometry(0.156, 0.158, 0.045, 18, 1, true);
      const bd = part(parent, band, { color: cls.themeColor, outline: false });
      bd.position.set(0, h + 0.035, 0);
      const visor = part(parent, new THREE.BoxGeometry(0.20, 0.016, 0.10), { color: '#3d3b28', outline: false });
      visor.position.set(0, h + 0.028, 0.135);
      visor.rotation.x = -0.12;
      break;
    }
    case 'beret': { // scout: beret pushed to one side
      const dome = new THREE.SphereGeometry(0.168, 18, 12, 0, TAU, 0, Math.PI * 0.55);
      const d = part(parent, dome, { color: '#4a3f8f', outline: true, outlineScale: 1.05, scale: [1.05, 0.72, 1.02] });
      d.position.set(-0.028, h + 0.058, -0.01);
      d.rotation.set(-0.06, 0, 0.22);
      const badge = part(parent, new THREE.CylinderGeometry(0.018, 0.018, 0.01, 8), { color: cls.themeColor, outline: false });
      badge.position.set(-0.10, h + 0.085, 0.085);
      badge.rotation.x = Math.PI / 2;
      break;
    }
    case 'nursecap': { // medic: white cap + headband
      const band = new THREE.CylinderGeometry(0.148, 0.148, 0.028, 18, 1, true);
      const b = part(parent, band, { color: '#ffffff', outline: false });
      b.position.set(0, h + 0.045, 0);
      const cap = part(parent, new THREE.SphereGeometry(0.062, 12, 8, 0, TAU, 0, Math.PI * 0.5), { color: '#fbfcfe', outline: true, outlineScale: 1.06 });
      cap.position.set(0.055, h + 0.082, 0.045);
      cap.rotation.z = 0.16;
      const crossV = part(parent, new THREE.BoxGeometry(0.012, 0.042, 0.012), { color: '#d8342f', outline: false });
      crossV.position.set(0.055, h + 0.108, 0.078);
      const crossH = part(parent, new THREE.BoxGeometry(0.042, 0.012, 0.012), { color: '#d8342f', outline: false });
      crossH.position.set(0.055, h + 0.108, 0.078);
      break;
    }
  }
}

function addHair(parent, cls) {
  const style = cls.hairStyle;
  const hair = cls.hairColor;
  const dark = shift(hair, -0.30);
  const light = shift(hair, 0.46);

  const crown = new THREE.SphereGeometry(0.1465, 20, 14, 0, TAU, 0, Math.PI * 0.415);
  const c = part(parent, crown, { color: hair, outline: true, outlineScale: 1.045, scale: HEAD_SCALE });
  c.position.y = HEAD_Y;

  // mass at the back of the skull, every style has it
  const back = new THREE.SphereGeometry(0.150, 18, 14, Math.PI, Math.PI, 0, Math.PI * 0.64);
  const bk = part(parent, back, { color: hair, outline: true, outlineScale: 1.04, scale: HEAD_SCALE });
  bk.position.y = HEAD_Y;

  const len = style === 'short' ? 0.16 : style === 'ponytail' ? 0.22 : style === 'long' ? 0.46 : 0.40;
  const width = style === 'short' ? 0.20 : 0.235;

  // sheet of hair down the back
  const sheetGeo = new THREE.CylinderGeometry(width * 0.52, width * 0.40, len, 8, 1, false);
  const sheet = part(parent, sheetGeo, { color: dark, outline: true, outlineScale: 1.035, scale: [1.0, 1, 0.72] });
  sheet.position.set(0, HEAD_Y - 0.06 - len * 0.5, -0.075);

  if (style === 'long') {
    // side curls: a run of spheres so the silhouette ripples
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const r = 0.052 - i * 0.007;
        const s = part(parent, new THREE.SphereGeometry(r, 10, 8), { color: hair, outline: true, outlineScale: 1.06 });
        s.position.set(sx * (0.145 - i * 0.006), HEAD_Y - 0.02 - i * 0.085, -0.03 + (i % 2) * 0.02);
      }
    }
  } else if (style === 'ponytail') {
    const tail = new THREE.CylinderGeometry(0.052, 0.028, 0.34, 8, 1);
    const t = part(parent, tail, { color: hair, outline: true, outlineScale: 1.06 });
    t.position.set(0, HEAD_Y + 0.14, -0.155);
    t.rotation.x = -0.55;
    const tie = part(parent, new THREE.TorusGeometry(0.045, 0.014, 6, 12), { color: cls.accentColor, outline: false });
    tie.position.set(0, HEAD_Y + 0.155, -0.10);
    tie.rotation.x = -0.5;
  } else if (style === 'straight') {
    const cape = part(parent, new THREE.BoxGeometry(0.235, 0.34, 0.05), { color: dark, outline: true, outlineScale: 1.03 });
    cape.position.set(0, HEAD_Y - 0.30, -0.095);
    cape.rotation.x = -0.06;
  }

  // bangs: pointed cones hanging over the forehead, tips near the brows
  const n = style === 'ponytail' ? 7 : 6;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const phi = Math.PI / 2 + (u - 0.5) * 1.72;
    const theta = 1.16;
    const r = 0.148;
    const x = -r * Math.cos(phi) * Math.sin(theta);
    const z = r * Math.sin(phi) * Math.sin(theta);
    const y = r * Math.cos(theta);
    const drop = 0.075 + (i % 2) * 0.032;
    const spike = part(parent, new THREE.ConeGeometry(0.031, drop, 4), { color: hair, outline: true, outlineScale: 1.07 });
    spike.position.set(x, HEAD_Y + y - drop * 0.42, z);
    spike.rotation.set(Math.PI + 0.12, 0, 0);
  }

  // side locks framing the face
  for (const sx of [-1, 1]) {
    const sl = part(parent, new THREE.BoxGeometry(0.055, 0.235, 0.07), { color: hair, outline: true, outlineScale: 1.06 });
    sl.position.set(sx * 0.132, HEAD_Y + 0.015, 0.028);
    sl.rotation.z = sx * 0.07;
  }

  hairBand(parent, 0.1555, HEAD_Y + 0.052, light, 58, 0.028, 0.9);
  hairBand(parent, 0.1530, HEAD_Y + 0.026, light, 40, 0.014, 0.6);
}

function addUniform(parent, torsoG, hipG, cls, team) {
  const col = cls.themeColor;
  const acc = cls.accentColor;

  // torso tunic, slightly oversized so it reads as clothing over the body
  const tunic = part(torsoG, new THREE.CylinderGeometry(0.118, 0.098, 0.335, 10), {
    color: col, outline: true, outlineScale: 1.045, scale: [1.34, 1, 0.88],
  });
  tunic.position.y = 0.165;

  // belt
  const belt = part(hipG, new THREE.CylinderGeometry(0.132, 0.132, 0.05, 12), {
    color: acc, outline: false, scale: [1.32, 1, 0.9],
  });
  belt.position.y = 0.086;

  // skirt: open cone, no outline because it has no back face
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.138, 0.205, 0.245, 14, 1, true),
    toonMat(shift(col, -0.35), { side: THREE.DoubleSide }),
  );
  skirt.position.y = -0.045;
  hipG.add(skirt);

  // team armband on the right upper arm — always readable, always same side
  const band = part(torsoG, new THREE.CylinderGeometry(0.0465, 0.0465, 0.05, 10), { color: team.color, outline: false });
  band.position.set(-0.155, 0.20, 0);
  band.rotation.z = 1.2;

  switch (cls.id) {
    case 'assault': {
      const pack = part(torsoG, new THREE.BoxGeometry(0.20, 0.185, 0.10), { color: shift(acc, -0.25), outline: true, outlineScale: 1.05 });
      pack.position.set(0, 0.16, -0.145);
      const sling = part(torsoG, new THREE.BoxGeometry(0.30, 0.032, 0.028), { color: '#5a4a2e', outline: false });
      sling.position.set(0, 0.235, 0.075);
      sling.rotation.z = 0.34;
      const hairpin = part(torsoG, new THREE.BoxGeometry(0.055, 0.014, 0.012), { color: '#ffd97a', outline: false });
      hairpin.position.set(0.098, 0.10, 0.06);
      break;
    }
    case 'medic': {
      const bag = part(hipG, new THREE.BoxGeometry(0.155, 0.14, 0.085), { color: '#f2f3f6', outline: true, outlineScale: 1.05 });
      bag.position.set(0.145, -0.03, 0.02);
      const crossV = part(hipG, new THREE.BoxGeometry(0.014, 0.062, 0.012), { color: '#d8342f', outline: false });
      crossV.position.set(0.145, -0.03, 0.066);
      const crossH = part(hipG, new THREE.BoxGeometry(0.062, 0.014, 0.012), { color: '#d8342f', outline: false });
      crossH.position.set(0.145, -0.03, 0.066);
      break;
    }
    case 'support': {
      // shoulder cape over a greatcoat
      const cape = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.225, 0.24, 12, 1, true),
        toonMat(shift(col, -0.42), { side: THREE.DoubleSide }),
      );
      cape.position.y = 0.30;
      torsoG.add(cape);
      // crossed bandolier
      for (const s of [-1, 1]) {
        const belt2 = part(torsoG, new THREE.BoxGeometry(0.036, 0.36, 0.03), { color: '#6b5a3a', outline: false });
        belt2.position.set(0, 0.17, 0.088);
        belt2.rotation.z = 0.42 * s;
        for (let i = 0; i < 4; i++) {
          const pk = part(torsoG, new THREE.BoxGeometry(0.022, 0.040, 0.016), { color: acc, outline: false });
          pk.position.set(Math.sin(0.42 * s) * (0.10 - i * 0.055) * -s, 0.30 - i * 0.075, 0.10);
        }
      }
      break;
    }
    case 'scout': {
      // long half-cape, hangs off the shoulders and trails when running
      const capeG = joint(torsoG, 0, 0.315, -0.09);
      const cape = part(capeG, new THREE.BoxGeometry(0.30, 0.50, 0.035), { color: shift(col, -0.34), outline: true, outlineScale: 1.03 });
      cape.position.y = -0.25;
      cape.rotation.x = 0.05;
      torsoG.userData.cape = capeG;
      const bino = part(torsoG, new THREE.CylinderGeometry(0.026, 0.03, 0.055, 8), { color: '#2f343d', outline: false });
      bino.position.set(0, 0.12, 0.10);
      bino.rotation.x = Math.PI / 2;
      break;
    }
  }
}

function addLegs(parent, cls) {
  // tall socks / boots, darker than the uniform
  const sock = cls.id === 'scout' ? '#2f3348' : shift(cls.themeColor, -0.45);
  const boot = '#33291f';
  const legs = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const hip = joint(parent, sx * 0.083, HIP_Y, 0);
    const thigh = part(hip, new THREE.CylinderGeometry(0.063, 0.049, 0.46, 8), {
      color: shift(cls.themeColor, -0.55), outline: true, outlineScale: 1.05, scale: [1.05, 1, 1],
    });
    thigh.position.y = -0.23;

    const knee = joint(hip, 0, -0.46, 0);
    const shin = part(knee, new THREE.CylinderGeometry(0.046, 0.036, 0.42, 8), { color: sock, outline: true, outlineScale: 1.05 });
    shin.position.y = -0.205;

    const footG = joint(knee, 0, -0.415, 0);
    const shoe = part(footG, new THREE.BoxGeometry(0.088, 0.085, 0.20), { color: boot, outline: true, outlineScale: 1.05 });
    shoe.position.set(0, 0.028, 0.035);
    const toe = part(footG, new THREE.BoxGeometry(0.082, 0.055, 0.07), { color: shift(boot, 0.15), outline: true, outlineScale: 1.06 });
    toe.position.set(0, 0.014, 0.145);

    legs[side] = { hip, knee, foot: footG };
  }
  return legs;
}

function addArms(parent, cls, team) {
  const arms = {};
  const a = soldierArms(cls);
  const sleeve = toonMat(a.sleeve);
  const glove = toonMat(a.glove);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const sh = joint(parent, sx * 0.152, SHOULDER_Y - TORSO_Y, 0);
    const upper = part(sh, new THREE.CylinderGeometry(a.upperR[0], a.upperR[1], 0.27, 7), { material: sleeve, outline: true, outlineScale: 1.06 });
    upper.position.y = -0.135;

    const el = joint(sh, 0, -0.27, 0);
    const fore = part(el, new THREE.CylinderGeometry(a.foreR[0], a.foreR[1], 0.25, 7), { material: glove, outline: true, outlineScale: 1.06 });
    fore.position.y = -0.125;

    const hand = joint(el, 0, -0.25, 0);
    const h = part(hand, new THREE.BoxGeometry(a.hand[0], a.hand[1], a.hand[2]), { material: glove, outline: true, outlineScale: 1.06 });
    h.position.y = -a.handDrop;

    arms[side] = { sh, el, hand };
  }
  return arms;
}

/**
 * Contact shadow + teammate marker, shared by the built-in girl and any imported
 * rig so both read as the same faction on the field.
 *
 * The marker is parented to `markerParent` (the head joint for the built-in
 * girl) so it tracks the head; the shadow stays on `root`.
 */
export function buildFactionOverlay(root, team, data, markerParent, markerY) {
  const shadow = contactShadow(0.44);
  root.add(shadow);

  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.085, 0.13, 3),
    new THREE.MeshBasicMaterial({ color: data.teamById[0].color, transparent: true, opacity: 0.9 }),
  );
  marker.rotation.x = Math.PI;
  marker.position.y = markerY;
  markerParent.add(marker);

  return { marker, shadow };
}

export function createGirl(cls, team, data) {
  const root = new THREE.Group();
  const bob = new THREE.Group();
  root.add(bob);

  const hipG = joint(bob, 0, HIP_Y, 0);
  const pelvis = part(hipG, new THREE.CylinderGeometry(0.10, 0.092, 0.20, 9), {
    color: shift(cls.themeColor, -0.45), outline: true, outlineScale: 1.05, scale: [1.3, 1, 0.86],
  });

  const torsoG = joint(hipG, 0, TORSO_Y - HIP_Y, 0);
  const torso = part(torsoG, new THREE.CylinderGeometry(0.113, 0.095, 0.33, 9), {
    color: shift(cls.themeColor, -0.25), outline: true, outlineScale: 1.045, scale: [1.32, 1, 0.85],
  });
  torso.position.y = 0.165;
  // subtle bust volume — kept low-key, this is a soldier not a pin-up
  for (const s of [-1, 1]) {
    const b = part(torsoG, new THREE.SphereGeometry(0.058, 10, 8), { color: shift(cls.themeColor, -0.25), outline: false });
    b.position.set(s * 0.05, 0.20, 0.062);
    b.scale.set(1.05, 0.9, 0.72);
  }
  glowShell(torsoG, new THREE.CylinderGeometry(0.113, 0.095, 0.34, 9), team.glow, 0.34, 1.16)
    .position.y = 0.165;

  const neckG = joint(torsoG, 0, NECK_Y - TORSO_Y, 0);
  const neck = part(neckG, new THREE.CylinderGeometry(0.038, 0.043, 0.075, 8), { color: '#f0cdb8', outline: false });
  neck.position.y = 0.037;

  // headG sits at head height so the head can pivot there; the head parts below
  // are authored around y = 0 meaning "head height", so this inner joint undoes
  // the offset (without it every head part lands one head-height too high).
  const headG = joint(neckG, 0, HEAD_Y - NECK_Y, 0);
  const headP = joint(headG, 0, -HEAD_Y, 0);

  const { marker, shadow } = buildFactionOverlay(root, team, data, headP, HEAD_Y + 0.40);

  const head = part(headP, new THREE.SphereGeometry(HEAD_R, 22, 18), {
    color: '#fbe3d4', outline: true, outlineScale: 1.03, scale: HEAD_SCALE,
  });
  head.position.y = HEAD_Y;

  // The face is a sphere cap rather than a flat quad, so it curves with the
  // skull and never clips through it. Toon-shaded with the same ramp as the
  // skin sphere underneath, which makes the two read as one surface.
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_R * 1.016, 26, 22, CAP_PHI[0], CAP_PHI[1], CAP_THETA[0], CAP_THETA[1]),
    toonMat('#ffffff', { map: makeFaceTexture(cls) }),
  );
  face.position.y = HEAD_Y;
  face.scale.fromArray(HEAD_SCALE);
  headP.add(face);

  glowShell(headP, new THREE.SphereGeometry(HEAD_R, 18, 14), team.glow, 0.30, 1.22).position.y = HEAD_Y;

  addHair(headP, cls);
  addHat(headP, cls.id === 'assault' ? 'adrian' : cls.id === 'medic' ? 'nursecap' : cls.id === 'support' ? 'cap' : 'beret', cls, team);

  addUniform(bob, torsoG, hipG, cls, team);
  const legs = addLegs(bob, cls);
  const arms = addArms(torsoG, cls, team);

  // hands hold the rifle at chest height
  const hands = joint(torsoG, 0, 0.135, 0.115);
  const weaponMount = new THREE.Group();
  weaponMount.rotation.x = -0.08;
  hands.add(weaponMount);

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });

  const st = {
    phase: Math.random() * 6.28,
    t: Math.random() * 10,
    crouch: 0,
    weapon: null,
    dead: false,
  };

  const girl = {
    root, marker, headG, shadow,
    height: 1.70,

    setWeapon(weapon) {
      if (st.weapon === weapon) return;
      st.weapon = weapon;
      weaponMount.clear();
      const built = buildWeapon(weapon);
      // buildWeapon already points the muzzle down local +Z, which is also the
      // character's forward, so no extra yaw is needed here.
      built.group.position.set(0.04, -0.03, 0.06);
      weaponMount.add(built.group);
      built.group.traverse((o) => { o.frustumCulled = false; });
      // Kept so this girl's own muzzle flash leaves the right barrel: main.js
      // asks for the world point when her trigger pulls (see gunfx.js).
      st.muzzle = built.muzzle;
    },

    /** World position of this character's muzzle; false when she has no gun. */
    muzzleWorld(out) {
      if (!st.muzzle) return false;
      st.muzzle.getWorldPosition(out);
      return true;
    },

    setAlive(alive) {
      st.dead = !alive;
      root.visible = alive;
    },

    destroy() {
      root.removeFromParent();
    },

    /**
     * @param {number} dt seconds
     * @param {{speed:number, sprint:boolean, crouch:boolean, pitch:number, yaw:number}} s
     */
    update(dt, s) {
      st.t += dt;
      const speed = s.speed || 0;
      const run = speed > 0.6;
      const rate = s.sprint ? 13.0 : 8.4;
      if (run) st.phase += dt * rate * Math.min(1.25, speed / 5.0 + 0.35);
      else st.phase += dt * 1.15;

      // crouch is a partial crouch only: the server capsule never shrinks, so a
      // big visual drop would put the rendered head inside the torso hitbox.
      st.crouch += ((s.crouch ? 1 : 0) - st.crouch) * Math.min(1, dt * 12);

      const swing = run ? (s.sprint ? 0.78 : 0.5) : 0.06;
      const ph = st.phase;
      const breathe = Math.sin(st.t * 1.9) * 0.012;

      legs.L.hip.rotation.x = Math.sin(ph) * swing;
      legs.R.hip.rotation.x = -Math.sin(ph) * swing;
      legs.L.knee.rotation.x = Math.max(0, -Math.sin(ph - 0.6)) * swing * 1.9 + st.crouch * 0.7;
      legs.R.knee.rotation.x = Math.max(0, Math.sin(ph - 0.6)) * swing * 1.9 + st.crouch * 0.7;
      legs.L.hip.rotation.z = 0.045;
      legs.R.hip.rotation.z = -0.045;
      // ankle roll: heel-first as the leg swings forward, toe-off as it trails
      legs.L.foot.rotation.x = Math.sin(ph) * swing * 0.55;
      legs.R.foot.rotation.x = -Math.sin(ph) * swing * 0.55;

      bob.position.y = -st.crouch * 0.20
        + Math.abs(Math.sin(ph)) * (run ? (s.sprint ? 0.045 : 0.028) : 0)
        + breathe * 0.25;
      bob.rotation.z = Math.sin(ph) * swing * 0.035;
      bob.rotation.y = -Math.sin(ph) * swing * 0.10;

      torsoG.rotation.x = st.crouch * 0.28 + (run ? 0.10 : 0.02) + Math.sin(st.t * 1.9) * 0.008;
      torsoG.rotation.z = Math.sin(ph) * swing * 0.05;

      // weapon-ready arms: right hand on the grip, left under the handguard
      const sway = Math.sin(ph) * swing * 0.12;
      arms.R.sh.rotation.set(-1.02 + sway * 0.5, 0.34, -0.30 - st.crouch * 0.08);
      arms.R.el.rotation.set(-1.30 - sway * 0.6, 0, 0.18);
      arms.L.sh.rotation.set(-1.16 - sway * 0.5, -0.46, 0.42 + st.crouch * 0.10);
      arms.L.el.rotation.set(-1.20 + sway * 0.6, 0, -0.26);

      const pitch = Math.max(-70, Math.min(70, s.pitch || 0));
      headG.rotation.x = -(pitch * Math.PI) / 180 * 0.55;
      headG.rotation.y = Math.sin(st.t * 0.6) * 0.05;

      const capeG = torsoG.userData.cape;
      if (capeG) capeG.rotation.x = -0.05 - Math.min(0.55, speed * 0.055) + Math.sin(st.t * 2.6) * 0.04;

      marker.position.y = HEAD_Y + 0.40;
    },
  };

  girl.setWeapon(data.weaponsByClass[cls.id][0]);
  return girl;
}

/** Wraps yaw (degrees, server convention 0=+X) into a three.js heading. */
export function yawToRotation(yawDeg) {
  return Math.PI / 2 - (yawDeg * Math.PI) / 180;
}
