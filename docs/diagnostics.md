# Diagnostics: scope and interpretation

Open **`/debug.html`** from the main menu to inspect API responses and run a local P2P self-test. It is a separate static page, not a running game instance.

## Game status

Diagnostics loads [debug.js](../public/js/debug.js) and the lightweight transport, **not main.js or the engine**. `window.__trench` belongs to the current document; it is not shared with another tab or carried over by navigation.

Therefore **“Not started on this diagnostics page (expected)”** is neutral. It does not say the game failed—or that an unobserved game booted successfully. To investigate startup, return to `index.html` and inspect **that page's** console/network activity.

Copied reports use `scope: "current-document-only"` and `runtimeStatus: "not-applicable-on-diagnostics-page"`. Empty transport/null engine fields are unobserved, not failures. The optional same-document developer app handle is labeled `app-handle-present`, not “boot succeeded.” Real HTTP/API and transport failures remain errors.

## What P2P success proves

The self-test creates **two WebRTC peers in this browser**, exchanges the game's invite/answer format and sends messages both ways. It does not load a match, inspect another tab, prove host approval/launch or establish connectivity between two devices/home networks. Use [the multiplayer flow and limits](host-approved-lobby.md) for actual play.

A CSS warning is not a JavaScript module failure. If a late/ignored `@import` warning appears, inspect its actual resource URL, including injected styles; do not infer a game startup failure from an unidentified stylesheet warning.

## Checks

```sh
node --check public/js/debug.js
node tools/test-diagnostics.mjs
DIAGNOSTICS_SCREENSHOTS=1 node tools/test-diagnostics.mjs
```

See [browser dependencies and limits](testing.md). Coverage includes bilingual neutral status, scoped report copying, real bidirectional local RTC, explicit HTTP failure, narrow layouts and return navigation. Screenshots go to `/tmp`; no production npm install/build is required.

中文：诊断页本来不启动游戏，所以「本页未启动」是正常状态。P2P 自检只证明当前浏览器内两个连接能通信，不证明跨设备联机或游戏已加载；启动问题请回到游戏页查看控制台。
