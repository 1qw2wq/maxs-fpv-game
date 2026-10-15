// Gunfire, hitmarkers, deaths and interface clicks come from public/sounds/,
// decoded up front into Web Audio buffers so a shot can overlap itself with no
// latency. The runtime synthesiser below is kept as a fallback: samples are
// fetched in the background, so anything still loading (or missing) falls back
// to it instead of going silent. The music track streams through an <audio>
// element so its 4 MB is never decoded into memory.

const SAMPLE_FILES = {
  shot: 'sounds/shot.mp3',        // gunfire, every weapon
  hit: 'sounds/hit.mp3',          // hitmarker: your shots landing on an enemy
  kill: 'sounds/kill.mp3',        // kill confirmed
  hurt: 'sounds/hurt.mp3',        // you took a hit
  dead: 'sounds/dead.mp3',        // you died
  ui: 'sounds/ui.mp3',            // menu clicks, view toggle, crouch/stand
};
// Per-weapon gunfire, so every gun has its own report. The scout bolt-actions
// (except the straight-pull M95, whose file already carries the bolt working)
// also get a separate bolt-cycle sample, played once the action is worked.
const GUN_FILES = {
  mp18: 'sounds/guns/mp18.mp3',
  auto1918: 'sounds/guns/auto1918.mp3',
  hellriegel: 'sounds/guns/hellriegel.mp3',
  cei: 'sounds/guns/cei.mp3',
  rsc1917: 'sounds/guns/rsc1917.mp3',
  federov: 'sounds/guns/federov.mp3',
  lewis: 'sounds/guns/lewis.mp3',
  bar: 'sounds/guns/bar.mp3',
  chauchat: 'sounds/guns/chauchat.mp3',
  smle: 'sounds/guns/smle.mp3',
  m95: 'sounds/guns/m95.mp3',
  springfield: 'sounds/guns/springfield.mp3',
};
const BOLT_FILES = {
  smle: 'sounds/guns/bolt_smle.mp3',
  springfield: 'sounds/guns/bolt_springfield.mp3',
};
// Per-weapon loudness trim on top of the shape's baseline. The RSC M1917 is
// mixed 20% hotter than its rifle peers so it cuts through the same as they do.
const WEAPON_GAIN = { rsc1917: 1.2 };
const BGM_FILE = 'sounds/bgm.mp3';
const BGM_VOLUME = 0.125;

/**
 * Seconds of near-silence at the head of a decoded buffer.
 *
 * Several source MP3s are takes that start late, so the actual report sits at
 * the very end of the file (mp18: 1.81s silent of 1.93s, lewis: 3.19s of 3.32s).
 * Playing those from sample 0 made the gun feel like it fired a beat after the
 * trigger. Measuring the first audible sample once at load and starting there
 * fixes it without touching the files.
 */
