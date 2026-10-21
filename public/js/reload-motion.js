// Per-model procedural reload choreography. Gun coordinates: +Z down barrel.
// These change presentation only; the authority owns timing/ammunition.
import {weaponSockets,reloadPose} from './weaponpose.js';
// feed, pitch, roll, lowering, withdrawal XYZ, charging reach, feed timing.
export const RELOAD_PROFILES = {
  mp18:['side-drum',.22,-.40,.055,-.13,-.025,-.03,.045,.00],
  auto1918:['box-mag',.34,-.21,.065,-.025,-.14,-.035,.055,.01],
  hellriegel:['drum',.26,-.32,.08,-.06,-.12,.015,.06,.02],
  cei:['receiver',.18,.18,.045,-.02,.06,-.04,.07,.03],
  rsc1917:['box-mag',.29,-.26,.07,-.04,-.13,.02,.065,.04],
  federov:['curved-mag',.31,-.29,.06,-.055,-.12,-.045,.05,.015],
  lewis:['pan',.20,-.18,.08,-.075,.11,-.035,.08,.025],
  bar:['box-mag',.25,-.33,.065,-.03,-.15,-.02,.075,.035],
  chauchat:['halfmoon',.38,-.24,.09,-.09,-.12,.035,.085,.045],
  smle:['stripper',.16,.20,.04,-.015,.055,-.015,.055,.00],
  m95:['enbloc',.19,.24,.05,-.025,.075,.005,.065,.015],
  springfield:['stripper',.21,.16,.045,-.035,.065,-.025,.075,.03],
  sentinel:['box-mag',.23,-.19,.06,-.035,-.11,-.035,.055,.045],
  awp:['box-mag',.30,-.36,.075,-.04,-.14,-.055,.09,.01],
  longbow:['box-mag',.27,-.22,.055,-.065,-.10,.015,.06,.025],
  ar15:['box-mag',.24,-.28,.065,-.015,-.13,-.02,.04,.04],
  pmx:['box-mag',.20,-.30,.05,-.03,-.10,-.015,.035,.005],
  gm6:['bullpup',.32,-.16,.08,-.045,-.11,-.08,.065,.02],
  lr300:['box-mag',.28,-.25,.06,-.02,-.12,.035,.05,.035],
  m170:['box-mag',.35,-.20,.075,-.055,-.13,-.065,.085,.05],
  m249:['belt',.22,.28,.085,-.11,.08,.025,.075,.01],
  m4a1:['box-mag',.26,-.23,.055,-.025,-.115,-.025,.045,.025],
  m60light:['belt',.28,.32,.08,-.10,.07,-.025,.085,.04],
  m60:['belt',.31,.36,.095,-.12,.095,-.04,.095,.005],
  mp5:['slap',.21,-.35,.05,-.035,-.095,.015,.10,.02],
  pgm:['box-mag',.33,-.27,.07,-.045,-.125,-.045,.08,.035],
  apx:['pistol',.18,-.26,.035,-.015,-.10,-.015,.03,.00],
  g17:['pistol',.22,-.31,.04,-.025,-.115,-.025,.04,.015],
  deagle:['pistol',.29,-.22,.05,-.035,-.13,-.035,.055,.03],
  flarepistol:['break-action',.46,.17,.055,-.025,.075,.08,.035,.045],
};
const smooth=(a,b,t)=>{const v=Math.max(0,Math.min(1,(t-a)/(b-a)));return v*v*(3-2*v);};
export function weaponReloadPose(weapon={},progress=0,baseFore) {
  const profile=RELOAD_PROFILES[weapon.id]||RELOAD_PROFILES.ar15;
  const [feed,pitch,roll,drop,x,y,z,charge,delay]=profile;
  const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
  const phase=reloadPose(p,!!weapon.clip);
  const sockets=weaponSockets(weapon),rest=baseFore||sockets.fore;
  const reach=smooth(.10+delay,.27+delay,p)*(1-smooth(.78,.98,p));
  const withdrawal=smooth(.29+delay,.43+delay,p)*(1-smooth(.56+delay,.69+delay,p));
  const charging=Math.sin(Math.PI*smooth(.67,.85,p))*(1-smooth(.85,.96,p));
  const target=sockets.reload.slice();
  const fore=rest.map((v,i)=>v+(target[i]-v)*reach+[x,y,z][i]*withdrawal);
  // Feed rounds down into the receiver; detachable magazines are withdrawn
  // below/along their feed axis. Charge/slap occurs only before recovering.
  if(weapon.clip)fore[1]+=Math.sin(p*Math.PI*(weapon.id==='smle'?12:8))*withdrawal*.018;
  fore[2]-=charging*charge;
  fore[0]-=charging*(feed==='slap'?.055:.015);
  return {...phase,reach,fore,feed,position:[-phase.present*roll*.06,-phase.present*drop+phase.seat,0],
    rotation:[phase.present*pitch,phase.present*(feed==='side-drum'?-.10:.025),phase.present*roll]};
}
