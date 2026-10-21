# Third-person gun-placement lab / 第三人称持枪调校

Open **`/gun-lab.html`** on your running game site, or click **第三人称持枪调校 / Gun Lab** in the main menu.
It is a static developer page: no account, backend, npm install or frontend build is needed. Serve the
site normally rather than opening an HTML `file://` URL. It uses the same vendored Three/GLTF loader,
uploaded gun models, four built-in character skeletons and third-person IK as the game.

## Tune, record, send

1. Select a **weapon** and **character**. All weapons come from `shared/weapons.json`; there is no
   separate hard-coded gun list. You can also inspect the procedural fallback character.
2. Drag on the canvas to orbit, scroll to zoom, or use **Front / Back / Left / Right / Hands**.
   This is an orbit camera for development only; it does not change the game's native pointer-lock controls.
3. Adjust **Position X/Y/Z** in metres and **Rotation X/Y/Z** in degrees using sliders or numeric boxes.
   Numeric entries allow finer precision than the sliders. Changes are immediate and both hands follow
   the gun via the real IK pipeline. Zero values mean the current game baseline, not the world origin.
4. Try idle, walk, sprint, crouch and firing poses, vary the aim pitch, and inspect multiple skins.
   **Freeze animation** stops animation time while allowing camera and placement adjustments.
   **Hold: compare baseline** temporarily shows zero offsets; release to restore the draft.
5. Click **Record this gun**. Repeat for other guns. Switching weapons preserves each gun's draft;
   only recorded guns go into the export. After changing a recorded gun, record it again to replace
   its previous values. **Reset this gun** resets the draft only; record again to export that reset.
6. Add notes, then click **Copy recorded** or **Download JSON**. Send the JSON file or paste the whole
   document into our chat. Optional screenshots from front/side help explain clipping or intent.

**The lab does not automatically modify matches.** The exported numbers are the requested third-person
adjustments I can apply to the repository later. First-person mounting, grip/socket calibration, ammo,
aim/hit rules and network data are not edited by the page.

## Numbers and coordinate convention

- Position is a delta in the **animated anatomical chest frame**, in metres at avatar scale 1. `+Y`
  is up and `+Z` is forward in the neutral character frame. X is the frame's X, not camera/screen X.
  Imported characters with a custom avatar scale scale these offsets with the avatar.
- Rotation is a delta composed **after the existing carry/aim rotation**, using local intrinsic **XYZ**
  Euler angles in **degrees**. Rotation pivots around the **trigger-hand contact**, not the gun origin;
  changing rotation alone therefore does not translate the trigger grip away from its baseline contact.
- Red / green / blue axes on the gun show **gun-local X / Y / Z**. These rotate with the gun, unlike
  chest-frame position directions. They can be hidden with **Gun axes**.
- Range limits: position ±0.5 m per axis; rotation ±180° per axis. Export precision is six decimals.
  An out-of-range/incomplete numeric entry disables recording until corrected.
- Placement is **per gun, not per skin**. Character selection is a preview context. Check the same
  adjustment on multiple rigs before recommending it globally. The export also records the preview
  skin/pose/pitch used when each gun was recorded (`context.reviewedOn`).
- Large offsets or rotations may exceed arm reach or clip clothing/the body. The wrist-error indicator
  turns amber beyond 7 cm on imported rigs; it is diagnostic, not an automatic physical constraint or
  a guarantee that the skin does not clip. The procedural preview requires visual inspection.

An example record (the actual export also includes readable weapon/model metadata and review context):

```json
{
  "schema": "trench-front/third-person-gun-placement",
  "version": 1,
  "frame": "animated-chest-translation; trigger-pivot-local-XYZ-rotation",
  "units": { "position": "metres-at-avatar-scale-1", "rotation": "degrees" },
  "scope": "third-person-only",
  "context": { "notes": "MP18 was clipping the coat; checked from both sides." },
  "placements": {
    "mp18": {
      "position": [0.025, 0.01, -0.02],
      "rotation": [0, 7, -3],
      "name": "MP 18",
      "model": "mp18"
    }
  }
}
```

Send the **whole file**, not just a screenshot of sliders. The stable gun IDs, units and frame prevent
confusing radians/degrees, absolute values/deltas, or first-person/third-person coordinates. These are
relative adjustments to this lab version's game baseline; retain your notes/screenshots if the baseline
changes in a later revision. A file calibrated on another baseline may need rechecking.

