// Multiplayer without a server of your own.
//
// A static deployment (Vercel and friends) can serve files but cannot run
// server/server.py: no socket upgrade, no always-on 30 Hz loop, no memory
// shared between requests. That used to mean "solo plus bots" on such a page.
//
// But a match does not need a *central* server -- it needs the players to be
// able to reach each other. So the room moves into the browser of whoever
// created it: that page already runs the game's own engine (public/js/local.js,
// Pyodide), and this file is the wire to everyone else. The host's engine stays
// authoritative; guests send the same input/fire/reload messages they would
// send to a real server and receive the same welcome/state/me frames back.
//
// The wire needs no service at all:
//
//   * two tabs of the same browser talk over BroadcastChannel -- instant, and
//     nothing to connect;
//   * two different computers connect *directly* to each other over a WebRTC
//     data channel (p2p.js), with the handshake carried as text the players
//     pass along themselves ("invite code" / "answer code"). No signalling
//     server, no STUN (unless asked for), no relay, no account.
//
// One room code per room, so several people can host at the same time and each
// host picks their own map -- the single-map limit of the Python server came
// from one process holding one world, and every host has their own process.
//
// A self-hosted MQTT broker can still be used instead, deliberately: add
// ?relay=wss://your-broker/mqtt to the page. Nothing probes the internet by
// itself any more, so opening the game never waits on a stranger's server.

import { Net } from './net.js';
import { LocalNet } from './local.js';
import { MqttClient, randomId } from './mqtt.js';
import { Peer, parseCode, getStun } from './p2p.js';
import { t } from './i18n.js';
import { store } from './storage.js';

// Topics are namespaced so strangers on a shared public broker are ignored, and
// versioned so an older client's traffic cannot be mistaken for this one's.
const TOPIC_ROOT = 'trench-front/v1';
const roomTopic = (code) => `${TOPIC_ROOT}/r/${code}`;
const LOBBY_TOPIC = `${TOPIC_ROOT}/lobby`;
const PROTO = 1;
// The host's own seat, as tagged by host.py (see RelaySink there).
const HOST_SEAT = '@host';

const BROKER_KEY = 'tf.relay.broker';
const BROKER_TIMEOUT_MS = 4000;
// How long a guest may be silent before the host gives up its seat. Long, by
// intent: a browser stops animating a background tab, so alt-tabbing away and
// coming back is normal, not a disconnect -- and the seat is worth keeping,
// because the room then has the player's name, class and score when they return.
const GUEST_TIMEOUT_MS = 30000;
// A browser stops animating a background tab, and the host's whole match --
// its 30 Hz loop included -- rides on requestAnimationFrame. So silence from
// the host usually means "the host switched tabs", not "the host left": wait a
// good while before believing the latter.
const PAUSE_MS = 8000;
const HOST_GONE_MS = 45000;     // quiet this long: the world is frozen, say so
const HOST_LOST_MS = 120000;    // quiet this long: the host is not coming back
const INPUT_HZ = 15;            // guests coalesce input: a public topic is shared

/**
 * A broker, when one is asked for: `?relay=wss://host:port/mqtt`, or one this
 * browser used before. Empty by default -- the game itself needs no server.
 */
function forcedBroker() {
  try {
    const q = new URLSearchParams(location.search).get('relay');
    if (q) return q;
  } catch { /* no URL API */ }
  return store.get(BROKER_KEY) || '';
}

/** A room code people can read out: eight digits, like the server's own. */
export function createRoomCode() {
  const buf = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => String(b % 10)).join('');
}

// ------------------------------------------------------------------- channel

/**
 * One pub/sub pipe to the rest of the room. Inside this browser it is a
 * BroadcastChannel; each player on another computer is a direct WebRTC
 * connection added to the same pipe. Neither needs a server, and nothing above
 * this line has to know which one a given message came from.
 */
class RelayChannel {
  constructor() {
    this.kind = '';
    this.label = '';
    this.connected = false;
    this._client = null;         // an explicit broker, when one was asked for
    this._bc = null;             // this browser's own tabs
    this._peers = new Set();     // direct connections to other computers
    this._pending = new Map();   // invite id -> the peer waiting for its answer
    this._topics = new Set();
    this._closed = false;
    this._wireId = randomId('wire');
    this._wireSeq = 0;
    this._received = new Set();
  }

