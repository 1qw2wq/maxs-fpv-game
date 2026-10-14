// The in-page engine: the Python game server's own ruleset, running in this tab.
//
// A static host (Vercel and friends) hands out files but cannot run
// server/server.py -- no socket upgrade, no 30 Hz loop, no memory shared
// between requests. So the page runs that same server itself: Pyodide boots
// public/engine/*.py in a WebAssembly Python, public/engine/host.py drives the
// very same room.Room the aiohttp host drives, and this class feeds what that
// room produces into the client's ordinary message switch. Bots, ballistics,
// abilities, scoring and the map vote are therefore the server's code, not a
// second implementation that could drift from it.
//
// LocalNet is a Net with its socket swapped for that room: identical public
// surface (connect / join / input / fire / sample / lastMe), so main.js and the
// render loop cannot tell which transport a match arrived on.
//
// The same engine also serves *other people* when this page is the host of a
// relay room (public/js/relay.js, class RelayHostNet): host.py's RelayHost keeps
// one sink per player, and the three `_engine*` hooks below are all that has to
// change to turn a local match into a hosted one.

import { Net } from './net.js';
import { t } from './i18n.js';

// Paths are resolved against this module rather than against the site root, so
// a copy of the game served from a sub-path still finds its own files.
const PYODIDE_DIR = new URL('../vendor/pyodide/', import.meta.url);
const ENGINE_DIR = new URL('../engine/', import.meta.url);
const SHARED_DIR = new URL('../shared/', import.meta.url);

// Everything combat.py / bots.py / game.py / room.py import, plus the driver.
const ENGINE_FILES = ['combat.py', 'bots.py', 'game.py', 'room.py', 'host.py'];
const SHARED_FILES = ['weapons.json', 'maps.json', 'map.json'];

