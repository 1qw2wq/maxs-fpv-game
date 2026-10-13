# 用 Genshin 模型替换兵种角色 + 敌方红色三角敌我识别

## Summary（要做什么）

1. 把四个兵种的第三人称角色替换为 `C:\Users\motia\Downloads\genshin models` 里的原神模型：
   **突击兵=胡桃、医疗兵=芙宁娜、支援兵=Navia、侦察兵=夏洛蒂**。
2. 给玩家头顶三角标记改为：**队友绿色、敌人红色**（做敌我识别）。
3. 取消外部模型的队伍色染色，**保留原神原色**。

不改服务端、不改网络协议；模型作为**内置兵种皮肤**随客户端分发。全部复用项目已有的外部骨骼管线
（[rig.js](file:///c:/Users/motia/Documents/trae_projects/FPS%20web%20game%20demo/public/js/rig.js)），不新写渲染/蒙皮逻辑。

## Current State Analysis（现状 + 素材实测）

**现有管线**（已读代码确认）：

- 远端玩家在 [main.js](file:///c:/Users/motia/Documents/trae_projects/FPS%20web%20game%20demo/public/js/main.js#L642-L689) `updateRemotePlayers()` 里按 `p.skin` 生成：
  `makeRemoteGirl()` → 命中 `app.charMeta` 后 `ensureTemplate()` 懒加载 `meta.file`
  → `prepareTemplate()` 归一化到 1.70 m → `createExternalGirl()`。模板未就绪时先显示内置角色，就绪后按 `renderKey` 自动换装。
- `createExternalGirl()` 读取 `meta = { bones, offsets, scale, rotY }`；只有 `kneeL/kneeR/spine/head/hips` 被程序化驱动，
  `shoulder/elbow/hand/foot` 不驱动，只吃 `offsets` 滑杆；`handR` 骨骼上挂武器。
- 标记由 [character.js](file:///c:/Users/motia/Documents/trae_projects/FPS%20web%20game%20demo/public/js/character.js#L327-L351) `buildFactionOverlay()`
  生成（倒锥 `ConeGeometry(0.085,0.13,3)`），内置角色与外部模型**共用**，所以改配色只需改一处。
- 静态托管：`app.router.add_static("/", PUBLIC)` → `public/` 下任意文件可直接 GET，**新增模型无需重启服务端**，刷新浏览器即可。

**素材实测**（脚本解析 GLB 的 JSON/BIN chunk 得到）：

| 兵种 | 模型 | 文件 | 大小 | 蒙皮/关节 | 材质 | 许可 |
| --- | --- | --- | --- | --- | --- | --- |
| 突击兵 | 胡桃 | `hutao/hutao_genshin_impact.glb` | 5.2 MB | 2 / 127 | 无扩展（PBR 受光） | 无 license.txt（未知） |
| 医疗兵 | 芙宁娜 | `furina/genshin_impact_-_furina (2).glb` | 9.9 MB | 1 / 241 | `KHR_materials_unlit` | 无 license.txt（未知） |
| 支援兵 | Navia | `navia/genshin_impact_-_navia.glb` | 4.2 MB | 1 / 678 | `KHR_materials_unlit` | CC-BY-4.0，作者 X9_YT |
| 侦察兵 | 夏洛蒂 | `charlotte/genshin_impact_-_charlotte.glb` | 6.2 MB | 1 / 223 | `KHR_materials_unlit` | CC-BY-4.0，作者 X9_YT |

**两个决定性测量**（决定 offsets 与 rotY，已实测）：

- **朝向**：四个模型的眼骨/脚趾都在 **+Z** 方向（例：夏洛蒂 head z=0.011 → 眼 z=0.059；踝 z=-0.011 → 趾 z=0.058），
  即模型**面朝 +Z**。而 `yawToRotation(yaw)=π/2−yaw` 正是为「局部 +Z 为前方」的物体设计的
  （已验证：θ=π/2−yaw 时局部 +Z 映射到 `(cos yaw,0,sin yaw)`，与服务端 `forward` 约定一致）。
  → **四个模型 `rotY = 0`**。
- **姿态**：四个模型都是 **A-pose（手臂下垂 31–45°）**，不是 T-pose。
  例：胡桃肩 (0.059,1.422) → 腕 (0.432,1.051)，约 45°；Navia 约 31°；芙宁娜/夏洛蒂约 34°。
  → 手臂**不会**水平张开，默认姿态可接受；是否再用滑杆把手臂收拢到持枪姿势，实测后决定。

**不在本次范围**：`citlali`（骨骼名 405 节点里 170 个是 U+FFFD 乱码，需离线重写 GLB 才能用）、
`noell`/`jean`（用户后来已从文件夹删除，且本身是 `skins=0` 的静态网格，无骨骼不可用）。

## Assumptions & Decisions（已确认）

1. **兵种→模型**：突击兵=胡桃、医疗兵=芙宁娜、支援兵=**Navia**、侦察兵=夏洛蒂（用户确认「用 Navia（推荐）」）。
2. **标记配色**：队友绿 `0x3ddc6a`、敌人红 `0xff3b30`（用户确认「队友绿色 + 敌人红色」）。
3. **配色**：取消 `applySkinTint()` 的队伍色染色，保留原神原色（用户确认「保留原神原色，取消染色」）。
   阵营识别完全交给红/绿三角 +（地面已有的）队伍色光环。
4. **分发方式**：模型作为内置皮肤打进 `public/`，不进「共享上传」列表、不改服务端。
5. **优先级**：玩家在设置模式选过的自定义皮肤（`p.skin`）优先；未选才用兵种内置模型。

## Proposed Changes（改动清单）

### 1. 新增素材（复制 4 个 GLB）

新建 `public/models/genshin/`，复制并重命名：

```
hutao.glb     ← hutao/hutao_genshin_impact.glb
furina.glb    ← furina/genshin_impact_-_furina (2).glb
navia.glb     ← navia/genshin_impact_-_navia.glb
charlotte.glb ← charlotte/genshin_impact_-_charlotte.glb
```

PowerShell 示例（注意路径含空格与括号，必须 `-LiteralPath`）：

```powershell
$src = 'C:\Users\motia\Downloads\genshin models'
$dst = 'c:\Users\motia\Documents\trae_projects\FPS web game demo\public\models\genshin'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -LiteralPath "$src\hutao\hutao_genshin_impact.glb"     -Destination "$dst\hutao.glb"
Copy-Item -LiteralPath "$src\furina\genshin_impact_-_furina (2).glb" -Destination "$dst\furina.glb"
Copy-Item -LiteralPath "$src\navia\genshin_impact_-_navia.glb"    -Destination "$dst\navia.glb"
Copy-Item -LiteralPath "$src\charlotte\genshin_impact_-_charlotte.glb" -Destination "$dst\charlotte.glb"
```

纹理**全部内嵌**（无外部 `.bin`/贴图），复制单个文件即可自包含加载。
`public/` 已由 `add_static` 托管，`/models/genshin/*.glb` 直接可 GET，**服务端无需重启**。

### 2. `public/js/rig.js` —— 新增内置皮肤表

在文件末尾（`createSettings` 之后）**追加**两个导出。**追加，不改动现有函数**：

```js
/**
 * Class skins that ship with the client. Same shape as an uploaded meta
 * ({ bones, offsets, scale, rotY }), but the model is served from /models.
 * Bone names were read out of each GLB: every rig is a Genshin/MMD-style
 * skeleton whose "leg" bone is the thigh and whose "ankle" bone is the foot,
 * so knees are mapped to the thigh (the walk cycle drives one joint per leg
 * with a leg-swing amplitude) and feet to the ankle (never the toe).
 * All four rigs face +Z, which is the same convention yawToRotation assumes,
 * hence rotY 0 for all of them.
 */
export const BUILTIN_SKINS = {
  'builtin-hutao': {
    id: 'builtin-hutao', name: '胡桃', file: '/models/genshin/hutao.glb',
    bones: {
      hips: 'Hips_03', spine: 'Spine_048', head: 'Head_053',
      shoulderL: 'Left_shoulder_049', shoulderR: 'Right_shoulder_055',
      elbowL: 'Left_elbow_085', elbowR: 'Right_elbow_0108',
      handL: 'Left_wrist_087', handR: 'Right_wrist_0107',
      kneeL: 'Left_leg_04', kneeR: 'Right_leg_08',
      footL: 'Left_ankle_06', footR: 'Right_ankle_09',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
  'builtin-furina': {
    id: 'builtin-furina', name: '芙宁娜', file: '/models/genshin/furina.glb',
    bones: {
      hips: 'Hips_02', spine: 'Spine_03', head: 'Head_06',
      shoulderL: 'Left shoulder_058', shoulderR: 'Right shoulder_084',
      elbowL: 'Left elbow_061', elbowR: 'Right elbow_087',
      handL: 'Left wrist_063', handR: 'Right wrist_089',
      kneeL: 'Left leg_0119', kneeR: 'Right leg_0123',
      footL: 'Left ankle_0121', footR: 'Right ankle_0125',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
  'builtin-navia': {
    id: 'builtin-navia', name: 'Navia', file: '/models/genshin/navia.glb',
    bones: {
      hips: 'Hips_07', spine: 'Spine_08', head: 'Head_011',
      shoulderL: 'Left shoulder_045', shoulderR: 'Right shoulder_083',
      elbowL: 'Left elbow_047', elbowR: 'Right elbow_085',
      handL: 'Left wrist_049', handR: 'Right wrist_087',
      kneeL: 'Left leg_0667', kneeR: 'Right leg_0671',
      footL: 'Left ankle_0669', footR: 'Right ankle_0673',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
  'builtin-charlotte': {
    id: 'builtin-charlotte', name: '夏洛蒂', file: '/models/genshin/charlotte.glb',
    bones: {
      hips: 'Hips_02', spine: 'Spine_03', head: 'Head_06',
      shoulderL: 'Left shoulder_034', shoulderR: 'Right shoulder_056',
      elbowL: 'Left elbow_037', elbowR: 'Right elbow_059',
      handL: 'Left wrist_039', handR: 'Right wrist_061',
      kneeL: 'Left leg_087', kneeR: 'Right leg_091',
      footL: 'Left ankle_089', footR: 'Right ankle_093',
    },
    offsets: {}, scale: 1, rotY: 0,
  },
};

/** Which built-in skin a class wears when the player picked no custom one. */
export const DEFAULT_CLASS_SKIN = {
  assault: 'builtin-hutao',
  medic: 'builtin-furina',
  support: 'builtin-navia',
  scout: 'builtin-charlotte',
};
```

> 骨骼名取自实测（每个模型逐个 dump 自 `skins[0].joints`），执行时**不要凭手感重写**。
> 胡桃的右肘是 `Right_elbow_0108`、右腕是 `Right_wrist_0107`（编号不连续，但不是笔误）。

### 3. `public/js/rig.js` —— 取消队伍色染色

现状：`createExternalGirl()` 第 214 行调用 `applySkinTint(rig, new THREE.Color(team.color))`，
把材质颜色朝队伍色插值 20%。

- 删除第 214 行这次调用。
- 删除 `applySkinTint()` 函数本体（第 170–182 行，`export function applySkinTint`）。
  全仓库只有这一处调用（已 grep 确认无其他引用），删掉不留死代码。
- **不会丢行为**：函数内部唯一的额外作用是给网格设 `frustumCulled = false`，
  而 `createExternalGirl()` 第 243 行已有 `root.traverse(o => { if (o.isMesh) o.frustumCulled = false })` 覆盖了同样的处理。

### 4. `public/js/main.js` —— 接线

**(a) import 补两个名字**（第 19 行）：

```js
import { createSettings, createExternalGirl, prepareTemplate, loadGltfFromUrl,
         BUILTIN_SKINS, DEFAULT_CLASS_SKIN } from './rig.js';
```

**(b) `boot()` 里把内置皮肤灌进 `charMeta`**（在 `await refreshCharLibrary();` 之后加一行循环）：

```js
await refreshCharLibrary();
for (const skin of Object.values(BUILTIN_SKINS)) app.charMeta.set(skin.id, skin);
```

这样 `makeRemoteGirl()` 能查到 `meta`，随后 `ensureTemplate()` 会从 `meta.file` 懒加载。
**懒加载、换装、失败回退内置角色的现有逻辑全部不用动**
（`renderKey` 已经把 "模板未就绪" 和 "已就绪" 区分开了）。

**(c) `updateRemotePlayers()` 里给 skinId 兜默认值**（第 650 行，改一行）：

```js
const skinId = p.skin || DEFAULT_CLASS_SKIN[p.cls] || '';
```

玩家自定义皮肤（`p.skin`）优先，符合既有行为。

**(d) 敌我标记配色**（第 671–672 行，改两行）：

```js
girl.marker.visible = true;
girl.marker.material.color.set(p.team === app.myTeam ? 0x3ddc6a : 0xff3b30);
```

原先是「只给队友显示、用我方队伍色」；现在**敌我都显示**，队友绿、敌人红。
阵亡时 `setAlive(false)` 把 `root.visible=false`，标记一并隐藏——无需额外处理。

### 5. 调参（浏览器实测，迭代）

姿态实测是 A-pose，默认就能看；是否需要收拢手臂到持枪姿势，按下面的流程定：

1. 启动服务端（`python server/server.py`，监听 `http://127.0.0.1:8080`），刷新浏览器。
2. 进**单人模式**（服务端 `fill_bots()` 按 `["assault","medic","support","scout"][n%4]` 轮转，
   6 个 AI 会覆盖四个兵种，四种模型都能同时看到）。
3. 检查：身高 ≈1.70 m（`fitToHeight` 自动归一化，一般不用手改 `scale`）、
   朝向与移动方向一致（`rotY=0` 应为正确，若发现背对则改 180）、贴图正常、行走时腿在摆、红/绿三角清楚。
4. 若要收拢手臂/扶正枪：进**设置模式**，导入同一份 GLB（`autoMapJointNames` 会自动匹配），
   用「左肩/右肩/左肘/右肘/左手/右手」滑杆调到满意，把得到的 `offsets` 数值抄回
   `BUILTIN_SKINS` 对应条目的 `offsets`（格式 `{ shoulderR: [x,y,z], ... }`，单位度）。
   设置模式只用来**量数值**，内置皮肤不走上传流程。
5. 如需要单独核对某个模型，可临时建 `public/__probe.html`；**用完必须删除**。

### 6. `README.md` —— 署名（CC-BY-4.0 必须署名）

在「角色/自定义角色」相关章节补充：四个兵种内置皮肤来源；**Navia 与夏洛蒂为 CC-BY-4.0，
必须署名作者 X9_YT** 并附 Sketchfab 链接；胡桃/芙宁娜的文件夹内**没有 license.txt**，来源与许可未知。

## Assumptions & Decisions 汇总（执行时按此，不再选）

- `rotY = 0`（四模型均面朝 +Z，与 `yawToRotation` 约定一致）——已实测，非猜测。
- `scale = 1`（`prepareTemplate` 已归一化到 1.70 m）。
- `kneeL/R` 绑到 **thigh**（`Left leg_*`），`footL/R` 绑到 **ankle**（`Left ankle_*`）；不用 `*_knee_*` 与 `*_toe_*`。
  （rig.js 每条腿只驱动一个关节且摆幅较大，绑 thigh 才是"迈腿"；绑 `knee_*`（小腿）会变成折小腿。）
- `offsets` 初值 `{}`（A-pose），实测后按第 5 步回填。
- 不改服务端、不加网络字段、不动 `applySkinTint` 以外的材质逻辑。

## Verification（验证清单）

- [ ] `GET /models/genshin/{hutao,furina,navia,charlotte}.glb` 均返回 200
- [ ] 单人模式下四个兵种的 AI 分别显示 胡桃 / 芙宁娜 / Navia / 夏洛蒂（不是内置少女）
- [ ] 移动时腿部有程序化行走动画（不是僵直滑动），脊柱/头部随俯仰有轻微动作
- [ ] 朝向正确：角色移动时面朝前进方向（背对则为 rotY 问题）
- [ ] 贴图为原神原色（**没有**被染成蓝/橙）
- [ ] 队友头顶**绿色**三角、敌人头顶**红色**三角，两者都可见
- [ ] 阵亡后模型与标记一起消失、复活后恢复
- [ ] 浏览器控制台无报错
- [ ] 多人模式：加入房间的真人玩家看到的内置皮肤表现一致（可开两个标签页互相观察）

## Risks & Rollback（风险与回退）

- **持枪姿势不自然**：四个模型是 A-pose，肩膀/手肘不参与程序化驱动，枪挂在 `handR` 上，
  枪的口朝向取决于该骨骼的 rest 朝向，可能偏斜。缓解：用设置模式滑杆量出 `offsets` 回填；
  若某个模型怎么调都不自然，把该兵种在 `DEFAULT_CLASS_SKIN` 里留空 → 自动回退内置角色（其余兵种不受影响）。
- **体积**：四个模型共约 25 MB 进 `public/`。已是懒加载（某个兵种首次出现才下载），
  但首次出现会有短暂"先显示内置少女、随后换装"的跳变。本地环境可接受。
- **材质观感不一致**：芙宁娜/Navia/夏洛蒂是 `KHR_materials_unlit`（全亮），胡桃受光——四者亮度会略有差异。
  属素材本身差异，不额外处理。
- **许可**：Navia、夏洛蒂为 CC-BY-4.0（必须署名 X9_YT）；胡桃、芙宁娜无 license.txt，来源与许可未知，
  已在 README 说明。若后续要对外发布需先厘清这两个模型的授权。
- **希特菈莉（citlali）**：骨骼名损坏（405 节点中 170 个为 U+FFFD），本期不使用，也不做离线重命名。
  素材与 `license.txt` 保持原样留在 Downloads，不改动。

## 需要修改的文件

| 文件 | 改动 |
| --- | --- |
| `public/models/genshin/{hutao,furina,navia,charlotte}.glb` | 新增（从 Downloads 复制） |
| [rig.js](file:///c:/Users/motia/Documents/trae_projects/FPS%20web%20game%20demo/public/js/rig.js) | 追加导出 `BUILTIN_SKINS` / `DEFAULT_CLASS_SKIN`；删除 `applySkinTint()` 及其调用 |
| [main.js](file:///c:/Users/motia/Documents/trae_projects/FPS%20web%20game%20demo/public/js/main.js) | import 两名；`boot()` 灌 `charMeta`；`updateRemotePlayers()` 改 skinId 默认值 + 标记配色 |
| [README.md](file:///c:/Users/motia/Documents/trae_projects/FPS%20web%20game%20demo/README.md) | 内置皮肤说明 + CC-BY-4.0 署名 |

服务端 `server.py` / `game.py`、`shared/weapons.json` **不改**。