  /**
   * @param {{onMessage?: Function, onClose?: Function, onStatus?: Function}} h
   * @returns {Promise<RelayChannel>}
   */
  async open(h = {}) {
    this.h = h;
    this._closed = false;
    // A broker is used only when one was named: ?relay=wss://… (or a broker
    // remembered from an earlier visit). Nothing is probed by itself, so a room
    // opens at once and no stranger's server is in the path.
    const wanted = forcedBroker();
    if (wanted) {
      h.onStatus?.(t('正在连接中转服务器…'));
      try {
        const client = new MqttClient(wanted, {
          onMessage: (topic, text) => this._deliver(topic, text),
          onClose: () => { if (!this._closed) this.h.onClose?.(); },
        });
        await client.connect(BROKER_TIMEOUT_MS);
        if (this._closed) { client.close(); throw new Error('cancelled'); }
        this._client = client;
        this.kind = 'broker';
        this.label = wanted;
        this.connected = true;
        for (const topic of this._topics) client.subscribe(topic);
        h.onStatus?.('');
        return this;
      } catch {
        // Named but unreachable: fall through to the serverless ways rather
        // than refusing to open a room at all.
        if (this._closed) throw new Error(t('已取消'));
      }
    }
    return this._openTabs();
  }

  /** Inside this browser: the same protocol across its own tabs. */
  _openTabs() {
    try {
      this._bc = new BroadcastChannel('trench-front');
      this._bc.onmessage = (ev) => {
        const m = ev.data;
        this._receive(m);
      };
    } catch {
      this._bc = null;               // old browser: peers only
    }
    this.kind = 'tab';
    this.label = this._bc ? 'BroadcastChannel' : 'WebRTC';
    this.connected = true;
    this.h.onStatus?.('');
    return this;
  }

  // ------------------------------------------------------ direct connections

  /**
   * An invite for one friend on another computer. Each invite is its own
   * connection, so this is called once per friend (the code is handed to that
   * friend, and their answer is what completes it).
   */
  async createInvite(room) {
    const peer = new Peer({
      onMessage: (text) => this._deliverPeer(text),
      onOpen: () => this._announcePeers(),
      onClose: () => this._dropPeer(peer),
    });
    this._pending.set(peer.id, peer);
    try {
      const code = await peer.createOffer(room || this.room || '');
      this._announcePeers();
      return code;
    } catch (err) {
      this._pending.delete(peer.id);
      peer.close();
      throw err;
    }
  }

  /** The friend's answer to one of our invites. */
  async acceptAnswer(code) {
    const answer = await parseCode(code);
    if (!answer || answer.kind !== 'answer') throw new Error(t('这不是一个回答码（回答码以 TFa1 开头）'));
    const peer = this._pending.get(answer.id);
    if (!peer) throw new Error(t('这个回答码过期了：请重新生成邀请码，再让朋友做一遍'));
    await peer.acceptAnswer(answer);
    this._pending.delete(answer.id);
    this._peers.add(peer);          // from now on it is a live connection
    this._announcePeers();
    return true;
  }

  /**
   * Guest side: an invite code from the host, turned into the answer code to
   * send back. The room code travels inside the invite.
   */
  async acceptInvite(code) {
    const invite = await parseCode(code);
    if (!invite || invite.kind !== 'invite') throw new Error(t('这不是一个邀请码（邀请码以 TFi1 开头）'));
    const peer = new Peer({
      onMessage: (text) => this._deliverPeer(text),
      onOpen: () => this._announcePeers(),
      onClose: () => this._dropPeer(peer),
    });
    if (String(invite.room) !== this.room) { peer.close(); throw new Error('Invite belongs to a different room'); }
    try {
      const answer = await peer.acceptOffer(invite);
      this._peers.add(peer);
      this._announcePeers();
      return { room: String(invite.room), answer };
    } catch (err) {
      peer.close();
      throw err;
    }
  }

  _deliverPeer(text) {
    try {
      const m = JSON.parse(text);
      this._receive(m);
    } catch { /* not ours */ }
  }

  _dropPeer(peer) {
    this._pending.delete(peer.id);
    const wasActive = this._peers.delete(peer);
    peer.close();
    this._announcePeers();
    if (wasActive) this.h.onPeerClose?.();
  }

  /** Tell the net above that the set of live links changed. */
  _announcePeers() {
    this.h.onPeers?.(this.peerCount);
  }

  /** How many other computers are connected directly right now. */
  get peerCount() { return [...this._peers].filter((peer) => peer.open && !peer.closed).length; }

  /** How many invites are waiting for an answer. */
  get pendingCount() { return this._pending.size; }

  subscribe(topic) {
    this._topics.add(topic);
    this._client?.subscribe(topic);
  }

