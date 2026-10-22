# Main menu and battlefield setup

The main page is the game launcher and the host's pre-match control room.

## Navigation

- **Header:** brand and English/Chinese language switch.
- **Player/room card:** callsign, room actions, incoming requests and approved roster. Hosts accept/reject guests here rather than entering a match to manage admission.
- **Battlefield card:** map, deathmatch/control rules, Solo AI count, host multiplayer AI count and difficulty. Guests see host-owned lobby settings but cannot change them.
- **Launch actions:** create/request a multiplayer room or start Solo. Approved guests automatically enter selection; host Start launches the ready group after loading.
- **Utilities:** Tutorial, character workshop and control preferences; an expandable field guide provides the optional legacy-server input and links to diagnostics, Gun Lab and color repair.

At narrow sizes the cards/actions stack into one normal scrollport. No sticky launch bar covers inputs. An active room compacts the promotional hero to prioritize requests. Focus indicators, reduced-motion styling and local preferences remain available.

Desktop gameplay uses **native pointer lock**, not cursor/edge steering. Browser gesture/iframe policies can prevent lock; open the site directly when needed. Mobile is a separate joystick/button mode with fullscreen and editable portrait/landscape controls, not a desktop fallback after pointer-lock denial.

## Presentation and source

[landing.css](../public/css/landing.css) scopes main-page layout to `#screen-menu`; [operations.css](../public/css/operations.css) supplies shared interface styling and loads before landing overrides. Controls retain their existing IDs and handlers.

The hero image is **generated promotional environment art, not a gameplay screenshot**. Small map diagrams are decorative schematics, not collision/navigation maps. No external font/CDN, runtime package, required backend or build is needed.

See [approval/Ready/Start](host-approved-lobby.md), [bots](bot-difficulty.md), [interior screens](operations-submenus.md) and the [game guide](../README.en.md).

## Checks

```sh
node tools/test-landing.mjs
node tools/test-room-lobby.mjs
LANDING_SCREENSHOTS=1 node tools/test-landing.mjs
```

See [test setup and limits](testing.md). These check bilingual desktop/narrow/landscape reachability, hit targets, real menu actions and focused lobby flow; screenshots go to `/tmp`. They do not establish device FPS or universal RTC connectivity.

中文：主页负责地图/规则/AI 设置及房主审批；角色选择、准备与统一开始的完整流程见联机指南。手机使用独立触控布局，桌面仍需原生鼠标锁定。