function leadSilence(buf) {
  const thr = 0.01;
  let best = Infinity;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let i = 0;
    while (i < d.length && Math.abs(d[i]) < thr) i++;
    if (i < d.length) best = Math.min(best, i);   // skip fully-silent channels
  }
  return Number.isFinite(best) ? best / buf.sampleRate : 0;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
    this._samples = {};     // cue name -> decoded AudioBuffer
    this._guns = {};        // weapon id -> decoded gunfire AudioBuffer
    this._bolts = {};       // weapon id -> decoded bolt-cycle AudioBuffer
    this._bgm = null;       // looping <audio> element
    this._loadSamples();
  }

  /** Fetch and decode every cue up front; a failure just keeps the synth. */
  _loadSamples() {
    const ctx = this._ensure();
    if (!ctx) return;
    const load = (store, name, url) => {
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url))))
        .then((raw) => ctx.decodeAudioData(raw))
        .then((decoded) => { store[name] = { buf: decoded, offset: leadSilence(decoded) }; })
        .catch(() => {});
    };
    for (const [name, url] of Object.entries(SAMPLE_FILES)) load(this._samples, name, url);
    for (const [name, url] of Object.entries(GUN_FILES)) load(this._guns, name, url);
    for (const [name, url] of Object.entries(BOLT_FILES)) load(this._bolts, name, url);
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return null; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.42;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return this.ctx;
  }

  resume() {
    const ctx = this._ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    this._startMusic();
  }

  /**
   * Background music. Browsers only allow playback after a gesture, so this is
   * driven by resume(), which every menu click and pointer-lock already calls.
   */
  _startMusic() {
    if (!this.enabled) return;
    if (!this._bgm) {
      this._bgm = new Audio(BGM_FILE);
      this._bgm.loop = true;
      this._bgm.volume = BGM_VOLUME;
    }
    if (this._bgm.paused) this._bgm.play().catch(() => {});
  }

  get t() { return this.ctx.currentTime; }

  _noise(dur, gain, freq, q, type = 'bandpass') {
    const ctx = this._ensure();
    if (!ctx || !this.enabled) return null;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
    return { src, f, g, now };
  }

  _thump(dur, gain, freq, endFreq) {
    const ctx = this._ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    const now = ctx.currentTime;
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + dur);
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  _blip(dur, gain, f0, f1, type = 'triangle') {
    const ctx = this._ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  /**
   * Start a decoded cue through the master gain; false while it is unloaded.
   * Accepts either a raw buffer or a {buf, offset} entry from a sample store,
   * and skips the entry's leading silence so the report lands on the trigger.
   */
  _playBuf(entry, { gain = 1, rate = 1, lpf = 0 } = {}) {
    const buf = entry?.buf || entry;
    const offset = entry?.offset || 0;
    const ctx = this._ensure();
    if (!buf || !ctx || !this.enabled) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (lpf) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lpf;
      g.connect(f).connect(this.master);
    } else {
      g.connect(this.master);
    }
    // Clamped so a pathological offset can never start past the end of the clip.
    src.start(0, Math.min(Math.max(0, offset), Math.max(0, buf.duration - 0.02)));
    return true;
  }

  /** Play a named cue, or report false so the caller can synthesise instead. */
  _sample(name, opts) {
    return this._playBuf(this._samples[name], opts);
  }

  /**
   * Fire sound. Prefers this weapon's own sample and then trims it with the
   * weapon's own `fx.sound` (gain, playback rate = pitch, low-pass), so two guns
   * that share a shape still do not sound alike; the shape only sets the floor.
   * `style` is optional: without it the weapon's own id still picks the sample.
   */
  shot(weapon, style) {
    const shape = weapon?.shape || 'rifle';
    const base = { smg: 0.7, rifle: 0.85, lmg: 0.95, bolt: 1.0 }[shape] ?? 0.85;
    const snd = style?.sound || {};
    const gain = base * (WEAPON_GAIN[weapon?.id] ?? 1) * (snd.gain ?? 1);
    const rate = snd.rate ?? 1;
    const lpf = snd.lpf || 0;
    if (this._playBuf(this._guns[weapon?.id], { gain, rate, lpf })) return;
    if (this._sample('shot', { gain, rate, lpf })) return;

    const tone = snd.tone ?? 1;
    const p = {
      smg: { dur: 0.11, g: 0.42, f: 1750, q: 0.9, td: 0.07, tg: 0.3, tf: 190, te: 60 },
      rifle: { dur: 0.17, g: 0.5, f: 1350, q: 1.0, td: 0.1, tg: 0.34, tf: 165, te: 52 },
      lmg: { dur: 0.2, g: 0.5, f: 950, q: 0.85, td: 0.13, tg: 0.38, tf: 130, te: 44 },
      bolt: { dur: 0.3, g: 0.62, f: 1150, q: 1.1, td: 0.16, tg: 0.44, tf: 150, te: 40 },
    }[shape] || { dur: 0.15, g: 0.45, f: 1400, q: 1, td: 0.1, tg: 0.3, tf: 160, te: 50 };

    this._noise(p.dur, p.g * gain, p.f * tone, p.q);
    this._noise(p.dur * 1.9, p.g * gain * 0.16, p.f * tone * 0.34, 0.7, 'lowpass');
    this._thump(p.td, p.tg * gain, p.tf * tone, p.te * tone);
  }

  /**
   * Somebody else's gunfire. Same per-weapon character as the shot (so you can
   * tell a Lewis from an SMLE across the trench) but dulled by distance, which
   * also sets the level: near guns crack, far ones only thump.
   */
  shotFar(weapon, style, dist = 30) {
    const snd = style?.sound || {};
    const far = Math.min(1, Math.max(0, dist / 120));
    const gain = 0.5 * (snd.gain ?? 1) * (1 - far * 0.9);
    if (gain < 0.02) return;
    const rate = (snd.rate ?? 1) * (1 - far * 0.12);
    const lpf = 700 + 1800 * (1 - far);
    if (this._playBuf(this._guns[weapon?.id], { gain, rate, lpf })) return;
    if (this._sample('shot', { gain, rate, lpf })) return;
    const shape = weapon?.shape || 'rifle';
    const tone = snd.tone ?? 1;
    const f = (shape === 'bolt' ? 520 : shape === 'lmg' ? 430 : 700) * tone * (1 - far * 0.35);
    this._noise(0.26, 0.16 * gain * 2, f, 0.6, 'lowpass');
    this._thump(0.12, 0.11 * gain * 2, 110 * tone, 42 * tone);
  }

  detonate(kind, distance = 0) {
    const gain = Math.max(0, 1-distance/100);
    if (!gain || !this.enabled) return;
    if (kind === 'flash') { this._noise(0.16,0.18*gain,2600,0.5); return; }
    if (kind === 'smoke' || kind === 'flare') { this._noise(0.22,0.12*gain,900,0.7); return; }
    this._noise(kind === 'incendiary' ? 0.65 : 0.4,0.55*gain,700,0.6,'lowpass');
    this._thump(0.4,0.65*gain,90,28);
  }

  reload() {
    this._blip(0.05, 0.16, 900, 380, 'square');
    setTimeout(() => this._blip(0.05, 0.14, 760, 320, 'square'), 130);
    setTimeout(() => this._blip(0.07, 0.18, 620, 240, 'square'), 0);
  }

  /** Working the bolt on a scout rifle. The M95 carries its own in its shot file. */
  bolt(weapon) {
    if (this._playBuf(this._bolts[weapon?.id], { gain: 0.9 })) return;
    this._blip(0.05, 0.2, 1500, 700, 'square');
    setTimeout(() => this._blip(0.06, 0.22, 900, 380, 'square'), 90);
  }

  empty() { this._blip(0.04, 0.14, 1500, 900, 'square'); }

  hit(headshot) {
    if (this._sample('hit', { gain: headshot ? 1 : 0.85 })) return;
    this._blip(0.05, headshot ? 0.34 : 0.22, headshot ? 1500 : 1050, headshot ? 700 : 520, 'square');
    if (headshot) this._blip(0.11, 0.26, 2100, 950, 'triangle');
  }

  kill() {
    if (this._sample('kill')) return;
    this._blip(0.09, 0.28, 900, 1400, 'triangle');
    setTimeout(() => this._blip(0.16, 0.3, 1500, 700, 'triangle'), 85);
  }

  hurt(amount) {
    if (this._sample('hurt', { gain: 0.9 })) return;
    this._noise(0.14, Math.min(0.4, 0.16 + amount / 260), 380, 0.5, 'lowpass');
    this._thump(0.16, 0.2, 120, 48);
  }

  death() {
    if (this._sample('dead')) return;
    this._thump(0.7, 0.4, 180, 32);
    this._noise(0.6, 0.24, 300, 0.4, 'lowpass');
  }

  ability(kind) {
    if (kind === 'heal') { this._blip(0.3, 0.2, 520, 900, 'sine'); setTimeout(() => this._blip(0.3, 0.16, 700, 1200, 'sine'), 90); }
    else if (kind === 'ammo') { this._blip(0.12, 0.2, 340, 620, 'square'); setTimeout(() => this._blip(0.12, 0.18, 420, 760, 'square'), 90); }
    else if (kind === 'flare') { this._blip(0.4, 0.2, 1300, 500, 'sawtooth'); }
    else if (kind === 'smoke') { this._noise(0.5, 0.16, 900, 0.8, 'lowpass'); this._blip(0.24, 0.14, 320, 180, 'triangle'); }
    else this._blip(0.18, 0.22, 600, 260, 'triangle');
  }

  step() {
    this._noise(0.075, 0.1, 320 + Math.random() * 180, 0.7, 'lowpass');
  }

  spawn() {
    this._blip(0.12, 0.2, 420, 880, 'triangle');
    setTimeout(() => this._blip(0.2, 0.18, 660, 1100, 'triangle'), 110);
  }

  ui() {
    if (this._sample('ui', { gain: 0.6 })) return;
    this._blip(0.06, 0.16, 700, 1100, 'square');
  }
}