  send(topic, text) {
    if (this._closed) return false;
    let sent = false;
    if (this._client) { this._client.publish(topic, text); sent = true; }
    const packet = { topic, text, from: this._wireId, n: ++this._wireSeq };
    if (this._bc) { this._bc.postMessage(packet); sent = true; }
    const wire = JSON.stringify(packet);
    for (const peer of this._peers) if (peer.send(wire)) sent = true;
    // Unanswered invites must not accumulate minutes of obsolete snapshots.
    for (const peer of this._pending.values()) if (peer.open) peer.send(wire);
    return sent;
  }

  _receive(packet) {
    if (!packet || !this._topics.has(packet.topic)) return;
    // A pair of tabs can have BOTH a BroadcastChannel and a WebRTC link.
    // Deliver each packet once, or one trigger pull becomes two shots.
    if (typeof packet.from === 'string' && Number.isSafeInteger(packet.n)) {
      const key = `${packet.from}:${packet.n}`;
      if (this._received.has(key)) return;
      this._received.add(key);
      if (this._received.size > 2048) this._received.delete(this._received.values().next().value);
    }
    this._deliver(packet.topic, packet.text);
  }

  _deliver(topic, text) {
    if (this._closed || !this._topics.has(topic) || typeof text !== 'string') return;
    this.h.onMessage?.(topic, text);
  }

  close() {
    this._closed = true;
    this.connected = false;
    this._client?.close();
    this._client = null;
    try { this._bc?.close(); } catch { /* already gone */ }
    this._bc = null;
    for (const peer of [...this._peers, ...this._pending.values()]) peer.close();
    this._peers.clear();
    this._pending.clear();
    this._received.clear();
    this._topics.clear();
  }
}

/** Open a channel bound to one room's topic. */
/**
 * Open a room's channel on its own, without touching the engine.
 *
 * "Create a room" is a separate step from "start a match" now: the code (and
 * the link, and the invite codes) exists the moment the button is pressed,
 * while the 12 MB in-page engine -- the thing that used to make that button
 * look dead for half a minute -- is only booted when the match is deployed.
 */
export async function openRoomChannel(code, h = {}) {
  return openChannel(String(code || ''), h);
}

async function openChannel(code, h) {
  const channel = new RelayChannel();
  channel.room = String(code || '');
  await channel.open(h);
  channel.subscribe(roomTopic(code));
  return channel;
}

// --------------------------------------------------------------------- guest

/**
 * A guest: the Net the WebSocket client implements, with publishes and
 * subscriptions where the socket used to be. No Python, no engine -- the host
 * runs the match, this page only plays it.
 */
export class RelayNet extends Net {
  constructor(handlers = {}, opts = {}) {
    super(handlers);
    this.mode = 'relay';
    this.sid = randomId('p');
    this.code = String(opts.code || '');
    this.channel = null;
    this.relayKind = '';
    this.relayLabel = '';
    this._pendingInput = null;
    this._lastInputAt = 0;
    this._lastHostAt = 0;
    this._watch = null;
    this._welcomeTimer = null;
    this._joinRetry = null;
    this._paused = false;
    // The join arguments, kept so the guest can ask to be let back in after
    // the host has given up on it (see the 'lost' answer below).
    this._joinArgs = null;
    this._rejoins = 0;
    // Anything said between "the room dropped me" and "let me back in" would
    // go out under a seat the room no longer knows: the host answers 'lost' and
    // the message (a chat line, a shot) is gone. Held here for that moment.
    this._held = [];
    this._away = false;
    this._probedQuiet = false;
    this._rebuilding = false;
    this._rebuildTries = 0;
  }

  async connect(url, opts = {}) {
    this._closed = false;
    this.code = String(opts.code || this.code || '');
    if (!this.code) throw new Error(t('缺少房号'));
    this.channel = await this._openChannel();
    if (this._closed) throw new Error(t('已取消'));
    this.relayKind = this.channel.kind;
    this.relayLabel = this.channel.label;
    this.connected = true;
    this._lastHostAt = performance.now();
    this._watch = setInterval(() => this._checkHost(), 2000);
    // Say hello so the host answers (and so a room code nobody hosts is silent
    // rather than indistinguishable from a slow join).
    this.channel.send(roomTopic(this.code), JSON.stringify({ v: PROTO, k: 'hi', sid: this.sid }));
    return this.channel.kind;
  }

