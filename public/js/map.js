// Builds the trench scene from shared/map.json and reproduces the server's
// collision rules exactly, so client-authoritative movement cannot disagree
// with the authoritative hit registration.
//
// Every obstacle is an axis-aligned box given by CENTRE + full SIZE, which is
// the same representation the Python side reads out of the same file.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { part, toonMat, flatMat, concreteTexture, sandbagTexture, mudTexture, plankTexture, wireTexture, shift } from './toon.js';
import { sceneStyle, applyEnvironment, fixImportedMaterials } from './lighting.js';

const PLAYER_RADIUS = 0.35;
const STEP_UP_MAX = 0.65;
// Collision acceleration, matching server/combat.py: a generated map has
// thousands of boxes and blocked()/floorAt() run every frame, so a bucket grid
// keeps each query to the handful of boxes actually near the player.
const GRID_CELL = 2.0;
// Returned when a query lands on an empty cell, so the common case allocates nothing.
const EMPTY = [];

/** Surface height of a (possibly sloped) box at (x, z). Mirrors combat.ramp_height. */
function rampHeight(b, x, z) {
  if (b.t !== 'ramp') return b.y + b.h * 0.5;
  const x0 = b.x - b.w * 0.5;
  const z0 = b.z - b.d * 0.5;
  let k;
  if (b.ax === 'z') k = b.d < 1e-9 ? 0 : (z - z0) / b.d;
  else k = b.w < 1e-9 ? 0 : (x - x0) / b.w;
  k = k < 0 ? 0 : (k > 1 ? 1 : k);
  return b.y0 + (b.y1 - b.y0) * k;
}

