import assert from 'node:assert/strict';

// Measure against the animated anatomical chest, NOT the unanimated avatar
// root: a rifle can pass a root-local rotation check and still orbit the torso.
export async function testWeaponHold(context, origin) {
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1100,height:850});
  await page.goto(origin+'/__harness.html');
  const result=await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js');
    const {BUILTIN_SKINS,createExternalGirl,loadGltfFromUrl,prepareTemplate}=await import('/js/rig.js');
    const {ensureMotions}=await import('/js/motion.js');
    const {prepareHandGrip}=await import('/js/handpose.js');
    const data=await(await fetch('/shared/weapons.json')).json();
    data.teamById=Object.fromEntries(data.teams.map(t=>[t.id,t]));
    const scene=new T.Scene();
    let frames=0,maxBodyDrift=0,maxRightError=0,maxLeftError=0;
    const examples=[];
    const vec=()=>new T.Vector3(),quat=()=>new T.Quaternion();
    for(const meta of Object.values(BUILTIN_SKINS)) {
      const template=prepareTemplate((await loadGltfFromUrl(meta.file)).scene);
      const clips=await ensureMotions(template);
      if(!clips?.run || !clips?.upper)throw new Error(`${meta.id}: animation clips not loaded`);
      const girl=createExternalGirl({template,meta,data,team:data.teams[0]});
      await Promise.resolve();scene.add(girl.root);
      const bone=key=>girl.root.getObjectByName(meta.bones[key].replace(/[\s.]+/g,'_'));
      const upperL=bone('elbowL').parent,upperR=bone('elbowR').parent;
      const ancestors=new Set();for(let b=upperR;b;b=b.parent)ancestors.add(b);
      let chest=upperL.parent;while(chest && !ancestors.has(chest))chest=chest.parent;
      scene.updateMatrixWorld(true);
      const chestPoint=chest.worldToLocal(upperL.getWorldPosition(vec()).add(upperR.getWorldPosition(vec())).multiplyScalar(.5));
      const bindInverse=chest.getWorldQuaternion(quat()).invert();
      const hands={R:prepareHandGrip(bone('handR'),'R'),L:prepareHandGrip(bone('handL'),'L')};
      let previousContact;
      for(const weapon of data.weapons) {
        girl.setWeapon(weapon);
        const immediate=girl.root.getObjectByName('weapon-hand').getWorldPosition(vec());
        if(previousContact && weapon.shape!=='pistol' && immediate.distanceTo(previousContact)>.001)throw new Error(`${meta.id}/${weapon.id}: switching gun jumps off grip before next pose/LOD update`);
        const gun=girl.root.getObjectByName('weapon-hand').parent;
        await gun.userData.modelReady;
        const hand=gun.getObjectByName('weapon-hand'),fore=gun.getObjectByName('weapon-fore');
        let reference=null,rotationReference=null;
        // Actual translated movement selects all eight directional run clips;
        // turning in place alone (the old test) never changed run sectors.
        for(let f=0;f<192;f++) {
          const phase=Math.floor(f/12),moving=phase<8;
          const direction=phase*Math.PI/4;
          girl.root.rotation.y=f*.031;
          if(moving)girl.root.position.add(new T.Vector3(-Math.sin(direction),0,Math.cos(direction)).applyAxisAngle(new T.Vector3(0,1,0),girl.root.rotation.y).multiplyScalar(5/60));
          const pitch=phase===13?89:phase===14?-89:0;
          const state={speed:moving?5:0,sprint:phase===7,crouch:phase===10,firing:phase===11,reloading:phase===12,ability:phase===15,pitch};
          girl.update(1/60,state);scene.updateMatrixWorld(true);
          const bodyRotation=chest.getWorldQuaternion(quat()).multiply(bindInverse);
          const bodyPoint=chest.localToWorld(chestPoint.clone());
          const contact=hand.getWorldPosition(vec()),gunRotation=gun.getWorldQuaternion(quat());
          const relative=contact.clone().sub(bodyPoint).applyQuaternion(bodyRotation.clone().invert());
          const relativeRotation=bodyRotation.clone().invert().multiply(gunRotation);
          if(!reference){reference=relative.clone();rotationReference=relativeRotation.clone();}
          const drift=relative.distanceTo(reference);maxBodyDrift=Math.max(maxBodyDrift,drift);
          if(drift>.001)throw new Error(`${meta.id}/${weapon.id}/${phase}: grip drifts ${(drift*100).toFixed(1)}cm around animated chest`);
          if(!pitch && relativeRotation.angleTo(rotationReference)>.001)throw new Error(`${meta.id}/${weapon.id}/${phase}: rifle rotates independently of torso`);
          for(const [side,socket] of [['R',hand],['L',fore]]) {
            if(side==='L' && (state.reloading||state.ability))continue;
            const target=hands[side].targetFor(socket.getWorldPosition(vec()),gunRotation,weapon.shape).clone();
            const error=hands[side].wrist.getWorldPosition(vec()).distanceTo(target);
            if(side==='R')maxRightError=Math.max(maxRightError,error);else maxLeftError=Math.max(maxLeftError,error);
            if(error>.03)throw new Error(`${meta.id}/${weapon.id}/${phase}/${side}: hand detached ${(error*100).toFixed(1)}cm from rifle`);
          }
          frames++;
        }
        previousContact=hand.getWorldPosition(vec());
      }
      girl.root.position.set(0,0,0);girl.root.rotation.y=0;girl.update(1/60,{speed:0});
      scene.remove(girl.root);examples.push(girl);
    }
    window.weaponHoldPreview={scene,examples,data};
    return {frames,maxBodyDrift,maxRightError,maxLeftError};
  });
  assert.equal(result.frames,4*30*192);
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${result.frames} actual third-person frames, 4 skins × 30 guns: animated-chest attachment, 8 run directions, turns, pitch, crouch, reload/throw and hand contact (max drift ${(result.maxBodyDrift*1000).toFixed(3)}mm; wrists ${result.maxRightError.toFixed(4)}/${result.maxLeftError.toFixed(4)}m)`);
  if(process.env.WEAPON_HOLD_SCREENSHOT) {
    await page.evaluate(async()=>{
      const T=await import('/vendor/three.module.js'),{scene,examples,data}=window.weaponHoldPreview;
      scene.background=new T.Color(0x647481);scene.add(new T.HemisphereLight(0xdcecff,0x665849,3));
      const light=new T.DirectionalLight(0xffffff,3);light.position.set(2,5,3);scene.add(light);
      const girl=examples[3];girl.marker.visible=girl.shadow.visible=false;scene.add(girl.root);
      girl.setWeapon(data.weapons[0]);await girl.root.getObjectByName('weapon-hand').parent.userData.modelReady;
      for(let i=0;i<60;i++)girl.update(1/60,{speed:0});
      const camera=new T.PerspectiveCamera(40,1100/850,.05,50);camera.position.set(1.8,1.5,2.8);camera.lookAt(0,.95,0);
      const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});renderer.setSize(1100,850);
      renderer.render(scene,camera);
    });
    await page.screenshot({path:process.env.WEAPON_HOLD_SCREENSHOT});
  }
  await page.close();
}
