# Testing and validation

Run commands from the repository root. Tests are development tools, not a production build step or a requirement to play. Use the focused suite for the system being changed; do not interpret a focused pass as a full-game certification.

## Engine and dependency-free checks

Python gameplay tests use the same authoritative modules as the browser's Pyodide engine. Node-only math/data tests do not require a package installation; some collision suites use Node **22.15+** import hooks.

```sh
python tools/test-hit-latency.py
python tools/test-shooting.py
node tools/test-effect-inbox.mjs
node tools/test-interpolation.mjs
python tools/test-secondaries.py
python tools/test-grenades.py
python tools/test-poison-gas.py
python tools/test-ai.py
python tools/test-bot-difficulty.py
python tools/test-control.py
python tools/test-survival.py
python tools/test-proc-city.py
STAIR_JS_PARITY=1 python tools/test-stairs.py
node tools/test-key-bindings.mjs
node tools/test-weapon-keys.mjs
node tools/test-room-lobby-unit.mjs
node tools/test-gun-placement.mjs
node tools/test-stance.mjs
node tools/test-engine-clock.mjs
node tools/test-protection.mjs
node tools/test-death-motion.mjs
node tools/test-avatar-visibility.mjs
node tools/test-proc-city.mjs
node tools/test-city-openings.mjs
node tools/test-stairs.mjs
node tools/test-gun-calibration.mjs
node tools/test-reload-motion.mjs
```

Some Node-only suites load the actual vendored Three.js and uploaded GLBs. That is local test execution, not frontend bundling.

## Self-hosted Node browser suites

Install test dependencies **outside the repository**:

```sh
npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
node tools/test-landing.mjs
node tools/test-operations.mjs
node tools/test-hud.mjs
node tools/test-combat-rendering.mjs
node tools/test-key-settings.mjs
node tools/test-diagnostics.mjs
node tools/test-room-lobby.mjs
BOT_LOBBY_TEST=1 node tools/test-room-lobby.mjs
GAS_LOBBY_TEST=1 node tools/test-room-lobby.mjs
node tools/test-bot-settings.mjs
node tools/test-multiplayer.mjs
MULTIPLAYER_MAPS_ONLY=1 node tools/test-multiplayer.mjs
node tools/test-grenade-upgrade.mjs
node tools/test-poison-gas-browser.mjs
node tools/test-vercel.mjs
```

These runners start a local static test server. `TEST_DEPS` overrides the dependency directory; `CHROMIUM_EXECUTABLE` selects a browser. Run heavy WebGL suites sequentially to avoid exhausting software-rendering memory. Screenshot options documented in individual guides write outside Git, normally to `/tmp`.

## Python browser suites

These require a separately installed Python Playwright package, a Chromium executable and a running site:

```sh
pip install playwright
python -m http.server 8080 --bind 0.0.0.0 --directory public
# In another terminal:
export CHROMIUM_EXECUTABLE=/path/to/chromium
export CITY_ORIGIN=http://127.0.0.1:8080
python tools/test-gun-lab.py
python tools/test-crouch.py
python tools/test-death-animation.py
python tools/test-death-gameplay.py
python tools/test-map-shields.py
CITY_LIVE=1 python tools/test-expanded-assets.py
```

A bare static server does not apply Vercel API rewrites. Optional discovery requests can fail before the browser selects its local engine; distinguish these probes from missing game assets. Serving HTML through `file://` is not supported.

## Reading results and limitations

- State whether a command actually ran, passed, failed or was skipped. Test counts and dated screenshots are evidence from one run, not permanent guarantees.
- RTC tests use isolated storage contexts and explicitly disable BroadcastChannel/WebSocket where required. A same-page P2P self-test alone does not prove game launch or two-device connectivity.
- Local static-host tests do not certify a live Vercel deployment, physical mobile devices, cross-NAT reachability, sustained bot-heavy FPS or every map/ledge combination.
- Triangle/draw-call budgets are not frame-rate benchmarks. Corpse and animation checks do not establish physical ragdoll accuracy.
- The broad weapon-hold suite has a previously reported **approximately 0.051 m remote torso-attachment drift assertion**. Its resolution is not established by focused UI/lobby tests; rerun and investigate that assertion before claiming the broad suite is clean.

中文：专项通过不等于全游戏、真机或跨网络验证。浏览器依赖安装在仓库外；没有运行、被跳过或失败的测试应明确记录，不要把历史结果写成永久保证。

## Camera hands, Italy gas and latency

See [the focused combat guide](combat-rendering-and-hits.md) for closed first-person gloves, decode-time effect preservation, bounded RTT rewind, specific regression coverage and software-WebGL timing limitations. Third-person uploaded costumes remain unchanged.