export class World {
  constructor(scene, map, combat, renderer = null) {
    this.scene = scene;
    this.map = map;
    this.combat = combat;
    this.renderer = renderer;
    this.style = sceneStyle(map.style);
    this.solid = map.boxes.filter((b) => b.t !== 'ground');
    this.grid = this._buildGrid();
    this.ground = map.boxes.find((b) => b.t === 'ground');
    this.bounds = map.bounds;
    this.groundY = map.groundY;
    this.stepUpMax = STEP_UP_MAX;      // exposed so controls.js shares the one limit
    // Top of the backstop slab: the lowest surface in the map, i.e. the height
    // floorAt() falls back to when nothing else reaches (x, z).
    this.floorBase = this.ground ? this.ground.y + this.ground.h * 0.5 : this.groundY;
    // Everything this map puts in the world hangs off one group, so swapping
    // maps is a single remove plus a single dispose walk.
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  /** Collision is usable immediately; rendering is awaited separately. */
  static async create(scene, map, combat, renderer = null) {
    const w = new World(scene, map, combat, renderer);
    await w.init();
    return w;
  }

  async init() {
    this._lights();
    if (this.map.scene) await this._model();
    else this._boxes();
  }

  // ------------------------------------------------------------- collision

  /** File each box into every grid cell its XZ footprint touches. */
  _buildGrid() {
    const g = new Map();
    const c = GRID_CELL;
    for (const b of this.solid) {
      const ix0 = Math.floor((b.x - b.w * 0.5) / c);
      const ix1 = Math.floor((b.x + b.w * 0.5) / c);
      const iz0 = Math.floor((b.z - b.d * 0.5) / c);
      const iz1 = Math.floor((b.z + b.d * 0.5) / c);
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = ix + ',' + iz;
          const cell = g.get(k);
          if (cell) cell.push(b);
          else g.set(k, [b]);
        }
      }
    }
    return g;
  }

  /** Boxes in the grid cells overlapping [x-r, x+r] x [z-r, z+r]. */
  _near(x, z, r) {
    const c = GRID_CELL;
    const ix0 = Math.floor((x - r) / c), ix1 = Math.floor((x + r) / c);
    const iz0 = Math.floor((z - r) / c), iz1 = Math.floor((z + r) / c);
    const one = this.grid.get(ix0 + ',' + iz0);
    if (ix0 === ix1 && iz0 === iz1) return one || EMPTY;
    const out = [];
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const cell = this.grid.get(ix + ',' + iz);
        if (cell) for (const b of cell) out.push(b);
      }
    }
    return out;
  }

  blocked(x, z, y, height) {
    // height: the body's collision height (crouched bodies are shorter); the
    // standing capsule is the default, matching combat.blocked's ``height=None``.
    const h = height == null ? this.combat.playerHeight : height;
    for (const b of this._near(x, z, PLAYER_RADIUS)) {
      if (Math.abs(x - b.x) > b.w * 0.5 + PLAYER_RADIUS) continue;
      if (Math.abs(z - b.z) > b.d * 0.5 + PLAYER_RADIUS) continue;
      if (b.t === 'ramp') {
        // Walkable on the slope (within a step), and passable under a higher
        // flight only where a real floor carries the body. The generator drops
        // the floor under every ramp footprint, so stepping in below the slope
        // leaves nothing to stand on and the body falls to the backstop slab --
        // the "between the ground and the texture" wedge bots got stuck in.
        // Allow it only when floorAt() confirms support.
        const surface = rampHeight(b, x, z);
        if (surface - y > STEP_UP_MAX && this.floorAt(x, z, y) <= this.floorBase + 1e-6) {
          return true;
        }
        continue;
      }
      const top = b.y + b.h * 0.5;
      const bot = b.y - b.h * 0.5;
      if (top - y > STEP_UP_MAX && bot < y + h) return true;
    }
    return false;
  }

  /** Full move first, then slide along each axis separately, else stay put. */
  resolveMove(ox, oz, nx, nz, y, height) {
    if (!this.blocked(nx, nz, y, height)) return [nx, nz];
    if (!this.blocked(nx, oz, y, height)) return [nx, oz];
    if (!this.blocked(ox, nz, y, height)) return [ox, nz];
    return [ox, oz];
  }

  /**
   * Height of the surface a player with feet at feetY stands on. Mirrors the
   * server's combat.floor_at exactly: any box that reaches (x, z) and whose top
   * is not more than one step above the feet counts, highest wins. A ramp is
   * read at the player's own (x, z) so the bottom of a flight is reachable, and
   * a slab floating above the head (an archway lintel) is rejected.
   */
  floorAt(x, z, feetY) {
    const limit = feetY + STEP_UP_MAX;
    let best = this.floorBase;
    for (const b of this._near(x, z, PLAYER_RADIUS)) {
      if (Math.abs(x - b.x) > b.w * 0.5 + PLAYER_RADIUS) continue;
      if (Math.abs(z - b.z) > b.d * 0.5 + PLAYER_RADIUS) continue;
      if (b.t === 'ramp') {
        const top = rampHeight(b, x, z);
        if (top <= limit && top > best) best = top;
        continue;
      }
      const bot = b.y - b.h * 0.5;
      const top = b.y + b.h * 0.5;
      if (top <= limit && bot <= limit && top > best) best = top;
    }
    return best;
  }

  clampToBounds(x, z) {
    const b = this.bounds;
    return [
      Math.min(Math.max(x, b.minX + 1.5), b.maxX - 1.5),
      Math.min(Math.max(z, b.minZ + 1.5), b.maxZ - 1.5),
    ];
  }

  // ------------------------------------------------------------- rendering

  _lights() {
    const s = this.style;

    // Imported glTF is PBR: without an environment map every metallic surface
    // reflects nothing and renders black, no matter how many lights there are.
    applyEnvironment(this.renderer, this.scene, s);

    this.scene.fog = new THREE.Fog(new THREE.Color(s.fog), s.fogNear, s.fogFar);
    // three.js only draws a Color / Texture / CubeTexture set as scene.background;
    // a Mesh put there is silently ignored, so the gradient dome never appeared
    // and the sky showed the renderer's black clear colour. Hang the dome in the
    // scene instead -- drawn first and depth-write free so it sits behind
    // everything -- and keep a flat colour behind it as a fallback.
    this.scene.background = new THREE.Color(s.skyBottom);
    const sky = this._sky(s);
    sky.renderOrder = -1;
    this.group.add(sky);
    // Kept so a smoke screen can fade the sky out too: it is the one surface
    // built with fog disabled, so distance fog alone would never hide it.
    this.sky = sky;

    const sun = new THREE.DirectionalLight(new THREE.Color(s.sunColor), 2.15);
    sun.position.set(-38, 46, 26);
    this.group.add(sun);

    const rim = new THREE.DirectionalLight(new THREE.Color('#8fb6ff'), 0.85);
    rim.position.set(40, 18, -34);
    this.group.add(rim);

    this.group.add(new THREE.AmbientLight(new THREE.Color(s.ambientColor), 1.15));
    this.group.add(new THREE.HemisphereLight(new THREE.Color(s.skyTop), new THREE.Color(s.mud), 0.7));
  }

  /** A model map: the GLB is the visuals, the boxes above are the collision. */
  async _model() {
    const s = this.map.scene;
    const gltf = await new GLTFLoader().loadAsync(s.model);
    const root = gltf.scene;
    root.rotation.x = THREE.MathUtils.degToRad(s.rotX || 0);
    root.scale.setScalar(s.scale ?? 1);
    const o = s.offset || [0, 0, 0];
    root.position.set(o[0], o[1], o[2]);
    fixImportedMaterials(root);
    this.group.add(root);
  }

  _boxes() {
    const s = this.style;
    const mats = {
      ground: toonMat(s.mud, { map: mudTexture(s.mud) }),
      wall: toonMat('#7f7566', { map: concreteTexture() }),
      sandbag: toonMat('#9b8a63', { map: sandbagTexture() }),
      concrete: toonMat('#8b8b83', { map: concreteTexture() }),
      debris: toonMat('#7a6a52', { map: mudTexture('#7a6a52') }),
      plank: toonMat('#8a6a44', { map: plankTexture() }),
    };

    for (const b of this.map.boxes) {
      if (b.t === 'ground') {
        const g = new THREE.BoxGeometry(b.w, b.h, b.d);
        const m = new THREE.Mesh(g, mats.ground);
        m.position.set(b.x, b.y, b.z);
        m.receiveShadow = false;
        this.group.add(m);
        continue;
      }
      if (b.t === 'tree') { this._tree(b); continue; }
      if (b.t === 'wire') { this._wire(b); continue; }
      // floor / ramp are invisible collision helpers: they only ever accompany a
      // model map, whose visuals come from the GLB.
      if (b.t === 'floor' || b.t === 'ramp') continue;

      const outlined = b.t === 'sandbag' || b.t === 'concrete' || b.t === 'wall';
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      part(this.group, geo, {
        material: mats[b.t],
        pos: [b.x, b.y, b.z],
        outline: outlined,
        outlineColor: 0x241c22,
        outlineScale: 1.02,
      });
    }

    this._decor();
  }

  /** Tear the map down so a swap does not leak geometry or textures. */
  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
          'emissiveMap', 'aoMap', 'alphaMap', 'specularMap']) {
          if (m[k]) m[k].dispose();
        }
        m.dispose();
      }
    });
    this.group.removeFromParent();
    this.solid = [];
    this.grid.clear();
    this.ground = null;
  }

  _tree(b) {
    const h = b.h;
    const mat = toonMat('#4f4034');
    const trunk = new THREE.CylinderGeometry(b.w * 0.5, b.w * 0.72, h, 7, 1);
    part(this.group, trunk, {
      material: mat, pos: [b.x, b.y, b.z],
      outline: true, outlineColor: 0x241c22, outlineScale: 1.07,
    });

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + b.x * 0.7;
      const len = h * (0.3 + (i % 2) * 0.16);
      const g = new THREE.CylinderGeometry(0.035, 0.075, len, 5, 1);
      const br = new THREE.Mesh(g, mat);
      br.position.set(
        b.x + Math.cos(a) * len * 0.28,
        b.y + h * 0.22 + (i % 2) * h * 0.12,
        b.z + Math.sin(a) * len * 0.28,
      );
      br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      this.group.add(br);
    }
  }

  _wire(b) {
    const mat = new THREE.MeshBasicMaterial({
      map: wireTexture(), transparent: true, alphaTest: 0.35,
      side: THREE.DoubleSide, color: 0x7a7368,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    m.position.set(b.x, b.y, b.z);
    this.group.add(m);
    // A couple of leaning iron posts to sell it.
    const pm = toonMat('#3f3a32');
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, b.h * 1.35, 6), pm);
      p.position.set(b.x + side * b.w * 0.47, b.y, b.z);
      p.rotation.z = side * 0.14;
      this.group.add(p);
    }
  }

  _decor() {
    for (const d of this.map.decor) {
      if (d.type === 'crater') {
        const g = new THREE.CircleGeometry(d.r, 18);
        const m = new THREE.Mesh(g, toonMat(shift(this.style.mud, -0.35)));
        m.rotation.x = -Math.PI / 2;
        m.position.set(d.x, this.groundY + 0.02, d.z);
        this.group.add(m);
        const rim = new THREE.Mesh(new THREE.RingGeometry(d.r * 0.92, d.r * 1.12, 18), toonMat(shift(this.style.mud, 0.16)));
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(d.x, this.groundY + 0.03, d.z);
        this.group.add(rim);
      } else if (d.type === 'puddle') {
        const m = new THREE.Mesh(
          new THREE.CircleGeometry(d.r, 16),
          flatMat('#4b5a63', { transparent: true, opacity: 0.72 }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(d.x, this.groundY + 0.035, d.z);
        this.group.add(m);
      } else if (d.type === 'plank') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.12, d.d),
          toonMat('#8a6a44', { map: plankTexture() }));
        this.group.add(m);
        m.position.set(d.x, this.groundY + 0.07, d.z);
      }
    }
  }

  _sky(s) {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 128;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, s.skyTop);
    grd.addColorStop(0.55, s.fog);
    grd.addColorStop(1, s.skyBottom);
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    return dome;
  }
}

/** Fake contact shadow: a dark disc, because real shadow maps are not worth it here. */
export function contactShadow(radius = 0.42) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,.26)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}
