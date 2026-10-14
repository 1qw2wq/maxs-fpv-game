// The API debug page: what this deployment actually is, and what works here.
//
// A static upload (Vercel and friends) answers /api/health, /api/rooms and
// /api/characters from files instead of a game server, runs the match inside
// the page, and connects players with no service at all. That is invisible from
// the outside, and it is exactly what goes wrong in the field: a page that
// looks the same whether the engine loaded, an endpoint answered, or a direct
// connection would work. This page says all of it in one place, with the raw
// JSON and a copyable report for when something needs reporting.
//
// It is deliberately independent of the game's own modules (except the tiny
// language helper): if main.js fails to boot, this page still has to be able to
// tell you why.

import { Peer, getStun, unpackCode } from './p2p.js';

const $ = (id) => document.getElementById(id);
const lang = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q) return q.startsWith('en') ? 'en' : 'zh';
    const saved = localStorage.getItem('tf.lang');
    if (saved) return saved.startsWith('en') ? 'en' : 'zh';
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch { return 'zh'; }
})();
const L = (zh, en) => (lang === 'en' ? en : zh);

const logLines = [];
function log(text) {
  logLines.push(`${new Date().toLocaleTimeString()}  ${text}`);
  if (logLines.length > 300) logLines.shift();
  const box = $('logs');
  if (box) { box.textContent = logLines.join('\n'); box.scrollTop = box.scrollHeight; }
}

function row(body, key, value, cls = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="k">${key}</td><td class="${cls}">${value}</td>`;
  body.appendChild(tr);
}

/** The API table's four columns: endpoint, status, time, what came back. */
function rowApi(body, path, status, ms, summary, cls = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="k"><code>${path}</code></td><td class="${cls}">${status}</td>`
    + `<td class="dim">${ms} ms</td><td class="note">${summary}</td>`;
  body.appendChild(tr);
}

function setStatic() {
  document.title = L('API 调试 · Trench Front', 'API debug · Trench Front');
  $('title').textContent = L('API 调试', 'API debug');
  $('subtitle').innerHTML = L(
    '这一页显示：本地打开的页面究竟在用什么引擎、<code>/api/*</code> 哪些答得上、联机通道走到哪一步。改完部署、朋友说"进不去"的时候，先看这里。',
    'What this deployment really is: which engine the page runs, which <code>/api/*</code> endpoints answer, and how far multiplayer gets. Look here first when a deploy misbehaves.',
  );
  $('run').textContent = L('重新探测', 'Probe again');
  $('p2p').textContent = L('自测直连（P2P）', 'Self-test direct link (P2P)');
  $('copy').textContent = L('复制报告', 'Copy report');
  $('clear').textContent = L('清空日志', 'Clear log');
  $('back').querySelector('button').textContent = L('回到游戏', 'Back to the game');
  $('h-env').textContent = L('这一页在什么环境里', 'What this page is running in');
  $('h-page').textContent = L('页面', 'Page');
  $('h-caps').textContent = L('浏览器能力', 'Browser capabilities');
  $('h-api').textContent = L('接口（/api/*）', 'Endpoints (/api/*)');
  $('h-api-1').textContent = L('接口', 'Endpoint');
  $('h-api-2').textContent = L('状态', 'Status');
  $('h-api-3').textContent = L('耗时', 'Time');
  $('h-api-4').textContent = L('返回', 'Answer');
  $('h-net').textContent = L('联机', 'Multiplayer');
  $('h-net-state').textContent = L('这一页的联机状态', 'Multiplayer state on this page');
  $('h-net-test').textContent = L('直连自测结果', 'Direct-link self-test');
  $('h-logs').textContent = L('日志', 'Log');
}

// ------------------------------------------------------------------ environment

