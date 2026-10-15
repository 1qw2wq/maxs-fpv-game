// Beginner tutorial: the first five minutes of the game, walked through.
//
// Design notes:
//  * It runs in a real match (solo, no bots) rather than on a special screen, so
//    every step is the actual control path -- the same WASD, the same reload, the
//    same ability key. Nothing is simulated, so nothing here can disagree with
//    the game.
//  * Steps complete from real input (main.js calls notify(), or update() reads
//    the controls), never from a timer, so a player can take as long as they like.
//  * It is skippable at every point and remembers being finished in the local
//    profile, so it never nags a returning player.
//  * The overlay is pointer-events:none apart from the panel itself: the player
//    keeps playing while it is on screen.

import { t, onLangChange } from './i18n.js';

const PANEL_ID = 'tutorial';

/** One entry per skill. `test` gets fresh per-run accumulators. */
const STEPS = [
  {
    id: 'move', title: '① 移动', key: 'W A S D',
    text: '按住 W A S D 走动，方向跟着你的准星走。',
    tip: 'C 蹲下能从低矮的坑道里钻过去，收益是更小的暴露面积。',
    test: (s, dt, ctx) => {
      if (ctx.speed > 2.5) s.move += dt;
      return s.move > 1.2;
    },
  },
  {
    id: 'look', title: '② 视角', key: '鼠标',
    text: '点击画面锁定鼠标，然后移动鼠标环顾四周；按 Esc 释放。',
    tip: '无法锁定鼠标时，点击画面重试或在新标签页打开；游戏只使用原生鼠标锁定。',
    test: (s, dt, ctx) => {
      if (s.lastYaw === null) s.lastYaw = ctx.yaw;
      let d = Math.abs(ctx.yaw - s.lastYaw);
      if (d > 180) d = 360 - d;
      s.turned += d;
      s.lastYaw = ctx.yaw;
      return s.turned > 60;
    },
  },
  {
    id: 'fire', title: '③ 开火', key: '左键',
    text: '按住鼠标左键开火：全自动武器按住就是连发。',
    tip: '子弹是从枪口出来的，贴着掩体射击容易被自己人挡住。',
    test: (s) => s.events.fire >= 1,
  },
  {
    id: 'aim', title: '④ 机瞄', key: '右键',
    text: '按住鼠标右键抬枪 / 开镜：散射更小、视野更窄，远距离必须这么打。',
    tip: '栓动步枪除曼利夏 M95 之外，开镜期间是无法拉栓上膛的。',
    test: (s, dt, ctx) => {
      if (ctx.ads) s.ads += dt;
      return s.ads > 0.4;
    },
  },
  {
    id: 'reload', title: '⑤ 换弹', key: 'R',
    text: '按 R 换弹。弹匣空了会自动换，但主动换弹更安全。',
    tip: '换弹时左下角会显示进度条，被打断会重新开始。',
    test: (s) => s.events.reload >= 1,
  },
  {
    id: 'crouch', title: '⑥ 蹲下 / 跳跃', key: 'C · Space',
    text: '按 C 蹲下，按 Space 跳过障碍。',
    tip: '蹲下时移动更慢但更难被打中，也是穿过低矮通道的唯一办法。',
    test: (s, dt, ctx) => {
      if (ctx.crouch) s.crouch += dt;
      if (ctx.airborne) s.jumped = true;
      return s.crouch > 0.5 && s.jumped;
    },
  },
  {
    id: 'ability', title: '⑦ 兵种技能', key: 'Q',
    text: '按 Q 使用你兵种的技能（突击兵烟雾弹 / 医疗兵医疗箱 / 支援兵弹药箱 / 侦察兵信号弹）。',
    tip: '投掷类技能按住 Q 蓄力，画面上的抛物线和落点就是它的飞行轨迹。',
    test: (s) => s.events.ability >= 1,
  },
  {
    id: 'grenade', title: '⑧ 手榴弹', key: 'B · 按住 G',
    text: '按 B 切换手榴弹，按住 G 蓄力，再松开投掷。预览会显示重力和反弹。',
    tip: '破片爆炸、燃烧留火、烟雾遮挡、闪光致盲；2 发共享，耗尽后 24 秒补满。Q 技能独立。',
    test: (s) => s.events.grenadeCycle >= 1 && s.events.grenade >= 1,
  },
  {
    id: 'capture', title: '⑨ 据点控制', key: 'A · B · C',
    text: '跟随顶部方向与距离提示，进入任一据点的地面圆圈，停留到占领完成。',
    tip: '无人争夺时单人 5 秒占领，两人更快；敌方据点先中立化再占领。守住全部据点 15 秒获胜；敌方进入会打断。',
    test: (s, dt, ctx) => ctx.objectivesOwned > 0,
  },
  {
    id: 'round', title: '⑩ 战场信息', key: 'Tab · V · Enter',
    text: '按住 Tab 看战绩，按 V 切换第一 / 第三人称，按 Enter 打字聊天。',
    tip: '死斗先到 75 击杀；据点模式需要守住全点。时间结束按击杀或据点数量判胜，数量相同则平局。',
    test: (s) => s.events.score >= 1 && s.events.view >= 1,
  },
  {
    id: 'room', title: '⑪ 联机：房号', key: 'Enter · 8 位房号',
    text: '想和朋友一起玩：回到主菜单选「多人模式」→「创建房间」，会得到一串 8 位房号，把它发给朋友；'
      + '朋友在「输入房号加入」里填上就能进同一局。按 Enter 完成教程并返回主菜单。',
    tip: '房号显示在画面顶部，点一下就能复制。单人模式不需要房号。',
    test: () => false,        // finished by the button, not by input
    last: true,
  },
];

