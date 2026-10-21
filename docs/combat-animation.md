# Kill and death presentation

## Visible behavior

- An authoritative `kill` event triggers a compact gold confirmation card and stronger kill marker
  for the killer. The victim's name is text, never HTML. Headshots have a separate label/treatment;
  successive kills less than three seconds apart increment the short streak counter.
- No killer camera shake, slow motion, aim lock, weapon flourish or fire interruption is introduced.
- Victims react to impact, buckle their legs, tip over and settle over about 1.25 seconds.
  Headshots have a sharper initial reaction. Fall heading is away from the killer's last rendered
  position, converted into victim-local coordinates; missing/suicide sources use a consistent
  fallback. This is presentation data only, not a new network payload.
- Four imported skeletons and the procedural avatar share the same timing and lifecycle. Imported
  knee/head offsets use character-space rotation axes rather than assuming identical bone rolls.
- A corpse remains briefly visible, stopping all pose/geometry work after settling. It disappears
  after at most 4.2 seconds; an earlier respawn restores it immediately. Dead snapshots are
  idempotent: repeated `setAlive(false)` calls never restart a fall.
- A remote player first encountered already dead stays hidden instead of showing a new fake death.
  Disconnected players follow the existing avatar removal path, with no separate corpse pool.

## When you are killed

The game immediately hides the viewmodel and imported first-person arms, clears flash blindness
and cancels any charged throw using the existing death handling. The full local character becomes
available for the collapse even if you were playing first person. A roughly 0.95-second camera
transition pulls back and lowers its focus, with only a small decaying roll. It uses the same
`resolveCamera` near-plane sweep as FP/TP cameras, not a wall-ignoring orbit.

For the first approximately 1.05 seconds the redeploy card is visually withheld so the fall is
readable. The authoritative countdown and selection data still update immediately. The normal
class/primary/pistol card then becomes interactive, with its original respawn eligibility. No
extra respawn lock or server delay is added. Camera and corpse clocks catch up with real elapsed
time after slow frames; returning to the tab does not restart a stale cinematic. The operating
system's reduced-motion preference skips camera travel/roll and leaves the redeploy panel visible
without this introductory transition, and simplifies the kill-card/marker CSS animation.

Spawn, welcome/rejoin and leaving the match clear presentation state. Respawning also resets the
body's presentation transform and captured joint rotations before normal animation resumes.
Changing the next loadout while dead does not replace/restart your local fallen avatar.

## Implementation and scope

- `public/js/death-motion.js`: dependency-free curves and idempotent `DeathClock`.
- `public/js/death-animation.js`: per-avatar presentation pivot, frozen live-pose capture,
  modest joint relaxation, floor clearance and bounded lifetime. Only visual children move;
  the gameplay root position/yaw/scale remain unchanged.
- `rig.js` / `character.js`: imported/procedural callbacks and `setAlive(alive, impact)`,
  `setDeathGround(offset)`, read-only `deathState` (`visible`, `elapsed`). Live holding and reload
  paths are unchanged when alive. The Gun Lab continues to use the same production rigs.
- `main.js`: existing kill events, remote snapshots, local camera and spawn/menu lifecycle.
- `hud.js`, `index.html`, `style.css`, `i18n.js`: safe, bilingual UI and reduced-motion treatment.

The corpse uses the existing map's support height at the victim's feet. During the short moving
phase it probes deformed skin vertices and static-mesh bounding corners, including asynchronously
loaded gun geometry present when the fall starts, to keep the visual model above that support
plane. No shared material opacity is changed and no geometry is cloned every frame.

**Limits:** this is a keyframed collapse, not a physical ragdoll or a kill replay. Bodies do not
roll down stairs, collide with other bodies, or dynamically fit themselves around wall corners.
At ledges/sloped stairs, the support plane is an approximation; limbs may visually overlap nearby
scenery. Skin clearance uses a bounded vertex sample, not exact per-triangle ground collision.
The corpse does not block bullets or movement. Damage, actual hitboxes, weapon placement defaults,
server authority, spawn shields, multiplayer transport and respawn rules are unchanged.
There is no build step, npm runtime dependency, external animation service or physics/Wasm library.

## Regression tests

Pure tests (no dependencies):

```sh
node tools/test-death-motion.mjs
node tools/test-gun-placement.mjs
node tools/test-reload-motion.mjs
node tools/test-avatar-visibility.mjs
```

With `public/` served on port 8080, test-only Python Playwright installed, and a Chromium executable:

```sh
export CHROMIUM_EXECUTABLE=/path/to/chromium
# Optional: CITY_ORIGIN=http://127.0.0.1:8080
python tools/test-death-animation.py
python tools/test-death-gameplay.py
python tools/test-gun-lab.py
```

The death animation test exercises 40 real character/pose/direction combinations, independent
floor samples, finite vertices, unchanged gameplay roots, repeated dead snapshots, stationary
settled corpses, expiry, respawn restoration and unchanged shared materials. It also checks safe
victim names, multi-kill feedback, responsive HUD widths and reduced-motion CSS. Optional
`DEATH_SCREENSHOT=/tmp/death.png` captures an actual imported fallen character.

The gameplay test runs the real Solo/Pyodide engine and production render loop: authoritative
headshot confirmation, remote collapse, local camera, hidden FP arms, untouched controls,
death picker/countdown and redeployment. Optional `DEATH_GAME_SCREENSHOT` captures the death panel.
It tests Solo integration, not a live two-device multiplayer session or every map/ledge combination.
The existing gun lab and hold regressions cover all 30 catalog guns and default hand attachment.
