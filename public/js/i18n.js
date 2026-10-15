// Bilingual UI (简体中文 / English).
//
// The game is written in Chinese and that stays the source language: every
// string in this dictionary is keyed by its own Chinese text, so a translation
// is one line here and a call site becomes `t('...')`. Nothing has to be
// renamed, and a string with no entry simply stays Chinese instead of turning
// into a raw key on screen.
//
// Two ways in, deliberately:
//   * code -- t('无法连接服务器（{host}）', { host }) for anything JS builds,
//   * the page -- applyDom() walks the static markup once per language and
//     swaps text nodes and placeholder/title attributes whose whole content is
//     a key. That covers index.html without tagging every element, and the
//     original Chinese is kept per node so switching back is exact.
//
// Weapon, class, team and map names come from /shared/*.json instead: those
// carry their own *En fields (nameEn, roleEn, descEn, ...) and the accessors
// below pick the right one -- see nameOf()/descOf(). A data file that has not
// been translated yet falls back to the Chinese field rather than blanking out.

import { store } from './storage.js';

const CJK = /[\u4e00-\u9fff]/;

// ------------------------------------------------------------------ dictionary
//
// Placeholders are {name} and are filled from the object passed to t().
const EN = {
  'Enter · 8 位房号': 'Enter · 8-digit room code',
  '按 Enter 完成教程并返回主菜单。': 'Press Enter to finish the tutorial and return to the menu.',
  '游戏规则': 'Match rules',
  '团队死斗': 'Team deathmatch',
  '据点控制': 'Point control',
  '联机对战 · 与真人同场竞技': 'Online matches · play with real people',
  '据点控制：占领全部 A / B / C，并连续守住 15 秒获胜；双方同时在圈内会阻止占领。加入房间时遵循房主规则。': 'Point control: capture A / B / C and hold them all for 15 seconds. Both teams inside a circle contest it. Joining a room uses the host’s rules.',
  '争夺中': 'CONTESTED',
  '占领中': 'CAPTURING',
  '中立化中': 'NEUTRALIZING',
  '中立': 'NEUTRAL',
  '已占领': 'CONTROLLED',
  '占领全部据点并守住 {n} 秒': 'Capture every point, then hold all for {n}s',
  '全点控制：守住 {n} 秒即可获胜': 'All points controlled · hold for {n}s to win',
  '无法锁定鼠标时，点击画面重试或在新标签页打开；游戏只使用原生鼠标锁定。': 'If capture is denied, click to retry or open a new tab. Mouse look uses native pointer lock only.',
  '⑧ 手榴弹': '⑧ Grenades',
  'B · 按住 G': 'B · Hold G',
  '按 B 切换手榴弹，按住 G 蓄力，再松开投掷。预览会显示重力和反弹。': 'Press B to cycle grenades, hold G to charge, then release to throw. The preview includes gravity and bounces.',
  '破片爆炸、燃烧留火、烟雾遮挡、闪光致盲；2 发共享，耗尽后 24 秒补满。Q 技能独立。': 'Frag blasts, incendiary burns, smoke obscures, flash blinds. Two shared charges refill after 24s; Q has its own inventory. Stay out of your own fire.',
  '⑨ 据点控制': '⑨ Point control',
  '跟随顶部方向与距离提示，进入任一据点的地面圆圈，停留到占领完成。': 'Follow the direction and distance above. Enter any marked circle and remain until capture completes.',
  '无人争夺时单人 5 秒占领，两人更快；敌方据点先中立化再占领。守住全部据点 15 秒获胜；敌方进入会打断。': 'Solo capture takes 5s uncontested; two players capture faster. Neutralize enemy points before capturing. Hold all for 15s to win; enemy pressure interrupts it.',
  '⑩ 战场信息': '⑩ Battlefield info',
  '死斗先到 75 击杀；据点模式需要守住全点。时间结束按击杀或据点数量判胜，数量相同则平局。': 'Deathmatch is first to 75 kills; point control requires all flags. At timeout, most kills or owned points wins; equal scores draw.',
  '⑪ 联机：房号': '⑪ Online: room codes',

  '投掷力度 {n}%': 'Throw power {n}%',
  '补充倒计时 {n}秒': 'Resupply in {n}s',
  '按住 G 投掷 · B 切换': 'Hold G to throw · B to cycle',
  '手榴弹补充中': 'Grenades resupplying',
  '遭受燃烧伤害': 'Taking fire damage',
  '破片手榴弹': 'Frag grenade',
  '燃烧弹': 'Incendiary grenade',
  '闪光弹': 'Flash grenade',

  // ---------------------------------------------------------------- document
  '堑壕前线': 'Trench Front',
  '堑壕前线 Trench Front': 'Trench Front',
  '1916 · 索姆河无人区 · 团队死斗': '1916 · Somme No Man\'s Land · Team Deathmatch',
  '正在装载战场数据…': 'Loading battlefield data…',
  '正在装载地图…': 'Loading map…',

  // -------------------------------------------------------------- main menu
  '代号': 'Callsign',
  '输入你的名字': 'Enter your name',
  '服务器地址无效：{text}': 'Not a valid server address: {text}',
  '请输入房主给你的 8 位房号（例如 1234 5678）': 'Enter the 8-digit code the host gave you (e.g. 1234 5678)',
  '服务器地址': 'Server address',
  '留空 = 自动（当前页面地址）': 'Empty = automatic (this page\'s address)',
  '局域网联机：房主运行服务端，把终端打印的 http://<局域网IP>:端口 发给同学，用浏览器打开即可加入；连不上时可在这里手动填写地址':
    'LAN play: the host shares the http://<LAN IP>:port the server prints — everyone just opens that address.',
  '联机房间': 'Room',
  '创建房间': 'Create room',
  '输入房号加入': 'Join with code',
  '创建房间后会生成 8 位房号：发给朋友，朋友选「输入房号加入」就能进同一局（单人模式无需房号）':
    'Creating a room prints an 8-digit code: send it out and friends pick "Join with code". Solo needs none.',
  '8 位房号，例如 1234 5678': '8-digit code, e.g. 1234 5678',
  '房号': 'Room code',
  '点击复制房号': 'Click to copy the room code',
  '复制': 'Copy',
  '已复制': 'Copied',
  '复制失败': 'Copy failed',
  '（用房号加入，房号请向房主要）': ' (join with a code; ask the host for theirs)',
  '当前没有别人开的房间：点「创建房间」你就是房主': 'Nobody else has a room open — create one and you are the host',
  '在线房间 {n} 个 · 可加入 {join} 个': '{n} room(s) online · {join} joinable',
  '输入房主给你的 8 位房号即可加入同一局；房号错一位都会进不去': 'The 8-digit code the host gave you. One wrong digit and there is no such room.',
  '输入房主给你的 8 位房号即可加入（网页版：对局在房主的浏览器里运行；点邀请链接也能自动填好房号）':
    'Enter the 8-digit code the host gave you (web version: the match runs in the host\'s browser, and an invite link fills this in for you)',
  '网页版联机：点「创建房间」你就是房主，这一局在你的浏览器里运行；部署后点右上角房号可复制邀请链接发给朋友（完全不需要服务器）':
    'Web multiplayer: hit "Create room" and you are the host — the match runs in your browser. After deploying, click the room code in the top-right corner to copy an invite link for your friends (no server needed at all).',
  '士兵': 'Soldier',
  'AI 数量': 'AI count',
  '单人模式固定开启 AI 机器人；多人模式仅限真人玩家': 'Solo always has AI bots; multiplayer is humans only',
  '选择地图': 'Map',
  '多人模式': 'Multiplayer',
  '多人模式仅限真人玩家，不含 AI 机器人 · 同一台机器多开两个标签页也能对战':
    'Humans only, no AI · two tabs can fight',
  '联机团队死斗 · 与真人同场竞技': 'Team deathmatch vs people',
  '单人模式': 'Solo',
  '与 AI 队友并肩，对抗 AI 敌军': 'You and AI allies vs AI',
  '设置模式': 'Setup',
  '导入 / 上传角色模型与骨架': 'Import and share models',
  '新手指引': 'Tutorial',
  '学习移动 / 手榴弹 / 据点控制 / 联机': 'Movement, grenades, flags and multiplayer',
  '第一次玩？从这里开始 · 学会手榴弹与据点控制': 'First time? Start here',
  '操作：WASD 移动 · Shift 蹲下 · Space 跳 · 左键开火 · 右键瞄准 · R 换弹 · Q 技能 · G 蓄力投掷 · B 切换手榴弹 · V 切换视角 · Tab 战绩 · Esc 暂停菜单':
    'WASD move · Shift crouch · Space jump · LMB fire · RMB aim · R reload · Q ability · hold G throw · B grenade type · V camera · Tab scoreboard · Esc pause',
  '角色出现白块 / 黑块（头发、衣服、鞋子变色）？': 'Character pieces showing up white or black (hair, clothes, shoes discoloured)?',
  '打开颜色修复者 ColorFixer': 'Open the ColorFixer tool',

  // ------------------------------------------------------------- class/weapon
  '选择你的兵种': 'Choose your class',
  '堑壕里的每个人都有位置 —— 挑一个，然后活下去。': 'Everyone in the trench has a post — pick one and stay alive.',
  '主武器': 'Primary weapon',
  '返回': 'Back',
  '队伍将自动平衡': 'Teams are balanced automatically',
  '部署': 'Deploy',
  '机动': 'Mobility',
  '伤害': 'Damage',
  '射速': 'Rate',
  '弹匣': 'Magazine',
  '精准': 'Accuracy',
  '射程': 'Range',
  '全自动': 'Full-auto',
  '半自动/栓动': 'Semi / bolt',
  '{a}-{b}m 躯干致命': 'Lethal to the torso {a}-{b}m',

  // ------------------------------------------------------- setup / character
  '设置模式 · 角色模型与骨架': 'Setup · character models and rigs',
  '导入带蒙皮的 glTF/GLB，把模型骨骼映射到游戏关节，微调后上传即可全场共享。':
    'Import a skinned glTF/GLB, map its bones onto the game\'s joints, fine-tune the offsets and upload it to share with everyone.',
  '播放走路': 'Play walk',
  '高度 —': 'Height —',
  '高度 {h} m': 'Height {h} m',
  '模型文件': 'Model file',
  '尚未导入模型。仅支持未压缩的 glTF/GLB（不支持 Draco / meshopt）。':
    'No model imported yet. Uncompressed glTF/GLB only (no Draco / meshopt).',
  '角色名': 'Character name',
  '给你的角色起个名字': 'Name your character',
  '缩放': 'Scale',
  '朝向': 'Facing',
  '骨骼映射': 'Bone mapping',
  '骨骼偏移微调 ·': 'Offset tuning ·',
  '髋部': 'Hips',
  '脊柱': 'Spine',
  '头部': 'Head',
  '左肩': 'Left shoulder',
  '右肩': 'Right shoulder',
  '左肘': 'Left elbow',
  '右肘': 'Right elbow',
  '左手': 'Left hand',
  '右手': 'Right hand',
  '左膝': 'Left knee',
  '右膝': 'Right knee',
  '左脚': 'Left foot',
  '右脚': 'Right foot',
  '共享角色（所有人可用）': 'Shared characters (available to everyone)',
  '本地存档（只存在这台电脑上）': 'Local save (this computer only)',
  '导出存档': 'Export save',
  '清空本机数据': 'Clear local data',
  '返回主页': 'Back to menu',
  '重置': 'Reset',
  '仅本地保存': 'Save locally',
  '上传共享': 'Upload & share',
  '使用中': 'In use',
  '使用': 'Use',
  '下载': 'Download',
  '— 未映射 —': '— unassigned —',
  '无法读取文件': 'Could not read the file',
  '模型解析失败（不支持 Draco / meshopt 压缩）': 'Could not parse the model (Draco / meshopt compression is not supported)',
  '正在解析模型…': 'Parsing the model…',
  '这个模型没有骨骼（不是蒙皮模型），无法用于角色替换。':
    'This model has no skeleton (it is not skinned), so it cannot replace a character.',
  '映射与偏移已保存在本机浏览器。要跨设备使用请点「上传共享」。':
    'Bone mapping and offsets are saved in this browser. Use "Upload & share" to make it available everywhere.',
  '请先导入模型文件，再上传共享。': 'Import a model file first, then upload.',
  '至少映射一个关节再上传。': 'Map at least one joint before uploading.',
  '自定义角色': 'Custom character',
  '正在上传…': 'Uploading…',
  '上传成功，服务器编号 {id}，现在所有玩家都能选用它。': 'Uploaded as server id {id} — every player can pick it now.',
  '上传失败：{why}': 'Upload failed: {why}',
  '共享角色需要一台带服务端的部署（Render / Docker 跑 server/server.py），或在菜单里填上那台服务器的地址。':
    'Shared uploads need a deployment that runs a server (Render / Docker with server/server.py), or that server\'s address typed in the menu.',
  '这台托管只提供静态文件。': 'this host only serves static files.',
  '已重置。请重新导入模型。': 'Reset. Import a model again.',
  '还没有人上传角色': 'Nobody has uploaded a character yet',
  '无法连接服务器，暂时看不到共享角色': 'No server connection, so shared characters are unavailable',
  '当前角色：{name}': 'Current character: {name}',
  '已选用「{name}」。对局中其他玩家会看到这个模型；想再改就先导入同一个文件。':
    'Now using "{name}". Other players will see this model in a match; import the same file again to tweak it.',
  '已导入 {bones} 根骨骼，自动匹配 {joints} 个关节。肩肘手为静止姿态，请用偏移滑杆调整持枪姿势。':
    'Imported {bones} bones and matched {joints} joints. Shoulders, elbows and hands stay at rest — use the offset sliders to pose the weapon hold.',
  '预览失败：{why}': 'Preview failed: {why}',

  // ------------------------------------------------------------------- HUD
  '本局阵营：<b style="color:{color}">{team}</b>': 'Your side: <b style="color:{color}">{team}</b>',
  '协约国': 'Entente',
  '同盟国': 'Central Powers',
  '{team} 胜利': '{team} wins',
  '平局': 'Draw',
  '点击画面继续战斗': 'Click the screen to keep fighting',
  '鼠标将被锁定 · 按 Esc 释放': 'The mouse will be locked · press Esc to release',
  '说点什么…  Enter 发送 · Esc 取消': 'Say something…  Enter to send · Esc to cancel',
  '换弹中': 'Reloading',
  '你阵亡了': 'You were killed',
  '被 <b>{killer}</b> 用 {weapon} 击倒': 'Killed by <b>{killer}</b> with the {weapon}',
  '被击倒': 'You were killed',
  '秒后可重新部署': 's until you can redeploy',
  '重新部署': 'Redeploy',
  '重新部署 ({s})': 'Redeploy ({s})',
  '重新部署 · {cls}': 'Redeploy · {cls}',
  '阵亡期间可更换兵种与武器': 'Change class and weapon while you wait',
  '可以重新部署了': 'You can redeploy now',
  '战场战绩': 'Scoreboard',
  '10 秒后开始新的一局': 'Next round in 10 seconds',
  '遭受爆炸冲击': 'Blast wave',
  '爆头击杀！': 'Headshot kill!',
  '击杀 +1': 'Kill +1',
  'AI 机器人已加入战场': 'AI bots have joined the battle',
  '第三人称视角': 'Third-person view',
  '第一人称视角': 'First-person view',
  '光标已释放': 'Mouse handed back',
  '鼠标锁定失败：点击画面重试；若预览禁止锁定，请在新标签页打开':
    'Mouse lock failed: click the view to retry; if the preview blocks locking, open the game in a new tab',

  '回答码已生成，房号 {code}：发回房主完成配对；连接成功后再部署':
    'Answer ready for room {code}: send it back to the host to finish pairing; deploy after the connection opens',

  '直连已断开：请让房主生成新的邀请码并重新配对':
    'Direct connection lost: ask the host for a new invite and pair again',

  // ------------------------------------------------------------ net / rooms
  '无法连接服务器': 'Cannot reach the server',
  '无法连接服务器（{host}）': 'Cannot reach the server ({host})',
  '无法连接服务器（{hosts}）· {hint}': 'Cannot reach the server ({hosts}) · {hint}',
  '连接出错': 'Connection error',
  'WebSocket 超时': 'WebSocket timed out',
  '与服务器断开连接': 'Disconnected from the server',
  '与房主断开连接：回主菜单用同一个房号重新加入即可':
    'Disconnected from the host: go back to the menu and rejoin with the same room code',
  '服务器已满': 'The server is full',
  '无法加入该房间': 'Could not join that room',
  '房号不存在：请向房主要正确房号（8 位数字），或自己创建房间':
    'No such room: ask the host for the right 8-digit code, or create your own',
  '该房间已满员，换一个房间或自己创建': 'That room is full — pick another one or create your own',
  '服务器上房间太多了，稍后再试': 'The server has too many rooms right now, try again shortly',
  '当前是静态托管：对局将由浏览器内嵌引擎运行（单机 + 机器人，无需服务器）。想联机就在下方「服务器地址」填入后端地址（例如 your-app.onrender.com），或按 README「部署」用 Render / Docker 整体部署':
    'This is a static deployment: matches run in the engine embedded in this page (solo + bots, no server needed). To play online, put a server address in the box above (e.g. your-app.onrender.com), or deploy the whole thing with Render / Docker as the README describes.',
  '连不上 {primary}，已改用本页面的服务器（{host}）': 'Could not reach {primary}, using this page\'s own server instead ({host})',
  '静态托管：对局由浏览器内嵌引擎运行（单机 + 机器人，无需服务器）':
    'Static deployment: matches run in the engine embedded in this page (solo + bots, no server needed)',
  '本环境不支持 WebSocket，已改用 HTTP 轮询传输（对局照常）':
    'WebSocket is unavailable here, falling back to HTTP polling (the match carries on)',
  '浏览器内引擎': 'in-page engine',
  '浏览器内引擎无法开局': 'The in-page engine could not start the match',
  '正在加载浏览器内引擎（首次约 12 MB，之后有缓存）…': 'Loading the in-page engine (about 12 MB the first time, cached after)…',
  '正在装载战场数据…（本地引擎）': 'Loading battlefield data… (local engine)',
  '正在启动引擎…': 'Starting the engine…',
  '嵌入引擎不可用（{url}）：{why}': 'The embedded engine is unavailable ({url}): {why}',
  '已取消': 'Cancelled',
  '已加入房间 {code}': 'Joined room {code}',
  '正在连接公共中转服务器…': 'Connecting to a public relay…',
  '没有可用的联机通道（公共中转与本地标签页都不可用）':
    'No way to reach the other players: neither a public relay nor this browser\'s own tabs are available',
  '缺少房号': 'No room code was given',
  '与房主失去联系（房主关掉了页面？）': 'Lost contact with the host (did they close the page?)',
  '与房主中断了一下，正在自动重新加入…': 'The room lost track of you for a moment — rejoining automatically…',
  '房主那边暂停了（可能切走了标签页）…恢复后会自动继续':
    'The host is paused (they may have switched tabs)… the match continues by itself once they are back',
  '房主回来了，继续战斗': 'The host is back — carry on',
  '房主那边暂时没有声音了，正在等它回来…（画面会停住）':
    'The host has gone quiet — waiting for it to come back… (the world is frozen)',
  '与房主失去联系（长时间没有动作，或切走了标签页）：回主菜单用同一个房号重进即可':
    'Lost contact with the host (you were idle for a long time, or the tab was put in the background): go back to the menu and rejoin with the same room code.',
  '房号 {code} 没有人在主持（或房主刚离开）': 'Nobody is hosting room {code} (or the host just left)',
  '中转连接已断开：其他人将收不到这一局': 'The relay dropped: nobody else will receive this match',
  '中转连接已断开：其他人暂时收不到这一局，正在重连…':
    'The relay dropped: nobody else can reach this match for the moment — reconnecting…',
  '中转已连回来，别人现在能收到这一局了': 'The relay is back — the others can reach this match again',
  '中转一直连不上：你自己还能打，别人暂时进不来':
    'The relay will not come back: you can keep playing, but nobody else can join until it does',
  '联机通道断了，正在自动重连…': 'The relay dropped — reconnecting automatically…',
  '已经重新接上，继续战斗': 'Reconnected — carry on',
  '很久没有房主的消息了，正在重新连接确认…': 'Nothing from the host for a long while — reconnecting to find out…',
  '本机房主（浏览器内引擎 + 公共中转）': 'Hosting from this browser (in-page engine + public relay)',
  '公共中转 · 房号 {code}': 'Public relay · room {code}',
  '公共中转（房主在本机运行对局）': 'public relay (the host runs the match in their browser)',
  '没连上公共中转：同一浏览器多开标签页照样能对战':
    'No public relay reachable: two tabs of this browser can still play each other',
  '已通过公共中转加入房间（房主：{host}）': 'Joined over the public relay (host: {host})',
  '房主模式：这一局在你这里运行，把房号发给朋友 · 中转 {host}':
    'Hosting: this match runs in your browser — send the room code to your friends · relay {host}',
  '静态托管：单机与多人都不需要服务器——点「创建房间」你就是房主：把 8 位房号发给朋友（同一浏览器多开标签页即可进），或用「邀请朋友」的邀请码让另一台电脑直连过来。':
    'Static hosting: neither solo nor multiplayer needs a server - hit "Create room" and you are the host: send the 8-digit code to your friends (extra tabs of this browser can join with it), or use an "Invite a friend" code so another computer connects straight to you.',
  '连不上服务器：单机可以在这里直接开打（引擎在页面里跑），多人则点「创建房间」，把 8 位房号发给朋友（同一个浏览器多开标签页），或用「邀请朋友」的邀请码跨电脑直连——房主的浏览器运行整局，不经过任何服务器。想用自建服务端，就在下方「服务器地址」填后端地址（例如 your-app.onrender.com）。':
    'Cannot reach a server: solo plays right here (the engine runs in this page); for multiplayer hit "Create room" and send the 8-digit code to your friends (extra tabs), or use an "Invite a friend" code to connect another computer straight to you - the host\'s browser runs the whole match, with no server involved. To use a server of your own, put its address in the box below (e.g. your-app.onrender.com).',
  '邀请链接里的房号 {code} 已填好，进战场就是加入这一局':
    'The invite link carried room {code} — deploying now joins that match',
  '邀请链接已复制：朋友打开就是加入房号 {code}':
    'Invite link copied: opening it joins room {code}',
  '房号：{code}（把这一串发给朋友，他们在「输入房号加入」里填）':
    'Room code: {code} (send this to your friends; they enter it under "join with a code")',
  '（其中 {p} 个由玩家浏览器主持）': ' ({p} of them hosted by a player\'s browser)',
  '房间已创建 · 房号 {code}': 'Room created · code {code}',
  '阵营：{team}': 'Team: {team}',
  '「{want}」正被其他房间占用，本局是「{got}」': '"{want}" is taken by another room, so this round is on "{got}"',
  '地图切换：{name}': 'Map change: {name}',
  '正在装载地图 · {name}': 'Loading map · {name}',
  '战场数据载入失败：{why}': 'Could not load the battlefield data: {why}',
  '无法创建 3D 画面（WebGL）：{why}': 'Could not create the 3D view (WebGL): {why}',
  '显卡上下文丢失，正在尝试恢复…': 'Graphics context lost, trying to recover…',
  '请在浏览器设置里打开「使用硬件加速」「使用图形加速」后重开页面；若仍不行，换 Chrome / Edge / Firefox 试试。':
    'Turn on hardware/graphics acceleration in the browser settings and reload; if it still fails, try Chrome / Edge / Firefox.',
  '请确认服务端已启动，并且这个页面是从服务端地址打开的（http://…，不是直接双击 html 文件）。':
    'Check that the server is running and that this page was opened from its address (http://…, not by double-clicking the html file).',

  '跳过教程': 'Skip tutorial',
  '进入战场开始练习': 'Deploy and practise',
  '完成了，去联机': 'Done — take me online',
  '✔ {step} 完成 · 下一步：{next}': '✔ {step} done · next up: {next}',

  // --------------------------------------------------------------- tutorial
  '① 移动': '① Movement',
  '按住 W A S D 走动，方向跟着你的准星走。': 'Hold W A S D to move; you go where you are looking.',
  'Shift 蹲下能从低矮的坑道里钻过去，收益是更小的暴露面积。': 'Shift crouches, which fits through low tunnels and makes you a smaller target.',
  '② 视角': '② Looking around',
  '鼠标': 'Mouse',
  '点击画面锁定鼠标，然后移动鼠标环顾四周；按 Esc 释放。':
    'Click the view to lock the mouse, then move it to look around; press Esc to release.',
  '③ 开火': '③ Firing',
  '左键': 'LMB',
  '按住鼠标左键开火：全自动武器按住就是连发。': 'Hold the left button to fire; automatic weapons keep going while held.',
  '子弹是从枪口出来的，贴着掩体射击容易被自己人挡住。': 'Bullets leave the muzzle: shooting from right behind cover can hit your own side.',
  '④ 机瞄': '④ Aiming down sights',
  '右键': 'RMB',
  '按住鼠标右键抬枪 / 开镜：散射更小、视野更窄，远距离必须这么打。':
    'Hold the right button to raise the gun: less spread, tighter view — needed at range.',
  '栓动步枪除曼利夏 M95 之外，开镜期间是无法拉栓上膛的。': 'Bolt rifles (except the straight-pull M95) cannot cycle while scoped.',
  '⑤ 换弹': '⑤ Reloading',
  '按 R 换弹。弹匣空了会自动换，但主动换弹更安全。': 'Press R to reload — a dry magazine reloads itself, but early is safer.',
  '换弹时左下角会显示进度条，被打断会重新开始。': 'A progress bar shows in the corner; an interrupted reload starts over.',
  '⑥ 蹲下 / 跳跃': '⑥ Crouch and jump',
  '按 Shift 蹲下，按 Space 跳过障碍。': 'Shift crouches, Space jumps over obstacles.',
  '蹲下时移动更慢但更难被打中，也是穿过低矮通道的唯一办法。':
    'Crouching is slower and harder to hit, and the only way through low passages.',
  '⑦ 兵种技能': '⑦ Class ability',
  '按 Q 使用你兵种的技能（突击兵烟雾弹 / 医疗兵医疗箱 / 支援兵弹药箱 / 侦察兵信号弹）。':
    'Press Q for your ability: assault smoke / medic box / ammo crate / scout flare.',
  '投掷类技能按住 Q 蓄力，画面上的抛物线和落点就是它的飞行轨迹。':
    'Hold Q to charge a thrown ability: the arc shows exactly where it lands.',
  '⑧ 战场信息': '⑧ Battlefield info',
  '按住 Tab 看战绩，按 V 切换第一 / 第三人称，按 Enter 打字聊天。':
    'Hold Tab for the scoreboard, V for first/third person, Enter to chat.',
  '顶部中间是比分和倒计时，先到 75 分或时间结束就分出胜负。':
    'Score and timer sit at the top: first to 75, or whoever leads at time.',
  '⑨ 联机：房号': '⑨ Online: room codes',
  '8 位房号': '8-digit code',
  '想和朋友一起玩：回到主菜单选「多人模式」→「创建房间」，会得到一串 8 位房号，把它发给朋友；':
    'To play with friends: pick Multiplayer → Create room in the menu, send the 8-digit code;',
  '朋友在「输入房号加入」里填上就能进同一局。': 'they type it under "Join with code".',
  '房号显示在画面顶部，点一下就能复制。单人模式不需要房号。': 'The code sits at the top of the screen; one click copies it. Solo needs none.',
  '新手指引完成，祝你玩得开心': 'Tutorial complete — have fun out there',
  '随时可以在主菜单重新打开新手指引': 'You can reopen the tutorial from the main menu any time',

  // ---------------------------------------------------- local data panel
  '名字：{name}': 'Name: {name}',
  '最近房号：{code}': 'Last room: {code}',
  '战绩：{matches} 局 · {kills} 击杀 · {deaths} 阵亡 · 胜 {wins}':
    'Record: {matches} matches · {kills} kills · {deaths} deaths · {wins} wins',
  '新手指引：{state}': 'Tutorial: {state}',
  '（未设置）': '(not set)',
  '（还没进过房间）': '(no room yet)',
  '已完成': 'done',
  '未完成': 'not done',
  '存储位置：本机 localStorage（不会上传到服务器，也没有账号系统）':
    'Stored in this browser\'s localStorage (never uploaded, and there are no accounts)',
  '注意：这个环境禁止了本地存储，本次数据只在内存里，刷新即失效':
    'Note: local storage is blocked here, so this session lives in memory only and is lost on reload',
  '存档已导出到下载文件夹': 'Save exported to your downloads',
  '本机数据已清空': 'Local data cleared',
  '清空这台电脑上的游戏数据（名字、房号记录、战绩、本地角色映射）？':
    'Erase the game data on this computer (name, room history, record, local character mapping)?',

  // ----------------------------------------------------- 暂停菜单 / 直连邀请
  '已暂停': 'Paused',
  '继续战斗': 'Carry on',
  '邀请朋友': 'Invite a friend',
  '复制邀请链接': 'Copy the invite link',
  '离开对局': 'Leave the match',
  '设置': 'Settings',
  '按 Esc 打开这个菜单；「继续战斗」回到战场。':
    'Esc opens this menu; "Carry on" puts you back in the fight.',
  '房号 {code} · 你是房主，这一局在你的浏览器里运行；离开后别人会失去这一局。':
    'Room {code} · you are the host and this match runs in your browser — leaving ends it for everyone else.',
  '按 Esc 或点「继续战斗」回到战场': 'Press Esc again, or click "Carry on", to get back to the fight',
  '在新标签页打开': 'Open in a new tab',
  '浏览器不允许这个页面锁定鼠标（多半是 iframe 预览面板）：点上面的「在新标签页打开」就能正常用鼠标转视角。现在可以用方向键转身。':
    'This page is not allowed to capture the mouse (usually an embedded preview pane): \"Open in a new tab\" above fixes that for good. Arrow keys turn the view meanwhile.',
  '无法锁定鼠标': 'Mouse cannot be captured',
  '已释放光标：点击画面继续（继续后鼠标重新被锁定，按 Esc 再次释放）':
    'Mouse handed back — click the view to carry on (the mouse is captured again; press Esc to release it)',
  '这个页面（多半是被嵌在 iframe 里）不允许锁定鼠标：请在新标签页打开本页，鼠标就能正常转视角':
    'This page (most likely an iframe) will not let the mouse be captured — open it in a tab of its own and the mouse works normally',
  '用邀请码加入': 'Join with an invite code',
  '邀请朋友（不同电脑，不用任何服务器）': 'Invite a friend (another computer, no server at all)',
  '把邀请码发给一位朋友（聊天、邮件都行）；他那一页会给出回答码，粘回下面按「完成配对」即可。':
    'Send the invite code to one friend (chat, mail, anything). Their page produces an answer code — paste it below and press "Pair up".',
  '把房主给你的邀请码粘到下面，按「加入」；之后把你得到的回答码发回给房主。':
    'Paste the invite code from the host below and press "Join"; then send the answer code you get back to the host.',
  '生成邀请码': 'Create an invite code',
  '复制': 'Copy',
  '完成配对': 'Pair up',
  '加入': 'Join',
  '关闭': 'Close',
  '生成后邀请码会出现在这里，也可以把朋友的回答码粘进来':
    'The invite code appears here; paste your friend\'s answer code here too',
  '把邀请码粘到这里（以 TFi1 开头）': 'Paste the invite code here (it starts with TFi1)',
  '房号 {code} · 同一个浏览器多开标签页不需要邀请码，直接用房号即可':
    'Room {code} · two tabs of this same browser need no codes — the room code alone is enough',
  '跨网络（不同家里的宽带）：加上公共 STUN 服务器，帮助两端互相找到对方（不经过它传输）':
    'Different networks (two home connections): add a public STUN server to help the two ends find each other (no traffic goes through it)',
  '正在生成邀请码…': 'Creating an invite code…',
  '邀请码已生成：把上面这段发给一位朋友（他会得到一个回答码）':
    'Invite code ready: send this line to one friend (they get an answer code)',
  '先创建房间（房主才有邀请码）': 'Create a room first — invite codes are the host\'s job',
  '邀请码生成失败': 'Could not create an invite code',
  '已复制': 'Copied',
  '复制失败：请手动选中复制（Ctrl/Cmd+C）': 'Copy failed — select the text and copy it (Ctrl/Cmd+C)',
  '正在配对…': 'Pairing…',
  '配对成功：这位朋友已经连上你了，他现在能进这一局':
    'Paired: your friend is connected directly and can now join this match',
  '朋友已直连进来': 'A friend connected directly',
  '一位朋友已直连进来（当前 {n} 条直连）':
    'A friend connected directly ({n} direct link(s) now)',
  '浏览器内的房间（房主运行对局，朋友直连你）':
    'Room inside this browser (you run the match; friends connect straight to you)',
  '房主模式：这一局在你这里运行，已有 {n} 条跨电脑直连':
    'Hosting: this match runs in your browser, with {n} direct link(s) from other computers',
  '房主模式：这一局在你这里运行——把房号发给朋友（同一浏览器多开标签页），或用「邀请朋友」的邀请码跨电脑直连':
    'Hosting: this match runs in your browser - send the room code to friends (extra tabs of this browser), or use an "Invite a friend" code to connect another computer straight to you',
  '已直连房主（跨电脑点对点，没有经过任何服务器）':
    'Connected straight to the host (peer to peer, no server in between)',
  '已加入房间：对局在房主的浏览器里运行（同一浏览器的标签页之间直通）':
    'Joined the room: the match runs in the host\'s browser (tabs of one browser talk directly)',
  '联机通道不可用': 'The multiplayer link could not be opened',
  '还没有房间：先点「创建房间」': 'No room yet - press "Create a room" first',
  '已离开对局（房间也关了）：想再来一局就再点「创建房间」':
    'Match left, and the room closed with it - press "Create a room" for another round',
  '回答码用不了': 'That answer code did not work',
  '正在连接房主…': 'Connecting to the host…',
  '已接上房主，房号 {code}：把上面这段回答码发回给房主':
    'Connected to the host, room {code}: send the answer code above back to them',
  '邀请码用不了': 'That invite code did not work',
  '已打开跨网络支持（下次生成邀请码时生效）':
    'Cross-network support on (it applies to the next invite code you make)',
  '已关闭跨网络支持：只连同一网络内的朋友':
    'Cross-network support off: only friends on the same network can connect',
  '这不像一个邀请码：它应以 TFi1 开头（回答码是发给房主的）':
    'That is not an invite code: it should start with TFi1 (an answer code goes to the host)',
  '邀请码里的房号不对：请让房主重新生成一个':
    'The room code inside that invite is wrong — ask the host for a fresh one',
  '这不是一个回答码（回答码以 TFa1 开头）': 'That is not an answer code (they start with TFa1)',
  '这个回答码过期了：请重新生成邀请码，再让朋友做一遍':
    'That answer code has expired: make a new invite code and have your friend do it again',
  '这不是一个邀请码（邀请码以 TFi1 开头）': 'That is not an invite code (they start with TFi1)',
  '正在连接中转服务器…': 'Connecting to the relay…',
  '房间已创建 · 房号 {code}：把房号发给朋友（同一浏览器多开标签页），或用「邀请朋友」的邀请码跨电脑联机':
    'Room created · code {code}: send the code to friends (two tabs of this browser), or use "Invite a friend" for another computer',
  '房间 {code} 已经开着了：把房号发给朋友，或按 Esc →「邀请朋友」生成跨电脑邀请码':
    'Room {code} is already open: send the code to friends, or press Esc → "Invite a friend" to connect another computer',
  '已离开战场，房间 {code} 还在：朋友仍可以用这个房号进来等你':
    'You left the fight; room {code} is still open — friends can still come in and wait for you',
  '已离开对局': 'You left the match',
  '本机房主（浏览器内引擎，别人直接连你）':
    'Hosting from this browser (in-page engine; others connect straight to you)',
  '房号 {code}': 'Room {code}',
  '点对点直连（{n} 条）': 'Direct peer links ({n})',
  '没有可用的联机通道（公共中转与本地标签页都不可用）':
    'No way to reach other players: neither a direct connection nor this browser\'s own tabs are available',
  'API 调试页': 'API debug page',
  '看这一页到底在用哪个引擎、哪些接口答得上、联机走到哪一步':
    'See which engine this page is really running, which endpoints answer, and where multiplayer stands',

  // ------------------------------------------------------------------ misc
  '界面语言 / Interface language': '界面语言 / Interface language',
  '中文': '中文',
  'English': 'English',
  '界面语言': 'Interface language',
  '语言将立即生效并记住。': 'Applies immediately and is remembered.',
};

