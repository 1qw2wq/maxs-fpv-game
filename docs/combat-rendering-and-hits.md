# First-person hands, map-load effects and moving-target hits

## Camera hands

Gameplay uses the dedicated, closed glove/arm meshes in `viewmodel.js`, for **all** character skins. Third-person characters retain the uploaded models and their original costumes. First-person gloves follow each weapon's grip sockets through ADS, recoil, sprint and its individual reload; scoped ADS, third person and death hide them.

Full-character sleeves are not camera-ready geometry. Filtering triangles by arm-bone weight can leave open bell sleeves, cuffs and accessory rings, even when wrist IK reports a small reach error. The gameplay camera therefore no longer clones/crops those costumes or switches between imported arms and gloves. The imported-arm crop/IK utilities remain available for the rig laboratory, not as the production viewmodel.

Both limb segments have closed ends; an overlapping elbow joint covers their bend. Forearms end at the glove wrist, not the palm centre. Sleeve colours are muted class colours. Reload framing also considers viewport aspect ratio: a close service grip must not disappear off a narrow portrait screen. This adjustment does not move ADS sight calibration or authoritative player/shot positions.

## Yellow gas while Italy loads

Italy's imported GLB loads asynchronously. Previously, live effects received during decoding were added to the old scene and subsequently cleared by map/welcome teardown. Welcome effects also restarted their age after decoding. This is a general loading race, not a different gas colour on Italy.

`effect-inbox.js` now holds welcome payloads and live casts until teardown completes. Each payload keeps its receipt time; decode time is added to its age. An effect removal supersedes a pending spawn with the same ID. Expired payloads are not recreated, pending flights keep their remaining fuse, and an existing effect ID is deduplicated. Map changes use the same inbox. Damage remains entirely host-authoritative: this buffer only reconstructs presentation.

## Moving opponents and hit registration

At click time, the remote opponent was already a host-to-client trip plus interpolation old. When the fire command reaches the host, another client-to-host trip has elapsed. The correct rewind is therefore **RTT + interpolation**, not half RTT + interpolation.

The host now uses that full round trip, clamped to 240 ms of RTT plus the existing 120 ms interpolation, with a maximum 360 ms rewind within the 1 s history buffer. Bots continue to shoot current authority positions without network rewind. This does not enlarge hitboxes, allow friendly fire, pierce walls or ignore an active spawn shield.

The client's jitter buffer also holds the **oldest** available snapshot if its sampling time precedes the buffer. Previously that edge case jumped to the newest snapshot, displaying a pose inconsistent with the rewind.

Spawn protection still lasts at most five seconds for a new life and ends independently when that player moves, fires or throws. Healthy opponents can require multiple hits depending on the weapon, range and hit zone. Matches in the ended phase do not accept damage.

## Focused validation

```sh
node tools/test-effect-inbox.mjs
node tools/test-interpolation.mjs
python tools/test-hit-latency.py
python tools/test-shooting.py
python tools/test-survival.py
python tools/test-poison-gas.py
# External development-only browser dependencies; no production npm/build:
node tools/test-combat-rendering.mjs
MULTIPLAYER_MAPS_ONLY=1 node tools/test-multiplayer.mjs
GAS_LIVE_ONLY=1 node tools/test-poison-gas-browser.mjs
```

The combat-rendering runner checks 1,920 class/weapon/aspect/animation poses, rendered hand pixels, capped segments and connected joints. It deliberately holds Italy's real GLB request, delivers live poison/removal/expired messages during loading, and verifies age preservation and yellow pixels against the imported map. It also exercises the four built-in skins, acknowledged primary/pistol switching, third person and scoped ADS. `COMBAT_SCREENSHOTS=1` writes `/tmp/closed-fp-arms.png` and `/tmp/italy-gas.png` outside Git.

The latency suite covers all 29 ballistic weapons at six RTT values, including an inflated claim, plus cover/shield/bot/miss checks. The map-only RTC suite uses isolated browser contexts with BroadcastChannel, WebSocket and external services disabled; client fire commands must produce lethal hit/kill messages in **both directions on all three maps**. Fixture placement selects real clear lanes; it does not invent client-side damage.

These are focused local regressions, not proof of live Vercel deployment, physical mobile rendering or arbitrary two-device/NAT conditions. The older full-body weapon-hold drift limitation in [testing.md](testing.md) is separate. The longer gas browser sequence can be timing-sensitive under software WebGL: two combined/isolated runs timed out around the short cloud lifetime; the isolated native-control sequence subsequently passed. Do not interpret this as a hardware performance certification. The legacy Python first-person suite also contains imported-arm **lab** tests; use the new combat-rendering runner for current production camera geometry.
