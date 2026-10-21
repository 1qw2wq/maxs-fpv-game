import assert from 'node:assert/strict';

// Observe the real main.js local AND interpolated remote rendering paths.
export async function testLiveWeaponHold(page) {
  await page.evaluate(()=>{const {app}=window.__trench;app.cameraMode='tp';app.controls.mouse.right=false;});
  await page.waitForFunction(()=>window.__trench.app.self?.root.visible && window.__trench.app.self.skinId);
  const remoteId=await page.evaluate(()=>{
    const {app}=window.__trench,at=app.controls.eye().addScaledVector(app.controls.aim(),4);
    return Number(app.net._engine.py.runPython(`import game\nhold_qa=_host.room.match.add_player('Weapon hold QA',None)\nhold_qa.update(team=${1-app.myTeam},cls='assault',weapon='mp18',pos=[${at.x},${app.controls.pos.y},${at.z}],reload_end=game.now_ms()+12000,reload_total=12000)\nhold_qa['id']`));
  });
  await page.waitForFunction(id=>window.__trench.app.remotes.get(id)?.skinId,remoteId);
  await page.evaluate(async id=>{
    const T=await import('/vendor/three.module.js'),{BUILTIN_SKINS}=await import('/js/rig.js');
    const {app}=window.__trench;
    window.liveHold={self:{frames:0,drift:0},remote:{frames:0,drift:0},restore:[]};
    for(const [key,girl] of [['self',app.self],['remote',app.remotes.get(id)]]) {
      const meta=BUILTIN_SKINS[girl.skinId];
      const bone=key=>girl.root.getObjectByName(meta.bones[key].replace(/[\s.]+/g,'_'));
      const ancestors=new Set();for(let b=bone('elbowR').parent;b;b=b.parent)ancestors.add(b);
      let chest=bone('elbowL').parent.parent;while(chest&&!ancestors.has(chest))chest=chest.parent;
      const original=girl.update;let reference;
      girl.update=function(dt,state) {
        original.call(this,dt,state);
        const contact=this.root.getObjectByName('weapon-hand');
        if(!contact)return;
        const relative=contact.getWorldPosition(new T.Vector3()).sub(chest.getWorldPosition(new T.Vector3())).applyQuaternion(chest.getWorldQuaternion(new T.Quaternion()).invert());
        reference ||= relative.clone();
        liveHold[key].drift=Math.max(liveHold[key].drift,relative.distanceTo(reference));
        liveHold[key].frames++;
      };
      liveHold.restore.push(()=>girl.update=original);
    }
  },remoteId);
  try {
    for(let phase=0;phase<6;phase++) {
      const before=await page.evaluate(({phase,id})=>{
        const {app}=window.__trench,c=app.controls;
        c.keys.clear();c.keys.add(phase%2?'KeyA':'KeyW');if(phase===2)c.keys.add('ShiftLeft');if(phase===3)c.keys.add('KeyC');
        c.yaw=(c.yaw+60)%360;c.pitch=phase===4?70:phase===5?-70:0;
        app.throwAt=phase===5?performance.now()+1000:0;
        const at=c.eye().addScaledVector(c.aim(),4);
        app.net._engine.py.runPython(`hold_qa['pos']=[${at.x},${c.pos.y},${at.z}];hold_qa['yaw']=${c.yaw+180};hold_qa['pitch']=${-c.pitch}`);
        return liveHold.self.frames;
      },{phase,id:remoteId});
      await page.waitForFunction(before=>liveHold.self.frames>=before+6,before);
    }
    const result=await page.evaluate(()=>({self:liveHold.self,remote:liveHold.remote}));
    assert.ok(result.self.frames>=36 && result.remote.frames>=6,JSON.stringify(result));
    assert.ok(result.self.drift<.001 && result.remote.drift<.001,`Live torso attachment drifts: ${JSON.stringify(result)}`);
    console.log(`PASS: actual main.js local/remote weapon holds stay on animated chest while moving, sprinting, crouching, turning, pitching and throwing (${result.self.frames}/${result.remote.frames} observed poses)`);
  } finally {
    await page.evaluate(id=>{
      liveHold.restore.forEach(fn=>fn());
      const {app}=window.__trench;app.controls.keys.clear();app.controls.pitch=0;app.throwAt=0;
      app.net._engine.py.runPython(`_host.room.match.remove_player(${id})`);
    },remoteId);
  }
}
