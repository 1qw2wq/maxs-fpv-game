# Landing page / operations room redesign

The landing page is organized as a game launcher rather than a single narrow stack:

1. A compact brand/language header and battlefield campaign hero.
2. Two desktop cards: callsign/room/host-approval roster on the left; rules/map selection on the right.
3. A dedicated launch bar containing multiplayer and solo actions only.
4. A separate bottom utility section for tutorial, character setup and control preferences.
5. A native expandable field guide containing the optional legacy server address, followed by
   connection diagnostics, Gun Lab and character color-repair links.

At narrow widths, cards/actions stack in document order. There is one scrollport, no sticky action
bar overlaying inputs, and no new custom scrolling or gesture interception. The hero becomes compact
when a room is active so approval requests take priority. Focus indicators, reduced-motion behavior,
and English/Chinese copy are retained. Control preferences still use the existing persistent handlers.

## Scope

- `public/css/landing.css` is scoped to `#screen-menu` / new landing classes. Gameplay HUD, selection
  controls, pointer-lock behavior and touch controls keep their existing layouts and handlers.
- Existing element IDs and actual controls were moved, not duplicated. The host-approval protocol,
  map authority, Ready/start and paired-channel reuse are unchanged.
- `main.js` changes are presentation copy only: the host action now describes creating a lobby,
  the initial static-host hint is shorter, and the English language switch includes a Latin `ZH`
  label alongside Chinese so it remains identifiable on systems without CJK glyphs.
- `public/images/landing-battlefield.jpg` is generated promotional environment art (~160 KB), not
  a screenshot or a promise that a map exactly matches the illustration. The three small SVG map
  diagrams are decorative, schematic previews, not authoritative collision/navigation maps.
- No runtime package, external font/CDN, required backend, or build step was added.

## Checks

```sh
node tools/test-landing.mjs
node tools/test-room-lobby.mjs
```

Use the existing external test-only Playwright/Chromium dependencies as documented for
`tools/test-vercel.mjs`; installation is not needed to play or deploy the game.

Verified:
- Existing 172 English/Chinese desktop/mobile layout checks (menu, selection, settings, modals and HUD).
- Two languages × five viewport sizes (1440×1100, 1024×768, 390×844, 320×568, 740×360).
- Every primary/bottom utility action is scroll-reachable, hit-testable, and within the viewport.
- Advanced options open/close natively and fit narrow screens; optional server input remains available.
- Actual main.js room creation/leave, name locking, character setup and tutorial opening.
- Full focused lobby flow: reject/retry/approve, automatic guest selection, host map/rule locks,
  readiness changes, selected-primary preservation, failed-engine retry, synchronized launch,
  approved-seat recovery, unauthorized join rejection, leave and host shutdown.
- Actual invite/answer UI with separate storage contexts and BroadcastChannel/WebSocket disabled:
  paired RTC channel survives launch and carries chat.
- No browser JavaScript errors in these checks.

`LANDING_SCREENSHOTS=1 node tools/test-landing.mjs` saves desktop/phone screenshots in `/tmp` for
visual review, without putting test output or browser binaries in the repository. Static harnesses
now serve JPEG/SVG MIME types for the landing assets. The much larger general gameplay suite was
not rerun for this presentation-only change; its previously documented unrelated live remote
weapon-attachment assertion is not represented as fixed.
