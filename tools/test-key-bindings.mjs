// No browser/npm dependencies: schema + real Controls events and movement.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as bindings from '../public/js/key-bindings.js';
import * as THREE from '../public/vendor/three.module.js';
import {MouseLook} from '../public/js/mouse-look.js';
const {defaultBindings,validateBindings,decodeBindings,allowedKey,normalizeKey,keyLabel,KEY_ACTIONS} = bindings;
const defaults=defaultBindings();
assert.equal(KEY_ACTIONS.length,22);
assert.deepEqual(validateBindings(defaults),defaults);
const copy=defaultBindings();copy.forward[0]='KeyI';assert.equal(defaults.forward[0],'KeyW');
for(const bad of [null,{},[],{...defaults,unknown:[]},{...defaults,forward:['KeyS']},{...defaults,forward:['Escape']},{...defaults,forward:[null]},{...defaults,forward:new Array(1)},{...defaults,forward:['KeyI','KeyJ','KeyK']}])assert.throws(()=>validateBindings(bad));
for(const code of ['Escape','AltLeft','MetaLeft','F5','F11','Unidentified','<img>','Mouse0'])assert(!allowedKey(code));
assert.equal(normalizeKey('ControlRight'),'ControlLeft');assert.equal(normalizeKey('ShiftRight'),'ShiftLeft');
assert.equal(keyLabel('Numpad1'),'Num 1');assert.equal(keyLabel('KeyI'),'I');
for(const text of [null,'bad','{}','null',JSON.stringify({version:99,bindings:defaults}),' '.repeat(10001)])assert.deepEqual(decodeBindings(text),defaults);
const custom=defaultBindings();Object.assign(custom,{forward:['KeyI'],sprint:['KeyL'],crouch:['KeyK'],jump:['KeyJ'],reload:['KeyU'],primary:['Digit3'],secondary:['Digit4'],switch:['KeyH'],ability:['KeyE'],grenade:['KeyT'],grenadeCycle:['KeyY'],mask:['KeyN'],view:['KeyO'],scoreboard:['KeyP'],chat:['Semicolon']});
assert.deepEqual(decodeBindings(JSON.stringify({version:1,bindings:custom})),custom);
const source=(await readFile(new URL('../public/js/controls.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export class Controls','class Controls');
const window=new EventTarget(),document=new EventTarget(),canvas=new EventTarget();document.activeElement=null;
const ctx=vm.createContext({...bindings,THREE,MouseLook,window,document,performance,clearTimeout});
vm.runInContext(source+'\nglobalThis.Controls=Controls;',ctx);
const world={groundY:0,floorBase:0,stepUpMax:.3,bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},blocked:()=>false,isVoidFloor:()=>false,clampToBounds:(x,z)=>[x,z],floorAt:()=>0,ceilingAt:()=>100,resolveMove:(x,z,nx,nz)=>[nx,nz,0]};
const combat={maxMoveSpeed:5,sprintMult:1.35,playerHeight:1.7,crouchHeight:.85,jumpSpeed:5,gravity:18};
const c=new ctx.Controls(canvas,world,combat,{});c.enabled=true;
const events=[];
for(const name of ['Reload','AbilityDown','AbilityUp','GrenadeDown','GrenadeUp','GrenadeCycle','MaskToggle','ViewToggle','Chat','Escape'])c['on'+name]=()=>events.push(name);
c.onWeaponSwitch=slot=>events.push(slot||'switch');c.onScoreboard=show=>events.push('score:'+show);
function down(code,extra={}){const e=new Event('keydown',{cancelable:true});Object.assign(e,{code,repeat:false,...extra});window.dispatchEvent(e);return e;}
function up(code){const e=new Event('keyup');e.code=code;window.dispatchEvent(e);}
function tap(code){down(code);up(code);}
c.setKeyBindings(custom);events.length=0;
for(const code of ['KeyR','KeyQ','KeyG','KeyB','KeyM','KeyV','KeyX','Digit1','Digit2','Numpad1','Numpad2','Tab','Enter'])tap(code);
assert.deepEqual(events,[],'Old keys are inactive after remapping');
for(const code of ['KeyU','KeyE','KeyT','KeyY','KeyN','KeyO','KeyH','Digit3','Digit4','KeyP','Semicolon'])tap(code);
assert.deepEqual(events,['Reload','AbilityDown','AbilityUp','GrenadeDown','GrenadeUp','GrenadeCycle','MaskToggle','ViewToggle','switch','primary','secondary','score:true','score:false','Chat']);
events.length=0;down('KeyU',{repeat:true});up('KeyU');assert.deepEqual(events,[]);
for(const field of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{isContentEditable:true}]){document.activeElement=field;assert(!down('KeyP').defaultPrevented);up('KeyP');tap('KeyT');}
document.activeElement=null;assert.deepEqual(events,[],'Typing cannot open scoreboard or release grenades');
c.keyboardBlocked=()=>true;tap('KeyU');assert.deepEqual(events,[],'Settings cannot trigger gameplay');c.keyboardBlocked=()=>false;
c.enabled=false;tap('KeyT');assert.deepEqual(events,[]);c.enabled=true;
down('KeyW');c.update(1/60,true,false);assert.equal(c.moveSpeed,0);
down('KeyI');for(let i=0;i<20;i++)c.update(1/60,true,false);assert(c.pos.x>1,'Remapped forward moves the real controller');
down('KeyL');c.update(1/60,true,false);assert(c.sprinting);up('KeyL');
down('KeyK');c.update(1/60,true,false);assert(c.crouch);up('KeyK');
down('KeyJ');c.update(1/60,true,false);assert(!c.grounded&&c.pos.y>0,'Remapped jump uses physics');up('KeyJ');
c.releaseLook();assert.equal(c.keys.size,0);
c.setKeyBindings(defaultBindings());down('ControlRight');assert(c.actionDown('crouch'));up('ControlRight');
down('ShiftRight');assert(c.actionDown('sprint'));up('ShiftRight');
const two=defaultBindings();two.grenade=['KeyG','KeyT'];c.setKeyBindings(two);events.length=0;
down('KeyG');down('KeyT');up('KeyG');assert.deepEqual(events,['GrenadeDown']);up('KeyT');assert.deepEqual(events,['GrenadeDown','GrenadeUp']);
c.touchKeys.add('Space');c.touchKeys.add('KeyC');c.update(1/60,true,false);assert(c.crouch,'Touch crouch ignores keyboard remaps');
c.setKeyBindings(custom);assert.equal(c.touchKeys.size,0,'Changing layout cancels held inputs');
const before=c.bindings;assert.throws(()=>c.setKeyBindings({...custom,reload:['Escape']}));assert.equal(c.bindings,before,'Invalid changes are atomic');
events.length=0;tap('Escape');assert(events.includes('Escape'),'Escape stays available');
console.log('PASS: 22 actions, strict layout/storage validation, conflicts/reserved keys, remapped callbacks/movement/sprint/crouch/jump, typing/disabled/Settings guards, aliases, hold/release, reset and touch independence');
