#!/usr/bin/env python3
"""Offline collision + spawn generator for model-based maps.

The glTF node hierarchy already converts the authored FBX into the engine's
Y-up metre space, so the world matrices are applied verbatim -- no extra axis
fix-up. The street plane is found automatically (the height at which most
walls start), everything is translated so that plane sits at y = 0, and every
surface is voxelised into axis-aligned boxes and written to
public/shared/maps/<id>.json in exactly the shape of public/shared/map.json.

Triangles are sorted into three roles by their normal:

  * up-facing   (ny >=  FLOOR_NY) -> a walkable surface. A cell keeps *every*
    such surface it carries, so a bridge deck over the street, or the floor of
    a second-storey room, is solid instead of being swallowed by the ground
    below it. The lowest one is remembered separately as the cell's floor.
  * steep / vertical              -> a wall. A cell stores the vertical
    *intervals* its steep faces really fill, so a deck fascia two metres up
    does not drag a column down to the street and seal the passage beneath it.
  * down-facing (ny <= -FLOOR_NY) -> an underside. Dropped outright, which is
    what keeps archways and overhangs open instead of sealing them shut.

Every walkable surface becomes a thin slab and every solid interval a column
(centre + full size, the shape combat.py reads). That representation is what
lets the engine both block on a wall and let the player stand on a stair tread:
`blocked()` refuses anything more than a step above the feet, while
`floor_at()` finds the tread under them.

Usage:  python tools/build_map.py [input.glb] [output.json]
"""

import json
import math
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_IN = ROOT / "new map" / "cs_italy_with_real_light.glb"
DEFAULT_OUT = ROOT / "public" / "shared" / "maps" / "cs_italy.json"

GROUND_Y = 0.0          # after the shift the street plane sits here
STEP_UP_MAX = 0.65      # a surface this far above the feet is still reachable (matches combat.STEP_UP_MAX)
FLOOR_NY = 0.7          # |normal.y| at or above this counts as up-facing / down-facing
WALL_MAX_H = 12.0       # clamp runaway wall columns
SPAWN_FLAT = 0.1        # a spawn cell must sit within this of the street plane
# Quarter-metre cells: the box a triangle lands in may overhang the triangle by
# up to half a cell, so a coarse grid fattens every wall into an invisible
# barrier. 0.25 m keeps that overhang well under the player's own 0.35 m radius,
# so an archway or alley the eyeball says is wide enough stays walkable.
CELL_CANDIDATES = (0.25, 0.5, 0.75, 1.0)
MAX_BOXES = 20000
HEIGHT_BIN = 0.25       # street-plane detection resolution
HEIGHT_QUANT = 0.1      # heights snap to this, so near-equal surfaces merge
FLOOR_THICK = 0.2       # walkable floors are thin slabs: a solid column would seal a tunnel under them
RAMP_RISE = 0.25        # a flight must rise at least this much before it becomes a ramp
                        # (~two standard 0.13 m risers: a short 2-3 step flight still
                        # smooths instead of jolting the camera one tread at a time)
RAMP_MAX_RISE = STEP_UP_MAX  # one tread may never be more than a step above its neighbour
STREET_SNAP = 0.12      # near-street surfaces snap onto the plane (kills cobble chatter)

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
FMT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
CSIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


# --------------------------------------------------------------------- GLB I/O