function store(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function staticFacts() {
  const t = $('t-page');
  t.innerHTML = '';
  row(t, L('地址', 'Address'), location.href);
  row(t, L('来源（origin）', 'Origin'), location.origin + (location.protocol === 'https:' ? ' <span class="tag">https</span>' : ''));
  row(t, L('嵌在 iframe 里？', 'Inside an iframe?'),
    window.top === window.self ? L('不是（顶层页面）', 'No (top-level)') : L('是：鼠标锁定多半会被拒绝', 'Yes: capturing the mouse will likely be refused'),
    window.top === window.self ? 'ok' : 'bad');
  row(t, L('语言', 'Language'), lang === 'en' ? 'English' : '中文');
  row(t, L('历史里的房间', 'Rooms in history'), (() => {
    try {
      const p = JSON.parse(store('tf.profile') || '{}');
      const r = p.recentRooms || [];
      return r.length ? r.map((x) => (typeof x === 'string' ? x : x.code || '?')).join(', ') : L('（没有）', '(none)');
    } catch { return L('（读不出）', '(unreadable)'); }
  })());
  row(t, L('中转设置（?relay=）', 'Relay setting (?relay=)'),
    new URLSearchParams(location.search).get('relay') || store('tf.relay.broker') || L('（不用中转）', '(no relay)'));
  row(t, L('STUN（跨网络）', 'STUN (cross-network)'), getStun() || L('（关闭：只连同一网络）', '(off: same network only)'));
  row(t, L('userAgent', 'userAgent'), `<code>${navigator.userAgent}</code>`);
}

async function caps() {
  const t = $('t-caps');
  t.innerHTML = '';
  const has = (name, ok, note = '') => row(t, name, ok ? L('可以', 'yes') : L('不行', 'no') + (note ? ` · ${note}` : ''), ok ? 'ok' : 'bad');
  has('localStorage', (() => { try { localStorage.setItem('tf.dbg', '1'); localStorage.removeItem('tf.dbg'); return true; } catch { return false; } })());
  has('WebAssembly（页面内引擎要用）', typeof WebAssembly === 'object');
  has('BroadcastChannel（同一浏览器多开标签页）', typeof BroadcastChannel === 'function');
  has('RTCPeerConnection（跨电脑直连）', typeof RTCPeerConnection === 'function');
  has('CompressionStream（邀请码压缩）', typeof CompressionStream === 'function');
  has('DecompressionStream（解析邀请码）', typeof DecompressionStream === 'function');
  has('WebSocket', typeof WebSocket === 'function');
  has('navigator.clipboard', !!(navigator.clipboard && navigator.clipboard.writeText));
  let gl = 'none';
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (g) {
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      gl = dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.VERSION);
    }
  } catch { gl = 'error'; }
  has(L('WebGL（3D 视图要用）', 'WebGL (the 3D view)'), gl !== 'none' && gl !== 'error', String(gl).slice(0, 60));
  // Pointer lock: requestable here, but whether the *browser* grants it depends
  // on the embedding; the badge above is the honest answer.
  has('requestPointerLock', typeof document.body.requestPointerLock === 'function');
  row(t, L('CPU 线程 / 设备内存', 'CPU threads / device memory'),
    `${navigator.hardwareConcurrency || '?'} / ${navigator.deviceMemory || '?'}`);
}

// ------------------------------------------------------------------- endpoints

const ENDPOINTS = ['api/health', 'api/rooms', 'api/characters'];

async function probeApi() {
  const t = $('t-api');
  t.innerHTML = '';
  const report = {};
  for (const path of ENDPOINTS) {
    const t0 = performance.now();
    let status = '—';
    let body = null;
    let text = '';
    try {
      const res = await fetch(path, { cache: 'no-store' });
      status = res.status;
      text = await res.text();
      try { body = JSON.parse(text); } catch { body = null; }
    } catch (err) {
      status = 'error';
      text = String(err);
    }
    const ms = Math.round(performance.now() - t0);
    const looksStatic = !!body?.note && status === 200;
    report[path] = { status, ms, body };
    const summary = body
      ? (looksStatic ? `<span class="tag">${L('静态文件', 'static file')}</span> ${String(body.note).slice(0, 150)}…`
        : `<code>${JSON.stringify(body).slice(0, 220)}</code>`)
      : `<code>${text.slice(0, 200)}</code>`;
    const cls = status === 200 ? 'ok' : 'bad';
    rowApi(t, path, status, ms, summary, cls);
    log(`${path} -> ${status} (${ms} ms)`);
  }
  return report;
}

