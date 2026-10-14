// Direct connections between players, with nothing in the middle.
//
// The relay (relay.js) is a pub/sub pipe; this file is what carries that pipe
// between two different computers. It is WebRTC -- the same machinery a video
// call uses -- with the one part that normally needs a server, the handshake,
// done by the players themselves:
//
//   1. the host presses "create an invite": their page builds a connection
//      offer and packs it into one line of text (an *invite code*);
//   2. the host sends that line to a friend however they like -- chat, mail,
//      a note -- and the friend's page turns it into an *answer code*;
//   3. the friend sends that line back, the host pastes it, and the two pages
//      are connected directly.
//
// No signalling service, no STUN server, no TURN relay, no account: only the
// two browsers and the words the players exchanged. Codes are deflated and
// base64url'd so they stay short enough to paste (~300-400 characters).
//
// Scope worth knowing: without a STUN server the two browsers can only find
// each other on the same network (or with public addresses) -- that is the
// price of using nothing external. A STUN server, which is a public
// address-lookup service rather than a relay and never sees the traffic, can be
// switched on in the invite dialog for friends on
// different home networks. `iceServers` stays empty unless one is asked for.

const PREFIX_INVITE = 'TFi1.';
const PREFIX_ANSWER = 'TFa1.';
// How long to wait for ICE gathering before giving up on "complete": the host
// must send every candidate it has, because there is no trickle channel.
const ICE_WAIT_MS = 12000;
const CONNECT_WAIT_MS = 20000;
const DISCONNECT_GRACE_MS = 10000;
const MAX_CODE_LENGTH = 256 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;

// --------------------------------------------------------------- code packing

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One line of text for one object, small enough to paste into a chat window. */
export async function packCode(prefix, obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  let bytes = json;
  let z = '';
  try {
    const packed = await deflate(json);
    if (packed && packed.length < json.length) { bytes = packed; z = 'z'; }
  } catch { /* no compression here: the plain form still works */ }
  return prefix + z + b64url(bytes);
}