## Saving, imports and failures

- Drafts, recorded values and notes are saved under **`tf.thirdPersonGunLab.v1`** in this browser's
  local storage. This is separate from the game's profile/settings. A downloaded file is the portable
  backup; clearing browser data, changing browser/origin, or using private mode can lose local records.
- **Import JSON** validates the entire document before merging. Valid records replace matching gun
  records/drafts; omitted guns stay untouched. Unknown guns, changed model IDs, invalid/non-finite
  numbers, incompatible schema/frame/units and files over 200 KB are rejected without partial application.
- Storage refusal/quota failure leaves the tool usable in memory and shows an explicit warning.
  Download before closing. Clipboard refusal selects the JSON for manual Ctrl/Cmd+C; Download remains
  an alternative. Imports are JSON data only: they do not run code or write server/repository files.
- Loading failures are shown explicitly. Editing is disabled until a real uploaded gun has loaded;
  a procedural gun fallback is not silently presented as a calibrated uploaded model. Choose another
  setup or refresh to retry. Selecting another gun while loading is supported; the latest request wins.
- Use `?gun=mp18&skin=builtin-navia` to open a particular setup. This changes selection, not stored values.

## Implementation and verification

- Page/controller/style: `public/gun-lab.html`, `public/js/gun-lab.js`, `public/css/gun-lab.css`.
- Data contract: `public/js/third-person-placement.js` (strict validation and JSON import/export).
- TP-only preview APIs on imported/procedural characters: `setWeaponPlacement` / `getWeaponPlacement`.
  Without a caller setting offsets, both use the existing baseline; switching guns resets the instance's
  preview adjustment, and the lab reapplies the selected gun's draft. There is no global live-game override.
- `node tools/test-gun-placement.mjs`: dependency-free schema/units/ranges/ID/round-trip tests.
- Optional actual-browser test, with external Python Playwright and a Chromium executable:

  ```sh
  python -m http.server 8080 --bind 0.0.0.0 --directory public
  # In another shell:
  CHROMIUM_EXECUTABLE=/path/to/chromium CITY_ORIGIN=http://127.0.0.1:8080 \
    python tools/test-gun-lab.py
  ```

The browser test uses every catalog gun on all four imported rigs plus the procedural character,
checks trigger-pivot invariance and metre-scale translation, and exercises recording, download/import,
invalid-import atomicity, persistence, denied storage, baseline comparison and responsive layouts.
`GUN_LAB_SCREENSHOT=/tmp/gun-lab.png` optionally saves a preview. Browser dependencies are test-only,
not part of the frontend or Vercel deployment. Physical phones and deployed-Vercel connectivity are
not claimed as tested by this tool's local WebGL/UI checks.

## 中文快速说明

打开 `/gun-lab.html`，选择枪械和角色，用 XYZ 位移（米）与 XYZ 旋转（度）调位置，双手会跟随真实 IK。
从多个方向检查，也可试行走、冲刺、蹲下、开火姿态和俯仰；按住比较按钮暂看默认位置。
**调好一把就点「Record this gun / 记录这把枪」**，再换下一把；未记录的草稿不会导出。
最后复制或下载 JSON，整份发给我即可据此修改第三人称持枪位置；截图可作为补充说明。

参数是相对当前默认持枪姿态的偏移，不是绝对世界坐标；旋转绕扳机握点，顺序为局部 XYZ，单位是度。
位移用动画胸部坐标系，不等于屏幕左右；图上红绿蓝轴是枪的局部 XYZ。每把枪一组参数，在不同角色间共用，
因此建议换几套骨架检查。重置只改草稿，需要再次记录才会覆盖导出值。大幅调整可能超出手臂可达范围，
橙色误差提示需要人工检查，而不是自动修正。

草稿与记录保存在当前浏览器，但请下载备份；更换浏览器、站点来源、隐私窗口或清除数据都可能丢失记录。
可导入之前导出的 JSON 接着调，不匹配的格式/单位/枪 ID/模型或非法数值会整份拒绝，不会只应用一部分。
本页只做预览，不会自动修改正式对局、第一人称、弹药、射击规则或服务端文件，也不需要 npm/构建/外部后端。