// ---------------------------------------------------------------- multiplayer

function netState() {
  const t = $('t-net');
  t.innerHTML = '';
  const g = window.__trench;
  const app = g?.app;
  if (!app) {
    row(t, L('游戏脚本', 'Game script'), L('没有加载（main.js 没跑起来）', 'not loaded (main.js did not run)'), 'bad');
    row(t, L('怎么办', 'What to do'), L('刷新页面；若仍然如此，看浏览器控制台的报错（多半是缓存或部署缺文件）。',
      'Reload; if it stays like this, check the browser console (usually a cache or a missing file in the deploy).'));
    return;
  }
  const engine = app.localEngine === true ? L('页面内引擎（Pyodide，静态托管）', 'in-page engine (Pyodide, static hosting)')
    : app.backendHere === true ? L('本站后端（/api/health 是服务器）', 'a real server on this origin')
      : app.localEngine === false ? L('还没有探测完', 'still probing') : '?';
  row(t, L('引擎', 'Engine'), engine, app.localEngine ? 'ok' : '');
  row(t, L('房间模式', 'Room mode'), app.roomMode || '—');
  row(t, L('本机是不是房主', 'Hosting here?'),
    app.relayHostCode ? `<code>${app.relayHostCode}</code>` : L('不是', 'no'));
  row(t, L('联机通道', 'Transport'),
    app.relayKind ? `${app.relayKind} <span class="dim">${app.relayLabel || ''}</span>` : L('（还没开）', '(not open)'));
  const peers = app.net?.peers ?? 0;
  row(t, L('直连的其他电脑', 'Other computers connected directly'), String(peers), peers ? 'ok' : '');
  if (app.playing) row(t, L('对局', 'Match'), `${app.mapId || '?'} · ${app.paused ? L('已暂停', 'paused') : L('进行中', 'running')}`);
}

// ------------------------------------------------------- the P2P self-test

/**
 * Two connections inside this one page: an offer and an answer, the same two
 * steps a real pair of players does by hand. It proves this browser and this
 * network can make a direct connection at all, without involving anyone else.
 */