/** The object behind a code, or null when the text is not one of ours. */
export async function unpackCode(prefix, text) {
  const raw = String(text || '').replace(/\s+/g, '');
  if (raw.length > MAX_CODE_LENGTH) throw new Error('Invite/answer code is too large');
  if (!raw.startsWith(prefix)) return null;
  const body = raw.slice(prefix.length);
  const z = body.startsWith('z');
  let bytes = unb64url(z ? body.slice(1) : body);
  if (z) {
    if (typeof DecompressionStream !== 'function') throw new Error('compressed code, but this browser cannot unpack it');
    bytes = await inflate(bytes);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// --------------------------------------------------------------------- STUN

/**
 * A STUN server for crossing home networks, if the player asked for one. It is
 * an address lookup: packets to it are a few bytes and none of the game goes
 * through it. Empty (the default) means the two browsers must be able to see
 * each other directly, which is exactly "nothing external".
 */
let stunServer = '';
export function setStun(host) { stunServer = String(host || '').trim(); }
export function getStun() { return stunServer; }
function iceServers() {
  return stunServer ? [{ urls: `stun:${stunServer}` }] : [];
}

// -------------------------------------------------------------------- a peer

/**
 * One direct connection: a data channel plus the offer/answer dance that
 * creates it. `send` may be called before the channel opens (a guest's hello
 * usually is) -- the text is held and flushed on open.
 */
export class Peer {
  constructor(h = {}) {
    this.h = h;
    this.pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.dc = null;
    this.id = Math.random().toString(36).slice(2, 10);
    this.open = false;
    this.closed = false;
    this._queue = [];
    this._disconnectTimer = null;
    this._openWaiters = new Set();
    this._gatherCancel = null;
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      clearTimeout(this._disconnectTimer);
      // ICE connected is not the same as an open data channel. Only dc.onopen
      // may announce success, otherwise the menu claims a connection too soon.
      if (st === 'failed' || st === 'closed') this._dead();
      if (st === 'disconnected') {
        this._disconnectTimer = setTimeout(() => this._dead(), DISCONNECT_GRACE_MS);
      }
    };
  }

  _wire(channel) {
    this.dc = channel;
    this.dc.onopen = () => {
      if (this.closed) return;
      this.open = true;
      for (const text of this._queue.splice(0)) this._raw(text);
      for (const waiter of this._openWaiters) waiter.resolve();
      this._openWaiters.clear();
      this.h.onOpen?.();
    };
    this.dc.onmessage = (e) => this.h.onMessage?.(String(e.data));
    this.dc.onclose = () => this._dead();
    this.dc.onerror = () => this._dead();
  }

  _dead() {
    if (this.closed) return;
    this.close();
    this.h.onClose?.();
  }

  _raw(text) {
    if (this.dc?.readyState !== 'open' || this.dc.bufferedAmount > MAX_BUFFERED_BYTES) return false;
    try { this.dc.send(text); return true; } catch { return false; }
  }

  /** Pairing succeeds only once application messages can actually travel. */
  waitForOpen(timeoutMs = CONNECT_WAIT_MS) {
    if (this.open && !this.closed) return Promise.resolve();
    if (this.closed) return Promise.reject(new Error('Peer connection is closed; exchange a new invite'));
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        this._openWaiters.delete(waiter);
        if (error) reject(error); else resolve();
      };
      const waiter = { resolve: () => finish(), reject: (err) => finish(err) };
      const timer = setTimeout(() => {
        finish(new Error('Direct connection timed out. Check both networks; restrictive NAT/firewalls require a TURN relay (not available on Vercel-only hosting).'));
        this._dead();
      }, timeoutMs);
      this._openWaiters.add(waiter);
    });
  }

  send(text) {
    if (this.closed) return false;
    if (!this.open) {
      if (this._queue.length < 500) this._queue.push(text);
      return false;
    }
    return this._raw(text);
  }

  /** Manual signalling cannot trickle candidates later: gather all or fail. */
  _gathered() {
    if (this.closed) return Promise.reject(new Error('Peer connection closed'));
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        this.pc.removeEventListener('icegatheringstatechange', done);
        this._gatherCancel = null;
        if (error) reject(error); else resolve();
      };
      const done = () => {
        if (this.pc.iceGatheringState === 'complete') finish();
      };
      const timer = setTimeout(() => finish(new Error('ICE gathering timed out; check network permissions and generate a new invite')), ICE_WAIT_MS);
      this._gatherCancel = () => finish(new Error('Peer connection closed'));
      this.pc.addEventListener('icegatheringstatechange', done);
      done();
    });
  }

  /** Host side: the offer, ready to be pasted into a chat window. */
  async createOffer(room) {
    this._wire(this.pc.createDataChannel('trench', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this._gathered();
    // The room code travels inside the invite: the friend never types it.
    return packCode(PREFIX_INVITE, { v: 1, id: this.id, room: String(room || ''), sdp: this.pc.localDescription });
  }

  /** Guest side: takes an invite code and returns the answer code. */
  async acceptOffer(invite) {
    this.pc.ondatachannel = (e) => this._wire(e.channel);
    await this.pc.setRemoteDescription(invite.sdp);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this._gathered();
    return packCode(PREFIX_ANSWER, { v: 1, id: invite.id, sdp: this.pc.localDescription });
  }

  /** Host side again: the friend's answer closes the loop. */
  async acceptAnswer(answer) {
    if (answer.id !== this.id) throw new Error('this answer belongs to a different invite');
    await this.pc.setRemoteDescription(answer.sdp);
    await this.waitForOpen();
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    clearTimeout(this._disconnectTimer);
    this._gatherCancel?.();
    for (const waiter of this._openWaiters) waiter.reject(new Error('Peer connection closed; exchange a new invite'));
    this._openWaiters.clear();
    this._queue.length = 0;
    try { this.dc?.close(); } catch { /* already gone */ }
    try { this.pc.close(); } catch { /* already gone */ }
  }
}

/** Parse whichever kind of code this is, so the UI can say what went wrong. */
export async function parseCode(text) {
  if (String(text || '').replace(/\s+/g, '').startsWith(PREFIX_INVITE)) {
    const invite = await unpackCode(PREFIX_INVITE, text);
    if (invite) { validateCode(invite, 'offer'); return { ...invite, kind: 'invite' }; }
  }
  if (String(text || '').replace(/\s+/g, '').startsWith(PREFIX_ANSWER)) {
    const answer = await unpackCode(PREFIX_ANSWER, text);
    if (answer) { validateCode(answer, 'answer'); return { ...answer, kind: 'answer' }; }
  }
  return null;
}

function validateCode(code, type) {
  if (!code || code.v !== 1 || typeof code.id !== 'string' || !/^[a-z0-9]{1,32}$/.test(code.id)
    || code.sdp?.type !== type || typeof code.sdp.sdp !== 'string' || !code.sdp.sdp.startsWith('v=0')
    || (type === 'offer' && !/^\d{8}$/.test(code.room))) {
    throw new Error('Invalid invite/answer code; ask the host for a new invite');
  }
}
