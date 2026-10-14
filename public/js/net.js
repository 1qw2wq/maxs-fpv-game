// WebSocket client plus the remote-player interpolation buffer.
//
// The server broadcasts 20 snapshots a second. Rendering them as they arrive
// looks like a slideshow, so every remote girl is drawn 120 ms in the past,
// interpolated between the two snapshots that bracket that moment. That single
// trick removes almost all of the "I hit her but nothing happened" feeling.
//
// Transport: /ws is tried first, and if that cannot be opened the client falls
// back to the HTTP long-poll endpoint (/api/poll), which carries the very same
// JSON messages over POSTs. A hosted preview or a strict HTTP proxy in front of
// the game can refuse the WebSocket Upgrade; before this fallback such a page
// could not join a match at all, it only ever showed 无法连接服务器.

import { t } from './i18n.js';

const TAU = Math.PI * 2;
const WS_TIMEOUT_MS = 6000;
const POLL_RETRY_MS = 400;

// (the parameter is not called `t`: that name is the translator in every
// module that imports it, and a local of the same name would shadow it.)
function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * k;
}

/** `ws://host/ws` -> `http://host/api/poll` (and wss -> https). */
function pollEndpoint(wsUrl) {
  return wsUrl.replace(/^ws/, 'http').replace(/\/ws(\?.*)?$/, '/api/poll');
}

function randomSid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `?transport=poll` (or ws) in the page URL forces a transport, for testing. */
function forcedTransport() {
  try {
    return new URLSearchParams(location.search).get('transport');
  } catch {
    return null;
  }
}

export class Net {
  constructor(handlers = {}) {
    this.h = handlers;
    this.ws = null;
    this.id = null;
    this.team = 0;
    this.connected = false;
    // 'ws' or 'poll'; also readable by the caller to tell the player which one
    // actually carried the match.
    this.mode = 'ws';
    this.snaps = [];
    this.maxSnaps = 40;
    this.interpDelay = 120;
    this.ping = 0;
    this._pingSent = 0;
    this._pingTimer = null;
    this._lastMe = null;
    this._lastState = null;
    this._outbox = [];
    this._closed = false;
    this._wsTimer = null;
    this._pollSid = '';
  }

  /**
   * @param {string} url  ws:// or wss:// address of /ws
   * @param {{sid?: string, transport?: 'ws'|'poll', timeoutMs?: number}} [opts]
   *   `timeoutMs` shortens the handshake wait: a page deciding whether it is a
   *   static deployment can afford 1.5 s, not the 6 s a real match gets.
   * @returns {Promise<'ws'|'poll'>} the transport that ended up carrying the game
   */
  async connect(url, opts = {}) {
    this._closed = false;
    // Identity of this poll session. Deliberately fresh per page load: a reload
    // must look like a new client so the join's own tab id can evict the page
    // it replaced, instead of colliding with the entry still registered on the
    // server (which would silently ignore the new join).
    this._pollSid = opts.sid || randomSid();
    const force = opts.transport || forcedTransport();
    if (force === 'poll') {
      await this._connectPoll(url);
      return 'poll';
    }
    try {
      await this._connectWs(url, opts.timeoutMs);
      this.mode = 'ws';
      return 'ws';
    } catch (err) {
      if (this._closed) throw err;
      this.ws = null;
      await this._connectPoll(url);
      return 'poll';
    }
  }

