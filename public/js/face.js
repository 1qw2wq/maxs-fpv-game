// Everything the faces are made of, drawn with Canvas 2D so the game needs no
// art assets at all.
//
//   makeFaceTexture()  -> a sphere cap texture for the in-game 3D head
//   drawPortrait()     -> a bust portrait for the menu / class select cards
//
// The anime read comes from a small number of very specific cues, all of them
// drawn here: oversized iris with a bright specular dot, a thick upper lash
// line, a tiny nose and mouth, blush high on the cheeks, and a hair highlight
// band across the top of the head.

import * as THREE from 'three';

const SKIN = '#fbe3d4';
const LASH = '#3a2634';

/**
 * One anime eye. Two highlights is the whole trick: a big cool one up-left and
 * a small warm one down-right reads as "wet and glossy" instantly.
 */
export function drawEye(g, cx, cy, w, h, eyeColor, o = {}) {
  const open = o.open ?? 1;
  const hh = h * open;

  if (open < 0.12) {
    g.strokeStyle = LASH;
    g.lineWidth = Math.max(3, h * 0.16);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - w * 0.48, cy);
    g.quadraticCurveTo(cx, cy + h * 0.3, cx + w * 0.48, cy - h * 0.06);
    g.stroke();
    return;
  }

  g.save();
  g.beginPath();
  // Almond: wide at the outer corner, tapered at the inner one.
  g.moveTo(cx - w * 0.5, cy + hh * 0.08);
  g.bezierCurveTo(cx - w * 0.42, cy - hh * 0.72, cx + w * 0.26, cy - hh * 0.78, cx + w * 0.5, cy - hh * 0.18);
  g.bezierCurveTo(cx + w * 0.4, cy + hh * 0.62, cx - w * 0.22, cy + hh * 0.74, cx - w * 0.5, cy + hh * 0.08);
  g.closePath();
  g.clip();

  // sclera
  const sg = g.createLinearGradient(0, cy - hh, 0, cy + hh);
  sg.addColorStop(0, '#fdfbff');
  sg.addColorStop(1, '#e6dcef');
  g.fillStyle = sg;
  g.fillRect(cx - w, cy - hh * 1.2, w * 2, hh * 2.6);

  // iris
  const ir = Math.min(w, hh * 1.25) * 0.46;
  const iy = cy - hh * 0.06;
  const ig = g.createRadialGradient(cx, iy - ir * 0.35, ir * 0.12, cx, iy, ir);
  ig.addColorStop(0, '#ffffff');
  ig.addColorStop(0.30, eyeColor);
  ig.addColorStop(1, '#1e1a2e');
  g.fillStyle = ig;
  g.beginPath(); g.ellipse(cx, iy, ir * 0.94, ir, 0, 0, 6.284); g.fill();

  // pupil
  g.fillStyle = '#241d2e';
  g.beginPath(); g.ellipse(cx, iy, ir * 0.36, ir * 0.47, 0, 0, 6.284); g.fill();

  // highlights
  g.fillStyle = 'rgba(255,255,255,.95)';
  g.beginPath(); g.ellipse(cx - ir * 0.38, iy - ir * 0.44, ir * 0.32, ir * 0.26, -0.5, 0, 6.284); g.fill();
  g.beginPath(); g.ellipse(cx + ir * 0.34, iy + ir * 0.4, ir * 0.16, ir * 0.13, -0.5, 0, 6.284); g.fill();
  g.globalAlpha = 0.5;
  g.beginPath(); g.ellipse(cx - ir * 0.62, iy + ir * 0.34, ir * 0.14, ir * 0.2, 0, 0, 6.284); g.fill();
  g.globalAlpha = 1;

  // upper shadow cast by the lid
  g.fillStyle = 'rgba(60,40,60,.28)';
  g.beginPath();
  g.moveTo(cx - w, cy - hh * 1.2);
  g.lineTo(cx + w, cy - hh * 1.2);
  g.lineTo(cx + w, cy - hh * 0.42);
  g.quadraticCurveTo(cx, cy - hh * 0.92, cx - w, cy - hh * 0.46);
  g.closePath();
  g.fill();
  g.restore();

  // thick upper lash line + outer spike
  g.strokeStyle = LASH;
  g.lineCap = 'round';
  g.lineWidth = Math.max(3.4, h * 0.2);
  g.beginPath();
  g.moveTo(cx - w * 0.5, cy + hh * 0.06);
  g.bezierCurveTo(cx - w * 0.42, cy - hh * 0.74, cx + w * 0.26, cy - hh * 0.8, cx + w * 0.52, cy - hh * 0.2);
  g.stroke();
  g.lineWidth = Math.max(2, h * 0.1);
  g.beginPath();
  g.moveTo(cx + w * 0.24, cy + hh * 0.5);
  g.quadraticCurveTo(cx - w * 0.18, cy + hh * 0.72, cx - w * 0.48, cy + hh * 0.12);
  g.stroke();
}

