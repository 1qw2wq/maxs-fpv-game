# Poison gas and protective mask / 毒气与防毒面具

## Controls and protection

Select gas with **B**, then hold/release **G** to throw. It shares the two-charge, 24-second-refill inventory described in [grenades](grenade-models-and-effects.md).

**M** toggles the mask. Mobile has a translucent, round Gas mask button in the editable action grid, with separate portrait/landscape layouts. Equipping takes **750 ms to seal**; damage continues during sealing. Removal is immediate, and re-equipping restarts the delay. HUD states distinguish off, sealing, sealed, exposure and protected exposure.

Protection is unlimited while sealed, but blocks **only poison damage**: it does not clear smoke visibility or stop bullets, fragments, fire or flash blindness. It is not a spawn shield; equipping is not an offensive action that cancels one. Death/redeployment/new rounds clear mask state. The first-person visor disappears on death, leave and third-person view; remote avatars wear the uploaded mask following head/crouch/pitch.

## Shared rules

[weapons.json](../public/shared/weapons.json) defines gas and `gasMask.equipMs`:

| Parameter | Value |
| --- | --- |
| Fuse from release; no cooking | 1,800 ms |
| Active cloud lifetime | 12,000 ms |
| Radius | 6.5 m |
| Unprotected damage | 18 HP/s, no distance falloff inside radius |
| Seal delay | 750 ms |

- Gas damages enemies **and the thrower**, not teammates. Existing spawn-shield rules remain independent. Overlapping hostile/self clouds can stack damage.
- A solid wall or floor blocks the radial damage LOS. This is **not gas flowing through doors or vents**. There is no poison debuff after leaving/expiry.
- Authority integrates only active/unsealed portions of each tick, including fractional expiry/seal boundaries. The exposure HUD can lag up to 200 ms without adding damage.
- Mask commands require an explicit boolean desired state and current life. Dead, ended-round, malformed and stale-life commands are rejected; repeated equip does not restart sealing. Client-supplied protection/deadlines are ignored.
- Public `mk` and private `mask`, `maskIn`, `maskProtected`, `gas` snapshots drive presentation. Late arrivals receive cloud age, settled canister and mask state. Kill credit preserves the gas owner even after departure.
- Bots react to actual exposure with their ordinary tier delay and the same seal time, removing masks roughly two seconds after leaving. Masked bots still cannot see through gas; this feature does not make them throw grenades.

The same Python match governs Solo/Pyodide, browser-hosted tab/WebRTC rooms and the optional Python server. No production backend, broker, npm dependency or build is required.

## Assets and rendering

`gas_grenade.glb` contains two showcase canisters; runtime uses only the complete upright one. `gas_mask.glb` is normalized to a 0.32 m presentation height and follows all four built-in rigs plus the procedural avatar. The first-person arm meshes remain separate. Smoke and flash use `smoke_granade.glb` and `flashbang_grenade.glb` rather than reused substitutes.

Throwable art fits the unchanged 0.09 m collision sphere. Shared caches, bounded yellow cloud cards/vents, fallback art and expiry/disposal guards keep presentation independent of authority. Yellow interior fog remains even when protected; these are bounded effects, not fluid simulation.

**The mask is CC BY-NC 4.0 by David Wigforss: non-commercial conditions apply.** The gas, smoke and flash uploads identify CC BY 4.0. See [exact credits and source links](../public/models/guns/CREDITS.md); code licensing does not grant commercial rights to models.

## Checks

```sh
python tools/test-poison-gas.py
python tools/test-grenades.py
node tools/test-poison-gas-browser.mjs
GAS_LOBBY_TEST=1 node tools/test-room-lobby.mjs
GAS_ASSETS_ONLY=1 MASK_MODEL_SHOTS=/tmp/mask node tools/test-poison-gas-browser.mjs
GAS_MOBILE_ONLY=1 node tools/test-poison-gas-browser.mjs
```

See [test setup and limits](testing.md). Suites exercise authority timing, walls/floors, life validation, real Solo/mobile inputs, mask pixels, cleanup and tab/isolated-RTC synchronization; they do not certify real-world respiratory protection or cross-NAT reachability.

中文：M 或手机按钮佩戴/取下面具；密封需要 0.75 秒，不能瞬间免伤。面具仅防毒，不透烟、不防弹、不防火或闪光；死亡后要重新佩戴。模型为非商业许可，商用前必须审查或替换。
