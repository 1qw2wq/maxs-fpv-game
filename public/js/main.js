// Entry point: menu -> class select -> live match.
//
// Responsibilities are intentionally narrow here. Movement lives in
// controls.js, remote pose reconstruction in net.js, all 3D construction in
// character.js/map.js/viewmodel.js. main.js only sequences them and owns the
// match-level event handling.

import * as THREE from 'three';
import { loadConfig } from './config.js';
import { World } from './map.js';
import { createGirl, yawToRotation } from './character.js';
import { ViewModel } from './viewmodel.js';
import { Controls } from './controls.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Net } from './net.js';
import { drawPortrait } from './face.js';
import { flatMat } from './toon.js';
import { createSettings, createExternalGirl, prepareTemplate, loadGltfFromUrl,
  BUILTIN_SKINS, DEFAULT_CLASS_SKIN } from './rig.js';

// Old Intel iGPUs (e.g. HD 4600, final 2020 driver) on old/portable Chromium
// builds abort createImageBitmap() decodes partway through the spawn burst of
// GLB-embedded textures. three's GLTFLoader catches that into a null map, the
// material falls back to its white base colour and the affected body part is
// flat white forever ("white hair/legs"). Its parser chooses ImageBitmap vs
// the classic <img> decoder per parse by probing this global, so dropping the
// global before the first model load routes every GLB texture through the
// mature HTMLImageElement path (the one Firefox/Safari always use). All model
// textures are <=1024 px, so the path is cheap and safe on modern GPUs too.
// Nothing else in the project uses createImageBitmap.
try {
  if (typeof window !== 'undefined' && 'createImageBitmap' in window) {
    window.createImageBitmap = undefined;
  }
} catch { /* non-browser context: nothing to do */ }

// The bolt is worked a beat after a shot lands; while scoped it instead waits
// for the player to drop out of the sights (see fireOnce / the fire loop).
const BOLT_SOUND_DELAY_MS = 500;

const app = {
  playing: false,
  last: 0,
  inputAcc: 0,
  clickPending: false,
  nextShot: 0,
  // set after firing a bolt rifle that is not straight-pull; cleared once the
  // player lets go of the aim button, which is what chambers the next round
  boltWait: false,
  // the weapon whose bolt-cycle sound is waiting for the sights to drop
  pendingBolt: null,
  stepDist: 0,
  // wall-clock stamps of the last shot / throw release, so the avatar's upper
  // body layer can hold its fire or toss pose for a moment after the gesture
  // itself is over (the throw clip must finish even though Q is already up)
  fireAt: 0,
  throwAt: 0,
  tracers: [],
  effects: [],
  // {t0} while Q is held on a thrown ability; null otherwise
  charge: null,
  // the map's own fog/background, saved while a smoke screen overrides them
  smokeBase: null,
  smokeOn: false,
  remotes: new Map(),
  // the local player's own avatar, only rendered in third person
  self: null,
  cameraMode: 'fp',
  myTeam: 0,
  myId: null,
  loadout: { cls: 'assault', weapon: 'mp18', skin: '' },
  suppressed: false,
  lastReloading: false,
  wasAlive: true,
  deathShown: false,
  resultShown: false,
  _sbOpen: false,
  settings: null,
  // Map choice: picked in the menu, but the server is the one that decides.
  // mapData caches each map's JSON so a re-pick costs no network round trip.
  mapPick: null,
  mapData: new Map(),
  mapId: null,
  mapLoading: false,
  charMeta: new Map(),
  charTemplates: new Map(),
  charPending: new Set(),
  fpArms: null,
  // what the first-person viewmodel is currently showing, so a loadout change
  // always rebuilds it even when the client guessed the new loadout in advance
  vmCls: null,
  vmWeapon: null,
  // the host:port the live socket is actually attached to, so a changed server
  // address is detected and reconnects instead of silently reusing the old link
  netUrl: null,
};

// One id per browser tab, kept in sessionStorage: it survives a refresh but is
// never shared with another tab. The server uses it to evict the stale socket a
// reload leaves behind, otherwise that ghost keeps the room occupied and the
// fresh map pick is downgraded to a between-rounds vote (i.e. ignored).
function tabSessionId() {
  let sid = null;
  try {
    sid = sessionStorage.getItem('tf.sid');
  } catch (e) {
    sid = null;
  }
  if (!sid) {
    sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 's' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    try {
      sessionStorage.setItem('tf.sid', sid);
    } catch (e) { /* private mode: fall back to a per-connection id */ }
  }
  return sid;
}

// --------------------------------------------------------------------- boot

async function boot() {
  try {
    app.data = await loadConfig();
  } catch (err) {
    document.querySelector('.boot-text').textContent = `战场数据载入失败：${err.message}`;
    return;
  }

  const canvas = document.getElementById('game');
  app.canvas = canvas;
  app.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  app.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  app.renderer.setSize(innerWidth, innerHeight);
  app.renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.renderer.toneMapping = THREE.NoToneMapping;

  app.scene = new THREE.Scene();
  app.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.06, 600);

  // The world is built by setMap() on deploy: a model map is 92 MB and has no
  // business delaying a menu the player may never leave.
  const savedMap = localStorage.getItem('tf.mapId');
  app.mapPick = app.data.mapById[savedMap] ? savedMap : app.data.defaultMapId;
  app.hud = new Hud(app.data);
  app.sfx = new Sfx();
  app.controls = new Controls(canvas, null, app.data.combat, app.data);
  app.vm = new ViewModel(app.data);
  app.camera.add(app.vm.root);
  app.scene.add(app.camera);

  app.fxGroup = new THREE.Group();
  app.scene.add(app.fxGroup);

  addEventListener('resize', () => {
    app.renderer.setSize(innerWidth, innerHeight);
    app.camera.aspect = innerWidth / innerHeight;
    app.camera.updateProjectionMatrix();
  });

  app.settings = createSettings({
    data: app.data,
    hud: app.hud,
    onUse: (skin) => {
      app.loadout.skin = skin?.id || '';
      app.hud.setSkinNote(skin ? `当前角色：${skin.name || skin.id}` : '');
    },
  });
  await refreshCharLibrary();
  for (const skin of Object.values(BUILTIN_SKINS)) app.charMeta.set(skin.id, skin);

  // Warm every built-in rig while the player is still on the menu. Textures
  // are uploaded serially, one per frame, long before the join burst -- the
  // burst is exactly when old Intel iGPUs drop a first upload to solid black.
  // A failed preload is harmless: the rig simply loads lazily on first use.
  for (const skin of Object.values(BUILTIN_SKINS)) ensureTemplate(skin.id, skin);

  setupMenu();
  wireControls();
  app.hud.screen('menu');
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------ character library

/** Shared characters uploaded by anyone; keyed by server id. */
async function refreshCharLibrary() {
  try {
    const res = await fetch('/api/characters');
    const list = (await res.json()).characters || [];
    for (const m of list) app.charMeta.set(m.id, m);
  } catch { /* offline: only the built-in characters are available */ }

  const saved = localStorage.getItem('tf.skinId') || '';
  const meta = app.charMeta.get(saved);
  app.loadout.skin = meta ? meta.id : '';
  app.hud.setSkinNote(meta ? `当前角色：${meta.name || meta.id}` : '');
}