function drawBrow(g, cx, cy, w, color, flip) {
  g.strokeStyle = color;
  g.lineWidth = Math.max(3, w * 0.1);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - w * 0.5 * flip, cy + w * 0.1);
  g.quadraticCurveTo(cx, cy - w * 0.22, cx + w * 0.5 * flip, cy + w * 0.04);
  g.stroke();
}

function drawMouth(g, cx, cy, w, color) {
  g.strokeStyle = color;
  g.lineWidth = Math.max(2.4, w * 0.11);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - w * 0.5, cy);
  g.quadraticCurveTo(cx, cy + w * 0.55, cx + w * 0.5, cy);
  g.stroke();
}

function drawBlush(g, cx, cy, rx, ry) {
  const bg = g.createRadialGradient(cx, cy, 1, cx, cy, rx);
  bg.addColorStop(0, 'rgba(255,124,150,.52)');
  bg.addColorStop(1, 'rgba(255,124,150,0)');
  g.save();
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  g.fillStyle = bg;
  g.beginPath(); g.arc(0, 0, rx, 0, 6.284); g.fill();
  g.restore();
  // two tiny hatch lines, the classic anime tell
  g.strokeStyle = 'rgba(226,86,120,.35)';
  g.lineWidth = 1.6;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(cx + i * rx * 0.3, cy - ry * 0.35);
    g.lineTo(cx + i * rx * 0.3, cy + ry * 0.35);
    g.stroke();
  }
}

// ------------------------------------------------------------ head texture

/**
 * Texture for the front cap of a head sphere. The cap spans +/-54 deg of
 * longitude, so only u in [0.18, 0.82] is ever really seen — features are kept
 * well inside that band to avoid the curvature smearing them.
 */
export function makeFaceTexture(cls) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');

  g.fillStyle = SKIN;
  g.fillRect(0, 0, S, S);

  // soft cheek shading so the flat fill is not dead
  const vg = g.createRadialGradient(S * 0.5, S * 0.58, S * 0.1, S * 0.5, S * 0.6, S * 0.5);
  vg.addColorStop(0, 'rgba(255,255,255,.25)');
  vg.addColorStop(1, 'rgba(220,168,150,.22)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);

  // Feature placement is derived from the cap's theta range (see character.js):
  // v=0.583 lands the eyes just under the head's equator, v=0.79 the mouth on
  // the chin. Anything lower would wrap around the underside of the skull.
  const eyeW = S * 0.155, eyeH = S * 0.135;
  const eyeY = S * 0.583;
  const dx = S * 0.145;

  drawBrow(g, S * 0.5 - dx, eyeY - eyeH * 1.5, eyeW * 1.0, '#7a5468', 1);
  drawBrow(g, S * 0.5 + dx, eyeY - eyeH * 1.5, eyeW * 1.0, '#7a5468', -1);

  drawEye(g, S * 0.5 - dx, eyeY, eyeW, eyeH, cls.eyeColor);
  drawEye(g, S * 0.5 + dx, eyeY, eyeW, eyeH, cls.eyeColor);

  drawBlush(g, S * 0.5 - dx * 1.72, eyeY + eyeH * 1.02, S * 0.085, S * 0.045);
  drawBlush(g, S * 0.5 + dx * 1.72, eyeY + eyeH * 1.02, S * 0.085, S * 0.045);

  // nose: a single shadow dot, nothing more
  g.fillStyle = 'rgba(206,148,132,.55)';
  g.beginPath();
  g.ellipse(S * 0.5, eyeY + eyeH * 1.15, S * 0.016, S * 0.012, 0, 0, 6.284);
  g.fill();

  drawMouth(g, S * 0.5, eyeY + eyeH * 1.55, S * 0.06, '#c4586e');

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --------------------------------------------------------------- portraits

// Class-select art: one imported character render per class, matched to the
// class's default in-game skin (assault = Hutao, medic = Furina, support =
// Navia, scout = Charlotte). The files are pre-cropped to the card's 3:3.4 box,
// so the canvas just draws them straight.
const portraitCache = new Map();

function loadPortrait(clsId) {
  let p = portraitCache.get(clsId);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `img/classes/${clsId}.jpg`;
    });
    portraitCache.set(clsId, p);
  }
  return p;
}

/**
 * Bust portrait for the class-select cards. A theme-tinted plate goes down
 * first and the render is painted over it once decoded, so a slow thumbnail
 * never leaves the card blank.
 */
export function drawPortrait(canvas, cls) {
  const W = 300, H = 340;
  canvas.width = W * 2; canvas.height = H * 2;
  const g = canvas.getContext('2d');
  g.scale(2, 2);

  const bg = g.createRadialGradient(W * 0.5, H * 0.36, 10, W * 0.5, H * 0.5, W * 0.78);
  bg.addColorStop(0, hexA(cls.themeColor, 0.5));
  bg.addColorStop(0.55, 'rgba(24,30,44,.92)');
  bg.addColorStop(1, 'rgba(12,15,23,.98)');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  loadPortrait(cls.id).then((img) => {
    if (img) g.drawImage(img, 0, 0, W, H);
  });
}

function hexA(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
