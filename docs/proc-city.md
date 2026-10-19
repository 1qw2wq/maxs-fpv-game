# Expanded Procedural City (`proc_city`)

Select **Procedural City** in the main-menu map picker. The committed seed is **1942**, using city generator **version 7** (template grammar version 2).

## Size and variety

- **240 × 240 m** playable bounds: four times the previous width and depth, **16 times its area**.
- **128 enterable buildings in 64 physically attached pairs**, with 109 real internal door connections
  across shared floors. Adjacent units touch at a single sealed party wall, not an invisible gap.
- Buildings cover **54.7%** of the playable footprint (before the dense-city revision: 22.8%). Non-attached units
  are separated by roughly 3–5.6 m pedestrian passages, not another road around each building.
- **Only five vehicle streets**, down from 18: the perimeter and one central spine. The rest is an
  interconnected pedestrian/interior navigation network. Asphalt still has markings, crossings and curbs.
- **37 one-story, 37 two-story, 36 three-story and 18 four-story buildings**, ranging from 3.2 to 12.2 m.
  Footprints vary independently within each pair, approximately 13.5–17.6 m on each axis.
- **Eight interior uses**: apartments, cafes, offices, warehouses, libraries, lounges, workshops and
  vacant units. Room contents and omissions vary by seed, room and floor; pallets/rubble, seating,
  cabinets, tables, rugs, pictures and lighting do not appear in every unit.
- **72 × 18 m central pocket park** (2.25% of the map), with twelve mixed trees, cross-paths,
  benches, lamps, flowers, shrubs and low rubble. Two building pairs make room for it; the centre
  of the traffic spine is interrupted by pedestrian paths, not asphalt through the park.
- **151 staggered low-wall cover runs, only eight vehicles in seven variants**, including all three
  new car uploads, 128 shop awnings and 240 additional vegetation/street placements. Uploaded birch, broadleaf, pine, autumn/dead trees, bushes, berries,
  plants and flowers are mixed with the original street kit. Foliage has no canopy-sized invisible wall.

The eight interior uses share a structural grammar; these are not 128 individually hand-authored floor
plans. Story height remains 3 m and characters remain 1.70 m tall. Exterior doors remain at least 1.2 m
wide and now vary from 2.2 to 2.5 m tall. Shared-wall portals are real walkable/shootable openings;
all other party-wall sections are solid, including where the neighbouring building is shorter.

The city defaults to **15 Solo bots** through the shared map registry. Explicit per-map bot choices
are remembered, including lower counts; other maps retain their existing default/profile choice.
The authority also defaults to fifteen when a city Solo join omits `botCount`. Multiplayer remains
humans-only.

## Less repetitive doors, windows and passages

The old version-5 grammar cut a window into every upper-floor facade bay. Version 7 retains version 6’s more solid
masonry and varies openings instead of repeating the same large-hole grid throughout the city:

- **1,044 exterior windows**, down from **2,067** in version 5: approximately **49% fewer**.
  These counts exclude the wall removed between attached units; they are real exterior apertures,
  not painted window textures or a count of all wall meshes.
- **Six seeded facade rhythms**: masonry, narrow, paired, offset, tall and mixed. Each side and floor
  selects its window bays; narrow, taller and mixed-width profiles vary the silhouette. Widths, sill
  heights and lintel heights vary independently of the eight interior uses.
- **Two usable ground-floor exterior doors per building** remain. Doors move between the left and
  middle facade bays, with additional offsets and different widths/heights; front and rear doors need
  not line up. Each ground front/rear facade has only one window beside its door.
- **109 shared-wall connections** remain across 64 pairs. Portal offsets, widths and lintel heights
  now vary by pair/floor rather than repeating the exact same doorway up the whole wall. All other
  party-wall portions stay solid, and unused template windows are excluded from opening metadata.
- Jambs, sills, headers and closed bays have matching visible geometry and collision. Central-bay
  apertures are moved to one side of the interior partition, not cut across its solid end. Real visible
  furniture behind a window can still block a shot; a window is not a promise of an empty room.
- Entrance approaches, upper-floor lookout positions and perimeter curb cuts follow the actual
  openings. Added inside and party-hall approach nodes prevent diagonal routes from clipping narrow
  doorways, internal partition corners or room furniture. Canopy widths follow their entrance widths.

This is still a seeded structural grammar, not 128 bespoke floor plans. The map dimensions,
story heights, five-street layout outside the park, stairs, eight interior uses and seven vehicle variants remain.
The park removes four buildings from version 6; the remaining blocks stay tightly interconnected.
Facade choices use an independent deterministic hash and do not consume the furnishing RNG. Each building
records `facadeStyle` and world-space `openings` (bottom-centre `x/y/z`, width, height, side, floor
and template bay). Party portals are recorded separately in `connections`. Regenerate the geometry
and metadata together with the authoring command; editing metadata alone cannot create an opening.
Refresh the page and start a **new Procedural City match** to load this artifact; an existing room
keeps its host's previously loaded map rather than changing collision under active players.

