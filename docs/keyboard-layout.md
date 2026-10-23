# Keyboard layout / 自定义键位

Open **Settings → Keyboard layout** from the main menu, or **Esc → Settings** during a match. Click a binding, press the desired key, and it applies immediately. Back from in-match Settings returns to the pause menu; resume when ready.

## Editing

- All **22 keyboard actions** are configurable: movement, sprint, crouch, jump, reload, primary/secondary/toggle, class ability, grenade throw/type, mask, view, scoreboard, chat and four keyboard-look directions.
- Each action supports **up to two keys**. Click **×** to clear a binding; an empty action shows Unbound. Clearing the first alternative moves the remaining key into its place.
- A key cannot belong to two actions. Clear the conflicting binding before reassigning it. Press **Esc** or click the active binding again to cancel; **Restore default keys** restores the complete default layout.
- **Esc remains reserved** for pause/cancel. Alt/Meta, F5/F11 and unsupported/browser shortcut combinations cannot be assigned. OS/browser shortcuts can still intercept some keys.
- Keys use physical `KeyboardEvent.code` positions, not typed characters. Labels use standard Latin key names. Left/right Shift share one binding, as do left/right Ctrl; the number row and numeric keypad remain distinct.
- Mouse fire/aim, native pointer lock and mobile joystick/button layouts are **unchanged**. Edit mobile positions through the existing mobile layout editor.

The custom chat key opens chat; **Enter still sends text and Esc cancels** inside the chat field. Gameplay bindings do not intercept typing or keyboard navigation in Settings. Menu field submission keys are not gameplay bindings.

## Saving and safety

Layouts are local to this browser/site, under **`tf.keyBindings.v1`**, with a versioned, validated schema. A successful write is remembered after reload. Storage denial/quota failures keep editing available in memory and explicitly warn that persistence is unavailable. Corrupt/unsupported saved data falls back to a whole default layout rather than partially applying it.

Key hints in the field guide, weapon selection, ability/grenade HUD and desktop tutorial follow the layout. Changing bindings clears held movement, firing/aiming, charged throws and scoreboard state so old keys cannot remain stuck. Two alternate hold keys release their action only after both are lifted. Settings capture never sends a throw or gameplay command.

Local-profile export includes the keyboard layout; Clear local data also restores default bindings. Preferences are not cloud accounts and are not sent to other players. Downloaded profile export is a backup, not a new layout-import UI.

## Source and checks

[Action/schema definitions](../public/js/key-bindings.js) · [Settings UI and persistence](../public/js/key-settings.js) · [Gameplay input](../public/js/controls.js)

```sh
node tools/test-key-bindings.mjs
node tools/test-weapon-keys.mjs
node tools/test-key-settings.mjs
node tools/test-operations.mjs
```

See [test setup and limits](testing.md). Unit checks exercise real control callbacks and movement; browser checks cover native Settings interactions, persistence/failures, translated responsive layouts, live Solo movement and pause-menu return. These are not physical-keyboard/device or cross-network certification.

中文：在「设置 → 键盘按键布局」点选按键，再按新键即可立即生效，每个操作最多两键。冲突需先清除，Esc 取消，恢复默认可找回所有默认键位。布局保存在当前浏览器/站点；无法保存时会明确提示。桌面鼠标与手机按钮布局不受影响，对局中可从暂停菜单进入并返回。