  /**
   * The channel, with the room's own close handling: a relay that drops is
   * rebuilt here rather than at the doors of the menu. Losing the wire for a
   * moment (flaky wifi, a laptop that slept, a public broker restarting) must
   * not end the match for the player who is behind that wire -- and the host
   * keeps the seat for a good while, so the same session id still fits.
   */
  async _openChannel() {
    return openChannel(this.code, {
      onMessage: (_topic, text) => this._onRelay(text),
      onClose: () => this._onChannelClose(),
      onPeerClose: () => {
        if (this._closed || !this.connected || this.relayKind !== 'p2p') return;
        // A manual WebRTC link cannot be recreated by reopening a tab channel.
        // Tell the player to pair again, rather than claiming a fake reconnect.
        this.connected = false;
        this.h.onError?.(t('直连已断开：请让房主生成新的邀请码并重新配对'));
        this.h.onClose?.();
      },
    });
  }

  _onChannelClose() {
    if (this._closed) return;
    if (this.connected) this.connected = false;
    if (this._rebuilding) return;
    this._rebuilding = true;
    this.h.onNote?.(t('联机通道断了，正在自动重连…'));
    const delay = Math.min(8000, 800 * 2 ** Math.min(this._rebuildTries, 3));
    setTimeout(() => this._rebuild(), delay);
  }

  async _rebuild() {
    if (this._closed) { this._rebuilding = false; return; }
    this._rebuildTries += 1;
    try {
      this.channel?.close();
      this.channel = await this._openChannel();
      if (this._closed) { this._rebuilding = false; return; }
      this.relayKind = this.channel.kind;
      this.relayLabel = this.channel.label;
      this.connected = true;
      this._lastHostAt = performance.now();
      this._away = false;
      // The same hello as a fresh join: the host answers at once, and a room
      // that no longer holds this seat answers 'lost' and the seat is asked for
      // again (see _dispatch).
      this.channel.send(roomTopic(this.code), JSON.stringify({ v: PROTO, k: 'hi', sid: this.sid }));
      this._rebuilding = false;
      this._rebuildTries = 0;
      this.h.onNote?.(t('已经重新接上，继续战斗'));
    } catch {
      this._rebuilding = false;
      // Give up politely: one more go, and only then hand the player back to
      // the menu with a sentence that says what to do about it.
      if (this._rebuildTries >= 3) { this.h.onClose?.(); return; }
      this._onChannelClose();
    }
  }

  /**
   * A guest on another computer: turn the host's invite code into the answer
   * code to send back. The room code came inside the invite (see openChannel /
   * super.connect), so this only has to build the connection.
   */
  async acceptInvite(code) {
    const res = await this.channel.acceptInvite(code);
    this.relayKind = 'p2p';
    this.relayLabel = t('点对点直连（{n} 条）', { n: this.channel.peerCount });
    this._lastHostAt = performance.now();
    return res;
  }

  /** Direct links this player currently has to other computers. */
  get peers() { return this.channel?.peerCount || 0; }

  /** Overrides Net.send: a guest coalesces input, everything else goes at once. */
  send(obj) {
    if (this._closed) return false;
    // Two reasons a message cannot go out yet: the relay is briefly down, or
    // the room is in the middle of letting this seat back in. Neither should
    // eat what the player did -- a chat line, a shot, a reload -- so hold it
    // and send it the moment the way is clear. Input is left out: the next
    // frame describes the player's current state anyway.
    const event = !!obj && obj.t !== 'join' && obj.t !== 'input';
    if ((!this.connected || this.id === null) && event) {
      this._held.push(obj);
      if (this._held.length > 24) this._held.shift();
      return true;
    }
    if (!this.connected) return false;
    if (obj && obj.t === 'input') {
      const now = performance.now();
      if (now - this._lastInputAt < 1000 / INPUT_HZ) { this._pendingInput = obj; return true; }
      this._lastInputAt = now;
      this._pendingInput = null;
      return this._publish(obj);
    }
    // Anything event-shaped (fire, reload, ability, chat, respawn) must not be
    // reordered behind a pending input frame.
    this._flushInput();
    return this._publish(obj);
  }

  _flushInput() {
    if (!this._pendingInput) return;
    const held = this._pendingInput;
    this._pendingInput = null;
    this._lastInputAt = performance.now();
    this._publish(held);
  }

  _publish(obj) {
    return this.channel.send(roomTopic(this.code),
      JSON.stringify({ v: PROTO, k: 'm', sid: this.sid, m: obj }));
  }