## Assets and rendering

Original uploaded binaries remain unchanged:

- `models/maps/GLB format/`: architectural materials, street furniture, trucks and the old vegetation kit.
- `models/maps/house.glb`: floor/wood materials, stair treads and rails.
- `models/maps/inter.glb`: multiple furniture, lighting and wall-decoration types.
- **`models/maps/vege/veg.glb`**: selected meshes from the newly uploaded 150-mesh vegetation pack.
- `models/maps/car_crashed.glb`, `crashed_abandoned_car_-_game_ready.glb`, and `damaged_f1_car.glb`: the three new uploaded vehicle models. See `models/maps/VEHICLES.md`.
- `models/maps/Skyboxes/skybox-day.png`: panorama and PMREM environment.

`CITY_KIT` in `public/js/proc-city.js` resolves original names through GLTF parser associations, including
sanitized names and multi-primitive nodes. Multi-material furniture and cars retain all their primitives/materials; missing normals/UVs and mixed tangent layouts are normalized for merging. Groups sharing a material are batched together.
Structural surfaces use closed boxes matching the AABBs, with continuous plaster, cobbles and terrain
textures rather than smearing the whole kit atlas over a door jamb or ground tile. Furniture/vegetation
retain their uploaded geometry. Interiors are double-sided. Thin ground passes are front-sided with
explicit ground/decal depth offsets, preventing distant top/bottom-face flickering. Existing lighting/smoke/disposal behavior stays.

Canonical seed: **16,622 visual placements, 58 aliases, 596 spatial/shared instance batches and
10,769 collision boxes**. Multiple source materials can require several draws per batch. Building/floor
tints, procedural brick/stone/plaster surfaces and uploaded interior materials vary surfaces; a textured path distinguishes the park.
Warmer sunlight, brighter ambient/hemisphere fill and emissive fixtures improve interior legibility.
The 1024px city sun shadow bakes after assets finish loading rather than updating every frame.

Detailed vegetation, vehicles and furniture use bounded 64 m batches. Non-colliding interior ornaments
(chandeliers, wall lamps, pictures, ceiling trims, flowers and rugs) use 32 m batches and distance LOD:
50 m entry / 60 m exit from their bounds, updated at most ten times per second. Physical furniture,
cover, walls, vehicles, trees and collision are **never** hidden by this decorative LOD. Vegetation uses
alpha-tested single-pass surfaces instead of transparent double-pass foliage.

Chromium 153 / software-WebGL budget check, fixed cameras and the same geometry/materials:

| Near park, street-level view | Submitted triangles | Draw calls |
| --- | ---: | ---: |
| Former map-global batching, no decorative LOD | 4,292,583 | 72 |
| Local batching + decorative LOD | 1,252,324 | 180 |

That is **70.8% fewer submitted triangles**, with a deliberate increase in draws. Vehicle geometry
is **238,229 triangles versus 505,142** for the earlier 82-car population (52.8% less).
These are geometry/submission budgets, **not an FPS benchmark** or a physical-phone guarantee.
Original uploaded binaries and asset licenses remain unchanged.

## Thirty distinct reloads

`public/js/reload-motion.js` defines an individual profile for **each of all thirty weapons**: per-model
pitch/roll, presentation depth, withdrawal direction, feed timing and recovery/charging reach. Side drum,
belt, pan, bullpup, stripper/en-bloc, pistol and break-action paths are distinguished. Feed contacts in
`weaponpose.js` are calibrated against the actual assembled GLB triangles, not a generic rifle socket.

First-person borrowed arms/procedural gloves and imported/procedural third-person characters share
the same choreography. The trigger hand stays on its grip, while the support hand visits the feed and
returns to the handguard. Imported third-person carry height and IK account for the shorter skeletons.
Reload duration/progress are published by the authority (`rt` / `ri`) and extrapolated for remote players;
the local third-person avatar follows the smooth viewmodel clock. Switching/cancelling returns the hands
to their holding sockets and does not change authoritative ammunition or reload timing.

These are **procedural gun-and-hand animations on the static uploaded models**, not newly authored
moving magazine/bolt meshes or baked mechanical animation clips.

## Shared authority, collision and navigation

`public/engine/proc_city.js` and `city-building.js` are dependency-free seeded authoring modules. Neither
is required at deployment runtime: Python, Pyodide and browser collision all consume the **same committed
`public/shared/maps/proc_city.json`**. The large artifact is compact JSON to avoid hundreds of thousands
of pretty-printed lines. No client independently randomizes the world.

Optional authoring command, **not a frontend build step**:

```sh
node tools/generate-proc-city.mjs 1942
```