async function p2pSelfTest() {
  const btn = $('p2p');
  const t = $('t-p2p');
  t.innerHTML = '';
  btn.disabled = true;
  row(t, L('状态', 'State'), L('正在自测…', 'running…'));
  log('P2P self-test: building an offer');
  const t0 = performance.now();
  let host = null;
  let guest = null;
  try {
    const hostGot = [];
    const guestGot = [];
    host = new Peer({ onMessage: (text) => hostGot.push(text) });
    const invite = await host.createOffer('00000000');
    const offerMs = Math.round(performance.now() - t0);
    t.innerHTML = '';
    row(t, L('邀请码长度', 'Invite code length'), `${invite.length} ${L('字符', 'characters')}`,
      invite.length < 3000 ? 'ok' : 'bad');
    row(t, L('生成邀请码耗时', 'Offer time'), `${offerMs} ms`);
    log(`P2P self-test: invite ${invite.length} chars in ${offerMs} ms`);

    guest = new Peer({ onMessage: (text) => guestGot.push(text) });
    const answer = await guest.acceptOffer(await unpackCode('TFi1.', invite));
    row(t, L('回答码长度', 'Answer code length'), `${answer.length} ${L('字符', 'characters')}`);
    await host.acceptAnswer(await unpackCode('TFa1.', answer));

    const opened = await new Promise((resolve) => {
      const started = performance.now();
      const poll = setInterval(() => {
        if (host.open && guest.open) { clearInterval(poll); resolve(performance.now()); }
        else if (performance.now() - started > 12000) { clearInterval(poll); resolve(0); }
      }, 120);
    });
    if (!opened) {
      row(t, L('结果', 'Result'), L('连不上：两条连接没能建立（同一台电脑自测本该成功，真实对局还受网络影响）',
        'Could not connect (this should work on one machine; a real match also depends on the network)'), 'bad');
      log('P2P self-test: FAILED to open');
      return;
    }
    row(t, L('握手 + 连接总耗时', 'Handshake + connect'), `${Math.round(opened - t0)} ms`, 'ok');

    host.send('ping-from-host');
    guest.send('ping-from-guest');
    await new Promise((r) => setTimeout(r, 900));
    const okHost = hostGot.includes('ping-from-guest');
    const okGuest = guestGot.includes('ping-from-host');
    row(t, L('双向收发', 'Both directions'), okHost && okGuest
      ? L('通了（来回各一条消息）', 'works (one message each way)')
      : L(`失败了：host 收到 ${hostGot.length} 条、guest 收到 ${guestGot.length} 条`,
        `failed: host got ${hostGot.length}, guest got ${guestGot.length}`), okHost && okGuest ? 'ok' : 'bad');
    row(t, L('说明', 'Note'), L('这里没有用任何服务器；真实对局用的就是同一条通道，只是邀请码由你们两个人手工传递。',
      'No server was involved; a real match uses exactly this channel, with the two codes passed between the players by hand.'));
    log(`P2P self-test: both directions ${okHost && okGuest ? 'ok' : 'FAILED'}`);
  } catch (err) {
    row(t, L('结果', 'Result'), String(err?.message || err), 'bad');
    log('P2P self-test error: ' + err);
  } finally {
    try { host?.close(); } catch { /* gone */ }
    try { guest?.close(); } catch { /* gone */ }
    btn.disabled = false;
  }
}

// -------------------------------------------------------------------- report

let lastReport = {};

function buildReport(api) {
  const caps = {};
  for (const tr of $('t-caps').querySelectorAll('tr')) caps[tr.children[0].textContent] = tr.children[1].textContent;
  return {
    when: new Date().toISOString(),
    url: location.href,
    lang,
    inIframe: window.top !== window.self,
    userAgent: navigator.userAgent,
    capabilities: caps,
    api,
    multiplayer: {
      hosting: window.__trench?.app?.relayHostCode || '',
      kind: window.__trench?.app?.relayKind || '',
      engine: window.__trench?.app?.localEngine ?? null,
      stun: getStun(),
    },
    log: logLines.slice(-60),
  };
}

async function runAll() {
  log('---- probe ----');
  setStatic();
  staticFacts();
  await caps();
  lastReport.api = await probeApi();
  netState();
  log('---- done ----');
}

$('run').addEventListener('click', () => runAll().catch((e) => log('probe failed: ' + e)));
$('p2p').addEventListener('click', () => p2pSelfTest().catch((e) => log('p2p failed: ' + e)));
$('clear').addEventListener('click', () => { logLines.length = 0; $('logs').textContent = ''; });
$('copy').addEventListener('click', async () => {
  const text = JSON.stringify(buildReport(lastReport.api || {}), null, 2);
  try { await navigator.clipboard.writeText(text); log('report copied (' + text.length + ' chars)'); }
  catch {
    const box = $('logs');
    box.textContent = text;
    log('clipboard refused: the report is in the log box above, select and copy it');
  }
});
// A small live view of the game's own state, if it did load.
setInterval(() => { if (window.__trench?.app) netState(); }, 3000);

setStatic();
runAll().catch((e) => log('probe failed: ' + e));
log('debug page ready');