// Same real lesson completion tests; only instructions change in touch mode.
const MOBILE_HELP = {
  move: { key:'移动摇杆', text:'按住左侧摇杆移动；轻推慢走，推到边缘全速前进。' },
  look: { key:'滑动瞄准', text:'在屏幕右侧滑动环顾四周；开火按钮也支持滑动瞄准。', tip:'手机模式无需锁定鼠标；暂停按钮可随时打开菜单。' },
  fire: { key:'开火', text:'按住开火按钮连续射击，同时滑动手指调整瞄准。' },
  aim: { key:'瞄准', text:'点击瞄准按钮开镜，再次点击退出；开镜时滑动精度更高。' },
  reload: { key:'换弹', text:'点击换弹按钮补充弹匣。' },
  crouch: { key:'蹲下 · 跳跃', text:'点击蹲下按钮切换姿态；点击跳跃按钮越过障碍。' },
  ability: { key:'技能', text:'按住技能按钮蓄力，松开投掷烟雾或信号弹；医疗和弹药箱点击即放置。' },
  grenade: { key:'切换手榴弹 · 手榴弹', text:'点击切换手榴弹选择类型；按住手榴弹按钮蓄力，松开投掷。' },
  round: { key:'视角 · 战绩 · 聊天', text:'点击视角切换第一/第三人称，按住战绩查看记分板，点击聊天发送消息。' },
  room: { key:'完成 · 8 位房号', text:'在主菜单创建多人房间，把 8 位房号发给朋友；朋友输入房号加入。点击完成按钮结束教程。' },
};

function emptyState() {
  return { move: 0, turned: 0, lastYaw: null, ads: 0, crouch: 0, jumped: false, events: {} };
}

export class Tutorial {
  /**
   * @param {{hud: object, onFinish: Function, onStart: Function}} deps
   *   onStart() is called when the player presses 「进入战场开始练习」: main.js
   *   deploys the practice match (solo, no bots).
   */
  constructor({ hud, onFinish, onStart } = {}) {
    this.hud = hud;
    this.onFinish = onFinish;
    this.onStart = onStart;
    this.index = 0;
    this.done = new Set();
    this.state = emptyState();
    this.inGame = false;
    this.visible = false;
    this.mobileMode = false;
    this._el = null;
    // The walkthrough keeps its text in the step table below, in Chinese, and
    // every line goes through t() when it is drawn -- so a language change
    // while the panel is open simply redraws it.
    onLangChange(() => { if (this._el) this._render(); });
  }

  get active() { return this.visible; }
  get finished() { return this.index >= STEPS.length - 1 && this.done.has(STEPS[STEPS.length - 1].id); }
  get current() { return STEPS[Math.min(this.index, STEPS.length - 1)]; }

  setMobileMode(enabled) {
    this.mobileMode = !!enabled;
    if (this._el) this._render();
  }

  // ------------------------------------------------------------------- UI

