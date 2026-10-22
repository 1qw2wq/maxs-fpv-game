# Grenade bodies and detonation presentation

## Uploaded art

`public/js/grenade-models.js` loads the supplied GLBs through the vendored GLTFLoader:

| Gameplay type | Included file | Identification |
| --- | --- | --- |
| Frag | `models/guns/granade_m26.glb` | Muted yellow collar |
| Incendiary | `models/guns/hand_granade.glb` | Orange collar |
| Smoke / assault smoke ability | `models/guns/smoke_granade.glb` | Gray collar; dedicated uploaded canister |
| Flash | `models/guns/flashbang_grenade.glb` | Pale collar; dedicated uploaded flashbang |
| Poison gas | `models/guns/gas_grenade.glb` | Yellow collar; upright canister only, not its lying showcase duplicate |
| Scout flare | Slim procedural red cartridge | Not the uploaded flare **gun**, which remains a weapon |

These uploads are grenade-shaped artwork, reused for recognizable gameplay types. They are not
newly authored replicas of real incendiary, smoke and flash devices. Their textures/mesh detail
are preserved; original files are not rewritten. Embedded authors, licenses and modifications
are listed in `public/models/guns/CREDITS.md`.

The loader normalizes orientation, centers the rigid prop and fits it inside the existing 0.09 m
collision envelope. The type collar follows the body cross-section. Five throwable GLBs are downloaded
and parsed, cached across throws and map changes. Instances share template geometry, textures and
materials. Per-instance disposal never destroys those templates. Failed downloads retain a detailed
mechanical fallback; a disposed throw ignores a later asynchronous load completion.

## Flight and settled bodies

The original host path remains authoritative; the loader does not resize colliders, move impacts
or change fuse times. Tumbling uses accumulated movement/time on that sampled path. Stationary
segments do not keep accumulating spin. Legacy hosts without samples retain the old curve fallback.
The smoke/gas body remains at the final sampled pose underneath its venting cloud, even when its
welcome snapshot is already past the fuse. Expired flashes/blasts are not replayed on late arrival.

## Detonations

`public/js/grenadefx.js` supplies deterministic per-effect particles and cosmetic fragments:

- **Frag:** short hot pressure flash, non-emissive dusty smoke and sparks. Twenty-four metal
  fragments use precomputed short gravity arcs, stopped by shared world sweeps. Their rendering
  adds no hit registration or damage. Dust lasts up to 2.4 seconds independently of host damage.
- **Incendiary:** thirty candidate flame tongues (blocked/unsupported positions omitted), ten
  cooler smoke wisps, twelve batched sparks, subtle ground glow and a temporary soot mark.
  Floor/wall checks prevent spreading the flame layout through a solid wall or to unrelated floors.
- **Smoke:** existing 36-card sight-blocking cloud/density unchanged, plus four smaller vent puffs;
  no large incendiary fireball. The canister stays beneath it until cleanup.
- **Poison gas:** yellow/ochre version of the 36-card cloud and small vent; same settled-canister lifecycle. Host damage and usable gas-mask protection are documented in [poison gas and mask](poison-gas-and-mask.md).
- **Flash:** one fast white glare plus a white halo; no orange fire, dust or fragment batch. The
  existing host LOS/distance/facing exposure and full-screen white blindness/fade remain unchanged.
- **Flare:** small red-orange ignition, embers and wisps for its existing lifetime; still spotting,
  not incendiary damage.

Fragments and sparks each use one instanced mesh batch, not a separate draw/material per piece.
Two persistent shadowless PointLight slots select the strongest nearby active effects. Their count
never changes during a burst, avoiding light-count shader churn. Clearing effects zeroes both.
Shared procedural textures remain cached; per-effect meshes/materials and instance buffers are
released on expiry/leave/map changes. Sounds use separate pressure crack, bass and air/debris
layers; smoke/flare and flash have distinct ignition/report profiles. No delayed audio timers or
external samples/services are introduced.

The effect is still bounded real-time game presentation, not a fluid simulation or physically
accurate fragmentation solver. Decorative dust/soot does not become AI smoke cover. The original presentation upgrade did not change gameplay tuning. The subsequent poison/mask feature adds a separate 6.5 m / 18 HP/s gas type; existing grenade inventory, shields, friendly-fire rules and throw physics remain unchanged.

## Verification

Test dependencies remain outside production/the repository:

```sh
npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core @sparticuz/chromium
node tools/test-grenade-upgrade.mjs
# Faster asset/effect-only subset:
GRENADE_ASSETS_ONLY=1 node tools/test-grenade-upgrade.mjs
# Optional actual model close-ups / live incendiary image:
GRENADE_MODEL_SHOTS=/tmp/grenade GRENADE_SCREENSHOT=/tmp/fire.png node tools/test-grenade-upgrade.mjs
python tools/test-grenades.py
```

Checks cover 180 host/preview parity cases / 36,096 sampled coordinates, actual pixels for all
five imported presentations, bounds, cache reuse across 32 clones, canceled/failed loads, rest and
late-path poses at 20/60/144 Hz, deterministic wall-stopped fragments and fire placement, white-flash
separation, lifetime/geometry cleanup and two fixed light slots. The live fixture runs native G/B/Q,
charged throws and inventory checks, persistent fire/expiry, full-white flash recovery, pause
cancellation, an injected aged smoke snapshot (settled canister/remaining clock), active fire
illumination and leaving-to-menu cleanup. The live fixture primes the model cache; failed/pending
loads are separately tested. Short-lived flashes are observed in-frame instead of relying on
a later browser-protocol round trip. Scenery is hidden in that fixture to focus software GPU
work on real input, models and effects; its physics/authority remain active. The full Vercel suite
also imports the new model checks. This is not a physical-device FPS or cross-network RTC benchmark.
