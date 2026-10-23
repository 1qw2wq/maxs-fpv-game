# Selection, settings and match submenus

The interface uses charcoal/olive surfaces, amber actions, fine borders and compact field labels while retaining distinct team colors and transparent mobile controls.

## Screens and actions

| Screen | Purpose |
| --- | --- |
| Class/loadout | Choose class, its primary, universal secondary and character; Back/Ready/Deploy/Start reflect the current Solo or lobby flow |
| Keyboard layout | Assign main/alternate keys, clear conflicts, restore defaults and save locally; [details](keyboard-layout.md) |
| Character workshop/settings | Preview/import characters, map bones, adjust sliders, save locally, reset, upload or export; choose interface language |
| Tutorial/manual | Step list, key hints, practice/skip actions and nonblocking in-game guidance |
| Match panels | Pause, invite/answer, scoreboard, results and death/redeploy loadout choices |
| Developer tools | Diagnostics, color repair, Gun Lab and Animation Lab, each with return navigation |

Class/weapon cards are native buttons with Enter/Space activation and `aria-pressed` selected states. Remembered selections survive language changes. Panels stack/scroll on narrow displays; no sticky footer should cover selection actions. Focus-visible styling, reduced-motion treatment and large redeploy choices support accessibility, but this is **not a full accessibility certification**.

Game UI supports English/Chinese; decorative operation labels and standalone tools retain their own existing language coverage, not a separate full translation guarantee.

## Boundaries and source

[operations.css](../public/css/operations.css) loads after `style.css`; landing-specific rules load afterward. `.operations-game` and tool classes scope the theme. Baseline layout still owns overlay anchoring, touch controls and battlefield scroll budgets.

Settings and tool shells do not change combat authority, weapon calibration, native pointer lock or the [host approval/Ready/Start contract](host-approved-lobby.md). Mobile controls remain layout-editable with fullscreen support. Static deployment needs no frontend npm install/build, external fonts or required backend.

Use [Gun Lab](gun-placement-lab.md) for placement—not the selection preview—and [diagnostics](diagnostics.md) for scoped connection checks.

## Checks

```sh
node --check public/js/hud.js
node tools/test-operations.mjs
node tools/test-landing.mjs
OPS_SCREENSHOTS=1 node tools/test-operations.mjs
```

See [test setup](testing.md). Coverage includes bilingual reachability, keyboard/selected states, death-picker persistence, tool return links and export availability. Animation Lab shell checks do not validate every clip; Gun Lab export availability is not an exhaustive placement audit. Screenshots stay in `/tmp`.

中文：选人/选枪、设置、教程、暂停、死亡重部署与工具页共用界面风格，但不改变战斗或网络规则。键盘可操作原生按钮，小屏通过正常滚动访问全部操作。