// ---------------------------------------------------------------- current language

const STORAGE_KEY = 'tf.lang';

/** 'zh' | 'en' — the language the UI is currently drawn in. */
let lang = 'zh';

function detect() {
  let fromUrl = '';
  try {
    fromUrl = (new URLSearchParams(location.search).get('lang') || '').toLowerCase();
  } catch { /* no URL API: fall through to storage */ }
  if (fromUrl.startsWith('zh')) return 'zh';
  if (fromUrl.startsWith('en')) return 'en';

  let saved = '';
  try { saved = (store.get(STORAGE_KEY) || '').toLowerCase(); } catch { /* storage blocked */ }
  if (saved.startsWith('zh')) return 'zh';
  if (saved.startsWith('en')) return 'en';

  // First visit: the browser's own preference decides, so a Chinese player gets
  // Chinese and everyone else gets English.
  let nav = '';
  try { nav = (navigator.languages?.[0] || navigator.language || '').toLowerCase(); } catch { /* keep default */ }
  return nav.startsWith('zh') ? 'zh' : 'en';
}

const listeners = new Set();

// ------------------------------------------------------------------ lookup

function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
}

/**
 * Translate one string. Unknown strings are returned as they are (with any
 * placeholders filled), so an untranslated line is still readable Chinese
 * rather than a key on screen.
 */