  /**
   * Host -> guest traffic. One message per engine tick carries the broadcast
   * frames and every seat's private frames; a guest applies the first and its
   * own, and knows the host is alive either way.
   */
  _onRelay(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || msg.v !== PROTO) return;
    if (msg.k === 'end') {
      if (!this.connected) return;
      this.connected = false;
      clearTimeout(this._welcomeTimer);
      clearInterval(this._joinRetry);
      clearInterval(this._watch);
      this.h.onError?.(t('与房主失去联系（房主关掉了页面？）'));
      this.h.onClose?.();
      return;
    }
    if (msg.k !== 'b') return;
    this._lastHostAt = performance.now();
    if (this._paused || this._away) {
      this._paused = false;
      this._away = false;
      this.h.onNote?.(t('房主回来了，继续战斗'));
    }
    const mine = msg.p?.[this.sid] || [];
    if (!this.connected) this.connected = true;
    this._probedQuiet = false;
    if (this._held.length && this.id !== null) {
      // The relay is talking again: nothing the player did while it was quiet
      // should be left sitting in the buffer.
      for (const obj of this._held.splice(0)) this._publish(obj);
    }
    if (this._pendingInput && performance.now() - this._lastInputAt >= 1000 / INPUT_HZ) this._flushInput();
    if (msg.b?.length || mine.length) this._dispatchBatch([...(msg.b || []), ...mine], performance.now());
  }

  /**
   * The host is the server here, so silence is either a pause or the end of the
   * match. A pause first (say so, keep waiting: the world is frozen either way),
   * and only after a good while treat it as gone.
   */
  _checkHost() {
    if (this._closed || !this.connected || (this.id === null && !this._joinArgs)) return;
    const quiet = performance.now() - this._lastHostAt;
    if (quiet >= HOST_LOST_MS) {
      // Two possibilities: the host really is gone (tab closed), or this side
      // lost the wire and has not noticed. Ask for a fresh connection first --
      // a rebuilt one that still hears nothing is the end of the match.
      if (!this._probedQuiet && this.relayKind !== 'p2p') {
        this._probedQuiet = true;
        this.h.onNote?.(t('很久没有房主的消息了，正在重新连接确认…'));
        this._onChannelClose();
        return;
      }
      this.connected = false;
      clearInterval(this._watch);
      this._watch = null;
      this.h.onError?.(t('与房主失去联系（房主关掉了页面？）'));
      this.h.onClose?.();
      return;
    }
    if (quiet >= HOST_GONE_MS) {
      // A host goes quiet for a while for ordinary reasons -- a throttled tab,
      // a machine that hitched, a long GC -- and none of them should end the
      // match for everybody else. Wait it out, saying so.
      if (!this._away) {
        this._away = true;
        this.h.onNote?.(t('房主那边暂时没有声音了，正在等它回来…（画面会停住）'));
      }
      return;
    }
    if (quiet >= PAUSE_MS && !this._paused) {
      this._paused = true;
      this.h.onNote?.(t('房主那边暂停了（可能切走了标签页）…恢复后会自动继续'));
    }
  }

  /** The join is an ordinary message; the welcome comes back from the host. */
  join(name, cls, weapon, bots, botCount, skin, solo, mapId, sid, room) {
    this._joinArgs = [name, cls, weapon, bots, botCount, skin, solo, mapId, sid, room];
    this._sendJoin();
  }

  _sendJoin() {
    this._lastHostAt = performance.now();
    const [name, cls, weapon, bots, botCount, skin, solo, mapId, sid, room] = this._joinArgs || [];
    this.send({
      t: 'join', name, cls, weapon, bots, botCount, skin: skin || '',
      solo: !!solo, map: mapId, sid: sid || '', room: room || '',
    });
    // A guest may deploy while the host is still downloading its engine.
    // Retry the join, not game actions, until the host is ready or time runs out.
    clearInterval(this._joinRetry);
    this._joinRetry = setInterval(() => {
      if (this.id === null && !this._closed && this.connected) {
        const [name, cls, weapon, bots, botCount, skin, solo, mapId, sid, room] = this._joinArgs;
        this._publish({ t: 'join', name, cls, weapon, bots, botCount, skin: skin || '',
          solo: !!solo, map: mapId, sid: sid || '', room: room || '' });
      }
    }, 1000);
    // A code nobody is hosting must not look like a silent hang.
    clearTimeout(this._welcomeTimer);
    this._welcomeTimer = setTimeout(() => {
      clearInterval(this._joinRetry);
      if (this.id !== null || this._closed) return;
      this.h.onError?.(t('房号 {code} 没有人在主持（或房主刚离开）', { code: this.code }));
      this.h.onClose?.();
    }, 30000);
  }

  _dispatch(m, at) {
    if (m.t === 'welcome') {
      clearTimeout(this._welcomeTimer);
      clearInterval(this._joinRetry);
      this.connected = true;         // frames are arriving: the relay is up
      this._rebuildTries = 0;
      // Seated again: the count of asks is a runaway-ask guard (eight join
      // attempts that never came back), not a lifetime budget. A match can last
      // long enough for a guest to be dropped and let back in many times, and
      // the ninth time must work just like the first.
      this._rejoins = 0;
      // ... and what the player said while it was being sorted out.
      const held = this._held.splice(0);
      super._dispatch(m, at);
      for (const obj of held) this._publish(obj);
      return;
    }
    if (m.t === 'joinError') {
      if (m.why === 'closed' && this.id === null && this._joinArgs) return;
      clearTimeout(this._welcomeTimer);
      clearInterval(this._joinRetry);
      // "lost" means the room had dropped this seat (a background tab stops
      // sending while the browser throttles it, for instance). Ask once to be
      // let back in rather than dumping the player out of the match.
      if (m.why === 'lost' && this._rejoins < 8 && this._joinArgs && !this._closed) {
        this._rejoins += 1;
        this.id = null;
        this.h.onNote?.(t('与房主中断了一下，正在自动重新加入…'));
        this._sendJoin();
        return;
      }
    }
    super._dispatch(m, at);
  }

  close() {
    if (this.channel && this.connected) {
      this.channel.send(roomTopic(this.code),
        JSON.stringify({ v: PROTO, k: 'bye', sid: this.sid }));
    }
    clearTimeout(this._welcomeTimer);
    clearInterval(this._watch);
    clearInterval(this._joinRetry);
    this._watch = null;
    this.channel?.close();
    this.channel = null;
    super.close();
  }
}

