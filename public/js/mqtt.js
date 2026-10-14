// A very small MQTT 3.1.1 client, enough to use a public broker as a relay.
//
// Why MQTT: a static deployment (Vercel) cannot run server/server.py and cannot
// accept a socket upgrade, so two browsers have nowhere to meet. Every public
// MQTT broker, on the other hand, speaks WebSocket to any page and broadcasts
// whatever it is given to everyone subscribed to that topic -- which is exactly
// a relay. No account, no key, no library: this file is the whole client.
//
// Only what the relay needs is implemented: CONNECT (clean session), SUBSCRIBE,
// PUBLISH at QoS 0, PINGREQ, DISCONNECT. No QoS 1/2, no retained messages, no
// wills, no auth. Anything unexpected is ignored rather than guessed at.

const PING_GRACE = 1.6;   // keepalive multiples to wait for a PINGRESP

const enc = new TextEncoder();
const dec = new TextDecoder();

/** MQTT remaining-length: 7 bits per byte, high bit means "more follows". */
function varint(n) {
  const out = [];
  let v = n;
  do {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}

function utf8(str) {
  const bytes = enc.encode(String(str));
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

/** Fixed header + body as one byte array. */
function packet(type, flags, body) {
  const head = [((type << 4) | flags) & 0xff, ...varint(body.length)];
  return Uint8Array.from([...head, ...body]);
}

export function randomId(prefix = 'tf') {
  const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 14);
  return `${prefix}-${rnd}`;
}

export class MqttClient {
  /**
   * @param {string} url  ws:// or wss:// broker endpoint (…/mqtt on most of them)
   * @param {{onMessage?: Function, onClose?: Function, keepaliveSec?: number, name?: string}} opts
   */
  constructor(url, opts = {}) {
    this.url = url;
    this.h = opts;
    // Long, on purpose: this client lives in a browser tab, and a hidden tab
    // has its timers slowed to about one a minute, so a short keepalive is a
    // broker that hangs up on a player who is only reading the Discord call.
    this.keepaliveSec = opts.keepaliveSec || 240;
    this.clientId = randomId('tf');
    this.ws = null;
    this.connected = false;
    this._buf = new Uint8Array(0);
    this._pid = 0;
    this._waiters = [];
    this._ping = null;
    this._lastRx = 0;
    this._vis = false;
    this._closed = false;
  }

  connect(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { this.ws?.close(); } catch { /* already gone */ }
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this);
      };
      this._onConnected = ok;

      const timer = setTimeout(() => fail(new Error('broker timeout')), timeoutMs);
      let ws;
      try {
        // The subprotocol is mandatory: brokers refuse the upgrade without it.
        ws = new WebSocket(this.url, 'mqtt');
      } catch (err) { fail(err); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        // Clean session, no will, no credentials.
        const flags = 0x02;
        const body = [
          ...utf8('MQTT'), 4, flags,
          (this.keepaliveSec >> 8) & 0xff, this.keepaliveSec & 0xff,
          ...utf8(this.clientId),
        ];
        ws.send(packet(1, 0, body));
      };
      ws.onmessage = (ev) => {
        this._lastRx = performance.now();
        const chunk = ev.data instanceof ArrayBuffer
          ? new Uint8Array(ev.data)
          : new Uint8Array(ev.data?.buffer || []);
        this._feed(chunk);
      };
      ws.onerror = () => fail(new Error('broker unreachable'));
      ws.onclose = () => {
        this.connected = false;
        clearInterval(this._ping);
        this._ping = null;
        if (!settled) { fail(new Error('broker closed the socket')); return; }
        if (!this._closed) this.h.onClose?.();
      };
    });
  }

  subscribe(topic) {
    const body = [...this._idBytes(), ...utf8(topic), 0];
    this._send(packet(8, 2, body));
  }

  publish(topic, text) {
    if (!this.connected) return false;
    this._send(packet(3, 0, [...utf8(topic), ...enc.encode(String(text))]));
    return true;
  }

  close() {
    this._closed = true;
    clearInterval(this._ping);
    this._ping = null;
    try { this._send(packet(14, 0, [])); } catch { /* going away anyway */ }
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
    this.connected = false;
  }

  // ------------------------------------------------------------------ internals

  _idBytes() {
    this._pid = (this._pid % 65534) + 1;
    return [(this._pid >> 8) & 0xff, this._pid & 0xff];
  }

  _send(bytes) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  /** Append incoming bytes and decode every complete packet in the buffer. */
  _feed(chunk) {
    const buf = new Uint8Array(this._buf.length + chunk.length);
    buf.set(this._buf, 0);
    buf.set(chunk, this._buf.length);
    this._buf = buf;

    for (;;) {
      if (this._buf.length < 2) return;
      const type = this._buf[0] >> 4;
      let len = 0;
      let mult = 1;
      let i = 1;
      let done = false;
      while (i < this._buf.length) {
        const b = this._buf[i++];
        len += (b & 0x7f) * mult;
        mult *= 128;
        if (!(b & 0x80)) { done = true; break; }
        if (mult > 128 * 128 * 128) return;    // malformed
      }
      if (!done) return;
      if (this._buf.length < i + len) return;
      const body = this._buf.subarray(i, i + len);
      this._buf = this._buf.subarray(i + len);
      this._handle(type, body);
    }
  }

  _handle(type, body) {
    if (type === 2) {                        // CONNACK
      const rc = body[1];
      if (rc === 0) {
        this.connected = true;
        this._startPing();
        this._watchVisibility();
        this._onConnected?.();
      } else {
        this._onConnected?.();               // resolve once: the caller decides
        this.h.onClose?.();
      }
      return;
    }
    if (type === 13) return;                 // PINGRESP
    if (type === 3) {                        // PUBLISH (QoS 0)
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      const payload = dec.decode(body.subarray(2 + tlen));
      this.h.onMessage?.(topic, payload);
      return;
    }
    // SUBACK / UNSUBACK / everything else: nothing to do at QoS 0.
  }

  _startPing() {
    clearInterval(this._ping);
    const every = Math.max(5000, (this.keepaliveSec * 1000) / 2);
    this._ping = setInterval(() => {
      if (!this.connected) return;
      // A broker that has gone away without a FIN would otherwise look alive
      // forever, so a missing PINGRESP is treated as a dead connection -- but
      // only while this tab is on screen. A browser stops (or hugely slows)
      // timers in a background tab, and packets are not read while it is not
      // rendering either: judging silence there used to drop a perfectly good
      // relay and leave the player unable to send anything when they came
      // back. Leaving the tab is the normal way to play this game.
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!hidden && performance.now() - this._lastRx > every * PING_GRACE) {
        this.connected = false;
        try { this.ws?.close(); } catch { /* already gone */ }
        this.h.onClose?.();
        return;
      }
      this._send(packet(12, 0, []));
    }, every);
  }

  /**
   * Coming back to the tab is a fresh start for the ping bookkeeping: whatever
   * was missed while it was hidden is not the broker's fault, so the grace
   * window starts again (and a ping goes out at once to find out where things
   * really stand).
   */
  _watchVisibility() {
    if (this._vis || typeof document === 'undefined') return;
    this._vis = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !this.connected) return;
      this._lastRx = performance.now();
      this._send(packet(12, 0, []));
    });
  }
}
