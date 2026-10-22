# Weapon, grenade and mask credits

These entries preserve embedded GLB author/source/license metadata for the listed assets, not a complete rights audit of every model in the repository. Game labels do not replace original titles or licenses. Original uploaded binaries are unchanged.

**AWP and Gas Mask are CC BY-NC 4.0 (non-commercial).** Longbow uses the **Sketchfab Standard** license; this file grants neither additional model rights nor rights to Titanfall intellectual property. Review permissions or replace restricted assets before commercial deployment/redistribution. Code licensing does not override asset terms.

## Sentinel SR-1

- File: `sniper.glb`
- Original title: Sniper
- Author: DJMaesen (https://sketchfab.com/bumstrum)
- Source: https://sketchfab.com/3d-models/sniper-cdefd833b4b5407ba32c53c9e7f50cae
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## AWP

- File: `sniper_rifle_-_awp.glb`
- Original title: Sniper Rifle - AWP
- Author: MKoegler3D (https://sketchfab.com/MKoegler3D)
- Source: https://sketchfab.com/3d-models/sniper-rifle-awp-8fc399244b9d49bfb6841d477f968c0e
- Embedded license: CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)

## Longbow DMR

- File: `titanfall_2_weapon_longbow-dmr_sniper.glb`
- Original title: TitanFall 2 Weapon Longbow-DMR Sniper
- Author: 零宽不连字 (https://sketchfab.com/LkblZ)
- Source: https://sketchfab.com/3d-models/titanfall-2-weapon-longbow-dmr-sniper-97e0b17120ed4701b553186b3bf98412
- Embedded license: SKETCHFAB Standard (https://sketchfab.com/licenses)

## Frag: Granade M26

- File: `granade_m26.glb`
- Original title: Granade M26
- Author: Pablo88 (https://sketchfab.com/Pablo88)
- Source: https://sketchfab.com/3d-models/granade-m26-ce7c6e5250d841a08a790de5c2f5ecc4
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Incendiary: Hand Granade

- File: `hand_granade.glb`
- Original title: Hand Granade
- Author: DireRaven (https://sketchfab.com/direraven)
- Source: https://sketchfab.com/3d-models/hand-granade-ea6fbc4363804dfda45d784a36dc9248
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Smoke granade

- File: `smoke_granade.glb`
- Original title: Smoke granade
- Author: deepak (https://sketchfab.com/dcdeepakdc)
- Source: https://sketchfab.com/3d-models/smoke-granade-122abbcbd0fc49d2a0b157dd63730da0
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Flashbang grenade

- File: `flashbang_grenade.glb`
- Original title: Flashbang grenade
- Author: Nikolay Kudrin (https://sketchfab.com/knik211)
- Source: https://sketchfab.com/3d-models/flashbang-grenade-2799b0b859c74db6ae8752fdc6bb4c04
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Gas Grenade

- File: `gas_grenade.glb`
- Original title: Gas Grenade
- Author: LiliumLetifer (https://sketchfab.com/LiliumLetifer)
- Source: https://sketchfab.com/3d-models/gas-grenade-86246492f2114484b867ec2b28ebec5c
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Gas Mask

- File: `gas_mask.glb`
- Original title: Gas Mask
- Author: David Wigforss (https://sketchfab.com/dwigfor)
- Source: https://sketchfab.com/3d-models/gas-mask-2eb180c68ac146989a8a3247ab19b6ae
- Embedded license: CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)

## Included legacy asset: Toon_Granade

- File: `toon_granade.glb`
- Original title: Toon_Granade
- Author: faroface (https://sketchfab.com/faroface)
- Source: https://sketchfab.com/3d-models/toon-granade-4916b6f78b804bacb39eab3a24e02bd6
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Runtime adaptations and current use

- Weapons are scaled/reoriented; skinned weapon meshes are presented as static assemblies. Longbow's legacy diffuse material is adapted for the renderer. Gun-specific display/duplicate filtering and grip/reload presentation are described in [the arsenal guide](../../../docs/arsenal-and-sidearms.md).
- Throwable bodies are normalized in scale/pivot/orientation and receive type-identification collars inside the existing collision envelope. Incendiary uses Hand Granade; smoke and flash use their dedicated uploads.
- Gas uses only the complete upright canister from its two-copy showcase. The mask is centered/scaled and attached to avatar faces; source textures remain unchanged.
- Toon_Granade remains included but is **not the active smoke mapping**. Its runtime adapter omits expanded black outline shells when used.

[Grenade behavior and effects](../../../docs/grenade-models-and-effects.md) · [Gas, mask and non-commercial restriction](../../../docs/poison-gas-and-mask.md) · [Character credits](../genshin/CREDITS.md)

中文：署名不等于额外授权；AWP 与防毒面具有非商业限制，Longbow 另受 Sketchfab Standard 及相关 IP 权利约束。商用或再分发前须核对原始条款。
