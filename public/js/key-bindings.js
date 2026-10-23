// Physical KeyboardEvent.code bindings; independent of rendering and storage.
export const KEY_BINDINGS_STORAGE = 'tf.keyBindings.v1';
export const KEY_ACTIONS = [
  {id:'forward', label:'前进', keys:['KeyW']},
  {id:'backward', label:'后退', keys:['KeyS']},
  {id:'left', label:'向左移动', keys:['KeyA']},
  {id:'right', label:'向右移动', keys:['KeyD']},
  {id:'sprint', label:'冲刺', keys:['ShiftLeft']},
  {id:'crouch', label:'蹲下', keys:['KeyC','ControlLeft']},
  {id:'jump', label:'跳跃', keys:['Space']},
  {id:'reload', label:'换弹', keys:['KeyR']},
  {id:'primary', label:'主武器', keys:['Digit1','Numpad1']},
  {id:'secondary', label:'副武器', keys:['Digit2','Numpad2']},
  {id:'switch', label:'切换武器', keys:['KeyX']},
  {id:'ability', label:'兵种技能', keys:['KeyQ']},
  {id:'grenade', label:'投掷手榴弹', keys:['KeyG']},
  {id:'grenadeCycle', label:'切换手榴弹', keys:['KeyB']},
  {id:'mask', label:'防毒面具', keys:['KeyM']},
  {id:'view', label:'切换视角', keys:['KeyV']},
  {id:'scoreboard', label:'战绩', keys:['Tab']},
  {id:'chat', label:'聊天', keys:['Enter']},
  {id:'lookLeft', label:'向左看', keys:['ArrowLeft']},
  {id:'lookRight', label:'向右看', keys:['ArrowRight']},
  {id:'lookUp', label:'向上看', keys:['ArrowUp']},
  {id:'lookDown', label:'向下看', keys:['ArrowDown']},
];
export const normalizeKey = code => code === 'ShiftRight' ? 'ShiftLeft' : code === 'ControlRight' ? 'ControlLeft' : code;
export function allowedKey(code) {
  return typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(Up|Down|Left|Right)|ShiftLeft|ControlLeft|Space|Tab|Enter|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Insert|Delete|Home|End|PageUp|PageDown|F([1-4]|[6-9]|10|12))$/.test(normalizeKey(code));
}
export const defaultBindings = () => Object.fromEntries(KEY_ACTIONS.map(a => [a.id, [...a.keys]]));
// Stored layouts are complete/versioned. Reject corruption atomically rather
// than silently applying half a layout or introducing conflicting actions.
export function validateBindings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid layout');
  const result = {}, used = new Set();
  if (Object.keys(value).length !== KEY_ACTIONS.length) throw Error('Invalid actions');
  for (const action of KEY_ACTIONS) {
    const keys = value[action.id];
    if (!Array.isArray(keys) || keys.length > 2) throw Error('Invalid keys');
    result[action.id] = Array.from(keys, code => {
      if (!allowedKey(code)) throw Error('Reserved or invalid key');
      const key = normalizeKey(code);
      if (used.has(key)) throw Error('Duplicate key');
      used.add(key); return key;
    });
  }
  return result;
}
export function decodeBindings(text) {
  try {
    if (typeof text !== 'string' || text.length > 10000) return defaultBindings();
    const data = JSON.parse(text);
    return data.version === 1 ? validateBindings(data.bindings) : defaultBindings();
  } catch { return defaultBindings(); }
}
export function matchesKey(bindings, action, code) {
  return bindings[action]?.includes(normalizeKey(code)) || false;
}
export function keyLabel(code) {
  if (!code) return '—';
  code = normalizeKey(code);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return ({ShiftLeft:'Shift',ControlLeft:'Ctrl',PageUp:'PgUp',PageDown:'PgDn',CapsLock:'Caps',Insert:'Ins',Delete:'Del',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Backquote:'`',Minus:'−',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/'}[code]) || code;
}
export const bindingLabel = (bindings, action) => (bindings[action] || []).map(keyLabel).join(' / ') || '—';
