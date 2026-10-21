// Pre-match admission/state, independent of rendering and the Python engine.
// The same channel is handed to RelayHostNet/RelayNet when the host starts.
import {cleanBotSettings} from './bot-settings.js';
const topic=code=>`trench-front/v1/r/${code}`;
// Epoch uniqueness, not an authentication token; LAN HTTP may lack randomUUID.
const nonce=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const cleanName=name=>String(name||'Player').replace(/[\u0000-\u001f]/g,'').trim().slice(0,16)||'Player';
export class RoomLobby {
  constructor({role,code,channel,id,name,map='somme',gameMode='tdm',botCount=0,botDifficulty='mixed',onChange,onApproved,onStart,onClosed,onLeave}){
    Object.assign(this,{role,code,channel,id,name:cleanName(name),onChange,onApproved,onStart,onClosed,onLeave});
    this.phase='waiting';this.config={map,gameMode,...cleanBotSettings({botCount,botDifficulty})};this.members=new Map();this.pending=new Map();
    this.owner=role==='host'?channel._wireId:null;this.epoch=role==='host'?nonce():null;
    this.rev=0;this.lastRev=-1;this.lastHost=Date.now();this.closed=false;this.launched=false;
    this.selfStatus=role==='host'?'approved':'pending';this.selfReady=false;this.readySeq=0;
    channel.lobby=this;
    this.timer=setInterval(()=>this.pulse(),1000);
    this.pulse();
  }
  send(data){if(!this.closed)this.channel.send(topic(this.code),JSON.stringify({v:1,k:'lobby',room:this.code,wire:this.channel._wireId,...data}));}
  pulse(){
    if(this.closed)return;
    if(this.role==='host'){
      const now=Date.now();let changed=false;
      if(this.phase==='waiting')for(const list of [this.members,this.pending])for(const [id,m]of list){
        if(now-m.seen>30000){list.delete(id);changed=true;}
      }
      if(changed)this.rev++;
      this.broadcast();if(changed)this.changed();
    }else{
      this.send({cmd:'request',id:this.id,name:this.name});
      if(this.phase==='waiting'&&this.readyIntent!==undefined)this.sendReady();
      if(Date.now()-this.lastHost>45000)this.end('timeout');
    }
  }
  receive(text,sender){
    let m;try{m=JSON.parse(text);}catch{return;}
    if(!m||m.k!=='lobby'||m.v!==1||m.room!==this.code||this.closed)return;
    sender=sender||m.wire;
    if(this.role==='host'){
      if(typeof m.id!=='string'||m.id.length>100||!sender)return;
      const member=this.members.get(m.id)||this.pending.get(m.id);
      if(member&&member.wire!==sender)return;
      if(m.cmd==='leave'){
        if(member){this.members.delete(m.id);this.pending.delete(m.id);this.onLeave?.(m.id);this.update();}return;
      }
      if(m.cmd==='request'){
        if(member){member.seen=Date.now();return;} // The host pulse already publishes state once per second.
        if(this.phase!=='waiting'){
          this.send({cmd:'denied',to:m.id,owner:this.owner,reason:'started'});return;
        }
        if(this.pending.size+this.members.size>=31){this.send({cmd:'denied',to:m.id,owner:this.owner,reason:'full'});return;}
        this.pending.set(m.id,{id:m.id,wire:sender,name:cleanName(m.name),seen:Date.now(),ready:false,readySeq:0});this.update();return;
      }
      if(m.cmd==='ready'&&this.phase==='waiting'&&this.members.has(m.id)){
        if(m.botConfig!==`${this.config.botCount}:${this.config.botDifficulty}`)return;
        if(!Number.isSafeInteger(m.seq)||m.seq<member.readySeq)return;
        if(m.seq===member.readySeq){this.broadcast();return;}
        member.ready=m.ready===true;member.readySeq=m.seq;member.seen=Date.now();this.update();
      }
      return; // Guests never choose the map/rules, approve themselves or start.
    }
    if(m.owner!==sender||(this.owner&&this.owner!==sender))return;
    if(m.cmd==='closed'){this.end('closed');return;}
    if(m.cmd==='denied'&&m.to===this.id){this.end(m.reason||'denied');return;}
    if(m.cmd!=='state'||typeof m.epoch!=='string'||!Number.isSafeInteger(m.rev)||!Array.isArray(m.members)||m.members.length>31||!m.members.every(p=>p&&typeof p.id==='string')||!['waiting','starting','started'].includes(m.phase)||typeof m.config?.map!=='string')return;
    if(this.epoch&&this.epoch!==m.epoch)return;
    if(m.rev<this.lastRev)return;
    this.owner=sender;this.epoch=m.epoch;this.lastRev=m.rev;this.lastHost=Date.now();
    if(this.config.botCount!==m.config.botCount||this.config.botDifficulty!==m.config.botDifficulty)this.readyIntent=undefined;
    this.phase=m.phase;this.config={...m.config,...cleanBotSettings(m.config)};this.hostName=m.hostName;
    this.members=new Map(m.members.map(p=>[p.id,p]));
    const own=this.members.get(this.id),was=this.selfStatus;
    this.selfStatus=own?'approved':'pending';this.selfReady=!!own?.ready;
    if(own?.readySeq===this.readySeq&&own.ready===this.readyIntent)this.readyIntent=undefined;
    this.changed();
    if(own&&was!=='approved')this.onApproved?.();
    if(own&&this.phase==='started'&&!this.launched){this.launched=true;this.onStart?.({...this.config},this.selection);}
  }
  approve(id){
    if(this.role!=='host'||this.phase!=='waiting')return false;
    const m=this.pending.get(id);if(!m)return false;
    this.pending.delete(id);this.members.set(id,m);this.update();return true;
  }
  reject(id){
    if(this.role!=='host'||!this.pending.has(id))return false;
    this.send({cmd:'denied',to:id,owner:this.owner,reason:'denied'});this.pending.delete(id);this.update();return true;
  }
  configure(config){
    if(this.role!=='host'||this.phase!=='waiting')return false;
    const bots=cleanBotSettings({...this.config,...config});
    if(bots.botCount!==this.config.botCount||bots.botDifficulty!==this.config.botDifficulty){
      for(const member of this.members.values())member.ready=false;
    }
    this.config={map:config.map??this.config.map,gameMode:config.gameMode??this.config.gameMode,...bots};
    this.update();return true;
  }
  ready(value,selection){
    if(this.role!=='guest'||this.phase!=='waiting'||this.selfStatus!=='approved')return false;
    this.selection=selection||this.selection;
    this.readyIntent=!!value;this.readySeq++;this.sendReady();return true;
  }
  sendReady(){this.send({cmd:'ready',id:this.id,ready:this.readyIntent,seq:this.readySeq,botConfig:`${this.config.botCount}:${this.config.botDifficulty}`});}
  get canStart(){return this.role==='host'&&this.phase==='waiting'&&[...this.members.values()].every(m=>m.ready);}
  start(){
    if(!this.canStart)return false;
    for(const id of this.pending.keys())this.send({cmd:'denied',to:id,owner:this.owner,reason:'started'});
    this.pending.clear();
    this.phase='starting';this.update();this.onStart?.({...this.config});return true;
  }
  started(){if(this.role==='host'&&this.phase==='starting'){this.phase='started';this.update();}}
  failed(){if(this.role==='host'&&this.phase==='starting'){this.phase='waiting';this.update();}}
  allows(id,sender){const m=this.members.get(id);return this.phase==='started'&&!!m&&m.wire===sender;}
  broadcast(){
    this.send({cmd:'state',owner:this.owner,epoch:this.epoch,rev:this.rev,phase:this.phase,config:this.config,hostName:this.name,
      members:[...this.members.values()].map(({id,name,ready,readySeq})=>({id,name,ready,readySeq}))});
  }
  update(){this.rev++;this.broadcast();this.changed();}
  changed(){this.onChange?.(this);}
  end(reason){if(this.closed)return;this.close(false);this.onClosed?.(reason);}
  close(notify=true){
    if(this.closed)return;
    if(notify)this.send(this.role==='host'?{cmd:'closed',owner:this.owner}:{cmd:'leave',id:this.id});
    this.closed=true;clearInterval(this.timer);if(this.channel.lobby===this)this.channel.lobby=null;
  }
}