// Weak Intel iGPUs (HD 4600 era, 2020 drivers) silently turn a texture's very
// first GPU upload into solid black when several rigs finish loading in the
// same burst -- three uploads each texture exactly once, so the black sticks.
// Rig loads therefore funnel through one serial chain, and a finished template
// is pre-uploaded on its own frame with compile() before any avatar renders
// with it. All built-in rigs run this during the menu, so a real join burst
// has nothing left to upload.
const prewarmScene = new THREE.Scene();
let skinLoadChain = Promise.resolve();
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function prewarmTemplate(tpl) {
  if (!app.renderer || !tpl || !tpl.scene) return;
  // compile() initialises geometry buffers and uploads every referenced
  // texture even though the rig never renders from this throwaway scene.
  // Frustum culling is bypassed for the pass so no mesh is skipped: a skipped
  // mesh would keep its texture uninitialised until gameplay.
  const meshes = [];
  tpl.scene.traverse((o) => {
    if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; meshes.push(o); }
  });
  prewarmScene.add(tpl.scene);
  app.renderer.compile(prewarmScene, app.camera);
  prewarmScene.remove(tpl.scene);
  for (const o of meshes) o.frustumCulled = true;
}

/** Lazily download + normalise an uploaded rig, once per id per session. */
function ensureTemplate(id, meta) {
  if (app.charTemplates.has(id) || app.charPending.has(id)) return;
  app.charPending.add(id);
  const job = skinLoadChain.then(async () => {
    const gltf = await loadGltfFromUrl(meta.file);
    const tpl = prepareTemplate(gltf.scene);
    app.charTemplates.set(id, tpl);
    await nextFrame();
    prewarmTemplate(tpl);
    await nextFrame();
  }).catch(() => {
    // A missing built-in rig must stay available for a lazy retry on spawn;
    // only genuinely external uploads drop out of the library on failure.
    if (!String(id).startsWith('builtin-')) app.charMeta.delete(id);
  }).finally(() => {
    app.charPending.delete(id);
  });
  skinLoadChain = job.then(() => {}, () => {});
}

/** Remote avatar: the uploaded rig when it is ready, the built-in girl until then. */
function makeRemoteGirl(cls, team, skinId) {
  const meta = skinId ? app.charMeta.get(skinId) : null;
  const template = meta ? app.charTemplates.get(skinId) : null;
  if (meta && !template) ensureTemplate(skinId, meta);
  if (template) {
    const girl = createExternalGirl({ template, meta, data: app.data, team });
    girl.skinId = skinId;
    return girl;
  }
  const girl = createGirl(cls, team, app.data);
  girl.skinId = '';
  return girl;
}

// --------------------------------------------------------------------- menu

function setupMenu() {
  let botCount = 6;
  let mode = 'multi';

  // Server address: remembered per browser. Empty means "wherever this page
  // came from", which is already correct when everyone opens the host's URL.
  app.hud.setServerAddress(localStorage.getItem('tf.server') || '');

  const enterSelect = (which) => {
    mode = which;
    app.sfx.resume();
    // Bots belong to solo only; multiplayer is humans only.
    app.hud.setBotsVisible(which === 'solo');
    app.hud.screen('select');
    app.hud.selectClass(app.loadout.cls, 0);
    app.hud.pickWeapon(app.loadout.cls, app.loadout.weapon);
  };

  app.hud.bindMenu({
    onMulti: () => enterSelect('multi'),
    onSolo: () => enterSelect('solo'),
    onSettings: () => {
      app.sfx.resume();
      app.settings.open();
    },
    onBotCount: (n) => { botCount = n; },
    onMap: (id) => {
      app.sfx.ui();
      app.mapPick = id;
      app.hud.setMapPick(id);
      localStorage.setItem('tf.mapId', id);
    },
  });
  app.hud.buildMaps(app.data.maps, app.mapPick);

  app.hud.buildSelect(
    (clsId) => {
      app.sfx.ui();
      app.hud.selectClass(clsId, 0);
      app.hud.pickWeapon(clsId, app.data.weaponsByClass[clsId][0].id);
    },
    () => {
      const sel = app.hud.selected || { cls: app.loadout.cls, weapon: app.data.weaponsByClass[app.loadout.cls][0].id };
      app.loadout = { ...app.loadout, ...sel };
      deploy({
        name: app.hud.playerName,
        cls: sel.cls,
        weapon: sel.weapon,
        bots: mode === 'solo',
        botCount: mode === 'solo' ? botCount : 0,
        skin: app.loadout.skin || '',
        solo: mode === 'solo',
      });
    },
    () => {
      app.hud.setBotsVisible(mode === 'solo');
      app.hud.screen('menu');
    },
  );

  for (const cls of app.data.classes) {
    const card = app.hud.classCards[cls.id];
    if (card) drawPortrait(card.canvas, cls);
  }
}

/**
 * The address typed in the menu, normalised to a `host:port` a WebSocket can
 * use. Empty falls back to the address this page was served from. Bare hosts
 * get an http:// scheme so `192.168.1.23` parses, and a missing port inherits
 * the page's port -- a bare `new URL()` would default to :80 and never connect.
 */
function normalizeServer(raw) {
  const text = (raw || '').trim();
  if (!text) return location.host;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new Error(`服务器地址无效：${text}`);
  }
  // URL.hostname keeps IPv6 brackets in some engines and drops them in others,
  // so normalise here rather than assuming either.
  const bare = url.hostname.replace(/^\[|\]$/g, '');
  const host = bare.includes(':') ? `[${bare}]` : bare;
  return `${host}:${url.port || location.port || '8080'}`;
}

async function deploy(opts) {
  app.hud.menuError('');

  let host;
  try {
    host = normalizeServer(app.hud.serverAddress);
  } catch (err) {
    app.hud.menuError(err.message);
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${host}/ws`;
  localStorage.setItem('tf.server', app.hud.serverAddress);

  const makeNet = () => new Net({
    onWelcome: onWelcome,
    onState: onState,
    onMe: onMe,
    onMessage: onMessage,
    onClose: () => {
      if (!app.playing) return;
      app.playing = false;
      app.controls.releaseLock();
      app.hud.screen('menu');
      app.hud.menuError('与服务器断开连接');
    },
    onError: () => app.hud.menuError(`无法连接服务器（${host}）`),
  });

  // A socket already bound to a different address is useless once the menu
  // address changes, so drop it and build a fresh client -- otherwise editing
  // the field would silently keep talking to the old server.
  if (app.net && (!app.net.connected || app.netUrl !== url)) {
    app.net.close();
    app.net = null;
    app.netUrl = null;
  }
  if (!app.net) {
    app.net = makeNet();
    app.netUrl = url;
    try {
      await app.net.connect(url);
    } catch (err) {
      app.net.close();
      app.net = null;
      app.netUrl = null;
      app.hud.menuError(`无法连接服务器（${host}）`);
      return;
    }
  }
  app.net.join(opts.name, opts.cls, opts.weapon, opts.bots, opts.botCount, opts.skin,
    opts.solo, opts.map || app.mapPick, tabSessionId());
}

// ----------------------------------------------------------------- map swap

/**
 * Load (at most once per session) and install a map. Both the menu pick and the
 * server's between-round vote funnel through here; only the server's choice is
 * authoritative at match time.
 */
async function setMap(mapId) {
  const meta = app.data.mapById[mapId] || app.data.mapById[app.data.defaultMapId];
  if (app.mapId === meta.id && app.world) return;
  app.mapLoading = true;
  app.hud.showMapLoad(`正在装载地图 · ${meta.name}`);
  try {
    let map = app.mapData.get(meta.id);
    if (!map) {
      const res = await fetch(meta.file, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${meta.file} -> HTTP ${res.status}`);
      map = { ...(await res.json()), scene: meta.scene };
      app.mapData.set(meta.id, map);
    }
    const old = app.world;
    const next = await World.create(app.scene, map, app.data.combat);
    app.world = next;
    app.controls.world = next;
    old?.dispose();
    app.mapId = meta.id;
    // Effects were placed against the old terrain; they mean nothing on the new.
    cancelCharge();
    clearEffects();
    // The saved atmosphere belonged to the old map's scene setup.
    app.smokeBase = null;
    app.smokeOn = false;
    app.hud.setCurrentMap(meta.name);
  } finally {
    app.mapLoading = false;
    app.hud.hideMapLoad();
  }
}

