# Expanded arsenal and secondary inventory

The latest upload is integrated as **11 additional primaries and four selectable sidearms**. The shared
weapon table now contains **26 primaries + 4 secondaries**. All thirty uploaded gun GLBs are mapped.

| Class | Added primary models |
| --- | --- |
| Assault | Beretta PMX, LR-300, MP5 |
| Medic | AR-15 Tactical, M4A1 |
| Support | M249 SAW, M60 Light, M60 Vietnam |
| Scout | GM6 Lynx, M170 Precision, PGM Ultima Ratio |

Every class chooses exactly one secondary: **Beretta APX Carry, G17 Gen 5, Desert Eagle or Flare Pistol**.
The flare pistol is a utility weapon: its round launches the shared collision-tested revealing flare,
with its own magazine/reserves. It does not silently become a zero-damage hitscan pistol or spend the
class ability/grenade charges. The GM6 is semi-automatic; M170/PGM use the existing scoped bolt behavior.
Legacy SMLE, M95 and Springfield remain iron-sight-only. The uploaded AR-15 optic is enabled too.

## Controls and loadouts

- **1**: primary; **2**: pistol; **X**: toggle.
- Mobile: dedicated **Switch weapon** button in the third action row. It supports the existing saved
  portrait/landscape control-layout editor and does not replace native desktop pointer lock.
- Sidearm selection appears below the primary cards, is preserved when changing class, and is saved
  in the local profile. The death/redeploy picker can also choose a new pistol.
- HUD shows the active slot and that slot's ammunition. Remote players receive the actual active gun.

`Net`, `LocalNet` and `RelayNet` carry the same validated secondary field on joins/retries; respawn uses
the same field. `Room` and `Match` own inventory in both native Python and browser-hosted Pyodide.
Missing/invalid choices default to APX; a primary can never be equipped through the secondary slot.

Each slot preserves its magazine, reserve and accepted-shot timestamp. Switching has a 350 ms equip
lock, cancels reload, cannot be used while dead, and bills already seated clip-fed rounds exactly once.
Respawn returns to the primary and refills both inventories. Switching never refills ammunition.

## Model placement and hands

`guns.js` contains per-model orientation/scale/offset profiles in metres, with independently inspected
muzzle directions. Loose display parts are filtered via original GLTF node associations:

- AR-15: remove presentation floor/glass/stands and loose magazines/ammunition/alternate accessories.
- G17: keep the installed magazine, frame, slide and Olight; remove the spare display magazines.
  Its flash is calibrated to the gun barrel, **not the forward end of its flashlight**.
- Flare pistol: keep one complete gun instead of the second display variant/loose flares, and correct
  its source pitch so the barrel lies along the firing axis.
- M60 Vietnam: retain one assembled gun rather than both staged copies and spare components.

No uploaded binary was rewritten. Other GLBs retain their source materials and all assembled parts.
`weaponpose.js` supplies individual trigger, support, service and ejection contacts. All thirty weapons
have their own first-person hip placement; ADS reach derives from the actual trigger, not one fixed
camera Z position. The long M170, bullpup GM6, traditional rifles and machine guns therefore mount
at different positions. Support span is anatomically capped before both FP and TP consume it.

Pistols use a close two-handed grip, including a separate support-palm rotation rather than the rifle's
under-fore-end grasp. The same hand frame is used by procedural gloves, imported character IK,
first-person borrowed arms and third-person characters. Recoil, sway and reload still move the hands
with their own weapon sockets. Existing recordings are reused with per-gun effects/sound trims; there
were no new recorded gunfire sounds in the upload. Synth fallback remains available.

## Tests

`python tools/test-secondaries.py` has 12 inventory/validation/equip/reload/respawn/flare/room cases.
The complete Python gameplay set totals 108 tests including city, sniper, AI, movement, cover, survival,
grenade and control-point regressions. `node tools/test-proc-city.mjs` additionally checks 32 seeds.

`tools/test-expanded-assets.py` loads all thirty actual GLBs and checks dimensions, fitted poses,
close pistol contacts, the real selection UI and city collision. With `CITY_LIVE=1`, it additionally
exercises actual Solo/Pyodide, keyboard and touch switching, ammo preservation and two Relay seats.
Existing optional JS hand/aim/effects assertions have been extended to the new thirty-weapon data.
Physical-phone ergonomics and deployed-Vercel connectivity still require device/deployment testing.

### Verified in this workspace

- 108 Python regressions and 32 deterministic map seeds passed.
- Real WebGL: all 30 uploaded model loads/dimensions; 196,796 city collision samples and 144 ramp sprints.
- All 30 ADS sight anchors and actual imported-mesh reticle rays passed, including short pistols.
- Imported hands: **960 poses across four shipped skeletons**. 656 poses used the imported arms;
  unreachable poses correctly fell back to the connected procedural glove pair, rather than stretching a wrist.
- Third-person holds: **23,040 animated frames** across all 30 weapons/four skeletons, including
  direction changes, extreme pitch, reloads and throws. Both wrist-contact errors stayed below 0.001 mm.
- Actual main.js Solo/Pyodide deploy, desktop-key/touch switching and independent sidearm ammo passed.
- Two real RelayHostNet/RelayNet seats retained different pistol selections and synchronized active guns.
- Four portrait/landscape screen sizes passed touch-control overlap checks.
- No missing game assets or uncaught browser errors in the final expanded browser run. Bare-static-host
  API/WebSocket discovery failures and autoplay/legacy-Chromium warnings are expected, not a required backend.
