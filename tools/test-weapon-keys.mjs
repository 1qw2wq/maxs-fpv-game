// Dependency-free keyboard event regression against the real Controls class.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as keyBindings from '../public/js/key-bindings.js';
const source=(await readFile(new URL('../public/js/controls.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export class Controls','class Controls');
const window=new EventTarget(),document=new EventTarget(),canvas=new EventTarget();
document.activeElement=null;
class Vector3 { constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});} clone(){return new Vector3(this.x,this.y,this.z);} }
const context=vm.createContext({...keyBindings,window,document,THREE:{Vector3},MouseLook:class{},performance,clearTimeout});
vm.runInContext(source+'\nglobalThis.Controls=Controls;',context);
const controls=new context.Controls(canvas,null,{},{}),slots=[];
controls.enabled=true;
controls.onWeaponSwitch=slot=>slots.push(slot);
function key(code,repeat=false){const e=new Event('keydown');Object.assign(e,{code,repeat});window.dispatchEvent(e);const up=new Event('keyup');up.code=code;window.dispatchEvent(up);}
for(const code of ['Digit2','Digit2','Digit1','Digit1','Numpad2','Numpad1'])key(code);
assert.deepEqual(slots,['secondary','secondary','primary','primary','secondary','primary'],'1/2 directly select a slot rather than toggle');
slots.length=0;
key('Digit1',true);key('Digit2',true);
assert.deepEqual(slots,[],'Key repeat must not spam switching');
for(const field of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'DIV',isContentEditable:true}]){
  document.activeElement=field;key('Digit1');key('Digit2');key('Numpad1');key('Numpad2');
}
assert.deepEqual(slots,[],'Typing numbers must not switch weapons');
document.activeElement=null;controls.enabled=false;key('Digit1');key('Digit2');
assert.deepEqual(slots,[],'Disabled gameplay must not switch weapons');
controls.enabled=true;key('KeyX');assert.deepEqual(slots,[undefined],'Keep the existing X toggle');
console.log('PASS: 1 main gun / 2 secondary gun, number row + keypad, direct selection, repeat/typing/disabled guards and X toggle');