// ------------------------------------------------------------------ welcome

async function onWelcome(m) {
  app.playing = false;
  app.myId = m.id;
  app.myTeam = m.team;
  app.loadout = { cls: m.cls, weapon: m.weapon, skin: m.skin || app.loadout.skin || '' };

  // The world must exist before anything can be positioned in it. Waiting here
  // is safe: state/me/spawn messages only touch the HUD and controls, and tick()
  // is gated on app.playing.
  await setMap(m.mapId || app.data.defaultMapId);

  app.cfg = m.cfg;
  const cls = app.data.classById[m.cls];
  app.controls.setClass(cls);
  app.controls.enabled = true;
  app.vm.setClass(cls);
  const firstWeapon = app.data.weaponById[m.weapon] || app.data.weaponsByClass[cls.id][0];
  app.vm.setWeapon(firstWeapon);
  app.vmCls = m.cls;
  app.vmWeapon = firstWeapon.id;
  app.hud.setTeamColors(m.team);
  app.hud.setLoadout(m.cls, m.weapon);
  app.hud.screen('game');
  app.hud.setLockHint(true);
  // every match starts in first person
  app.cameraMode = 'fp';

  app.controls.reset(m.spawn, m.yaw);
  app.controls.pos.set(m.spawn[0], m.spawn[1], m.spawn[2]);
  resetRemoteWorld();
  // Crates that were already standing when we joined arrive with the welcome,
  // so joining mid-round does not miss the medic's and support's boxes.
  for (const fx of m.fx || []) spawnEffect(fx);

  app.playing = true;
  app.last = performance.now();
  app.sfx.resume();
  if (m.botsOn) app.hud.toast('AI 机器人已加入战场', 2600);
  else app.hud.toast(`阵营：${app.data.teamById[m.team].name}`, 2600);
}

function resetRemoteWorld() {
  clearEffects();
  for (const g of app.remotes.values()) g.destroy();
  app.remotes.clear();
  if (app.self) { app.self.destroy(); app.self = null; }
  if (app.fpArms) { app.fpArms.holder.removeFromParent(); app.fpArms.destroy(); app.fpArms = null; }
}

// --------------------------------------------------------------- input wiring

function wireControls() {
  const c = app.controls;
  c.onFireDown = () => { app.clickPending = true; c.requestLock(); };
  c.onReload = () => { app.net?.reload(); };
  c.onAbilityDown = () => {
    if (!app.net || !app.playing) return;
    const me = app.net.lastMe;
    if (!me || !me.alive) return;
    const kind = app.data.classById[me.c].ability;
    // The lobbed abilities are charged on hold; the crates drop where you stand.
    if (kind === 'smoke' || kind === 'flare') beginCharge();
    else { app.sfx.ability(kind); app.net.ability(c.aim()); }
  };
  c.onAbilityUp = () => releaseCharge();
  c.onAbilityCancel = () => cancelCharge();
  c.onScoreboard = (show) => {
    if (!app.playing) return;
    app._sbOpen = show;
    const st = app.net?.lastState;
    if (!st) return;
    app.hud.scoreboard(show, st.ps, st, app.myId, app.myTeam);
  };
  c.onChat = () => {
    if (!app.playing) return;
    app.hud.chatOpen((text) => { app.net.chat(text); c.requestLock(); });
  };
  c.onViewToggle = () => {
    if (!app.playing) return;
    app.cameraMode = app.cameraMode === 'fp' ? 'tp' : 'fp';
    app.sfx.ui();
    app.hud.toast(app.cameraMode === 'tp' ? '第三人称视角' : '第一人称视角', 1200);
  };
  // Crouching and standing both click, matching the view toggle's feedback.
  c.onStance = () => app.sfx.ui();
  c.onLockChange = (locked) => {
    app.hud.setLockHint(app.playing && !locked);
  };
  document.getElementById('game').addEventListener('click', () => {
    if (app.playing) { app.sfx.resume(); app.controls.requestLock(); }
  });
}

// ---------------------------------------------------------------- net events

function onState(st) {
  app.hud.updateTopbar(st);

  // suppression is authored server-side on my own roster entry
  const mine = st.ps && st.ps.find((p) => p.i === app.myId);
  app.suppressed = !!(mine && mine.sp);
  app.hud.setSuppressed(app.suppressed);

  if (st.phase === 'ended') {
    if (!app.resultShown) {
      app.resultShown = true;
      app.hud.result(st, st.ps, app.myId);
      app.hud.scoreboard(false, [], st, app.myId, app.myTeam);
      app.controls.releaseLock();
    }
  } else if (app.resultShown) {
    app.resultShown = false;
    app.hud.hideResult();
  }

  if (app._sbOpen) app.hud.scoreboard(true, st.ps, st, app.myId, app.myTeam);
}

function onMe(me) {
  const data = app.data;
  app.hud.updateMe(me);
  app.hud.setLoadout(me.c, me.w);

  // Rebuild the viewmodel from what the server actually granted. Comparing with
  // app.loadout is not enough: doRespawn() writes it optimistically before the
  // server acknowledges, so the two already matched and this block was skipped —
  // the previous gun stayed on screen while the HUD named the new one.
  if (me.c !== app.vmCls || me.w !== app.vmWeapon) {
    app.vmCls = me.c;
    app.vmWeapon = me.w;
    app.boltWait = false;
    app.pendingBolt = null;
    app.controls.setClass(data.classById[me.c]);
    app.vm.setClass(data.classById[me.c]);
    app.vm.setWeapon(data.weaponById[me.w] || data.weaponsByClass[me.c][0]);
  }
  if (app.loadout.cls !== me.c || app.loadout.weapon !== me.w) {
    app.loadout = { ...app.loadout, cls: me.c, weapon: me.w };
  }

  if (!!me.reloading !== app.lastReloading) {
    app.lastReloading = !!me.reloading;
    if (me.reloading) app.vm.startReload(me.reloadTotal || data.weaponById[me.w].reloadMs);
  }

  const alive = !!me.alive;
  if (alive && !app.wasAlive) {
    app.hud.hideDeath();
    app.boltWait = false;
    app.pendingBolt = null;
    app.controls.requestLock();
  }
  app.wasAlive = alive;

  if (!alive) {
    if (!app.deathShown) {
      app.deathShown = true;
      app.hud.showDeath(app.killedBy?.name, app.killedBy?.weaponName, me.c, me.w);
      app.hud.setRespawnReady(Math.ceil(me.respawnIn / 1000), doRespawn);
      app.controls.releaseLock();
    } else {
      app.hud.setRespawnReady(Math.ceil(me.respawnIn / 1000), doRespawn);
    }
  } else {
    app.deathShown = false;
  }
}

