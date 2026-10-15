// Deterministic, bounded smoke cards: a low rolling skirt, dense core and
// buoyant crown. No external texture/download and no per-frame allocations.
import * as THREE from 'three';

let texture;
function random(seed) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}
function noise(x, y) {
  const hash = (a, b) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  let u = x - ix, v = y - iy;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
export function smokeTexture() {
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(192, 192);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
    const dx = (x - 95.5) / 95.5, dy = (y - 95.5) / 95.5;
    const n = noise(x / 27, y / 27) * 0.55 + noise(x / 11, y / 11) * 0.3 + noise(x / 5, y / 5) * 0.15;
    const edge = Math.max(0, 1 - Math.hypot(dx, dy));
    const i = (y * 192 + x) * 4;
    const shade = 180 + n * 65;
    image.data[i] = shade; image.data[i + 1] = shade + 2; image.data[i + 2] = shade + 5;
    image.data[i + 3] = Math.min(1, edge * 3) * (0.32 + n * 0.68) * 235;
  }
  ctx.putImageData(image, 0, 0);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const smooth = (v) => { const x = THREE.MathUtils.clamp(v, 0, 1); return x * x * (3 - 2 * x); };
export function smokeDensity(elapsedMs, durationMs) {
  const fadeMs = Math.min(2800, durationMs * 0.22);
  return smooth(elapsedMs / 650) * smooth((durationMs - elapsedMs) / fadeMs);
}
export function buildSmokeCloud(fx) {
  const obj = new THREE.Group();
  obj.position.fromArray(fx.p);
  const radius = Math.max(0.5, Number(fx.r) || 5.5);
  const rng = random((Number(fx.eid) || 1) * 2654435761);
  const puffs = [];
  for (let i = 0; i < 36; i++) {
    const layer = i % 3;
    const angle = i * 2.399963 + rng() * 0.65;
    const radial = radius * Math.sqrt((Math.floor(i / 3) + 0.5) / 12) * (layer === 2 ? 0.48 : 0.72);
    const size = radius * (layer === 0 ? 0.62 : 0.74) * (0.85 + rng() * 0.35);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTexture(), color: layer === 0 ? 0xa4adb6 : 0xcbd1d5,
      transparent: true, depthWrite: false, opacity: 0, fog: false,
      rotation: rng() * Math.PI * 2,
    }));
    obj.add(sprite);
    puffs.push({ sprite, angle, radial, size, baseY: radius * (0.05 + layer * 0.15),
      phase: rng() * Math.PI * 2, spin: (rng() - 0.5) * 0.10, opacity: 0.58 + rng() * 0.17 });
  }
  updateSmokeCloud({ puffs, dur: fx.dur || 14000 }, 0);
  return { obj, puffs, r: radius };
}
export function updateSmokeCloud(effect, elapsedMs) {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const density = smokeDensity(elapsedMs, effect.dur);
  const spread = 0.18 + 0.82 * smooth(seconds / 1.2);
  for (const p of effect.puffs) {
    const angle = p.angle + seconds * p.spin;
    p.sprite.position.set(Math.cos(angle) * p.radial * spread,
      p.baseY * spread + Math.sin(seconds * 0.7 + p.phase) * 0.15 + Math.min(seconds * 0.07, 0.75),
      Math.sin(angle) * p.radial * spread);
    const scale = p.size * (0.45 + spread * 0.55) * (1 + Math.sin(seconds * 0.45 + p.phase) * 0.05);
    p.sprite.scale.set(scale, scale, 1);
    p.sprite.material.opacity = density * p.opacity;
    p.sprite.material.rotation = p.phase + seconds * p.spin * 0.5;
  }
  effect.density = density;
}
