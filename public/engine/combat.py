"""Combat geometry and damage maths.

Shared source of truth: shared/weapons.json + shared/map.json.
Everything here is pure math with no I/O or game state, so it can be unit-tested
and reused by both the hit registration and the bot AI.
"""

import json
import heapq
import math
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared"


def _load(name):
    with open(SHARED / name, "r", encoding="utf-8") as f:
        return json.load(f)


WEAPONS_DATA = _load("weapons.json")
REGISTRY = _load("maps.json")

COMBAT = WEAPONS_DATA["combat"]
# Ballistic throw shared by the smoke and flare abilities: how long Q is held
# maps onto how far the projectile flies. Read by both the ability handler and
# (through weapons.json) the client's aim preview.
THROW = COMBAT["throw"]
CLASSES = {c["id"]: c for c in WEAPONS_DATA["classes"]}
WEAPONS = {w["id"]: w for w in WEAPONS_DATA["weapons"]}

SECONDARIES = [w["id"] for w in WEAPONS_DATA["weapons"] if w.get("slot") == "secondary"]
CLASS_WEAPONS = {}
for _w in WEAPONS_DATA["weapons"]:
    if _w.get("slot") != "secondary":
        CLASS_WEAPONS.setdefault(_w["class"], []).append(_w["id"])

TEAMS = WEAPONS_DATA["teams"]

# Every class ability the server knows how to run; validated at startup so a
# typo in weapons.json fails loudly instead of silently doing nothing.
ABILITY_KINDS = ("smoke", "heal", "ammo", "flare")

MAPS = REGISTRY["maps"]
MAP_BY_ID = {m["id"]: m for m in MAPS}
DEFAULT_MAP_ID = REGISTRY.get("default") or MAPS[0]["id"]

# The live map. set_map() rebinds these; every function below looks them up at
# call time, so a mid-session map swap needs no other change.
CUR_MAP_ID = DEFAULT_MAP_ID
MAP_DATA = {}
BOXES = []
SOLID = []
GROUND_Y = 0.0
# Top of the backstop slab, i.e. the lowest surface in the map. floor_at falls
# back to it so a hole with no floor under it still stops a body, while leaving
# sunken ground (which has a floor slab of its own) free to sit above it.
FLOOR_BASE = 0.0
# The single backstop slab, cached so ray_world never rescans BOXES for it.
GROUND_BOX = None
BOUNDS = {}
SPAWNS = {}
NAV = []
DECOR = {}

# Collision acceleration: a plain XZ bucket grid. A generated map carries
# thousands of boxes (cs_italy: ~4700), and the tick calls blocked()/floor_at()/
# ray_world() for every player and bullet, so scanning the whole list per query
# is what starves the event loop. Every box is filed into each cell its XZ
# footprint touches, so a query only ever visits the handful of boxes near it.
GRID_CELL = 2.0
GRID = {}
RAMP_PLANES = {}

# Navigation flow field, one per team: cell -> the one step that shortens the
# walk to the enemy's spawn area. Cells are finer than the collision grid so a
# doorway stays connected. Built once per map (see _build_nav) and read by the
# bots whenever no enemy is in sight, so they walk real corridors instead of
# aiming straight through walls.
NAV_CELL = 1.0
NAV_FLOW = {}


def _build_grid():
    """Rebuild GRID from SOLID. Called by set_map."""
    global GRID, RAMP_PLANES
    RAMP_PLANES = {}
    g = {}
    c = GRID_CELL
    for b in SOLID:
        x0 = b["x"] - b["w"] * 0.5
        x1 = b["x"] + b["w"] * 0.5
        z0 = b["z"] - b["d"] * 0.5
        z1 = b["z"] + b["d"] * 0.5
        for ix in range(int(math.floor(x0 / c)), int(math.floor(x1 / c)) + 1):
            for iz in range(int(math.floor(z0 / c)), int(math.floor(z1 / c)) + 1):
                g.setdefault((ix, iz), []).append(b)
    GRID = g


def _near(x, z, r):
    """Boxes whose grid cells overlap [x-r, x+r] x [z-r, z+r].

    A box is filed under every cell it touches, so the 1-3 cells this covers
    hold every candidate; callers still do their own precise test. The same box
    may appear twice when it spans a cell boundary, which only costs a repeated
    (idempotent) check.
    """
    c = GRID_CELL
    ix0 = int(math.floor((x - r) / c))
    ix1 = int(math.floor((x + r) / c))
    iz0 = int(math.floor((z - r) / c))
    iz1 = int(math.floor((z + r) / c))
    if ix0 == ix1 and iz0 == iz1:
        return GRID.get((ix0, iz0), ())
    out = []
    for ix in range(ix0, ix1 + 1):
        for iz in range(iz0, iz1 + 1):
            cell = GRID.get((ix, iz))
            if cell:
                out.extend(cell)
    return out


