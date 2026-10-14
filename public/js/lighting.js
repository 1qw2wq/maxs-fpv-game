// Lighting, environment and imported-material hygiene.
//
// Three things live here, all of them about "why does it look wrong":
//
// 1. sceneStyle() -- map JSON style blocks are data, and data gets edited. One
//    missing key used to mean `new THREE.Color(undefined)`, which three.js
//    turns into a black surface and (with NaN) can blank a whole material. Every
//    style value is now validated and falls back to the map's own defaults.
//
// 2. applyEnvironment() -- the imported gun models are glTF PBR (metallic
//    factor 1.0 + metallicRoughness texture). A metal surface is *only* lit by
//    what it reflects, so with no environment map every gun renders near-black
//    however many lights are in the scene -- the classic "my imported model is
//    dark" bug. A small procedural sky/ground equirect is baked through
//    PMREMGenerator (cheap: one 64x32 canvas, generated once per map style) and
//    set as scene.environment, which is what gives those metals something to
//    reflect. Unlit (KHR_materials_unlit) assets -- the character rips and the
//    Italy map -- ignore it entirely, as they should.
//
// 3. fixImportedMaterials() -- per-model safety pass: cap untextured metalness,
//    warm up texture filtering and keep fog on. Runs on every imported GLB the
//    game loads (guns, map scene, uploaded rigs).

import * as THREE from 'three';

/** Used when a map file has no style block at all (or a broken one). */
export const STYLE_FALLBACK = {
  skyTop: '#5b7fa8',
  skyBottom: '#e0b98a',
  fog: '#c9a882',
  fogNear: 35,
  fogFar: 145,
  sunColor: '#ffd9a0',
  ambientColor: '#6b7fa8',
  mud: '#6b5a44',
};

const COLOR_KEYS = ['skyTop', 'skyBottom', 'fog', 'sunColor', 'ambientColor', 'mud'];
const NUMBER_KEYS = ['fogNear', 'fogFar'];

/** A style block that is safe to feed straight into THREE.Color / Fog. */
export function sceneStyle(raw) {
  const out = { ...STYLE_FALLBACK };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of COLOR_KEYS) {
    const v = raw[key];
    if (typeof v === 'string' && /^#?[0-9a-f]{3,8}$/i.test(v.trim())) out[key] = v.trim();
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = '#' + v.toString(16).padStart(6, '0');
  }
  for (const key of NUMBER_KEYS) {
    const v = Number(raw[key]);
    if (Number.isFinite(v) && v > 0) out[key] = v;
  }
  // Fog must not be inverted or zero-length: a far plane at or below the near
  // one swallows the entire scene in fog colour.
  if (out.fogFar <= out.fogNear) out.fogFar = out.fogNear + 40;
  return out;
}

// ------------------------------------------------------------------ environment

const ENV_CACHE = new Map();     // signature -> { target, mesh }
const ENV_MAX = 3;

function skyEquirect(style) {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 32;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 32);
  grd.addColorStop(0, style.skyTop);        // zenith
  grd.addColorStop(0.45, style.fog);        // horizon haze
  grd.addColorStop(0.52, style.fog);
  grd.addColorStop(1, style.mud);           // ground bounce
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 32);
  // A bright soft patch for the sun so metal picks up one strong highlight.
  const sun = g.createRadialGradient(20, 7, 1, 20, 7, 9);
  sun.addColorStop(0, 'rgba(255,255,255,.95)');
  sun.addColorStop(0.5, 'rgba(255,240,210,.35)');
  sun.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = sun;
  g.fillRect(8, 0, 26, 20);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Bake (once per distinct style) and install the scene environment. Returns the
 * texture in use, or null when there is no renderer (headless/test).
 */
export function applyEnvironment(renderer, scene, style) {
  if (!renderer || typeof renderer.getRenderTarget !== 'function') return null;
  const key = [style.skyTop, style.fog, style.mud, style.sunColor].join('|');
  let entry = ENV_CACHE.get(key);
  if (!entry) {
    const src = skyEquirect(style);
    const pmrem = new THREE.PMREMGenerator(renderer);
    let target;
    try {
      target = pmrem.fromEquirectangular(src);
    } catch {
      // A driver that cannot render to a float/half-float target (old iGPUs)
      // must not take the whole map down with it: the game just keeps the
      // direct lighting it had before.
      pmrem.dispose();
      src.dispose();
      return null;
    }
    pmrem.dispose();
    src.dispose();
    entry = { target, scene };
    ENV_CACHE.set(key, entry);
    // Drop the oldest entries (and their GPU memory) beyond the cap.
    while (ENV_CACHE.size > ENV_MAX) {
      const [oldKey, old] = ENV_CACHE.entries().next().value;
      if (oldKey === key) break;
      ENV_CACHE.delete(oldKey);
      old.target.dispose();
    }
  }
  scene.environment = entry.target.texture;
  // Mirror-like metal would be wrong for 1916 equipment; a mild reflection is
  // what makes the blued steel read as metal instead of as a black hole.
  scene.environmentIntensity = 0.9;
  return entry.target.texture;
}

/** Release every cached environment (page teardown / tests). */
export function disposeEnvironments() {
  for (const entry of ENV_CACHE.values()) entry.target.dispose();
  ENV_CACHE.clear();
}

// -------------------------------------------------- imported material hygiene

/**
 * Make an imported glTF render the way the file intends.
 * `opts.metalCap` caps *untextured* metalness: a material with metallicFactor 1
 * and no metallicRoughness texture is either a mistake in the asset or a metal
 * with nothing to reflect, and both end up as a black blob on screen.
 */
export function fixImportedMaterials(root, opts = {}) {
  const metalCap = opts.metalCap ?? 0.6;
  const envIntensity = opts.envMapIntensity ?? 1.0;
  let fixed = 0;
  root.traverse?.((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m.isMeshStandardMaterial) {
        if (m.metalness >= 0.9 && !m.metalnessMap) { m.metalness = metalCap; fixed += 1; }
        if (Number.isFinite(envIntensity)) m.envMapIntensity = envIntensity;
      }
      // GLTFLoader leaves fog at the default (on), which is what keeps a model
      // map's meshes matching their surroundings; only nudge it if a file
      // explicitly turned it off, which no reasonable asset does.
      if (m.fog === false && opts.forceFog !== false) m.fog = true;
      for (const key of ['map', 'normalMap', 'emissiveMap', 'metalnessMap', 'roughnessMap']) {
        const tex = m[key];
        if (tex && tex.isTexture && !tex.anisotropy) tex.anisotropy = 4;
      }
      m.needsUpdate = true;
    }
  });
  return fixed;
}
