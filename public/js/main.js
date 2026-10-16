// Entry point: menu -> class select -> live match.
//
// Responsibilities are intentionally narrow here. Movement lives in
// controls.js, remote pose reconstruction in net.js, all 3D construction in
// character.js/map.js/viewmodel.js. main.js only sequences them and owns the
// match-level event handling.

import * as THREE from 'three';
import { loadConfig } from './config.js';
import { World } from './map.js';
import { ObjectivesView } from './objectives.js';
import { updateContactShadow } from './lighting.js';
import { rayWorld, safeMuzzle, clipTracer } from './ballistics.js';
import { AdaptiveResolution, poseInterval } from './performance.js';
import { resolveCamera } from './camera-collision.js';
import { createGirl, yawToRotation } from './character.js';
import { ViewModel } from './viewmodel.js';
import { buildSmokeCloud, updateSmokeCloud } from './smoke.js';
import { simulateThrow, sampleThrow } from './throwing.js';
import { buildGrenadeEffect, updateGrenadeEffect } from './grenadefx.js';
import { GunFx, gunStyle, tracerRound, remoteShotDue } from './gunfx.js';
import { Controls } from './controls.js';
import { updateSpawnShield } from './spawn-shield.js';
import { MobileControls } from './mobile-controls.js';
import { requestMobileFullscreen } from './mobile-fullscreen.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Net } from './net.js';
import { LocalNet } from './local.js';
import { RelayNet, RelayHostNet, RelayLobby, createRoomCode } from './relay.js';
import { drawPortrait } from './face.js';
import { flatMat } from './toon.js';
import { store, session } from './storage.js';
import * as profile from './profile.js';
import { Tutorial } from './tutorial.js';
import { Peer, parseCode, setStun, getStun } from './p2p.js';
import { openRoomChannel } from './relay.js';
import { setApiBase, apiUrl } from './api.js';
import { t, nameOf, getLang, setLang, onLangChange } from './i18n.js';
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
  // Rounds fired per weapon, this session: per-gun tracer cadence needs a count
  // ("every third round"), and it is also what keeps the count off the HUD.
  shotRounds: {},
  // How many tracers actually left a barrel (a tracer only shows every `every`
  // rounds), which is what the per-gun cadence is judged on.
  tracerStats: { spawned: 0 },
  effects: [],
  // {t0, source, kind} while Q/G is charging; null otherwise
  charge: null,
  grenadeKind: 'frag',
  flash: null,
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
  mobile: null,
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
  // What this origin turned out to be, filled in by the health probe in
  // setupServerAddress(): `backendHere` is a real game server behind /api/*,
  // `localEngine` is a static upload that answers /api/health from a file --
  // there the match is run by the page itself (see local.js).
  backendHere: null,
  localEngine: false,
  // Set the first time pointer lock is refused here; see updateLockHint().
  // Only then does the prompt mention iframes and offer a tab of its own.
  lockRefused: false,
  // Esc paused the match (see togglePause): the world stops, the menu is up.
  paused: false,
  // A room opened from the menu before a match exists (see hostNow): the channel
  // the deploy step then adopts, so the code never changes under the player.
  roomChannel: null,
  // Handed to the net at connect time, then cleared.
  deployChannel: null,
  // Esc freed the mouse and the player has not clicked back in yet.
  mouseFreed: false,
  // A leaving player must not be told off for disconnecting; see leaveMatch().
  leaving: false,
  // Rooms the menu knows about: the backend's own list, and the rooms other
  // players are hosting in their browsers (see relay.js RelayLobby).
  serverRooms: null,
  relayRooms: [],
  relayLobby: null,
  // A room this browser is hosting (its code), and what carried the room's
  // traffic: 'broker' (the public relay) or 'tab' (this browser's own tabs).
  relayHostCode: '',
  relayKind: '',
  relayLabel: '',
};

// A handle for the browser console and the automated tests: everything the game
// knows, without having to guess at closures. Nothing inside the game reads it,
// so poking at it can only affect that one session.
if (typeof window !== 'undefined') window.__trench = { app, profile };

// One id per browser tab, kept in sessionStorage: it survives a refresh but is
// never shared with another tab. The server uses it to evict the stale socket a
// reload leaves behind, otherwise that ghost keeps the room occupied and the
// fresh map pick is downgraded to a between-rounds vote (i.e. ignored).
function tabSessionId() {
  let sid = session.get('tf.sid');
  if (!sid) {
    sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 's' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    // Denied storage (blocked site data / opaque origin) just means the id is
    // per-connection instead of per-tab: see storage.js.
    session.set('tf.sid', sid);
  }
  return sid;
}

// --------------------------------------------------------------------- boot

async function boot() {
  try {
    app.data = await loadConfig();
  } catch (err) {
    bootFail(t('战场数据载入失败：{why}', { why: err.message }),
      t('请确认服务端已启动，并且这个页面是从服务端地址打开的（http://…，不是直接双击 html 文件）。'));
    return;
  }

  const canvas = document.getElementById('game');
  app.canvas = canvas;
  // A browser with WebGL switched off (or a GPU-blocklisted driver) throws
  // right here. Without this catch that throw escaped boot() as an unhandled
  // rejection: the loading screen stayed up forever with no clue why.
  try {
    app.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    bootFail(t('无法创建 3D 画面（WebGL）：{why}', { why: err.message }),
      t('请在浏览器设置里打开「使用硬件加速」「使用图形加速」后重开页面；若仍不行，换 Chrome / Edge / Firefox 试试。'));
    return;
  }
  app.performance = new AdaptiveResolution(app.renderer,{width:innerWidth,height:innerHeight,dpr:devicePixelRatio});
  app.renderer.setSize(innerWidth, innerHeight);
  app.renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.renderer.toneMapping = THREE.NeutralToneMapping;
  app.renderer.toneMappingExposure = 1.06;

  // A driver reset (tab suspended for a long time, GPU driver restart) leaves a
  // black screen but the game keeps running. Say so instead of looking frozen.
  canvas.addEventListener('webglcontextlost', () => {
    app.hud?.toast(t('显卡上下文丢失，正在尝试恢复…'), 4000);
  });

  app.scene = new THREE.Scene();
  app.objectiveView = new ObjectivesView(app.scene);
  app.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.06, 600);

  // The world is built by setMap() on deploy: a model map is 92 MB and has no
  // business delaying a menu the player may never leave.
  const savedMap = store.get('tf.mapId');
  app.mapPick = app.data.mapById[savedMap] ? savedMap : app.data.defaultMapId;
  app.hud = new Hud(app.data);
  app.sfx = new Sfx();
  app.controls = new Controls(canvas, null, app.data.combat, app.data);
  app.vm = new ViewModel(app.data);
  app.camera.add(app.vm.root);
  app.scene.add(app.camera);

  app.fxGroup = new THREE.Group();
  app.scene.add(app.fxGroup);
  app.gunfx = new GunFx({ group: app.fxGroup, scene: app.scene });

  addEventListener('resize', () => {
    app.performance.resize(innerWidth,innerHeight,devicePixelRatio);
    app.renderer.setSize(innerWidth, innerHeight);
    app.camera.aspect = innerWidth / innerHeight;
    app.camera.updateProjectionMatrix();
  });

  app.settings = createSettings({
    data: app.data,
    hud: app.hud,
    onUse: (skin) => {
      app.loadout.skin = skin?.id || '';
      app.hud.setSkinNote(skin ? t('当前角色：{name}', { name: nameOf(skin) || skin.id }) : '');
    },
  });
  setupServerAddress();
  await refreshCharLibrary();
  setupLocalPanel();
  for (const skin of Object.values(BUILTIN_SKINS)) app.charMeta.set(skin.id, skin);

  // Warm every built-in rig while the player is still on the menu. Textures
  // are uploaded serially, one per frame, long before the join burst -- the
  // burst is exactly when old Intel iGPUs drop a first upload to solid black.
  // A failed preload is harmless: the rig simply loads lazily on first use.
  for (const skin of Object.values(BUILTIN_SKINS)) ensureTemplate(skin.id, skin);

  setupMenu();
  setupLanguage();
  setupTutorial();
  setupPause();
  setupInvite();
  wireControls();
  app.mobile = new MobileControls(app.controls, { parent: app.hud.el.hud, onPause: () => togglePause(true), layout: profile.load().touchLayout, onLayoutSave: touchLayout => profile.save({touchLayout}) });
  app.hud.screen('menu');
  requestAnimationFrame(loop);
}

/**
 * The loading screen doubles as the failure screen: it is the only thing on
 * screen that early, so a message printed here is the difference between
 * "broken game" and "the browser needs hardware acceleration on".
 */
function bootFail(message, hint) {
  const box = document.querySelector('.boot-text');
  if (box) box.textContent = message;
  if (hint) {
    const p = document.createElement('p');
    p.className = 'boot-text dim';
    p.style.marginTop = '14px';
    p.style.maxWidth = 'min(680px, 86vw)';
    p.style.lineHeight = '1.7';
    p.style.textAlign = 'center';
    p.textContent = hint;
    box?.parentElement?.appendChild(p);
  }
  // Also leave a trace for the console, where the raw error is easier to read.
  console.error('[trench]', message, hint || '');
}

// ------------------------------------------------------------ character library