export function t(text, params) {
  if (text === null || text === undefined) return '';
  const src = String(text);
  return fill(lang === 'en' ? translate(src) : src, params);
}

/**
 * Dictionary hit, else the sentence-by-sentence fallback, else the source text.
 * The fallback exists because a few strings are assembled at run time out of
 * several literals (the last tutorial step is two sentences joined with `+`),
 * so the whole string is nobody's dictionary key. The pieces are only used when
 * every one of them is known and no Chinese survives -- a half-translated
 * sentence is worse than a Chinese one.
 */
function translate(src) {
  const hit = EN[src];
  if (hit !== undefined) return hit;
  const parts = src.split(/(?<=[。！？；;.!?])\s*/);
  if (parts.length < 2) return src;
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    const piece = EN[part];
    if (piece !== undefined) {
      // The Chinese original often runs straight on; English needs the space.
      if (out && /[。；：，．;:,.!?]$/.test(out) && /^[A-Za-z(]/.test(piece)) out += ' ';
      out += piece;
    } else if (CJK.test(part)) {
      return src;      // an unknown Chinese sentence: leave the whole line alone
    } else {
      out += part;
    }
  }
  return out;
}

/** Same as t(), but both languages are candidates: `t2('自动', 'Auto')`. */
export function t2(zh, en) {
  return lang === 'en' ? en : zh;
}

