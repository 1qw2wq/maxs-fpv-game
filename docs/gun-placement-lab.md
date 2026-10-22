# Third-person Gun Lab / 第三人称持枪调校

Open **`/gun-lab.html`** on the running site or choose Gun Lab from the main menu. This static developer tool uses the game's uploaded guns, four built-in rigs, procedural avatar and real third-person IK. No backend, npm install or build is needed; serve the site rather than opening local HTML files.

## Tune → record → export

1. Select a weapon and character. `?gun=mp18&skin=builtin-navia` opens a particular preview without changing saved values.
2. Drag to orbit, scroll to zoom, or choose Front/Back/Left/Right/Hands. This developer camera does **not** change gameplay's native pointer-lock controls.
3. Adjust Position XYZ (metres) and Rotation XYZ (degrees). Numeric fields allow finer precision; zero means the shipping baseline, not world origin. Hands follow the real IK.
4. Check idle/walk/sprint/crouch/fire, pitch and multiple rigs. Freeze stops animation while allowing edits; hold Compare baseline to inspect zero offsets temporarily.
5. **Record this gun** after tuning. Weapon switching keeps drafts, but **only recorded guns export**. Editing or resetting a recorded gun changes its draft: record again to replace its export values.
6. Add notes, Copy recorded or Download JSON, and send the **whole JSON file**. Screenshots are useful supplements, not substitutes for units/IDs/frame.

The lab does not automatically edit matches or repository files. It affects neither first-person mounting, grip sockets, ammo, hit rules nor network data. Adjustments are relative to the current baseline and may need rechecking if that baseline changes.

## Coordinate and data contract

- Translation: **animated anatomical chest frame**, metres at avatar scale 1; +Y up, +Z neutral forward. X is chest-frame X, not screen X. Custom avatar scale scales the offset.
- Rotation: intrinsic local **XYZ Euler degrees**, composed **after** baseline carry/aim rotation, pivoting around the **trigger-hand contact**. Rotation alone does not translate that contact.
- Red/green/blue axes show **gun-local** XYZ, rotating with the gun—not chest-frame translation directions.
- Limits: **±0.5 m** translation and **±180°** rotation per axis; six-decimal export precision. Incomplete/out-of-range entries disable recording.
- Values are **per gun, not per skin**. Preview skin/pose/pitch is retained in `context.reviewedOn`. Inspect several rigs; large offsets may exceed reach or clip clothing. Imported-rig wrist error turns amber above 7 cm; it is a diagnostic, not an automatic constraint.

Minimal valid example; actual exports also include model/name metadata and review context:

```json
{
  "schema": "trench-front/third-person-gun-placement",
  "version": 1,
  "frame": "animated-chest-translation; trigger-pivot-local-XYZ-rotation",
  "units": {"position": "metres-at-avatar-scale-1", "rotation": "degrees"},
  "scope": "third-person-only",
  "context": {"notes": "Checked both sides and several rigs."},
  "placements": {"mp18": {"position": [0.025, 0.01, -0.02], "rotation": [0, 7, -3]}}
}
```

## Saving and failure handling

Drafts, records and notes use localStorage **`tf.thirdPersonGunLab.v1`**, separate from game settings. Download a portable backup: private mode, origin/browser changes or cleared storage can lose local records. Storage failure keeps in-memory editing available with a warning; clipboard failure allows manual copying/download.

Import validates the **whole document before merging**, rejecting incompatible schema/frame/units, unknown guns, changed model IDs, non-finite/out-of-range numbers and text over **200,000 characters** (the tool labels this 200 KB). Valid matching records replace drafts/records; omitted guns remain untouched. JSON is data, never executable code.

Editing waits for the real uploaded gun; loading errors are explicit, not silently calibrated against fallback art. New selections supersede pending loads. Production preview APIs `setWeaponPlacement` / `getWeaponPlacement` use baseline unless called; switching gun resets the instance offset and the lab reapplies that gun's draft. There is no global live-match override.

## Source and checks

[Page](../public/gun-lab.html) · [controller](../public/js/gun-lab.js) · [validated contract](../public/js/third-person-placement.js)

```sh
node tools/test-gun-placement.mjs
python tools/test-gun-lab.py
```

See [Python browser setup](testing.md). `GUN_LAB_SCREENSHOT=/tmp/gun-lab.png` saves a preview. Tests cover schema/round-trip, actual catalog/rig previews, trigger pivot, recording/import atomicity, persistence/storage failure and responsive layouts—not physical-phone certification.

中文：选枪和角色，调位移（米）及旋转（度），换姿态/视角检查。**每把调好都要记录；修改或重置后也要重新记录**。复制或下载整份 JSON；工具不会自动修改正式对局。每把枪的参数跨角色共用，请检查多个骨架并下载备份。
