# Expanded Procedural City (`proc_city`)

Select **Procedural City** in the main-menu map picker. The committed seed is **1942**.

## Size and variety

- **240 × 240 m** playable bounds: four times the previous width and depth, **16 times its area**.
- 64 enterable buildings on eight-by-eight compact urban plots. Independently seeded footprints range from
  10.8 m up to 19.2 m on their local axes; quarter-turn orientations vary independently.
- 48 two-story buildings and 16 single-story shops/depots. Four interior variants remove different
  partitions and combine dining/coffee tables, sofas, display cabinets, paintings, sconces and plants.
- Connected 6 m asphalt streets with dashed centerlines, zebra crossings, sidewalks and 10 cm curbs;
  central cobblestone yards, grassy gardens and dirt plots.
- Tighter setbacks, 192 staggered low-wall cover runs, 99 parked delivery trucks and 64 uploaded
  shop awnings create overlapping street/yard cover and covered entrances instead of empty fields.
  Low raised grass beds add step-height changes without a second terrain/physics system.
- 500 seeded vegetation/street placements: uploaded birch, broadleaf, pine, autumn/dead trees, bushes,
  berries, plants and flowers; old-kit trees, benches, lamps, dumpsters, barriers, pallets, brick piles and trucks.
  Trunks and solid furniture have explicit collision; foliage is decorative, not an invisible canopy-sized wall.
- Four facade palettes and smaller/larger rectangular silhouettes, not a repeated four-house arena.

The four interior variants share a proven structural grammar; this is not 64 individually hand-authored
floor plans. Furniture footprints scale with each building while story height stays 3 m. Characters remain
1.70 m tall. Exterior doors stay at least 1.8 m wide (minimum contract: 1.2 m), and 2.5 m tall.

## Assets and rendering

Original uploaded binaries remain unchanged:

- `models/maps/GLB format/`: architectural materials, street furniture, trucks and the old vegetation kit.
- `models/maps/house.glb`: floor/wood materials, stair treads and rails.
- `models/maps/inter.glb`: multiple furniture, lighting and wall-decoration types.
- **`models/maps/vege/veg.glb`**: selected meshes from the newly uploaded 150-mesh vegetation pack.
- `models/maps/Skyboxes/skybox-day.png`: panorama and PMREM environment.

`CITY_KIT` in `public/js/proc-city.js` resolves original names through GLTF parser associations, including
sanitized names and multi-primitive nodes. Multi-material furniture retains all its primitives/materials.
Structural surfaces use closed boxes matching the AABBs, with continuous plaster, cobbles and terrain
textures rather than smearing the whole kit atlas over a door jamb or ground tile. Furniture/vegetation
retain their uploaded geometry. Interiors are double-sided. Thin ground passes are front-sided with
explicit ground/decal depth offsets, preventing distant top/bottom-face flickering. Existing lighting/smoke/disposal behavior stays.

Canonical seed: **13,129 visual placements, 50 instanced aliases, 7,030 collision boxes**. Multiple source
materials may require more than one draw per instance batch; the test overview rendered in 73 draw calls.
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

Each upper floor retains one smooth ramp and a real overhead well. Rotating/scaling a building also
transforms its collision, ramp axis/slope direction, doors, holes, tiles and complete 3D navigation graph.
Treads are visual only, never individual plank colliders. Roads connect to both exterior doors through
explicit safe approaches. Planting, props and spawn runouts are kept clear of graph corridors.

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

The browser suite checks real uploaded assets, 196,796 JS collision-edge samples, 144 ramp sprint cases
at 20/60/144 FPS, all thirty model loads/dimensions, pistol support-grip spacing, per-model placement,
loadout selection, and (with `CITY_LIVE=1`) actual Solo/Pyodide and two-seat RelayHostNet/RelayNet.
`CITY_ONLY_LIVE=1` skips the isolated asset pass for faster transport iteration.

The sandbox browser is Chromium 92. Its isolated test fixture rewrites only vendored Pyodide class
static-block syntax and enables experimental Wasm flags; **production/vendor files are not modified**.
Optional `/api/*` probes fail normally on a bare Python static server and are not missing game assets.
Physical phones and a deployed Vercel instance have not been tested.

See [arsenal-and-sidearms.md](arsenal-and-sidearms.md) for the weapon additions and controls.

### Latest completed run

108 Python tests, 32 seed/artifact cases, the full WebGL asset/collision/sprint suite, Solo/Pyodide
sidearm controls, four mobile layouts, and two-player Relay synchronization all passed. The separate
imported-hand suite also passed 960 poses and 23,040 third-person animated frames; see the arsenal notes.
