// HUD: everything that lives in the DOM rather than in WebGL.
// Kept deliberately imperative — the game loop calls these once per frame and
// they only touch the DOM when a value actually changed.

import { t, nameOf, otherName, descOf, onLangChange, applyDom } from './i18n.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(data) {
    this.data = data;
    this.el = {
      menu: $('screen-menu'), select: $('screen-select'), settings: $('screen-settings'),
      hud: $('screen-hud'), boot: $('boot'),
      name: $('input-name'), server: $('input-server'),
      roomCreate: $('btn-room-create'), roomJoin: $('btn-room-join'), roomInvite: $('btn-room-invite'),
      roomInput: $('input-room'), roomNote: $('room-note'), roomHistory: $('room-history'),
      roomListNote: $('room-list-note'),
      roomChip: $('room-chip'), roomCode: $('room-code'), roomCopy: $('room-copy'),
      selectRoom: $('select-room'), selectRoomCode: $('select-room-code'),
      selectInvite: $('btn-select-invite'), selectCopy: $('btn-select-copy'),
      botRow: $('bot-row'), botCount: $('bot-count'),
      botDifficulty: $('bot-difficulty'), multiBotCount: $('multi-bot-count'),
      botsLockHint: $('bots-lock-hint'), skinNote: $('skin-note'),
      mapRow: $('map-row'), mapNote: $('map-note'), tbMap: $('tb-map'), mapLoad: $('map-load'),
      modeMulti: $('btn-mode-multi'), modeSolo: $('btn-mode-solo'), modeSettings: $('btn-mode-settings'),
      modeTutorial: $('btn-mode-tutorial'),
      menuError: $('menu-error'),

      classRow: $('class-row'), weaponRow: $('weapon-row'), weaponTitle: $('weapon-title'),
      teamNote: $('team-note'), deploy: $('btn-deploy'), back: $('btn-back'),

      tbName0: $('tb-name-0'), tbName1: $('tb-name-1'),
      tbScore0: $('tb-score-0'), tbScore1: $('tb-score-1'),
      tbTimer: $('tb-timer'), tbLimit: $('tb-limit'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), dmgPops: $('dmg-pops'),
      vignette: $('damage-vignette'), suppress: $('suppress-blur'), hitDir: $('hit-dir'),
      killConfirm: $('kill-confirm'), killLabel: $('kill-label'), killVictim: $('kill-victim'), killStreak: $('kill-streak'),
      killfeed: $('killfeed'), chatLog: $('chat-log'),
      hpFill: $('hp-fill'), hpNum: $('hp-num'), hpCls: $('hp-cls'), hpBar: document.querySelector('.hp-bar'),
      ammoMag: $('ammo-mag'), ammoMax: $('ammo-max'), ammoReserve: $('ammo-reserve'),
      ammoWrap: document.querySelector('.ammo-wrap'),
      reloadFill: $('reload-fill'), reloadText: $('reload-text'),
      grenade: $('grenade-chip'), grenadeName: $('grenade-name'), grenadeInfo: $('grenade-info'), grenadeFill: $('grenade-fill'),
      ability: $('ability-chip'), abName: $('ab-name'), abFill: $('ab-fill'),
      eventToast: $('event-toast'),
      death: $('death-panel'), deathBy: $('death-by'), deathCount: $('death-count'),
      deathLoadout: $('death-loadout'), respawn: $('btn-respawn'),
      scoreboard: $('scoreboard'), sbTimer: $('sb-timer'),
      sbHead0: $('sb-head-0'), sbHead1: $('sb-head-1'), sbBody0: $('sb-body-0'), sbBody1: $('sb-body-1'),
      result: $('result-panel'), resultTitle: $('result-title'),
      result0: $('result-0'), result1: $('result-1'), resultMvp: $('result-mvp'),
      lock: $('lockslot'), lockAction: $('lockslot')?.querySelector('.lock-action'),
      openTab: $('btn-open-tab'),
      pause: $('pause'), pauseNote: $('pause-note'),
      pauseResume: $('btn-pause-resume'), pauseSettings: $('btn-pause-settings'),
      pauseInvite: $('btn-pause-invite'), pauseLeave: $('btn-pause-leave'),
      invite: $('invite'), inviteTitle: $('invite-title'), inviteStep: $('invite-step'),
      inviteCode: $('invite-code'), inviteStatus: $('invite-status'), inviteHelp: $('invite-help'),
      inviteGen: $('btn-invite-gen'), inviteCopy: $('btn-invite-copy'),
      inviteAccept: $('btn-invite-accept'), inviteJoin: $('btn-invite-join'),
      inviteClose: $('btn-invite-close'), inviteStun: $('invite-stun'),
    };
    this._cache = {};
    // true while a thrown ability is being charged, when the chip bar doubles as
    // a power meter instead of the cooldown readout
    this._charging = false;
    this._chatInput = null;
    this._deathSel = { cls: 'assault', weapon: null };
    this._vignetteTimer = null;
    this._hitDirTimer = null;
    // Inputs kept for re-rendering when the language changes mid-session: the
    // panel, the cards and the scoreboard are all built from them.
    this._maps = null;
    this._mapPick = null;
    this._rooms = null;
    this._teamId = 0;
    this._deathInfo = null;
    this._lastScoreboard = null;
    this._lastResult = null;
    this._lockNote = '';
    this._lockSoft = false;
    onLangChange(() => this.relang());
  }

  /**
   * Re-draw everything this HUD built in code after the language changed.
   * Static markup is handled by i18n.applyDom(); this is the dynamic half.
   */
  relang() {
    applyDom();
    this.setTutorialHint();
    this.setTeamColors(this._teamId);
    this.setRoomList(this._rooms);
    this.setRoomMode(this._roomMode || 'create', this.el.roomInput.value);
    if (this._maps) this.buildMaps(this._maps, this._mapPick);
    if (this._mapMeta) this.setCurrentMap(this._mapMeta);
    for (const [id, cls] of Object.entries(this.data.classById)) {
      const card = this.classCards?.[id]?.card;
      if (card) this._fillClassCard(card, cls);
    }
    if (this.selected) {
      this.selectClass(this.selected.cls, 0);
      this.pickWeapon(this.selected.cls, this.selected.weapon);
      this.renderSecondaries();
    }
    // the class and ability names in the bottom-left corner are written by
    // setLoadout, which normally only runs when the loadout changes
    if (this._loadout) this.setLoadout(...this._loadout);
    if (this._lastScoreboard) {
      this._renderScoreboard(this._lastScoreboard[0], this._lastScoreboard[1], this._lastScoreboard[2]);
    }
    if (this._lastResult && !this.el.result.classList.contains('hidden')) {
      this.result(...this._lastResult);
    }
    if (this._deathInfo && !this.el.death.classList.contains('hidden')) {
      const choice = this.deathSelection;
      this.showDeath(this._deathInfo[0], this._deathInfo[1], choice.cls, choice.weapon, choice.secondary);
    }
    if (this._lockSoft || this._cache.lock) this.setLockHint(this._cache.lock, this._lockNote, this._lockTitle || '');
  }

  screen(which) {
    this.el.menu.classList.toggle('hidden', which !== 'menu');
    this.el.select.classList.toggle('hidden', which !== 'select');
    this.el.settings.classList.toggle('hidden', which !== 'settings');
    this.el.hud.classList.toggle('hidden', which !== 'game');
    this.el.boot.classList.add('hidden');
  }

  setTeamColors(teamId) {
    const tm = this.data.teamById[teamId] || this.data.teamById[0];
    document.documentElement.style.setProperty('--team-me', tm.color);
    this._teamId = teamId;
    this.el.teamNote.innerHTML = t('本局阵营：<b style="color:{color}">{team}</b>',
      { color: tm.color, team: nameOf(tm) });
  }

  // ------------------------------------------------------------ menu screen

  bindMenu({ onMulti, onSolo, onSettings, onBotCount, onMap, onRoomMode, onRoomCode, onTutorial,
             onHost, onInvite, onCopyLink }) {
    this.el.modeMulti.addEventListener('click', onMulti);
    this.el.modeSolo.addEventListener('click', onSolo);
    this.el.modeSettings.addEventListener('click', onSettings);
    this.el.modeTutorial.addEventListener('click', onTutorial);
    this.el.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') onMulti(); });
    // "Create a room" opens one *right here* -- the code appears before the
    // match does, so it can be sent to friends while the class is being picked.
    // It used to be a mode toggle only, and clicking it looked like nothing
    // happened until a match was deployed.
    this.el.roomCreate.addEventListener('click', () => onHost?.());
    this.el.roomJoin.addEventListener('click', () => {
      onRoomMode?.('join');
      this.el.roomInput.focus();
    });
    this.el.roomInvite?.addEventListener('click', () => onInvite?.());
    this.el.selectInvite?.addEventListener('click', () => onInvite?.());
    this.el.selectCopy?.addEventListener('click', () => onCopyLink?.());
    // Digits only, and it accepts a pasted "1234 5678": the field shows what was
    // typed, the value is normalised when it is read.
    this.el.roomInput.addEventListener('input', () => {
      const digits = this.el.roomInput.value.replace(/\D/g, '').slice(0, 8);
      this.el.roomInput.value = digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
      onRoomCode?.(digits);
    });
    this.el.roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onMulti(); });
    this.el.mapRow.addEventListener('click', (e) => {
      const b = e.target.closest('.map-btn');
      if (!b || b.classList.contains('on')) return;
      onMap?.(b.dataset.id);
    });
    this.el.botCount.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      for (const x of this.el.botCount.children) x.classList.toggle('on', x === b);
      onBotCount(Number(b.dataset.n));
    });
  }

  get playerName() {
    // The default callsign follows the language; the server takes any 16 chars.
    return this.el.name.value.trim().slice(0, 16) || t('士兵');
  }

  /** Raw server address box text; empty means "use the current page address". */
  get serverAddress() {
    return this.el.server.value.trim();
  }

  setServerAddress(v) {
    this.el.server.value = v || '';
  }

  // ------------------------------------------------------------ 联机房间

  /**
   * Static hosting (Vercel and friends): there is no server, so the room is run
   * by the player who creates it and the notes below say that instead of
   * talking about a server handing out codes.
   */
  setWebHosted(on) {
    this._webHosted = !!on;
    this.setRoomMode(this._roomMode || 'create', this.el.roomInput.value);
  }

  /** 'create' shows no field; 'join' reveals the 8-digit box and focuses it. */
  setRoomMode(mode, code = '') {
    const join = mode === 'join';
    this._roomMode = mode;
    this.el.roomCreate.classList.toggle('on', !join);
    this.el.roomJoin.classList.toggle('on', join);
    this.el.roomInput.classList.toggle('hidden', !join);
    if (join) this.el.roomInput.value = formatRoomCode(code);
    if (join) {
      this.el.roomNote.textContent = this._webHosted
        ? t('房号用于同浏览器标签页；其他设备先交换邀请码和回答码，再等待房主接受申请。')
        : t('输入房主给你的 8 位房号即可加入同一局；房号错一位都会进不去');
    } else {
      this.el.roomNote.textContent = this._webHosted
        ? t('创建后留在主页面接受申请、选择地图，再选择角色并开始；其他设备仍需邀请码配对。')
        : t('创建房间后会生成 8 位房号：发给朋友，朋友选「输入房号加入」就能进同一局（单人模式无需房号）');
    }
  }

  /** Digits the player typed/selected, no spaces. */
  get joinCode() {
    return this.el.roomInput.value.replace(/\D/g, '').slice(0, 8);
  }

  /** Previously used codes, offered as autocomplete on the join field. */
  setRoomHistory(codes) {
    this.el.roomHistory.innerHTML = '';
    for (const c of codes || []) {
      const opt = document.createElement('option');
      opt.value = formatRoomCode(c);
      this.el.roomHistory.appendChild(opt);
    }
  }

  /**
   * "N rooms online" line under the menu. The list holds two kinds of room:
   * those a game server is running, and those some player is hosting in their
   * own browser (relay.js); only the code matters when joining either.
   */
  setRoomList(rooms) {
    this._rooms = rooms;
    const list = (rooms || []).filter((r) => r.players > 0);
    if (!list.length) {
      this.el.roomListNote.textContent = t('当前没有别人开的房间：点「创建房间」你就是房主');
      return;
    }
    const busy = list.filter((r) => r.players < (r.max || 32));
    const players = list.filter((r) => r.relay).length;
    this.el.roomListNote.textContent = t('在线房间 {n} 个 · 可加入 {join} 个',
      { n: list.length, join: busy.length })
      + (players ? t('（其中 {p} 个由玩家浏览器主持）', { p: players }) : '')
      + t('（用房号加入，房号请向房主要）');
  }

  /** The chip in the HUD: the code to read out to friends. */
  setRoomCode(code) {
    this._roomCode = code || '';
    const show = !!code;
    this.el.roomChip.classList.toggle('hidden', !show);
    if (show) this.el.roomCode.textContent = formatRoomCode(code);
    // The class screen shows the same room: the host got there from 「创建房间」
    // and must be able to pass the code on (or invite a friend) before deploying.
    this.el.selectRoom?.classList.toggle('hidden', !show);
    if (this.el.selectRoomCode) this.el.selectRoomCode.textContent = show ? formatRoomCode(code) : '--------';
  }

  /**
   * A room hosted in a player's browser is easier to pass on as a link than as
   * eight digits, so the chip copies this instead when there is one.
   */
  setRoomLink(url) {
    this._roomLink = url || '';
  }

  /** Copy the room link (or the code) and say whether it worked. */
  async copyRoomLink() {
    const text = this._roomLink || this._roomCode || '';
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }

  onRoomChipClick(handler) {
    this.el.roomChip.addEventListener('click', async () => {
      if (!(this._roomLink || this._roomCode)) return;
      const ok = await this.copyRoomLink();
      this.el.roomChip.classList.toggle('copied', ok);
      this.el.roomCopy.textContent = ok ? t('已复制') : t('复制失败');
      clearTimeout(this._roomCopyTimer);
      this._roomCopyTimer = setTimeout(() => {
        this.el.roomChip.classList.remove('copied');
        this.el.roomCopy.textContent = t('复制');
      }, 1600);
      handler?.(this._roomCode || '', ok);
    });
  }

  /** Main-menu bot settings; multiplayer choices are locked to the host. */
  setBotsVisible(visible) {
    this.el.botRow.classList.toggle('hidden', !visible);
    this.el.botsLockHint.classList.toggle('hidden', !visible);
  }

  setSkinNote(text) {
    this.el.skinNote.textContent = text || '';
  }

  /** First visit: point at the walkthrough instead of letting them guess. */
  setTutorialHint() {
    const btn = this.el.modeTutorial;
    if (!btn) return;
    btn.classList.add('suggested');
    const span = btn.querySelector('span');
    if (span) span.textContent = t('第一次玩？从这里开始 · 学会手榴弹与据点控制');
  }

  // ------------------------------------------------------------ map picker

  buildMaps(maps, currentId) {
    this._maps = maps;
    this.el.mapRow.innerHTML = '';
    this._mapBtns = {};
    for (const m of maps) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'map-btn';
      b.dataset.id = m.id;
      b.innerHTML = `<b>${esc(nameOf(m))}</b><span>${esc(descOf(m) || '')}</span>`;
      this.el.mapRow.appendChild(b);
      this._mapBtns[m.id] = b;
    }
    this.setMapPick(currentId);
  }

  setMapPick(id) {
    this._mapPick = id;
    for (const [mid, b] of Object.entries(this._mapBtns || {})) {
      b.classList.toggle('on', mid === id);
    }
    const m = this.data.mapById[id];
    if (m) this.el.mapNote.textContent = [nameOf(m), descOf(m)].filter(Boolean).join(' · ');
  }

  /** Full-screen veil while a model map streams in — a 92 MB GLB is not instant. */
  showMapLoad(text) {
    if (text) this.el.mapLoad.querySelector('.boot-text').textContent = text;
    this.el.mapLoad.classList.remove('hidden');
  }

  hideMapLoad() {
    this.el.mapLoad.classList.add('hidden');
  }

  /** The map chip in the top bar; the row is kept so relang() can redraw it. */
  setCurrentMap(map) {
    this._mapMeta = typeof map === 'string' ? { name: map } : (map || null);
    const name = nameOf(this._mapMeta) || '';
    if (this._cache.mapName !== name) {
      this._cache.mapName = name;
      this.el.tbMap.textContent = name;
    }
  }

  get botCount() {
    const on = this.el.botCount.querySelector('button.on');
    return on ? Number(on.dataset.n) : 6;
  }

  menuError(msg) {
    this.el.menuError.textContent = msg || '';
  }

  // ---------------------------------------------------------- class select

  /** @param {(cls:string, weapon:string)=>void} onDeploy */
  buildSelect(onPick, onDeploy, onBack) {
    const row = this.el.classRow;
    row.innerHTML = '';
    this.classCards = {};
    for (const cls of this.data.classes) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'class-card';
      card.style.setProperty('--tc', cls.themeColor);

      const cv = document.createElement('canvas');
      card.appendChild(cv);
      this._fillClassCard(card, cls);

      card.addEventListener('click', () => onPick(cls.id));
      row.appendChild(card);
      this.classCards[cls.id] = { card, canvas: cv };
    }

    this.renderSecondaries();
    this.el.deploy.addEventListener('click', onDeploy);
    this.el.back.addEventListener('click', onBack);
  }

  /**
   * One class card's text, in the current language. Split out of buildSelect so
   * a language change can redraw the cards without rebuilding the canvases
   * (the portraits are drawn into them by main.js).
   */
  _fillClassCard(card, cls) {
    const line = (name, text) => {
      let el = card.querySelector('.' + name);
      if (!el) {
        el = document.createElement('div');
        el.className = name;
        card.appendChild(el);
      }
      el.textContent = text;
      return el;
    };
    line('cc-name', nameOf(cls));
    // the second line carries the other language's name, so the card always
    // shows both spellings whatever the interface is set to
    line('cc-en', otherName(cls).toUpperCase());
    line('cc-role', descOf(cls, 'role'));
    line('cc-tag', descOf(cls, 'tagline'));
    const stats = line('cc-stats', '');
    stats.innerHTML = `<span>HP <b>${cls.maxHp}</b></span>`
      + `<span>${t('机动')} <b>×${cls.speedMult.toFixed(2)}</b></span>`;
  }

  selectClass(clsId, teamId) {
    for (const [id, c] of Object.entries(this.classCards)) {
      c.card.classList.toggle('on', id === clsId);
      c.card.setAttribute('aria-pressed', String(id === clsId));
    }
    const cls = this.data.classById[clsId];
    this.el.weaponTitle.textContent = `${nameOf(cls)} · ${t('主武器')}`;
    const row = this.el.weaponRow;
    row.innerHTML = '';
    this.weaponCards = {};
    for (const w of this.data.weaponsByClass[clsId]) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'weapon-card';
      card.style.setProperty('--tc', cls.themeColor);
      this._fillWeaponCard(card, w);
      card.addEventListener('click', () => this.pickWeapon(clsId, w.id));
      row.appendChild(card);
      this.weaponCards[w.id] = card;
    }
  }

  renderSecondaries() {
    const row=document.getElementById('secondary-row');
    row.innerHTML='';
    this.secondaryCards={};
    for(const w of this.data.secondaries){
      const card=document.createElement('button');card.type='button';card.className='weapon-card';
      this._fillWeaponCard(card,w);card.onclick=()=>this.pickSecondary(w.id);
      row.appendChild(card);this.secondaryCards[w.id]=card;
    }
    this.pickSecondary(this.secondary||this.data.secondaries[0].id);
  }
  pickSecondary(id) {
    this.secondary=this.data.secondaries.some(w=>w.id===id)?id:this.data.secondaries[0].id;
    if(this.selected)this.selected.secondary=this.secondary;
    for (const [key, card] of Object.entries(this.secondaryCards || {})) {
      card.classList.toggle('on', key === this.secondary);
      card.setAttribute('aria-pressed', String(key === this.secondary));
    }
  }

  /** One weapon card, in the current language (see _fillClassCard). */
  _fillWeaponCard(card, w) {
    const bars = [
      [t('伤害'), w.dmg / 100],
      [t('射速'), w.rpm / 950],
      [t('弹匣'), w.mag / 105],
      [t('精准'), 1 - w.spreadDeg / 2.6],
      [t('射程'), (w.falloffMaxM || w.rangeM) / 125],
    ].map(([label, v]) => `
        <div class="wc-bar"><span>${label}</span><i><b style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></b></i></div>
      `).join('');
    card.innerHTML = `
        <div class="wc-name">${esc(nameOf(w))}</div>
        <div class="wc-en">${esc(otherName(w).toUpperCase())}</div>
        <div class="wc-desc">${esc(descOf(w))}</div>
        ${bars}
        ${w.lethalBody ? `<span class="wc-tag">${t('{a}-{b}m 躯干致命', {
          a: Math.round(w.lethalMinM || 0), b: Math.round(w.lethalMaxM || 0),
        })}</span>` : ''}
        ${w.scope ? `<span class="wc-tag">${t('瞄准镜')}</span>` : ''}
        ${w.auto ? `<span class="wc-tag">${t('全自动')}</span>` : `<span class="wc-tag">${t('半自动/栓动')}</span>`}
      `;
  }

  pickWeapon(clsId, weaponId) {
    this.selected = { cls: clsId, weapon: weaponId, secondary:this.secondary||this.data.secondaries[0].id };
    for (const [id, c] of Object.entries(this.weaponCards)) {
      c.classList.toggle('on', id === weaponId);
      c.setAttribute('aria-pressed', String(id === weaponId));
    }
  }

  // ------------------------------------------------------------------ HUD

  setLoadout(clsId, weaponId) {
    // remembered so a language change can redraw the class and ability names
    this._loadout = [clsId, weaponId];
    const cls = this.data.classById[clsId];
    const w = this.data.weaponById[weaponId] || this.data.grenadeById?.[weaponId];
    this.el.hpCls.textContent = nameOf(cls);
    this.el.abName.textContent = descOf(cls, 'abilityName');
    this.el.ammoMax.textContent = `/${w.mag}`;
    this._hpMax = cls.maxHp;
    this._magMax = w.mag;
  }

  /**
   * Charge readout for a thrown ability: `power` 0-1 while Q is held, or null to
   * hand the chip back to the cooldown display.
   */
  setAbilityCharge(power) {
    this._charging = power != null;
    this.el.ability.classList.toggle('charging', this._charging);
    if (this._charging) {
      this.el.abFill.style.width = `${Math.max(0, Math.min(1, power)) * 100}%`;
    }
  }

  updateTopbar(state) {
    const c = this._cache;
    if (c.s0 !== state.s[0]) { this.el.tbScore0.textContent = state.s[0]; c.s0 = state.s[0]; }
    if (c.s1 !== state.s[1]) { this.el.tbScore1.textContent = state.s[1]; c.s1 = state.s[1]; }
    const rule = state.gameMode === 'control' ? t('据点控制') : t('团队死斗');
    const limitText = `${state.limit} · ${rule}`;
    if (c.limitText !== limitText) { this.el.tbLimit.textContent = limitText; c.limitText = limitText; }
    const remain = Math.max(0, Math.ceil(state.endsIn / 1000));
    if (c.remain !== remain) {
      c.remain = remain;
      const txt = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
      this.el.tbTimer.textContent = txt;
      this.el.sbTimer.textContent = txt;
    }
  }

  updateMe(me) {
    const c = this._cache;
    const hp = Math.max(0, me.hp);
    if (c.hp !== hp) {
      c.hp = hp;
      const pct = (hp / me.hpMax) * 100;
      this.el.hpFill.style.width = `${pct}%`;
      this.el.hpNum.textContent = hp;
      this.el.hpBar.classList.toggle('low', pct <= 35);
    }
    if (c.mag !== me.mag || c.magMax !== me.magMax) {
      c.mag = me.mag; c.magMax = me.magMax;
      this.el.ammoMag.textContent = me.mag;
      this.el.ammoMax.textContent = `/${me.magMax}`;
      this.el.ammoWrap.classList.toggle('empty', me.mag === 0);
    }
    const reserve = me.reserve ?? 0;
    if (c.reserve !== reserve) {
      c.reserve = reserve;
      this.el.ammoReserve.textContent = reserve;
      this.el.ammoReserve.classList.toggle('dry', reserve === 0);
    }
    if (c.reloading !== !!me.reloading) {
      c.reloading = !!me.reloading;
      this.el.ammoWrap.classList.toggle('reloading', !!me.reloading);
    }
    if (me.reloading) {
      const w = this.data.weaponById[me.w];
      const k = 1 - me.reloadIn / Math.max(1, me.reloadTotal || w.reloadMs);
      this.el.reloadFill.style.width = `${Math.max(0, Math.min(1, k)) * 100}%`;
    }
    const abPct = me.abilityIn > 0 ? 0 : 1;
    if (c.ab !== abPct) {
      c.ab = abPct;
      this.el.ability.classList.toggle('ready', abPct === 1);
    }
    if (!this._charging) {
      if (me.abilityIn > 0) {
        const cls = this.data.classById[me.c];
        this.el.abFill.style.width = `${(1 - me.abilityIn / cls.abilityCdMs) * 100}%`;
      } else {
        this.el.abFill.style.width = '100%';
      }
    }
    if (c.alive !== !!me.alive) {
      c.alive = !!me.alive;
      this.el.crosshair.style.opacity = me.alive ? '1' : '0.25';
    }
  }

  crosshair(spreadPx) {
    if (this._cache.ch !== spreadPx) {
      this._cache.ch = spreadPx;
      this.el.crosshair.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
    }
  }

  hitmarker(killed) {
    const h = this.el.hitmarker;
    h.classList.remove('show');
    h.classList.toggle('kill', !!killed);
    void h.offsetWidth;
    h.classList.add('show');
  }

  confirmKill(victim,headshot=false) {
    const now=performance.now();
    this._killChain=now-(this._lastKillAt??-Infinity)<3000?(this._killChain||0)+1:1;
    this._lastKillAt=now;
    this.hitmarker(true);
    const el=this.el.killConfirm;if(!el)return;
    this.el.killLabel.textContent=headshot?t('爆头击杀！'):t('击杀确认');
    this.el.killVictim.textContent=String(victim||'').slice(0,64);
    this.el.killStreak.textContent=this._killChain>1?`${this._killChain} × ${t('连续击杀')}`:'';
    el.classList.remove('show');el.classList.toggle('headshot',headshot);
    void el.offsetWidth;el.classList.add('show');
  }

  resetCombatFeedback(){
    this._killChain=0;this._lastKillAt=-Infinity;
    this.el.killConfirm?.classList.remove('show','headshot');
    this.el.hitmarker?.classList.remove('show','kill');
  }

  /** Floating damage number shown to the shooter on every confirmed hit. */
  updateGrenade(kind, me, power = null, mobile = false) {
    const spec = this.data.grenadeById[kind];
    if (!spec || !this.el.grenade) return;
    const count = me?.grenades ?? 2, cooldown = Math.ceil((me?.grenadeIn || 0) / 1000);
    const name = `${nameOf(spec)} ×${count}`;
    const info = power !== null ? t('投掷力度 {n}%', { n: Math.round(power*100) }) : cooldown > 0 ? t('补充倒计时 {n}秒', { n: cooldown }) : (mobile ? t('按住手榴弹投掷 · 点击切换') : t('按住 {throwKey} 投掷 · {cycleKey} 切换', {throwKey:this.keyLabel?.('grenade') || 'G', cycleKey:this.keyLabel?.('grenadeCycle') || 'B'}));
    if (this.el.grenadeName.textContent !== name) this.el.grenadeName.textContent = name;
    if (this.el.grenadeInfo.textContent !== info) this.el.grenadeInfo.textContent = info;
    this.el.grenade.classList.toggle('charging', power !== null);
    const fill = power !== null ? power : cooldown ? 1-(me.grenadeIn / this.data.combat.throw.grenadeCdMs) : 1;
    this.el.grenadeFill.style.width = `${Math.max(0, Math.min(1, fill))*100}%`;
  }

  damagePopup(amount, zone, killed) {
    const pop = document.createElement('div');
    pop.className = `dmg-pop${zone === 'head' ? ' head' : ''}${killed ? ' kill' : ''}`;
    pop.textContent = String(amount);
    // Scatter a little so a burst of hits does not stack into one unreadable blob.
    pop.style.setProperty('--dx', `${(Math.random() - 0.5) * 34}px`);
    pop.addEventListener('animationend', () => pop.remove());
    this.el.dmgPops.appendChild(pop);
    while (this.el.dmgPops.children.length > 12) this.el.dmgPops.firstChild.remove();
  }

  /**
   * Red glow on the screen edge facing the damage source.
   * @param {number} bearingDeg 0 = dead ahead, growing clockwise (right side).
   */
  damageDirection(bearingDeg) {
    const d = this.el.hitDir;
    d.style.setProperty('--dir', `${Math.round(bearingDeg)}deg`);
    d.style.transition = 'none';
    d.style.opacity = '1';
    clearTimeout(this._hitDirTimer);
    this._hitDirTimer = setTimeout(() => {
      d.style.transition = 'opacity .5s ease-out';
      d.style.opacity = '0';
    }, 90);
  }

  damage(amount) {
    const v = this.el.vignette;
    v.style.transition = 'none';
    v.style.opacity = String(Math.min(0.95, 0.34 + amount / 130));
    clearTimeout(this._vignetteTimer);
    this._vignetteTimer = setTimeout(() => {
      v.style.transition = 'opacity .45s ease-out';
      v.style.opacity = '0';
    }, 60);
    this.el.crosshair.classList.remove('hidden');
  }

  setSuppressed(on) {
    if (this._cache.sup !== on) {
      this._cache.sup = on;
      this.el.suppress.style.opacity = on ? '1' : '0';
    }
  }

  toast(text, ms = 2200) {
    const box = this.el.eventToast;
    box.textContent = text;
    box.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => box.classList.add('hidden'), ms);
  }

  /**
   * The native-pointer-lock prompt. A denied request keeps the mouse free and
   * shows a retry/open-in-new-tab explanation; no alternative steering mode.
   */
  setLockHint(show, note = '', heading = '', action = false) {
    const soft = !!note;
    if (this._cache.lock === show && this._cache.lockNote === note && this._lockHeading === heading
      && this._lockAction === !!action) return;
    this._cache.lock = show;
    this._cache.lockNote = note;
    this._lockHeading = heading;
    this._lockAction = !!action;
    this.el.lock.classList.toggle('hidden', !show);
    this.el.lock.classList.toggle('soft', soft);
    const title = this.el.lock.querySelector('.lock-title');
    const sub = this.el.lock.querySelector('.lock-sub');
    this._lockSoft = soft;
    this._lockNote = note;
    if (title) title.textContent = heading || (soft ? t('光标已释放') : t('点击画面继续战斗'));
    if (sub) sub.textContent = soft ? note : t('鼠标将被锁定 · 按 Esc 释放');
    this.el.lockAction?.classList.toggle('hidden', !action);
  }

  // --------------------------------------------------------------- 暂停菜单

  /** Buttons of the pause menu; `onInvite` is only offered to a host. */
  bindPause({ onResume, onSettings, onLeave, onInvite } = {}) {
    this.el.pauseResume?.addEventListener('click', () => onResume?.());
    this.el.pauseSettings?.addEventListener('click', () => onSettings?.());
    this.el.pauseLeave?.addEventListener('click', () => onLeave?.());
    this.el.pauseInvite?.addEventListener('click', () => onInvite?.());
    this.el.openTab?.addEventListener('click', () => {
      // A page that cannot lock the mouse is almost always an embedded one, and
      // a tab of its own is the one thing that fixes it for good.
      window.open(location.href, '_blank', 'noopener');
    });
  }

  /**
   * `info` is what the pause menu says about the match you are in: the room
   * code, how many guests, which map. Optional.
   */
  showPause(info = {}) {
    if (!this.el.pause) return;
    this.el.pause.classList.remove('hidden');
    this.el.pauseNote.textContent = info.note || t('按 Esc 打开这个菜单；「继续战斗」回到战场。');
    // The invite button only means something to the player running the room.
    this.el.pauseInvite?.classList.toggle('hidden', !info.host);
  }

  hidePause() {
    this.el.pause?.classList.add('hidden');
  }

  get paused() { return !!this.el.pause && !this.el.pause.classList.contains('hidden'); }

  // ------------------------------------------- 邀请码（不用任何服务器联机）

  /**
   * The invite panel has two jobs and they look almost the same, so it is one
   * box with a mode: a host *makes* invite codes and pastes the answers, a
   * guest *pastes* an invite and copies the answer back out. `mode`:
   *   'host'  - buttons: 生成邀请码 / 复制 / 完成配对
   *   'guest' - buttons: 加入 / 复制
   */
  bindInvite({ onGenerate, onCopy, onAccept, onJoin, onClose, onStun } = {}) {
    this.el.inviteGen?.addEventListener('click', () => onGenerate?.());
    this.el.inviteCopy?.addEventListener('click', () => onCopy?.(this.el.inviteCode?.value || ''));
    this.el.inviteAccept?.addEventListener('click', () => onAccept?.(this.el.inviteCode?.value || ''));
    this.el.inviteJoin?.addEventListener('click', () => onJoin?.(this.el.inviteCode?.value || ''));
    this.el.inviteClose?.addEventListener('click', () => onClose?.());
    this.el.inviteStun?.addEventListener('change', () => onStun?.(!!this.el.inviteStun.checked));
  }

  openInvite(mode, { room = '', stun = false } = {}) {
    if (!this.el.invite) return;
    this._inviteMode = mode;
    const host = mode === 'host';
    this.el.invite.classList.remove('hidden');
    this.el.inviteTitle.textContent = host ? t('邀请朋友（不同电脑，不用任何服务器）') : t('用邀请码加入');
    this.el.inviteStep.textContent = host
      ? t('把邀请码发给一位朋友（聊天、邮件都行）；他那一页会给出回答码，粘回下面按「完成配对」即可。')
      : t('把房主给你的邀请码粘到下面，按「加入」；之后把你得到的回答码发回给房主。');
    this.el.inviteGen?.classList.toggle('hidden', !host);
    this.el.inviteAccept?.classList.toggle('hidden', !host);
    this.el.inviteJoin?.classList.toggle('hidden', host);
    this.el.inviteCode.value = '';
    this.el.inviteCode.placeholder = host
      ? t('生成后邀请码会出现在这里，也可以把朋友的回答码粘进来')
      : t('把邀请码粘到这里（以 TFi1 开头）');
    this.el.inviteCount = 0;
    this.el.inviteStun.checked = !!stun;
    this.el.inviteHelp.textContent = host
      ? t('房号 {code} · 同一个浏览器多开标签页不需要邀请码，直接用房号即可', { code: formatRoomCode(room) })
      : '';
    this.inviteStatus('');
  }

  closeInvite() { this.el.invite?.classList.add('hidden'); }

  get inviteOpen() { return !!this.el.invite && !this.el.invite.classList.contains('hidden'); }

  inviteStatus(text, ok = true) {
    if (!this.el.inviteStatus) return;
    this.el.inviteStatus.textContent = text || '';
    this.el.inviteStatus.className = 'invite-status' + (text ? (ok ? ' ok' : ' bad') : '');
  }

  // -------------------------------------------------------------- kill feed

  addKill(k, v, weaponId, headshot, myId) {
    const w = this.data.weaponById[weaponId] || this.data.grenadeById?.[weaponId];
    const killerMe = k.id === myId;
    const victimMe = v.id === myId;
    const div = document.createElement('div');
    div.className = `kf${killerMe ? ' me' : ''}${victimMe ? ' victim' : ''}`;
    div.innerHTML = `
      <span class="who" style="color:${this.data.teamById[k.tm].color}">${esc(k.n)}</span>
      ${headshot ? '<span class="hs">✦</span>' : ''}
      <span class="wep">${esc(w ? nameOf(w) : weaponId)}</span>
      <span class="who" style="color:${this.data.teamById[v.tm].color}">${esc(v.n)}</span>
    `;
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
    setTimeout(() => div.remove(), 6500);
  }

  chatLine(name, teamId, text) {
    const div = document.createElement('div');
    div.className = 'chat-line';
    div.innerHTML = `<b style="color:${this.data.teamById[teamId].color}">${esc(name)}</b>${esc(text)}`;
    this.el.chatLog.appendChild(div);
    while (this.el.chatLog.children.length > 6) this.el.chatLog.firstChild.remove();
    setTimeout(() => div.remove(), 12000);
  }

  chatOpen(onSend) {
    if (this._chatInput) return;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 120;
    inp.placeholder = t('说点什么…  Enter 发送 · Esc 取消');
    Object.assign(inp.style, {
      position: 'fixed', left: '50%', bottom: '120px', transform: 'translateX(-50%)',
      width: 'min(560px,80vw)', padding: '12px 16px', font: '700 15px/1 var(--font)',
      color: '#fff', background: 'rgba(8,11,18,.94)', border: '2px solid #ffcf5c',
      borderRadius: '10px', outline: 'none', zIndex: 60,
    });
    document.body.appendChild(inp);
    this._chatInput = inp;
    document.exitPointerLock?.();
    inp.focus();
    // Runs exactly once: removing the focused box fires a blur, and blur is
    // also a close path, so without this guard the second call removed an
    // already-detached node -- that threw NotFoundError *before* onSend(), so
    // pressing Enter wiped the box and silently dropped the message instead of
    // sending it.
    let closed = false;
    const done = (send) => {
      if (closed) return;
      closed = true;
      const v = inp.value.trim();
      this._chatInput = null;
      inp.remove();
      if (send && v) onSend(v);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    inp.addEventListener('blur', () => done(false));
  }

  // ------------------------------------------------------------ death panel

  showDeath(killerName, weaponName, curCls, curWeapon, secondary) {
    this._deathInfo = [killerName, weaponName, curCls, curWeapon, secondary];
    this.el.deathBy.innerHTML = killerName
      ? t('被 <b>{killer}</b> 用 {weapon} 击倒', { killer: esc(killerName), weapon: esc(weaponName || '') })
      : t('被击倒');
    // Default the picker to the loadout the player is already carrying. Without
    // this every plain redeploy silently forced 突击兵 + its first weapon, which
    // is what made the gun on screen stop matching the HUD.
    if (curCls) this._deathSel.cls = curCls;
    this._deathSel.weapon = curWeapon || null;
    this._deathSel.secondary = secondary || this.secondary || this.data.secondaries[0].id;
    this.el.death.classList.remove('hidden');
    this.el.deathLoadout.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'dl-sub';
    info.textContent = t('阵亡期间可更换兵种与武器');
    this.el.deathLoadout.appendChild(info);

    const classes = document.createElement('div');
    classes.className = 'dl-classes';
    classes.setAttribute('role', 'group');
    classes.setAttribute('aria-label', t('兵种'));
    this.el.deathLoadout.appendChild(classes);
    const weapons = document.createElement('div');
    weapons.className = 'dl-weapons';
    this.el.deathLoadout.appendChild(weapons);
    for (const cls of this.data.classes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dl-btn';
      b.textContent = nameOf(cls);
      b.dataset.cls = cls.id;
      b.onclick = () => {
        this._deathSel.cls = cls.id;
        this._deathSel.weapon = null;
        this._renderDeathWeapons();
        this._markDeath();
      };
      classes.appendChild(b);
    }
    this._renderDeathWeapons();
    this._markDeath();
  }

  _renderDeathWeapons() {
    const cls = this._deathSel.cls;
    const weapons = this.data.weaponsByClass[cls];
    if (!weapons.some(w => w.id === this._deathSel.weapon)) this._deathSel.weapon = weapons[0].id;
    const pistols = this.data.secondaries;
    if (!pistols.some(w => w.id === this._deathSel.secondary)) this._deathSel.secondary = pistols[0]?.id || 'apx';
    const box = this.el.deathLoadout.querySelector('.dl-weapons');
    box.replaceChildren();
    const section = (slot, label, choices, field) => {
      const group = document.createElement('section');
      group.className = `dl-section dl-${field}`;
      group.setAttribute('aria-label', label);
      const title = document.createElement('h3');
      title.textContent = `${slot} · ${label}`;
      group.appendChild(title);
      const grid = document.createElement('div');
      grid.className = 'dl-options';
      group.appendChild(grid);
      for (const w of choices) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dl-btn dl-card';
        btn.dataset[field] = w.id;
        const name = document.createElement('span');
        name.className = 'dl-card-name';
        name.textContent = nameOf(w);
        const sub = document.createElement('span');
        sub.className = 'dl-card-sub';
        const alternate = otherName(w);
        sub.textContent = alternate && alternate !== name.textContent ? alternate : t('弹匣 {n} 发', { n:w.mag });
        btn.append(name, sub);
        btn.onclick = () => { this._deathSel[field] = w.id; this._markDeath(); };
        grid.appendChild(btn);
      }
      box.appendChild(group);
    };
    section(1, t('主武器'), weapons, 'weapon');
    section(2, t('副武器 · 选择一把手枪'), pistols, 'secondary');
    this._markDeath();
  }

  _markDeath() {
    for (const btn of this.el.deathLoadout.querySelectorAll('.dl-btn')) {
      const selected = btn.dataset.cls ? btn.dataset.cls === this._deathSel.cls
        : btn.dataset.secondary ? btn.dataset.secondary === this._deathSel.secondary
        : btn.dataset.weapon === this._deathSel.weapon;
      btn.classList.toggle('on', selected);
      btn.setAttribute('aria-pressed', String(selected));
    }
  }

  get deathSelection() {
    const cls = this._deathSel.cls;
    const weapon = this._deathSel.weapon || this.data.weaponsByClass[cls][0].id;
    return { cls, weapon, secondary:this._deathSel.secondary||this.secondary||this.data.secondaries[0].id };
  }

  setRespawnReady(seconds, onRespawn) {
    const b = this.el.respawn;
    if (seconds > 0) {
      b.disabled = true;
      b.textContent = t('重新部署 ({s})', { s: seconds });
      this.el.deathCount.innerHTML = `<b>${seconds}</b> ${t('秒后可重新部署')}`;
    } else {
      b.disabled = false;
      b.textContent = t('重新部署 · {cls}', { cls: nameOf(this.data.classById[this._deathSel.cls]) });
      this.el.deathCount.textContent = t('可以重新部署了');
      b.onclick = onRespawn;
    }
  }

  hideDeath() {
    this.el.death.classList.add('hidden');
  }

  // ------------------------------------------------------------- scoreboard

  scoreboard(show, players, state, myId, myTeam) {
    if (this._cache.sb === show && show) {
      this._renderScoreboard(players, state, myId);
      return;
    }
    this._cache.sb = show;
    this.el.scoreboard.classList.toggle('hidden', !show);
    if (show) this._renderScoreboard(players, state, myId);
  }

  _renderScoreboard(players, state, myId) {
    this._lastScoreboard = [players, state, myId];
    for (let teamId = 0; teamId < 2; teamId++) {
      const team = this.data.teamById[teamId];
      const head = teamId === 0 ? this.el.sbHead0 : this.el.sbHead1;
      const body = teamId === 0 ? this.el.sbBody0 : this.el.sbBody1;
      head.textContent = `${nameOf(team)}  ${state.s[teamId]}`;
      head.style.background = `linear-gradient(90deg, ${team.color}55, transparent)`;
      head.style.color = team.color;

      const rows = players
        .filter((p) => p.tm === teamId)
        .sort((a, b) => b.k - a.k || a.d - b.d);
      body.innerHTML = rows.map((p) => `
        <tr class="${p.i === myId ? 'me' : ''}${p.al ? '' : ' dead'}">
          <td>${esc(p.n)}<div class="sb-cls">${esc(nameOf(this.data.classById[p.c]))}${p.ai ? ` · ${esc(t({recruit:'AI 新兵',regular:'AI 普通',veteran:'AI 老兵',elite:'AI 精英'}[p.ai] || 'AI'))}` : ''}</div></td>
          <td class="k">${p.k}</td>
          <td class="d">${p.d}</td>
        </tr>
      `).join('');
    }
  }

  // ----------------------------------------------------------------- result

  result(state, players, myId) {
    this._lastResult = [state, players, myId];
    const win = state.winner;
    const tm = this.data.teamById[win];
    this.el.resultTitle.textContent = win < 0 ? t('平局') : t('{team} 胜利', { team: nameOf(tm) });
    this.el.resultTitle.style.color = win < 0 ? '#fff' : tm.color;
    this.el.result0.textContent = state.s[0];
    this.el.result1.textContent = state.s[1];
    const top = [...players].sort((a, b) => b.k - a.k).slice(0, 5);
    this.el.resultMvp.innerHTML = top.map((p, i) => `
      <div class="mvp-row">
        <span>${i + 1}. <span style="color:${this.data.teamById[p.tm].color}">${esc(p.n)}</span>
        <span style="opacity:.6;font-size:11px"> · ${esc(nameOf(this.data.classById[p.c]))}</span></span>
        <b>${p.k} / ${p.d}</b>
      </div>
    `).join('');
    this.el.result.classList.remove('hidden');
  }

  hideResult() {
    this.el.result.classList.add('hidden');
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 12345678 -> "1234 5678": a code people can read out loud. */
export function formatRoomCode(code) {
  const d = String(code || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 4)} ${d.slice(4)}` : d;
}
