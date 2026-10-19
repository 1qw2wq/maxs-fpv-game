import assert from 'node:assert/strict';
import {DeathClock,deathPose,DEATH_SETTLE,CORPSE_LIFETIME} from '../public/js/death-motion.js';
for(const headshot of [false,true])for(const side of [-1,1]){
  let lastFall=0;
  for(let frame=0;frame<600;frame++){
    const pose=deathPose(frame/120,{headshot,side});
    for(const value of Object.values(pose))if(typeof value==='number')assert(Number.isFinite(value));
    assert(pose.fall>=lastFall);lastFall=pose.fall;
    assert(pose.limp>=0&&pose.limp<=1);assert(pose.drop>=0&&pose.drop<=.9);
    assert(Math.abs(pose.roll)<=.19);assert(pose.visible===(frame/120<CORPSE_LIFETIME));
  }
}
assert(deathPose(.12,{headshot:true}).impact>deathPose(.12).impact);
assert(deathPose(DEATH_SETTLE).reveal);
const clock=new DeathClock();assert(!clock.visible);
assert(clock.setAlive(false,{direction:Math.PI/2,headshot:true,side:-1}));
clock.update(.5);
assert(!clock.setAlive(false,{direction:99}));assert.equal(clock.elapsed,.5);
assert.equal(clock.impact.direction,Math.PI/2);
clock.update(-10);clock.update(NaN);assert.equal(clock.elapsed,.5);
clock.update(10);assert.equal(clock.elapsed,CORPSE_LIFETIME);assert(!clock.visible);
assert(clock.setAlive(true));assert(!clock.dead);assert.equal(clock.elapsed,0);
clock.setAlive(false,{direction:Infinity});assert.equal(clock.impact.direction,0);
for(const hz of [30,60,144]){
 const c=new DeathClock();c.setAlive(false);
 for(let i=0;i<hz;i++)c.update(1/hz);
 assert(Math.abs(c.elapsed-1)<1e-12);
 assert(Math.abs(c.pose.tilt-deathPose(1).tilt)<1e-12);
}
console.log('PASS: deterministic death curves, headshot impact, snapshot idempotence, bounded corpse lifetime, respawn reset and 30/60/144Hz clocks');