Each of the 163 upper floors has a continuous smooth stair collider and a real overhead well.
Stacked flights use closed 22 cm sloped slabs with parallel undersides, leaving 2.78 m of headroom;
rendered stair slabs and Python/JS movement/hitscan use the same thickness. Legacy wedge ramps on
other maps remain supported. Treads are visual only, never individual plank colliders. Explicit safe
approaches connect both exterior doors to alleys, while internal graph edges cross shared doorways.
Planting, props and spawn runouts remain clear of graph corridors.

The city uses its authored multistorey graph instead of building an unnecessary 240 m dense 2D flood
field in Pyodide. Ordinary maps keep their existing flow fields. Bots use the shared swept-capsule/floor
math and walk normally, not teleports or jump hacks. Pointer lock, separate mobile mode and the existing
Vercel-only host architecture are unchanged.

## Validation

```sh
node tools/test-proc-city.mjs       # 32 seeds, facade diversity/density, doors/ramps, exact artifact
node tools/test-city-openings.mjs   # Node 22.15+: shipped JS collision, aperture rays, matching visuals
# Optional: also check routes/opening rays on all 32 generated seeds:
CITY_COLLISION_SEEDS=32 node tools/test-city-openings.mjs
python tools/test-proc-city.py     # every graph edge both ways, actual opening/closed-bay rays,
                                  # furniture/floors, runouts, bot ascent and authoritative room
node tools/test-reload-motion.mjs  # 30 unique profiles, 9,030 real VM/glove frames, continuity/cancel
node tools/test-gun-calibration.mjs # actual GLB grip contacts and reload/feed surface contacts
python tools/test-secondaries.py  # inventory, equip/reload security, utility flare, host/guest
```

Optional real-browser regression (externally supplied Python Playwright; no frontend dependency):

```sh
CHROMIUM_EXECUTABLE=/path/to/chromium CITY_ORIGIN=http://127.0.0.1:8080 \
  CITY_LIVE=1 python tools/test-expanded-assets.py
```

The optional browser suite checks real uploaded assets, every JS graph edge in both directions,
ramp sprints at 20/60/144 FPS, solid-wall bullet rays and stair-volume rays, all thirty model
loads/dimensions, pistol support-grip spacing, per-model placement,
loadout selection, and (with `CITY_LIVE=1`) actual Solo/Pyodide and two-seat RelayHostNet/RelayNet.
`CITY_ONLY_LIVE=1` skips the isolated asset pass for faster transport iteration.

`tools/test-city-upgrade.mjs`, included in the optional browser runner, verifies the real city kit,
park, surface tints/textures, loading-frame shadow invalidation, decorative-LOD hysteresis and the
local/global submission comparison. `tools/test-hands.mjs` covers 960 FP poses plus **720 imported
third-person reload poses** (30 guns × six progress points × four skeletons). Effects additionally cover
210 procedural FP/third-person weapon poses. Reload/feed sockets are within 3 mm of assembled gun
surfaces; the exhaustive motion test covers 9,030 VM/glove frames with no discontinuities/cancel drift.

Use `CITY_SKIP_SCREENSHOTS=1` when headless compositor capture is unavailable, and optionally
`CITY_SOFTWARE_GPU=1` to look skyward in the full-game control test (the detailed city is checked
separately). `CITY_ONLY_LIVE=1 CITY_LIVE=1` checks the actual map picker’s 15-bot default and the real
Solo/Pyodide population before removing bots for deterministic inventory/death-control assertions.
Optional `/api/*` probes fail normally on a bare Python static server and are not missing game assets.
No physical-phone or deployed-Vercel/cross-NAT test, and no FPS benchmark, is claimed.

See [arsenal-and-sidearms.md](arsenal-and-sidearms.md) for the weapon additions and controls.

### Revision-7 checks (2026-10-19)

- **119 native Python tests across nine suites passed**, including the city’s 15-bot default,
  explicit four-bot override, remote reload payloads, wall blocking and existing shield/inventory rules.
- **32 deterministic layouts** and the canonical artifact matched. Actual shipped JS collision passed
  on the canonical city plus 32 additional seeds; canonical coverage is **550,890 movement samples,
  6,500 aperture rays and 15,944 solid-wall rays**.
- Chromium 153 real WebGL checks passed for the city/park, materials, static-shadow initialization,
  spatial batching and decorative-LOD hysteresis; vehicle, procedural effects and imported-hand
  checks passed. Geometry budgets above use actual renderer submission counts.
- The real map picker and Solo/Pyodide spawned **15 bots**. Keyboard/touch sidearm switching,
  independent ammo, stale-shield rejection, stable arm fallback, death/loadout/respawn, four mobile
  layouts and two RelayHostNet/RelayNet seats passed without missing assets or uncaught errors.
  Bots were removed after population verification to keep the control/death test deterministic;
  this was not a sustained 15-bot FPS benchmark.
