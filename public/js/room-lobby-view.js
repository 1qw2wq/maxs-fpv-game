import {t,nameOf} from './i18n.js';
import {BOT_DIFFICULTY_HINTS} from './bot-settings.js';
const el=id=>document.getElementById(id);
const text=(id,value)=>{if(el(id).textContent!==value)el(id).textContent=value;};
export function renderRoomLobby(lobby,hud,data){
  const active=!!lobby&&!lobby.closed;
  el('lobby-main').classList.toggle('hidden',!active);
  el('lobby-selection').classList.toggle('hidden',!active);
  hud.el.name.disabled=active;
  const guest=active&&lobby.role==='guest',locked=active&&(guest||lobby.phase!=='waiting');
  for(const b of el('map-row').querySelectorAll('button'))b.disabled=!!locked;
  el('game-mode').disabled=!!locked;
  hud.setBotsVisible(true);
  for(const b of hud.el.botCount.querySelectorAll('button'))b.disabled=!!locked;
  hud.el.multiBotCount.disabled=!!locked;hud.el.botDifficulty.disabled=!!locked;
  if(active){
    hud.el.multiBotCount.value=String(lobby.config.botCount);
    hud.el.botDifficulty.value=lobby.config.botDifficulty;
  }
  text('bot-difficulty-note',t(BOT_DIFFICULTY_HINTS[hud.el.botDifficulty.value]||BOT_DIFFICULTY_HINTS.mixed));
  hud.el.deploy.disabled=false;hud.el.deploy.textContent=t('部署');
  if(!active)return;
  el('lobby-code').textContent=lobby.code.replace(/(\d{4})(\d{4})/,'$1 $2');
  const map=nameOf(data.mapById[lobby.config.map]||{name:lobby.config.map});
  const ready=[...lobby.members.values()].filter(m=>m.ready).length;
  let status=guest&&lobby.selfStatus!=='approved'?t('申请已发送，等待房主接受。'):
    lobby.phase==='starting'?t('房主正在载入对局，所有玩家将自动进入。'):
    lobby.phase==='started'?t('对局已开始，正在进入。'):
    guest?t('选择角色后点击准备，等待房主开始。'):t('在主页面接受申请并选择地图；所有成员准备后开始。');
  status+=' · '+map+' · '+t('{ready}/{total} 位受邀玩家已准备',{ready,total:lobby.members.size});
  status+=' · '+t('AI：{n} · {level}',{n:lobby.config.botCount,level:hud.el.botDifficulty.selectedOptions[0]?.textContent||lobby.config.botDifficulty});
  text('lobby-status',status);text('lobby-selection-status',status);
  el('btn-lobby-invite').classList.toggle('hidden',guest);
  el('btn-lobby-copy').classList.toggle('hidden',guest);
  el('btn-lobby-choose').disabled=lobby.phase!=='waiting'||(guest&&lobby.selfStatus!=='approved');
  el('lobby-requests-heading').classList.toggle('hidden',guest);
  el('lobby-requests').classList.toggle('hidden',guest);
  const requests=el('lobby-requests');requests.replaceChildren();
  if(!guest){
    for(const request of lobby.pending.values()){
      const row=document.createElement('li'),label=document.createElement('span'),actions=document.createElement('div');
      label.textContent=request.name;actions.className='lobby-row-actions';
      for(const [action,text] of [['approve','接受'],['reject','拒绝']]){
        const b=document.createElement('button');b.type='button';b.className='ghost-btn small';
        b.dataset.lobbyAction=action;b.dataset.sid=request.id;b.textContent=t(text);b.setAttribute('aria-label',`${t(text)} ${request.name}`);actions.append(b);
      }
      row.append(label,actions);requests.append(row);
    }
    if(!requests.children.length){const row=document.createElement('li');row.textContent=t('暂无待处理申请');requests.append(row);}
  }
  for(const id of ['lobby-members','lobby-selection-members']){
    const list=el(id);list.replaceChildren();
    const host=document.createElement('li');host.textContent=`${t('房主')} · ${lobby.hostName||lobby.name}`;list.append(host);
    for(const m of lobby.members.values()){
      const row=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span');
      name.textContent=m.name;state.textContent=t(m.ready?'已准备':'选择角色中');row.append(name,state);list.append(row);
    }
  }
  hud.el.deploy.textContent=t(guest?(lobby.selfReady?'已准备，等待房主':'准备'): '开始游戏');
  hud.el.deploy.disabled=lobby.phase!=='waiting'||(guest?(lobby.selfStatus!=='approved'||lobby.selfReady):!lobby.canStart);
}
