# Bot intelligence and difficulty settings

## Playing with AI

The battlefield setup card on the main page now has separate **Solo AI count** and **Multiplayer AI count (host)** controls, followed by a shared **AI difficulty** selector and a short description of the selected level.

- Solo keeps the remembered count per map (Procedural City recommends 15). Presets are 0/4/6/8/12/15/16; **0** is target practice without AI. The tutorial remains a separate zero-bot practice match.
- Multiplayer defaults to **0**, preserving humans-only rooms. The host can choose **0–16 additional AI**, select a difficulty, accept friends on the main page, choose their own character, and Start after guests are Ready. Both deathmatch and point control use the same authoritative bot engine.
- All bots in a room follow the selected difficulty. **Mixed** keeps the original mostly ordinary-soldier rotation separately on each team. Difficulty is not a per-team handicap.
- Guests see the host's count/difficulty, including in the character-selection lobby status, but cannot edit them. Changing AI settings in the waiting lobby revokes guest Ready; old Ready messages for different AI settings cannot launch the room. Settings lock during launch/play. Re-ready after a change.
- Solo count, multiplayer count and difficulty are saved locally when storage is available. Guest observations of the host's settings do not overwrite the guest's saved preferences. The settings UI is bilingual and scroll-reachable on narrow/landscape screens.

| UI choice | Protocol / roster tier | Reaction delay after acquisition | Last-seen memory | Behavior emphasis |
| --- | --- | --- | --- | --- |
| Mixed (balanced) | `mixed`; roster varies | Depends on each bot | Depends on each bot | Per-team rotation: recruit, regular, veteran, recruit, regular, regular. No elite bots in this rotation. |
| Easy · Recruit | `recruit` | 550–1000 ms | 2.5 s | Wider aim error, slower tracking, longer pauses, noisier tactical choices. |
| Normal · Regular | `regular` | 300–600 ms | 4.5 s | Balanced tracking, decision mistakes and coordination. |
| Hard · Veteran | `veteran` | 150–300 ms | 6 s | More reliable role coordination; seeks cover earlier and under group suppression. |
| Expert · Elite | `elite` | 120–240 ms | 7 s | Tighter but imperfect aim, steadier decisions and stronger role coordination. |

These are **reaction windows**, not guaranteed times to first shot. Sensor cadence, facing, aim alignment, burst pauses, reload/equip time and hesitation can delay firing further. Expert still has nonzero aim error, finite turn speed and a 4% burst-hesitation chance; it is not instant aim or an aimbot. Scoreboard AI labels include Elite in English/Chinese.

## What is smarter

The new layer scores **withdraw / push / hold / strafe / flank** rather than picking a tactic solely from a distance band and a random roll:

- Health, preferred weapon range, suppression and the number of recently **visible** threats affect the scores.
- Nearby friendly strength contributes to a bounded confidence estimate. Enemy health, hidden live positions and hidden enemy velocity are not inputs to these tactical scores.
- Nearby allies already flanking the same observed target—and support guns—encourage an **anchor** role. This discourages everyone from flanking at once. It is a soft utility preference, not a centrally scheduled squad planner or a guarantee that every bot obeys a formation.
- Lower levels add more decision noise; higher levels coordinate more consistently. Existing per-life steadiness/aggression, committed plans, collision-tested flank goals, objective assignment spreading and stuck recovery remain.
- Hard/Expert seek occluding cover when suppressed by at least two observed enemies. Health thresholds for cover rise from 26% (Easy) to 52% (Expert); empty-magazine reloads and emergency cover continue to take priority.
- When a primary has **no magazine or reserve ammunition**, a bot can switch to its stocked pistol using the normal authority path. It respects the 350 ms equip delay, retains separate ammo and returns to its primary only when that inventory has ammunition again. It does not manufacture ammo or oscillate between two empty guns.
- Tracking still uses delayed sight samples with bounded prediction. Last-seen memory is a frozen observation, expires by tier, and is cleared after the location is investigated. LOS/smoke/flash checks and friendly firing-lane safety still gate firing.

This is lightweight, hand-authored tactical AI—not online learning, a neural model, a full GOAP system, or an external AI service. Existing class-specific healing/ammo support and objective behavior remain in use. No health, weapon damage, fire-rate, ammo, collision or vision cheats were added for harder difficulty. The **existing Solo-only balance relief** (bot-to-human bullet-hit discard and faster human regeneration) is unchanged and applies regardless of selected difficulty; multiplayer does not acquire those concessions when a guest joins.