function doRespawn() {
  const sel = app.hud.deathSelection;
  app.loadout = { ...app.loadout, ...sel };
  app.net.respawn(sel.cls, sel.weapon);
}

/**
 * Screen bearing of a world point as seen by the local player.
 * 0 = dead ahead, +90 = the player's right, 180 = behind: the same convention
 * conic-gradient uses, so it feeds the hit-direction overlay directly.
 */
function bearingTo(from) {
  const c = app.controls;
  const yaw = (c.yaw * Math.PI) / 180;
  // forward = (cos yaw, 0, sin yaw); screen-right = (-sin yaw, 0, cos yaw)
  const vx = from[0] - c.pos.x;
  const vz = from[2] - c.pos.z;
  const fwd = vx * Math.cos(yaw) + vz * Math.sin(yaw);
  const right = -vx * Math.sin(yaw) + vz * Math.cos(yaw);
  return (Math.atan2(right, fwd) * 180) / Math.PI;
}

async function onMessage(m) {
  const data = app.data;
  switch (m.t) {
    case 'hit': {
      if (m.r === 'deal') {
        app.hud.hitmarker(m.lethal);
        app.hud.damagePopup(m.dmg, m.zone, m.lethal);
        app.sfx.hit(m.zone === 'head');
      } else {
        app.hud.damage(m.dmg);
        // the server tells us where the shot or blast came from, so the red
        // wedge can point back at it instead of just flashing everywhere
        if (Array.isArray(m.p)) app.hud.damageDirection(bearingTo(m.p));
        app.sfx.hurt(m.dmg);
        if (m.zone === 'blast') app.hud.toast('遭受爆炸冲击', 1200);
      }
      break;
    }
    case 'kill': {
      app.hud.addKill(m.k, m.v, m.w, m.head, app.myId);
      if (m.v.id === app.myId) {
        app.killedBy = { name: m.k.n, weaponName: data.weaponById[m.w]?.name };
        app.sfx.death();
      } else if (m.k.id === app.myId) {
        app.sfx.kill();
        app.hud.toast(m.head ? '爆头击杀！' : '击杀 +1', 1100);
      }
      break;
    }
    case 'spawn': {
      app.controls.reset(m.p, m.yaw);
      app.hud.hideDeath();
      app.deathShown = false;
      app.sfx.spawn();
      break;
    }
    case 'fx':
      spawnEffect(m.fx);
      break;
    case 'chat':
      app.hud.chatLine(m.n, m.tm, m.m);
      break;
    case 'map': {
      // Broadcast between rounds: rebuild the scene, then let the spawn messages
      // that follow (one per player) place everyone on the new ground.
      await setMap(m.id);
      if (Array.isArray(m.spawn)) app.controls.reset(m.spawn, m.yaw);
      app.hud.toast(`地图切换：${m.name}`, 2600);
      break;
    }
    case 'full':
      app.hud.menuError('服务器已满');
      break;
  }
}

// ------------------------------------------------------------------ effects

// Per-ability presentation. Smoke is a cloud of soft sprites, the medic/support
// crates are solid boxes that stand until the server says otherwise, and the
// scout's flare is a glowing ball of light.
const FX_STYLES = {
  smoke: { kind: 'cloud', proj: 0x9aa4ad },
  heal: { kind: 'crate' },
  ammo: { kind: 'crate' },
  flare: { kind: 'sphere', color: 0xff5a5a, grow: 0.2, proj: 0xff6a4a, lit: true },
};

// The shell a thrown ability spends its flight as. One shared geometry (never
// disposed) with a per-throw material, like the tracers.
const projGeo = new THREE.SphereGeometry(0.09, 8, 6);

/** Soft round puff shared by every smoke sprite; built once, reused everywhere. */
let _smokeTex = null;
function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 3, 64, 64, 62);
  rg.addColorStop(0, 'rgba(233,237,241,0.92)');
  rg.addColorStop(0.5, 'rgba(206,213,220,0.55)');
  rg.addColorStop(1, 'rgba(188,196,204,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  _smokeTex = new THREE.CanvasTexture(c);
  _smokeTex.colorSpace = THREE.SRGBColorSpace;
  return _smokeTex;
}

/** A dozen-odd sprites scattered through a squat cylinder: a cloud, not a ball. */
function buildSmoke(fx) {
  const grp = new THREE.Group();
  grp.position.set(fx.p[0], fx.p[1], fx.p[2]);
  const r = fx.r || 5.5;
  const puffs = [];
  for (let i = 0; i < 20; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTexture(), color: 0xd8dee4, transparent: true, depthWrite: false, opacity: 0,
    }));
    const a = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * r * 0.62;
    const y = 0.4 + Math.random() * r * 0.85;
    sprite.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
    const sc = r * (0.6 + Math.random() * 0.55);
    sprite.scale.set(sc, sc, 1);
    grp.add(sprite);
    puffs.push({ sprite, spin: (Math.random() - 0.5) * 0.5, bob: Math.random() * 6.28, baseY: y });
  }
  return { obj: grp, puffs };
}

/** Medic/support crate: a solid box plus a ground ring showing the area it covers. */
function buildCrate(fx) {
  const team = app.data.teamById[fx.team] || app.data.teamById[0];
  const heal = fx.k === 'heal';
  const grp = new THREE.Group();
  grp.position.set(fx.p[0], fx.p[1], fx.p[2]);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.40, 0.44),
    flatMat(heal ? 0xeef2f5 : 0x8d7343),
  );
  body.position.y = 0.20;
  grp.add(body);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.48), flatMat(heal ? 0xc9d2d9 : 0x6f5a34));
  lid.position.y = 0.43;
  grp.add(lid);

  if (heal) {
    // a red cross laid flat on the lid -- the universal "come here" sign
    const crossMat = flatMat(0xd6483f);
    for (const [w, d] of [[0.34, 0.10], [0.10, 0.34]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), crossMat);
      arm.position.y = 0.47;
      grp.add(arm);
    }
  } else {
    // team-coloured straps, so friendly and enemy crates read apart at a glance
    for (const z of [-0.13, 0.13]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.09), flatMat(team.color));
      strap.position.set(0, 0.47, z);
      grp.add(strap);
    }
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(1, fx.r * 0.94), fx.r, 40),
    new THREE.MeshBasicMaterial({
      color: heal ? 0x86f5a0 : team.color, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  grp.add(ring);
  return { obj: grp, puffs: null, ring };
}

function spawnEffect(fx) {
  if (fx.k === 'remove') {
    removeEffect(fx.eid);
    return;
  }
  const style = FX_STYLES[fx.k];
  if (!style) return;

  const now = performance.now();
  const rec = {
    eid: fx.eid, start: now, dur: Math.max(300, fx.dur || 700),
    persist: !!fx.persist, style,
  };

  if (style.kind === 'cloud') {
    Object.assign(rec, buildSmoke(fx));
    // kept so the veil can tell whether the camera is standing in this cloud
    rec.r = fx.r || 0;
  } else if (style.kind === 'crate') {
    Object.assign(rec, buildCrate(fx));
  } else {
    const mat = new THREE.MeshBasicMaterial({
      color: style.color, transparent: true, opacity: 0.62,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), mat);
    mesh.position.set(fx.p[0], fx.p[1], fx.p[2]);
    const light = new THREE.PointLight(style.color, 26, 26, 2);
    light.position.copy(mesh.position);
    app.fxGroup.add(light);
    rec.obj = mesh;
    rec.light = light;
  }
  app.fxGroup.add(rec.obj);

  // A thrown ability spends its first `delay` ms in the air: a small shell flies
  // the same arc the thrower's preview drew, and the cloud/flare only appears
  // where it lands.
  const flyMs = fx.from && fx.delay > 0 ? fx.delay : 0;
  if (flyMs > 0) {
    const from = new THREE.Vector3(fx.from[0], fx.from[1], fx.from[2]);
    const to = new THREE.Vector3(fx.p[0], fx.p[1], fx.p[2]);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const apex = dist * (app.data.combat.throw?.apexPerM ?? 0.26);
    rec.flyMs = flyMs;
    rec.flyStart = now;
    rec.flyFrom = from;
    rec.flyTo = to;
    rec.flyCtrl = throwCurve(from, to, apex);
    rec.proj = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: style.proj ?? 0xdddddd }));
    rec.proj.position.copy(from);
    app.fxGroup.add(rec.proj);
    if (style.lit) {
      rec.projLight = new THREE.PointLight(style.proj ?? 0xff6a4a, 18, 16, 2);
      rec.projLight.position.copy(from);
      app.fxGroup.add(rec.projLight);
    }
    rec.obj.visible = false;
    rec.start = now + flyMs;
  }
  app.effects.push(rec);
}

