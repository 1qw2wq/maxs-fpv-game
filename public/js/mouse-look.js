// Native pointer-lock deltas only. Coalesce high-polling mice at render time;
// never feed a browser recenter/warp or a stalled event backlog into the view.
export class MouseLook {
  constructor() { this.rejected = 0; this.reset(); }

  reset(now = performance.now()) {
    this.yaw = this.pitch = 0;
    this.guardUntil = now + 120;
  }

  push(dx, dy, degreesPerPixel, now = performance.now()) {
    const peak = Math.max(Math.abs(dx), Math.abs(dy));
    // A real flick normally consists of many small packets. Allow up to 512px
    // per packet outside the short lock/resize guard; do not throw away the
    // first normal movement after locking or introduce a cursor fallback.
    if (![dx, dy, degreesPerPixel].every(Number.isFinite) || peak > 512 ||
        (now < this.guardUntil && peak > 100)) {
      this.rejected++;
      return;
    }
    this.yaw += dx * degreesPerPixel;
    this.pitch -= dy * degreesPerPixel;
    const length = Math.hypot(this.yaw, this.pitch);
    // A long blocked frame must not leave seconds of deferred spinning.
    if (length > 60) { this.yaw *= 60 / length; this.pitch *= 60 / length; }
  }

  consume(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return { yaw: 0, pitch: 0 };
    const step = Math.min(dt, .05);
    const alpha = 1 - Math.exp(-step / .008); // ~8ms filter, not camera-only lag
    let yaw = this.yaw * alpha, pitch = this.pitch * alpha;
    const length = Math.hypot(yaw, pitch), limit = Math.min(18, 1200 * step);
    if (length > limit) { yaw *= limit / length; pitch *= limit / length; }
    this.yaw -= yaw; this.pitch -= pitch;
    if (Math.abs(this.yaw) < .00001) { yaw += this.yaw; this.yaw = 0; }
    if (Math.abs(this.pitch) < .00001) { pitch += this.pitch; this.pitch = 0; }
    return { yaw, pitch };
  }
}
