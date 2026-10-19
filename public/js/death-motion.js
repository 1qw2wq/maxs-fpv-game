// Pure, deterministic presentation curves. No damage, physics or network state.
export const DEATH_SETTLE = 1.25;
export const CORPSE_LIFETIME = 4.2;
const clamp = (x) => Math.max(0, Math.min(1, x));
export const smooth = (x) => { x=clamp(x); return x*x*(3-2*x); };
export function deathPose(seconds, {headshot=false, side=1}={}) {
  const t=Math.max(0,Number.isFinite(seconds)?seconds:0);
  const buckle=smooth((t-.10)/.38), fall=smooth((t-.20)/.70);
  const impact=Math.sin(Math.PI*clamp(t/.24))*(headshot ? .16 : .09);
  const settle=t>.90?Math.sin((t-.90)*24)*Math.exp(-(t-.90)*14)*.035:0;
  return {impact,buckle,fall,limp:smooth((t-.12)/.85),
    tilt:fall*1.48+impact+settle,
    roll:(side<0?-1:1)*(.18*fall+.04*impact),
    drop:.90*buckle, visible:t<CORPSE_LIFETIME,
    camera:smooth(t/.95), reveal:t>=1.05};
}

// Repeated snapshots must not rewind a corpse. A resurrection clears it fully.
export class DeathClock {
  constructor(){this.dead=false;this.elapsed=0;this.impact={};}
  setAlive(alive,impact={}) {
    if(alive){const changed=this.dead;this.dead=false;this.elapsed=0;this.impact={};return changed;}
    if(this.dead)return false;
    this.dead=true;this.elapsed=0;
    this.impact={headshot:!!impact.headshot,side:impact.side<0?-1:1,
      direction:Number.isFinite(impact.direction)?impact.direction:0};
    return true;
  }
  update(dt){if(this.dead)this.elapsed=Math.min(CORPSE_LIFETIME, this.elapsed+Math.max(0,Number.isFinite(dt)?dt:0));return this.pose;}
  get pose(){return deathPose(this.elapsed,this.impact);}
  get visible(){return this.dead&&this.elapsed<CORPSE_LIFETIME;}
}