// ---------------------------------------------------------------------- host

/**
 * The host: it plays *and* runs the match. Everything the engine produces goes
 * out on the room topic -- its own frames are dispatched locally, so playing on
 * the host page costs no round-trip at all -- and every guest message goes into
 * the same room through host.py's RelayHost.
 */
export class RelayHostNet extends LocalNet {
  constructor(handlers = {}, opts = {}) {
    super(handlers);
    this.mode = 'relay';
    this.code = String(opts.code || '');
    this.channel = null;
    this.relayKind = '';
    this.relayLabel = '';
    this._seen = new Map();       // guest sid -> last time it was heard from
    this._lastStepAt = 0;         // for forgiving the host's own stalls
    // Guests the room accepted. (Not `_joined`: that name is LocalNet's own --
    // a boolean saying whether this player's join went out -- and shadowing it
    // with a Set broke the first guest's join.)
    this._guestSids = new Set();
    this._lastLobbyAt = 0;
    this._rebuilding = false;
    this._rebuildTries = 0;
  }

  async connect(url, opts = {}) {
    this.code = String(opts.code || this.code || '');
    // A channel opened earlier (the menu's "create a room") is reused when it
    // belongs to this room -- that is what makes the code appear instantly and
    // stay the same one the player already sent to their friends.
    const ready = opts.channel && String(opts.channel.room || '') === this.code ? opts.channel : null;
    this.channel = ready || await this._openChannel();
    if (ready) {
      // The menu-created channel now belongs to this host, not a stale menu
      // callback. Preserve invite status listeners while replacing dispatch.
      ready.h = { ...ready.h,
        onMessage: (_topic, text) => this._onRelay(text),
        onClose: () => this._onChannelClose(),
      };
    }
    this.relayKind = this.channel.kind;
    this.relayLabel = this.channel.label;
    await super.connect('');
    // LocalNet.connect() labels itself 'local'; this one is a relay room.
    this.mode = 'relay';
    return this.channel.kind;
  }

  /** An invite for one friend on another computer (their answer completes it). */
  async createInvite() {
    return this.channel.createInvite(this.code);
  }

  /** The answer to one of our invites: from here that friend is connected. */
  async acceptAnswer(code) {
    const ok = await this.channel.acceptAnswer(code);
    this.relayLabel = this.channel.kind === 'broker'
      ? this.channel.label
      : t('点对点直连（{n} 条）', { n: this.channel.peerCount });
    return ok;
  }

  /** The channel, plus the way back from a broker that drops this tab. */
  async _openChannel() {
    return openChannel(this.code, {
      onMessage: (_topic, text) => this._onRelay(text),
      onClose: () => this._onChannelClose(),
    });
  }

