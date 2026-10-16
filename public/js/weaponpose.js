// One gun-local (+Z = barrel) source for wrist, reload and effect attachments.
// Both the viewmodel and third-person IK consume these, not separate mirrored
// tables. Values are metres in the normalized gun envelope used by guns.js.
const SHAPES = {
  pistol: {hand:[.012,-.07,-.06],fore:[-.035,-.065,-.025],reload:[0,-.14,-.06],eject:[-.025,.015,-.015]},
  smg: { hand: [0, -0.10, 0.02], fore: [0, -0.065, 0.19], reload: [0, -0.17, -0.11], eject: [-0.045, 0.025, -0.035] },
  rifle: { hand: [0, -0.10, -0.06], fore: [0, -0.075, 0.21], reload: [0, -0.13, 0.015], eject: [-0.04, 0.025, -0.02] },
  lmg: { hand: [0, -0.13, 0.02], fore: [0, -0.08, 0.24], reload: [0, -0.16, -0.06], eject: [-0.055, 0.02, -0.07] },
  bolt: { hand: [0, -0.095, -0.04], fore: [0, -0.055, 0.22], reload: [0, 0.075, -0.06], eject: [-0.04, 0.04, -0.07] },
};
// Contact points measured on the normalized GLBs, not the old primitive guns.
// In particular MP18's bore is at x=-.099, and most rifle stocks sit well
// ABOVE the placeholder pistol-grip height. +Z remains down the barrel.
const MODELS = {
  ar15: {"hand": [0, -0.14, -0.225], "fore": [0, -0.035, 0.16], "reload": [0, -0.21000000000000002, -0.225], "eject": [-0.03, 0.02, -0.165]},
  pmx: {"hand": [0, -0.09, 0.11], "fore": [0, -0.04, 0.24], "reload": [0, -0.16, 0.11], "eject": [-0.03, 0.02, 0.16999999999999998]},
  gm6: {"hand": [0, -0.11, 0.24], "fore": [0, -0.045, 0.39], "reload": [0, -0.18, 0.24], "eject": [-0.03, 0.02, 0.3]},
  lr300: {"hand": [0, -0.105, 0.065], "fore": [0, -0.035, 0.25], "reload": [0, -0.175, 0.065], "eject": [-0.03, 0.02, 0.125]},
  m170: {"hand": [0, -0.115, -0.43], "fore": [0, -0.055, -0.03], "reload": [0, -0.185, -0.43], "eject": [-0.03, 0.02, -0.37]},
  m249: {"hand": [0, -0.095, -0.24], "fore": [0, -0.06, 0.05], "reload": [0, -0.165, -0.24], "eject": [-0.03, 0.02, -0.18]},
  m4a1: {"hand": [0, -0.075, -0.14], "fore": [0, -0.025, 0.18], "reload": [0, -0.14500000000000002, -0.14], "eject": [-0.03, 0.02, -0.08000000000000002]},
  m60light: {"hand": [0, -0.08, -0.16], "fore": [0, -0.045, 0.19], "reload": [0, -0.15000000000000002, -0.16], "eject": [-0.03, 0.02, -0.1]},
  m60: {"hand": [0, -0.1, -0.21], "fore": [0, -0.045, 0.17], "reload": [0, -0.17, -0.21], "eject": [-0.03, 0.02, -0.15]},
  mp5: {"hand": [0, -0.065, 0], "fore": [0, -0.035, 0.16], "reload": [0, -0.135, 0], "eject": [-0.03, 0.02, 0.06]},
  pgm: {"hand": [0, -0.105, -0.31], "fore": [0, -0.055, 0.03], "reload": [0, -0.175, -0.31], "eject": [-0.03, 0.02, -0.25]},
  apx: {"hand": [0.012, -0.065, -0.055], "fore": [-0.033, -0.062, -0.025], "reload": [0.012, -0.135, -0.055], "eject": [-0.03, 0.02, 0.0049999999999999975]},
  g17: {"hand": [0.015, -0.07, -0.055], "fore": [-0.035, -0.065, -0.02], "reload": [0.015, -0.14, -0.055], "eject": [-0.03, 0.02, 0.0049999999999999975]},
  deagle: {"hand": [0.02, -0.075, -0.075], "fore": [-0.035, -0.07, -0.035], "reload": [0.02, -0.14500000000000002, -0.075], "eject": [-0.03, 0.02, -0.015]},
  flarepistol: {hand:[.015,-.115,-.07],fore:[-.032,-.11,-.035],reload:[0,-.17,-.07],eject:[-.03,0,-.01]},
  sentinel: { hand: [0, -.085, -.285], fore: [0, -.04, .08], reload: [0, -.08, -.18], eject: [-.035, .02, -.19] },
  awp: { hand: [0, -.065, -.33], fore: [0, -.035, .03], reload: [0, -.09, -.20], eject: [-.035, .035, -.26] },
  longbow: { hand: [0, -.09, -.34], fore: [0, -.027, .10], reload: [0, -.10, -.18], eject: [-.04, .025, -.14] },
  mp18: { hand: [-0.099, -0.030, -0.21], fore: [-0.099, -0.002, 0.12], reload: [-0.12, -0.04, -0.08] },
  auto1918: { hand: [0.006, -0.031, -0.22], fore: [0.006, -0.013, 0.13] },
  hellriegel: { hand: [0.012, 0.020, -0.14], fore: [0.012, -0.003, 0.20] },
  cei: { hand: [-0.021, 0.006, -0.11], fore: [-0.021, 0.052, 0.21] },
  rsc1917: { hand: [0.008, 0.020, -0.31], fore: [0.008, 0.044, 0.20] },
  federov: { hand: [-0.017, 0.020, -0.28], fore: [-0.017, 0.067, 0.18] },
  lewis: { hand: [0.014, -0.010, -0.105], fore: [0.014, 0.059, 0.19], reload: [0, 0.105, -0.07] },
  bar: { hand: [-0.009, 0.015, -0.26], fore: [-0.009, 0.039, 0.17], reload: [0, -0.15, -0.03] },
  chauchat: { hand: [0, -0.090, -0.25], fore: [0, 0.115, 0.30], reload: [0, -0.19, 0.02] },
  smle: { hand: [-0.004, 0.010, -0.20], fore: [-0.004, 0.049, 0.18] },
  m95: { hand: [0.018, 0.010, -0.23], fore: [0.018, 0.051, 0.20] },
  springfield: { hand: [0.016, -0.008, -0.20], fore: [0.016, 0.041, 0.20] },
};
const cache = new Map();
export function weaponSockets(weapon = {}) {
  const key = `${weapon.id || ''}:${weapon.shape || 'rifle'}`;
  if (!cache.has(key)) {
    const sockets={...(SHAPES[weapon.shape]||SHAPES.rifle),...(MODELS[weapon.id]||{})};
    const delta=sockets.fore.map((v,i)=>v-sockets.hand[i]),span=Math.hypot(...delta);
    const limit=weapon.shape==='pistol'?.09:.28;
    if(span>limit)sockets.fore=sockets.hand.map((v,i)=>v+delta[i]*limit/span);
    cache.set(key,sockets);
  }
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

// Placement is driven by the actual trigger, not by the overall rifle length.
// Each fitted model has its own hip/ADS reach. Bullpups and pistols must not
// inherit the distant support grip or stock pivot of a traditional long rifle.
const VIEW = {
  mp18:[.16,-.29,.27],auto1918:[.17,-.30,.28],hellriegel:[.19,-.31,.30],
  cei:[.155,-.285,.27],rsc1917:[.16,-.30,.29],federov:[.17,-.29,.28],
  lewis:[.19,-.315,.30],bar:[.18,-.305,.29],chauchat:[.195,-.32,.31],
  smle:[.16,-.29,.29],m95:[.165,-.295,.28],springfield:[.17,-.30,.29],
  sentinel:[.175,-.305,.30],awp:[.18,-.31,.31],longbow:[.17,-.305,.30],
  ar15:[.165,-.30,.28],pmx:[.15,-.285,.26],gm6:[.19,-.31,.28],
  lr300:[.16,-.29,.27],m170:[.185,-.315,.31],m249:[.20,-.32,.30],
  m4a1:[.155,-.285,.27],m60light:[.19,-.315,.30],m60:[.205,-.325,.31],
  mp5:[.145,-.28,.26],pgm:[.18,-.31,.30],
  apx:[.10,-.27,.34],g17:[.105,-.275,.35],deagle:[.115,-.28,.36],flarepistol:[.12,-.285,.34],
};
export function weaponViewPose(weapon={}) {
  const h=weaponSockets(weapon).hand,[x,y,reach]=VIEW[weapon.id]||[.16,-.29,.28];
  return {hip:[x+h[0],y-h[1],h[2]-reach],adsZ:h[2]-(weapon.shape==='pistol'?.44:.35)};
}
