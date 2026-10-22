# Procedural City (`proc_city`)

Choose Procedural City in the map picker. The shipped layout uses **seed 1942, generator 7, building grammar 2**. Solo recommends **15 bots** and remembers explicit per-map overrides. Multiplayer defaults to zero bots and permits [host-selected AI](bot-difficulty.md).

## Layout and scale

- **240 × 240 m**, with **128 enterable buildings in 64 physically attached pairs** and **109 shared-wall portals**. Other units have narrow pedestrian passages; five vehicle streets serve an interconnected interior/pedestrian network.
- **37 one-, 37 two-, 36 three- and 18 four-story buildings**. Stories are 3 m; characters are 1.70 m. Footprints/heights vary; exterior doors are at least 1.2 m wide and 2.2–2.5 m tall.
- Eight structural interior uses: apartments, cafes, offices, warehouses, libraries, lounges, workshops and vacant units. Furniture, lighting, rubble and omissions vary by seed/room/floor—not 128 bespoke floor plans.
- **72 × 18 m central pocket park**, twelve mixed trees, paths, benches, lamps, planting and low rubble; no asphalt through its centre.
- **151 staggered low-wall runs and eight vehicles in seven variants**, mixing uploaded wrecks and the street kit. Vegetation/props add cover without canopy-sized invisible walls.
- **1,044 exterior windows and six facade rhythms**: masonry, narrow, paired, offset, tall and mixed. Openings vary in placement/size; two ground-floor exterior doors per building connect to actual approach nodes.

Party-wall portals are real walkable/shootable holes; the remaining shared wall stays solid, including unequal-height pairs. Jambs, closed bays and floors match collision. Furniture behind a window can still block a shot—an aperture does not promise an empty room.

## Shared collision, stairs and navigation

Python, Pyodide and browser collision consume the **same committed [map JSON](../public/shared/maps/proc_city.json)**; clients do not independently randomize geometry. Opening metadata and actual geometry must change together. A new match loads a new artifact; an existing host keeps its loaded map.

Each of **163 upper floors** has a continuous smooth stair collider and real overhead well. Closed **22 cm sloped slabs** have parallel undersides and **2.78 m headroom**; treads are visual, never individual plank colliders. Long sweeps carry support height between samples and require full-body headroom. Jump ceilings use the actual sloped underside, not a flat ramp-AABB base. Legacy wedge ramps on other maps remain supported.

Shared swept-capsule/floor math serves human and bot movement. The authored multistorey navigation graph routes through actual doorways/approaches, keeping furniture/spawn corridors clear; bots do not teleport upstairs. Walls/floors block bullets through shared solid geometry.

## Assets and rendering

Uploaded binaries are unchanged: architectural/street kit in `models/maps/GLB format/`, house stairs/materials, `inter.glb` furniture, `vege/veg.glb` vegetation, the [three credited vehicle uploads](../public/models/maps/VEHICLES.md) and the day skybox.

[City rendering](../public/js/proc-city.js) preserves source material primitives, batches compatible geometry and uses continuous structural textures. Per-building/floor tints, brick/stone/plaster, interior materials and a park path vary surfaces. Warmer sun, ambient fill and fixtures support interior visibility; a **1024 px static sun shadow** bakes after asset loading.

Detailed assets use **64 m spatial batches**. Non-colliding ornaments use **32 m batches**, 50 m entry/60 m exit distance hysteresis, updated at most 10 Hz. Physical furniture, walls, cover, vehicles, trees and collision are **never hidden by ornament LOD**. Foliage uses alpha testing; ground/decal offsets limit flicker. These are bounded rendering choices, not an FPS or phone-performance guarantee.

## Optional authoring and checks

[proc_city.js](../public/engine/proc_city.js) and [city-building.js](../public/engine/city-building.js) are authoring modules. Regeneration is **optional development work, not a deployment build step**:

```sh
node tools/generate-proc-city.mjs 1942
node tools/test-proc-city.mjs
node tools/test-city-openings.mjs
CITY_COLLISION_SEEDS=32 node tools/test-city-openings.mjs
python tools/test-proc-city.py
STAIR_JS_PARITY=1 python tools/test-stairs.py
node tools/test-stairs.mjs
CITY_LIVE=1 python tools/test-expanded-assets.py
```

See [Node version/browser setup and limits](testing.md). Checks cover deterministic artifact parity, opening/solid-wall rays, routes in both directions, stairs/headroom and actual kit rendering. Optional browser flags: `CITY_ONLY_LIVE=1` skips isolated asset checks; `CITY_SKIP_SCREENSHOTS=1` avoids compositor capture; `CITY_SOFTWARE_GPU=1` limits full-game fixture rendering. These are not sustained 15-bot FPS or cross-NAT benchmarks. Weapon/reload details belong in [the arsenal guide](arsenal-and-sidearms.md).

中文：城市为密集相连建筑、小路、中心小公园与少量车辆；楼梯用连续坡面，墙体与开口共用权威碰撞数据。单人默认建议 15 个 AI；联机可由房主配置，不再限定纯真人。