  /**
   * Losing the relay is not fatal for the host -- the match keeps running in
   * this tab -- but nobody else can reach it until the wire is back, so it is
   * rebuilt here, quietly, while the fighting carries on.
   */
  _onChannelClose() {
    if (this._closed || this._rebuilding) return;
    this._rebuilding = true;
    this.h.onNote?.(t('中转连接已断开：其他人暂时收不到这一局，正在重连…'));
    const delay = Math.min(8000, 800 * 2 ** Math.min(this._rebuildTries, 3));
    setTimeout(async () => {
      if (this._closed) { this._rebuilding = false; return; }
      this._rebuildTries += 1;
      try {
        this.channel?.close();
        this.channel = await this._openChannel();
        this.relayKind = this.channel.kind;
        this.relayLabel = this.channel.label;
        this._rebuilding = false;
        this._rebuildTries = 0;
        this.h.onNote?.(t('中转已连回来，别人现在能收到这一局了'));
      } catch {
        this._rebuilding = false;
        if (this._rebuildTries < 4) this._onChannelClose();
        else this.h.onNote?.(t('中转一直连不上：你自己还能打，别人暂时进不来'));
      }
    }, delay);
  }

  // ------------------------------------------------------- the engine, wrapped
  // LocalNet drives the engine through these four; a relay room is the same
  // engine with several seats, so only these change.

  // host.py's RelayHost replaces the plain Host for this match.
  _engineReset() { this._engine.relayReset(); }
  /** host.py tags every frame with the seat it belongs to (see RelaySink). */
  _ownFrames(rows) {
    if (!Array.isArray(rows) || !Array.isArray(rows[0])) return rows;
    return rows.filter((r) => Array.isArray(r) && r.length >= 2
      && (r[0] === '' || r[0] === HOST_SEAT)).map((r) => r[1]);
  }
  _engineStart(msg) { return this._engine.relayStart(JSON.stringify(msg), this.code); }
  _engineCmd(msg) { return this._engine.relayCmd(HOST_SEAT, JSON.stringify(msg)); }
  _engineStep(ms) { return this._engine.relayStep(ms); }
  _engineStatus() { return this._engine.relayStatus(); }

  /** Guest messages, tagged batches in, tagged batches out. */
  _eat(text) {
    let rows;
    try { rows = JSON.parse(text); } catch { return; }
    if (!Array.isArray(rows) || !rows.length) return;
    const tagged = Array.isArray(rows[0]);
    const mine = [];
    if (tagged) {
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 2) continue;
        if (row[0] === '' || row[0] === HOST_SEAT) mine.push(row[1]);
      }
    } else {
      mine.push(...rows);
    }
    if (mine.length) this._dispatchBatch(mine, performance.now());
    this._publish(text);
  }

  /** Broadcast frames go to the room; each guest's own frames only to them. */
  _publish(text) {
    let rows;
    try { rows = JSON.parse(text); } catch { return; }
    if (!Array.isArray(rows) || !rows.length || !this.channel) return;
    const b = [];
    const p = Object.create(null);
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const [sid, frame] = row;
      if (sid === '') b.push(frame);
      else if (sid !== HOST_SEAT) (p[sid] = p[sid] || []).push(frame);
    }
    if (!b.length && !Object.keys(p).length) return;
    this.channel.send(roomTopic(this.code), JSON.stringify({ v: PROTO, k: 'b', b, p }));
  }

  /** One guest message: a join, a game message, a goodbye or a hello. */
  _onRelay(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || msg.v !== PROTO || !msg.sid) return;
    const sid = String(msg.sid);
    this._seen.set(sid, performance.now());
    if (msg.k === 'bye') { this._dropGuest(sid); return; }
    // A hello is answered at once: the guest then knows the host is alive
    // before the room has even finished welcoming it.
    if (msg.k === 'hi') {
      this.channel?.send(roomTopic(this.code), JSON.stringify({ v: PROTO, k: 'b', b: [], p: {} }));
      return;
    }
    if (msg.k !== 'm' || !this._engine || !this._joined) return;
    try {
      if (this._guestSids.has(sid)) {
        this._eat(this._engine.relayCmd(sid, JSON.stringify(msg.m)));
        return;
      }
      // Only a join seats somebody. A message from a session that is not in the
      // room (it was dropped after going quiet, or never got in) must not be
      // turned into a player: host.py's room would happily seat it as a nameless
      // soldier, and the guest -- which still believes it is player N -- would
      // never hear about it. Tell it instead and let it ask again.
      if (msg.m && msg.m.t === 'join') {
        const out = this._engine.relayJoin(sid, JSON.stringify(msg.m));
        if (this._accepted(out, sid)) this._guestSids.add(sid);
        this._eat(out);
        return;
      }
      this._reply(sid, { t: 'joinError', why: 'lost' });
    } catch (err) {
      console.error('[trench] the in-page room rejected a guest message', err);
    }
  }

  /** One frame to one guest, without running the room. */
  _reply(sid, frame) {
    this.channel?.send(roomTopic(this.code), JSON.stringify({
      v: PROTO, k: 'b', b: [], p: { [sid]: [JSON.stringify(frame)] },
    }));
  }

  /** Did that answer carry a welcome for this guest? (A full room says no.) */
  _accepted(taggedText, sid) {
    try {
      const rows = JSON.parse(taggedText);
      return rows.some((row) => Array.isArray(row) && row[0] === sid
        && String(row[1]).includes('"t":"welcome"'));
    } catch { return false; }
  }

  /** After each stepped batch: drop silent guests, announce the room. */
  _afterStep() {
    const now = performance.now();
    // A stalled host -- its own tab in the background, or the machine hitching
    // for a couple of seconds -- comes back to find that *everybody* was quiet
    // while it was away. That is not the guests' fault, so the silence they are
    // judged on is shifted by the length of the stall.
    if (this._lastStepAt && now - this._lastStepAt > 1000) {
      const stall = now - this._lastStepAt;
      for (const [sid, at] of this._seen) this._seen.set(sid, at + stall);
    }
    this._lastStepAt = now;
    for (const sid of [...this._seen.keys()]) {
      if (now - this._seen.get(sid) < GUEST_TIMEOUT_MS) continue;
      this._dropGuest(sid);
    }
    this._announceLobby(now);
  }

  _dropGuest(sid) {
    this._seen.delete(sid);
    if (!this._guestSids.delete(sid)) return;
    // Say so: the guest then asks to be let back in straight away instead of
    // finding out with its next message (which would be lost).
    this._reply(sid, { t: 'joinError', why: 'lost' });
    try {
      this._eat(this._engine.relayLeave(sid));
    } catch (err) {
      console.warn('[trench] could not drop a guest', err);
    }
  }

  /** Hosts say what rooms exist, so the menu can list them (see RelayLobby). */
  _announceLobby(now) {
    if (!this.channel || now - this._lastLobbyAt < 4000) return;
    this._lastLobbyAt = now;
    const st = this.status();
    this.channel.send(LOBBY_TOPIC, JSON.stringify({
      v: PROTO, k: 'room', code: this.code,
      players: st?.humans ?? 1, max: 16,
      phase: st?.phase || 'live', mapId: st?.map || '',
    }));
  }

  /** Diagnostics for the HUD, the console and the tests. */
  status() {
    const base = super.status();
    if (!base) return null;
    return { ...base, relay: this.relayKind, relayLabel: this.relayLabel,
      guests: this._seen.size, peers: this.channel?.peerCount ?? 0 };
  }

  close() {
    if (!this._closed) {
      this.channel?.send(roomTopic(this.code), JSON.stringify({ v: PROTO, k: 'end' }));
    }
    this.channel?.close();
    this.channel = null;
    super.close();
  }
}