/**
 * The current-language name of a data row (weapon, class, team, map, ...).
 * Every one of those carries an *En field; a missing one falls back to Chinese.
 */
export function nameOf(obj, field = 'name') {
  if (!obj) return '';
  return (lang === 'en' && obj[field + 'En']) ? obj[field + 'En'] : (obj[field] || '');
}

/** Same for prose fields: desc/role/tagline/abilityName/abilityDesc/... */
export function descOf(obj, field = 'desc') {
  return nameOf(obj, field);
}

/** The name in the *other* language, for the small second line on a card. */
export function otherName(obj, field = 'name') {
  if (!obj) return '';
  const en = obj[field + 'En'];
  return (lang === 'en' && obj[field]) ? obj[field] : (en || '');
}

export function getLang() { return lang; }
export function isEnglish() { return lang === 'en'; }

/** Everything that builds text in code re-runs itself through here. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Switch language. Everything static is re-rendered here; anything built in
 * code re-renders through its onLangChange() subscription, so the change is
 * visible immediately instead of at the next page load.
 */
export function setLang(next) {
  const want = String(next).toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const changed = want !== lang;
  lang = want;
  try { store.set(STORAGE_KEY, want); } catch { /* storage blocked: session only */ }
  try { document.documentElement.lang = want === 'zh' ? 'zh-CN' : 'en'; } catch { /* no document */ }
  if (!changed) return lang;
  applyDom();
  for (const fn of listeners) {
    try { fn(lang); } catch (err) { console.error('[trench] language listener failed', err); }
  }
  return lang;
}