/** Shared characters uploaded by anyone; keyed by server id. */
async function refreshCharLibrary() {
  try {
    const res = await fetch(apiUrl('/api/characters'));
    const list = (await res.json()).characters || [];
    for (const m of list) app.charMeta.set(m.id, m);
  } catch { /* offline: only the built-in characters are available */ }

  const saved = store.get('tf.skinId') || '';
  const meta = app.charMeta.get(saved);
  app.loadout.skin = meta ? meta.id : '';
  app.hud.setSkinNote(meta ? t('当前角色：{name}', { name: nameOf(meta) || meta.id }) : '');
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

/**
 * Language switch: a chip in the menu corner, and a pair of buttons on the
 * settings screen. i18n.js owns the choice (it is applied when the module is
 * imported, so the first paint is already in the right language); this only
 * paints the controls and re-renders the bits of the menu that were built
 * before the switch: the error line, the room list and the local panel.
 */
function setupLanguage() {
  const chip = document.getElementById('lang-toggle');
  const zh = document.getElementById('lang-zh');
  const en = document.getElementById('lang-en');

  const paint = () => {
    const l = getLang();
    // The chip offers the *other* language, which is what a player looking for
    // a way out of Chinese wants to see.
    if (chip) chip.textContent = l === 'en' ? '中文' : 'EN';
    zh?.classList.toggle('on', l === 'zh');
    en?.classList.toggle('on', l === 'en');
  };

  const choose = (lang) => {
    if (lang === getLang()) { paint(); return; }
    setLang(lang);
    app.sfx?.ui();
    app.hud.menuError('');
    showStaticHint();
    refreshRoomList();
    setupLocalPanel.render();
    paint();
  };

  chip?.addEventListener('click', () => choose(getLang() === 'en' ? 'zh' : 'en'));
  zh?.addEventListener('click', () => choose('zh'));
  en?.addEventListener('click', () => choose('en'));
  onLangChange(paint);
  paint();
}

/**
 * Settings screen: show the player exactly what this browser stores, let them
 * export it, and let them wipe it. The game keeps no server-side profile, so
 * this panel is the whole story of "my data".
 */
function setupLocalPanel() {
  const note = document.getElementById('local-note');
  // setupLanguage() re-runs render() when the interface language changes.
  setupLocalPanel.render = () => {};
  const exportBtn = document.getElementById('local-export');
  const resetBtn = document.getElementById('local-reset');
  if (!note) return;
  const render = () => {
    const sum = profile.summary();
    const st = sum.stats;
    const lines = [
      t('名字：{name}', { name: sum.name || t('（未设置）') }),
      t('最近房号：{code}', { code: sum.room || t('（还没进过房间）') }),
      t('战绩：{matches} 局 · {kills} 击杀 · {deaths} 阵亡 · 胜 {wins}', {
        matches: st.matches, kills: st.kills, deaths: st.deaths, wins: st.wins,
      }),
      t('新手指引：{state}', { state: sum.tutorialDone ? t('已完成') : t('未完成') }),
      sum.persistent
        ? t('存储位置：本机 localStorage（不会上传到服务器，也没有账号系统）')
        : t('注意：这个环境禁止了本地存储，本次数据只在内存里，刷新即失效'),
    ];
    note.innerHTML = lines.join('<br>');
  };
  setupLocalPanel.render = render;
  onLangChange(render);
  render();

  exportBtn?.addEventListener('click', () => {
    const data = { exportedAt: new Date().toISOString(), profile: profile.load() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trench-front-profile.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    app.hud.toast(t('存档已导出到下载文件夹'), 2200);
  });

  resetBtn?.addEventListener('click', () => {
    if (!window.confirm(t('清空这台电脑上的游戏数据（名字、房号记录、战绩、本地角色映射）？'))) return;
    profile.reset();
    const mode = document.querySelector('.control-mode');
    if (mode) { mode.value = 'auto'; mode.dispatchEvent(new Event('change')); }
    const slider = document.querySelector('.mouse-sensitivity');
    if (slider) { slider.value = '100'; slider.dispatchEvent(new Event('input')); }
    for (const key of ['tf.mapId', 'tf.server', 'tf.skinId', 'tf.skinName', 'tf.localRig']) store.remove(key);
    app.hud.setRoomMode('create', '');
    app.hud.setRoomHistory([]);
    app.hud.setServerAddress('');
    app.hud.el.name.value = '';
    app.hud.toast(t('本机数据已清空'), 2200);
    render();
  });
}

/**
 * The beginner walkthrough. Starting it deploys a private solo match with no
 * bots, so the steps happen in the real game without anyone shooting back. The
 * deploy path is the ordinary one: only `bots: false` and a marker make it the
 * practice round.
 */
function setupTutorial() {
  app.tut = new Tutorial({
    hud: app.hud,
    onStart: () => {
      app.hud.screen('select');
      app.hud.setBotsVisible(false);
      app.hud.selectClass(app.loadout.cls, 0);
      app.hud.pickWeapon(app.loadout.cls, app.loadout.weapon || app.loadout.cls);
    },
    onFinish: (completed) => {
      profile.save({ tutorialDone: true });
      if (completed && app.playing) leaveMatch();
      app.hud.menuError('');
      app.hud.toast(completed ? t('新手指引完成，祝你玩得开心') : t('随时可以在主菜单重新打开新手指引'), 2600);
    },
  });
  app.tut.setMobileMode(app.controls.mobileMode);
  // First visit: offer the walkthrough instead of leaving the player to guess.
  if (!profile.load().tutorialDone) {
    app.hud.setTutorialHint?.();
  }
}

/**
 * Esc pauses the match and opens a menu that can actually leave it.
 *
 * Before this, Esc only handed the mouse back: there was no way out of a match
 * except reloading the page, and no way to stop playing for a moment without
 * losing the mouse. The world stops while the menu is up (the frame loop skips
 * its update, so a solo engine or a hosted room really does pause), the mouse
 * is free, and the menu offers the three things a player wants: carry on,
 * change settings, or leave the match.
 */
function setupPause() {
  document.getElementById('btn-touch-layout').onclick = () => {
    if (!app.controls.mobileMode) return;
    app.hud.hidePause();
    app.mobile.editLayout(() => { app.paused = false; togglePause(true); });
  };
  const fullscreen = () => requestMobileFullscreen(app.controls.mobileMode, text => app.hud.toast(t(text)));
  for (const id of ['btn-deploy','btn-pause-resume','btn-mobile-fullscreen']) {
    document.getElementById(id)?.addEventListener('click', fullscreen, {capture:true});
  }
  app.hud.bindPause({
    onResume: () => togglePause(false),
    onSettings: () => {
      app.sfx.resume();
      app.settings.open();
    },
    onInvite: () => openInvite('host'),
    onLeave: () => leaveMatch(),
  });
  // Esc itself: `controls` releases the mouse, then tells us here.
  app.controls.onEscape = () => {
    if (app.mobile.editing) { app.mobile.finishLayout(false); return; }
    if (!app.playing) return;
    togglePause(!app.paused);
  };
}

function togglePause(on) {
  const want = on === undefined ? !app.paused : !!on;
  if (want === app.paused) return;
  app.paused = want;
  // A room running in this tab (solo engine or a hosted match) stops with it.
  if (app.net) app.net.paused = want;
  if (want) {
    clearFlash();
    document.getElementById('scope-overlay').classList.add('hidden');
    document.body.classList.remove('scope-active');
    app.clickPending = false;
    app.controls.releaseLook();
    app.hud.showPause({
      host: !!app.relayHostCode,
      note: app.relayHostCode
        ? t('房号 {code} · 你是房主，这一局在你的浏览器里运行；离开后别人会失去这一局。',
          { code: formatCode(app.relayHostCode) })
        : t(app.controls.mobileMode ? '点击继续战斗返回战场。' : '按 Esc 打开这个菜单；「继续战斗」回到战场。'),
    });
  } else {
    app.hud.hidePause();
    // The click (or the Esc key) that got here is a user gesture, which is what
    // pointer lock needs; if the browser still refuses, the prompt says so.
    app.controls.requestLock();
  }
}

/**
 * Out of a match, from the pause menu. `leaving` keeps the net's own
 * "disconnected" handling quiet: nobody should be told off for choosing to
 * leave. The room stays open for a host (the code still works if they come
 * back), and a guest simply says goodbye.
 */
function leaveMatch() {
  app.leaving = true;
  app.paused = false;
  app.hud.hidePause();
  app.playing = false;
  document.getElementById('scope-overlay').classList.add('hidden');
  document.body.classList.remove('scope-active');
  app.objectiveView?.setState(null);
  try { app.controls.releaseLook(); } catch { /* nothing to release */ }
  app.controls.enabled = false;
  // A hosted room goes with the match: guests are told (the relay's own goodbye)
  // and the code is retired, so nobody is left knocking on a room whose engine
  // is no longer running.
  try { app.roomChannel?.close(); } catch { /* already gone */ }
  app.roomChannel = null;
  try { app.net?.close(); } catch { /* already gone */ }
  app.net = null;
  app.netUrl = null;
  const wasHosting = !!app.relayHostCode;
  app.relayHostCode = '';
  app.relayKind = '';
  app.relayLabel = '';
  app.deathShown = false;
  app.hud.hideDeath?.();
  app.hud.setRoomCode('');
  app.hud.screen('menu');
  app.hud.toast(wasHosting
    ? t('已离开对局（房间也关了）：想再来一局就再点「创建房间」')
    : t('已离开对局'), 3200);
  app.leaving = false;
}

// ------------------------------------------- 联机：不用任何服务器的邀请码

/**
 * Cross-computer multiplayer in two codes and no service at all: the host makes
 * an invite code (a WebRTC offer, deflated into text), the friend's page turns
 * it into an answer code, the host pastes that back and the two pages are
 * connected directly. This is what the "no server" requirement comes down to --
 * the players themselves are the signalling channel.
 */
function setupInvite() {
  app.hud.bindInvite({
    onGenerate: async () => {
      // 「创建房间」 opens the room's channel straight away and the match adopts
      // that same channel when it deploys, so an invite made here -- while the
      // player is still picking a class -- keeps working once the fight starts.
      const ch = inviteChannel();
      if (!ch) {
        app.hud.inviteStatus(t('先创建房间（房主才有邀请码）'), false);
        return;
      }
      app.hud.inviteStatus(t('正在生成邀请码…'));
      try {
        const code = await ch.createInvite(app.relayHostCode || ch.room || '');
        app.hud.el.inviteCode.value = code;
        app.hud.inviteStatus(t('邀请码已生成：把上面这段发给一位朋友（他会得到一个回答码）'), true);
      } catch (err) {
        app.hud.inviteStatus(err?.message || t('邀请码生成失败'), false);
      }
    },
    onCopy: async (text) => {
      if (!text) return;
      try { await navigator.clipboard.writeText(text); app.hud.inviteStatus(t('已复制'), true); }
      catch { app.hud.el.inviteCode.select?.(); app.hud.inviteStatus(t('复制失败：请手动选中复制（Ctrl/Cmd+C）'), false); }
    },
    onAccept: async (text) => {
      const ch = inviteChannel();
      if (!ch) {
        app.hud.inviteStatus(t('先创建房间（房主才有邀请码）'), false);
        return;
      }
      app.hud.inviteStatus(t('正在配对…'));
      try {
        await ch.acceptAnswer(text);
        app.hud.inviteStatus(t('配对成功：这位朋友已经连上你了，他现在能进这一局'), true);
        app.hud.toast(t('朋友已直连进来'), 3200);
      } catch (err) {
        app.hud.inviteStatus(err?.message || t('回答码用不了'), false);
      }
    },
    onJoin: async (text) => {
      app.hud.inviteStatus(t('正在连接房主…'));
      try {
        const res = await joinByInvite(text);
        app.hud.el.inviteCode.value = res.answer;
        app.hud.inviteStatus(t('回答码已生成，房号 {code}：发回房主完成配对；连接成功后再部署', { code: formatCode(res.room) }), true);
      } catch (err) {
        app.hud.inviteStatus(err?.message || t('邀请码用不了'), false);
      }
    },
    onStun: (on) => {
      // Off by default: with no STUN server the two browsers must see each
      // other directly, which is exactly "nothing external". On: a public
      // address-lookup service helps two home networks find each other.
      setStun(on ? 'stun.l.google.com:19302' : '');
      store.set('tf.stun', on ? '1' : '');
      app.hud.inviteStatus(on ? t('已打开跨网络支持（下次生成邀请码时生效）') : t('已关闭跨网络支持：只连同一网络内的朋友'));
    },
    onClose: () => app.hud.closeInvite(),
  });
  setStun(getStun() || (store.get('tf.stun') ? 'stun.l.google.com:19302' : ''));
}

/**
 * Where invite codes are made: the room opened by 「创建房间」 if there is one
 * (that is the channel the match will adopt), else the running match's own.
 */
function inviteChannel() {
  if (app.roomChannel) return app.roomChannel;
  if (app.net?.createInvite) return app.net;
  return null;
}

function openInvite(mode) {
  app.hud.openInvite(mode, { room: app.relayHostCode || app.roomCode || '', stun: !!getStun() });
}

/** Guest side of the invite exchange: learn the room, connect, return an answer. */
async function joinByInvite(text) {
  const parsed = await parseCode(text);
  if (!parsed || parsed.kind !== 'invite') throw new Error(t('这不像一个邀请码：它应以 TFi1 开头（回答码是发给房主的）'));
  const room = String(parsed.room || '').replace(/\D/g, '');
  if (room.length !== 8) throw new Error(t('邀请码里的房号不对：请让房主重新生成一个'));
  app.roomMode = 'join';
  app.roomCode = room;
  profile.save({ roomMode: 'join', room });
  app.hud.setRoomMode('join', room);
  await connectRelay({ room, solo: false });
  const res = await app.net.acceptInvite(text);
  if (res.room) { app.relayHostCode = ''; }
  app.hud.setRoomCode('');
  return { room: res.room || room, answer: res.answer };
}

function setupMenu() {
  // Everything personal lives in this browser only (see profile.js): the name,
  // the loadout, the room codes and the local stats. No database anywhere.
  const saved = profile.load();
  const modeSelectors = [...document.querySelectorAll('.control-mode')];
  const coarsePointer = matchMedia('(pointer: coarse)');
  let controlMode = saved.controlMode;
  const applyControlMode = () => {
    const mobile = controlMode === 'mobile' || (controlMode === 'auto' && coarsePointer.matches && navigator.maxTouchPoints > 0);
    app.controls.setMobileMode(mobile);
    document.body.classList.toggle('mobile-mode', mobile);
    for (const select of modeSelectors) select.value = controlMode;
    app.tut?.setMobileMode(mobile);
    if (mobile && app.playing && !app.paused) app.controls.requestLock();
    updateLockHint();
  };
  applyControlMode();
  for (const select of modeSelectors) select.addEventListener('change', () => {
    controlMode = select.value;
    profile.save({ controlMode });
    applyControlMode();
  });
  coarsePointer.addEventListener('change', () => { if (controlMode === 'auto') applyControlMode(); });
  const mouseSliders = [...document.querySelectorAll('.mouse-sensitivity')];
  const setSensitivity = (percent) => {
    const value = Math.max(25, Math.min(200, percent));
    app.controls.sensitivity = profile.DEFAULT_PROFILE.sensitivity * value / 100;
    app.controls.mouseLook.reset();
    for (const slider of mouseSliders) {
      slider.value = String(value);
      slider.closest('label').querySelector('output').textContent = `${value}%`;
    }
  };
  setSensitivity(Math.round(saved.sensitivity / profile.DEFAULT_PROFILE.sensitivity * 100));
  for (const slider of mouseSliders) slider.addEventListener('input', () => {
    setSensitivity(Number(slider.value));
    profile.save({ sensitivity: app.controls.sensitivity });
  });
  let botCount = saved.soloBots;
  let mode = 'multi';
  app.roomMode = saved.roomMode;
  app.roomCode = saved.room;

  // Server address: remembered per browser. Empty means "wherever this page
  // came from", which is already correct when everyone opens the host's URL.
  app.hud.setServerAddress(app.serverPick || store.get('tf.server') || '');
  app.hud.setRoomMode(app.roomMode, app.roomCode);
  app.hud.setRoomHistory(saved.recentRooms);
  setupJoinLink();
  app.hud.onRoomChipClick((code, ok) => {
    if (app.relayHostCode) {
      // Browser-hosted room: a link is far easier to pass on than 8 digits.
      app.hud.toast(ok
        ? t('邀请链接已复制：朋友打开就是加入房号 {code}', { code: formatCode(code) })
        : t('房号：{code}（把这一串发给朋友，他们在「输入房号加入」里填）', { code: formatCode(code) }), 3200);
      return;
    }
    app.hud.toast(ok ? `房号 ${code} 已复制，发给朋友吧` : `房号：${code}`, 2400);
  });
  refreshRoomList();
  showStaticHint();

  const enterSelect = (which) => {
    mode = which;
    app.sfx.resume();
    // Bots belong to solo only; multiplayer is humans only.
    app.hud.setBotsVisible(which === 'solo');
    app.hud.screen('select');
    app.hud.selectClass(app.loadout.cls, 0);
    app.hud.pickWeapon(app.loadout.cls, app.loadout.weapon || app.loadout.cls);
  };

  // Multiplayer is entered through a room code: creating one makes you the
  // host, joining one requires the code the host handed out. Solo never asks.
  const multiNeedsCode = () => app.roomMode === 'join';
  const roomProblem = () => {
    if (!multiNeedsCode()) return '';
    const code = app.hud.joinCode;
    if (code.length !== 8) return t('请输入房主给你的 8 位房号（例如 1234 5678）');
    return '';
  };
  const enterMulti = () => {
    const problem = roomProblem();
    if (problem) {
      app.hud.menuError(problem);
      app.hud.setRoomMode('join', app.hud.joinCode);
      return;
    }
    app.hud.menuError('');
    enterSelect('multi');
  };

  app.hud.bindMenu({
    onMulti: enterMulti,
    onSolo: () => enterSelect('solo'),
    onSettings: () => {
      app.sfx.resume();
      app.settings.open();
    },
    onBotCount: (n) => { botCount = n; profile.save({ soloBots: n }); },
    onRoomMode: (m) => {
      app.roomMode = m;
      app.hud.menuError('');
      app.hud.setRoomMode(m, app.roomCode);
    },
    // One click, one room: hosting starts immediately instead of waiting for
    // the deploy button (and for a broker probe that no longer exists).
    onHost: async () => {
      app.hud.menuError('');
      if (app.relayHostCode) {
        app.hud.toast(t('房间 {code} 已经开着了：把房号发给朋友，或按 Esc →「邀请朋友」生成跨电脑邀请码',
          { code: formatCode(app.relayHostCode) }), 4200);
        return;
      }
      app.sfx.ui();
      const ok = await hostNow();
      if (!ok) return;
      enterMulti();
    },
    onInvite: () => {
      app.hud.menuError('');
      openInvite(app.relayHostCode ? 'host' : 'guest');
    },
    onRoomCode: () => app.hud.menuError(''),
    // The class screen's copy button: same words as the HUD chip.
    onCopyLink: async () => {
      const code = app.relayHostCode || app.roomCode || '';
      if (!code) { app.hud.menuError(t('还没有房间：先点「创建房间」')); return; }
      const ok = await app.hud.copyRoomLink();
      app.hud.menuError('');
      app.hud.toast(ok
        ? t('邀请链接已复制：朋友打开就是加入房号 {code}', { code: formatCode(code) })
        : t('房号：{code}（把这一串发给朋友，他们在「输入房号加入」里填）', { code: formatCode(code) }), 3200);
    },
    onTutorial: () => {
      app.hud.menuError('');
      app.tut?.open();
    },
    onMap: (id) => {
      app.sfx.ui();
      app.mapPick = id;
      app.hud.setMapPick(id);
      store.set('tf.mapId', id);
    },
  });
  app.hud.buildMaps(app.data.maps, app.mapPick);
  if (saved.name) app.hud.el.name.value = saved.name;

  app.hud.buildSelect(
    (clsId) => {
      app.sfx.ui();
      app.hud.selectClass(clsId, 0);
      app.hud.pickWeapon(clsId, app.data.weaponsByClass[clsId][0].id);
    },
    () => {
      const sel = app.hud.selected || { cls: app.loadout.cls, weapon: app.data.weaponsByClass[app.loadout.cls][0].id };
      app.loadout = { ...app.loadout, ...sel };
      const practice = !!app.tut?.active;
      deploy({
        name: app.hud.playerName,
        cls: sel.cls,
        weapon: sel.weapon,
        // The walkthrough is a solo match with nobody shooting at the player.
        bots: practice ? false : mode === 'solo',
        botCount: mode === 'solo' ? botCount : 0,
        skin: app.loadout.skin || '',
        solo: practice || mode === 'solo',
        gameMode: practice ? 'control' : document.getElementById('game-mode').value,
        // Solo is its own private room; multiplayer either hosts (no code) or
        // joins the code the player typed.
        room: !practice && mode === 'multi' && multiNeedsCode() ? app.hud.joinCode : '',
        map: practice ? 'somme' : app.mapPick,
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
  const pageSecure = location.protocol === 'https:';
  if (!text) return { host: location.host, secure: pageSecure };
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(explicit ? text : `http://${text}`);
  } catch {
    throw new Error(t('服务器地址无效：{text}', { text }));
  }
  // A typed full URL knows better than this page does: on an https deployment the
  // game server has to be https too (the browser blocks a ws:// socket from a
  // secure page), and its port comes from the scheme rather than from whatever
  // port this page happens to be served on. A bare address keeps following the
  // page -- that is what LAN play and the local menu expect.
  const secure = explicit ? (url.protocol === 'https:' || url.protocol === 'wss:') : pageSecure;
  // URL.hostname keeps IPv6 brackets in some engines and drops them in others,
  // so normalise here rather than assuming either.
  const bare = url.hostname.replace(/^\[|\]$/g, '');
  const host = bare.includes(':') ? `[${bare}]` : bare;
  const port = url.port || (explicit ? (secure ? '443' : '80') : (location.port || '8080'));
  return { host: `${host}:${port}`, secure };
}

/** `{host, secure}` -> the http(s) origin the /api/... endpoints live on. */
function serverHttpBase(server) {
  return `${server.secure ? 'https' : 'http'}://${server.host}`;
}

/**
 * `?code=12345678` -- the link a host can hand out. It opens the menu with the
 * join field already filled, so a friend only has to press deploy. Accepts the
 * code in the query or the hash, with or without spaces/dashes.
 */
function setupJoinLink() {
  let raw = '';
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    raw = q.get('code') || h.get('code') || q.get('room') || h.get('room') || '';
  } catch { /* no URL API: nothing to read */ }
  const code = String(raw).replace(/\D/g, '').slice(0, 8);
  if (code.length !== 8) return false;
  app.roomMode = 'join';
  app.roomCode = code;
  profile.save({ roomMode: 'join', room: code });
  app.hud.setRoomMode('join', code);
  app.hud.toast(t('邀请链接里的房号 {code} 已填好，进战场就是加入这一局',
    { code: formatCode(code) }), 4200);
  return true;
}

/**
 * Where the game server is, before anything has connected. A static deployment
 * (Vercel and friends -- see api.js) has no server of its own, so the address
 * has to come from the player: `?server=host:port` on the URL wins over the one
 * remembered from last time, because it is the one that was just pasted in.
 */
function setupServerAddress() {
  let picked = '';
  let raw = '';
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    raw = (q.get('server') || h.get('server') || '').trim();
  } catch { /* no URL API: nothing to read */ }
  if (raw) {
    try {
      picked = normalizeServer(raw).host;
      store.set('tf.server', raw);
      setApiBase(serverHttpBase(normalizeServer(raw)));
    } catch (err) {
      // A typo in the URL must not stop the menu from opening.
      console.warn('[trench] 忽略无效的 ?server=：', err.message);
    }
  }
  app.serverPick = picked;

  // Is there a game server behind this very origin? Plain static hosting says no,
  // and then the player deserves to be told that instead of a bare connection
  // error -- and told what to put in the address box.
  app.backendHere = null;
  fetch(apiUrl('/api/health'), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      app.backendHere = !!(j && j.ok === true);
      // A static upload carries shim /api/health, /api/rooms and
      // /api/characters files (see public/api/) and marks itself: there is no
      // socket to open, the engine runs in this tab instead. A real server
      // never sets this, so a hosted match keeps using the network.
      app.localEngine = !!(j && j.engine === 'local');
      // Rooms are hosted by players on such a page, so the menu says so
      // (see hud.setRoomMode).
      app.hud.setWebHosted(app.localEngine);
    })
    .catch(() => { app.backendHere = false; })
    .then(showStaticHint);
}

/**
 * The one-line nudge a copy of the page with no game server behind it shows.
 * That copy still plays -- the engine boots inside the tab (see local.js) -- so
 * the line is an offer, not a complaint: type an address to play on a hosted
 * server instead, with other people.
 */
// Built per call rather than stored as a constant: the nudge itself is
// translated, so it has to be rebuilt when the language changes.
const staticHint = () => t('连不上服务器：单机可以在这里直接开打（引擎在页面里跑），'
  + '多人则点「创建房间」，把 8 位房号发给朋友（同一个浏览器多开标签页），'
  + '或用「邀请朋友」的邀请码跨电脑直连——房主的浏览器运行整局，不经过任何服务器。'
  + '想用自建服务端，就在下方「服务器地址」填后端地址（例如 your-app.onrender.com）。');

/** The menu line a static copy of the page shows: how multiplayer works here. */
const localEngineHint = () => t('静态托管：单机与多人都不需要服务器——'
  + '点「创建房间」你就是房主：把 8 位房号发给朋友（同一浏览器多开标签页即可进），'
  + '或用「邀请朋友」的邀请码让另一台电脑直连过来。');

function showStaticHint() {
  const configured = !!(app.hud.serverAddress || app.serverPick);
  const shown = app.staticHint;
  app.staticHint = false;
  // A page that runs the engine itself needs no "cannot connect" nudge -- its
  // deploy button works. It does need to be told how multiplayer works, since
  // there is no server to join.
  if (app.localEngine) {
    startRelayLobby();
    if (configured) {
      if (shown) app.hud.menuError('');
      return;
    }
    app.staticHint = true;
    app.hud.menuError(localEngineHint());
    return;
  }
  if (!configured && app.backendHere === false) {
    app.staticHint = true;
    app.hud.menuError(staticHint());
  } else if (configured && shown) {
    // A server address turned up (remembered, or ?server=): the nudge is stale.
    app.hud.menuError('');
  }
}

/**
 * How many rooms are running right now, for the menu's hint line. On a static
 * deployment this has to ask the configured backend: /api/rooms on this origin
 * is just a 404.
 */
async function refreshRoomList() {
  try {
    const res = await fetch(apiUrl('/api/rooms'), { cache: 'no-store' });
    const data = await res.json();
    app.serverRooms = data.rooms || [];
  } catch {
    app.serverRooms = null;
  }
  applyRoomList();
}

/** What the menu's "N rooms online" line really shows. */
function applyRoomList() {
  const rooms = [...(app.serverRooms || []), ...(app.relayRooms || [])]
    // The room this browser is hosting is not something to join.
    .filter((r) => !app.relayHostCode || r.code !== app.relayHostCode);
  // null means "we have no idea", which the HUD words differently from "none".
  app.hud.setRoomList(rooms.length || app.serverRooms !== null ? rooms : null);
}

/**
 * Listen for rooms other players are hosting in their own browsers, and merge
 * them into the menu list. Only meaningful on a static upload -- a real server
 * already lists its own rooms -- and quietly absent when no relay is reachable.
 */
function startRelayLobby() {
  if (!app.localEngine || app.relayLobby) return;
  const lobby = new RelayLobby();
  app.relayLobby = lobby;
  lobby.start((rooms) => {
    app.relayRooms = rooms || [];
    applyRoomList();
  }).then((ok) => {
    // The lobby retries on its own when no relay is reachable yet, so an
    // unsuccessful first attempt is not a reason to give up on it.
    if (!ok) console.warn('[trench] no relay for the room list yet');
  });
}

/**
 * Open (or reuse) the socket for one address. Throws when the handshake fails,
 * leaving app.net empty for the next candidate.
 */
/** The handlers a match needs, whichever transport ends up carrying it. */
function netHandlers(label) {
  return {
    onWelcome: onWelcome,
    onState: onState,
    onMe: onMe,
    onMessage: onMessage,
    // Boot progress for the in-page engine -- and, in a relay room, the little
    // "the host paused", "rejoining" notices a guest gets mid-match. While the
    // player is fighting those have to be a toast: the menu behind it is hidden.
    onNote: (text) => {
      if (app.playing) app.hud.toast(text, 3400);
      else app.hud.menuError(text);
    },
    onClose: () => {
      if (!app.playing || app.leaving) return;
      app.playing = false;
      app.paused = false;
      app.hud.hidePause();
      app.controls.releaseLock();
      app.hud.screen('menu');
      app.hud.menuError(app.net?.mode === 'relay'
        ? t('与房主断开连接：回主菜单用同一个房号重新加入即可')
        : t('与服务器断开连接'));
    },
    onError: (text) => app.hud.menuError(text || t('无法连接服务器（{host}）', { host: label })),
    // A friend on another computer connected straight to this browser: nobody
    // else on the page can tell the player that, so say it here.
    onPeers: (n) => {
      if (!n) return;
      const text = t('一位朋友已直连进来（当前 {n} 条直连）', { n });
      if (app.playing) app.hud.toast(text, 3400);
      else app.hud.menuError(text);
    },
  };
}

async function connectNet(server) {
  const proto = server.secure ? 'wss:' : 'ws:';
  const host = server.host;
  const url = `${proto}//${host}/ws`;

  // A socket already bound to a different address is useless once the menu
  // address changes, so drop it and build a fresh client -- otherwise editing
  // the field would silently keep talking to the old server.
  if (app.net && (!app.net.connected || app.netUrl !== url)) {
    app.net.close();
    app.net = null;
    app.netUrl = null;
  }
  if (!app.net) {
    app.net = new Net(netHandlers(host));
    app.netUrl = url;
    try {
      // A page that already knows it is a static upload has no socket to wait
      // for: the long-poll POST is answered by nothing, and the engine in this
      // tab is the way in. Nothing is decided until /api/health has answered,
      // so the full handshake timeout stays for a real server.
      await app.net.connect(url, { timeoutMs: app.localEngine ? 1500 : undefined });
      if (app.net.mode === 'poll') {
        // Only happens where the WebSocket upgrade is refused (strict proxy,
        // some preview panes). Not an error: the match rides on POSTs instead.
        console.warn('[trench] WebSocket unavailable, using the HTTP long-poll transport');
      }
    } catch (err) {
      app.net.close();
      app.net = null;
      app.netUrl = null;
      throw err;
    }
  }
  return url;
}

/**
 * The last candidate on a static deployment: the game server's own code, run by
 * this page (local.js). Nothing to reach, nothing to configure -- and the same
 * match logic, so the room, the bots and the ballistics behave exactly like the
 * ones a hosted server would run.
 */
async function connectLocal() {
  const url = 'local://engine';
  if (app.net && (!app.net.connected || app.netUrl !== url)) {
    app.net.close();
    app.net = null;
    app.netUrl = null;
  }
  if (!app.net) {
    app.net = new LocalNet(netHandlers(t('浏览器内引擎')));
    app.netUrl = url;
    try {
      await app.net.connect('');
    } catch (err) {
      // The menu only says "cannot connect": a boot failure (a missing Pyodide
      // file, inconsistent engine data) deserves its own console line.
      console.error('[trench] the in-page engine failed to start', err);
      app.net.close();
      app.net = null;
      app.netUrl = null;
      throw err;
    }
  }
  return url;
}

/**
 * The last candidate for *multiplayer* on a static deployment: no backend of
 * ours, no socket of ours -- the room runs in the browser of whoever created
 * it and the two sides talk over a public MQTT broker (relay.js). Several
 * people can host at once, each with their own code, and each host picks their
 * own map: there is no shared process left to hold one map for everyone.
 *
 * @param {{room?: string}} opts  a room code joins that room; none hosts one
 */
async function connectRelay(opts = {}) {
  const hosting = !opts.room;
  // Creating a room is its own step now (`hostNow`): if this browser is already
  // hosting, deploying must join *that* room instead of quietly making a new
  // one and losing the code the player just sent to their friends.
  const code = hosting
    ? (app.relayHostCode || createRoomCode())
    : String(opts.room).replace(/\D/g, '');
  const url = `relay://${code}`;
  if (app.net && (!app.net.connected || app.netUrl !== url)) {
    app.net.close();
    app.net = null;
    app.netUrl = null;
  }
  if (!app.net) {
    const label = hosting
      ? t('本机房主（浏览器内引擎，别人直接连你）')
      : t('房号 {code}', { code: formatCode(code) });
    app.net = hosting
      ? new RelayHostNet(netHandlers(label), { code })
      : new RelayNet(netHandlers(label), { code });
    // The room opened from the menu is the same one the match will use.
    app.deployChannel = hosting ? app.roomChannel : null;
    app.netUrl = url;
    try {
      await app.net.connect('', { code, channel: app.deployChannel });
      app.deployChannel = null;
      app.relayKind = app.net.relayKind || '';
      app.relayLabel = app.net.relayLabel || '';
      app.relayHostCode = hosting ? code : '';
    } catch (err) {
      console.error('[trench] the relay could not be opened', err);
      app.hud.menuError(err.message || t('联机通道不可用'));
      app.net.close();
      app.net = null;
      app.netUrl = null;
      throw err;
    }
  }
  return url;
}

/**
 * What the menu's "create a room" button does: open the room *now*, so the code
 * exists before the match does -- it can be read out, copied as a link, or
 * turned into an invite code while the player is still picking a class. Waiting
 * for a broker probe used to make this button look dead for a quarter of a
 * minute, which is exactly what players reported.
 */
async function hostNow() {
  app.roomMode = 'create';
  app.roomCode = '';
  profile.save({ roomMode: 'create' });
  app.hud.setRoomMode('create');
  try {
    if (!app.roomChannel || app.roomChannel.room !== app.relayHostCode || !app.relayHostCode) {
      const code = app.relayHostCode || createRoomCode();
      // Just the channel: the code is ready in milliseconds, and the engine
      // boots later, when the match is actually deployed.
      app.roomChannel = await openRoomChannel(code, {
        onMessage: (topic, text) => app.net?._onRelay?.(text),
      });
      app.relayHostCode = code;
      app.relayKind = app.roomChannel.kind;
      app.relayLabel = app.roomChannel.label;
    }
  } catch (err) {
    app.hud.menuError(err?.message || t('联机通道不可用'));
    return false;
  }
  app.hud.setRoomCode(app.relayHostCode);
  app.hud.setRoomLink(joinLink(app.relayHostCode));
  app.hud.toast(t('房间已创建 · 房号 {code}：把房号发给朋友（同一浏览器多开标签页），或用「邀请朋友」的邀请码跨电脑联机',
    { code: formatCode(app.relayHostCode) }), 6000);
  return true;
}

async function deploy(opts) {
  app.hud.menuError('');

  let primary;
  try {
    primary = normalizeServer(app.hud.serverAddress);
  } catch (err) {
    app.hud.menuError(err.message);
    return;
  }
  store.set('tf.server', app.hud.serverAddress);

  // Where the match can come from, in the order it is tried:
  //   1. the address the player typed (only when there is one),
  //   2. this page's own server -- the address box is normally left empty, and a
  //      remembered entry can go stale (the host changed network, the page was
  //      opened from a different machine), so trying the page itself second
  //      turns a dead-end "cannot connect" into a working match,
  //   3. the engine inside this tab, which is the only one of the three a static
  //      upload (Vercel and friends) can offer.
  const here = { host: location.host, secure: location.protocol === 'https:' };
  const typed = !!(app.hud.serverAddress || '').trim();
  const candidates = [];
  if (typed) candidates.push(primary);
  // A static origin cannot also be a game server, so it is skipped rather than
  // waited on: the health probe has already said what this origin is.
  if (!app.localEngine) candidates.push(here);
  // Solo plays itself; multiplayer needs other people, and on a static upload
  // the only way to reach them is a room hosted by one of the players.
  candidates.push(opts.solo
    ? { host: t('浏览器内引擎'), local: true }
    : { host: t('浏览器内的房间（房主运行对局，朋友直连你）'), relay: true });

  let url = null;
  let reached = null;
  for (const server of candidates) {
    try {
      url = server.local ? await connectLocal()
        : server.relay ? await connectRelay(opts)
          : await connectNet(server);
      reached = server;
      const notes = [];
      if (server.local) {
        notes.push(t('静态托管：对局由浏览器内嵌引擎运行（单机 + 机器人，无需服务器）'));
      } else if (server.relay) {
        notes.push(!opts.room
          ? (app.net.peers
            ? t('房主模式：这一局在你这里运行，已有 {n} 条跨电脑直连', { n: app.net.peers })
            : t('房主模式：这一局在你这里运行——把房号发给朋友（同一浏览器多开标签页），或用「邀请朋友」的邀请码跨电脑直连'))
          : (app.net.peers
            ? t('已直连房主（跨电脑点对点，没有经过任何服务器）')
            : t('已加入房间：对局在房主的浏览器里运行（同一浏览器的标签页之间直通）')));
        if (opts.room) app.hud.setRoomMode('join', String(opts.room).replace(/\D/g, ''));
      } else if (server !== primary) {
        // Keep what the player typed, but say which server we really reached.
        notes.push(t('连不上 {primary}，已改用本页面的服务器（{host}）',
          { primary: primary.host, host: server.host }));
      }
      if (app.net.mode === 'poll') {
        notes.push(t('本环境不支持 WebSocket，已改用 HTTP 轮询传输（对局照常）'));
      }
      app.hud.menuError(notes.join(' · '));
      break;
    } catch { /* try the next candidate */ }
  }
  if (!url) {
    const failed = candidates.map((c) => c.host).join(' / ');
    app.hud.menuError(app.backendHere === false
      ? t('无法连接服务器（{hosts}）· {hint}', { hosts: failed, hint: staticHint() })
      : t('无法连接服务器（{host}）', { host: failed }));
    return;
  }
  // The room list, the character library and the upload endpoint now follow the
  // server that actually answered -- on a static deployment that is not this
  // origin, so the absolute form matters.
  setApiBase(reached.local || reached.relay || reached.host === here.host ? '' : serverHttpBase(reached));
  // Remember the loadout locally before the handshake, so the menu comes back
  // exactly as the player left it even if the join fails.
  profile.save({
    name: opts.name, cls: opts.cls, weapon: opts.weapon, skin: opts.skin || '',
    roomMode: opts.solo ? app.roomMode : (opts.room ? 'join' : 'create'),
    mapId: opts.map || app.mapPick,
  });
  app.deployRoom = opts.room || '';
  // What the player asked for, so the welcome can explain a server that had to
  // keep running another room's map instead.
  app.deployPick = opts.map || app.mapPick;
  app.net.join(opts.name, opts.cls, opts.weapon, opts.bots, opts.botCount, opts.skin,
    opts.solo, opts.map || app.mapPick, tabSessionId(), opts.room || '', opts.gameMode || 'tdm');
}

// ----------------------------------------------------------------- map swap

/**
 * Load (at most once per session) and install a map. Both the menu pick and the
 * server's between-round vote funnel through here; only the server's choice is
 * authoritative at match time.
 */
const pendingMapLoads = new Map();
async function setMap(mapId) {
  const meta = app.data.mapById[mapId] || app.data.mapById[app.data.defaultMapId];
  if (app.mapId === meta.id && app.world) return;
  // Welcome and the first authoritative map event can arrive together. Share
  // their in-flight load instead of decoding two full kits/environments.
  if(pendingMapLoads.has(meta.id))return pendingMapLoads.get(meta.id);
  const pending=installMap(meta);
  pendingMapLoads.set(meta.id,pending);
  try {return await pending;} finally {pendingMapLoads.delete(meta.id);}
}

async function installMap(meta) {
  app.mapLoading = true;
  app.hud.showMapLoad(t('正在装载地图 · {name}', { name: nameOf(meta) }));
  try {
    let map = app.mapData.get(meta.id);
    if (!map) {
      const res = await fetch(meta.file, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${meta.file} -> HTTP ${res.status}`);
      map = { ...(await res.json()), scene: meta.scene };
      app.mapData.set(meta.id, map);
    }
    const old = app.world;
    const next = await World.create(app.scene, map, app.data.combat, app.renderer);
    app.world = next;
    app.controls.world = next;
    old?.dispose();
    app.mapId = meta.id;
    // Effects were placed against the old terrain; they mean nothing on the new.
    cancelCharge();
    clearEffects();
    app.gunfx?.clear();
    // The saved atmosphere belonged to the old map's scene setup.
    app.smokeBase = null;
    app.smokeOn = false;
    app.hud.setCurrentMap(meta);
  } finally {
    app.mapLoading = false;
    app.hud.hideMapLoad();
  }
}

// ------------------------------------------------------------------ welcome

async function onWelcome(m) {
  app.lastRecoverySeq = 0;
  app.shieldUntil = 0;
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
  app.hud.setRoomCode(m.room || '');
  // A room hosted by this browser is joined with a link, not by typing digits:
  // hand the chip the link so one click copies something a friend can use.
  app.hud.setRoomLink(app.relayHostCode && m.room ? joinLink(m.room) : '');
  if (m.room) {
    profile.rememberRoom(m.room, app.deployRoom ? 'join' : 'create');
    app.hud.toast(app.deployRoom
      ? t('已加入房间 {code}', { code: formatCode(m.room) })
      : t('房间已创建 · 房号 {code}', { code: formatCode(m.room) }), 4200);
    app.hud.setRoomHistory(profile.load().recentRooms);
  }
  app.hud.screen('game');
  // Native lock needs an explicit user gesture when the browser requires it.
  app.hud.setLockHint(!app.controls.canLook);
  // every match starts in first person
  app.cameraMode = 'fp';

  app.controls.reset(m.spawn, m.yaw);
  app.controls.pos.set(m.spawn[0], m.spawn[1], m.spawn[2]);
  resetRemoteWorld();
  app.gunfx?.clear();
  // Crates that were already standing when we joined arrive with the welcome,
  // so joining mid-round does not miss the medic's and support's boxes.
  for (const fx of m.fx || []) spawnEffect(fx);

  app.playing = true;
  app.matchStartedAt = performance.now();
  if (app.controls.mobileMode) app.controls.requestLock();
  app.tut?.onDeploy();
  app.last = performance.now();
  app.sfx.resume();
  if (m.botsOn) app.hud.toast(t('AI 机器人已加入战场'), 2600);
  else app.hud.toast(t('阵营：{team}', { team: nameOf(app.data.teamById[m.team]) }), 2600);
  // One match runs at a time on the server (see combat.py), so a map pick
  // cannot always be honoured. Say which map this round is on and why, rather
  // than silently loading something else.
  if (app.deployPick && m.mapId && app.deployPick !== m.mapId) {
    const want = app.data.mapById[app.deployPick];
    const got = app.data.mapById[m.mapId];
    if (want && got) {
      app.hud.toast(t('「{want}」正被其他房间占用，本局是「{got}」',
        { want: nameOf(want), got: nameOf(got) }), 5200);
    }
  }
}

/**
 * One local stats line per finished match, on this player's machine only.
 * `me` carries the authoritative kills/deaths the server counted, so the numbers
 * here are the same ones the scoreboard showed.
 */
let _lastRecorded = -1;
function recordMatchResult(st) {
  if (st.tick === _lastRecorded) return;
  _lastRecorded = st.tick;
  const me = (st.ps || []).find((p) => p.i === app.myId);
  const won = st.winner === app.myTeam ? 1 : 0;
  const played = app.matchStartedAt ? performance.now() - app.matchStartedAt : 0;
  app.matchStartedAt = 0;
  const stats = profile.bumpStats({
    matches: 1, wins: won, kills: me ? me.k : 0, deaths: me ? me.d : 0,
    playMs: Math.max(0, Math.round(played)),
  }).stats;
  console.info('[profile] local stats', JSON.stringify(stats));
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
  c.onReload = () => {
    if (!app.playing || app.paused) return;
    app.net?.reload(); app.tut?.notify('reload');
  };
  c.onAbilityDown = () => {
    if (!app.net || !app.playing || app.paused) return;
    const me = app.net.lastMe;
    if (!me || !me.alive) return;
    const kind = app.data.classById[me.c].ability;
    // The lobbed abilities are charged on hold; the crates drop where you stand.
    if (kind === 'smoke' || kind === 'flare') beginCharge();
    else { app.sfx.ability(kind); app.net.ability(c.aim()); }
  };
  c.onAbilityUp = () => releaseCharge('ability');
  c.onGrenadeDown = () => beginCharge('grenade');
  c.onGrenadeUp = () => releaseCharge('grenade');
  c.onGrenadeCycle = () => {
    if (!app.playing || app.paused || app.charge) return;
    const types = app.data.grenades;
    app.grenadeKind = types[(types.findIndex(g=>g.id===app.grenadeKind)+1)%types.length].id;
    app.tut?.notify('grenadeCycle');
    app.sfx.ui();
  };
  c.onAbilityCancel = () => cancelCharge();
  c.onScoreboard = (show) => {
    if (!app.playing) return;
    if (show) app.tut?.notify('score');
    app._sbOpen = show;
    const st = app.net?.lastState;
    if (!st) return;
    app.hud.scoreboard(show, st.ps, st, app.myId, app.myTeam);
  };
  c.onChat = () => {
    if (!app.playing) return;
    if (app.tut?.active && app.tut.inGame && app.tut.current.last) { app.tut.finish(false); return; }
    cancelCharge();
    app.hud.chatOpen((text) => { app.net.chat(text); c.requestLock(); });
  };
  c.onViewToggle = () => {
    if (!app.playing) return;
    app.tut?.notify('view');
    app.cameraMode = app.cameraMode === 'fp' ? 'tp' : 'fp';
    app.sfx.ui();
    app.hud.toast(app.cameraMode === 'tp' ? t('第三人称视角') : t('第一人称视角'), 1200);
  };
  // Crouching and standing both click, matching the view toggle's feedback.
  c.onStance = () => app.sfx.ui();
  c.onLockChange = (locked) => {
    if (locked) { app.mouseFreed = false; app.lockRefused = false; }
    updateLockHint();
  };
  // Report denial without changing the mouse control scheme.
  c.onLookMode = (mode) => {
    if (mode === 'unavailable') {
      app.lockRefused = true;
      app.hud.toast(t('鼠标锁定失败：点击画面重试；若预览禁止锁定，请在新标签页打开'), 6500);
    }
    // Esc: the mouse is free until the player clicks the view again.
    if (mode === 'free') app.mouseFreed = true;
    // Every look-mode change redraws the prompt here rather than leaving it to
    // the next frame: a page whose frame loop is paused (a background tab, a
    // guest whose tab the browser is throttling) still has to show that the
    // mouse was handed back and how to pick the fight up again.
    updateLockHint();
  };
  document.getElementById('game').addEventListener('click', () => {
    if (app.playing && !app.paused) { app.sfx.resume(); app.controls.requestLock(); }
  });
}

/** `wss://broker.emqx.io:8084/mqtt` -> `broker.emqx.io`, for the menu line. */

/** The link a relay host can send: it carries the code into the join field. */
function joinLink(code) {
  try {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('code', String(code).replace(/\D/g, ''));
    return url.toString();
  } catch {
    return `${location.href.split(/[?#]/)[0]}?code=${code}`;
  }
}

/** 12345678 -> "1234 5678" (mirrors hud.formatRoomCode for the toast text). */
const formatCode = (code) => {
  const d = String(code || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
};

// Only the embedding page can grant sandbox pointer-lock permission.
const noLockHint = () => t('鼠标锁定失败：点击画面重试；若预览禁止锁定，请在新标签页打开');
const resumeHint = () => t('已释放光标：点击画面继续（继续后鼠标重新被锁定，按 Esc 再次释放）');

/**
 * Drives the one prompt slot every frame:
 *  - pointer lock available and not held -> the big "click the screen" prompt;
 *  - pointer lock refused -> the same slot, saying why and offering a tab of
 *    its own (the button lives in the slot, see hud.setLockHint).
 */
function updateLockHint(alive = true) {
  const c = app.controls;
  if (c.mobileMode) { app.hud.setLockHint(false); return; }
  // The pause menu owns the screen while it is up: no prompt underneath it.
  const live = app.playing && !app.paused && alive && !app.deathShown;
  if (live && !c.canLook && app.lockRefused) {
    app.hud.setLockHint(true, noLockHint(), t('无法锁定鼠标'), true);
    return;
  }
  if (live && !c.canLook && app.mouseFreed) {
    app.hud.setLockHint(true, resumeHint(), t('光标已释放'));
    return;
  }
  app.hud.setLockHint(live && !c.canLook);
}

// ---------------------------------------------------------------- net events

function onState(st) {
  app.hud.updateTopbar(st);
  app.objectiveView?.setState(st);

  // suppression is authored server-side on my own roster entry
  const mine = st.ps && st.ps.find((p) => p.i === app.myId);
  app.suppressed = !!(mine && mine.sp);
  app.hud.setSuppressed(app.suppressed);

  if (st.phase === 'ended') {
    if (!app.resultShown) {
      app.resultShown = true;
      recordMatchResult(st);
      app.hud.result(st, st.ps, app.myId);
      app.hud.scoreboard(false, [], st, app.myId, app.myTeam);
      app.controls.releaseLock();
    }
  } else if (app.resultShown) {
    app.resultShown = false;
    app.hud.hideResult();
    clearEffects();
  }

  if (app._sbOpen) app.hud.scoreboard(true, st.ps, st, app.myId, app.myTeam);
}

function onMe(me) {
  app.shieldUntil = performance.now() + (me.shieldMs || 0);
  if (me.recovery && me.recovery.seq !== app.lastRecoverySeq) {
    app.lastRecoverySeq = me.recovery.seq;
    app.controls.recoverPosition(me.recovery.p);
  }
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

  app.lastReloading = !!me.reloading;
  app.vm.syncReload(me.reloadTotal || data.weaponById[me.w].reloadMs, me.reloadIn, !!me.reloading);

  const alive = !!me.alive;
  if (alive && !app.wasAlive) {
    app.hud.hideDeath();
    app.boltWait = false;
    app.pendingBolt = null;
    app.controls.requestLock();
  }
  app.wasAlive = alive;

  if (!alive) {
    clearFlash();
    cancelCharge();
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
        if (m.zone === 'fire') app.hud.toast(t('遭受燃烧伤害'), 1000);
        if (m.zone === 'blast') app.hud.toast(t('遭受爆炸冲击'), 1200);
      }
      break;
    }
    case 'kill': {
      app.hud.addKill(m.k, m.v, m.w, m.head, app.myId);
      if (m.v.id === app.myId) {
        app.killedBy = { name: m.k.n, weaponName: nameOf(data.weaponById[m.w] || data.grenadeById[m.w] || { name: m.w }) };
        app.sfx.death();
      } else if (m.k.id === app.myId) {
        app.sfx.kill();
        app.hud.toast(m.head ? t('爆头击杀！') : t('击杀 +1'), 1100);
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
    case 'flash':
      if (app.playing && !app.paused && app.net?.lastMe?.alive) {
        const now = performance.now(), old = app.flash;
        app.flash = { start: now, dur: Math.max(100, m.ms || 0, old ? old.dur-(now-old.start) : 0),
          strength: Math.min(1, Math.max(0, m.strength || 0, old?.strength || 0)) };
        document.getElementById('flash-veil').style.opacity = '1';
      }
      break;
    case 'fx':
      spawnEffect(m.fx);
      if (m.fx.by === app.myId && m.fx.k !== 'remove') app.tut?.notify(m.fx.slot === 'grenade' ? 'grenade' : 'ability');
      break;
    case 'chat':
      app.hud.chatLine(m.n, m.tm, m.m);
      break;
    case 'joinError': {
      // The room code was wrong (or the room is full): stay on the menu and say
      // exactly what happened instead of leaving the player on a dead screen.
      const why = {
        lost: t('与房主失去联系（长时间没有动作，或切走了标签页）：回主菜单用同一个房号重进即可'),
        notfound: t('房号不存在：请向房主要正确房号（8 位数字），或自己创建房间'),
        full: t('该房间已满员，换一个房间或自己创建'),
        toomany: t('服务器上房间太多了，稍后再试'),
      }[m.why] || t('无法加入该房间');
      app.hud.screen('menu');
      app.hud.menuError(why);
      app.hud.setRoomMode('join', app.hud.joinCode);
      app.playing = false;
      break;
    }
    case 'map': {
      // Broadcast between rounds: rebuild the scene, then let the spawn messages
      // that follow (one per player) place everyone on the new ground.
      await setMap(m.id);
      if (Array.isArray(m.spawn)) app.controls.reset(m.spawn, m.yaw);
      app.hud.toast(t('地图切换：{name}', { name: nameOf(data.mapById[m.id] || { name: m.name }) }), 2600);
      break;
    }
    case 'full':
      app.hud.menuError(t('服务器已满'));
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
  flare: { kind: 'detonation', proj: 0xff6a4a },
  frag: { kind: 'detonation', proj: 0x687449 },
  incendiary: { kind: 'detonation', proj: 0xdf6b2d },
  flash: { kind: 'detonation', proj: 0xd8dce0 },
};

// The shell a thrown ability spends its flight as. One shared geometry (never
// disposed) with a per-throw material, like the tracers.
const projGeo = new THREE.SphereGeometry(0.09, 8, 6);

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
    persist: !!fx.persist, style, kind: fx.k,
  };

  if (style.kind === 'cloud') {
    Object.assign(rec, buildSmokeCloud(fx));
    // kept so the veil can tell whether the camera is standing in this cloud
    rec.r = fx.r || 0;
    rec.detonation = buildGrenadeEffect(fx, app.world);
    rec.detonation.obj.position.set(0,0,0);
    rec.obj.add(rec.detonation.obj);
  } else if (style.kind === 'crate') {
    Object.assign(rec, buildCrate(fx));
  } else {
    rec.detonation = buildGrenadeEffect(fx, app.world);
    rec.obj = rec.detonation.obj;
  }
  app.fxGroup.add(rec.obj);

  // Use the host's collision/bounce samples, never a client-invented curve.
  // Late joiners receive age so an existing fire does not restart its lifetime.
  const age = Math.max(0, fx.age || 0);
  const flyMs = fx.from && fx.delay > 0 ? fx.delay : 0;
  rec.flyMs = flyMs;
  rec.flyStart = now-age;
  rec.start = now-age+flyMs;
  rec.landed = age >= flyMs;
  rec.playDetonation = flyMs > 0 && age < flyMs;
  if (flyMs > 0 && !rec.landed) {
    rec.flyPath = fx.path;
    rec.flyFrom = new THREE.Vector3(...fx.from);
    rec.flyTo = new THREE.Vector3(...fx.p);
    rec.flyCtrl = throwCurve(rec.flyFrom, rec.flyTo, rec.flyFrom.distanceTo(rec.flyTo)*0.26); // old-host compatibility
    rec.proj = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: style.proj ?? 0xdddddd }));
    rec.proj.position.copy(rec.flyFrom);
    app.fxGroup.add(rec.proj);
    rec.obj.visible = false;
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
function clearFlash() {
  app.flash = null;
  const veil = document.getElementById('flash-veil');
  if (veil) veil.style.opacity = '0';
}

function clearEffects() {
  clearFlash();
  for (const e of app.effects) disposeEffect(e);
  app.effects.length = 0;
}

function updateEffects(now) {
  const veil = document.getElementById('flash-veil');
  if (app.flash && veil) {
    const phase = Math.min(1,Math.max(0,(now-app.flash.start)/app.flash.dur));
    const left = phase < .35 ? 1 : Math.max(0,1-(phase-.35)/.65);
    veil.style.opacity = String(app.flash.strength*left);
    if (!left) app.flash = null;
  }
  for (let i = app.effects.length - 1; i >= 0; i--) {
    const e = app.effects[i];
    // Flight first: while the shell is in the air its payload stays hidden and
    // the effect's own clock has not started yet.
    if (e.flyMs && !e.landed) {
      const f = (now - e.flyStart) / e.flyMs;
      if (f < 1) {
        if (e.flyPath) sampleThrow(e.flyPath, Math.max(0,now-e.flyStart), e.proj.position);
        else bezierPoint(e.flyFrom, e.flyCtrl, e.flyTo, Math.max(0, f), e.proj.position);
        e.proj.rotation.set((now-e.flyStart)*0.006,(now-e.flyStart)*0.009,0);
        e.projLight?.position.copy(e.proj.position);
        continue;
      }
      e.landed = true;
      e.proj.visible = false;
      if (e.projLight) e.projLight.visible = false;
      e.obj.visible = true;
    }
    if (e.playDetonation) {
      e.playDetonation = false;
      // A short pop must get at least one visible frame even after a long GPU
      // stall. This affects only the visual burst, never the host's fuse/damage.
      if (['frag','flash','smoke'].includes(e.kind)) e.detonationStart = now;
      app.sfx.detonate(e.kind, e.obj.position.distanceTo(app.camera.position));
    }
    if (e.detonation) updateGrenadeEffect(e.detonation, now-(e.detonationStart ?? e.start));
    const visualStart = e.kind === 'frag' || e.kind === 'flash' ? (e.detonationStart ?? e.start) : e.start;
    const k = (now - visualStart) / e.dur;
    if (!e.persist && k >= 1) {
      disposeEffect(e);
      app.effects.splice(i, 1);
      continue;
    }
    if (e.puffs) {
      updateSmokeCloud(e, now - e.start);
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
      if (k * (e.density || 0) > deep) deep = k * (e.density || 0);
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
      bgTexture: bg?.isTexture ? bg : null,
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
    if(base.bgTexture)world.scene.background=base.bgTexture;
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
  if(base.bgTexture)world.scene.background=SMOKE_TINT.clone();
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

// Q keeps class abilities; G charges the grenade slot and B selects its type.
// Preview and host share fixed-step gravity, inherited motion and sphere sweeps.
// Fuses start on release (no cooking); losing lock/death/pausing cancels charge.

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

let _arcLine = null;
let _arcRing = null;

function ensureArc() {
  if (_arcLine) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(512 * 3), 3));
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

/** This exact fixed-step preview is mirrored by the host's throw solver. */
function aimThrow(power, kind) {
  const flight = simulateThrow(app.world, app.controls.eye().toArray(), app.controls.aim().toArray(), power, kind,
    app.data.combat.throw, app.data.grenades, [app.controls.vel.x, app.controls.vy, app.controls.vel.z], app.data.combat.maxMoveSpeed);
  return { ...flight, points: flight.path.map(row=>new THREE.Vector3(row[1],row[2],row[3])), impact: new THREE.Vector3(...flight.p) };
}

function beginCharge(source = 'ability') {
  if (!app.playing || app.paused || !app.world || app.charge || !app.controls.canLook) return;
  const me = app.net?.lastMe;
  if (!me?.alive) return;
  if (source === 'grenade' && (me.grenadeIn > 0 || me.grenades === 0)) { app.hud.toast(t('手榴弹补充中'), 1000); return; }
  if (source === 'ability' && me.abilityIn > 0) return;
  app.charge = { t0: performance.now(), source, kind: source === 'grenade' ? app.grenadeKind : app.data.classById[me.c].ability };
}

function releaseCharge(source = 'ability') {
  const charge = app.charge;
  if (!charge || charge.source !== source) return;
  cancelCharge();
  if (!app.playing || app.paused || !app.world || !app.net?.lastMe?.alive || !app.controls.canLook) return;
  const power = Math.min(1, (performance.now()-charge.t0)/app.data.combat.throw.chargeMs);
  app.sfx.ability(charge.kind);
  app.throwAt = performance.now();
  if (source === 'grenade') app.net.grenade(app.controls.aim(), charge.kind, power);
  else app.net.ability(app.controls.aim(), null, power);
}

function cancelCharge() {
  app.charge = null;
  hideArc();
}

/** Runs every frame: inventory readout and a charged Q/G throw preview. */
function updateThrowAim(now) {
  const powerNow = app.charge ? Math.min(1, (now-app.charge.t0)/app.data.combat.throw.chargeMs) : null;
  app.hud?.updateGrenade(app.grenadeKind, app.net?.lastMe, app.charge?.source === 'grenade' ? powerNow : null, app.controls.mobileMode);
  if (!app.charge) return;
  const me = app.net?.lastMe;
  if (!app.playing || !app.world || !me || !me.alive) { cancelCharge(); return; }
  const cfg = app.data.combat.throw;
  const kind = app.charge.kind;
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
  if (app.charge.source === 'ability') app.hud.setAbilityCharge(power);
}

// ------------------------------------------------------------------ tracers

const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
tracerGeo.rotateX(Math.PI / 2);

function spawnTracer(from, to, style) {
  to = clipTracer(app.world, from, to);
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 0.4) return;
  const mat = flatMat(style.tracer.color, { transparent: true, opacity: 0.85, depthWrite: false });
  const mesh = new THREE.Mesh(tracerGeo, mat);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
  // The streak keeps the thick/quick character of its gun: a bolt-action traces
  // a fat, slow line, an SMG a thin one every few rounds.
  mesh.scale.set(style.tracer.width, style.tracer.width, len);
  app.fxGroup.add(mesh);
  app.tracerStats.spawned++;
  app.tracers.push({ mesh, start: performance.now(), dur: style.tracer.ms });
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
  const hit = rayWorld(app.world, origin, dir, maxT);
  return origin.clone().addScaledVector(dir, hit ?? maxT);
}

// ---------------------------------------------------------------- game loop

function loop(now) {
  requestAnimationFrame(loop);
  const frameMs = app.last ? now-app.last : 16;
  app.performance?.update(frameMs,now,app.playing&&!app.paused&&!document.hidden);
  const dt = Math.min(0.05, frameMs / 1000);
  app.last = now;
  // Paused (Esc menu): the clock still runs for the effects that are already in
  // the air, but the match itself is frozen -- no input is sent, and a room
  // this browser is hosting stops advancing for everybody, which is what a
  // pause means.
  app.mobile?.update(app.playing && !app.paused && !app.deathShown && !app.resultShown && !app.hud.inviteOpen && !app.settings?.visible && !document.hidden);
  if (app.playing && !app.paused) tick(dt, now);
  updateTracers(now);
  // Muzzle flashes, smoke, brass and the punch decay all ride one clock.
  app.gunfx?.update(dt);
  updateThrowAim(now);
  updateEffects(now);
  app.objectiveView?.update(app.controls, now, app.playing);
  updateSmokeVision();
  if (app.settings?.visible) app.settings.render(dt);
  app.renderer.render(app.scene, app.camera);
}

// Holding ADS always uses the eye-aligned camera, then restores the selected
// third-person view on release. Shoulder-height zoom alone misses the aim ray.
function thirdPersonView() { return app.cameraMode === 'tp' && !app.controls.ads; }

function tick(dt, now) {
  const me = app.net.lastMe;
  const alive = me ? !!me.alive : true;
  const suppressed = app.suppressed;

  const w = app.data.weaponById[me?.w || app.loadout.weapon];
  app.controls.update(dt, alive, suppressed, !!me?.reloading);

  syncSelfAvatar(dt, alive);

  // Camera follows the client-authoritative position. Third person only moves
  // the eye, never the aim ray, so shooting and the server stay unchanged.
  const eye = app.controls.eye();
  const dir = app.controls.aim();
  const tp = thirdPersonView();
  app.camera.fov = THREE.MathUtils.lerp(app.camera.fov, aimFov(me), Math.min(1, dt * 12));
  app.controls.lookFov = app.camera.fov;
  // Preserve the near plane that clips the borrowed FP body; collision
  // protects its entire near-plane envelope, including widescreen corners.
  app.camera.near = tp ? 0.06 : FP_NEAR;
  const desired = tp ? eye.clone().addScaledVector(dir, -3.1).add(new THREE.Vector3(0, 0.45, 0)) : eye;
  resolveCamera(app.world, eye, desired, app.camera, app.camera.position);
  // A contracted shoulder camera can reach the avatar's face. Hide only the
  // local body there instead of filling the screen with its hair/inside mesh.
  if (tp && app.self && app.camera.position.distanceToSquared(eye) < 0.64) app.self.root.visible = false;
  app.camera.lookAt(app.camera.position.clone().add(dir));
  // in third person the character body replaces the viewmodel
  const scoped = alive && app.controls.ads && w.scope === true;
  document.getElementById('scope-overlay').classList.toggle('hidden', !scoped);
  document.body.classList.toggle('scope-active', scoped);
  app.vm.root.visible = !tp && !scoped;
  app.camera.updateProjectionMatrix();

  // 30 Hz input upload
  app.inputAcc += dt;
  if (app.inputAcc >= 1 / 30) {
    app.inputAcc = 0;
    app.net.input(app.controls.pos, app.controls.yaw, app.controls.pitch, {
      sprint: app.controls.sprinting,
      ads: app.controls.ads,
      crouch: app.controls.crouch,
      move: app.controls.moveSpeed > 0.5,
      ground: app.controls.grounded,
    });
  }

  app.vm.update(dt, {
    ads: app.controls.ads,
    sprinting: app.controls.sprinting,
    moveSpeed: app.controls.moveSpeed,
  });
  syncFpArms();

  // firing — the rate here is a courtesy; the server is the real gate

  // bolt rifles (every one except the straight-pull M95) only chamber the next
  // round after the player has come out of the sights and released the aim
  // button; the M95 works the bolt while still aiming
  if (app.boltWait && !app.controls.mouse.right) app.boltWait = false;
  // Scoped bolt shot: the cycle sound plays the moment the sights come off.
  if (app.pendingBolt && !app.controls.mouse.right) {
    app.sfx.bolt(app.pendingBolt);
    app.pendingBolt = null;
  }

  // A quick touch tap can begin AND end between slow rendered frames. Keep
  // one trigger edge, not an entire extra burst; canceled gestures clear it.
  const trigger = app.controls.mouse.left || app.controls.touchFirePending;
  const wantShot = w.auto ? trigger : (app.clickPending && trigger);
  if (alive && wantShot && (!me?.reloading || (w.clip && me.mag >= 1)) && !app.boltWait && app.controls.canLook && now >= app.nextShot) {
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
  // Recoil moves the real aim, not a disconnected camera-only animation.
  // Updating here makes even a single shot visible in its first rendered frame.
  app.camera.lookAt(app.camera.position.clone().add(app.controls.aim()));
  if (app.gunfx?.punchRoll) app.camera.rotateZ(app.gunfx.punchRoll * Math.PI / 180);
  const shield = document.getElementById('spawn-shield-status');
  const shieldMs = alive ? Math.max(0, (app.shieldUntil || 0) - now) : 0;
  shield.classList.toggle('hidden', shieldMs <= 0);
  shield.textContent = shieldMs > 0 ? t('出生保护 · {seconds}秒', {seconds: Math.ceil(shieldMs/1000)}) : '';
  app.clickPending = false;
  app.controls.touchFirePending = false;

  // footstep audio
  if (alive && app.controls.grounded && app.controls.moveSpeed > 1.2) {
    app.stepDist += app.controls.moveSpeed * dt;
    if (app.stepDist > 2.0) { app.stepDist = 0; app.sfx.step(); }
  }

  updateRemotePlayers(dt, me);

  updateCrosshair(w, suppressed);
  updateLockHint(alive);
  app.tut?.update(dt, {
    speed: app.controls.moveSpeed,
    yaw: app.controls.yaw,
    ads: app.controls.ads,
    crouch: app.controls.crouch,
    airborne: !app.controls.grounded,
    objectivesOwned: app.net.lastState?.gameMode === 'control' ? app.net.lastState.s[app.myTeam] : 0,
  });
}

function aimFov(me) {
  const w = app.data.weaponById[me?.w || app.loadout.weapon];
  const base = 78;
  return app.controls.ads ? w.zoomFov : base;
}

function fireOnce(w, eye, dir) {
  app.net.fire(eye, dir);
  app.tut?.notify('fire');
  app.fireAt = performance.now();
  // Everything about the shot that the player can see or hear comes from the
  // weapon's own fx block (gunfx.js): recoil, flash, smoke, brass, punch and the
  // sound's own trim. Two guns of the same shape are meant to feel different.
  const style = gunStyle(w);
  app.vm.kick(style.kick.vm);
  // Apply this shot's pose before reading sockets, not one frame afterwards.
  app.vm.update(0, { ads: app.controls.ads, sprinting: app.controls.sprinting, moveSpeed: app.controls.moveSpeed });
  syncFpArms();
  if (w.shape === 'bolt') app.vm.cycleBolt(w.straightPull ? 520 : 700);
  app.sfx.shot(w, style);
  if (w.shape === 'bolt' && !w.straightPull) {
    // The bolt is worked a beat after the shot -- or, while scoped, exactly when
    // the player drops out of the sights, which is when the cycle really happens.
    if (app.controls.mouse.right) app.pendingBolt = w;
    else setTimeout(() => app.sfx.bolt(w), BOLT_SOUND_DELAY_MS);
  }

  const end = rayEnd(eye, dir);
  // Visuals leave the actual animated barrel; ballistics stay on eye/aim.
  const from = new THREE.Vector3();
  const eject = new THREE.Vector3();
  let attachment = null;
  if (thirdPersonView()) {
    if (!app.self?.muzzleWorld(from)) from.copy(eye);
    if (!app.self?.ejectWorld?.(eject)) eject.copy(from);
    attachment = app.self?.root.getObjectByName('weapon-muzzle') || null;
  } else {
    if (!app.vm.shotWorld(from, eject) || from.distanceTo(eye) > 3) {
      from.copy(eye); eject.copy(eye);
    } else attachment = app.vm.muzzle;
  }
  if (!safeMuzzle(app.world, eye, from)) attachment = null;
  const barrelDir = attachment ? attachment.getWorldDirection(new THREE.Vector3()) : dir;
  app.gunfx.fire(w, from, barrelDir, { eject, attachment });
  const rounds = (app.shotRounds[w.id] = (app.shotRounds[w.id] || 0) + 1);
  if (tracerRound(style, rounds)) spawnTracer(from, end, style);
  app.controls.applyRecoil(style.kick);
}

function updateCrosshair(w, suppressed) {
  const move = app.controls.moveSpeed / (app.controls.combat.maxMoveSpeed || 9.5);
  const spread = w.spreadDeg * 7.0 + move * 11 + (app.controls.grounded ? 0 : 7) + (suppressed ? 9 : 0);
  const adsFactor = app.controls.ads ? 0.25 : 1;
  app.hud.crosshair(Math.max(3, spread * adsFactor));
  app.hud.el.crosshair.style.opacity = '1';
  app.hud.el.crosshair.classList.toggle('aiming', app.controls.ads);
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
  app.self.root.visible = alive && thirdPersonView();
  app.self.root.position.copy(c.pos);
  app.self.root.rotation.y = yawToRotation(c.yaw);
  updateContactShadow(app.self, app.world, alive && app.self.root.visible);
  updateSpawnShield(app.self, alive && (app.shieldUntil || 0) > performance.now());
  // First person already solves a separate pair of arms. Do not animate a
  // second, invisible full-body rig every frame as well.
  if (!app.self.root.visible) return;
  // Upper-body layer state. The server only tells us about reloads; firing and
  // the throw are local, so they are timed off the wall clock here. Each pose is
  // held for a short window after the input ends so the clip can finish rather
  // than snapping back mid-gesture.
  const me = app.net.lastMe;
  const tnow = performance.now();
  app.self.update(dt, {
    speed: c.moveSpeed,
    sprint: c.sprinting,
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
const _fpGunRotation = new THREE.Quaternion();

function syncFpArms() {
  if (!app.playing) return;
  if (thirdPersonView() || document.body.classList.contains('scope-active')) {
    if (app.fpArms) app.fpArms.holder.visible = false;
    return;
  }

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

  // camera first: the viewmodel hangs off it, so its world matrices must be
  // current before the two anchors can be read out
  app.camera.updateMatrixWorld(true);
  let ok = false;
  if (app.vm.gripWorld(_fpHand, _fpFore, _fpGunRotation)) {
    ok = app.fpArms.poseArms(_fpHand, _fpFore, _fpGunRotation);
  }
  // Do not draw two pairs, or keep a visibly disconnected external hand when
  // a petite rig cannot reach the support grip during a reload.
  app.fpArms.holder.visible = ok;
  if (app.vm.armMeshes) app.vm.armMeshes.visible = !ok;
}

const _shotFrom = new THREE.Vector3();
const _shotDir = new THREE.Vector3();

/** Server angle convention (yaw 0 = +X, pitch up positive) -> unit vector. */
function aimFromAngles(out, yawDeg, pitchDeg) {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const cp = Math.cos(p);
  return out.set(Math.cos(y) * cp, Math.sin(p), Math.sin(y) * cp).normalize();
}

const remoteFrustum = new THREE.Frustum(), remoteView = new THREE.Matrix4();
const remoteSphere = new THREE.Sphere(new THREE.Vector3(),2);
function updateRemotePlayers(dt, me) {
  app.camera.updateMatrixWorld(true);
  remoteFrustum.setFromProjectionMatrix(remoteView.multiplyMatrices(app.camera.projectionMatrix, app.camera.matrixWorldInverse));
  const poses = app.net.sample();
  const seen = new Set();
  // Distant gunfire is capped per frame: twelve bots firing together must not
  // turn into a wall of noise.
  app.remoteShots = 3;

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
    const rw = app.data.weaponById[p.weapon] || app.data.weaponsByClass[cls.id][0];
    girl.setWeapon(rw);
    girl.setAlive(!!p.alive);
    updateSpawnShield(girl, !!p.alive && p.shieldMs > 0);
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
      const desiredYaw = yawToRotation(p.yaw);
      const turn = Math.atan2(Math.sin(desiredYaw-girl.root.rotation.y),Math.cos(desiredYaw-girl.root.rotation.y));
      girl.root.rotation.y += turn*(1-Math.exp(-20*dt));
      remoteSphere.center.set(p.x,p.y+.9,p.z);
      const visible = remoteFrustum.intersectsSphere(remoteSphere);
      const becameVisible = visible && !girl.root.visible;
      girl.root.visible = visible;
      girl.poseElapsed = Math.min(.2,(girl.poseElapsed||0)+dt);
      const distance = girl.root.position.distanceTo(app.camera.position);
      if (visible && (becameVisible || girl.poseElapsed+1e-6 >= poseInterval(distance))) {
        girl.update(girl.poseElapsed, {
          speed: p.speed, sprint: (p.flags & 2) !== 0,
          crouch: (p.flags & 1) !== 0, pitch: p.pitch,
        });
        girl.poseElapsed=0;app.performance.stats.poseUpdates++;
      } else app.performance.stats.poseSkips++;
    } else girl.root.visible=false;
    updateContactShadow(girl, app.world, !!p.alive && girl.root.visible);
    // Read sockets AFTER the live avatar pose. Accepted-shot sequences avoid
    // missing bolt shots between snapshots or repeating one shot's flag pulse.
    if (remoteShotDue(girl, p, rw, performance.now()) && girl.muzzleWorld?.(_shotFrom)) {
      let attachment = girl.root.getObjectByName('weapon-muzzle');
      const eye = new THREE.Vector3(p.x, p.y + ((p.flags & 1) ? app.data.combat.crouchEyeHeight : app.data.combat.standEyeHeight), p.z);
      if (!safeMuzzle(app.world, eye, _shotFrom)) attachment = null;
      if (attachment) attachment.getWorldDirection(_shotDir);
      else aimFromAngles(_shotDir, p.yaw, p.pitch);
      const eject = new THREE.Vector3();
      if (!girl.ejectWorld?.(eject)) eject.copy(_shotFrom);
      app.gunfx?.remote(rw, _shotFrom, _shotDir, { eject, attachment });
      const style = gunStyle(rw);
      if (tracerRound(style, p.shotSeq ?? Math.round(performance.now() / (60000 / rw.rpm)))) {
        const direction = aimFromAngles(new THREE.Vector3(), p.yaw, p.pitch);
        spawnTracer(_shotFrom, rayEnd(eye, direction), style);
      }
      const dist = _shotFrom.distanceTo(app.camera.position);
      if (dist < 90 && app.remoteShots > 0) { app.remoteShots--; app.sfx.shotFar(rw, style, dist); }
    }

  }

  for (const [id, girl] of app.remotes) {
    if (!seen.has(id)) { girl.destroy(); app.remotes.delete(id); }
  }
}

boot();