def read_glb(path):
    blob = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<4sII", blob, 0)
    if magic != b"glTF":
        raise SystemExit("not a GLB container: %s" % path)
    gltf = None
    binary = None
    off = 12
    while off + 8 <= len(blob):
        clen, ctype = struct.unpack_from("<I4s", blob, off)
        chunk = blob[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == b"BIN\x00":
            binary = chunk
        off += 8 + clen
    if gltf is None:
        raise SystemExit("GLB has no JSON chunk")
    return gltf, binary


def read_accessor(gltf, binary, index):
    acc = gltf["accessors"][index]
    if "sparse" in acc:
        raise SystemExit("sparse accessors are not supported")
    view = gltf["bufferViews"][acc["bufferView"]]
    ncomp = COMPONENTS[acc["type"]]
    fmt = FMT[acc["componentType"]]
    size = CSIZE[acc["componentType"]]
    stride = view.get("byteStride") or ncomp * size
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    unpack = struct.Struct("<" + fmt * ncomp).unpack_from
    return [unpack(binary, base + i * stride) for i in range(acc["count"])]


# ---------------------------------------------------------------- matrices

def mat_identity():
    return [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def mat_mul(a, b):
    """a @ b for two column-major 4x4 matrices (index = col*4 + row)."""
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = (a[row] * b[col * 4]
                                  + a[4 + row] * b[col * 4 + 1]
                                  + a[8 + row] * b[col * 4 + 2]
                                  + a[12 + row] * b[col * 4 + 3])
    return out


def mat_node(node):
    if "matrix" in node:
        return [float(v) for v in node["matrix"]]
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    x, y, z, w = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    r = (
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    )
    m = mat_identity()
    for col in range(3):
        for row in range(3):
            m[col * 4 + row] = r[row * 3 + col] * (sx, sy, sz)[col]
    m[12], m[13], m[14] = tx, ty, tz
    return m


def xform(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def mesh_nodes(gltf):
    """(world matrix, mesh index) for every node that references a mesh."""
    nodes = gltf.get("nodes", [])
    scene = gltf["scenes"][gltf.get("scene", 0)]
    found = []

    def walk(ni, parent):
        node = nodes[ni]
        world = mat_mul(parent, mat_node(node))
        if "mesh" in node:
            found.append((world, node["mesh"]))
        for child in node.get("children", ()):
            walk(child, world)

    for ni in scene.get("nodes", ()):
        walk(ni, mat_identity())
    return found


# ------------------------------------------------------------------- geometry

def gather_triangles(gltf, binary):
    tris = []
    for world, mi in mesh_nodes(gltf):
        for prim in gltf["meshes"][mi].get("primitives", ()):
            if prim.get("mode", 4) != 4:
                continue
            attrs = prim.get("attributes", {})
            if "POSITION" not in attrs or "indices" not in prim:
                continue
            pos = [xform(world, p) for p in read_accessor(gltf, binary, attrs["POSITION"])]
            idx = [v[0] for v in read_accessor(gltf, binary, prim["indices"])]
            for k in range(0, len(idx) - 2, 3):
                tris.append((pos[idx[k]], pos[idx[k + 1]], pos[idx[k + 2]]))
    return tris


def detect_ground(tris):
    """Street level = the height at which most near-vertical surfaces begin.

    Walls stand on the street, so binning the lowest vertex of every wall-like
    triangle and taking the heaviest bin lands on the walkable plane rather than
    on whatever sunken prop happens to be lowest in the model.
    """
    bins = {}
    total = 0.0
    for a, b, c in tris:
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if length < 1e-9:
            continue
        if abs(ny) / length >= 0.3:      # floor-ish, not a wall
            continue
        area = length * 0.5
        key = int(round(min(a[1], b[1], c[1]) / HEIGHT_BIN))
        bins[key] = bins.get(key, 0.0) + area
        total += area
    if not bins or total <= 0.0:
        return min(p[1] for t in tris for p in t)
    return max(bins.items(), key=lambda kv: kv[1])[0] * HEIGHT_BIN


def bounds_of(tris):
    lo = [1e18] * 3
    hi = [-1e18] * 3
    for tri in tris:
        for p in tri:
            for a in range(3):
                if p[a] < lo[a]:
                    lo[a] = p[a]
                if p[a] > hi[a]:
                    hi[a] = p[a]
    return lo, hi


# ---------------------------------------------------------------- voxelising

def _tri_rect_hit(tri, cx, cz, half):
    """2D SAT: axis-aligned square vs the triangle's horizontal projection."""
    axes = [(1.0, 0.0), (0.0, 1.0)]
    for i in range(3):
        p = tri[i]
        q = tri[(i + 1) % 3]
        ex, ez = q[0] - p[0], q[2] - p[2]
        if abs(ex) > 1e-12 or abs(ez) > 1e-12:
            axes.append((-ez, ex))
    for ax, az in axes:
        t0 = t1 = None
        for p in tri:
            v = p[0] * ax + p[2] * az
            if t0 is None or v < t0:
                t0 = v
            if t1 is None or v > t1:
                t1 = v
        rc = cx * ax + cz * az
        rr = half * (abs(ax) + abs(az))
        if t1 < rc - rr or t0 > rc + rr:
            return False
    return True


def tri_normal(a, b, c):
    """Unit normal of a triangle, or None when it is degenerate."""
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    ln = math.sqrt(nx * nx + ny * ny + nz * nz)
    if ln < 1e-9:
        return None
    return (nx / ln, ny / ln, nz / ln)


def height_at(tri, px, pz):
    """Triangle's y at (px, pz), barycentric over its XZ projection."""
    a, b, c = tri
    det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
    if abs(det) < 1e-9:
        return (a[1] + b[1] + c[1]) / 3.0
    w0 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / det
    w1 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / det
    w2 = 1.0 - w0 - w1
    return w0 * a[1] + w1 * b[1] + w2 * c[1]


def voxelize(tris, cell, min_x, min_z):
    """(floors, up surfaces, wall intervals, touched) per cell.

    ``floors`` keeps the lowest up-facing surface a cell offers -- the floor the
    player reaches first -- so a courtyard stays on the street even though the
    building above it has roofs. ``ups`` additionally keeps *every* up-facing
    surface a cell carries (quantised), so a second-storey room or a bridge deck
    sitting over the street gets its own floor slab instead of being swallowed by
    the ground below it.

    ``spans`` keeps, per cell, the vertical intervals its steep faces occupy.
    Recording intervals rather than one min/max column is what keeps a passage
    under a bridge open: the deck's fascia two metres overhead is its own
    interval and cannot drag a column down to the street, while a jamb whose
    face runs to the ground still contributes a full-height interval.
    """
    floors = {}
    ups = {}
    spans = {}
    touched = set()
    half = cell * 0.5
    for tri in tris:
        n = tri_normal(*tri)
        if n is None:
            continue
        ny = n[1]
        if ny <= -FLOOR_NY:          # underside: never stands, never blocks
            continue
        up = ny >= FLOOR_NY
        top = max(p[1] for p in tri)
        bot = min(p[1] for p in tri)
        x0 = min(p[0] for p in tri)
        x1 = max(p[0] for p in tri)
        z0 = min(p[2] for p in tri)
        z1 = max(p[2] for p in tri)
        i0 = int(math.floor((x0 - min_x) / cell))
        i1 = int(math.floor((x1 - min_x) / cell))
        j0 = int(math.floor((z0 - min_z) / cell))
        j1 = int(math.floor((z1 - min_z) / cell))
        for ix in range(i0, i1 + 1):
            cx = min_x + (ix + 0.5) * cell
            for iz in range(j0, j1 + 1):
                cz = min_z + (iz + 0.5) * cell
                if not _tri_rect_hit(tri, cx, cz, half):
                    continue
                key = (ix, iz)
                touched.add(key)
                if up:
                    h = height_at(tri, cx, cz)
                    if key not in floors or h < floors[key]:
                        floors[key] = h
                    ups.setdefault(key, set()).add(
                        round(round(h / HEIGHT_QUANT) * HEIGHT_QUANT, 2))
                else:
                    spans.setdefault(key, []).append((bot, top))
    return floors, ups, spans, touched


def _greedy_rects(grid):
    """Row-then-column greedy rectangle merge; yields (ix, iz, w, d) in cells."""
    remaining = set(grid)
    rects = []
    for key in sorted(grid):
        if key not in remaining:
            continue
        ix, iz = key
        w = 1
        while (ix + w, iz) in remaining:
            w += 1
        d = 1
        while all((ix + k, iz + d) in remaining for k in range(w)):
            d += 1
        for k in range(w):
            for j in range(d):
                remaining.discard((ix + k, iz + j))
        rects.append((ix, iz, w, d))
    return rects


def _rect_box(ix, iz, w, d, cell, min_x, min_z, y_bot, y_top, kind, extra=None):
    box = {
        "x": round(min_x + (ix + w / 2.0) * cell, 2),
        "y": round((y_bot + y_top) / 2.0, 2),
        "z": round(min_z + (iz + d / 2.0) * cell, 2),
        "w": round(w * cell, 2),
        "h": round(y_top - y_bot, 2),
        "d": round(d * cell, 2),
        "t": kind,
    }
    if extra:
        box.update(extra)
    return box


def _merge_spans(spans, tol=0.05):
    """Union of overlapping/touching vertical intervals, sorted low to high.

    A cell whose steep faces are a ground-level jamb *and* a lintel eight metres
    up (a bridge seen from underneath) yields two intervals instead of one
    eight-metre column, which is what used to seal the passage under it.
    """
    if not spans:
        return []
    merged = []
    for lo, hi in sorted(spans):
        if merged and lo <= merged[-1][1] + tol:
            if hi > merged[-1][1]:
                merged[-1][1] = hi
        else:
            merged.append([lo, hi])
    return [(lo, hi) for lo, hi in merged]


def snap_street(floors, ups, tol=STREET_SNAP):
    """Pull every surface within ``tol`` of the street plane exactly onto it.

    A cobbled street's few-centimetre bumps are real triangles, and following
    them cell by cell is what makes the camera chatter as the player runs or
    climbs. Snapping that near-street band onto the one plane removes the
    chatter while leaving a staircase (its treads sit well above the street) and
    every upper storey untouched.
    """
    for key, h in floors.items():
        if abs(h - GROUND_Y) <= tol:
            floors[key] = GROUND_Y
    for key, heights in ups.items():
        ups[key] = {GROUND_Y if abs(h - GROUND_Y) <= tol else h for h in heights}
    return floors, ups


# --------------------------------------------------------------------- ramps

def _components(cells, edges):
    seen = set()
    comps = []
    for start in cells:
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        comp = []
        while stack:
            c = stack.pop()
            comp.append(c)
            for n in edges.get(c, ()):
                if n not in seen:
                    seen.add(n)
                    stack.append(n)
        comps.append(comp)
    return comps


def _ramp_fit(comp, floors, cell):
    """Best (axis, low/high surface, footprint) for one flight, or None.

    A flight is narrow across and long along its ascent, and its mean tread
    height must climb (or fall) steadily along that axis. Anything wider than a
    few cells is a terrace, not a staircase, and is left as floors.
    """
    xs = [c[0] for c in comp]
    zs = [c[1] for c in comp]
    x0, x1 = min(xs), max(xs)
    z0, z1 = min(zs), max(zs)
    nx, nz = x1 - x0 + 1, z1 - z0 + 1
    for axis in ("x", "z"):
        along, across = (nx, nz) if axis == "x" else (nz, nx)
        if along < 2 or across > 3:
            continue
        acc = {}
        for (ix, iz) in comp:
            p = ix if axis == "x" else iz
            acc.setdefault(p, []).append(floors[(ix, iz)])
        seq = [(p, sum(v) / len(v)) for p, v in sorted(acc.items())]
        if len(seq) < 2:
            continue
        rise = seq[-1][1] - seq[0][1]
        if abs(rise) < RAMP_RISE:
            continue
        ok = True
        for k in range(1, len(seq)):
            step = seq[k][1] - seq[k - 1][1]
            if step * rise < -1e-6 or abs(step) > STEP_UP_MAX * 1.5:
                ok = False
                break
        if not ok:
            continue
        return {
            "ax": axis,
            "ix": x0, "iz": z0, "w": nx, "d": nz,
            "y0": seq[0][1], "y1": seq[-1][1],
        }
    return None


def build_ramps(floors, cell, min_x, min_z):
    """One sloped surface per staircase, replacing its discrete treads.

    Returns (boxes, covered): ``covered`` maps each cell a ramp owns to that
    ramp's highest surface, so a tread slab that merely repeats the slope is not
    emitted underneath it while a genuinely separate upper floor in the same
    column still is. The body then rides a smooth gradient up the flight instead
    of hopping a tread at a time, which is what used to shake the camera.
    """
    edges = {}
    for (ix, iz), h in floors.items():
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (ix + dx, iz + dz)
            hn = floors.get(n)
            if hn is None:
                continue
            dh = hn - h
            if 0.05 < abs(dh) <= STEP_UP_MAX:
                edges.setdefault((ix, iz), set()).add(n)
                edges.setdefault(n, set()).add((ix, iz))
    cells = set(edges)
    fits = []
    for comp in _components(cells, edges):
        fit = _ramp_fit(comp, floors, cell)
        if fit is not None:
            fits.append(fit)

    # A wide staircase is a bundle of equal-height columns running side by side.
    # Equal neighbours never link (their height delta is zero), so each column
    # fits as its own one-cell ramp; left alone they read as a fan of narrow
    # chutes rather than one surface. Group the strips sharing an ascent and
    # weld contiguous ones into a single full-width ramp.
    groups = {}
    for f in fits:
        if f["ax"] == "x":
            along = (f["ix"], f["ix"] + f["w"])
            across = (f["iz"], f["iz"] + f["d"])
        else:
            along = (f["iz"], f["iz"] + f["d"])
            across = (f["ix"], f["ix"] + f["w"])
        groups.setdefault((f["ax"], round(f["y0"], 2), round(f["y1"], 2), along),
                          []).append(across)

    boxes = []
    covered = {}
    for (ax, y0, y1, along), spans in groups.items():
        spans.sort()
        clusters = [[spans[0][0], spans[0][1]]]
        for a0, a1 in spans[1:]:
            if a0 <= clusters[-1][1] + 1:      # touching or overlapping strip
                clusters[-1][1] = max(clusters[-1][1], a1)
            else:
                clusters.append([a0, a1])
        for a0, a1 in clusters:
            if ax == "x":
                ix, iz, w, d = along[0], a0, along[1] - along[0], a1 - a0
            else:
                iz, ix, d, w = along[0], a0, along[1] - along[0], a1 - a0
            lo, hi = min(y0, y1), max(y0, y1)
            footprint = [(ix + k, iz + j) for k in range(w) for j in range(d)]
            # Two flights that share a cell would fight in floor_at() and the
            # body would jitter between them; first fit wins, no overlaps.
            if any(c in covered for c in footprint):
                continue
            for c in footprint:
                covered[c] = max(covered.get(c, -1e18), hi)
            boxes.append(_rect_box(ix, iz, w, d, cell, min_x, min_z,
                                   lo - FLOOR_THICK, hi, "ramp",
                                   {"ax": ax, "y0": round(y0, 2), "y1": round(y1, 2)}))
    return boxes, covered


def build_collision(floors, ups, spans, cell, min_x, min_z):
    """Turn the voxel layers into ramps, thin floor slabs and wall columns.

    Each cell may carry several up-facing surfaces -- the street under a bridge,
    the bridge deck above it, the floor of a second-storey room -- and each gets
    its own thin slab, so an upper storey is solid instead of being swallowed by
    the ground below it. Walls are emitted per solid interval, so a deck fascia
    overhead cannot drag a column down to the street and seal the passage under
    it. An interval that is merely a riser above its own tread is dropped,
    because that tread's slab already carries the body over it.

    Returns (boxes, wall cells) so spawn_points can reject non-open street.
    """
    ramps, covered = build_ramps(floors, cell, min_x, min_z)
    boxes = list(ramps)

    # ---- floor slabs: one per up-facing surface ---------------------------
    fbuckets = {}
    for key, heights in ups.items():
        ramp_hi = covered.get(key)
        for h in heights:
            if ramp_hi is not None and h <= ramp_hi + 1e-6:
                continue            # a stair tread: the ramp replaces it
            fbuckets.setdefault(h, set()).add(key)
    for h in sorted(fbuckets):
        for ix, iz, w, d in _greedy_rects(fbuckets[h]):
            boxes.append(_rect_box(ix, iz, w, d, cell, min_x, min_z,
                                   h - FLOOR_THICK, h, "floor"))

    # ---- wall columns: only the intervals steep geometry really fills ------
    wall_cells = {}
    for key, raw in spans.items():
        if key in covered:
            continue
        f = floors.get(key)
        base = f if f is not None else GROUND_Y
        kept = []
        for lo, hi in _merge_spans(raw):
            if hi - base <= STEP_UP_MAX:
                continue                                  # a riser, not a wall
            top = min(hi, lo + WALL_MAX_H)
            if top - lo >= 0.1:
                kept.append((lo, top))
        if kept:
            wall_cells[key] = kept

    wbuckets = {}
    for key, intervals in wall_cells.items():
        for lo, hi in intervals:
            bq = round(round(lo / HEIGHT_QUANT) * HEIGHT_QUANT, 2)
            tq = round(round(hi / HEIGHT_QUANT) * HEIGHT_QUANT, 2)
            if tq - bq < 0.1:
                continue
            wbuckets.setdefault((bq, tq), set()).add(key)
    for (bq, tq) in sorted(wbuckets):
        for ix, iz, w, d in _greedy_rects(wbuckets[(bq, tq)]):
            boxes.append(_rect_box(ix, iz, w, d, cell, min_x, min_z, bq, tq, "wall"))

    return boxes, set(wall_cells)


# -------------------------------------------------------------------- spawns

def _strip_points(walkable, cell, min_x, min_z, along_z, lo, hi):
    pts = []
    for (ix, iz) in walkable:
        main = (min_z + (iz + 0.5) * cell) if along_z else (min_x + (ix + 0.5) * cell)
        if lo <= main <= hi:
            side = (min_x + (ix + 0.5) * cell) if along_z else (min_z + (iz + 0.5) * cell)
            pts.append((side, min_x + (ix + 0.5) * cell, min_z + (iz + 0.5) * cell))
    pts.sort()
    return pts


def make_spawns(walkable, cell, min_x, min_z, lo, hi, along_z):
    """Three points spread along the perpendicular axis of one team's strip."""
    pts = _strip_points(walkable, cell, min_x, min_z, along_z, lo, hi)
    if not pts:
        return []
    out = []
    for frac in (0.2, 0.5, 0.8):
        pick = pts[min(len(pts) - 1, int(len(pts) * frac))]
        out.append(pick)
    return out


def spawn_points(floors, walls, touched, cell, min_x, min_z, max_x, max_z):
    # A spawn may only sit on ground genuinely at the street plane: no wall
    # column, and the walkable surface within a hand's width of GROUND_Y. The
    # abs() matters -- a cell whose only floor is a sunken terrace sits *below*
    # the street, and dropping a player there leaves them hovering on the map's
    # base slab with the visible ground far underneath.
    walkable = [k for k in touched
                if k not in walls
                and floors.get(k) is not None
                and abs(floors[k] - GROUND_Y) <= SPAWN_FLAT]
    width = max_x - min_x
    depth = max_z - min_z
    along_z = depth >= width          # the longer axis separates the teams
    span = depth if along_z else width

    yaw0, yaw1 = (90, 270) if along_z else (0, 180)
    spawns = {"0": [], "1": []}
    for team in (0, 1):
        yaw = yaw0 if team == 0 else yaw1
        picks = []
        # Widen the window until the team's strip yields three points. A narrow
        # strip can land entirely on terraces that fail the flatness test, and a
        # fixed edge strip would then leave the team without a safe spawn.
        for strip in (12.0, 20.0, 32.0, span):
            start = min_x if not along_z else min_z
            lo = start if team == 0 else start + span - strip
            picks = make_spawns(walkable, cell, min_x, min_z, lo, lo + strip, along_z)
            if len(picks) >= 3:
                break
        for _side, px, pz in picks:
            key = (int(math.floor((px - min_x) / cell)), int(math.floor((pz - min_z) / cell)))
            spawns[str(team)].append({
                "x": round(px, 2),
                "y": round(floors.get(key, GROUND_Y), 2),
                "z": round(pz, 2),
                "yaw": yaw,
            })
    return spawns


# ---------------------------------------------------------------------- main

STYLE = {
    "skyTop": "#8ec5f0",
    "skyBottom": "#dbe7ef",
    "fog": "#cfd9de",
    "fogNear": 70,
    "fogFar": 300,
    "sunColor": "#fff4dd",
    "ambientColor": "#c9d4de",
    "mud": "#8a7b63",
}


def build(in_path, out_path):
    gltf, binary = read_glb(in_path)
    tris = gather_triangles(gltf, binary)
    if not tris:
        raise SystemExit("no triangles found in %s" % in_path)

    street = detect_ground(tris)
    lo, hi = bounds_of(tris)
    cx = (lo[0] + hi[0]) * 0.5
    cz = (lo[2] + hi[2]) * 0.5
    offset = (-cx, -street, -cz)
    tris = [tuple((p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]) for p in t)
            for t in tris]
    lo, hi = bounds_of(tris)

    min_x, max_x = lo[0], hi[0]
    min_z, max_z = lo[2], hi[2]
    width = max_x - min_x
    depth = max_z - min_z

    cell = CELL_CANDIDATES[0]
    floors, ups, spans, touched = voxelize(tris, cell, min_x, min_z)
    snap_street(floors, ups)
    boxes, walls = build_collision(floors, ups, spans, cell, min_x, min_z)
    for candidate in CELL_CANDIDATES[1:]:
        if len(boxes) <= MAX_BOXES:
            break
        cell = candidate
        floors, ups, spans, touched = voxelize(tris, cell, min_x, min_z)
        snap_street(floors, ups)
        boxes, walls = build_collision(floors, ups, spans, cell, min_x, min_z)

    spawns = spawn_points(floors, walls, touched, cell, min_x, min_z, max_x, max_z)

    # A backstop slab under everything: a shot that misses still stops, and a
    # body that leaves the playable area lands somewhere instead of falling
    # forever. Placed below the lowest walkable surface so it never becomes the
    # floor of a sunken piazza that has a floor slab of its own.
    floor_lo = min(floors.values()) if floors else GROUND_Y
    ground_top = floor_lo - 0.5
    ground = {
        "x": round((min_x + max_x) * 0.5, 2), "y": round(ground_top - 1, 2),
        "z": round((min_z + max_z) * 0.5, 2),
        "w": round(width + 4, 2), "h": 2, "d": round(depth + 4, 2), "t": "ground",
    }

    data = {
        "name": "意大利小镇",
        "nameEn": "Italy Town",
        "note": ("碰撞与出生点由 tools/build_map.py 从 cs_italy_with_real_light.glb 自动生成；"
                 "floor 为贴合视觉地面的薄地板（含下沉区），wall 严格按可见立面生成的柱体"
                 "（拱门上方过梁为悬空盒，下方保持通透），ramp 为楼梯合成的斜面碰撞体。"),
        "bounds": {
            "minX": round(min_x - 1, 2), "maxX": round(max_x + 1, 2),
            "minZ": round(min_z - 1, 2), "maxZ": round(max_z + 1, 2),
        },
        "groundY": GROUND_Y,
        "style": STYLE,
        "spawns": spawns,
        "boxes": [ground] + boxes,
        "decor": [],
        "navPoints": [],
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")

    size_x = round(max_x - min_x, 1)
    size_z = round(max_z - min_z, 1)
    print("triangles : %d" % len(tris))
    print("cell      : %.2f m" % cell)
    print("size      : %.1f x %.1f m" % (size_x, size_z))
    print("street    : y=%.2f (pre-shift) -> scene.offset=%s"
          % (street, [round(v, 3) for v in offset]))
    kinds = {}
    for b in boxes:
        kinds[b["t"]] = kinds.get(b["t"], 0) + 1
    print("solid     : %d cells -> %d boxes %s" % (len(touched), len(boxes), kinds))
    print("floors    : rel-y %.2f .. %.2f (ground slab top %.2f)"
          % (floor_lo, max(floors.values()), ground_top))
    print("bounds    : %s" % data["bounds"])
    for team in ("0", "1"):
        print("spawns t%s : %s" % (team, [(s["x"], s["z"], s["yaw"]) for s in spawns[team]]))
    print("written   : %s" % out_path)


if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    build(src, dst)
