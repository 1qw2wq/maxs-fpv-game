import assert from 'node:assert/strict';
import { ArmPresentation, bodyVisibleAtDistance } from '../public/js/avatar-visibility.js';

const arms = new ArmPresentation();
assert.equal(arms.update('skin|gun-a', 0.01), true);
let transitions = 0, previous = true;
for (let i = 0; i < 12000; i++) {
  const visible = arms.update('skin|gun-a', i % 2 ? 0.069 : 0.071);
  transitions += Number(visible !== previous);
  previous = visible;
}
assert.equal(transitions, 1, 'A noisy reach must fall back once, never flash between arm models');
assert.equal(arms.update('skin|gun-a', 0), false, 'No re-entry during the same equip cycle');
assert.equal(arms.update('skin|gun-b', 0.01), true, 'A different equipped gun can use imported arms');
assert.equal(arms.update('skin-b|gun-b', 0.05), false, 'Initial selection reserves movement/recoil headroom');
assert.equal(arms.update('missing-bones|gun-b', Infinity), false);
assert.equal(arms.update('missing-bones|gun-b', NaN), false);
arms.reset();
assert.equal(arms.update('skin|gun-a', 0), true, 'Respawning clears the equip-cycle latch');

let visible = true;
for (let i = 0; i < 12000; i++) {
  visible = bodyVisibleAtDistance(visible, i % 2 ? 0.79 : 0.81);
  assert.equal(visible, true, 'A third-person camera hovering near the old threshold must not flash the body');
}
visible = bodyVisibleAtDistance(visible, 0.74);
assert.equal(visible, false);
for (let i = 0; i < 12000; i++) {
  visible = bodyVisibleAtDistance(visible, i % 2 ? 0.79 : 0.81);
  assert.equal(visible, false, 'An obscuring body stays hidden until the camera has cleared it');
}
assert.equal(bodyVisibleAtDistance(visible, 0.96), true);
console.log('PASS arm presentation: 12,000 threshold frames; body visibility: 24,000 collision-distance frames');
