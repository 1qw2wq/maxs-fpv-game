# Expanded Procedural City (`proc_city`)

Select **Procedural City** in the main-menu map picker. The committed seed is **1942**.

## Size and variety

- **240 × 240 m** playable bounds: four times the previous width and depth, **16 times its area**.
- **132 enterable buildings in 66 physically attached pairs**, with 114 real internal door connections
  across shared floors. Adjacent units touch at a single sealed party wall, not an invisible gap.
- Buildings cover **56.5%** of the playable footprint (previous version: 22.8%). Non-attached units
  are separated by roughly 3–5.6 m pedestrian passages, not another road around each building.
- **Only five vehicle streets**, down from 18: the perimeter and one central spine. The rest is an
  interconnected pedestrian/interior navigation network. Asphalt still has markings, crossings and curbs.
- **37 one-story, 38 two-story, 38 three-story and 19 four-story buildings**, ranging from 3.2 to 12.2 m.
  Footprints vary independently within each pair, approximately 13.5–17.6 m on each axis.
- **Eight interior uses**: apartments, cafes, offices, warehouses, libraries, lounges, workshops and
  vacant units. Room contents and omissions vary by seed, room and floor; pallets/rubble, seating,
  cabinets, tables, rugs, pictures and lighting do not appear in every unit. 2,044 furniture/decor
  placements in the tracked furnishing aliases, compared with 1,275 in the previous version.
- 140 staggered low-wall cover runs, 82 parked vehicles in seven variants (including all three new car uploads), 132 shop awnings and 299 additional
  vegetation/street placements. Uploaded birch, broadleaf, pine, autumn/dead trees, bushes, berries,
  plants and flowers are mixed with the original street kit. Foliage has no canopy-sized invisible wall.

The eight interior uses share a structural grammar; these are not 132 individually hand-authored floor
plans. Story height remains 3 m and characters remain 1.70 m tall. Exterior doors are at least 1.8 m
wide (minimum contract: 1.2 m) and 2.5 m tall. Shared-wall portals are real walkable/shootable openings;
all other party-wall sections are solid, including where the neighbouring building is shorter.

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

Canonical seed: **20,241 visual placements, 57 instanced aliases, 14,213 collision boxes**. Multiple source
materials may require more than one draw per instance batch; the test overview rendered in 118 draw calls.
These are scene counts, not a mobile frame-rate guarantee. Original asset licenses still apply.

## Shared authority, collision and navigation

`public/engine/proc_city.js` and `city-building.js` are dependency-free seeded authoring modules. Neither
is required at deployment runtime: Python, Pyodide and browser collision all consume the **same committed
`public/shared/maps/proc_city.json`**. The large artifact is compact JSON to avoid hundreds of thousands
of pretty-printed lines. No client independently randomizes the world.

Optional authoring command, **not a frontend build step**:

```sh
node tools/generate-proc-city.mjs 1942
```

Each of the 171 upper floors has a continuous smooth stair collider and a real overhead well.
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
node tools/test-proc-city.mjs       # 32 seeds, dimensions/variety/doors/ramps, exact artifact
python tools/test-proc-city.py     # every graph edge both ways, transformed opening rays,
                                  # furniture/floors, runouts, bot ascent and authoritative room
python tools/test-secondaries.py  # inventory, equip/reload security, utility flare, host/guest
```

Optional real-browser regression (externally supplied Python Playwright; no frontend dependency):

```sh
CHROMIUM_EXECUTABLE=/path/to/chromium CITY_ORIGIN=http://127.0.0.1:8080 \
  CITY_LIVE=1 python tools/test-expanded-assets.py
```

The browser suite checks real uploaded assets, 454,970 JS collision-edge samples, 513 ramp sprint cases
at 20/60/144 FPS, 22,472 solid-wall bullet rays and 513 stair-volume rays, all thirty model loads/dimensions, pistol support-grip spacing, per-model placement,
loadout selection, and (with `CITY_LIVE=1`) actual Solo/Pyodide and two-seat RelayHostNet/RelayNet.
`CITY_ONLY_LIVE=1` skips the isolated asset pass for faster transport iteration.

The sandbox browser is Chromium 92. Its isolated test fixture rewrites only vendored Pyodide class
static-block syntax and enables experimental Wasm flags; **production/vendor files are not modified**.
Optional `/api/*` probes fail normally on a bare Python static server and are not missing game assets.
Physical phones and a deployed Vercel instance have not been tested.

See [arsenal-and-sidearms.md](arsenal-and-sidearms.md) for the weapon additions and controls.

### Latest completed run

111 Python tests, 32 seed/artifact cases, the full WebGL asset/collision/sprint suite, Solo/Pyodide
sidearm controls, every bullet weapon against every shared-floor wall/doorway, four mobile layouts, and two-player Relay synchronization all passed. The separate
imported-hand suite also passed 960 poses and 23,040 third-person animated frames; see the arsenal notes.