## Authority and bounded populations

`shared/bots.json` is the tuning source for both Python and Pyodide: skill timings/errors, decision noise, coordination, cover thresholds, memory, Mixed rotation and the 16-bot maximum. `local.js` installs this file into the browser interpreter alongside the other shared files. JS IDs are checked against the JSON in the lobby regression.

- The first human to create an engine room owns its bot policy. Later guest joins cannot turn bots off, pick another tier or enable Solo balancing. The same restriction applies to direct `bots` commands, not just disabled UI controls.
- `botDifficulty` travels through LocalNet, WebSocket/poll Net, RelayNet and its retry path. Welcome, authority state and browser-host diagnostics expose the selected level. Each roster row exposes its actual tier as `ai`; the tier survives respawn.
- Count is bounded to 16, and the overall player cap stays 32. Bot slots are reclaimed as more humans arrive, restored to the requested target as humans leave, and removed when the last human leaves. Existing humans-only clients/rooms remain valid when no bots are requested.
- Browser-host settings/room ownership do not migrate when the hosting tab closes; the normal host-shutdown flow still applies. The standalone Python server also does not transfer bot-control ownership to a remaining guest.
- No required backend, broker, runtime npm package, build step, model download or external service was added. Vercel-only hosting still uses the browser authority. Same-origin tab codes and cross-device invite/answer networking retain their existing limitations.

## Online design references

These informed the original, simplified implementation; no source code was copied:

1. Mike Lewis, **Choosing Effective Utility-Based Considerations**, Game AI Pro 3: scoring decision alternatives during a think cycle. [6](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf)
2. Tobias Karlsson, **Squad Coordination in Days Gone**, Game AI Pro Online Edition 2021: separating individual decisions from group roles and using confidence to inform offense/defense. This project uses only a small local confidence/role heuristic, not the full system. [2](https://www.gameaipro.com/GameAIProOnlineEdition2021/GameAIProOnlineEdition2021_Chapter12_Squad_Coordination_in_Days_Gone.pdf)

## Regression checks

```sh
python tools/test-ai.py
python tools/test-bot-difficulty.py
node tools/test-room-lobby-unit.mjs
node tools/test-bot-settings.mjs
node tools/test-room-lobby.mjs
BOT_LOBBY_TEST=1 node tools/test-room-lobby.mjs
node tools/test-landing.mjs
node tools/test-operations.mjs
node tools/test-protection.mjs
```

Browser suites use the existing external test-only Playwright/Chromium dependencies under `/tmp/maxs-fpv-browser-tests` (`TEST_DEPS` override, optional `CHROMIUM_EXECUTABLE`), never production dependencies. Run heavy suites sequentially. `BOT_SCREENSHOTS=1 node tools/test-bot-settings.mjs` writes review images to `/tmp`.

Focused evidence:

- **36 AI regressions**: all tiers' turn/reaction/aim behavior; LOS, smoke, flash and friendly-lane safety; sampled prediction; utility response to health/range/pressure; friendly anchor preferences without hidden-enemy reads; pressure-cover behavior; pistol inventory/equip delay; all three maps with 15 bots over 40 simulated seconds.
- **6 difficulty/room regressions**: all levels in Solo/multiplayer, hostile guest join/command attempts, retained tier on respawn, zero/invalid/clamped values, 32-seat capacity reclaim/restore, and every level on every map with ordinary health/collision.
- Actual Solo/Pyodide deployments at all five selector values, translated scoreboard labels, zero-bot Solo, persistence across reload and invalid-profile sanitization. English/Chinese settings at five desktop/mobile sizes.
- Native lobby tests with default humans-only settings, then with four host-selected Elite bots: approve/reject, map/rules, Ready/start, failed-engine retry, unauthorized admission/commands, approved rejoin and leave. Also actual invite/answer pairing in separate storage contexts with BroadcastChannel/WebSocket disabled, retaining RTC through match launch and chat.
- Existing 172 bilingual layout checks, landing/submenu checks and protection-clock regression. Additional control, survival, shooting, sidearm, grenade and city Python suites were run separately.

Limits: these are deterministic simulations and local browser checks, not real-phone/cross-NAT certification or a player study demonstrating win-rate/fun at each level. The broad visual/all-weapon suite was not rerun; its previously documented unrelated remote weapon-attachment assertion is not represented as fixed. The standalone Python-Playwright map-shield/crouch scripts could not start without their optional Python package in this environment; Node browser checks and Python survival tests are separate evidence, not a claim those scripts ran.
