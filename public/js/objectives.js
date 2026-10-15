import * as THREE from 'three';
import { t } from './i18n.js';
const COLORS = [0x44baff,0xff7653];

/** Three persistent world flags + DOM readouts. Ownership comes only from state. */
export class ObjectivesView {
  constructor(scene) {
    this.root=new THREE.Group();scene.add(this.root);
    this.markers=new Map();this.state=null;
    this.el=document.getElementById('objective-hud');
  }
  clear() {
    for(const marker of this.markers.values()) {
      marker.root.removeFromParent();
      marker.root.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});
      marker.card.remove();
    }
    this.markers.clear();
    if(this.el)this.el.classList.add('hidden');
  }
  setState(state) {
    this.state=state?.gameMode==='control'?state.objectives:null;
    if(!this.state){this.clear();return;}
    const ids=new Set(this.state.points.map(p=>p.id));
    if([...this.markers.keys()].some(id=>!ids.has(id)))this.clear();
    if(!this.el)return;
    this.el.classList.remove('hidden');
    for(const point of this.state.points) {
      let marker=this.markers.get(point.id);
      if(!marker) {
        const root=new THREE.Group();this.root.add(root);
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.05,3,6),new THREE.MeshStandardMaterial({color:0xd7dce0,roughness:.7}));pole.position.y=1.5;root.add(pole);
        const ring=new THREE.Mesh(new THREE.RingGeometry(this.state.radius-.12,this.state.radius,64),new THREE.MeshBasicMaterial({color:0xb5bec7,transparent:true,opacity:.4,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.035;root.add(ring);
        const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.font='900 44px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(point.id,32,34);
        const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
        const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.25,.95),new THREE.MeshBasicMaterial({color:0xb5bec7,side:THREE.DoubleSide}));flag.position.set(.6,2.4,0);root.add(flag);
        const label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthWrite:false}));label.position.set(0,3.5,0);label.scale.setScalar(.85);root.add(label);
        const card=document.createElement('div');card.className='objective-card';
        card.innerHTML='<b></b><span class="objective-distance"></span><small></small><div class="objective-progress"><i></i></div>';
        card.querySelector('b').textContent=point.id;document.getElementById('objective-cards').appendChild(card);
        marker={root,pole,ring,flag,card};this.markers.set(point.id,marker);
      }
      marker.point=point;marker.root.position.fromArray(point.p);
      const color=point.owner<0?0xb5bec7:COLORS[point.owner];
      marker.flag.material.color.setHex(color);marker.ring.material.color.setHex(color);
      marker.card.style.setProperty('--point-color','#'+color.toString(16).padStart(6,'0'));
      marker.card.querySelector('small').textContent=point.contested?t('争夺中'):point.attacking>=0?(point.owner<0?t('占领中'):t('中立化中')):point.owner<0?t('中立'):t('已占领');
      const fill=marker.card.querySelector('i');fill.style.width=`${point.progress*100}%`;
      fill.style.background=point.attacking<0?'#bbc4cc':'#'+COLORS[point.attacking].toString(16);
    }
    const hold=this.state.holdTeam>=0;
    document.getElementById('objective-status').textContent=hold?t('全点控制：守住 {n} 秒即可获胜',{n:Math.ceil(this.state.holdRemaining/1000)}):t('占领全部据点并守住 {n} 秒',{n:this.state.holdRequired/1000});
  }
  update(controls,now,playing) {
    this.root.visible=!!playing;
    if(!this.state||!playing)return;
    for(const marker of this.markers.values()) {
      const p=marker.point.p,dx=p[0]-controls.pos.x,dz=p[2]-controls.pos.z;
      const distance=Math.round(Math.hypot(dx,dz));
      const bearing=((Math.atan2(dz,dx)*180/Math.PI-controls.yaw+540)%360)-180;
      const arrow=Math.abs(bearing)<35?'↑':bearing>0?'→':'←';
      const text=`${arrow} ${distance} m`;
      const field=marker.card.querySelector('.objective-distance');if(field.textContent!==text)field.textContent=text;
      marker.flag.rotation.y=.2+Math.sin(now*.0015)*.08;
      marker.ring.material.opacity=marker.point.contested?.35+Math.sin(now*.004)*.08:.4;
    }
  }
}