function disposeEffect(e) {
  e.obj?.removeFromParent();
  // three.js shares one geometry between all Sprites, so only meshes own theirs.
  e.obj?.traverse?.((o) => {
    if (o.isMesh && o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.dispose();
    }
  });
  e.light?.removeFromParent();
  // The shell shares projGeo with every other throw, so only its material goes.
  e.proj?.removeFromParent();
  e.proj?.material.dispose();
  e.projLight?.removeFromParent();
}

/** Take down one effect by id: how a replaced crate is retired. */
function removeEffect(eid) {
  const i = app.effects.findIndex((e) => e.eid === eid);
  if (i >= 0) {
    disposeEffect(app.effects[i]);
    app.effects.splice(i, 1);
  }
}

/** Drop every live effect, e.g. when the whole map is swapped between rounds. */
function clearEffects() {
  for (const e of app.effects) disposeEffect(e);
  app.effects.length = 0;
}

function updateEffects(now) {
  for (let i = app.effects.length - 1; i >= 0; i--) {
    const e = app.effects[i];
    // Flight first: while the shell is in the air its payload stays hidden and
    // the effect's own clock has not started yet.
    if (e.flyMs && !e.landed) {
      const f = (now - e.flyStart) / e.flyMs;
      if (f < 1) {
        bezierPoint(e.flyFrom, e.flyCtrl, e.flyTo, Math.max(0, f), e.proj.position);
        e.projLight?.position.copy(e.proj.position);
        continue;
      }
      e.landed = true;
      e.proj.visible = false;
      if (e.projLight) e.projLight.visible = false;
      e.obj.visible = true;
      e.start = now;
    }
    const k = (now - e.start) / e.dur;
    if (!e.persist && k >= 1) {
      disposeEffect(e);
      app.effects.splice(i, 1);
      continue;
    }
    if (e.puffs) {
      // fade in over the first eighth, hold, then thin out over the last fifth
      const op = 0.66 * Math.min(1, k / 0.12) * (k > 0.8 ? Math.max(0, 1 - (k - 0.8) / 0.2) : 1);
      for (const pf of e.puffs) {
        pf.sprite.material.opacity = op;
        pf.sprite.material.rotation += pf.spin * 0.004;
        pf.sprite.position.y = pf.baseY + Math.sin(now * 0.0004 + pf.bob) * 0.3;
      }
    } else if (e.style.kind === 'sphere') {
      const s = 1 + e.style.grow * k * 8;
      e.obj.scale.setScalar(s);
      e.obj.material.opacity = 0.7 * (1 - k);
      if (e.light) e.light.intensity *= 0.94;
    } else if (e.ring) {
      e.ring.material.opacity = 0.34 + 0.10 * Math.sin(now * 0.002);
    }
  }
}

// ------------------------------------------------------------ smoke vision

// A smoke screen has to actually cut vision down to a few metres, so this is a
// real world-space effect rather than a tint over the screen: the map's distance
// fog is swapped for a thick one, which turns everything past SMOKE_FAR into
// smoke and leaves nothing specially clear around the crosshair. The sky dome
// (built with fog off) and the flat background fade to the same grey, else the
// horizon would give the cloud away. Every value is blended by how deep into the
// cloud the camera stands, so walking in and out is gradual.
//
// The fog stays a linear THREE.Fog on purpose: matching the map's fog type keeps
// three.js from recompiling every material in the scene the first time a player
// steps into smoke.
const SMOKE_TINT = new THREE.Color(0xd8dee4);
const SMOKE_NEAR = 0.6;
const SMOKE_FAR = 5.5;
const SMOKE_EDGE = 0.25;

function updateSmokeVision() {
  const world = app.world;
  if (!world?.scene) return;

  let deep = 0;
  if (app.playing) {
    const eye = app.camera.position;
    for (const e of app.effects) {
      // Smoke only, and only once the shell has landed -- a cloud in flight has
      // no volume yet.
      if (!e.puffs || (e.flyMs && !e.landed) || e.r <= 0) continue;
      const d = eye.distanceTo(e.obj.position);
      if (d >= e.r) continue;
      const k = Math.min(1, (e.r - d) / (e.r * SMOKE_EDGE));
      if (k > deep) deep = k;
    }
  }
  if (deep <= 0 && !app.smokeOn) return;
  // Thicken early: the last metre inside the boundary should already read as smoke.
  const k = Math.sqrt(deep);

  if (!app.smokeBase) {
    // Snapshot the map's own atmosphere once, so leaving smoke restores it exactly.
    const f = world.scene.fog;
    const bg = world.scene.background;
    app.smokeBase = {
      fogColor: f ? f.color.getHex() : null, fogNear: f ? f.near : 0, fogFar: f ? f.far : 0,
      bg: bg?.isColor ? bg.getHex() : null,
      skyTransparent: world.sky ? world.sky.material.transparent : false,
    };
    app.smokeFog = new THREE.Fog(SMOKE_TINT.getHex(), SMOKE_NEAR, SMOKE_FAR);
  }
  const base = app.smokeBase;

  if (deep <= 0) {
    const f = world.scene.fog;
    if (base.fogColor == null) world.scene.fog = null;
    else if (f) { f.color.setHex(base.fogColor); f.near = base.fogNear; f.far = base.fogFar; }
    else world.scene.fog = new THREE.Fog(base.fogColor, base.fogNear, base.fogFar);
    if (base.bg != null && world.scene.background?.isColor) world.scene.background.setHex(base.bg);
    if (world.sky) { world.sky.material.transparent = base.skyTransparent; world.sky.material.opacity = 1; }
    app.smokeOn = false;
    return;
  }

  const fog = app.smokeFog;
  fog.color.setHex(base.fogColor ?? SMOKE_TINT.getHex()).lerp(SMOKE_TINT, k);
  fog.near = base.fogNear + (SMOKE_NEAR - base.fogNear) * k;
  fog.far = base.fogFar + (SMOKE_FAR - base.fogFar) * k;
  world.scene.fog = fog;
  if (base.bg != null && world.scene.background?.isColor) {
    world.scene.background.setHex(base.bg).lerp(SMOKE_TINT, k);
  }
  if (world.sky) {
    world.sky.material.transparent = true;
    world.sky.material.opacity = 1 - k;
  }
  app.smokeOn = true;
}

