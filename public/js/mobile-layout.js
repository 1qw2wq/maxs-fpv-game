// Normalized screen positions, stored separately for each orientation.
export const TOUCH_ITEMS = ['move','fire','aim','reload','jump','ability','grenade','crouch','cycle','weapon'];
export function sanitizeTouchLayout(raw) {
  const out = { portrait:{}, landscape:{} };
  for (const mode of Object.keys(out)) for (const key of TOUCH_ITEMS) {
    const p = raw?.[mode]?.[key];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      out[mode][key] = { x:Math.max(0,Math.min(1,p.x)), y:Math.max(0,Math.min(1,p.y)) };
    }
  }
  return out;
}
export function layoutOrientation() { return innerWidth > innerHeight ? 'landscape' : 'portrait'; }
export function layoutCollision(elements) {
  const boxes = elements.map(el => el.getBoundingClientRect());
  return boxes.some((a,i) => boxes.some((b,j) => j > i &&
    Math.min(a.right,b.right)-Math.max(a.left,b.left) > 2 &&
    Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) > 2));
}
