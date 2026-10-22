# Grenades and effects

Press **B** to cycle Frag → Incendiary → Smoke → Flash → Poison gas. Hold **G** to charge and release to throw; the fuse starts on release, not while charging. Mobile has grenade and type-selection controls. All five types share **two charges** and a **24-second refill**; Q class abilities are separate.

## Uploaded art

The [model loader](../public/js/grenade-models.js) uses vendored GLTFLoader and the actual uploads:

| Type | Model in `public/models/guns/` | Identification |
| --- | --- | --- |
| Frag | `granade_m26.glb` | Muted yellow collar |
| Incendiary | `hand_granade.glb` | Orange collar |
| Smoke / assault smoke | `smoke_granade.glb` | Gray collar |
| Flash | `flashbang_grenade.glb` | Pale collar |
| Poison gas | `gas_grenade.glb` | Yellow collar; upright canister only |
| Scout flare | Procedural red cartridge | Not the flare-pistol gun model |

Source spelling is retained in filenames. Artwork is adapted to recognizable game roles, not claimed as an accurate replica of every device. Runtime filtering removes the gas showcase's lying duplicate without rewriting the GLB. Preserve [authors, licenses and adaptations](../public/models/guns/CREDITS.md).

Bodies are centered/oriented inside the **0.09 m collision envelope**. Templates share geometry, textures and materials across throws. Failed loads keep detailed mechanical fallback art; late loads cannot resurrect disposed objects.

## Flight and detonation

Host physics owns the path, impacts, fuse and damage. Cosmetic tumbling follows sampled movement and stops accumulating spin at rest. Smoke/gas canisters stay at their settled pose under the cloud. Late arrivals receive remaining age, not a restarted fuse or expired blast replay.

[Effects](../public/js/grenadefx.js) are type-specific:

- **Frag:** pressure flash, dusty smoke, sparks and wall-stopped cosmetic fragments. Fragments add no damage; dust is not AI smoke cover.
- **Incendiary:** floor-supported flames, smoke, sparks, ground glow and temporary soot. Shared geometry blocks visual spread through walls/unrelated floors.
- **Smoke:** 36-card sight-blocking cloud and small canister vents, not a fireball.
- **Gas:** yellow/ochre cloud and vents. See [gas damage and mask protection](poison-gas-and-mask.md).
- **Flash:** fast white glare/halo plus authoritative LOS/distance/facing exposure and full-screen **white blindness** with recovery—not orange blast particles.
- **Flare:** red-orange ignition, embers and spotting behavior, not incendiary damage.

Instanced fragments/sparks and two persistent shadowless light slots bound rendering cost. Effect resources clean up on expiry/leave/map changes; shared templates/textures stay cached. Layered procedural audio needs no external service. This is real-time game presentation, **not fluid simulation or physically accurate fragmentation**.

## Checks

```sh
python tools/test-grenades.py
node tools/test-grenade-upgrade.mjs
GRENADE_ASSETS_ONLY=1 node tools/test-grenade-upgrade.mjs
GRENADE_MODEL_SHOTS=/tmp/grenade GRENADE_SCREENSHOT=/tmp/fire.png node tools/test-grenade-upgrade.mjs
```

Checks cover host/preview trajectory parity, actual model bounds/pixels, caching, failed/pending loads, settled and late paths, white flash, resource cleanup and real throw inputs. See [test dependencies and scope](testing.md); isolated effect fixtures are not whole-map FPS benchmarks.

中文：按 B 选类型、按住 G 蓄力后松开投掷。实际上传模型仅负责外观，碰撞和伤害由主机决定；闪光弹是白屏致盲，烟雾/毒气不是爆炸火球。
