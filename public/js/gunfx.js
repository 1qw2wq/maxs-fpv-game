// Per-weapon firing effects: muzzle flash, muzzle smoke, ejected brass, the
// camera punch and the shot-to-shot cadence of remote players.
//
// Every one of the twelve guns has its own `fx` block in shared/weapons.json, so
// the numbers live with the rest of the weapon data instead of being sprinkled
// through the render code. This module is deliberately defensive: `gunStyle()`
// clamps every value and fills in a default, exactly like lighting.js does for
// map styles, because a hand-edited number must never be able to break a match.
//
// Everything is pooled. A flash is a mesh plus (for the player's own shots) a
// pooled point light; nothing is allocated per shot, and the light never leaves
// the scene -- a light that appears and disappears would force three.js to
// recompile every material in the world on the first shot.

import * as THREE from 'three';
import { flatMat } from './toon.js';

const DEG = Math.PI / 180;

/** Documented defaults: what a weapon without an `fx` block gets. */
const BASE = {
  flash: { size: 0.9, color: '#ffe4a8', light: 4.0, ms: 50 },
  kick: { vm: 0.85, punch: 0.7, roll: 0.3 },
  tracer: { color: '#ffe6a0', width: 1.0, ms: 70, every: 1 },
  smoke: { size: 0.8, count: 1, ms: 280 },
  casing: { size: 1.0 },
  sound: { gain: 1.0, rate: 1.0, lpf: 0, tone: 1.0 },
};
const FLASH_LEN = 0.30;      // metres of flame at flash.size = 1

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

/** A css colour that three.js can actually parse, else the fallback. */
function colour(v, dflt) {
  if (typeof v !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(v.trim())) return dflt;
  try {
    return `#${new THREE.Color(v).getHexString()}`;
  } catch {
    return dflt;
  }
}

const cache = new Map();

/**
 * Validated, clamped effects for one weapon. Cached: the same object comes back
 * for every shot, so callers must treat it as read-only.
 */
export function gunStyle(weapon) {
  const id = weapon?.id || weapon?.shape || 'default';
  const hit = cache.get(id);
  if (hit) return hit;
  const raw = (weapon && weapon.fx) || {};
  const f = raw.flash || {};
  const k = raw.kick || {};
  const t = raw.tracer || {};
  const s = raw.smoke || {};
  const c = raw.casing || {};
  const a = raw.sound || {};
  const out = {
    id,
    flash: {
      size: num(f.size, 0.1, 4, BASE.flash.size),
      color: colour(f.color, BASE.flash.color),
      light: num(f.light, 0, 40, BASE.flash.light),
      ms: num(f.ms, 8, 400, BASE.flash.ms),
    },
    kick: {
      vm: num(k.vm, 0, 3, BASE.kick.vm),
      punch: num(k.punch, 0, 8, BASE.kick.punch),
      roll: num(k.roll, 0, 4, BASE.kick.roll),
    },
    tracer: {
      color: colour(t.color, BASE.tracer.color),
      width: num(t.width, 0.1, 5, BASE.tracer.width),
      ms: num(t.ms, 20, 400, BASE.tracer.ms),
      every: Math.round(num(t.every, 1, 12, BASE.tracer.every)),
    },
    smoke: {
      size: num(s.size, 0.1, 4, BASE.smoke.size),
      count: Math.round(num(s.count, 0, 6, BASE.smoke.count)),
      ms: num(s.ms, 40, 2000, BASE.smoke.ms),
    },
    casing: { size: num(c.size, 0.2, 3, BASE.casing.size) },
    sound: {
      gain: num(a.gain, 0, 4, BASE.sound.gain),
      rate: num(a.rate, 0.5, 2, BASE.sound.rate),
      lpf: num(a.lpf, 0, 20000, BASE.sound.lpf),
      tone: num(a.tone, 0.5, 2, BASE.sound.tone),
    },
  };
  cache.set(id, out);
  return out;
}

