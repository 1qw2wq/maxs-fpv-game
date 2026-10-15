// One gun-local (+Z = barrel) source for wrist, reload and effect attachments.
// Both the viewmodel and third-person IK consume these, not separate mirrored
// tables. Values are metres in the normalized gun envelope used by guns.js.
const SHAPES = {
  smg: { hand: [0, -0.10, 0.02], fore: [0, -0.065, 0.19], reload: [0, -0.17, -0.11], eject: [-0.045, 0.025, -0.035] },
  rifle: { hand: [0, -0.10, -0.06], fore: [0, -0.075, 0.21], reload: [0, -0.13, 0.015], eject: [-0.04, 0.025, -0.02] },
  lmg: { hand: [0, -0.13, 0.02], fore: [0, -0.08, 0.24], reload: [0, -0.16, -0.06], eject: [-0.055, 0.02, -0.07] },
  bolt: { hand: [0, -0.095, -0.04], fore: [0, -0.055, 0.22], reload: [0, 0.075, -0.06], eject: [-0.04, 0.04, -0.07] },
};
const MODELS = {
  mp18: { reload: [-0.12, -0.04, -0.08] },
  lewis: { reload: [0, 0.105, -0.07] },
  chauchat: { reload: [0, -0.19, 0.02] },
  bar: { reload: [0, -0.15, -0.03] },
};
const cache = new Map();
export function weaponSockets(weapon = {}) {
  const key = `${weapon.id || ''}:${weapon.shape || 'rifle'}`;
  if (!cache.has(key)) cache.set(key, { ...(SHAPES[weapon.shape] || SHAPES.rifle), ...(MODELS[weapon.id] || {}) });
  return cache.get(key);
}

// Third-person buildWeapon is mounted at this offset inside weaponMount.
const mountedCache = new Map();
export function mountedGrips(weapon = {}) {
  const key = `${weapon.id || ''}:${weapon.shape || 'rifle'}`;
  if (mountedCache.has(key)) return mountedCache.get(key);
  const pose = weaponSockets(weapon);
  const offset = (v) => [v[0] + 0.04, v[1] - 0.03, v[2] + 0.06];
  const grips = { hand: offset(pose.hand), fore: offset(pose.fore) };
  mountedCache.set(key, grips);
  return grips;
}

const smooth = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
/** Continuous reload phases: present, release, service, seat, recover. */
export function reloadPose(progress, clip = false) {
  const p = Math.max(0, Math.min(1, progress));
  const present = smooth(0, 0.18, p) * (1 - smooth(0.78, 1, p));
  const reach = smooth(0.12, 0.30, p) * (1 - smooth(0.72, 0.94, p));
  const envelope = smooth(0.30, 0.44, p) * (1 - smooth(0.56, 0.70, p));
  const service = clip ? envelope * (0.55 + 0.45 * Math.sin(p * Math.PI * 10)) : envelope;
  const seat = Math.sin(smooth(0.65, 0.82, p) * Math.PI) * 0.018;
  return { present, reach, service, seat, clip };
}
