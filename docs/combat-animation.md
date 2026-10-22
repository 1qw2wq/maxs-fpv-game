# Kill and death presentation

## Feedback and lifecycle

- An authoritative kill event gives the killer a gold confirmation/marker, a separate headshot treatment and a short streak counter for kills less than three seconds apart. Victim names are text, not HTML. Feedback does not shake/lock aim, slow gameplay or interrupt firing.
- Imported rigs and the procedural avatar react, buckle and settle over about **1.25 s**. Fall direction uses the killer's last rendered position when available; missing/suicide sources use a consistent fallback. This is presentation, not a new hit/network rule.
- A corpse stops pose/geometry work once settled and disappears after at most **4.2 s**. Repeated dead snapshots do not restart it; respawn restores the body immediately. Players first encountered already dead stay hidden; disconnect uses normal avatar removal.

## When you die

The viewmodel/first-person arms hide immediately, flash blindness clears and a charged throw cancels. The full local avatar becomes visible for collapse. A roughly **0.95 s** camera transition pulls back with small decaying roll, using the same collision-aware near-plane sweep as normal cameras.

The redeploy card's visual introduction lasts roughly **1.05 s**; authoritative countdown/selection update immediately and normal respawn eligibility is unchanged. The picker retains class, primary and pistol choices. Changing the next loadout does not replace/restart the fallen avatar.

Reduced-motion preference skips camera travel/roll and the delayed panel introduction, and simplifies kill feedback. Clocks catch up after slow frames rather than replaying stale cinematics. Spawn, welcome/rejoin and leaving clear presentation state.

## Implementation and limits

[death-motion.js](../public/js/death-motion.js) defines curves and the idempotent clock; [death-animation.js](../public/js/death-animation.js) captures pose, applies joint relaxation and support-plane clearance, and bounds lifetime. [main.js](../public/js/main.js) integrates events/camera/lifecycle. Imported/procedural rigs expose `setAlive(alive, impact)`, `setDeathGround(offset)` and read-only `deathState`.

Only visual children move: gameplay root/collider, authority, shields, damage and respawn timing remain unchanged. A bounded sample of deformed skin vertices/static bounds keeps the body above the support plane; no shared material opacity changes or per-frame geometry cloning are required.

**This is a keyframed collapse, not ragdoll physics or kill replay.** Bodies do not roll down stairs, collide with bodies, fit wall corners or block bullets/movement. At ledges/slopes, sampled support is approximate and limbs can overlap scenery. No external animation/physics service or build step is needed.

## Checks

```sh
node tools/test-death-motion.mjs
node tools/test-avatar-visibility.mjs
node tools/test-gun-placement.mjs
node tools/test-reload-motion.mjs
python tools/test-death-animation.py
python tools/test-death-gameplay.py
```

See [Python browser setup and limits](testing.md). Tests cover real rigs, frozen roots, idempotence, clearance, cleanup/restoration, reduced motion and Solo/Pyodide death/redeploy integration. Optional `DEATH_SCREENSHOT=/tmp/death.png` and `DEATH_GAME_SCREENSHOT=/tmp/death-game.png` save images. These do not establish every map/ledge or two-device multiplayer scenario.

中文：死亡是有限时长的关键帧倒地，非物理布娃娃；镜头和界面过渡不延长服务器重生倒计时。减少动态效果设置可跳过镜头移动，尸体不阻挡子弹或人物。
