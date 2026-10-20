import assert from 'node:assert/strict';
import {crouchBlend,crouchPose} from '../public/js/stance.js';
for(const hz of [20,30,60,144]){
 let c=0;
 for(let f=0;f<hz*2;f++)c=crouchBlend(c,true,1/hz);
 assert(c>.99999);assert(Math.abs(c-(1-Math.exp(-12)))<1e-12);
 for(let f=0;f<hz*2;f++)c=crouchBlend(c,false,1/hz);
 assert(c<.00001);
}
assert.deepEqual(crouchPose(-2),crouchPose(0));
assert.deepEqual(crouchPose(2),crouchPose(1));
for(let i=0;i<=100;i++){
 const p=crouchPose(i/100);
 assert(Math.abs(p.hip+p.knee+p.ankle)<1e-12,'Ankle must compensate leg flexion');
 assert(p.hip<=0&&p.knee>=0&&p.ankle<=0);
 for(const value of Object.values(p))assert(Number.isFinite(value));
}
assert.equal(crouchPose(0).gait,1);assert.equal(crouchPose(0).spine,0);
assert(crouchPose(1).gait<.2);
assert.equal(crouchBlend(.5,true,0),.5);
console.log('PASS: frame-rate-independent stance, hip/knee/ankle balance, bounded poses and short crouched gait');