  _connectWs(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) { reject(err); return; }
      this.ws = ws;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(this._wsTimer);
        reject(err || new Error(t('无法连接服务器')));
      };
      // A proxy that accepts the request but never upgrades leaves this hanging,
      // so the fallback must not wait forever for an answer that never comes.
      clearTimeout(this._wsTimer);
      this._wsTimer = setTimeout(() => fail(new Error(t('WebSocket 超时'))), timeoutMs || WS_TIMEOUT_MS);

      ws.onopen = () => {
        if (settled || this._closed) return;
        settled = true;
        clearTimeout(this._wsTimer);
        this.connected = true;
        this.mode = 'ws';
        this.h.onOpen?.();
        resolve();
      };
      ws.onerror = () => {
        if (!settled) { fail(new Error(t('无法连接服务器'))); return; }
        this.h.onError?.(t('连接出错'));
      };
      ws.onclose = () => {
        if (!settled) { fail(new Error(t('无法连接服务器'))); return; }
        this.connected = false;
        if (this.mode === 'ws') this.h.onClose?.();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this._dispatch(msg);
      };
    });
  }

  // ------------------------------------------------------- long-poll fallback

  async _connectPoll(wsUrl) {
    this.mode = 'poll';
    const endpoint = pollEndpoint(wsUrl);
    // One round-trip before declaring success, so a dead address still fails
    // loudly instead of looking connected and never playing.
    const first = await this._pollOnce(endpoint, []);
    this.connected = true;
    this.h.onOpen?.();
    this._dispatchBatch(first, performance.now());
    this._pollLoop(endpoint);
  }

  async _pollOnce(endpoint, msgs) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: this._pollSid, msgs }),
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.msgs) ? data.msgs : [];
  }

  async _pollLoop(endpoint) {
    let fails = 0;
    let reported = false;
    while (!this._closed) {
      const batch = this._outbox.splice(0, 64);
      let msgs;
      try {
        msgs = await this._pollOnce(endpoint, batch);
      } catch (err) {
        if (this._closed) return;
        // Put the unsent messages back at the front: order is what makes the
        // join/welcome handshake work.
        this._outbox.unshift(...batch);
        fails += 1;
        // A couple of missed round-trips are normal; only a run of them means
        // the server is really gone, and then the player is told once. The
        // loop keeps trying either way, so a restart of the server is picked
        // up on its own.
        if (fails >= 6 && this.connected) {
          this.connected = false;
          reported = true;
          this.h.onClose?.();
        }
        await sleep(POLL_RETRY_MS);
        continue;
      }
      fails = 0;
      this.connected = true;
      if (reported) {
        reported = false;
        this.h.onOpen?.();
      }
      this._dispatchBatch(msgs, performance.now());
    }
  }

  /**
   * Hand a whole poll response to the message switch. The server queues the
   * same serialised JSON it would have pushed down the socket, so each entry
   * needs parsing here; a batch can also hold several snapshots that all
   * arrived at once, so they get stamped a snapshot apart to keep the
   * interpolation buffer meaningful.
   */
  _dispatchBatch(msgs, now) {
    msgs.forEach((raw, i) => {
      let m = raw;
      if (typeof raw === 'string') {
        try { m = JSON.parse(raw); } catch { return; }
      }
      if (!m || typeof m !== 'object') return;
      const step = m.t === 'state' ? (msgs.length - 1 - i) * 25 : 0;
      this._dispatch(m, now - step);
    });
  }

  _dispatch(m, at) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.team = m.team;
        this.interpDelay = m.cfg?.interpDelayMs ?? 120;
        this.rtt = m.cfg || null;
        this.h.onWelcome?.(m);
        this._startPing();
        break;
      case 'state':
        this.snaps.push({ t: at ?? performance.now(), s: m });
        if (this.snaps.length > this.maxSnaps) this.snaps.shift();
        this._lastState = m;
        this.h.onState?.(m);
        break;
      case 'me':
        this._lastMe = m;
        this.h.onMe?.(m);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - this._pingSent);
        break;
      default:
        this.h.onMessage?.(m);
    }
  }

  _startPing() {
    if (this._pingTimer) return;
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;
      this._pingSent = performance.now();
      // The measured RTT rides along so the server can size its rewind window.
      this.send({ t: 'ping', c: Date.now(), rtt: Math.round(this.ping || 0) });
    }, 2000);
  }

  send(obj) {
    if (this.mode === 'poll') {
      this._outbox.push(obj);
      return true;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------- outgoing

  /**
   * @param {string} room  8-digit code to join, or '' to host a new room
   */
  join(name, cls, weapon, bots, botCount, skin, solo, mapId, sid, room) {
    this.send({
      t: 'join', name, cls, weapon, bots, botCount, skin: skin || '',
      solo: !!solo, map: mapId, sid: sid || '', room: room || '',
    });
  }

  setBots(on, n) {
    this.send({ t: 'bots', on, n });
  }

  input(pos, yaw, pitch, flags) {
    this.send({ t: 'input', p: [r2(pos.x), r2(pos.y), r2(pos.z)], r: [r2(yaw), r2(pitch)], s: flags });
  }

  fire(origin, dir) {
    this.send({ t: 'fire', o: [r2(origin.x), r2(origin.y), r2(origin.z)], d: [r3(dir.x), r3(dir.y), r3(dir.z)] });
  }

  reload() { this.send({ t: 'reload' }); }
  /** Ability cast. `land` is the aim preview's landing point for a thrown one. */
  ability(dir, land) {
    const msg = { t: 'ability' };
    if (dir) msg.d = [r3(dir.x), r3(dir.y), r3(dir.z)];
    if (land) msg.p = [r2(land.x), r2(land.y), r2(land.z)];
    this.send(msg);
  }
  respawn(cls, weapon) { this.send({ t: 'respawn', c: cls, w: weapon }); }
  chat(text) { this.send({ t: 'chat', m: text }); }

  // -------------------------------------------------- interpolation sampling

  /**
   * Remote player poses at `performance.now() - interpDelay`.
   * @returns {Map<number, {x:number,y:number,z:number,yaw:number,pitch:number,prevX:number,prevZ:number,speed:number}>}
   */
  sample() {
    const out = new Map();
    const snaps = this.snaps;
    if (!snaps.length) return out;
    const target = performance.now() - this.interpDelay;

    let a = snaps[snaps.length - 1];
    let b = null;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].t <= target) { a = snaps[i - 1]; b = snaps[i]; break; }
    }
    if (!b) { a = snaps[Math.max(0, snaps.length - 1)]; b = a; }

    const span = Math.max(1, b.t - a.t);
    const k = Math.max(0, Math.min(1, (target - a.t) / span));

    const index = (snap) => {
      const map = new Map();
      for (const p of snap.s.ps || []) map.set(p.i, p);
      return map;
    };
    const A = index(a);
    const B = (b === a) ? A : index(b);

    for (const [id, pb] of B) {
      const pa = A.get(id) || pb;
      const dt = Math.max(0.001, (b.t - a.t) / 1000);
      const dx = pb.p[0] - pa.p[0];
      const dz = pb.p[2] - pa.p[2];
      out.set(id, {
        x: pa.p[0] + (pb.p[0] - pa.p[0]) * k,
        y: pa.p[1] + (pb.p[1] - pa.p[1]) * k,
        z: pa.p[2] + (pb.p[2] - pa.p[2]) * k,
        yaw: lerpAngle((pa.y * Math.PI) / 180, (pb.y * Math.PI) / 180, k) * 180 / Math.PI,
        pitch: pa.pi + (pb.pi - pa.pi) * k,
        speed: Math.hypot(dx, dz) / dt,
        flags: pb.f,
        alive: pb.al,
        name: pb.n, cls: pb.c, weapon: pb.w, team: pb.tm, skin: pb.sk || '',
        hp: pb.hp, kills: pb.k, deaths: pb.d,
        reveal: pb.rv, suppressed: pb.sp,
      });
    }
    return out;
  }

  get lastState() { return this._lastState; }
  get lastMe() { return this._lastMe; }

  close() {
    this._closed = true;
    clearInterval(this._pingTimer);
    this._pingTimer = null;
    clearTimeout(this._wsTimer);
    this._wsTimer = null;
    this.connected = false;
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
