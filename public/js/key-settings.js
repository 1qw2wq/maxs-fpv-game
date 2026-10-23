import { KEY_ACTIONS, KEY_BINDINGS_STORAGE, defaultBindings, decodeBindings, validateBindings, normalizeKey, allowedKey, keyLabel, bindingLabel } from './key-bindings.js';
import { store } from './storage.js';
import { t, onLangChange } from './i18n.js';

export function createKeySettings({controls, hud, onChange = () => {}}) {
  const panel = document.getElementById('keyboard-settings');
  const rows = panel.querySelector('.key-binding-rows');
  const status = panel.querySelector('[role=status]');
  const screen = document.getElementById('screen-settings');
  controls.keyboardBlocked = () => !screen.classList.contains('hidden');
  const buttons = new Map();
  let capture = null, message = null;
  controls.setKeyBindings(decodeBindings(store.get(KEY_BINDINGS_STORAGE)));
  hud.keyLabel = id => bindingLabel(controls.bindings, id);
  hud.keyBindings = controls.bindings;

  function messageText() { return t(message.key, {...message.params, ...(message.params.action ? {action:t(message.params.action)} : {})}); }
  function announce(key, params = {}) { message = {key, params}; status.textContent = messageText(); }
  function hints() {
    hud.keyBindings = controls.bindings;
    for (const el of document.querySelectorAll('[data-key-action]')) {
      el.textContent = keyLabel(controls.bindings[el.dataset.keyAction]?.[0]);
      el.title = bindingLabel(controls.bindings, el.dataset.keyAction);
    }
    for (const el of document.querySelectorAll('[data-key-help]')) {
      const ids = el.dataset.keyHelp === 'slots' ? ['primary','secondary','switch'] : KEY_ACTIONS.filter(a => !a.id.startsWith('look')).map(a => a.id);
      el.textContent = ids.map(id => `${bindingLabel(controls.bindings,id)} ${t(KEY_ACTIONS.find(a => a.id === id).label)}`).join(' · ')
        + (el.dataset.keyHelp === 'full' ? ` · ${t('左键开火 · 右键瞄准 · Esc 暂停菜单')}` : '');
    }
    onChange();
  }
  function render() {
    for (const action of KEY_ACTIONS) {
      panel.querySelector(`[data-key-label="${action.id}"]`).textContent = t(action.label);
      for (let slot = 0; slot < 2; slot++) {
        const {button, clear} = buttons.get(`${action.id}:${slot}`);
        const code = controls.bindings[action.id][slot];
        const active = capture?.id === action.id && capture.slot === slot;
        button.textContent = active ? t('请按一个键…') : code ? keyLabel(code) : t('未绑定');
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', `${t(action.label)} · ${t(slot ? '备用按键' : '主按键')} · ${button.textContent}`);
        button.title = button.getAttribute('aria-label');
        clear.setAttribute('aria-label', t('清除 {action} 的{slot}', {action:t(action.label), slot:t(slot ? '备用按键' : '主按键')}));
        clear.title = clear.getAttribute('aria-label');
        clear.disabled = !code;
      }
    }
    if (message) status.textContent = messageText();
    hints();
  }
  function cancel() {
    if (!capture) return;
    capture = null; announce('已取消按键修改。'); render();
  }
  function save(next) {
    controls.setKeyBindings(next);
    const text = JSON.stringify({version:1, bindings:controls.bindings});
    const saved = store.set(KEY_BINDINGS_STORAGE, text);
    announce(saved ? '按键布局已保存，立即生效。' : '浏览器无法保存：布局仅在本次页面中生效。');
    render();
  }

  for (const action of KEY_ACTIONS) {
    const row = document.createElement('div'); row.className = 'key-binding-row';
    const label = document.createElement('span'); label.dataset.keyLabel = action.id; row.append(label);
    for (let slot = 0; slot < 2; slot++) {
      const cell = document.createElement('div'); cell.className = 'key-binding-slot';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost-btn key-binding-button';
      button.dataset.keyBind = action.id; button.dataset.slot = slot;
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'ghost-btn key-binding-clear'; clear.textContent = '×';
      clear.dataset.keyClear = action.id; clear.dataset.slot = slot;
      button.addEventListener('click', () => {
        if (capture?.id === action.id && capture.slot === slot) { cancel(); return; }
        controls.releaseLook();
        capture = {id:action.id, slot}; announce('按下新按键；Esc 取消。'); render();
      });
      clear.addEventListener('click', () => {
        capture = null;
        const next = validateBindings(controls.bindings); next[action.id].splice(slot,1); save(next);
      });
      cell.append(button, clear); row.append(cell); buttons.set(`${action.id}:${slot}`, {button, clear});
    }
    rows.append(row);
  }
  const reset = () => { capture = null; save(defaultBindings()); };
  panel.querySelector('#key-bindings-reset').addEventListener('click', reset);
  // Capture before gameplay. Neither press nor release may fire a weapon,
  // release a charged grenade, or toggle the scoreboard while assigning keys.
  window.addEventListener('keydown', e => {
    if (!capture) return;
    if (screen.classList.contains('hidden') || !panel.open) { cancel(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat || e.isComposing) return;
    if (e.code === 'Escape') { cancel(); return; }
    const code = normalizeKey(e.code);
    if (!allowedKey(code) || e.metaKey || e.altKey || (e.ctrlKey && code !== 'ControlLeft')) {
      announce('该按键或浏览器快捷键不可使用，请换一个键。'); return;
    }
    const conflict = KEY_ACTIONS.find(a => controls.bindings[a.id].some((key, index) => key === code && !(a.id === capture.id && index === capture.slot)));
    if (conflict) {
      announce('该键已用于「{action}」，请先清除冲突按键。', {action:conflict.label}); return;
    }
    const next = validateBindings(controls.bindings);
    next[capture.id][Math.min(capture.slot, next[capture.id].length)] = code;
    capture = null; save(next);
  }, true);
  window.addEventListener('blur', cancel);
  panel.addEventListener('toggle', () => { if (!panel.open) cancel(); });
  document.addEventListener('pointerdown', e => { if (capture && !e.target.closest('[data-key-bind]')) cancel(); });
  new MutationObserver(() => { if (screen.classList.contains('hidden')) cancel(); }).observe(screen, {attributes:true, attributeFilter:['class']});
  onLangChange(render);
  announce(store.persistent ? '点击按键后按下新键；可设置主按键和备用按键。' : '浏览器无法保存：布局仅在本次页面中生效。');
  render();
  return {cancel, reset};
}
