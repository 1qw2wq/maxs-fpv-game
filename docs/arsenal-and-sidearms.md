# Weapons and loadouts

The shared [weapon table](../public/shared/weapons.json) contains **26 primaries and four secondaries**. Each class equips one of its primaries and any one sidearm.

| Class | Primary weapons |
| --- | --- |
| Assault | MP18 Bergmann, Automatico M1918, Hellriegel M1915, Beretta PMX, LR-300, MP5 |
| Medic | Cei-Rigotti, RSC M1917, Fedorov Avtomat, AR-15 Tactical, M4A1 |
| Support | Lewis Gun, BAR M1918, Chauchat M1915, M249 SAW, M60 Light, M60 Vietnam |
| Scout | SMLE MkIII, Mannlicher M95, Springfield M1903, Sentinel SR-1, AWP, Longbow DMR, GM6 Lynx, M170 Precision, PGM Ultima Ratio |

Sidearms: **Beretta APX Carry, G17 Gen 5, Desert Eagle, Flare Pistol**. The flare pistol fires the collision-tested spotting flare from its own ammunition, not class-ability/grenade charges. GM6 is semi-automatic; M170/PGM use scoped bolt behavior. SMLE, M95 and Springfield are **iron-sight-only**; scoped models and the AR-15 optic use their actual sight presentation.

## Selection and inventory

- **1** selects primary, **2** selects secondary (number row or keypad); **X** toggles. Mobile has a dedicated, layout-editable Switch weapon button.
- Choose a sidearm under the primary cards or in the death/redeploy picker. Class changes retain that selection; the local profile remembers it. Invalid/missing secondaries default to APX.
- The HUD shows the active slot's ammo; other players see the actual equipped gun.
- Each slot keeps its own magazine, reserves and accepted-shot timestamp. Switching takes **350 ms**, cancels reload, never refills ammo, and is unavailable while dead. Seated clip-fed rounds are billed once. Respawn refills both inventories and selects primary.
- Native Python, Solo/Pyodide and browser-hosted multiplayer use the same authoritative inventory validation; a primary cannot occupy the secondary slot.

## Models, grips and reloads

[Gun loading](../public/js/guns.js) defines per-model orientation, scale and offsets. Display stands, duplicate showcase guns and loose accessories are filtered at runtime where needed; uploaded GLBs are unchanged. The G17 muzzle follows its barrel rather than its flashlight. The flare pistol keeps one complete gun; M60 Vietnam keeps one assembled copy.

[Hand contacts](../public/js/weaponpose.js) specify each gun's trigger, support, service and ejection positions. Hip placement, ADS reach and pistol support wraps are gun-specific, not a single global offset. Imported arms use IK when reachable and a connected procedural glove pair otherwise; contacts are not moved merely to hide an unreachable wrist.

[Reload motion](../public/js/reload-motion.js) gives all 30 weapons distinct feed timing, tilt, withdrawal and recovery profiles. First- and third-person hands follow the same sockets and authoritative progress. These are procedural motions around static assemblies, **not newly articulated magazine/bolt meshes or baked mechanical clips**. Presentation does not change ammo or completion/cancellation rules. Existing sound recordings use per-gun trims/effects with synth fallback.

For manual third-person adjustments, use [Gun Lab](gun-placement-lab.md). For original authors, sources and restrictions—including non-commercial assets—see [asset credits](../public/models/guns/CREDITS.md).

## Checks

```sh
python tools/test-secondaries.py
node tools/test-weapon-keys.mjs
node tools/test-gun-calibration.mjs
node tools/test-gun-calibration.mjs /tmp/gun-audit
node tools/test-reload-motion.mjs
CITY_LIVE=1 python tools/test-expanded-assets.py
```

Calibration reads actual assembled geometry and can export annotated silhouettes. Browser tests cover selection, switching, ammo, hands and relay synchronization; see [test setup and outstanding validation limits](testing.md).

中文：每个兵种可选主武器和任一手枪；1/2 切换主副武器，X 循环。换枪不会补弹。老式无镜步枪不套用狙击镜特效；手部、持枪与装填按实际枪型设置。
