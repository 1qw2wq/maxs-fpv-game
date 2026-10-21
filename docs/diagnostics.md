# Independent diagnostics: game status vs. a local P2P test

## Why the page used to say “main.js did not run”

`debug.html` is deliberately separate from the game. It loads `js/debug.js` and the lightweight P2P transport, but **does not load `js/main.js`**. `window.__trench` is a game-page global; it is not shared between documents, including tabs on the same origin. Navigating from the landing page to diagnostics replaces the game document rather than carrying that global along.

The old status code interpreted the absence of `window.__trench.app` in diagnostics as a failed game startup. That was a false warning: this page was never supposed to start the game. Reloading diagnostics cannot fix it, and loading the entire game into diagnostics just to remove the warning would defeat its independent purpose.

The corrected panel:

- Says **“Not started on this diagnostics page (expected)”**, neutrally, in English/Chinese.
- Explains the separate scripts and directs startup investigations to the console on `index.html`.
- Does not claim that the unobserved game either failed or booted successfully.
- Marks copied multiplayer reports with `scope: "current-document-only"` and `runtimeStatus: "not-applicable-on-diagnostics-page"`. Existing empty transport / null engine values mean unobserved, not a failed engine. The optional developer view of an actual same-document app handle remains available and is labeled `app-handle-present`, not “boot succeeded”.
- Leaves real API and P2P failure indicators intact.

## What the P2P success means

The local self-test creates two real WebRTC peers inside this browser, packs/exchanges invite and answer codes using the same transport module as the game, and sends one message each way. It does **not** load the game, inspect another tab, certify game launch, or prove connectivity between two devices/home networks. Its result now states that scope explicitly.

## CSS warning in the report screenshot

An ignored/late CSS `@import` warning is not a JavaScript module-load failure. No `@import` rule exists in the current project stylesheets/HTML. The focused Chromium check did not reproduce a late-import issue on diagnostics or the game page. The screenshot's collapsed “2 sources” does not identify the offending stylesheet, so no fix to an unknown external/injected stylesheet is claimed. Inspect the affected resource URLs if that separate warning persists.

## Regression check

```sh
node --check public/js/debug.js
node tools/test-diagnostics.mjs
```

Like the other browser regressions, this uses test-only Playwright/Chromium packages outside the repository (`/tmp/maxs-fpv-browser-tests`, or `TEST_DEPS`; optional `CHROMIUM_EXECUTABLE`). No production dependency or build step is added.

Verified: both languages, neutral unobserved status, no game/engine module requests from diagnostics, re-probing and scoped report copies, actual bidirectional same-browser RTC self-test, 1280/390/320px layouts, visible real HTTP 503 failure, optional same-document app status, and the actual Back link loading `main.js` with the game boot overlay dismissed. No JavaScript errors or late-import issues in this focused check. `DIAGNOSTICS_SCREENSHOTS=1` saves a review screenshot in `/tmp`.
