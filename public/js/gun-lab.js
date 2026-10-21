import * as THREE from 'three';
import {BUILTIN_SKINS,createExternalGirl,loadGltfFromUrl,prepareTemplate} from './rig.js';
import {createGirl} from './character.js';
import {applyEnvironment,sceneStyle} from './lighting.js';
import {placement,exportPlacements,importPlacements} from './third-person-placement.js';

const $=id=>document.getElementById(id),KEY='tf.thirdPersonGunLab.v1';
let data,girl,gun,ready=false,epoch=0,comparing=false,recorded={},drafts={},context={},storageOK=true;
const controls=[];const templates=new Map();
const message=(text,bad=false)=>{ $('message').textContent=text;$('message').className=bad?'warning':'good'; };
function persist(){
 try{localStorage.setItem(KEY,JSON.stringify({records:exportPlacements(recorded,data.weapons,context),drafts:exportPlacements(drafts,data.weapons),notes:$('notes').value}));storageOK=true;}
 catch{storageOK=false;}
 $('storage-status').textContent=storageOK?'Drafts and records are saved in this browser. Download a backup before clearing browser data.':'Browser storage unavailable/full: values last only this session. Download JSON before closing.';
}
function output(){
 if(!data)return;
 context={...context,previewSkin:$('skin').value,previewPose:$('pose').value,notes:$('notes').value};
 $('json').value=JSON.stringify(exportPlacements(recorded,data.weapons,context),null,2);
 const n=Object.keys(recorded).length;$('record-count').textContent=`${n} / ${data.weapons.length} guns recorded`;
 $('copy').disabled=$('download').disabled=n===0;
 if(gun)$('dirty').textContent=JSON.stringify(recorded[gun.id])===JSON.stringify(current())?'Recorded / 已记录':'Unrecorded changes — click Record this gun to include in export.';
}
const current=()=>placement(drafts[gun.id]||placement());
function syncInputs(){
 if(!gun)return;const value=current();
 controls.forEach(({kind,i,range,number})=>{range.value=number.value=value[kind][i];number.removeAttribute('aria-invalid');});if(ready)$('record').disabled=false;output();
}
function live(){if(ready)girl.setWeaponPlacement(comparing?placement():current());}
function change(kind,i,input){
 if(!gun)return;
 if(input.value.trim()===''||!input.checkValidity()){input.setAttribute('aria-invalid','true');$('record').disabled=true;message(`${kind}: enter a number within ±${kind==='position'?.5:180}.`,true);return;}
 const value=current();value[kind][i]=Number(input.value);
 try{drafts[gun.id]=placement(value);live();syncInputs();persist();}catch(error){message(error.message,true);}
}
for(const [kind,limit,step]of [['position',.5,.001],['rotation',180,.1]])for(let i=0;i<3;i++){
 const axis='XYZ'[i],row=document.createElement('div');row.className='axis-row';
 const label=document.createElement('label');label.textContent=axis;label.className='axis-'+axis.toLowerCase();label.htmlFor=`${kind}-${axis}`;
 const range=document.createElement('input');range.type='range';range.min=-limit;range.max=limit;range.step=step;range.value=0;range.id=`${kind}-${axis}`;range.setAttribute('aria-label',`${kind} ${axis}`);
 const number=document.createElement('input');number.type='number';number.min=-limit;number.max=limit;number.step=.000001;number.value=0;number.setAttribute('aria-label',`${kind} ${axis} number`);
 range.disabled=number.disabled=true;
 for(const input of[range,number])input.addEventListener('input',()=>change(kind,i,input));
 row.append(label,range,number);$(kind+'-controls').append(row);controls.push({kind,i,range,number});
}
function editable(enabled){
 ready=enabled;for(const {range,number}of controls)range.disabled=number.disabled=!enabled;
 for(const id of['record','reset','baseline'])$(id).disabled=!enabled;
}
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:$('stage'),antialias:true});}
catch(error){$('load-status').textContent='WebGL unavailable — open in a WebGL-capable browser.';throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();scene.background=new THREE.Color('#18212b');
scene.add(new THREE.HemisphereLight('#d6e8ff','#5b5149',2));
for(const [color,power,p]of [['#fff0d4',2.5,[3,5,4]],['#abcaff',1.4,[-3,3,-4]]]){const light=new THREE.DirectionalLight(color,power);light.position.fromArray(p);scene.add(light);}
applyEnvironment(renderer,scene,sceneStyle({skyTop:'#a4b8cf',skyBottom:'#e2d6c4',mud:'#4c505b'}));
const grid=new THREE.GridHelper(6,30,'#607184','#303c49');scene.add(grid);
const camera=new THREE.PerspectiveCamera(36,1,.03,30);
const orbit={yaw:.65,pitch:.12,distance:3.4,target:new THREE.Vector3(0,1,0)};
const axes=new THREE.AxesHelper(.24);axes.renderOrder=20;axes.material.depthTest=false;axes.material.transparent=true;
let drag=null;
$('stage').addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};$('stage').setPointerCapture(e.pointerId);});
$('stage').addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;orbit.yaw-=(e.clientX-drag.x)*.008;orbit.pitch=THREE.MathUtils.clamp(orbit.pitch+(e.clientY-drag.y)*.006,-1.2,1.2);drag.x=e.clientX;drag.y=e.clientY;});
for(const event of['pointerup','pointercancel','lostpointercapture'])$('stage').addEventListener(event,()=>{drag=null;});
$('stage').addEventListener('wheel',e=>{e.preventDefault();orbit.distance=THREE.MathUtils.clamp(orbit.distance*Math.exp(Math.sign(e.deltaY)*.1),.45,9);},{passive:false});
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
 const view=button.dataset.view;orbit.yaw={front:0,back:Math.PI,left:-Math.PI/2,right:Math.PI/2,hands:.55}[view];orbit.pitch=view==='hands'?.04:.1;orbit.distance=view==='hands'?1.05:3.4;orbit.target.set(0,view==='hands'?1.25:1,view==='hands'?.22:0);
});
function endCompare(){comparing=false;$('baseline').setAttribute('aria-pressed','false');live();}
$('baseline').addEventListener('pointerdown',e=>{e.preventDefault();comparing=true;$('baseline').setAttribute('aria-pressed','true');live();});
$('baseline').addEventListener('keydown',e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();comparing=true;$('baseline').setAttribute('aria-pressed','true');live();}});
window.addEventListener('pointerup',endCompare);window.addEventListener('pointercancel',endCompare);window.addEventListener('blur',endCompare);
$('baseline').addEventListener('keyup',endCompare);$('baseline').addEventListener('blur',endCompare);
$('reset').addEventListener('click',()=>{drafts[gun.id]=placement();live();syncInputs();persist();message('Draft reset to the game baseline. Record again to replace an existing record.');});
$('record').addEventListener('click',()=>{
 if(controls.some(({number})=>number.value.trim()===''||!number.checkValidity())){message('Correct invalid numbers before recording.',true);return;}
 recorded[gun.id]=current();context={...context,reviewedOn:{...context.reviewedOn,[gun.id]:{skin:$('skin').value,pose:$('pose').value,pitch:Number($('pitch').value)}}};output();persist();message(`Recorded ${gun.id}. Download JSON when finished.`);
});
$('notes').addEventListener('input',()=>{output();persist();});
$('pose').addEventListener('change',output);
$('pitch').addEventListener('input',()=>{$('pitch-value').value=$('pitch').value+'°';});
$('download').addEventListener('click',()=>{
 output();const url=URL.createObjectURL(new Blob([$('json').value],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='third-person-gun-placements.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Send the downloaded JSON file to me.');
});
$('copy').addEventListener('click',async()=>{
 output();try{await navigator.clipboard.writeText($('json').value);message('Copied. Paste the JSON into our chat.');}
 catch{$('json').focus();$('json').select();message('Clipboard blocked. The JSON is selected: use Ctrl/Cmd+C, or Download JSON.',true);}
});
$('import').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  if(file.size>200000)throw Error('Import must be under 200 KB');
  const text=await file.text(),values=importPlacements(text,data.weapons),count=Object.keys(values).length;
  // Validate the entire document before changing a single record.
  recorded={...recorded,...values};drafts={...drafts,...values};
  const notes=JSON.parse(text).context?.notes;if(typeof notes==='string')$('notes').value=notes.slice(0,2000);
  live();syncInputs();persist();message(`Imported ${count} gun records. Other guns are unchanged.`);
 }catch(error){message(`Import rejected: ${error.message}`,true);}finally{e.target.value='';}
});
async function selectSetup(){
 const token=++epoch;editable(false);endCompare();gun=data.weapons.find(w=>w.id===$('gun').value);syncInputs();
 const weapon=gun,skin=$('skin').value;$('load-status').textContent=`Loading ${weapon.nameEn||weapon.name}…`;
 let next;
 try{
  if(skin==='procedural')next=createGirl(data.classes.find(c=>c.id===weapon.class)||data.classes[0],data.teams[0],data);
  else{
   const meta=BUILTIN_SKINS[skin];if(!templates.has(skin))templates.set(skin,loadGltfFromUrl(meta.file).then(g=>prepareTemplate(g.scene)).catch(error=>{templates.delete(skin);throw error;}));
   const template=await templates.get(skin);if(token!==epoch)return;
   next=createExternalGirl({template,meta,data,team:data.teams[0]});
  }
  next.setWeapon(weapon);const built=next.root.getObjectByName('weapon-hand')?.parent;
  if(!built)throw Error('Weapon anchors missing');await built.userData.modelReady;
  if(weapon.model&&!built.getObjectByName('gun-model-'+weapon.model))throw Error('Uploaded gun failed to load (fallback is not valid for calibration). Reload the page or choose another gun.');
  if(token!==epoch){next.destroy?.();return;}
  girl?.destroy?.();if(girl)girl.root.removeFromParent();axes.removeFromParent();girl=next;
  scene.add(girl.root);girl.marker.visible=girl.shadow.visible=false;
  const anchor=girl.root.getObjectByName('weapon-hand');anchor.add(axes);
  editable(true);live();syncInputs();$('load-status').textContent=`${weapon.id} / ${skin} · live TP rig`;
 }catch(error){if(next){next.destroy?.();next.root.removeFromParent();}if(token===epoch){$('load-status').textContent='Asset load failed';message(error.message,true);}}
}
$('gun').addEventListener('change',selectSetup);$('skin').addEventListener('change',selectSetup);
let last=performance.now();
function frame(now){
 requestAnimationFrame(frame);const dt=Math.min(.05,(now-last)/1000);last=now;
 const width=$('stage-wrap').clientWidth,height=$('stage-wrap').clientHeight;
 if(renderer.domElement.width!==Math.floor(width*renderer.getPixelRatio())||renderer.domElement.height!==Math.floor(height*renderer.getPixelRatio())){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
 if(ready){
  const pose=$('pose').value;girl.update($('paused').checked?0:dt,{speed:pose==='walk'?2:pose==='run'?5:0,sprint:pose==='run',crouch:pose==='crouch',firing:pose==='fire',pitch:Number($('pitch').value)});
  axes.visible=$('axes').checked;
  const reach=girl.weaponPlacementReach,miss=reach?Math.max(reach.right||0,reach.left||0):null;
  $('reach').textContent=miss===null?'Procedural character · inspect hands visually':`Wrist reach error: ${(miss*100).toFixed(1)} cm${miss>.07?' · beyond comfortable reach':''}`;
  $('reach').className=miss>.07?'warning':'';
 }
 camera.position.set(orbit.target.x+Math.sin(orbit.yaw)*Math.cos(orbit.pitch)*orbit.distance,orbit.target.y+Math.sin(orbit.pitch)*orbit.distance,orbit.target.z+Math.cos(orbit.yaw)*Math.cos(orbit.pitch)*orbit.distance);camera.lookAt(orbit.target);renderer.render(scene,camera);
}
requestAnimationFrame(frame);
async function boot(){
 const response=await fetch('shared/weapons.json');if(!response.ok)throw Error(`Catalog HTTP ${response.status}`);data=await response.json();
 data.teamById=Object.fromEntries(data.teams.map(t=>[t.id,t]));data.weaponsByClass=Object.fromEntries(data.classes.map(c=>[c.id,data.weapons.filter(w=>w.class===c.id)]));
 for(const w of data.weapons){const option=new Option(`${w.nameEn||w.name} · ${w.id}`,w.id);$('gun').add(option);}
 for(const skin of Object.values(BUILTIN_SKINS))$('skin').add(new Option(skin.nameEn||skin.name,skin.id));$('skin').add(new Option('Procedural fallback character','procedural'));
 try{const saved=localStorage.getItem(KEY);if(saved){const doc=JSON.parse(saved);const records=importPlacements(JSON.stringify(doc.records),data.weapons),restoredDrafts=importPlacements(JSON.stringify(doc.drafts),data.weapons);recorded=records;drafts=restoredDrafts;context=doc.records.context&&typeof doc.records.context==='object'?doc.records.context:{};$('notes').value=typeof doc.notes==='string'?doc.notes.slice(0,2000):'';message('Restored drafts and recorded values.');}}
 catch(error){message(`Stored session not restored: ${error.message}`,true);}
 const initial=new URLSearchParams(location.search).get('gun');if(data.weapons.some(w=>w.id===initial))$('gun').value=initial;
 const initialSkin=new URLSearchParams(location.search).get('skin');if(initialSkin==='procedural'||BUILTIN_SKINS[initialSkin])$('skin').value=initialSkin;
 $('gun').disabled=$('skin').disabled=false;output();persist();await selectSetup();
 // Explicit debug-only inspection, not a production game API.
 window.gunLab={get ready(){return ready;},get girl(){return girl;},get gun(){return gun;},get records(){return structuredClone(recorded);},get draft(){return current();},renderer,scene,camera};
}
boot().catch(error=>{$('load-status').textContent='Cannot start gun lab';message(error.message,true);});
