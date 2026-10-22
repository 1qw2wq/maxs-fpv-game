# Poison gas grenade and protective mask / 毒气手榴弹与防毒面具

## Playing / 操作

- **B** cycles Frag → Incendiary → Smoke → Flash → **Poison gas grenade**. Hold **G** to charge; release to throw. All five types share the existing two-charge inventory and 24-second refill. Q class abilities remain separate.
- **M** puts on/removes the gas mask. On mobile, use **Gas mask / 防毒面具** in the bottom action grid. It is round/translucent, supports simultaneous touch input, and can be moved in the existing per-orientation layout editor. The mask occupies the former spare half of the grenade-cycle row, not another row over Fire.
- A mask needs **750 ms to seal**. The HUD distinguishes off, sealing, sealed, dangerous gas, and protected-in-gas. Equip it before entering the yellow cloud; damage continues while it is sealing. Removing it stops protection immediately; re-equipping requires another seal.
- First person has an unobtrusive rubber/visor peripheral overlay. Third-person self and remote avatars wear the **uploaded `gas_mask.glb`**, following the head/crouch/pitch on the procedural avatar and all four built-in rigs. First-person arms remain separate; the accessory is not placed over those arm meshes.
- Protection is unlimited while worn (no filter consumable), but **does not clear gas visibility** or stop bullets, fragmentation, fire, or flash blindness. The mask does not grant a spawn shield. Like aiming/reloading, putting it on is not an offensive action that cancels a spawn shield.
- Death, redeployment, and a new round clear mask/exposure state. The visor disappears on death, leaving, and third-person view. Going to a menu does not create a new mask immunity.

中文：按 **B** 选择「毒气手榴弹」，按住 **G** 蓄力、松开投掷。按 **M** 或手机的「防毒面具」按钮佩戴/取下；需要 **0.75 秒密封**，不能等到快死时瞬间获得保护。黄色烟雾会遮挡视线；已密封的面具只阻止毒气伤害，不会让烟雾透明，也不能抵挡枪弹、燃烧、破片或闪光。死亡/重新部署后要重新佩戴。手机按钮可在横竖屏布局编辑器中分别调整。

## Shared tuning and authority

`public/shared/weapons.json` is the single source for `grenades[id=gas]` and `gasMask.equipMs`:

| Parameter | Value |
| --- | --- |
| Fuse, starting on release | 1,800 ms; no cooking |
| Active lifetime | 12,000 ms after the fuse |
| Radius | 6.5 m |
| Unprotected damage | 18 HP/second, no distance falloff inside the radius |
| Mask seal delay | 750 ms |
| Appearance | Muted yellow/ochre cloud; 36 deterministic, bounded smoke cards |

`game.py` owns the flight, fuse, lifetime, radius, LOS, health changes, deaths, and mask deadline. JavaScript only sends an explicit `{t:'mask', life, on:boolean}` desired state. Repeated equip packets do not restart the delay; malformed/non-boolean, dead, ended-round, and stale-life commands are rejected. Client-provided protection or ready timestamps are ignored. Network interpolation receives the public `mk` flag; private snapshots carry `mask`, `maskIn`, `maskProtected`, and `gas`.

Damage observes the existing grenade policy: **enemy and self damage, no teammate damage**. A mask is required for the thrower too. Spawn shields retain their existing independent rules. Gas damage requires an unobstructed segment through the shared solid geometry; a solid wall or floor blocks it. This is radial game LOS, **not** gas flowing realistically through doors/vents. Overlapping hostile/self clouds can stack damage.

Damage is integrated only over the active part of each host tick, including the final fractional tick at expiry and the unsealed portion of a tick that crosses mask completion. There is no continuing poison debuff after leaving/expiry. The HUD's exposure indicator can linger up to 200 ms between host updates; this does not add damage. Poison kills use `gas` in the normal kill feed, with owner attribution preserved if the thrower disconnects.

Gas also participates in smoke sight/flare checks. Bots do not see through it when masked: they react to actual host-recorded exposure with their tier's ordinary reaction delay, use the same 750 ms seal, and remove the mask roughly two seconds after leaving. They gain no immediate immunity or knowledge of an incoming/hidden cloud. This change does not make bots throw additional grenades.

The same Python match runs in Solo/Pyodide, browser-hosted tab rooms, manually paired WebRTC rooms, and the optional Python server. `Net.mask()` is inherited by all transports; no broker/backend/build/npm dependency was added to production. Late arrivals receive existing clouds with their remaining age, settled canister, and remote mask state, not a restarted fuse.

## Uploaded model inspection

