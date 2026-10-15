// The player's own data, stored only on their own computer.
//
// Nothing here ever leaves the browser: no accounts, no server-side profiles,
// no database. The game server is stateless apart from the rooms that exist
// while a match is running, so a profile that lives in localStorage is not a
// simplification -- it is the whole design.
//
// Everything is funnelled through storage.js, so a browser that refuses
// localStorage (opaque origin, blocked site data, private mode) simply runs
// with an in-memory profile instead of throwing on start-up.

import { store, session } from './storage.js';

const KEY = 'tf.profile';
const VERSION = 2;

export const DEFAULT_PROFILE = {
  v: VERSION,
  name: '',
  cls: 'assault',
  weapon: null,
  skin: '',
  roomMode: 'create',     // 'create' | 'join'
  room: '',               // last room code this player created or joined
  recentRooms: [],        // newest first, at most 5
  tutorialDone: false,
  soloBots: 6,
  mapId: '',
  sensitivity: 0.0022,
  controlMode: 'auto',
  stats: { matches: 0, wins: 0, kills: 0, deaths: 0, playMs: 0 },
  lastSeen: 0,
};

function clampStr(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function int(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}

function num(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}

/** Coerce anything that came out of storage into a valid profile. */
export function sanitize(raw) {
  const p = { ...DEFAULT_PROFILE, stats: { ...DEFAULT_PROFILE.stats }, recentRooms: [] };
  if (!raw || typeof raw !== 'object') return p;
  p.name = clampStr(raw.name, 16);
  p.cls = clampStr(raw.cls, 24) || p.cls;
  p.weapon = raw.weapon ? clampStr(raw.weapon, 32) : null;
  p.skin = clampStr(raw.skin, 40);
  p.roomMode = raw.roomMode === 'join' ? 'join' : 'create';
  p.room = /^\d{8}$/.test(String(raw.room || '')) ? String(raw.room) : '';
  const rooms = Array.isArray(raw.recentRooms) ? raw.recentRooms : [];
  for (const code of rooms) {
    const c = String(code || '');
    if (/^\d{8}$/.test(c) && !p.recentRooms.includes(c) && p.recentRooms.length < 5) {
      p.recentRooms.push(c);
    }
  }
  p.controlMode = ['auto', 'desktop', 'mobile'].includes(raw.controlMode) ? raw.controlMode : 'auto';
  p.tutorialDone = !!raw.tutorialDone;
  p.soloBots = [0, 4, 6, 8, 12, 16].includes(Number(raw.soloBots)) ? Number(raw.soloBots) : 6;
  p.mapId = clampStr(raw.mapId, 32);
  p.sensitivity = num(raw.sensitivity, 0.0004, 0.01, DEFAULT_PROFILE.sensitivity);
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  p.stats = {
    matches: int(st.matches, 0, 100000, 0),
    wins: int(st.wins, 0, 100000, 0),
    kills: int(st.kills, 0, 1000000, 0),
    deaths: int(st.deaths, 0, 1000000, 0),
    playMs: int(st.playMs, 0, 10 ** 11, 0),
  };
  p.lastSeen = int(raw.lastSeen, 0, 10 ** 14, 0);
  return p;
}

let cache = null;

/** The whole profile. Always returns a fresh copy: callers cannot corrupt it. */
export function load() {
  if (!cache) {
    let raw = null;
    try {
      raw = JSON.parse(store.get(KEY) || 'null');
    } catch {
      raw = null;   // corrupt entry: start clean rather than crashing the menu
    }
    cache = sanitize(raw);
  }
  return { ...cache, stats: { ...cache.stats }, recentRooms: [...cache.recentRooms] };
}

export function save(patch) {
  const next = sanitize({ ...load(), ...patch, stats: { ...load().stats, ...(patch.stats || {}) } });
  next.lastSeen = Date.now();
  cache = next;
  store.set(KEY, JSON.stringify(next));
  return load();
}

/** Bump one counter (or several) in the local stats block. */
export function bumpStats(delta) {
  const st = { ...load().stats };
  for (const [k, v] of Object.entries(delta || {})) {
    st[k] = Math.max(0, (st[k] || 0) + Number(v || 0));
  }
  return save({ stats: st });
}

/** Remember a room code so the menu can offer it again next time. */
export function rememberRoom(code, mode) {
  if (!/^\d{8}$/.test(String(code || ''))) return load();
  const p = load();
  const recent = [code, ...p.recentRooms.filter((c) => c !== code)].slice(0, 5);
  return save({ room: code, roomMode: mode || p.roomMode, recentRooms: recent });
}

/** True when the browser really keeps this data between visits. */
export function persistent() {
  return !!store.persistent;
}

export function reset() {
  cache = sanitize(null);
  store.remove(KEY);
  session.remove('tf.sid');
  return load();
}

/** What this browser stores, for the settings screen. */
export function summary() {
  const p = load();
  return {
    name: p.name,
    room: p.room,
    recent: p.recentRooms.length,
    stats: p.stats,
    tutorialDone: p.tutorialDone,
    persistent: persistent(),
    keys: ['tf.profile', 'tf.sid', 'tf.mapId', 'tf.server', 'tf.skinId', 'tf.skinName', 'tf.localRig'],
  };
}
