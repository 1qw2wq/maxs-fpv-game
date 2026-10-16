// Rendering-only budgets. Never changes the simulation, network rate or input.
export const poseInterval = distance => distance<20 ? 1/60 : distance<45 ? 1/30 : distance<90 ? 1/15 : 1/8;

export class AdaptiveResolution {
  constructor(renderer,{width,height,dpr=1}={}) {
    this.renderer=renderer;
    this.stats={frameMs:16.67,changes:0,poseUpdates:0,poseSkips:0,manualOverride:false};
    this.lastChange=0;this.windowMs=0;this.frames=0;
    this.resize(width,height,dpr);
  }
  resize(width,height,dpr=1) {
    this.max=Math.min(Math.max(.25,dpr),1.5,Math.sqrt(2000000/Math.max(1,width*height)));
    this.min=Math.min(.65,this.max);
    this.ratio=Math.min(this.max,Math.max(this.min,this.ratio??this.max));
    this.renderer.setPixelRatio(this.ratio);this.stats.ratio=this.ratio;
  }
  update(ms,now,active=true) {
    // Preserve explicit developer/test quality overrides and ignore tab stalls.
    if(Math.abs(this.renderer.getPixelRatio()-this.ratio)>.001){this.stats.manualOverride=true;return;}
    if(!active||ms<=0||ms>250){this.windowMs=0;this.frames=0;return;}
    this.windowMs+=ms;this.frames++;
    if(this.windowMs<1000)return;
    this.stats.frameMs=this.windowMs/this.frames;this.windowMs=0;this.frames=0;
    if(now-this.lastChange<1500)return;
    let next=this.ratio;
    if(this.stats.frameMs>22)next=Math.max(this.min,this.ratio*.85);
    else if(this.stats.frameMs<14 && now-this.lastChange>4000)next=Math.min(this.max,this.ratio*1.08);
    if(Math.abs(next-this.ratio)>.01){
      this.ratio=next;this.renderer.setPixelRatio(next);
      this.stats.ratio=next;this.stats.changes++;this.lastChange=now;
    }
  }
}
