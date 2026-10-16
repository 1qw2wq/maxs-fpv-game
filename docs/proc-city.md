# Procedural City (`proc_city`)

Select **Procedural City** in the main menu before deploying. The shipped map uses seed **1942**.
No frontend build, npm dependency, additional physics engine, external backend, or asset download is required.

## 1. Uploaded assets / inspection

The requested `models/buildings/proc_kit.glb` and `img/skybox/` were not present. Per the user's clarification,
this implementation uses the already uploaded assets **in their original locations**:

- `public/models/maps/GLB format/`: modular building/street/barrier pieces.
- `public/models/maps/house.glb`: floor material, stair treads and wooden rail material.
- `public/models/maps/inter.glb`: dining tables, tall display cabinets, radiators, rugs and chandeliers.
- `public/models/maps/Skyboxes/skybox-day.png`: 4096×2048 equirectangular panorama.

`node tools/inspect-proc-kit.mjs` scans 126 GLBs / 214 meshes using the **vendored Three `Box3`**, including
scene-node transforms, and writes `public/shared/proc-kit.json`. It accepts individual GLB paths too.
The manifest's `meshes` list contains original node names, file paths, bounds and dimensions;
`groups` maps each category to indices into that list:

| Category | Candidates |
| --- | ---: |
| floor | 22 |
| ceiling | 1 |
| wall_solid | 43 |
| wall_doorway | 4 |
| wall_window | 5 |
| stairs | 4 |
| cover_low | 13 |
| cover_high | 4 |
| decorative | 118 |

Categories are semantic **candidates**, not permission to use a whole-mesh collider across an opening.
Some source units are very large (e.g. a cabinet is 4.16 m tall); runtime prototype extraction removes staging
transforms, centers each mesh, and normalizes its measured bounds. The curated alias dictionary `CITY_KIT`
in `public/js/proc-city.js` resolves selected original node names through GLTF parser associations, including
names the loader suffixes/sanitizes. No uploaded binaries were changed. Their existing licenses still apply;
the files do not embed author/license metadata, so this feature does not assert new redistribution rights.

## 2. Deterministic generation / authoritative data

`public/engine/proc_city.js` exports `generateProcCity(integerSeed)` as a plain ES module. A uint32 LCG
(`Math.imul`, no `Math.random`, clock or DOM) selects 2–4 building sites and furniture/cover variations.
The default seed produces four 12×12 m buildings around two intersecting 12 m streets within a 60×60 m arena.

Each building has two 3 m stories, two 1.8×2.5 m exterior doors on opposite walls, three rooms per floor,
1.8 m partition doors, 1.05 m window sills, tables (0.95 m), cabinets (2.2 m) and radiators (1 m).
A 2.2×6 m smooth ramp rises from Y=0 to Y=3. Its 3×7 m ceiling hole includes capsule/head clearance.
Visible treads are **visuals only**, never individual movement colliders. Upper floor rails protect the well.
Opposing spawns have authored yaw/team values and at least five clear metres ahead.

The committed artifact `public/shared/maps/proc_city.json` is the **single source of truth** for both engines:

- `boxes`: the existing named center/full-size AABB object schema (`x,y,z,w,h,d,t`), plus existing ramp fields
  `ax,y0,y1`. This intentionally does not introduce an incompatible six-number-only box format.
- `spawns`: the existing team-keyed schema, with `yaw` and `team` on each point.
- `tiles`: visual alias, bottom-center position, `rotY` in radians and world-size `scale`.
- `floor_holes`, `buildings`, `navPoints`, and a 3D `bot_nav` node/edge graph.

Python `combat.py` reads the artifact just like other maps. `local.js` already mirrors **every registered map**
into Pyodide's filesystem, so it needs no duplicate generator or new Python module. Browser visuals and
collision load that exact same artifact, including its seed. No client independently randomizes a match.

Optional **map authoring**, not a deployment build step:

```sh
node tools/generate-proc-city.mjs 1942
```

To ship a different seed, regenerate and distribute the shared artifact to both engines together. There is
no per-client seed setting or runtime seed negotiation. The menu description identifies the shipped seed.

## 3. Rendering / atmosphere

`World.init()` selects the city renderer; `buildProcCity(scene,mapData,extractedKit)` is exported from
`public/js/map.js`. It batches 724 placements into 12 `InstancedMesh` objects for the default seed.
Structural walls/slabs are closed geometry matching collision thickness, with continuous procedural plaster
and cobblestone surfaces rather than incorrectly projecting an entire facade atlas onto each jamb.
Floors/wood retain their source atlas UV crop; furniture and treads retain the uploaded geometry/materials.
All interior materials are double-sided, and structural materials write opaque depth.

`lighting.js` loads the existing daytime panorama into `scene.background`, bakes a PMREM environment,
and uses warm directional sunlight, a 1024² soft shadow map, ambient/hemisphere fill and subtle distance fog.
Map disposal releases owned panorama/PMREM/shadow resources without clearing a newer map's environment.
Smoke correctly replaces and restores texture backgrounds. Other maps keep their existing lighting path.

## 4. Navigation / verification

The authored graph connects central/outer streets to both doors, the two left rooms, stair hall, every half-metre
of each ramp and upper lookouts. `combat.waypoint_route()` uses weighted 3D shortest paths and validates
attachments against actual capsule/floor queries so routes cannot jump walls or floors.
`bots.py` uses these routes for city objectives/investigation and patrols upstairs lookouts when not in combat;
ordinary maps keep their existing 2D flow-field behavior. Bots walk through `_steer`, not teleports/jump hacks.

```sh
node tools/test-proc-city.mjs       # 32 seeds, reproducibility, layout rules, artifact equality
python tools/test-proc-city.py     # both-way graph sweeps, door/window rays, cover, runouts,
                                  # actual bot ascent and two-player authoritative room
```

Optional browser regression `tools/test-proc-city-browser.py` uses an externally provided Python Playwright
installation and `CHROMIUM_EXECUTABLE` pointing to a current Chromium. Set `CITY_ORIGIN` to a normal static
preview with the existing `/api/*` JSON shims. It checks the real menu, loaded assets, PMREM, instancing,
13,180 JS edge samples, 20/60/144 FPS sprint ascent, Solo/Pyodide bot ascent and two-player Relay networking.
The frontend never imports these test dependencies. No npm install is necessary.

### Verification in this workspace

- 96 Python regression tests passed (including seven new city tests).
- 32 deterministic seed cases and exact artifact reproduction passed.
- WebGL inspection passed: 724 placements / 12 instance batches; 13,180 collision-edge samples;
  sprint ascent at 20/60/144 FPS; uploaded textures and panorama/PMREM loaded.
- Actual `main.js` Solo/Pyodide deployment and bot ascent passed; actual two-seat
  `RelayHostNet`/`RelayNet` city welcome/state synchronization passed without an external service.
- No missing asset responses or uncaught browser errors were observed. Existing autoplay/legacy-browser
  warnings are not treated as application errors. The available test Chromium was version 92, so its isolated
  test server adapted **only the already-vendored Pyodide class static-block syntax** and enabled experimental
  Wasm flags. No production/vendor file was adapted, and no frontend build or npm tool was used.
- Physical phones and a deployed Vercel instance were not tested.
