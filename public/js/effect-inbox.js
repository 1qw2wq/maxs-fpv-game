// Network FX keep arriving while a GLB decodes. Preserve them across world
// teardown, without restarting fuses/cloud lifetimes or resurrecting removals.
export class EffectInbox {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.loading = false;
    this.pending = new Map();
  }
  begin(effects = []) {
    this.pending.clear();
    this.loading = true;
    for (const fx of effects) this.push(fx);
  }
  push(fx) {
    // A removal supersedes either a welcome entry or a live cast with this id.
    this.pending.set(fx.eid, {fx: {...fx}, at: this.clock()});
  }
  finish() {
    const now = this.clock();
    this.loading = false;
    const effects = [...this.pending.values()].map(({fx, at}) =>
      fx.k === 'remove' ? fx : {...fx, age: Math.max(0, fx.age || 0) + Math.max(0, now-at)});
    this.pending.clear();
    return effects;
  }
}