def _ray_cells(ox, oz, dx, dz, max_t):
    """Yield (t_enter, ix, iz) for every grid cell a ray crosses.

    Amanatides-Woo 2D traversal: each step advances to the next vertical or
    horizontal cell boundary, so no cell between the endpoints is skipped.
    """
    c = GRID_CELL
    ix = int(math.floor(ox / c))
    iz = int(math.floor(oz / c))
    if abs(dx) < 1e-9 and abs(dz) < 1e-9:
        yield 0.0, ix, iz
        return
    step_x = 1 if dx > 0 else -1
    step_z = 1 if dz > 0 else -1
    if abs(dx) > 1e-9:
        t_max_x = ((ix + (1 if dx > 0 else 0)) * c - ox) / dx
        t_delta_x = c / abs(dx)
    else:
        t_max_x, t_delta_x = float("inf"), float("inf")
    if abs(dz) > 1e-9:
        t_max_z = ((iz + (1 if dz > 0 else 0)) * c - oz) / dz
        t_delta_z = c / abs(dz)
    else:
        t_max_z, t_delta_z = float("inf"), float("inf")
    t = 0.0
    while t <= max_t:
        yield t, ix, iz
        if t_max_x < t_max_z:
            t = t_max_x
            t_max_x += t_delta_x
            ix += step_x
        else:
            t = t_max_z
            t_max_z += t_delta_z
            iz += step_z


def _map_path(meta):
    rel = meta["file"].lstrip("/")
    if rel.startswith("shared/"):
        rel = rel[len("shared/"):]
    return SHARED / rel


def load_map_json(map_id):
    meta = MAP_BY_ID.get(map_id) or MAP_BY_ID[DEFAULT_MAP_ID]
    with open(_map_path(meta), "r", encoding="utf-8") as f:
        return meta, json.load(f)


def set_map(map_id):
    """Make map_id the live map. Returns (id, meta); unknown ids fall back."""
    global CUR_MAP_ID, MAP_DATA, BOXES, SOLID, GROUND_Y, FLOOR_BASE, BOUNDS, SPAWNS, NAV, DECOR, GROUND_BOX
    meta, data = load_map_json(map_id)
    MAP_DATA = data
    BOXES = data["boxes"]
    SOLID = [b for b in BOXES if b["t"] != "ground"]
    GROUND_Y = data["groundY"]
    ground = next((b for b in BOXES if b["t"] == "ground"), None)
    GROUND_BOX = ground
    FLOOR_BASE = (ground["y"] + ground["h"] * 0.5) if ground else GROUND_Y
    BOUNDS = data["bounds"]
    SPAWNS = data["spawns"]
    NAV = data.get("navPoints", [])
    DECOR = data.get("decor", [])
    _build_grid()
    _build_nav()
    CUR_MAP_ID = meta["id"]
    return CUR_MAP_ID, meta


def map_meta(map_id=None):
    """Client-facing description of a map, for welcome / the map broadcast."""
    meta = MAP_BY_ID.get(map_id or CUR_MAP_ID) or MAP_BY_ID[DEFAULT_MAP_ID]
    return {
        "id": meta["id"],
        "name": meta["name"],
        "nameEn": meta.get("nameEn", meta["name"]),
        "file": meta["file"],
        "scene": meta.get("scene"),
    }