// ------------------------------------------------------- thrown ability aiming

// Smoke and flare are lobbed, not placed: holding Q charges the throw and draws
// the arc it will follow, so the landing spot is picked before the key is let go.
// The arc is a quadratic Bezier whose crest scales with the throw's range, and it
// is cut short at the first thing it meets -- ground or cover. The server is sent
// the crest's landing point, so the marker and the real impact always agree.

/** Control point that lifts a Bezier's crest `apex` above the O-L chord. */
function throwCurve(origin, end, apex) {
  return new THREE.Vector3(
    (origin.x + end.x) * 0.5,
    (origin.y + end.y) * 0.5 + apex * 2,
    (origin.z + end.z) * 0.5,
  );
}

function bezierPoint(o, c, l, s, out) {
  const u = 1 - s;
  const a = u * u, b = 2 * u * s, d = s * s;
  return out.set(
    a * o.x + b * c.x + d * l.x,
    a * o.y + b * c.y + d * l.y,
    a * o.z + b * c.z + d * l.z,
  );
}

/** March the arc to the first surface it meets; returns the polyline + impact. */
function traceThrow(origin, dir, dist) {
  const cfg = app.data.combat.throw;
  const hl = Math.hypot(dir.x, dir.z) || 1e-6;
  const end = new THREE.Vector3(origin.x + (dir.x / hl) * dist, origin.y,
    origin.z + (dir.z / hl) * dist);
  let ctrl = throwCurve(origin, end, dist * cfg.apexPerM);
  const scratch = new THREE.Vector3();
  const prev = origin.clone();
  const impact = end.clone();
  const N = 56;
  for (let i = 1; i <= N; i++) {
    bezierPoint(origin, ctrl, end, i / N, scratch);
    const floor = app.world.floorAt(scratch.x, scratch.z, scratch.y);
    if (scratch.y <= floor + 0.05) { impact.set(scratch.x, floor, scratch.z); break; }
    if (app.world.blocked(scratch.x, scratch.z, scratch.y, 0.12)) { impact.copy(prev); break; }
    prev.copy(scratch);
  }
  // The server pulls the landing back inside the map, so mirror that here: a
  // flare's long reach must still mark the point it really comes down on.
  const b = app.world.bounds;
  impact.x = Math.min(Math.max(impact.x, b.minX + 1), b.maxX - 1);
  impact.z = Math.min(Math.max(impact.z, b.minZ + 1), b.maxZ - 1);
  impact.y = app.world.floorAt(impact.x, impact.z, impact.y);
  // Redraw ending exactly on the impact so the dotted line touches the marker.
  const realDist = Math.hypot(impact.x - origin.x, impact.z - origin.z);
  ctrl = throwCurve(origin, impact, realDist * cfg.apexPerM);
  const points = [];
  for (let i = 0; i <= 24; i++) {
    points.push(bezierPoint(origin, ctrl, impact, i / 24, new THREE.Vector3()));
  }
  return { points, impact };
}

let _arcLine = null;
let _arcRing = null;

function ensureArc() {
  if (_arcLine) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
  _arcLine = new THREE.Line(geo, new THREE.LineDashedMaterial({
    color: 0xffe08a, dashSize: 0.34, gapSize: 0.22, transparent: true, opacity: 0.9,
    depthWrite: false,
  }));
  _arcLine.frustumCulled = false;
  _arcLine.visible = false;
  _arcRing = new THREE.Mesh(
    new THREE.RingGeometry(0.30, 0.42, 26),
    new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  _arcRing.rotation.x = -Math.PI / 2;
  _arcRing.visible = false;
  app.fxGroup.add(_arcLine, _arcRing);
}

function hideArc() {
  if (_arcLine) _arcLine.visible = false;
  if (_arcRing) _arcRing.visible = false;
  app.hud.setAbilityCharge(null);
}

/** Range the throw would reach at this charge, and the point it lands on. */
function aimThrow(power, kind) {
  const cfg = app.data.combat.throw;
  const origin = app.controls.eye();
  const dir = app.controls.aim();
  // A flare is lobbed far further than a smoke grenade, so the reach is per-kind.
  const maxDist = kind === 'flare' ? cfg.flareMaxDist : cfg.smokeMaxDist;
  const dist = cfg.minDist + (maxDist - cfg.minDist) * power;
  return traceThrow(origin, dir, dist);
}

function beginCharge() {
  if (!app.playing || !app.world) return;
  const me = app.net?.lastMe;
  if (!me || !me.alive) return;
  if (me.abilityIn > 0) return;      // still cooling down
  app.charge = { t0: performance.now() };
}

function releaseCharge() {
  const charge = app.charge;
  if (!charge) return;
  cancelCharge();
  if (!app.playing || !app.world) return;
  const me = app.net?.lastMe;
  if (!me || !me.alive) return;
  const cfg = app.data.combat.throw;
  const kind = app.data.classById[me.c].ability;
  const power = Math.min(1, (performance.now() - charge.t0) / cfg.chargeMs);
  const { impact } = aimThrow(power, kind);
  app.sfx.ability(kind);
  app.throwAt = performance.now();
  app.net.ability(app.controls.aim(), impact);
}

function cancelCharge() {
  app.charge = null;
  hideArc();
}

/** Runs every frame in the loop: draws the arc while Q is held. */
function updateThrowAim(now) {
  if (!app.charge) return;
  const me = app.net?.lastMe;
  if (!app.playing || !app.world || !me || !me.alive) { cancelCharge(); return; }
  const cfg = app.data.combat.throw;
  const kind = app.data.classById[me.c].ability;
  const power = Math.min(1, (now - app.charge.t0) / cfg.chargeMs);
  const { points, impact } = aimThrow(power, kind);
  ensureArc();
  const arr = _arcLine.geometry.attributes.position.array;
  for (let i = 0; i < points.length; i++) {
    arr[i * 3] = points[i].x;
    arr[i * 3 + 1] = points[i].y;
    arr[i * 3 + 2] = points[i].z;
  }
  _arcLine.geometry.attributes.position.needsUpdate = true;
  _arcLine.geometry.setDrawRange(0, points.length);
  _arcLine.computeLineDistances();
  _arcLine.visible = true;
  _arcRing.position.set(impact.x, impact.y + 0.03, impact.z);
  _arcRing.visible = true;
  app.hud.setAbilityCharge(power);
}

// ------------------------------------------------------------------ tracers

const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
tracerGeo.rotateX(Math.PI / 2);

function spawnTracer(from, to, color) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 0.4) return;
  const mat = flatMat(color, { transparent: true, opacity: 0.85, depthWrite: false });
  const mesh = new THREE.Mesh(tracerGeo, mat);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
  mesh.scale.set(1, 1, len);
  app.fxGroup.add(mesh);
  app.tracers.push({ mesh, start: performance.now(), dur: 70 });
}

function updateTracers(now) {
  for (let i = app.tracers.length - 1; i >= 0; i--) {
    const t = app.tracers[i];
    const k = (now - t.start) / t.dur;
    if (k >= 1) {
      t.mesh.removeFromParent();
      t.mesh.material.dispose();
      app.tracers.splice(i, 1);
    } else {
      t.mesh.material.opacity = 0.85 * (1 - k);
    }
  }
}

