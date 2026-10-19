# Expanded Procedural City (`proc_city`)

Select **Procedural City** in the main-menu map picker. The committed seed is **1942**, using city generator **version 6** (template grammar version 2).

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
  cabinets, tables, rugs, pictures and lighting do not appear in every unit. 2,043 furniture/decor
  placements in the tracked furnishing aliases, compared with 1,275 in the previous version.
- 156 staggered low-wall cover runs, 82 parked vehicles in seven variants (including all three new car uploads), 132 shop awnings and 292 additional
  vegetation/street placements. Uploaded birch, broadleaf, pine, autumn/dead trees, bushes, berries,
  plants and flowers are mixed with the original street kit. Foliage has no canopy-sized invisible wall.

The eight interior uses share a structural grammar; these are not 132 individually hand-authored floor
plans. Story height remains 3 m and characters remain 1.70 m tall. Exterior doors remain at least 1.2 m
wide and now vary from 2.2 to 2.5 m tall. Shared-wall portals are real walkable/shootable openings;
all other party-wall sections are solid, including where the neighbouring building is shorter.

## Less repetitive doors, windows and passages

The previous grammar cut a window into every upper-floor facade bay. Version 6 keeps more solid
masonry and varies openings instead of repeating the same large-hole grid throughout the city:

- **1,080 exterior windows**, down from **2,067** in version 5: approximately **48% fewer**.
  These counts exclude the wall removed between attached units; they are real exterior apertures,
  not painted window textures or a count of all wall meshes.
- **Six seeded facade rhythms**: masonry, narrow, paired, offset, tall and mixed. Each side and floor
  selects its window bays; narrow, taller and mixed-width profiles vary the silhouette. Widths, sill
  heights and lintel heights vary independently of the eight interior uses.
- **Two usable ground-floor exterior doors per building** remain. Doors move between the left and
  middle facade bays, with additional offsets and different widths/heights; front and rear doors need
  not line up. Each ground front/rear facade has only one window beside its door.
- **114 shared-wall connections** remain across 66 pairs. Portal offsets, widths and lintel heights
  now vary by pair/floor rather than repeating the exact same doorway up the whole wall. All other
  party-wall portions stay solid, and unused template windows are excluded from opening metadata.
- Jambs, sills, headers and closed bays have matching visible geometry and collision. Central-bay
  apertures are moved to one side of the interior partition, not cut across its solid end. Real visible
  furniture behind a window can still block a shot; a window is not a promise of an empty room.
- Entrance approaches, upper-floor lookout positions and perimeter curb cuts follow the actual
  openings. Added inside and party-hall approach nodes prevent diagonal routes from clipping narrow
  doorways, internal partition corners or room furniture. Canopy widths follow their entrance widths.

This is still a seeded structural grammar, not 132 bespoke floor plans. The size, building count,
story heights, five-street layout, stairs, eight interior uses and seven vehicle variants are preserved.
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

Canonical seed: **17,265 visual placements, 57 instanced aliases, 11,254 collision boxes**. Multiple source
materials may require more than one draw per instance batch. No new WebGL draw-call benchmark was
run for this facade revision.
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
node tools/test-proc-city.mjs       # 32 seeds, facade diversity/density, doors/ramps, exact artifact
node tools/test-city-openings.mjs   # Node 22.15+: shipped JS collision, aperture rays, matching visuals
# Optional: also check routes/opening rays on all 32 generated seeds:
CITY_COLLISION_SEEDS=32 node tools/test-city-openings.mjs
python tools/test-proc-city.py     # every graph edge both ways, actual opening/closed-bay rays,
                                  # furniture/floors, runouts, bot ascent and authoritative room
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

Earlier sandbox browser runs used Chromium 92 with a test-only fixture for vendored Pyodide class
static-block syntax and experimental Wasm flags; **production/vendor files were not modified**.
That browser fixture is not a production requirement or a newly rerun check for version 6.
Optional `/api/*` probes fail normally on a bare Python static server and are not missing game assets.
Physical phones and a deployed Vercel instance have not been tested.

See [arsenal-and-sidearms.md](arsenal-and-sidearms.md) for the weapon additions and controls.

### Opening-layout revision verification (2026-10-19)

The **116 native Python tests across nine gameplay suites**, 32 deterministic layout/artifact cases
and shipped JavaScript collision checks passed for version 6. On the canonical seed, the direct JS test covers **562,880
movement samples**, **6,720 aperture rays** and **16,550 solid-wall rays**, plus correspondence between
every wall collider and its rendered box. The expanded collision command checks the canonical seed
and 32 additional seeds, not just their metadata. Python independently checks every graph edge in
both directions, routes from both teams to every upper lookout, real bot ascent, closed facade bays,
window/door jambs, stairs, and every bullet weapon against every shared-floor wall/doorway.

Previous version-5 WebGL, Solo/Pyodide, mobile-layout, imported-hand and two-player Relay runs are
historical coverage, **not** fresh browser/visual validation of this facade revision. A new WebGL run,
physical-phone test and deployed-Vercel check have not been performed for version 6.
