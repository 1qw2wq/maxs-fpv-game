# Operations-room submenus and interior pages

The landing page's charcoal/olive surfaces, warm amber actions, fine borders and compact field-operation labels now continue through the rest of the interface. This is a presentation/accessibility update, not a gameplay or networking rewrite.

## Screens and navigation

- **Class/loadout selection:** a branded header, numbered class/primary/secondary sections, compact character portraits, quieter weapon statistics, an amber selected state and a separated Back/Deploy footer. Every class still chooses its own primary and one universal pistol. Class and weapon cards use native buttons, support Enter/Space, expose `aria-pressed`, and retain their existing selection callbacks.
- **Character workshop/settings:** matching preview and bone-mapping panels, with shared characters, interface language and local-save tools grouped in three desktop cards. These stack on smaller screens. Import, sliders, reset, local save, upload and export retain their existing IDs and handlers.
- **Tutorial/manual:** the existing step list, key hints and practice/skip actions use the same palette. The in-game guide keeps its existing nonblocking layout; its completion/progression logic is unchanged.
- **Match submenus:** pause, host/guest invite codes, death/redeploy, scoreboard and results have matching panels, restrained typography and report labels. Loading screens carry the TF wordmark. In-match status panels receive palette-only changes; team colors and transparent mobile controls remain distinct.
- **Standalone tools:** diagnostics (`debug.html`), color repair (`colorfixer.html`), third-person Gun Lab and Animation Lab share the same shell, controls and return navigation. Their JavaScript, models and WebGL scene lighting/backgrounds are unchanged. These developer tools retain their existing language support; this does not add a new full translation system to them.

## Implementation and preserved behavior

`public/css/operations.css` loads after `style.css`; the landing-only stylesheet loads afterward. Game rules are scoped to `.operations-game`, and tool rules to `.operations-tool` / the relevant tool class. The existing baseline still controls scroll budgets, overlay anchoring and the battlefield layout. No sticky footer covers the selection controls.

- No runtime packages, build step, external fonts/CDNs, or required backend were added. Static Vercel deployment is unchanged.
- No changes to native pointer lock, touch joystick/button positions, fullscreen behavior, model/weapon placement or combat logic.
- Host approval on the main page, host-owned map/rules, automatic guest selection, Ready and synchronized host Start retain their existing networking paths.
- English/Chinese game controls and remembered selections remain functional. Small uppercase English operation labels are decorative branding, like the landing page's labels.
- Focus-visible indicators, native keyboard activation, reduced-motion styling and 44px redeploy choices are retained. This is focused accessibility work, not a full accessibility audit.

## Regression checks

```sh
node --check public/js/hud.js
node tools/test-operations.mjs
node tools/test-landing.mjs
node tools/test-room-lobby.mjs
```

Browser tests use external test-only Playwright/Chromium dependencies under `/tmp/maxs-fpv-browser-tests` (`TEST_DEPS` can override the path); playing/deploying requires no npm installation. The operations harness also supports `CHROMIUM_EXECUTABLE`. Optional screenshots stay outside Git:

```sh
OPS_SCREENSHOTS=1 node tools/test-operations.mjs
```

Verified in Chromium:

- Death picker: 16 class/pistol combinations, 28 bilingual desktop/mobile layouts, touch-target checks and preserved redeploy selections. The death fixture now loads the actual operations stylesheet and body class.
- Native keyboard class/primary/pistol selection, single selected states and selection preservation across language switches.
- English and Chinese at 1440×1000, 800×600, 390×844, 320×568 and 740×360: scroll/hit-test reachability for loadout, workshop, pause, host/guest invite and tutorial actions; non-overlapping deployment footer. Tutorial progress is reset in the test fixture between profiles, not in production.
- Four utility pages at the same five sizes: no horizontal document overflow, reachable return links, real Gun Lab recording and nonempty JSON/export availability. Actual tool scripts load; Animation Lab assertions cover the shell, not individual clip correctness. Gun Lab export availability is not an exhaustive every-model placement test.
- Existing 172 bilingual PC/mobile menu, selection, settings, modal and multiplayer-HUD layout checks, plus the landing-specific regression checks.
- Native main-page host approval/reject/retry, automatic guest selection, shared map/rules, readiness gating, failed-engine retry and synchronized launch. Separate browser-storage contexts with BroadcastChannel/WebSocket disabled also pair through the actual offer/answer UI, retain RTC through launch and exchange chat.
- No browser JavaScript errors in these focused checks.

These are automated browser checks, not real-device/NAT certification. The broad gameplay suite was not rerun for this UI update, and the previously documented unrelated remote weapon-attachment assertion is not represented as fixed.
