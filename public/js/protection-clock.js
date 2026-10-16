// Local presentation of a HOST-granted shield. Never grant immunity here.
// A life can shorten/expire its deadline, but cannot extend it. In particular,
// reapplying a saved packet after an async map load must not restart five seconds.
export class ProtectionClock {
  constructor(maxMs = 5000) { this.maxMs = maxMs; this.reset(); }
  reset() { this.life = null; this.until = 0; this.alive = false; }
  accept(life, remaining, alive, receivedAt) {
    const serial = Number.isSafeInteger(life) && life >= 0 ? life : null;
    if (serial !== null && this.life !== null && serial < this.life) return this.until;
    const fresh = this.life === null || (serial !== null && serial > this.life)
      || (serial === null && !this.alive && alive);
    const ms = Number.isFinite(remaining) ? Math.max(0, Math.min(this.maxMs, remaining)) : 0;
    const deadline = alive ? receivedAt + ms : 0;
    this.until = fresh ? deadline : Math.min(this.until, deadline);
    this.life = serial ?? this.life ?? 0;
    this.alive = !!alive;
    return this.until;
  }
  remaining(now) { return Math.max(0, this.until - now); }
}
