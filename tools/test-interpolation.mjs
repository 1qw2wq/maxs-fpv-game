import assert from 'node:assert/strict';
import {Net} from '../public/js/net.js';
const descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=1000;
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
try {
 const net=new Net();
 const row=(x,life=1)=>({i:2,life,al:1,p:[x,0,0],y:0,pi:0,f:0});
 net._dispatch({t:'state',tick:1,ps:[row(1)]});
 now=1050;net._dispatch({t:'state',tick:2,ps:[row(2)]});
 assert.equal(net.sample().get(2).x,1,'Render time before oldest snapshot must hold oldest, not newest');
 now=1145;assert.equal(net.sample().get(2).x,1.5);
 now=1250;assert.equal(net.sample().get(2).x,2,'No extrapolation beyond newest');
 net._dispatch({t:'state',tick:3,ps:[row(30,2)]});now=1320;
 assert.equal(net.sample().get(2).x,30,'Respawn never interpolates across lives');
 console.log('PASS: jitter buffer endpoints, interpolation, no extrapolation and respawn teleport');
}finally{Object.defineProperty(globalThis,'performance',descriptor);}
