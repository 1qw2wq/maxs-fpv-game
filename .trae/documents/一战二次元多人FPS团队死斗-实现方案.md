# 《堑壕前线》游戏与架构参考

[完整中文指南](../../README.md) · [专题文档索引](../../docs/README.md)

## 游戏内容

- 团队死斗：75 击杀结束，或 8 分钟后比较比分；据点控制：占领 A/B/C 并共同保持 15 秒。
- 三张地图：索姆河无人区、意大利小镇、带相连楼房与中心公园的程序化旧城。
- 突击、医疗、支援、侦察四兵种；26 把主武器和 4 把通用副武器，各槽独立弹药。
- 破片、燃烧、烟雾、闪光、毒气五类手榴弹；防毒面具密封需要 0.75 秒，仅防毒气伤害。
- 单人或房主控制的联机 AI 可选 0–16 个，提供混合及四档难度；支持第一/第三人称与中英文。
- 桌面采用原生鼠标锁定；手机独立使用摇杆、透明圆角按钮、全屏与横竖屏布局编辑。

## 运行架构

前端为原生 ES modules/import maps，Three.js 和 GLTFLoader 已随仓库提供。权威规则在 [public/engine](../../public/engine/)；武器、AI 和地图配置在 [public/shared](../../public/shared/)。静态部署时通过浏览器 Python/Pyodide 运行对局，不需要生产 npm、打包或外部物理引擎。

Vercel 使用 `public` 为根目录、Framework 选 Other，构建命令与输出目录留空。Python 3.10+ 服务是可选的本地/局域网运行方式，不是 Vercel 必需后端。

## 联机流程与限制

房主在主页创建房间、批准申请并选地图/规则；客人自动进入选人并准备，房主开始后统一进游戏。同源同分区标签页使用房间号；跨浏览器/设备逐人交换 WebRTC 邀请与回答。房间号本身不是跨设备信令。

房主页必须保持运行，没有主机迁移；严格 NAT/防火墙可能阻止直连。可选 STUN 不等于 TURN，Vercel 不提供中继保证。

详见[联机指南](../../docs/host-approved-lobby.md)、[武器](../../docs/arsenal-and-sidearms.md)、[AI](../../docs/bot-difficulty.md)、[测试与限制](../../docs/testing.md)。[角色](../../public/models/genshin/CREDITS.md)、[枪械/投掷物](../../public/models/guns/CREDITS.md)、[车辆](../../public/models/maps/VEHICLES.md)各有独立许可；AWP 与面具有非商业限制。