/** Re-render translated text without changing language (used after rebuilding). */
export function refreshLang() {
  applyDom();
  for (const fn of listeners) {
    try { fn(lang); } catch (err) { console.error('[trench] language listener failed', err); }
  }
}

// ------------------------------------------------------- static page markup
//
// Text nodes and a few attributes are matched whole against the dictionary, so
// index.html needs no per-element tagging. The original Chinese is remembered
// per node, which is what makes switching back exact.

const ZH_BY_EN = (() => {
  const back = new Map();
  for (const [zh, en] of Object.entries(EN)) {
    if (typeof en === 'string' && en && !back.has(en)) back.set(en, zh);
  }
  return back;
})();

const textOrig = new WeakMap();
const attrOrig = new WeakMap();
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

function translateTextNode(node) {
  let orig = textOrig.get(node);
  if (orig === undefined) {
    const raw = node.nodeValue;
    if (!raw) return;
    const key = raw.trim();
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    if (CJK.test(key)) {
      // Chinese markup: a dictionary key, or not ours at all.
      if (!(key in EN)) return;
      orig = raw;
    } else {
      // Already English: something in the game wrote it (the menu's tutorial
      // hint, for one) and the Chinese it replaced is no longer in the DOM.
      const zh = ZH_BY_EN.get(key);
      if (zh === undefined) return;
      orig = lead + zh + trail;
    }
    textOrig.set(node, orig);
  }
  const lead = orig.match(/^\s*/)[0];
  const trail = orig.match(/\s*$/)[0];
  const key = orig.trim();
  node.nodeValue = lead + (lang === 'en' && EN[key] !== undefined ? EN[key] : key) + trail;
}

