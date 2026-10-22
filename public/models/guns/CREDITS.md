# Uploaded sniper model credits

Game labels do not replace the original model titles or licenses. The uploaded GLB files are unchanged. At runtime the game rescales/reorients them, renders skinned weapon meshes as static geometry, and adapts the Longbow’s legacy diffuse material for the current renderer.

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

The AWP metadata specifies a **non-commercial** license. The Longbow model specifies the Sketchfab Standard license; this credit file does not grant additional rights to that model or the Titanfall intellectual property. Verify permission before commercial use or redistribution beyond the original license terms.

## Uploaded grenade bodies

### Granade M26

- File: `granade_m26.glb`
- Author: Pablo88 (https://sketchfab.com/Pablo88)
- Source: https://sketchfab.com/3d-models/granade-m26-ce7c6e5250d841a08a790de5c2f5ecc4
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

### Hand Granade

- File: `hand_granade.glb`
- Author: DireRaven (https://sketchfab.com/direraven)
- Source: https://sketchfab.com/3d-models/hand-granade-ea6fbc4363804dfda45d784a36dc9248
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

### Toon_Granade

- File: `toon_granade.glb`
- Author: faroface (https://sketchfab.com/faroface)
- Source: https://sketchfab.com/3d-models/toon-granade-4916b6f78b804bacb39eab3a24e02bd6
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

Runtime presentation normalizes scale/pivot, adds type-identification collars, and omits the Toon upload’s expanded black outline shells. Original uploaded GLBs are unchanged. Incendiary still reuses Hand Granade. Smoke/flash now use the dedicated uploads below; the older Toon file remains in the repository but is not the active smoke mapping.

## Newly uploaded gas / mask / smoke / flash assets

### Gas Grenade

- File: `gas_grenade.glb`
- Author: LiliumLetifer (https://sketchfab.com/LiliumLetifer)
- Source: https://sketchfab.com/3d-models/gas-grenade-86246492f2114484b867ec2b28ebec5c
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

### Gas Mask

- File: `gas_mask.glb`
- Author: David Wigforss (https://sketchfab.com/dwigfor)
- Source: https://sketchfab.com/3d-models/gas-mask-2eb180c68ac146989a8a3247ab19b6ae
- Embedded license: CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)

### Smoke granade

- File: `smoke_granade.glb`
- Author: deepak (https://sketchfab.com/dcdeepakdc)
- Source: https://sketchfab.com/3d-models/smoke-granade-122abbcbd0fc49d2a0b157dd63730da0
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

### Flashbang grenade

- File: `flashbang_grenade.glb`
- Author: Nikolay Kudrin (https://sketchfab.com/knik211)
- Source: https://sketchfab.com/3d-models/flashbang-grenade-2799b0b859c74db6ae8752fdc6bb4c04
- Embedded license: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

**Gas Mask is CC BY-NC 4.0 (non-commercial), not CC BY 4.0.** Its use remains subject to those original terms; neither this attribution nor the game's code license grants commercial rights. Review/replace restricted assets before commercial deployment.

Runtime adaptations: the gas-grenade showcase contains two complete copies; only its upright canister is used. Throwable bodies are centered/upright, scaled together with their identification collar to fit the existing collision envelope. The mask is centered/scaled and attached to avatar faces. Textures and source GLBs are unchanged. Detailed implementation and licensing notes: [poison gas and mask](../../../docs/poison-gas-and-mask.md).
