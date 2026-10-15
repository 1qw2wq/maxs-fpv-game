// Explicit mobile input, never a fallback for denied desktop pointer lock.
// Pointer IDs/capture keep simultaneous movement, aiming and firing independent.
import { t, onLangChange } from './i18n.js';

export class MobileControls {
  constructor(controls, { parent, onPause } = {}) {
    this.controls = controls;
    this.onPause = onPause;
    this.pointers = new Map();
    this.visible = false;
    this.lookPointer = null;
    this.root = document.createElement('div');
    this.root.id = 'mobile-controls';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="touch-look" data-touch="look"></div>
      <div class="touch-stick" data-touch="move" role="group"><span class="touch-stick-knob"></span><small></small></div>
      <p class="touch-guide"></p>
      <div class="touch-tools">
        <button type="button" data-action="view"></button><button type="button" data-action="score"></button>
        <button type="button" data-action="chat"></button><button type="button" data-action="pause"></button>
      </div>
      <button type="button" class="touch-fire" data-action="fire"></button>
      <div class="touch-actions">
        <button type="button" data-action="aim"></button><button type="button" data-action="reload"></button><button type="button" data-action="jump"></button>
        <button type="button" data-action="ability"></button><button type="button" data-action="grenade"></button><button type="button" data-action="crouch"></button>
        <button type="button" class="touch-cycle" data-action="cycle"></button>
      </div>`;
    (parent || document.body).appendChild(this.root);
    this.stick = this.root.querySelector('.touch-stick');
    this.knob = this.root.querySelector('.touch-stick-knob');
    this.buttons = [...this.root.querySelectorAll('[data-action]')];
    this.labels = { fire:'开火', aim:'瞄准', reload:'换弹', jump:'跳跃', ability:'技能', grenade:'手榴弹', crouch:'蹲下', cycle:'切换手榴弹', view:'视角', score:'战绩', chat:'聊天', pause:'暂停' };
    this.renderLabels();
    onLangChange(() => this.renderLabels());
    controls.onInputReset = () => this.reset();
    for (const el of this.root.querySelectorAll('[data-touch], [data-action]')) this.bind(el);
    this.root.addEventListener('contextmenu', e => e.preventDefault());
  }

  renderLabels() {
    for (const button of this.buttons) {
      const text = t(this.labels[button.dataset.action]);
      button.textContent = text;
      button.setAttribute('aria-label', text);
    }
    this.stick.setAttribute('aria-label', t('移动摇杆'));
    this.stick.querySelector('small').textContent = t('移动');
    this.root.querySelector('.touch-look').setAttribute('aria-label', t('滑动瞄准'));
    this.root.querySelector('.touch-guide').textContent = t('左摇杆移动 · 右侧滑动瞄准 · 开火键也可滑动');
  }

  bind(el) {
    el.addEventListener('pointerdown', e => {
      // No mouse-based drag look, even when touch mode is manually selected.
      if (!['touch', 'pen'].includes(e.pointerType) || !this.visible || !this.controls.mobileMode || !this.controls.enabled) return;
      e.preventDefault();
      const action = el.dataset.action || el.dataset.touch;
      if ([...this.pointers.values()].some(p => p.action === action)) return;
      const focus = document.activeElement;
      if (focus?.matches('input, textarea, [contenteditable="true"]')) focus.blur();
      this.controls.requestLock(); // activates touch, never calls Pointer Lock API
      const p = { el, action, x:e.clientX, y:e.clientY };
      this.pointers.set(e.pointerId, p);
      el.setPointerCapture(e.pointerId);
      if ((action === 'look' || action === 'fire') && this.lookPointer === null) this.lookPointer = e.pointerId;
      if (action === 'move') this.moveStick(e);
      else this.press(action);
      this.syncButtons();
    });
    el.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      if (p.action === 'move') this.moveStick(e);
      else if (this.lookPointer === e.pointerId) this.controls.touchLook(e.clientX-p.x, e.clientY-p.y);
      p.x=e.clientX; p.y=e.clientY;
    });
    const finish = (e, cancelled) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      this.pointers.delete(e.pointerId);
      if (this.lookPointer === e.pointerId) this.lookPointer = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      this.release(p.action, cancelled);
      this.syncButtons();
    };
    el.addEventListener('pointerup', e => finish(e, false));
    el.addEventListener('pointercancel', e => finish(e, true));
    el.addEventListener('lostpointercapture', e => finish(e, true));
  }

  moveStick(e) {
    const box = this.stick.getBoundingClientRect(), radius = box.width * .36;
    let x=(e.clientX-box.left-box.width/2)/radius, y=(e.clientY-box.top-box.height/2)/radius;
    const length=Math.hypot(x,y), amount=Math.min(1,Math.max(0,(length-.12)/.88));
    x=length ? x/length*amount : 0; y=length ? y/length*amount : 0;
    this.controls.touchMove.x=x; this.controls.touchMove.y=-y;
    this.knob.style.transform=`translate(${x*radius}px, ${y*radius}px)`;
  }

  press(action) {
    const c=this.controls;
    switch(action) {
      case 'fire': c.mouse.left=true; c.onFireDown?.(); break;
      case 'aim': c.mouse.right=!c.mouse.right; c._aimHeld=c.mouse.right; break;
      case 'crouch': if(c.touchKeys.has('ShiftLeft'))c.touchKeys.delete('ShiftLeft');else c.touchKeys.add('ShiftLeft'); break;
      case 'jump': c.touchKeys.add('Space'); break;
      case 'reload': c.onReload?.(); break;
      case 'ability': c.onAbilityDown?.(); break;
      case 'grenade': c.onGrenadeDown?.(); break;
      case 'cycle': c.onGrenadeCycle?.(); break;
      case 'view': c.onViewToggle?.(); break;
      case 'score': c.onScoreboard?.(true); break;
      case 'chat': c.releaseLook(); c.onChat?.(); break;
      case 'pause': this.onPause?.(); break;
    }
  }

  release(action, cancelled) {
    const c=this.controls;
    switch(action) {
      case 'move': c.touchMove.x=c.touchMove.y=0; this.knob.style.transform=''; break;
      case 'fire': c.mouse.left=false; break;
      case 'jump': c.touchKeys.delete('Space'); break;
      case 'ability': if(cancelled)c.onAbilityCancel?.();else c.onAbilityUp?.(); break;
      case 'grenade': if(cancelled)c.onAbilityCancel?.();else c.onGrenadeUp?.(); break;
      case 'score': c.onScoreboard?.(false); break;
      case 'aim': if(cancelled)c.mouse.right=c._aimHeld=false; break;
      case 'crouch': if(cancelled)c.touchKeys.delete('ShiftLeft'); break;
    }
  }

  reset() {
    const held=[...this.pointers.entries()];
    this.pointers.clear(); this.lookPointer=null;
    for(const [id,p] of held) {
      if(p.el.hasPointerCapture(id))p.el.releasePointerCapture(id);
      // Cancellation must never throw a charged grenade/ability.
      this.release(p.action, true);
    }
    this.controls.touchMove.x=this.controls.touchMove.y=0;
    this.controls.touchKeys.clear();
    this.controls.mouse.left=this.controls.mouse.right=this.controls._aimHeld=false;
    this.knob.style.transform='';
    this.syncButtons();
  }

  syncButtons() {
    for(const button of this.buttons) {
      const action=button.dataset.action;
      const active=action==='aim' ? this.controls.mouse.right : action==='crouch' ? this.controls.touchKeys.has('ShiftLeft') : [...this.pointers.values()].some(p=>p.action===action);
      button.classList.toggle('held',active);
      button.setAttribute('aria-pressed',String(active));
    }
  }

  update(playing) {
    const show=!!playing && this.controls.mobileMode && this.controls.enabled;
    if(this.visible && !show)this.controls.releaseLook();
    this.visible=show;
    this.root.classList.toggle('hidden',!show);
  }
}