function translateAttrs(el) {
  let saved = attrOrig.get(el);
  for (const attr of ATTRS) {
    const raw = el.getAttribute?.(attr);
    if (raw === null || raw === undefined) continue;
    if (!saved) { saved = {}; attrOrig.set(el, saved); }
    if (saved[attr] === undefined) {
      const key = raw.trim();
      if (CJK.test(key)) {
        if (!(key in EN)) continue;
      } else {
        const zh = ZH_BY_EN.get(key);      // written by the game, not by the page
        if (zh === undefined) continue;
        saved[attr] = zh;
        continue;                          // keep the English we already have
      }
      saved[attr] = raw;
    }
    const key = saved[attr].trim();
    el.setAttribute(attr, lang === 'en' && EN[key] !== undefined ? EN[key] : key);
  }
}

/**
 * Swap every translatable piece of static markup to the current language.
 * Elements that must never be touched (script/style/textarea) are rejected
 * with their whole subtree, so a code sample inside the page stays intact.
 */
export function applyDom(root) {
  if (typeof document === 'undefined') return;
  const scope = root || document.body || document.documentElement;
  if (!scope) return;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === 1 && SKIP.has(node.nodeName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) translateTextNode(node);
    else translateAttrs(node);
  }
  // <title> lives in <head>, outside the body scope above.
  const titleNode = document.querySelector('title')?.firstChild;
  if (titleNode) translateTextNode(titleNode);
}

// The module is imported before the first paint, so the language is decided
// here rather than in a boot step: index.html's markup is already in the DOM by
// then and applyDom() translates it in place.
lang = detect();
try { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; } catch { /* no document */ }
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDom(), { once: true });
  } else {
    applyDom();
  }
}