/** A shot's tracer only shows every `every` rounds; rounds are counted per gun. */
export function tracerRound(style, count) {
  return count % style.tracer.every === 0;
}

// ---------------------------------------------------------------- geometry

const flashCone = (() => {
  const g = new THREE.ConeGeometry(0.055, FLASH_LEN, 6, 1, true);
  g.rotateX(Math.PI / 2);        // cone axis onto +Z, the barrel direction
  g.translate(0, 0, FLASH_LEN * 0.5);
  return g;
})();
const flashCore = (() => {
  const g = new THREE.SphereGeometry(0.036, 6, 4);
  g.translate(0, 0, 0.02);
  return g;
})();
const smokeGeo = new THREE.SphereGeometry(0.06, 6, 5);
const casingGeo = new THREE.BoxGeometry(0.013, 0.013, 0.032);

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();

export class GunFx {
  /**
   * @param {{group: THREE.Object3D, scene: THREE.Scene}} deps `group` is the
   *   effects parent (main.js's fxGroup) -- nothing here is ever attached to the
   *   camera, so a flash cannot ride along with the view.
   */
  constructor({ group, scene } = {}) {
    this.group = group;
    this.scene = scene;
    this.flashes = [];         // { meshes:[cone,core], light, t, ms, size }
    this.smokes = [];          // { mesh, t, ms, size, vy, vx, vz }
    this.casings = [];         // { mesh, vel, spin, t, ms }
    this.punchPitch = 0;       // degrees, applied to the camera only
    this.punchYaw = 0;
    this.punchRoll = 0;
    // Lifetime counters: the pooled pieces are invisible between shots, so this
    // is what "did that gun actually fire" means from the outside (and what the
    // headless test asserts on).
    this.stats = { flashes: 0, smoke: 0, brass: 0, peakLight: 0, peakPunch: 0 };
    this._smokeMat = flatMat(0x9d9a92, { transparent: true, opacity: 0.3, depthWrite: false });
    this._casingMat = flatMat(0xc9a24a);
    this._lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffe0a8, 0, 9, 2);
      l.visible = true;          // stays in the shader: no recompiles
      l.position.set(0, -40, 0); // parked under the map while idle
      group.add(l);
      this._lights.push(l);
    }
  }

  /** Aim a pooled group down `dir` with the barrel's own length scale. */
  _orient(obj, dir, size) {
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v.copy(dir).normalize());
    obj.quaternion.copy(_q);
    obj.scale.setScalar(size);
  }

  /**
   * One shot, seen from the shooter's own viewpoint: flame, smoke, brass and the
   * camera punch. `from` is the world muzzle, `dir` the aim direction.
   */
  fire(weapon, from, dir, { brass = true } = {}) {
    const style = gunStyle(weapon);
    this._flash(style, from, dir, true);
    this._smoke(style, from, dir);
    if (brass) this._casings(style, from, dir);
    this.punch(style);
  }

  /** Someone else's shot: same flame, no brass, no punch, smaller light. */
  remote(weapon, from, dir) {
    const style = gunStyle(weapon);
    this._flash(style, from, dir, false);
    this._smoke(style, from, dir);
    return style;
  }

  punch(style) {
    this.stats.peakPunch = Math.max(this.stats.peakPunch, style.kick.punch);
    this.punchPitch += style.kick.punch;
    this.punchYaw += (Math.random() * 2 - 1) * style.kick.roll;
    this.punchRoll += (Math.random() * 2 - 1) * style.kick.roll * 0.6;
  }

  _flash(style, from, dir, withLight) {
    let rec = this.flashes.find((f) => !f.live);
    if (!rec) {
      // The pool is bounded: the oldest live flash is recycled rather than
      // growing it, which at 900 rpm is what keeps a burst from allocating.
      if (this.flashes.length >= 8) {
        rec = this.flashes.shift();
        this.flashes.push(rec);
      } else {
        // One material per pooled flash (its two meshes share it), so two shots
        // of the same gun can never fight over each other's opacity.
        const mat = flatMat(0xffffff, { transparent: true, opacity: 1, depthWrite: false,
          blending: THREE.AdditiveBlending });
        const meshes = [new THREE.Mesh(flashCone, mat), new THREE.Mesh(flashCore, mat)];
        for (const m of meshes) {
          m.frustumCulled = false;
          m.renderOrder = 8;
          this.group.add(m);
        }
        rec = { meshes, mat, light: null, t: 0, ms: 50, size: 1, dirVec: new THREE.Vector3() };
        this.flashes.push(rec);
      }
    }
    rec.live = true;
    rec.t = 0;
    this.stats.flashes++;
    rec.ms = style.flash.ms;
    rec.size = style.flash.size;
    rec.dirVec.copy(dir).normalize();
    rec.mat.color.set(style.flash.color);
    for (const m of rec.meshes) {
      m.visible = true;
      m.position.copy(from);
      this._orient(m, rec.dirVec, rec.size);
    }
    if (withLight && style.flash.light > 0) {
      // Take the least recently used pooled light: two shots inside one flash
      // get two lights, a burst keeps re-aiming the two it has.
      rec.light = rec.light || this._lights[(this._lightTurn = ((this._lightTurn || 0) + 1) % this._lights.length)];
      rec.light.position.copy(from).addScaledVector(rec.dirVec, 0.12);
      rec.light.color.set(style.flash.color);
      rec.light.intensity = style.flash.light;
      rec.light.distance = 6 + 4 * style.flash.size;
      // Time-based decay, not per-frame: the flash must last the same number of
      // milliseconds at 30 and at 144 fps, and must reach exactly zero so two
      // shots in a row cannot leave a permanent glow on the map.
      rec.lightBase = style.flash.light;
      rec.lightMs = style.flash.ms * 1.8;
      this.stats.peakLight = Math.max(this.stats.peakLight, style.flash.light);
    }
  }

  _smoke(style, from, dir) {
    for (let i = 0; i < style.smoke.count; i++) {
      let rec = this.smokes.find((s) => !s.live);
      if (!rec) {
        if (this.smokes.length >= 18) {
          rec = this.smokes.shift();
          this.smokes.push(rec);
        } else {
          const mesh = new THREE.Mesh(smokeGeo, this._smokeMat);
          mesh.frustumCulled = false;
          mesh.renderOrder = 7;
          this.group.add(mesh);
          rec = { mesh, t: 0, ms: 300, size: 1, vel: new THREE.Vector3() };
          this.smokes.push(rec);
        }
      }
      rec.live = true;
      this.stats.smoke++;
      rec.t = -i * 45;                     // puffs stack up behind each other
      rec.ms = style.smoke.ms;
      rec.size = style.smoke.size;
      rec.mesh.visible = true;
      rec.mesh.position.copy(from).addScaledVector(dir, 0.06 + i * 0.05);
      rec.vel.set(dir.x, dir.y + 0.5, dir.z).normalize()
        .multiplyScalar(0.5 + Math.random() * 0.4)
        .add(_right.copy(dir).cross(UP).multiplyScalar((Math.random() - 0.5) * 0.5));
      rec.mesh.scale.setScalar(style.smoke.size * 0.5);
    }
  }

  _casings(style, from, dir) {
    let rec = this.casings.find((c) => !c.live);
    if (!rec) {
      if (this.casings.length >= 16) {
        rec = this.casings.shift();
        this.casings.push(rec);
      } else {
        const mesh = new THREE.Mesh(casingGeo, this._casingMat);
        mesh.frustumCulled = false;
        this.group.add(mesh);
        rec = { mesh, t: 0, ms: 900, vel: new THREE.Vector3(), spin: new THREE.Vector3() };
        this.casings.push(rec);
      }
    }
    // Brass leaves to the shooter's right and a little up, then falls: the
    // right-hand vector of the aim ray is dir x up.
    _right.copy(dir).cross(UP);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    rec.live = true;
    rec.t = 0;
    this.stats.brass++;
    rec.ms = 900;
    rec.mesh.visible = true;
    rec.mesh.scale.setScalar(style.casing.size);
    rec.mesh.position.copy(from).addScaledVector(_right, 0.05).addScaledVector(dir, -0.02);
    rec.vel.copy(_right).multiplyScalar(1.7 + Math.random() * 0.9)
      .addScaledVector(UP, 1.5 + Math.random() * 0.8)
      .addScaledVector(dir, -0.5 - Math.random() * 0.4);
    rec.spin.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
  }

  /**
   * Advance every effect, then decay the camera punch. `dt` in seconds.
   * Punch is what makes a Springfield feel different from an MP18 even when both
   * are fired at the same thing, so the recovery is deliberately springy.
   */
  update(dt) {
    const ms = dt * 1000;
    for (const f of this.flashes) {
      if (!f.live) continue;
      f.t += ms;
      const k = f.t / f.ms;
      if (k >= 1) {
        f.live = false;
        for (const m of f.meshes) m.visible = false;
        if (f.light) f.light.intensity = 0;
        continue;
      }
      // A flash is over almost before it is seen: full brightness for the first
      // third, then a fast collapse.
      const kk = k < 0.34 ? k / 0.34 : 1 - (k - 0.34) / 0.66;
      f.mat.opacity = Math.max(0, kk);
      for (const m of f.meshes) m.scale.setScalar(f.size * (1 + k * 0.5));
      if (f.light && f.lightBase) {
        const lk = 1 - Math.min(1, f.t / f.lightMs);
        f.light.intensity = f.lightBase * lk * lk;
      }
    }
    for (const s of this.smokes) {
      if (!s.live) continue;
      s.t += ms;
      const k = Math.max(0, s.t / s.ms);
      if (k >= 1) { s.live = false; s.mesh.visible = false; continue; }
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(1 - Math.min(0.9, dt * 1.6));
      s.vel.y -= 0.35 * dt;
      const grow = s.size * (0.45 + k * 1.5);
      s.mesh.scale.setScalar(grow);
    }
    for (const c of this.casings) {
      if (!c.live) continue;
      c.t += ms;
      if (c.t >= c.ms) { c.live = false; c.mesh.visible = false; continue; }
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      const k = c.t / c.ms;
      c.mesh.scale.setScalar(1 - k * 0.35);
    }
    const damp = Math.min(1, dt * 9.5);
    this.punchPitch -= this.punchPitch * damp;
    this.punchYaw -= this.punchYaw * damp;
    this.punchRoll -= this.punchRoll * damp;
    if (Math.abs(this.punchPitch) < 0.001) this.punchPitch = 0;
    if (Math.abs(this.punchYaw) < 0.001) this.punchYaw = 0;
    if (Math.abs(this.punchRoll) < 0.001) this.punchRoll = 0;
  }

  /** Reset the pooled pieces (map swap, leaving a match). */
  clear() {
    for (const f of this.flashes) { f.live = false; for (const m of f.meshes) m.visible = false; if (f.light) f.light.intensity = 0; }
    for (const s of this.smokes) { s.live = false; s.mesh.visible = false; }
    for (const c of this.casings) { c.live = false; c.mesh.visible = false; }
    this.punchPitch = this.punchYaw = this.punchRoll = 0;
  }

  dispose() {
    for (const f of this.flashes) for (const m of f.meshes) m.removeFromParent();
    for (const s of this.smokes) s.mesh.removeFromParent();
    for (const c of this.casings) c.mesh.removeFromParent();
    for (const l of this._lights) l.removeFromParent();
    for (const f of this.flashes) f.mat.dispose();
    this.flashes.length = 0;
    this.smokes.length = 0;
    this.casings.length = 0;
  }
}

export const GUN_FX_DEFAULTS = BASE;
export { DEG };
