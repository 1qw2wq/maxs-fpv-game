# Crouch correction and strict static-host multiplayer checks

## Crouch / squat

The visual pose still assumed a full-height standing capsule, even though the shared combat data
already uses a 0.85 m crouch capsule and a 0.75 m eye height. Its hip offset extended the thighs
backwards, the shallow knees barely lowered the body, and foot grounding limited the pelvis drop
to 5.5 cm. Adding that pose on top of a full running clip also made moving crouches look wrong.

The corrected presentation uses:

- A shared, frame-rate-independent eased stance (`public/js/stance.js`). Hips flex forward,
  knees bend deeply, and ankles compensate the combined leg rotation rather than turning the
  soles through the floor. The standing pose remains the zero-offset default.
- Full pelvis grounding for the crouch, not the standing-only small-bob clamp. The procedural
  fallback also solves its foot height instead of subtracting an arbitrary 20 cm.
- Short procedural crouch steps rather than an upright full-stride run clip mixed into a squat.
  Standing run clips return after the stance transition finishes.
- Torso/head adjustment plus gun counter-rotation: leaning into the stance does not aim the barrel
  down at the ground. Existing hand IK still solves onto the actual gun sockets.
- No authoritative position, collider, eye-height, movement-speed, damage or network flag changes.
  The animation now follows the crouch the engine already implements.

Imported head-joint heights settle around 0.71–0.78 m and the procedural head around 0.69 m in the
checked default setup. These are rig joints, not exact collision-envelope bounds; hats/hair and
accessories still extend beyond the gameplay capsule. Custom imported rigs can have different
proportions and should be reviewed visually.

The deeper pose also exposed stale skinned-mesh matrices during the death floor-clearance pass.
That pass now updates `SkinnedMesh.updateMatrixWorld` before sampling and retains per-skin-region
geometry extrema, so a death starting in a squat does not push feet through the support plane.
The existing bounded keyframed-death limitations still apply (see `combat-animation.md`).

## Multiplayer failures corrected

### A paired connection could be destroyed at deployment

The menu could establish a working RTC invite/answer connection, then try a remembered optional
backend address first when Deploy was pressed. Switching candidate transports closed the RTC
channel; falling back afterwards created a new, **unpaired** guest channel. This was reproduced
with a stale saved address.

An explicitly paired guest or explicitly created browser room now takes priority over that saved
address, including malformed saved addresses. The existing channel is reused. An unpaired player
who intentionally configures a real backend still uses the normal backend path.

### Authority depended on drawing frames

The host's engine used `requestAnimationFrame`. Rendering stalls or a backgrounded host tab could
stop state snapshots and queue host commands behind the next drawing frame. The in-page engine
now uses an independent tick timer. Relay traffic can also advance the authority when browser
timers throttle. Catch-up is bounded to six ticks; elapsed lag cannot accumulate without limit.
Closing the match cancels the timer.

This is not a promise that a sleeping phone or suspended browser process can host continuously.
The host page must remain open; an OS that suspends it completely also suspends its network/engine.
No required backend, broker, signalling service or new runtime dependency has been introduced.

### Pausing should not silently remove a guest

Guests send transport heartbeats even when their local pause menu stops game-loop input. This
keeps the same seat instead of silently timing it out solely because rendering/input paused.
The host broadcasts explicit pause/resume state and includes it in normal replies/heartbeats.
Guests stop movement/fire while the authority is paused; the authority also rejects gameplay
commands between paused ticks. Chat must not accidentally announce a resume. Esc still explicitly
pauses a browser-hosted match, as before.

Host peer counts are now exposed consistently. Welcome detection parses JSON semantically rather
than searching for one exact whitespace layout. The menu no longer claims a room join succeeded
just because a transport object opened.

## Vercel-only connection instructions and limits

1. **Same-origin tabs in the same browser storage partition:** create a room, deploy the host,
   enter its 8-digit code in the other tab and deploy. This uses BroadcastChannel.
2. **Another browser/profile/device:** use Invite a friend. Send `TFi1...` to the guest, return its
   `TFa1...` answer to the host, complete pairing, deploy the host and then the guest. A code or
   prefilled room link alone is not signalling and cannot connect independent devices.
3. No external services are required for directly reachable networks. Optional STUN can help
   discover addresses across home networks, but is not a relay and cannot bypass every NAT or
   firewall. Vercel static hosting provides neither a running signalling server nor TURN.
   Universal cross-network connectivity cannot be guaranteed under the Vercel-only constraint.

The menu now states the distinction directly instead of implying that an 8-digit code works
between arbitrary devices.

## Strict test coverage

### Pure tests

```sh
node tools/test-stance.mjs
node tools/test-engine-clock.mjs
node tools/test-protection.mjs
node tools/test-gun-placement.mjs
node tools/test-reload-motion.mjs
node tools/test-avatar-visibility.mjs
node tools/test-death-motion.mjs
```