| Upload | Runtime use | Inspection / adaptation |
| --- | --- | --- |
| `gas_grenade.glb` | Poison throwable and venting spent canister | The source is a **two-canister showcase**. Select the upright complete body and omit the lying display duplicate; retain its texture, lever and pin. |
| `gas_mask.glb` | Third-person face accessory | Already Y-up/+Z-forward. Center and scale the 0.235 m source to 0.32 m presentation height; attach in normalized avatar space. |
| `smoke_granade.glb` | Smoke grenade and assault smoke ability | Replace the earlier Toon grenade mapping; remove the source's large pivot offset through normalization. |
| `flashbang_grenade.glb` | Flash grenade | Replace the reused Hand grenade mapping; preserve the multi-part lever/ring/body assembly. |

Throwable bodies plus their small identification collars are fitted inside the unchanged **0.09 m collision sphere**. The assembled visual bounding sphere is 0.0825 m. Five throwable files are cached per page; instances share immutable geometry, textures and materials. The mask has its own one-file cache. Failed/slow requests keep detailed mechanical fallback art, without changing host protection/damage. Pending loads cannot resurrect disposed objects.

Yellow gas uses the smoke plume/vent path, not the frag fireball. It keeps its canister below the cloud and applies a yellow interior fog independently of mask protection. These effects are bounded presentation, not a fluid simulation. Puffs/instance resources are cleaned up on expiry/leave; cached art is never disposed by an individual throw/avatar.

**Licensing:** the uploaded mask's embedded metadata is **CC BY-NC 4.0**, by **David Wigforss**. This is a non-commercial asset license, not a commercial-use clearance. The three new grenade uploads identify CC BY 4.0. Preserve their attributions; review/replace any restricted assets before commercial use. Exact authors, sources, original license links and runtime adaptations are recorded in [`public/models/guns/CREDITS.md`](../public/models/guns/CREDITS.md). Original GLBs are unchanged; code licensing does not override asset licenses.

中文：模型已实际解析并渲染检查。毒气模型原文件里有「直立 + 横放」两个展示件，只取直立弹体；烟雾弹和闪光弹也改用此次新增的独立模型。**防毒面具的内嵌许可为 CC BY-NC 4.0，仅限非商业使用条件**；署名与原始来源已保留，不能把项目代码许可当作模型的商业授权。

## Verification

```sh
# No Python packages required:
python tools/test-poison-gas.py
python tools/test-grenades.py
python tools/test-ai.py
python tools/test-bot-difficulty.py

# Browser test dependencies only, outside the production repository:
npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
node tools/test-poison-gas-browser.mjs
GAS_LOBBY_TEST=1 node tools/test-room-lobby.mjs
node tools/test-grenade-upgrade.mjs

# Optional subsets / model screenshots (write outside Git):
GAS_ASSETS_ONLY=1 MASK_MODEL_SHOTS=/tmp/mask node tools/test-poison-gas-browser.mjs
GAS_MOBILE_ONLY=1 node tools/test-poison-gas-browser.mjs
GRENADE_ASSETS_ONLY=1 GRENADE_MODEL_SHOTS=/tmp/grenade node tools/test-grenade-upgrade.mjs
```

- **24 poison/mask engine tests:** self/enemy/friendly policy, fuse, seal/removal/idempotence/invalid packets/stale lives, damage timing/rate/expiry, walls/floors/range/shields, no fire/frag/flash immunity, death/respawn, owner departure/kill credit, late age, smoke checks, all maps, and all bot tiers/difficulty resets.
- **Asset browser tests:** visible uploaded mask pixels on all four built-in rigs + procedural fallback; crouch/pitch following; yellow gas pixels and cloud expiry; one cached mask geometry across 32 copies; failed/pending-load fallback/cleanup. Throwable tests cover all five actual GLBs, exactly one gas canister, collider envelope, settled paths, resource sharing, and **180 Python/JS trajectory cases**.
- **Actual Solo browser integration:** native M/B/G/V input, Pyodide-authoritative self-poison, sealing/removal/reseal, first-person visor, third-person imported mask, yellow fog, aged gas canister and cleanup. Mobile integration exercises the real touch mask button, its pressed state, drag/save layout, fullscreen, existing scope/fire/grenade controls, 320 px portrait and short-landscape hit targets. The layout editor handles touch taps directly after a captured drag rather than relying solely on a browser-generated compatibility click.
- **Actual multiplayer:** the approved-lobby regression's optional gas fixture runs in same-browser tab rooms and again in separate storage contexts over real WebRTC, with BroadcastChannel/WebSocket disabled for RTC. It checks guest mask command → host snapshot → remote uploaded mask, real guest gas throw, protected health, removal damage, and reseal. Existing approval/Ready/host Start/retry/leave checks remain.

These are automated local browser and deterministic gameplay tests. They do not certify physical mobile devices, cross-NAT WebRTC reachability, or real-world respiratory protection.