PLAYER_RADIUS = 0.35
STEP_UP_MAX = 0.65
SPAWN_FLAT = 0.1        # a spawn may only sit this close to the street plane
SPAWN_JITTER = 0.5      # spread around an authored point; small on purpose
SPAWN_TRIES = 24
SPAWN_RUNWAY = 5.0      # metres of walkable ground a spawn would like to have
ZONE_HEAD = 0.845
ZONE_TORSO = 0.55


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def dist3(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def normalize(v):
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if n < 1e-9:
        return (0.0, 0.0, 0.0)
    return (v[0] / n, v[1] / n, v[2] / n)


def dir_from_angles(yaw, pitch):
    """yaw in degrees around Y (0 = +X), pitch in degrees (+ = up)."""
    y = math.radians(yaw)
    p = math.radians(pitch)
    cp = math.cos(p)
    return (math.cos(y) * cp, math.sin(p), math.sin(y) * cp)


# --------------------------------------------------------------------------
# movement collision
# --------------------------------------------------------------------------

def ramp_height(b, x, z):
    """Surface height of a ramp box at (x, z); flat where it is not a ramp."""
    if b.get("t") != "ramp":
        return b["y"] + b["h"] * 0.5
    x0 = b["x"] - b["w"] * 0.5
    z0 = b["z"] - b["d"] * 0.5
    if b.get("ax") == "z":
        span = b["d"]
        k = 0.0 if span < 1e-9 else (z - z0) / span
    else:
        span = b["w"]
        k = 0.0 if span < 1e-9 else (x - x0) / span
    k = 0.0 if k < 0.0 else (1.0 if k > 1.0 else k)
    return b["y0"] + (b["y1"] - b["y0"]) * k


def blocked(x, z, y, height=None):
    """True if a body at (x, z) with feet at y would be inside geometry.

    ``height`` is the body's collision height -- the standing capsule by default,
    or ``crouchHeight`` while crouched -- so a low passage the crouched body fits
    through stops blocking it.

    A ramp is a solid wedge: walkable on its slope but solid underneath. Where
    the slope is within one step of the feet the body is on the ramp (fine);
    where it is higher the body would be inside the wedge. Skipping ramps
    outright is what used to let a body walk into a ramp footprint from the side
    and then drop through the (unfloored) footprint to the backstop slab.
    """
    h = COMBAT["playerHeight"] if height is None else height
    for b in _near(x, z, PLAYER_RADIUS):
        if abs(x - b["x"]) > b["w"] * 0.5 + PLAYER_RADIUS:
            continue
        if abs(z - b["z"]) > b["d"] * 0.5 + PLAYER_RADIUS:
            continue
        if b["t"] == "ramp":
            surface = ramp_height(b, x, z)
            # Walkable on the slope (within a step) and passable underneath a
            # higher flight *only where a real floor carries the body*. The
            # generator drops the floor under every ramp footprint, so a body
            # that steps in below the slope has nothing to stand on and would
            # drop to the backstop slab -- the "between the ground and the
            # texture" wedge bots used to get stuck in. Allow the move only when
            # floor_at confirms support; otherwise the body is inside the wedge.
            if surface - y > STEP_UP_MAX and floor_at(x, z, y) <= FLOOR_BASE + 1e-6:
                return True
            continue
        top = b["y"] + b["h"] * 0.5
        bot = b["y"] - b["h"] * 0.5
        if top - y > STEP_UP_MAX and bot < y + h:
            return True
    return False


def resolve_move(old, target, y, height=None):
    """Slide the move along walls: full move, then X-only, then Z-only, else stay.

    ``old`` and ``target`` are both full [x, y, z] positions; only X and Z are
    used here, so the Z component must come from index 2 (index 1 is the feet
    height and would collapse every body onto the map's centre line).
    """
    # Endpoint-only collision can tunnel through a thin wall on a late packet.
    steps = max(1, math.ceil(math.hypot(target[0]-old[0], target[2]-old[2]) / (PLAYER_RADIUS * 0.5)))
    dx, dz = (target[0]-old[0])/steps, (target[2]-old[2])/steps
    x, z = old[0], old[2]
    for _ in range(steps):
        nx, nz = x+dx, z+dz
        if not blocked(nx, nz, y, height):
            x, z = nx, nz
        elif not blocked(nx, z, y, height):
            x = nx
        elif not blocked(x, nz, y, height):
            z = nz
    return x, z


def is_void_floor(x, z, y):
    """A model map's unrendered backstop is rescue terrain, not a playable floor."""
    if not MAP_BY_ID.get(CUR_MAP_ID, {}).get("scene") or y > FLOOR_BASE + 0.05:
        return False
    for b in _near(x, z, PLAYER_RADIUS):
        if abs(x-b["x"]) > b["w"]*0.5+PLAYER_RADIUS or abs(z-b["z"]) > b["d"]*0.5+PLAYER_RADIUS:
            continue
        top = ramp_height(b,x,z) if b["t"] == "ramp" else b["y"]+b["h"]*0.5
        if abs(top-y) <= 0.05:
            return False
    return True


def floor_at(x, z, feet_y):
    """Height of the surface a player with their feet at feet_y stands on.

    Mirrors `blocked`'s footprint exactly: a box counts when it reaches (x, z)
    and its top is within one step of the feet -- i.e. exactly the boxes that do
    not block the player. The highest such top wins, so a stair tread lifts the
    player while a wall (a full step or more above them) never acts as floor.

    A ramp is evaluated at the player's own (x, z): near its low end the surface
    is the low end's height, so the bottom of a flight is reachable in one step
    even though its far end is metres up. Falls back to the backstop slab, so a
    hole with no box under it is still solid, while a sunken piazza (which has a
    floor slab of its own) can sit below the street.
    """
    limit = feet_y + STEP_UP_MAX
    best = FLOOR_BASE
    for b in _near(x, z, PLAYER_RADIUS):
        if abs(x - b["x"]) > b["w"] * 0.5 + PLAYER_RADIUS:
            continue
        if abs(z - b["z"]) > b["d"] * 0.5 + PLAYER_RADIUS:
            continue
        if b["t"] == "ramp":
            top = ramp_height(b, x, z)
            if top <= limit and top > best:
                best = top
            continue
        bot = b["y"] - b["h"] * 0.5
        top = b["y"] + b["h"] * 0.5
        # bot <= limit keeps a body from being levitated onto a slab that floats
        # above its head (an archway lintel, an overhang).
        if top <= limit and bot <= limit and top > best:
            best = top
    return best


def _spawn_ok(x, z):
    """True when (x, z) is a sane street-level spawn with ground underneath.

    The height test is two-sided on purpose. A cell whose only floor is a sunken
    terrace sits *below* the street; accepting it would drop the player onto the
    map's base slab with the visible ground far below their feet.
    """
    if not (BOUNDS["minX"] + 1.5 <= x <= BOUNDS["maxX"] - 1.5):
        return False
    if not (BOUNDS["minZ"] + 1.5 <= z <= BOUNDS["maxZ"] - 1.5):
        return False
    if blocked(x, z, GROUND_Y):
        return False
    if ground_below(x, z, GROUND_Y) is None:
        return False
    return abs(floor_at(x, z, GROUND_Y) - GROUND_Y) <= SPAWN_FLAT


def _spawn_runway(x, z, yaw):
    """True when the ground ahead of a spawn is walkable for a few metres.

    The authored points are flat and open by construction, but a map can still
    place a bunker two metres in front of one: the player then spawns nose-first
    into a wall, and holding W does nothing until they turn around. This is a
    *preference* -- a walled-in spawn is still used when the map offers nothing
    better, so no map can be left without a spawn.
    """
    rad = math.radians(yaw)
    fx, fz = math.cos(rad), math.sin(rad)
    for i in range(1, int(SPAWN_RUNWAY / 0.5) + 1):
        d = i * 0.5
        px, pz = x + fx * d, z + fz * d
        if blocked(px, pz, GROUND_Y):
            return False
        if abs(floor_at(px, pz, GROUND_Y) - GROUND_Y) > 1.5:
            return False
    return True


def _spawn_at(x, z, yaw):
    """A validated spawn standing *on* the local surface, never on a fixed height.

    Returning GROUND_Y blindly is what used to bury a player who landed on a
    step a few centimetres proud of the street: the feet stayed at street level
    while the ground under them was higher.
    """
    return [x, floor_at(x, z, GROUND_Y), z], yaw


def _nav_walkable(ix, iz):
    """A nav cell counts as walkable when its centre is clear at street level."""
    c = NAV_CELL
    x = (ix + 0.5) * c
    z = (iz + 0.5) * c
    if not (BOUNDS["minX"] < x < BOUNDS["maxX"] and BOUNDS["minZ"] < z < BOUNDS["maxZ"]):
        return False
    return not blocked(x, z, GROUND_Y)


def _build_nav():
    """Flood a per-team flow field out from the enemy spawn area.

    Every walkable cell stores (distance, step_ix, step_iz): the single cell step
    that shortens the walk to the enemy side. Bots read it while no foe is in
    sight, so they follow doorways and corridors instead of charging the nearest
    enemy through a wall -- the greedy heading is what pinned the whole squad on
    the spot in cs_italy's spawn courtyard. Runs once per set_map, after
    _build_grid, since it queries blocked().
    """
    global NAV_FLOW
    if MAP_DATA.get("bot_nav"):
        NAV_FLOW = {}  # Authored multistorey graph replaces the dense 2D flood.
        return
    c = NAV_CELL
    ix0 = int(math.floor(BOUNDS["minX"] / c))
    ix1 = int(math.floor(BOUNDS["maxX"] / c))
    iz0 = int(math.floor(BOUNDS["minZ"] / c))
    iz1 = int(math.floor(BOUNDS["maxZ"] / c))

    walk = set()
    for ix in range(ix0, ix1 + 1):
        for iz in range(iz0, iz1 + 1):
            if _nav_walkable(ix, iz):
                walk.add((ix, iz))

    steps = ((1, 0), (-1, 0), (0, 1), (0, -1),
             (1, 1), (1, -1), (-1, 1), (-1, -1))
    field = {}
    for team in (0, 1):
        seen = {}
        q = deque()
        for p in (SPAWNS.get(str(1 - team)) or []):
            k = (int(math.floor(p["x"] / c)), int(math.floor(p["z"] / c)))
            # An authored point can land on a cell whose centre is clipped by a
            # wall; snap it onto the closest walkable cell instead of losing the
            # whole source.
            if k not in walk:
                best = None
                for ox in range(-2, 3):
                    for oz in range(-2, 3):
                        cand = (k[0] + ox, k[1] + oz)
                        if cand in walk:
                            d = ox * ox + oz * oz
                            if best is None or d < best[0]:
                                best = (d, cand)
                if best is None:
                    continue
                k = best[1]
            if k not in seen:
                seen[k] = (0, 0, 0)
                q.append(k)
        while q:
            cur = q.popleft()
            d0 = seen[cur][0]
            for ddx, ddz in steps:
                nk = (cur[0] + ddx, cur[1] + ddz)
                if nk in seen or nk not in walk:
                    continue
                seen[nk] = (d0 + 1, cur[0] - nk[0], cur[1] - nk[1])
                q.append(nk)
        field[team] = seen
    NAV_FLOW = field


def nav_dir(x, z, team):
    """Unit (dx, dz) that walks (x, z) toward the enemy side, or None.

    Reads the team's flow field, falling back to the closest filed neighbour when
    the queried point sits in a cell the flood never reached (a spot only the
    player's collision capsule fits into), so a bot that has drifted off the grid
    can still find its way back on.
    """
    field = NAV_FLOW.get(team)
    if not field:
        return None
    c = NAV_CELL
    bx = int(math.floor(x / c))
    bz = int(math.floor(z / c))
    best = None
    for ox in (-1, 0, 1):
        for oz in (-1, 0, 1):
            k = (bx + ox, bz + oz)
            e = field.get(k)
            if e is None:
                continue
            score = (abs(ox) + abs(oz), e[0])
            if best is None or score < best[0]:
                best = (score, k, e)
    if best is None:
        return None
    _, k, e = best
    if e[1] == 0 and e[2] == 0:
        return None                 # already standing on the goal area
    if k == (bx, bz):
        n = math.hypot(e[1], e[2])
        return (e[1] / n, e[2] / n)
    # Off-grid: head for the centre of the filed neighbour we picked.
    vx = (k[0] + 0.5) * c - x
    vz = (k[1] + 0.5) * c - z
    n = math.hypot(vx, vz)
    if n < 1e-6:
        n = math.hypot(e[1], e[2]) or 1.0
        return (e[1] / n, e[2] / n)
    return (vx / n, vz / n)


def waypoint_route(start, goal):
    """3D authored graph for multi-storey maps; old 2D flow fields stay intact.

    Edges are bidirectional walkable corridors, including sampled smooth ramps.
    A nearest-node choice alone can jump floors/walls: validate each attachment
    with the SAME swept capsule/floor queries used by live bot movement.
    """
    graph = MAP_DATA.get("bot_nav")
    if not graph:
        return []
    nodes = {n['id']: n['p'] for n in graph['nodes']}
    def attaches(a, b):
        length = math.hypot(a[0]-b[0], a[2]-b[2])
        feet = a[1]
        for k in range(1, max(1, math.ceil(length/.18))+1):
            t = k/max(1, math.ceil(length/.18))
            x,z = a[0]+(b[0]-a[0])*t, a[2]+(b[2]-a[2])*t
            if blocked(x,z,feet):
                return False
            floor = floor_at(x,z,feet)
            if feet-floor > STEP_UP_MAX:
                return False
            feet=floor
        return abs(feet-b[1]) < .4
    def nearest(p):
        for key in sorted(nodes,key=lambda k:dist3(p,nodes[k])):
            if attaches(p,nodes[key]):
                return key
        return None
    begin,end=nearest(start),nearest(goal)
    if begin is None or end is None:
        return []
    adjacent={k:[] for k in nodes}
    for a,b in graph['edges']:
        cost=dist3(nodes[a],nodes[b]);adjacent[a].append((b,cost));adjacent[b].append((a,cost))
    queue=[(0,begin)];costs={begin:0};parents={}
    while queue:
        cost,key=heapq.heappop(queue)
        if cost>costs[key]:continue
        if key==end:
            path=[end]
            while path[-1]!=begin:path.append(parents[path[-1]])
            result=[nodes[k][:] for k in reversed(path)]
            if attaches(nodes[end],goal):result.append(list(goal))
            return result
        for nxt,weight in adjacent[key]:
            value=cost+weight
            if value<costs.get(nxt,float('inf')):
                costs[nxt]=value;parents[nxt]=key;heapq.heappush(queue,(value,nxt))
    return []


def random_spawn(team, rng):
    """A validated spawn as ([x, y, z], yaw).

    The authored points are already verified flat and street-level by the map
    generator, so they are tried first with only a hand's-width of jitter for
    spread; every candidate is re-checked, and anything that fails is thrown
    away rather than used. Fallbacks run through the authored points, the other
    team's points, a blind scan of the rectangle, and finally the centre.
    """
    own = SPAWNS.get(str(team)) or []
    other = SPAWNS.get(str(1 - team)) or []

    def yaw_of(p):
        return float(p.get("yaw", 0.0 if team == 0 else 180.0))

    # Anything valid but walled in is held back as a fallback: a spawn you can
    # walk out of always beats a spawn you cannot.
    fallback = None
    for _ in range(SPAWN_TRIES):
        if not own:
            break
        p = own[rng.randrange(len(own))]
        x = clamp(p["x"] + (rng.random() - 0.5) * 2.0 * SPAWN_JITTER,
                  BOUNDS["minX"] + 2, BOUNDS["maxX"] - 2)
        z = clamp(p["z"] + (rng.random() - 0.5) * 2.0 * SPAWN_JITTER,
                  BOUNDS["minZ"] + 2, BOUNDS["maxZ"] - 2)
        if not _spawn_ok(x, z):
            continue
        yaw = yaw_of(p)
        if _spawn_runway(x, z, yaw):
            return _spawn_at(x, z, yaw)
        # Wall straight ahead: keep the spot -- a trench corner is still a fine
        # spawn -- but face along the open ground instead of into the sandbags.
        for turn in (45.0, -45.0, 90.0, -90.0):
            if _spawn_runway(x, z, yaw + turn):
                return _spawn_at(x, z, yaw + turn)
        if fallback is None:
            fallback = (x, z, yaw)
    if fallback is not None:
        return _spawn_at(*fallback)

    for pt in own + other:
        if _spawn_ok(pt["x"], pt["z"]):
            return _spawn_at(pt["x"], pt["z"], yaw_of(pt))

    for _ in range(SPAWN_TRIES * 4):
        x = rng.uniform(BOUNDS["minX"] + 2, BOUNDS["maxX"] - 2)
        z = rng.uniform(BOUNDS["minZ"] + 2, BOUNDS["maxZ"] - 2)
        if _spawn_ok(x, z):
            return _spawn_at(x, z, 0.0 if team == 0 else 180.0)

    # Last resort: the street plane is solid everywhere by construction, so the
    # centre is always safe even on a map whose spawns are all unusable.
    cx = (BOUNDS["minX"] + BOUNDS["maxX"]) * 0.5
    cz = (BOUNDS["minZ"] + BOUNDS["maxZ"]) * 0.5
    return [cx, GROUND_Y, cz], 0.0 if team == 0 else 180.0


# --------------------------------------------------------------------------
# ray casting
# --------------------------------------------------------------------------

def ray_box(origin, d, box, max_t):
    """Slab test against an AABB given as centre + full size. Returns t or None."""
    lo = (box["x"] - box["w"] * 0.5, box["y"] - box["h"] * 0.5, box["z"] - box["d"] * 0.5)
    hi = (box["x"] + box["w"] * 0.5, box["y"] + box["h"] * 0.5, box["z"] + box["d"] * 0.5)
    tmin, tmax = 0.0, max_t
    for i in range(3):
        o, dd = origin[i], d[i]
        if abs(dd) < 1e-9:
            if o < lo[i] or o > hi[i]:
                return None
        else:
            t1 = (lo[i] - o) / dd
            t2 = (hi[i] - o) / dd
            if t1 > t2:
                t1, t2 = t2, t1
            if t1 > tmin:
                tmin = t1
            if t2 < tmax:
                tmax = t2
            if tmin > tmax:
                return None
    return tmin


def ray_ramp(origin, d, b, max_t):
    """Ray vs the entire solid wedge, including its sides and underside.

    Clip against the real slope, not its AABB roof or an open top plane.
    Planes are cached until the collision grid/map is rebuilt.
    """
    key = id(b)
    shape = RAMP_PLANES.get(key)
    if shape is None:
        x0, x1 = b['x']-b['w']/2, b['x']+b['w']/2
        z0, z1 = b['z']-b['d']/2, b['z']+b['d']/2
        along_z = b.get('ax') == 'z'
        slope = (b['y1']-b['y0']) / max(1e-6, b['d'] if along_z else b['w'])
        shape = [(1,0,0,x1),(-1,0,0,-x0),(0,0,1,z1),(0,0,-1,-z0),
                 (0,-1,0,-(b['y']-b['h']/2)),
                 (0 if along_z else -slope,1,-slope if along_z else 0,
                  b['y0']-slope*(z0 if along_z else x0))]
        RAMP_PLANES[key] = shape
    enter, leave = 0.0, max_t
    for nx, ny, nz, offset in shape:
        start = nx*origin[0]+ny*origin[1]+nz*origin[2]-offset
        speed = nx*d[0]+ny*d[1]+nz*d[2]
        if abs(speed) < 1e-9:
            if start > 0:
                return None
        elif speed < 0:
            enter = max(enter,-start/speed)
        else:
            leave = min(leave,-start/speed)
        if enter > leave:
            return None
    return enter


def ray_world(origin, d, max_t, skip_ground=False):
    """Nearest solid-map hit distance, or None.

    Walks the grid cells the ray crosses instead of every box in the map, and
    stops as soon as a hit is nearer than the next cell starts. A box touched by
    several cells is tested once (``seen``), which matters for the wide floor and
    wall rectangles that span many cells.
    """
    best = None
    seen = set()
    for t_enter, ix, iz in _ray_cells(origin[0], origin[2], d[0], d[2], max_t):
        if best is not None and t_enter > best:
            break
        for b in GRID.get((ix, iz), ()):
            if id(b) in seen:
                continue
            seen.add(id(b))
            if b["t"] == "ramp":
                t = ray_ramp(origin, d, b, max_t)
            else:
                t = ray_box(origin, d, b, max_t)
            if t is not None and t >= 0.0 and (best is None or t < best):
                best = t
    if not skip_ground and GROUND_BOX is not None:
        t = ray_box(origin, d, GROUND_BOX, max_t)
        if t is not None and t >= 0.0 and (best is None or t < best):
            best = t
    return best


def ground_below(x, z, y):
    """Distance straight down from (x, y, z) to the first map surface, or None.

    A spawn validation helper: ``None`` means the column holds nothing at all,
    which is what a point outside the map (or over a genuine hole) looks like.
    """
    return ray_world((x, y + 0.25, z), (0.0, -1.0, 0.0), 60.0)


def ray_capsule(origin, d, base, height, radius, max_t):
    """Ray vs a vertical capsule. Returns t of the nearest valid entry, or None."""
    ox, oy, oz = origin
    dx, dy, dz = d
    cx, cz, by = base[0], base[2], base[1]
    y_lo = by + radius
    y_hi = by + height - radius
    best = None

    a = dx * dx + dz * dz
    if a > 1e-9:
        fx, fz = ox - cx, oz - cz
        b = 2.0 * (fx * dx + fz * dz)
        c = fx * fx + fz * fz - radius * radius
        disc = b * b - 4.0 * a * c
        if disc >= 0.0:
            sq = math.sqrt(disc)
            for t in ((-b - sq) / (2.0 * a), (-b + sq) / (2.0 * a)):
                if t < 0.0 or t > max_t:
                    continue
                y = oy + dy * t
                if y_lo <= y <= y_hi and (best is None or t < best):
                    best = t

    a3 = dx * dx + dy * dy + dz * dz
    if a3 > 1e-9:
        for sc in (y_lo, y_hi):
            fx, fy, fz = ox - cx, oy - sc, oz - cz
            b = 2.0 * (fx * dx + fy * dy + fz * dz)
            c = fx * fx + fy * fy + fz * fz - radius * radius
            disc = b * b - 4.0 * a3 * c
            if disc < 0.0:
                continue
            sq = math.sqrt(disc)
            for t in ((-b - sq) / (2.0 * a3), (-b + sq) / (2.0 * a3)):
                if 0.0 <= t <= max_t and (best is None or t < best):
                    best = t
    return best


def zone_of(hit_y, base_y, height):
    r = (hit_y - base_y) / height
    if r >= ZONE_HEAD:
        return "head"
    if r >= ZONE_TORSO:
        return "torso"
    return "limb"


def zone_mult(zone):
    if zone == "head":
        return COMBAT["headMult"]
    if zone == "torso":
        return COMBAT["torsoMult"]
    return COMBAT["limbMult"]


def falloff_factor(distance, weapon):
    r0 = float(weapon["rangeM"])
    # Explicit end distance, so a weapon can fall off over its own span instead
    # of the old fixed r0*2.5. r0 may legitimately be 0 (falls off from the muzzle).
    r1 = float(weapon.get("falloffMaxM") or (r0 * 2.5))
    if distance <= r0 or r1 <= r0:
        return 1.0
    if distance >= r1:
        return float(weapon["falloff"])
    k = (distance - r0) / (r1 - r0)
    return 1.0 + (float(weapon["falloff"]) - 1.0) * k


def compute_damage(weapon_id, distance, zone):
    w = WEAPONS[weapon_id]
    if w.get("lethalBody") and zone == "torso":
        # Battlefield-style "sweet spot": a torso shot kills outright inside the
        # band, and is just normal damage outside it. Head shots are lethal at any
        # range anyway, since headMult stacks on top of the base damage.
        lo = float(w.get("lethalMinM", 0.0))
        hi = float(w.get("lethalMaxM", w["rangeM"]))
        if lo <= distance <= hi:
            return 999.0
    return float(w["dmg"]) * zone_mult(zone) * falloff_factor(distance, w)


def reload_is_clip(weapon_id):
    """True for clip-fed bolt-actions, which feed round by round (not a box swap)."""
    return bool(WEAPONS[weapon_id].get("clip"))


def weapon_reserve(weapon_id):
    """Spare rounds a weapon carries on top of its loaded magazine.

    Per-weapon, so a slow bolt-action can be stingy while a 900 RPM SMG hands
    out magazines by the handful.
    """
    return int(WEAPONS[weapon_id].get("reserve") or 0)


def reload_duration(weapon_id, mag, reserve=None):
    """How long a reload takes, in ms, given the rounds currently loaded.

    Magazine guns swap a whole box: one fixed time from a partial magazine and a
    longer one from empty. Clip-fed bolt-actions instead feed a stripper clip, so
    the time scales with how many rounds are missing -- and is a fixed time when
    the chamber holds 0-1 rounds (a full clip). The server also credits rounds
    progressively for clips, so firing early keeps whatever is already in.

    ``reserve`` clamps the clip time to the rounds actually left to load, so an
    almost-dry player is not stuck watching a full-clip animation.
    """
    w = WEAPONS[weapon_id]
    clip = w.get("clip")
    if clip:
        if mag <= 1:
            return float(clip["fullMs"])
        need = int(clip["clipMax"]) - mag
        if reserve is not None:
            need = min(need, reserve)
        return max(0.0, need) * float(clip["perRoundMs"])
    if mag <= 0:
        return float(w.get("reloadEmptyMs") or w["reloadMs"])
    return float(w["reloadMs"])


def has_line_of_sight(a, b):
    """True when nothing solid sits between two eye positions."""
    d = normalize((b[0] - a[0], b[1] - a[1], b[2] - a[2]))
    span = dist3(a, b)
    if span < 0.2:
        return True
    t = ray_world(a, d, span - 0.2, skip_ground=True)
    return t is None


def validate_shared_data():
    """Cheap startup assertion so a broken JSON never reaches a live match."""
    problems = []
    for w in WEAPONS_DATA["weapons"]:
        if w["class"] not in CLASSES and not (w.get("slot") == "secondary" and w["class"] == "secondary"):
            problems.append("weapon %s has unknown class %s" % (w["id"], w["class"]))
        for key in ("dmg", "rpm", "mag", "reloadMs", "spreadDeg", "rangeM", "falloff", "zoomFov"):
            if key not in w:
                problems.append("weapon %s missing %s" % (w["id"], key))
        if w.get("clip") is None and "reloadEmptyMs" not in w:
            problems.append("weapon %s has neither clip nor reloadEmptyMs" % w["id"])
        if weapon_reserve(w["id"]) <= 0:
            problems.append("weapon %s missing reserve" % w["id"])
    for c in WEAPONS_DATA["classes"]:
        if not CLASS_WEAPONS.get(c["id"]):
            problems.append("class %s has no weapons" % c["id"])
        if c.get("ability") not in ABILITY_KINDS:
            problems.append("class %s has unknown ability %s" % (c["id"], c.get("ability")))
    for key in ("chargeMs", "minDist", "smokeMaxDist", "flareMaxDist",
                "flightBaseMs", "flightPerMMs", "apexPerM"):
        if key not in THROW:
            problems.append("combat.throw missing %s" % key)
    for w in WEAPONS_DATA["weapons"]:
        if w.get("lethalBody") and w["class"] != "scout":
            problems.append("weapon %s has lethalBody but is not scout" % w["id"])
    if len(SPAWNS.get("0", [])) == 0 or len(SPAWNS.get("1", [])) == 0:
        problems.append("map is missing spawn points")
    return problems


# Bind the default map last: set_map builds the collision grid *and* the bot
# navigation field, both of which need the helpers defined above.
set_map(DEFAULT_MAP_ID)


if __name__ == "__main__":
    issues = validate_shared_data()
    if issues:
        for i in issues:
            print("PROBLEM:", i)
        raise SystemExit(1)
    print("shared data OK: %d weapons, %d classes, %d solid boxes"
          % (len(WEAPONS), len(CLASSES), len(SOLID)))
    for cid, c in CLASSES.items():
        print("  %-8s %s -> %s" % (cid, c["nameEn"], ", ".join(CLASS_WEAPONS[cid])))