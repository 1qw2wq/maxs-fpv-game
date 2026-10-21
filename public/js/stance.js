// Presentation-only crouch. Shared by imported and procedural characters.
// Negative hip flexion brings knees forward; the old positive offset extended
// the hips backwards while the knee bent, producing a standing-height bow.
export function crouchBlend(current,wanted,dt){
  return current+((wanted?1:0)-current)*(1-Math.exp(-6*Math.max(0,dt||0)));
}
export function crouchPose(amount){
  const t=Math.max(0,Math.min(1,amount)),c=t*t*(3-2*t);
  return {amount:c,hip:-1.38*c,knee:2.48*c,ankle:-1.10*c,spine:.58*c,
    gait:1-.82*c,bob:1-.90*c,dropLimit:.85*c};
}