/** Nearest solid hit along a ray, using the same boxes the server collides against. */
function rayEnd(origin, dir, maxT = 140) {
  let best = maxT;
  const boxes = app.world.solid;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const lo = [b.x - b.w * 0.5, b.y - b.h * 0.5, b.z - b.d * 0.5];
    const hi = [b.x + b.w * 0.5, b.y + b.h * 0.5, b.z + b.d * 0.5];
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    let tmin = 0, tmax = best, hit = true;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-8) {
        if (o[a] < lo[a] || o[a] > hi[a]) { hit = false; break; }
      } else {
        let t1 = (lo[a] - o[a]) / d[a];
        let t2 = (hi[a] - o[a]) / d[a];
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit && tmin > 0.05 && tmin < best) best = tmin;
  }
  return origin.clone().addScaledVector(dir, best);
}

// ---------------------------------------------------------------- game loop

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, app.last ? (now - app.last) / 1000 : 0.016);
  app.last = now;
  if (app.playing) tick(dt, now);
  updateTracers(now);
  updateThrowAim(now);
  updateEffects(now);
  updateSmokeVision();
  if (app.settings?.visible) app.settings.render(dt);
  app.renderer.render(app.scene, app.camera);
}

function tick(dt, now) {
  const me = app.net.lastMe;
  const alive = me ? !!me.alive : true;
  const suppressed = app.suppressed;

  app.controls.update(dt, alive, suppressed);

  syncSelfAvatar(dt, alive);

  // Camera follows the client-authoritative position. Third person only moves
  // the eye, never the aim ray, so shooting and the server stay unchanged.
  const eye = app.controls.eye();
  const dir = app.controls.aim();
  const tp = app.cameraMode === 'tp';
  if (tp) {
    const back = 3.1, up = 0.45;
    app.camera.position.set(
      eye.x - dir.x * back,
      Math.max(app.world.groundY + 0.45, eye.y + up - dir.y * back),
      eye.z - dir.z * back,
    );
    // look straight along `dir`, so the crosshair still marks the true aim ray
    app.camera.lookAt(
      app.camera.position.x + dir.x,
      app.camera.position.y + dir.y,
      app.camera.position.z + dir.z,
    );
  } else {
    app.camera.position.copy(eye);
    app.camera.lookAt(eye.x + dir.x, eye.y + dir.y, eye.z + dir.z);
  }
  // in third person the character body replaces the viewmodel
  app.vm.root.visible = !tp;
  app.camera.fov = THREE.MathUtils.lerp(app.camera.fov, aimFov(me), Math.min(1, dt * 12));
  // First person borrows the character's own arms, and that model sits at the
  // lens: the deeper near plane is what strips away the head, hair and chest
  // that would otherwise fill the screen, leaving only the arms reaching in.
  app.camera.near = tp ? 0.06 : FP_NEAR;
  app.camera.updateProjectionMatrix();

  // 30 Hz input upload
  app.inputAcc += dt;
  if (app.inputAcc >= 1 / 30) {
    app.inputAcc = 0;
    app.net.input(app.controls.pos, app.controls.yaw, app.controls.pitch, {
      crouch: app.controls.crouch,
      move: app.controls.moveSpeed > 0.5,
      ground: app.controls.grounded,
    });
  }

  // firing — the rate here is a courtesy; the server is the real gate
  const w = app.data.weaponById[me?.w || app.loadout.weapon];

  // bolt rifles (every one except the straight-pull M95) only chamber the next
  // round after the player has come out of the sights and released the aim
  // button; the M95 works the bolt while still scoped
  if (app.boltWait && !app.controls.mouse.right) app.boltWait = false;
  // Scoped bolt shot: the cycle sound plays the moment the sights come off.
  if (app.pendingBolt && !app.controls.mouse.right) {
    app.sfx.bolt(app.pendingBolt);
    app.pendingBolt = null;
  }

  const wantShot = w.auto ? app.controls.mouse.left : (app.clickPending && app.controls.mouse.left);
  if (alive && wantShot && !app.boltWait && app.controls.locked && now >= app.nextShot) {
    if (me && me.mag <= 0) {
      // Dry magazines only reload when there is spare ammo left to draw on.
      if (me.reserve > 0) app.net.reload();
      app.sfx.empty();
    } else {
      app.nextShot = now + (60000 / w.rpm);
      fireOnce(w, eye, dir);
      if (w.shape === 'bolt' && !w.straightPull) app.boltWait = true;
    }
  }
  app.clickPending = false;

  // footstep audio
  if (alive && app.controls.grounded && app.controls.moveSpeed > 1.2) {
    app.stepDist += app.controls.moveSpeed * dt;
    if (app.stepDist > 2.0) { app.stepDist = 0; app.sfx.step(); }
  }

  updateRemotePlayers(dt, me);
  app.vm.update(dt, {
    ads: app.controls.ads,
    sprinting: false,
    moveSpeed: app.controls.moveSpeed,
  });
  syncFpArms();

  updateCrosshair(w, suppressed);
  app.hud.setLockHint(app.playing && !app.controls.locked && alive && !app.deathShown);
}

function aimFov(me) {
  const w = app.data.weaponById[me?.w || app.loadout.weapon];
  const base = 78;
  return app.controls.ads ? w.zoomFov : base;
}

function fireOnce(w, eye, dir) {
  app.net.fire(eye, dir);
  app.fireAt = performance.now();
  const kick = w.shape === 'bolt' ? 1.35 : w.shape === 'lmg' ? 0.7 : 0.85;
  app.vm.kick(kick);
  if (w.shape === 'bolt') app.vm.cycleBolt(w.straightPull ? 520 : 700);
  app.sfx.shot(w);
  if (w.shape === 'bolt' && !w.straightPull) {
    // The bolt is worked a beat after the shot -- or, while scoped, exactly when
    // the player drops out of the sights, which is when the cycle really happens.
    if (app.controls.mouse.right) app.pendingBolt = w;
    else setTimeout(() => app.sfx.bolt(w), BOLT_SOUND_DELAY_MS);
  }

  const end = rayEnd(eye, dir);
  // Third person plays the trail against the player's own body, so it has to
  // leave from the middle of the chest. The viewmodel muzzle hangs off the
  // camera, which in third person sits several metres behind the avatar, so
  // using it there would start the trail out behind the character. First person
  // keeps the muzzle -- the gun is right on screen and that is where the round
  // actually leaves.
  const from = new THREE.Vector3();
  if (app.cameraMode === 'tp') {
    const c = app.controls;
    from.set(c.pos.x, c.pos.y + c.bodyHeight * 0.72, c.pos.z);
  } else {
    const muzzle = new THREE.Vector3();
    if (app.vm.muzzle) app.vm.muzzle.getWorldPosition(muzzle);
    else muzzle.copy(eye);
    from.copy(muzzle.distanceTo(eye) < 3 ? muzzle : eye);
  }
  spawnTracer(from, end, 0xffe6a0);
}

function updateCrosshair(w, suppressed) {
  const move = app.controls.moveSpeed / (app.controls.combat.maxMoveSpeed || 9.5);
  const spread = w.spreadDeg * 7.0 + move * 11 + (app.controls.grounded ? 0 : 7) + (suppressed ? 9 : 0);
  const adsFactor = app.controls.ads ? 0.25 : 1;
  app.hud.crosshair(Math.max(3, spread * adsFactor));
  app.hud.el.crosshair.style.opacity = app.controls.ads ? '0.35' : '1';
}

/**
 * The local player's own avatar. It exists only so third person has a body to
 * show — first person draws the viewmodel instead. Mirrors
 * updateRemotePlayers, but reads the client-authoritative controls directly
 * rather than an interpolated server pose, so it never lags the input.
 */
