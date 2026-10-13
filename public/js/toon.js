// Toon shading toolkit: the whole "anime" look is produced here.
//
//   1. MeshToonMaterial + a stepped gradientMap  -> cel-shaded bands instead of smooth falloff
//   2. Inverted-hull outline (BackSide shell scaled up) -> the ink line that sells 2D
//   3. Procedural canvas textures -> no external art assets, works fully offline
//
// MeshToonMaterial ignores metalness/roughness, so every surface here is a flat
// colour plus optional map/emissive. That is the point.

import * as THREE from 'three';

export const OUTLINE_COLOR = 0x1a1420;

let _gradient = null;

/** 4-step ramp. Without this MeshToonMaterial renders as a flat blob. */
export function toonGradient() {
  if (_gradient) return _gradient;
  const steps = new Uint8Array([
    78, 78, 78, 255,
    150, 150, 150, 255,
    214, 214, 214, 255,
    255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(steps, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _gradient = tex;
  return tex;
}

export function toonMat(color, o = {}) {
  const m = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: toonGradient(),
  });
  if (o.map) m.map = o.map;
  if (o.emissive) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 0.5;
  }
  if (o.transparent) {
    m.transparent = true;
    m.opacity = o.opacity ?? 1;
  }
  if (o.side) m.side = o.side;
  if (o.depthWrite === false) m.depthWrite = false;
  return m;
}

export function flatMat(color, o = {}) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity ?? 1; }
  if (o.side) m.side = o.side;
  if (o.blending) m.blending = o.blending;
  if (o.depthWrite === false) m.depthWrite = false;
  return m;
}

export function outlineMat(color = OUTLINE_COLOR) {
  return new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
}

/**
 * Add a mesh to `parent`, optionally wrapped in an ink outline.
 * Geometry must be centred on its own origin — the outline is a scaled copy, so
 * an off-centre geometry would produce a lopsided line.
 */
export function part(parent, geo, o = {}) {
  const mat = o.material || (o.flat ? flatMat(o.color, o) : toonMat(o.color, o));
  const mesh = new THREE.Mesh(geo, mat);
  if (o.pos) mesh.position.fromArray(o.pos);
  if (o.rot) mesh.rotation.fromArray(o.rot);
  if (o.scale) mesh.scale.fromArray(o.scale);
  parent.add(mesh);

  if (o.outline !== false) {
    const om = new THREE.Mesh(geo, outlineMat(o.outlineColor ?? OUTLINE_COLOR));
    om.position.copy(mesh.position);
    om.rotation.copy(mesh.rotation);
    om.scale.copy(mesh.scale).multiplyScalar(o.outlineScale ?? 1.05);
    parent.add(om);
    mesh.userData.outline = om;
  }
  return mesh;
}

/** Pivot group used for the joints of the procedural rig. */
export function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// --------------------------------------------------------------- colour utils

export function shift(hex, amount) {
  const c = new THREE.Color(hex);
  if (amount >= 0) c.lerp(new THREE.Color(0xffffff), amount);
  else c.lerp(new THREE.Color(0x000000), -amount);
  return c.getHex();
}

export function cssShift(hex, amount) {
  return '#' + shift(hex, amount).toString(16).padStart(6, '0');
}

// ----------------------------------------------------- procedural textures

function canvasTexture(w, h, draw, o = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = o.wrap ?? THREE.RepeatWrapping;
  if (o.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
  tex.anisotropy = 4;
  return tex;
}

function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function splat(g, w, h, n, colors, seed) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = 2 + r() * 11;
    g.fillStyle = colors[(r() * colors.length) | 0];
    g.globalAlpha = 0.14 + r() * 0.3;
    g.beginPath(); g.arc(x, y, rad, 0, 6.284); g.fill();
  }
  g.globalAlpha = 1;
}

/** Churned, pitted earth. Tiled over the ground plane. */
export function mudTexture(base = '#6b5a44') {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    splat(g, w, h, 150, ['#54462f', '#7d6a4e', '#4a3d2a', '#8a7658', '#3a2f22'], 7);
    const r = rnd(99);
    g.strokeStyle = 'rgba(40,32,22,.5)'; g.lineWidth = 1.4;
    for (let i = 0; i < 26; i++) {
      g.beginPath();
      let x = r() * w, y = r() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 46; y += (r() - 0.5) * 46; g.lineTo(x, y); }
      g.stroke();
    }
  }, { repeat: [14, 10] });
}

/** Stacked sandbag courses, drawn as offset rounded rows. */
export function sandbagTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#9b8a63'; g.fillRect(0, 0, w, h);
    const rows = 4, bw = 64, bh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw / 2);
      for (let x = -bw; x < w + bw; x += bw) {
        const bx = x + off, by = r * bh;
        g.fillStyle = r % 2 ? '#a3926a' : '#8f7f5c';
        g.beginPath();
        g.roundRect(bx + 1.5, by + 1.5, bw - 3, bh - 3, 9);
        g.fill();
        g.fillStyle = 'rgba(60,50,32,.32)';
        g.beginPath();
        g.roundRect(bx + 1.5, by + bh - 7, bw - 3, 5, 3);
        g.fill();
      }
    }
    splat(g, w, h, 40, ['#7a6b4c', '#b0a077'], 31);
  }, { repeat: [2, 2] });
}

export function plankTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#8a6a44'; g.fillRect(0, 0, w, h);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const y = i * (h / n);
      g.fillStyle = i % 2 ? '#8f7047' : '#7d5f3c';
      g.fillRect(0, y, w, h / n - 1);
      g.fillStyle = 'rgba(50,36,22,.45)';
      g.fillRect(0, y + h / n - 1.5, w, 1.5);
    }
    const r = rnd(5);
    g.strokeStyle = 'rgba(60,44,28,.3)'; g.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const y = r() * h;
      g.beginPath(); g.moveTo(0, y);
      g.bezierCurveTo(w / 3, y + (r() - 0.5) * 6, (2 * w) / 3, y + (r() - 0.5) * 6, w, y);
      g.stroke();
    }
  }, { repeat: [1, 6] });
}

export function concreteTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#8b8b83'; g.fillRect(0, 0, w, h);
    splat(g, w, h, 90, ['#7a7a72', '#9b9b93', '#6d6d66', '#a5a59c'], 13);
    g.strokeStyle = 'rgba(70,70,64,.4)'; g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      let x = rnd(i + 40)() * w, y = rnd(i + 80)() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rnd(i * 9 + k)() - 0.5) * 60; y += (rnd(i * 7 + k)() - 0.5) * 60; g.lineTo(x, y); }
      g.stroke();
    }
  }, { repeat: [2, 1] });
}

export function wireTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#4a453c'; g.lineWidth = 2.2;
    for (let i = 0; i < 7; i++) {
      const y = 10 + i * 18;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.4 + i) * 4);
      g.stroke();
    }
    g.fillStyle = '#3a352c';
    for (let i = 0; i < 5; i++) { g.fillRect(6 + i * 26, 6, 4, 116); }
  }, { repeat: [3, 1] });
}

export { canvasTexture };
