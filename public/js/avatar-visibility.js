// A failed reach must not alternate two different hand models on adjacent
// frames. Once an equipped weapon needs the connected procedural fallback,
// retain it until the weapon/skin actually changes (or the player respawns).
export class ArmPresentation {
  constructor() { this.reset(); }
  reset() { this.key = null; this.imported = false; }
  update(key, reachError) {
    if (key !== this.key) {
      this.key = key;
      // Leave headroom for bob/recoil when initially choosing imported arms.
      this.imported = Number.isFinite(reachError) && reachError < 0.04;
    }
    if (!(reachError < 0.07)) this.imported = false;
    return this.imported;
  }
}

// Camera collision and spring motion can hover around the hide distance.
// Separate hide/show distances prevent the local body blinking near a wall.
export function bodyVisibleAtDistance(wasVisible, distance) {
  return distance > (wasVisible ? 0.75 : 0.95);
}