  _build() {
    if (this._el) return this._el;
    const root = document.createElement('div');
    root.id = PANEL_ID;
    root.className = 'hidden';
    root.innerHTML = `
      <div class="tut-panel">
        <header>
          <b class="tut-title"></b>
          <span class="tut-count"></span>
        </header>
        <ol class="tut-list"></ol>
        <p class="tut-tip"></p>
        <footer>
          <button type="button" class="ghost-btn" data-act="skip"></button>
          <button type="button" class="big-btn small hidden" data-act="go"></button>
          <button type="button" class="big-btn small hidden" data-act="finish"></button>
        </footer>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'skip') this.finish(true);
      else if (act === 'go') { this.start(); this.onStart?.(); }
      else if (act === 'finish') this.finish(false);
    });
    this._el = root;
    return root;
  }

  _render() {
    const el = this._build();
    // chrome first: the same strings in the current language every time
    el.querySelector('.tut-title').textContent = t('新手指引');
    el.querySelector('[data-act="skip"]').textContent = t('跳过教程');
    el.querySelector('[data-act="go"]').textContent = t('进入战场开始练习');
    el.querySelector('[data-act="finish"]').textContent = t('完成了，去联机');
    const list = el.querySelector('.tut-list');
    list.innerHTML = '';
    STEPS.forEach((original, i) => {
      const step = this.mobileMode ? { ...original, ...MOBILE_HELP[original.id] } : original;
      const li = document.createElement('li');
      const isDone = this.done.has(step.id) || i < this.index;
      li.className = (i === this.index && !isDone ? 'now ' : '') + (isDone ? 'done' : '');
      li.innerHTML = `<b>${t(step.title)}</b><span class="key">${t(step.key)}</span>`
        + `<span class="txt">${t(step.text)}</span>`;
      list.appendChild(li);
    });
    const doneCount = STEPS.filter((s) => this.done.has(s.id)).length;
    el.querySelector('.tut-count').textContent = `${doneCount} / ${STEPS.length}`;
    const tip = (this.mobileMode && MOBILE_HELP[this.current.id]?.tip) || this.current.tip;
    el.querySelector('.tut-tip').textContent = tip ? t(tip) : '';
    const last = !!this.current.last;
    el.querySelector('[data-act="go"]').classList.toggle('hidden', this.inGame || last);
    el.querySelector('[data-act="finish"]').classList.toggle('hidden', !last);
    el.querySelector('.tut-count').classList.toggle('all', doneCount === STEPS.length);
    el.classList.toggle('in-game', this.inGame);
  }

  /** Show the panel (menu side, or the compact strip during a match). */
  open() {
    this.visible = true;
    const el = this._build();
    el.classList.remove('hidden');
    this._render();
  }

  close() {
    this.visible = false;
    this._el?.classList.add('hidden');
  }

  /** Called when the practice match is being deployed. */
  start() {
    this.index = 0;
    this.done.clear();
    this.state = emptyState();
    this.inGame = true;
    this.open();
  }

  /** Called from main.js on every welcome: the practice match has begun. */
  onDeploy() {
    if (!this.visible) return;
    this.inGame = true;
    this.state = emptyState();
    this.state.lastYaw = null;
    this._render();
  }

  /** An input event happened (see the notify() calls in main.js). */
  notify(kind, n = 1) {
    if (!this.visible || !this.inGame) return;
    this.state.events[kind] = (this.state.events[kind] || 0) + n;
  }

  /** Per-frame: advance the current step from the real controls. */
  update(dt, ctx) {
    if (!this.visible || !this.inGame) return;
    const step = this.current;
    if (!step || step.test(this.state, dt, ctx)) this._complete(step);
  }

  _complete(step) {
    if (!step || this.done.has(step.id)) return;
    this.done.add(step.id);
    if (!step.last) this.index = Math.min(this.index + 1, STEPS.length - 1);
    this._render();
    if (this.hud && !step.last) {
      const next = this.current;
      this.hud.toast(t('✔ {step} 完成 · 下一步：{next}', {
        step: t(step.title).replace(/^[①-⑳]\s*/, ''),
        next: t(next.title),
      }), 2200);
    }
  }

  /** Player finished (or skipped) the tutorial. */
  finish(skipped) {
    this.inGame = false;
    if (!skipped) this.done.add(STEPS[STEPS.length-1].id);
    this.index = STEPS.length - 1;
    this.close();
    this.onFinish?.(!skipped);
  }
}

export const TUTORIAL_STEPS = STEPS;
