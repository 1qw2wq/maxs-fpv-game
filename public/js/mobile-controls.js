// Explicit mobile input, never a fallback for denied desktop pointer lock.
// Pointer IDs/capture keep simultaneous movement, aiming and firing independent.
import { t, onLangChange } from './i18n.js';
import { TOUCH_ITEMS, sanitizeTouchLayout, layoutOrientation, layoutCollision } from './mobile-layout.js';

export class MobileControls {
  constructor(controls, { parent, onPause, layout, onLayoutSave } = {}) {
    this.controls = controls;
    this.onPause = onPause;
    this.layout = sanitizeTouchLayout(layout);
    this.onLayoutSave = onLayoutSave;
    this.editing = false;
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
        <button type="button" data-action="weapon"></button><button type="button" class="touch-cycle" data-action="cycle"></button>
      </div>`;
    (parent || document.body).appendChild(this.root);
    this.stick = this.root.querySelector('.touch-stick');
    this.knob = this.root.querySelector('.touch-stick-knob');
    this.buttons = [...this.root.querySelectorAll('[data-action]')];
    this.labels = { fire:'开火', aim:'瞄准', reload:'换弹', jump:'跳跃', ability:'技能', grenade:'手榴弹', crouch:'蹲下', cycle:'切换手榴弹', weapon:'切换武器', view:'视角', score:'战绩', chat:'聊天', pause:'暂停' };
    this.renderLabels();
    onLangChange(() => this.renderLabels());
    controls.onInputReset = () => this.reset();
    for (const el of this.root.querySelectorAll('[data-touch], [data-action]')) this.bind(el);
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.items = TOUCH_ITEMS.map(key => this.root.querySelector(key === 'move' ? '.touch-stick' : `[data-action="${key}"]`));
    this.editor = document.createElement('div');
    this.editor.id = 'touch-layout-editor'; this.editor.className = 'hidden';
    this.editor.innerHTML = '<strong></strong><span class="layout-status" role="status"></span><div><button type="button" data-layout="save"></button><button type="button" data-layout="reset"></button><button type="button" data-layout="cancel"></button></div>';
    document.body.appendChild(this.editor);
    this.editor.querySelector('[data-layout="save"]').onclick = () => this.finishLayout(true);
    this.editor.querySelector('[data-layout="cancel"]').onclick = () => this.finishLayout(false);
    this.editor.querySelector('[data-layout="reset"]').onclick = () => {
      this.layout[layoutOrientation()] = {}; this.applyLayout(); this.editor.querySelector('.layout-status').textContent = '';
    };
    this.editor.addEventListener('keydown', e => { if (e.code === 'Escape') { e.stopPropagation(); this.finishLayout(false); } });
    addEventListener('resize', () => { this.reset(); this.applyLayout(); });
    onLangChange(() => this.renderEditor());
    this.renderEditor();
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
    this.root.querySelector('.touch-guide').textContent = t('摇杆持续推动 1.5 秒冲刺 · 右侧滑动瞄准 · 开火键也可滑动');
  }

  bind(el) {
    el.addEventListener('pointerdown', e => {
      if (this.editing) {
        e.preventDefault();
        const key = el.dataset.action || el.dataset.touch;
        if (!TOUCH_ITEMS.includes(key)) return;
        el.setPointerCapture(e.pointerId);
        const box = el.getBoundingClientRect();
        this.pointers.set(e.pointerId,{ el, action:'layout', key, dx:e.clientX-box.left-box.width/2, dy:e.clientY-box.top-box.height/2 });
        return;
      }
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
      if (p.action === 'layout') {
        const b = el.getBoundingClientRect();
        this.layout[layoutOrientation()][p.key] = {
          x:Math.max(b.width/2+8,Math.min(innerWidth-b.width/2-8,e.clientX-p.dx))/innerWidth,
          y:Math.max(Math.max(100+b.height/2,innerHeight*.4),Math.min(innerHeight-b.height/2-8,e.clientY-p.dy))/innerHeight,
        };
        this.applyLayout(); return;
      }
      if (p.action === 'move') this.moveStick(e);
      else if (this.lookPointer === e.pointerId) this.controls.touchLook(e.clientX-p.x, e.clientY-p.y);
      p.x=e.clientX; p.y=e.clientY;
    });
    const finish = (e, cancelled) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      this.pointers.delete(e.pointerId);
      if (this.lookPointer === e.pointerId) {
        // A second finger may already be holding Fire while the look finger
        // lifts. Hand aim to that captured finger without requiring a new tap.
        this.lookPointer = [...this.pointers].find(([, held]) => held.action === 'fire' || held.action === 'look')?.[0] ?? null;
      }
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
      case 'fire': c.mouse.left=true; c.touchFirePending=true; c.onFireDown?.(); break;
      case 'aim': c.mouse.right=!c.mouse.right; c._aimHeld=c.mouse.right; break;
      case 'crouch': if(c.touchKeys.has('KeyC'))c.touchKeys.delete('KeyC');else c.touchKeys.add('KeyC'); break;
      case 'jump': c.touchKeys.add('Space'); c.queueJump(); break;
      case 'weapon': c.onWeaponSwitch?.(); break;
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
      case 'move': c.sprinting=false; c.touchSprintAt=null; c.touchMove.x=c.touchMove.y=0; this.knob.style.transform=''; break;
      case 'fire': c.mouse.left=false; if(cancelled)c.touchFirePending=false; break;
      case 'jump': c.touchKeys.delete('Space'); if(cancelled)c._jumpBuffer=0; break;
      case 'ability': if(cancelled)c.onAbilityCancel?.();else c.onAbilityUp?.(); break;
      case 'grenade': if(cancelled)c.onAbilityCancel?.();else c.onGrenadeUp?.(); break;
      case 'score': c.onScoreboard?.(false); break;
      case 'aim': if(cancelled)c.mouse.right=c._aimHeld=false; break;
      case 'crouch': if(cancelled)c.touchKeys.delete('KeyC'); break;
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
    this.controls.sprinting=false; this.controls.touchSprintAt=null;
    this.controls.touchMove.x=this.controls.touchMove.y=0;
    this.controls.touchKeys.clear();
    this.controls.touchFirePending=false;
    this.controls.mouse.left=this.controls.mouse.right=this.controls._aimHeld=false;
    this.knob.style.transform='';
    this.syncButtons();
  }

  syncButtons() {
    for(const button of this.buttons) {
      const action=button.dataset.action;
      const active=action==='aim' ? this.controls.mouse.right : action==='crouch' ? this.controls.touchKeys.has('KeyC') : [...this.pointers.values()].some(p=>p.action===action);
      button.classList.toggle('held',active);
      button.setAttribute('aria-pressed',String(active));
    }
  }

  renderEditor() {
    this.editor.querySelector('strong').textContent = t('拖动底部按钮和摇杆 · 横竖屏分别保存');
    for (const [key,text] of Object.entries({save:'保存布局',reset:'重置布局',cancel:'取消'})) {
      this.editor.querySelector(`[data-layout="${key}"]`).textContent = t(text);
    }
  }

  applyLayout() {
    // Measure native responsive sizes first; fixed coordinates must not inherit
    // the action grid's containing block. Clamp again after every rotation.
    for (const el of this.items) el.removeAttribute('style');
    const boxes = this.items.map(el => el.getBoundingClientRect());
    const saved = this.layout[layoutOrientation()];
    if (!this.editing && !Object.keys(saved).length) return;
    this.items.forEach((el,i) => {
      const b = boxes[i];
      const p = saved[TOUCH_ITEMS[i]] || {x:(b.left+b.width/2)/innerWidth,y:(b.top+b.height/2)/innerHeight};
      if (!b.width) return;
      const x = Math.max(b.width/2+8,Math.min(innerWidth-b.width/2-8,p.x*innerWidth));
      const y = Math.max(b.height/2+8,Math.min(innerHeight-b.height/2-8,p.y*innerHeight));
      Object.assign(el.style,{position:'fixed',left:`${x}px`,top:`${y}px`,right:'auto',bottom:'auto',width:`${b.width}px`,height:`${b.height}px`,transform:'translate(-50%,-50%)'});
    });
    // A saved layout may no longer fit a smaller phone in the same orientation.
    // Prefer accessible native positions over covered/off-screen controls.
    if (!this.editing && layoutCollision(this.items)) for (const el of this.items) el.removeAttribute('style');
  }

  editLayout(onClose) {
    this.controls.releaseLook();
    this.originalLayout = sanitizeTouchLayout(this.layout);
    this.onEditorClose = onClose;
    this.editing = true;
    document.body.classList.add('layout-editing');
    this.editor.classList.remove('hidden');
    this.editor.querySelector('.layout-status').textContent = '';
    this.update(true); this.applyLayout();
    this.editor.querySelector('[data-layout="save"]').focus();
  }

  finishLayout(save) {
    if (!this.editing) return;
    if (save && layoutCollision(this.items)) {
      this.editor.querySelector('.layout-status').textContent = t('按钮重叠，请分开后保存。'); return;
    }
    if (save) this.onLayoutSave?.(sanitizeTouchLayout(this.layout));
    else this.layout = this.originalLayout;
    this.reset(); this.editing = false;
    this.editor.classList.add('hidden');
    document.body.classList.remove('layout-editing');
    this.applyLayout();
    this.onEditorClose?.();
  }

  update(playing) {
    const show=(this.editing || !!playing) && this.controls.mobileMode && this.controls.enabled;
    if(this.visible && !show)this.controls.releaseLook();
    this.visible=show;
    this.root.classList.toggle('hidden',!show);
    if (show && !this.wasLaidOut) { this.applyLayout(); this.wasLaidOut = true; }
    if (!show) this.wasLaidOut = false;
    this.root.classList.toggle('sprinting',this.controls.sprinting);
  }
}