// -------------------------------------------------------------------- lobby

/**
 * The open rooms on the relay, for the menu list. A host announces itself every
 * few seconds; anything not heard from for a while drops off again.
 */
export class RelayLobby {
  constructor() {
    this.channel = null;
    this.kind = '';
    this.rooms = new Map();
    this.onRooms = null;
    this.onStatus = null;
    this._sweep = null;
  }

  async start(onRooms, onStatus) {
    this.onRooms = onRooms;
    this.onStatus = onStatus;
    try {
      await this._open();
    } catch {
      return false;
    }
    this._sweep = setInterval(() => this._prune(), 2000);
    return true;
  }

  async _open() {
    this.channel?.close();
    const channel = new RelayChannel();
    await channel.open({
      onMessage: (_topic, text) => this._heard(text),
      onStatus: (line) => this.onStatus?.(line),
    });
    channel.subscribe(LOBBY_TOPIC);
    this.channel = channel;
    this.kind = channel.kind;
  }

  _heard(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || msg.v !== PROTO || msg.k !== 'room' || !msg.code) return;
    this.rooms.set(String(msg.code), { ...msg, seen: performance.now() });
    this._emit();
  }

  _prune() {
    const now = performance.now();
    let dirty = false;
    for (const [code, room] of [...this.rooms]) {
      if (now - room.seen > 12000) { this.rooms.delete(code); dirty = true; }
    }
    if (dirty) this._emit();
  }

  _emit() {
    this.onRooms?.([...this.rooms.values()].map((r) => ({
      code: r.code, players: r.players || 1, max: r.max || 16,
      phase: r.phase || 'live', mapId: r.mapId || '', relay: true,
    })));
  }

  stop() {
    clearInterval(this._sweep);
    this._sweep = null;
    this.channel?.close();
    this.channel = null;
    this.rooms.clear();
  }
}
