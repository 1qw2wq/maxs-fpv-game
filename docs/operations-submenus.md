# Selection, settings and match submenus

Menus use charcoal/olive surfaces and amber actions. The in-match HUD uses neutral charcoal information cards, cool accents, distinct team colors and transparent mobile controls. Health and ammo sit in separate cards: the full-width status positioning rail has **no background, border, blur or shadow**.

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

[operations.css](../public/css/operations.css) loads after `style.css`. [hud.css](../public/css/hud.css) separately owns in-match surfaces, compact health/ammo/utility cards and mobile-safe typography; landing-specific rules load afterward. The menu theme must not paint `#statusbar`. `.operations-game` and tool classes scope the theme. Baseline layout still owns overlay anchoring, touch controls and battlefield scroll budgets.

Settings and tool shells do not change combat authority, weapon calibration, native pointer lock or the [host approval/Ready/Start contract](host-approved-lobby.md). Mobile controls remain layout-editable with fullscreen support. Static deployment needs no frontend npm install/build, external fonts or required backend.

Use [Gun Lab](gun-placement-lab.md) for placement—not the selection preview—and [diagnostics](diagnostics.md) for scoped connection checks.

## Checks

```sh
node --check public/js/hud.js
node tools/test-operations.mjs
node tools/test-hud.mjs
node tools/test-landing.mjs
OPS_SCREENSHOTS=1 node tools/test-operations.mjs
```

See [test setup](testing.md). Coverage includes bilingual reachability, keyboard/selected states, death-picker persistence, tool return links and export availability. Animation Lab shell checks do not validate every clip; Gun Lab export availability is not an exhaustive placement audit. Screenshots stay in `/tmp`.

中文：选人/选枪、设置、教程、暂停、死亡重部署与工具页共用界面风格，但不改变战斗或网络规则。键盘可操作原生按钮，小屏通过正常滚动访问全部操作。

`HUD_SCREENSHOTS=1 node tools/test-hud.mjs` saves desktop/mobile fixtures and a real Solo screenshot in `/tmp`. HUD checks cover transparent rails, bilingual layouts, touch-lane separation, low health, empty ammo/reload, reduced motion and live authoritative readouts. They are not an FPS or physical-device benchmark.