function syncSelfAvatar(dt, alive) {
  if (!app.playing) {
    if (app.self) app.self.root.visible = false;
    return;
  }

  const cls = app.data.classById[app.loadout.cls];
  const skinId = app.loadout.skin || DEFAULT_CLASS_SKIN[cls.id] || '';
  const renderKey = `${cls.id}|${skinId}|${skinId && app.charTemplates.has(skinId) ? 'ext' : 'builtin'}`;
  if (app.self && app.self.renderKey !== renderKey) {
    app.self.destroy();
    app.self = null;
  }
  if (!app.self) {
    app.self = makeRemoteGirl(cls, app.data.teamById[app.myTeam], skinId);
    app.self.renderKey = renderKey;
    app.self.marker.visible = false;   // never mark the player for themselves
    app.scene.add(app.self.root);
  }

  const c = app.controls;
  app.self.setWeapon(app.data.weaponById[app.loadout.weapon] || app.data.weaponsByClass[cls.id][0]);
  app.self.setAlive(alive);
  app.self.root.visible = alive && app.cameraMode === 'tp';
  app.self.root.position.copy(c.pos);
  app.self.root.rotation.y = yawToRotation(c.yaw);
  // Upper-body layer state. The server only tells us about reloads; firing and
  // the throw are local, so they are timed off the wall clock here. Each pose is
  // held for a short window after the input ends so the clip can finish rather
  // than snapping back mid-gesture.
  const me = app.net.lastMe;
  const tnow = performance.now();
  app.self.update(dt, {
    speed: c.moveSpeed,
    sprint: false,
    crouch: c.crouch,
    pitch: c.pitch,
    reloading: !!(me && me.reloading),
    firing: alive && tnow - app.fireAt < 150,
    ability: alive && (!!app.charge || tnow - app.throwAt < 700),
  });
}

// ------------------------------------------------------ first-person arms
//
// The first-person arms are the player's own character model. A second instance
// of the same rig is parked under the camera with its eye at the lens, facing
// the same way, and both arms are solved onto the viewmodel's hand anchors every
// frame. The head, chest and legs end up behind the lens or inside the near
// plane, so only the arms reach into frame — the weapon stays the viewmodel's,
// which is why ADS, recoil, reload and bob keep working untouched.
const FP_EYE = 1.58;    // model eye height, matches combat.standEyeHeight
const FP_NEAR = 0.20;   // clips the body the borrowed arms are mounted on

const _fpHand = new THREE.Vector3();
const _fpFore = new THREE.Vector3();

function syncFpArms() {
  if (!app.playing) return;

  const cls = app.data.classById[app.loadout.cls];
  const skinId = app.loadout.skin || DEFAULT_CLASS_SKIN[cls.id] || '';
  const useExt = !!skinId && app.charTemplates.has(skinId);
  const key = useExt ? `${cls.id}|${skinId}` : '';

  if (app.fpArms && app.fpArms.key !== key) {
    app.fpArms.holder.removeFromParent();
    app.fpArms.destroy();
    app.fpArms = null;
  }
  if (!useExt) {
    if (app.vm.armMeshes) app.vm.armMeshes.visible = true;
    return;
  }

  if (!app.fpArms) {
    const girl = makeRemoteGirl(cls, app.data.teamById[app.myTeam], skinId);
    girl.marker.visible = false;
    girl.shadow.visible = false;
    const holder = new THREE.Group();
    // The body is buried behind the near plane with only the arms reaching into
    // view, so its exact spot is free: nudged forward and toward the gun side it
    // puts the shoulders within the borrowed (short) arms' reach of the grip,
    // which the hip-fire gun — held a forearm's length out — otherwise exceeds.
    holder.position.set(0.03, -FP_EYE, -0.18);
    holder.rotation.y = Math.PI;        // the model faces +Z, the lens faces -Z
    holder.add(girl.root);
    app.vm.root.add(holder);
    // The rig sits with its head at the lens; collapsing the head subtree is what
    // keeps hair and — on a hat-wearing rig like the support class's — the whole
    // brim from hanging across the sight line just past the near plane.
    if (girl.setHeadHidden) girl.setHeadHidden(true);
    girl.key = key;
    girl.holder = holder;
    app.fpArms = girl;
  }

  // the gear is drawn by the viewmodel; only hide the placeholder pair here
  if (app.cameraMode !== 'fp') {
    if (app.vm.armMeshes) app.vm.armMeshes.visible = true;
    return;
  }

  // camera first: the viewmodel hangs off it, so its world matrices must be
  // current before the two anchors can be read out
  app.camera.updateMatrixWorld(true);
  let ok = false;
  if (app.vm.gripWorld(_fpHand, _fpFore)) {
    ok = app.fpArms.poseArms(_fpHand, _fpFore);
  }
  // a rig with no mapped arms cannot be posed — keep the placeholder pair
  if (app.vm.armMeshes) app.vm.armMeshes.visible = !ok;
}

function updateRemotePlayers(dt, me) {
  const poses = app.net.sample();
  const seen = new Set();

  for (const [id, p] of poses) {
    if (id === app.myId) continue;
    seen.add(id);
    const cls = app.data.classById[p.cls] || app.data.classById.assault;
    const skinId = p.skin || DEFAULT_CLASS_SKIN[p.cls] || '';
    // external rigs swap in only once their template has finished downloading,
    // so the render key encodes both the skin and which of the two we can use
    const renderKey = `${p.cls}|${skinId}|${skinId && app.charTemplates.has(skinId) ? 'ext' : 'builtin'}`;
    let girl = app.remotes.get(id);

    if (girl && girl.renderKey !== renderKey) {
      girl.destroy();
      app.remotes.delete(id);
      girl = null;
    }
    if (!girl) {
      girl = makeRemoteGirl(cls, app.data.teamById[p.team], skinId);
      girl.renderKey = renderKey;
      girl.clsId = p.cls;
      girl.root.position.set(p.x, p.y, p.z);
      app.scene.add(girl.root);
      app.remotes.set(id, girl);
    }
    girl.setWeapon(app.data.weaponById[p.weapon] || app.data.weaponsByClass[cls.id][0]);
    girl.setAlive(!!p.alive);
    girl.marker.visible = true;
    girl.marker.material.color.set(p.team === app.myTeam ? 0x3ddc6a : 0xff3b30);

    // A flare marks enemies for the whole enemy team: the marker blinks and
    // ignores the depth buffer, so it reads through walls until they leave the
    // circle or duck into smoke. Teammates are never x-rayed.
    const marked = p.team !== app.myTeam && !!p.reveal;
    girl.marker.material.depthTest = !marked;
    girl.marker.renderOrder = marked ? 999 : 0;
    if (marked) {
      const blink = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() * 0.008));
      girl.marker.material.opacity = 0.35 + 0.65 * blink;
      girl.marker.scale.setScalar(1 + 0.4 * blink);
    } else {
      girl.marker.material.opacity = 0.9;
      girl.marker.scale.setScalar(1);
    }

    if (p.alive) {
      girl.root.position.set(p.x, p.y, p.z);
      girl.root.rotation.y = yawToRotation(p.yaw);
      girl.update(dt, {
        speed: p.speed,
        sprint: (p.flags & 2) !== 0,
        crouch: (p.flags & 1) !== 0,
        pitch: p.pitch,
      });
    }
  }

  for (const [id, girl] of app.remotes) {
    if (!seen.has(id)) { girl.destroy(); app.remotes.delete(id); }
  }
}

boot();