/** Battlefield JSON/JS in the engine's own layout. A 404 names the file. */
async function text(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/**
 * `/shared/maps/x.json` (how maps.json lists its own files) -> a URL on this
 * site. Anything else is already a URL and is used as given.
 */
function sharedUrl(file) {
  const rel = String(file || '');
  return rel.startsWith('/shared/')
    ? new URL(rel.slice('/shared/'.length), SHARED_DIR).href
    : rel;
}

// The interpreter is a page-level singleton: it costs a 9 MB wasm download plus
// 2.5 MB of stdlib, so a second deploy (a reconnect, a map change and rejoin)
// reuses it and only builds a fresh room. `fail` remembers a boot that cannot
// work, so a retry fails at once instead of downloading it all again.
let engineReady = null;
let engineFail = null;

function bootEngine(note) {
  if (engineFail) return Promise.reject(engineFail);
  if (!engineReady) {
    engineReady = boot(note).catch((err) => {
      engineFail = err;
      engineReady = null;
      throw err;
    });
  }
  return engineReady;
}

async function boot(note) {
  note?.(t('正在加载浏览器内引擎（首次约 12 MB，之后有缓存）…'));
  let mod;
  try {
    mod = await import(/* @vite-ignore */ PYODIDE_DIR.href + 'pyodide.mjs');
  } catch (err) {
    throw new Error(t('嵌入引擎不可用（{url}）：{why}',
      { url: `${PYODIDE_DIR.href}pyodide.mjs`, why: err.message }));
  }
  const py = await mod.loadPyodide({
    indexURL: PYODIDE_DIR.href,
    // console noise from the engine is genuine diagnostics: keep it, and keep
    // it out of the page's own log lines.
    stdout: (line) => console.debug('[engine]', line),
    stderr: (line) => console.warn('[engine]', line),
  });

  note?.(t('正在装载战场数据…（本地引擎）'));
  const [engineSrc, sharedSrc] = await Promise.all([
    Promise.all(ENGINE_FILES.map((f) => text(new URL(f, ENGINE_DIR).href))),
    Promise.all(SHARED_FILES.map((f) => text(new URL(f, SHARED_DIR).href))),
  ]);
  const registry = JSON.parse(sharedSrc[1]);
  // Every map the menu can offer has to be in the upload; fetching them all up
  // front is what makes a later map pick (or a between-rounds vote) instant.
  const mapSrc = await Promise.all((registry.maps || []).map((m) => text(sharedUrl(m.file))));

  for (const dir of ['/engine', '/shared', '/shared/maps']) {
    try { py.FS.mkdirTree(dir); } catch { /* already there */ }
  }
  ENGINE_FILES.forEach((f, i) => py.FS.writeFile(`/engine/${f}`, engineSrc[i]));
  SHARED_FILES.forEach((f, i) => py.FS.writeFile(`/shared/${f}`, sharedSrc[i]));
  (registry.maps || []).forEach((m, i) => {
    // combat.py resolves each map through its own `file` field, which is a
    // /shared/... path inside the interpreter's filesystem just as on a server.
    const rel = String(m.file || '').startsWith('/shared/')
      ? String(m.file).slice('/shared/'.length)
      : m.file;
    py.FS.writeFile(`/shared/${rel}`, mapSrc[i]);
  });

  note?.(t('正在启动引擎…'));
  py.runPython(`
import json, sys
sys.path.insert(0, '/engine')
import combat, host as _host_mod

# A deployment whose JSON and Python disagree must say so here, with the
# reasons, instead of failing later inside a firefight.
_problems = combat.validate_shared_data()
if _problems:
    raise RuntimeError('ENGINE_DATA: ' + '; '.join(str(x) for x in _problems)[:400])

_registry = json.loads(open('/shared/maps.json', encoding='utf-8').read())
for _m in _registry.get('maps', []):
    combat.set_map(_m['id'])          # every offered map must really load
combat.set_map(_registry.get('default') or combat.DEFAULT_MAP_ID)

# One room at a time lives here; a fresh connect builds a fresh one (local_reset)
# so a rejoin never inherits the previous match's scoreboard.
_host = _host_mod.Host()
# The relay host: the same room, one sink per player, frames tagged with who
# they belong to (see host.RelayHost). Used when this page hosts multiplayer on
# a static deployment.
_relay = _host_mod.RelayHost()

def local_start(text):
    return _host.start(text)

def local_cmd(text):
    return _host.command(text)

def local_step(ms):
    return _host.step(ms)

def local_status():
    return _host.status()

def local_reset():
    global _host
    _host = _host_mod.Host()

def relay_start(text, code):
    return _relay.start(text, code)

def relay_join(sid, text):
    return _relay.join(sid, text)

def relay_cmd(sid, text):
    return _relay.command(sid, text)

def relay_leave(sid):
    return _relay.leave(sid)

def relay_step(ms):
    return _relay.step(ms)

def relay_status():
    return _relay.status()

def relay_reset():
    global _relay
    _relay = _host_mod.RelayHost()
`);

  const g = py.globals;
  return {
    py,
    start: g.get('local_start'),
    cmd: g.get('local_cmd'),
    step: g.get('local_step'),
    status: g.get('local_status'),
    reset: g.get('local_reset'),
    relayStart: g.get('relay_start'),
    relayJoin: g.get('relay_join'),
    relayCmd: g.get('relay_cmd'),
    relayLeave: g.get('relay_leave'),
    relayStep: g.get('relay_step'),
    relayStatus: g.get('relay_status'),
    relayReset: g.get('relay_reset'),
  };
}

export class LocalNet extends Net {
  constructor(handlers = {}) {
    super(handlers);
    this.mode = 'local';
    this._engine = null;
    this._queue = [];
    this._stepMs = 1000 / 30;
    this._acc = 0;
    this._last = 0;
    this._raf = null;
    this._joined = false;
  }

  /**
   * Boot the engine and start the tick loop. `url` is unused -- the local
   * engine is addressed by the page itself; the signature matches Net.connect
   * so main.js can treat both candidate servers the same way.
   */
  async connect(url, opts = {}) {
    this._closed = false;
    this._engine = await bootEngine(this.h.onNote);
    if (this._closed) throw new Error(t('已取消'));
    this._engineReset();
    // A fresh match: the previous one's snapshots would otherwise be sampled
    // into the first frames of this one.
    this.snaps.length = 0;
    this._lastState = null;
    this._lastMe = null;
    this._queue.length = 0;
    this._joined = false;
    this._acc = 0;
    this._last = performance.now();
    this.mode = 'local';
    this.connected = true;
    this.h.onOpen?.();
    this.paused = false;
    this._frame();
    return 'local';
  }

  /** Ping is a no-op here: the room runs 0 ms from the page. */
  _startPing() {}

  /** Outgoing messages wait for the next tick, where they keep their order. */
  send(obj) {
    if (this._closed || !this.connected) return false;
    this._queue.push(obj);
    return true;
  }

  /**
   * The first join creates the room (host.start); anything later -- a rejoin
   * after a reload, an address change -- is an ordinary message to it.
   */
  join(name, cls, weapon, bots, botCount, skin, solo, mapId, sid, room) {
    const msg = {
      t: 'join', name, cls, weapon, bots, botCount, skin: skin || '',
      solo: !!solo, map: mapId, sid: sid || '', room: room || '',
    };
    if (this._joined) { this.send(msg); return; }
    this._joined = true;
    try {
      // A relay room's engine answers with frames tagged by seat (see
      // relay.js); _ownFrames keeps the ones meant for this player.
      const frames = this._ownFrames(JSON.parse(this._engineStart(msg)));
      // The tick loop follows the engine's own tickRate, so a slower device
      // steps the same match at the same speed rather than in slow motion.
      const welcome = frames.map((f) => {
        try { return JSON.parse(f); } catch { return null; }
      }).find((m) => m && m.t === 'welcome');
      const tick = Number(welcome?.cfg?.tickRate || welcome?.tickRate || 0);
      if (tick > 0) {
        this._stepMs = 1000 / tick;
        this._last = performance.now();
        this._acc = 0;
      }
      this._dispatchBatch(frames, performance.now());
    } catch (err) {
      // Nothing else can happen if the room would not open, and the menu's
      // error line is the only place the player will look.
      console.error('[trench] the in-page engine refused to start the match', err);
      this.h.onError?.(t('浏览器内引擎无法开局'));
      this._joined = false;
    }
  }

  /** Diagnostics for the HUD, the console and the tests. */
  status() {
    if (!this._engine) return null;
    try { return JSON.parse(this._engineStatus()); } catch { return null; }
  }

  // ------------------------------------------------------- the engine, wrapped
  //
  // Three calls, deliberately small: a relay room (relay.js, RelayHostNet) is
  // this class with a room that has several players in it, so that is all it
  // has to replace.

  _engineReset() { this._engine.reset(); }
  _engineStart(msg) { return this._engine.start(JSON.stringify(msg)); }
  /** The frames this player should see out of an engine answer. */
  _ownFrames(frames) { return frames; }
  _engineCmd(msg) { return this._engine.cmd(JSON.stringify(msg)); }
  _engineStep(ms) { return this._engine.step(ms); }
  _engineStatus() { return this._engine.status(); }
  /** Runs right after each stepped batch; the relay host publishes it here. */
  _afterStep() {}

  // ---------------------------------------------------------------- the tick

  _frame() {
    if (this._closed || !this.connected) return;
    if (this.paused) {
      // Esc's pause menu: the room this tab is running stops advancing (which is
      // what a pause means for a hosted match), and the clock is reset so the
      // first frame after resuming does not try to catch up on lost time.
      this._last = performance.now();
      requestAnimationFrame(() => this._frame());
      return;
    }
    const now = performance.now();
    // A backgrounded tab stops being drawn, so its clock can jump by seconds;
    // the match must not fast-forward through them (the loop below caps this
    // anyway, but the accumulator is what would otherwise grow without bound).
    let dt = Math.min(now - this._last, 250);
    this._last = now;
    this._acc += dt;

    let ticks = 0;
    while (this._acc >= this._stepMs && ticks < 6) {
      this._acc -= this._stepMs;
      ticks += 1;
      this._flush();
      this._eat(this._engineStep(this._stepMs));
      this._afterStep();
    }
    // A click between two ticks should not wait for the next frame, so pending
    // input goes out even on a frame that ran no tick.
    if (!ticks) this._flush();

    this._raf = requestAnimationFrame(() => this._frame());
  }

  /** Hand queued messages to the room, in order, and dispatch its answers. */
  _flush() {
    while (this._queue.length) {
      const msg = this._queue.shift();
      try {
        this._eat(this._engineCmd(msg));
      } catch (err) {
        console.error('[trench] the engine rejected a message', msg, err);
      }
    }
  }

  /** One batch of JSON strings, exactly as the socket would have delivered. */
  _eat(text) {
    let frames;
    try { frames = JSON.parse(text); } catch { return; }
    if (Array.isArray(frames) && frames.length) this._dispatchBatch(frames, performance.now());
  }

  close() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    // The interpreter is shared and expensive; only this match goes away. The
    // room object itself is rebuilt by the next connect (local_reset).
    this._queue.length = 0;
    super.close();
  }
}
