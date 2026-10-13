// WebSocket client plus the remote-player interpolation buffer.
//
// The server broadcasts 20 snapshots a second. Rendering them as they arrive
// looks like a slideshow, so every remote girl is drawn 120 ms in the past,
// interpolated between the two snapshots that bracket that moment. That single
// trick removes almost all of the "I hit her but nothing happened" feeling.

const TAU = Math.PI * 2;

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}

export class Net {
  constructor(handlers = {}) {
    this.h = handlers;
    this.ws = null;
    this.id = null;
    this.team = 0;
    this.connected = false;
    this.snaps = [];
    this.maxSnaps = 40;
    this.interpDelay = 120;
    this.ping = 0;
    this._pingSent = 0;
    this._pingTimer = null;
    this._lastMe = null;
    this._lastState = null;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) { reject(err); return; }
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        this.connected = true;
        this.h.onOpen?.();
        resolve();
      };
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error('无法连接服务器')); }
        this.h.onError?.('连接出错');
      };
      ws.onclose = () => {
        this.connected = false;
        this.h.onClose?.();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this._dispatch(msg);
      };
    });
  }

  _dispatch(m) {
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
        this.snaps.push({ t: performance.now(), s: m });
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
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------- outgoing

  join(name, cls, weapon, bots, botCount, skin, solo, mapId, sid) {
    this.send({ t: 'join', name, cls, weapon, bots, botCount, skin: skin || '', solo: !!solo, map: mapId, sid: sid || '' });
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
    clearInterval(this._pingTimer);
    this._pingTimer = null;
    this.ws?.close();
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
