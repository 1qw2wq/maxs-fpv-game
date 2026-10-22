# Crouch, shields and multiplayer authority

## Crouch presentation

The engine's crouch capsule is **0.85 m**, with **0.75 m** eye height. [stance.js](../public/js/stance.js) eases presentation independently of frame rate: forward hip flexion, deep knees, compensated ankles, grounded pelvis and short moving steps rather than a full standing run mixed into a squat. Standing returns to the zero-offset pose.

Torso/head adjustment counter-rotates the gun so crouching does not aim its barrel at the floor; hand IK keeps actual socket contacts. These visual transforms do not alter root position, collision, speed, damage or network flags. Hats/hair can extend beyond the capsule; custom rig proportions need visual review. Death clearance updates skinned matrices before sampling and retains regional extrema; [keyframed-body limitations](combat-animation.md) still apply.

## Authority clock, pause and transport

Browser-hosted multiplayer follows [main-page approval, Ready and synchronized Start](host-approved-lobby.md). Explicitly created/paired channels survive launch instead of being replaced by a remembered optional backend address. Rooms default to no bots, with **optional host-controlled AI**.

- Authority uses an **independent timer**, not rendering frames. Relay traffic can also advance it under timer throttling; catch-up is capped at **six ticks** and stops on match close.
- Guests retain transport heartbeats while their local pause menu stops input, preserving the same seat.
- Host pause/resume is explicit and included in replies/heartbeats. Guests stop movement/fire; authority rejects gameplay commands while paused. Chat does not resume the match.
- Peer counts and semantic welcome parsing describe actual state; opening a transport alone is not a successful game join.

The host page must remain open. Fully suspended browsers/phones cannot guarantee timers/networking. Vercel-only operation needs no required broker/backend, but cross-device pairing still needs direct WebRTC reachability; room codes are not universal signalling and STUN is not TURN.

## Spawn shield and life validation

Spawn protection lasts **up to five seconds while idle**. A player's own movement or firing cancels **only that player's** protection, terminally for that life; later idle snapshots do not renew it. Mask equipping is not a new shield or offensive cancellation.

Input, fire, reload, switch, throws and respawn helpers capture the life ID **when sent**. Authority rejects mismatching serials before acting, preventing old queued input from moving a new body or stripping its new shield. Missing serials remain legacy-compatible. Shield rules are shared across Somme, Italy and Procedural City.

## Focused checks

```sh
node tools/test-stance.mjs
node tools/test-engine-clock.mjs
node tools/test-protection.mjs
python tools/test-survival.py
node tools/test-multiplayer.mjs
MULTIPLAYER_MAPS_ONLY=1 MULTIPLAYER_MAP=proc_city node tools/test-multiplayer.mjs
python tools/test-crouch.py
python tools/test-map-shields.py
```

See [browser setup and validation limits](testing.md). `CROUCH_SCREENSHOT=/tmp/crouch.png` optionally captures a rig. Crouch tests inspect standing transitions, moving/stationary poses at multiple frame rates, roots and restoration.

RTC tests explicitly disable BroadcastChannel/WebSocket and isolate browser contexts. They exercise movement/crouch, pause/seat retention, bidirectional shots, ammo, death/redeploy, channel identity and shield cancellation. The three-map transport fixtures use humans-only settings and disabled host rendering to isolate authority behavior; optional bot policy has [separate coverage](bot-difficulty.md). Fixtures can clear scenery for GPU cost without removing collision/authority. Local automated checks are not physical-device, every-wall combat or cross-network certification.

中文：蹲姿遵循共享碰撞/视线高度，动画不修改判定。出生保护最多五秒，自己移动或开火就结束本条命的保护；主机暂停与客人本地暂停不同，渲染卡顿不应成为权威时钟。