### Real static-host multiplayer

```sh
# Test-only dependencies, outside the repository/deployment:
npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
node tools/test-multiplayer.mjs
# Optional: TEST_DEPS=/other/test/deps CHROMIUM_EXECUTABLE=/path/to/chromium
# Optional focused run:
MULTIPLAYER_MAPS_ONLY=1 MULTIPLAYER_MAP=proc_city node tools/test-multiplayer.mjs
```

The test starts an ephemeral static file server with the same health/room/character JSON shims.
WebSocket and **BroadcastChannel are disabled** in every tested RTC context, and all requests to
external origins are rejected. Separate browser contexts alone are not used as proof of RTC.
The test browser also avoids Chromium's single-process mode, which can invalidate context isolation
or crash while closing test contexts.

Checks include:

- Actual menu Create → invite → answer → Pair → Deploy, with stale/malformed backend fields.
- Guest keyboard crouch/walk reaching the host's authority and the rendered remote crouch.
- A paused guest retaining its seat at a simulated inactivity-timeout boundary.
- Host pause notification, ignored paused shots, chat without false resume, and recovery.
- Actual firing commands and authoritative damage/kill events in **both directions** in Somme,
  including local/remote death animation, redeploy UI, a new life, and the chosen pistol.
- Both seats switching sidearm, consuming ammunition and receiving reload acknowledgements.
- Guest departure removing its seat and peer, followed by a fresh real-menu invite/answer
  exchange and rejoining the same live host without resetting its seat or life.
- On **Somme, Italy and Procedural City**: real RTC early joining, host map/control rules overriding
  conflicting guest requests, no multiplayer bots, private sidearm/ammo acknowledgement,
  bidirectional commands/chat, per-player movement/fire shield cancellation, and host-close notification.
  Idle five-second expiry is separately covered by `tools/test-map-shields.py`.
- The three-map transport tests run with the host's animation-frame callbacks disabled, proving
  the engine does not require rendering to advance. Their own assertions use timer polling.

The older `tools/test-vercel.mjs` suite additionally covers same-browser tab transport, simultaneous
room isolation, duplicate delivery over two wires, grenade authority, malformed/expired connection
paths and channel adoption. Its isolated RTC guest now explicitly disables BroadcastChannel too.

These are real local browser/engine/RTC checks, **not a deployed Vercel or two-physical-network test**.
The full UI duel runs on Somme; every map gets transport/authority checks, not exhaustive combat at
all wall/ledge locations. Test placement fixtures seed a clear duel lane; the shots, damage,
life changes and redeployment themselves follow production network/engine handlers.

### Actual character / weapon regressions

With `public/` served on port 8080 and test-only Python Playwright installed:

```sh
export CHROMIUM_EXECUTABLE=/path/to/chromium
python tools/test-crouch.py
python tools/test-death-animation.py
python tools/test-gun-lab.py
```

`test-crouch.py` checks five character types, standing-to-crouch height, run/squat transitions,
stationary and moving squats at 20/60/144 Hz, unchanged gameplay roots, and standing restoration
(4,480 steady crouch frames plus transition frames). Optional `CROUCH_SCREENSHOT` captures a rig.
The existing hold regression covers 23,040 frames across four imported rigs and all 30 guns;
its rotation assertion accounts for the intentional crouch aim counter-rotation rather than
incorrectly demanding that the barrel lean down with the torso. The Gun Lab still checks all
150 gun/character combinations. Death clearance uses a denser independent test sample, including
deaths that begin in a crouched stance.

### Updated spawn-shield action regression

The shield now lasts **up to** five seconds while idle. The full menu/RTC regression waits for
both real frame loops to start before creating fresh test lives (software-rendered first-frame
shader work can consume an entire five-second window). Static scenery/shadows are hidden in the
menu-flow fixture to reduce shader cost; map collision, controls, characters and authority stay real. It then presses the guest's actual W key,
checks that only the guest loses protection, fires for the host, and checks both clients' remote
shield state. The transport-only cases repeat independent movement/fire cancellation on Somme,
Italy and Procedural City with host rendering disabled. Existing pause, kills, redeploy,
ammo/reload, leave and re-pair/rejoin checks remain.

Gameplay helpers stamp the sending life ID on input, fire, reload, switch, throws and respawn.
The host rejects mismatching serials before acting; missing serials remain legacy-compatible.
This fixes a reproduced queue race where an idle pre-respawn input moved the fresh body and
removed its shield before the player acted. `tools/test-survival.py` and
`tools/test-protection.mjs` cover rejection and capture-at-send behavior. The focused live
survival fixture also checks the real main.js HUD, idle damage immunity, an attacking player's
absent bubble, natural expiry and recovery without renewal.
