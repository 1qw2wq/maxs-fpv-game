"""Minimal bot brains.

Purpose is narrow: when only one human is connected the match should still look
and feel like a team deathmatch instead of an empty trench. Bots use exactly the
same authoritative fire path as humans (`Match._on_fire`), so they cannot cheat
by construction.

Two deliberate simplifications, both learned the hard way:
  * movement is steering, not pathfinding -- sample headings around the desired
    direction and take the first that is not blocked. Nav-point pathing kept
    wedging bots against trench walls and stalling them in map corners.
  * convergence uses the nearest enemy regardless of line of sight; line of
    sight only ever gates *shooting*. Gating movement on it made bots wander.
"""

import math
import random
import time

from combat import (
    CLASSES, COMBAT, WEAPONS, blocked, clamp, dir_from_angles, dist3,
    has_line_of_sight,
)
import combat

_RNG = random.Random(20240)

TURN_DEG_PER_SEC = 320.0
PITCH_DEG_PER_SEC = 240.0
# Firing while merely "roughly" on target missed badly: 4.5 deg at 13 m is a ~1 m
# error against a 0.32 m capsule. Bots aim tightly and miss only by design wobble.
AIM_TOLERANCE_DEG = 0.8
REACTION_MS = (110.0, 380.0)
STEER_OFFSETS = (0.0, 22.0, -22.0, 45.0, -45.0, 68.0, -68.0, 95.0, -95.0, 125.0, -125.0)


def now_ms():
    return time.monotonic() * 1000.0


def new_state(team):
    now = now_ms()
    return {
        "strafe": 1 if _RNG.random() < 0.5 else -1,
        "strafe_until": now + _RNG.uniform(2500.0, 6000.0),
        # a persistent flank lane keeps the group from stacking into one firing
        # line against the first piece of cover they meet
        "lane": _RNG.uniform(-16.0, 16.0),
        "foe_id": None,
        # heading offset of the detour currently being walked, or None
        "detour": None,
        "react_until": 0.0,
        "ability_at": now + _RNG.uniform(4000.0, 12000.0),
        "jitter": 0.0,
        "jitter_at": 0.0,
    }


def _angdiff(a, b):
    return (b - a + 180.0) % 360.0 - 180.0


def _approach(cur, target, step):
    if abs(target - cur) <= step:
        return target
    return cur + math.copysign(step, target - cur)


def _turn_yaw(cur, target, step):
    return (cur + clamp(_angdiff(cur, target), -step, step)) % 360.0


def _steer(p, dx, dz, step, hold=None):
    """Nearest unblocked heading, committing to a detour so pockets are escapable.

    Returns ``(offset, (x, z))`` or ``(None, None)``. Taking the first free
    heading *every* tick made a bot pinned behind a wall flip between a left and
    a right detour and pace on the spot -- it stepped the full distance each
    tick but went nowhere (cs_italy's spawn courtyard). So the detour already in
    progress is kept while it stays walkable, only the direct heading clears it,
    and a fresh detour is picked on the same side as the last one.
    """
    base = math.atan2(dz, dx)
    x, y, z = p["pos"]          # pos is [x, y, z]

    def probe(off):
        a = base + math.radians(off)
        tx = clamp(x + math.cos(a) * step, combat.BOUNDS["minX"] + 1.5, combat.BOUNDS["maxX"] - 1.5)
        tz = clamp(z + math.sin(a) * step, combat.BOUNDS["minZ"] + 1.5, combat.BOUNDS["maxZ"] - 1.5)
        return None if blocked(tx, tz, y) else (tx, tz)

    nxt = probe(0.0)
    if nxt is not None:
        return 0.0, nxt
    if hold:
        nxt = probe(hold)
        if nxt is not None:
            return hold, nxt

    order = STEER_OFFSETS
    if hold:
        same = [o for o in STEER_OFFSETS if o != 0.0 and (o > 0.0) == (hold > 0.0)]
        opp = [o for o in STEER_OFFSETS if o != 0.0 and (o > 0.0) != (hold > 0.0)]
        order = same + opp
    for off in order:
        nxt = probe(off)
        if nxt is not None:
            return off, nxt
    return None, None


def _nearest_enemy(match, p):
    best = None
    best_d = 1e9
    for q in match.players.values():
        if not q["alive"] or q["team"] == p["team"]:
            continue
        d = dist3(p["pos"], q["pos"])
        if d < best_d:
            best_d = d
            best = q
    return best, best_d


def _visible_foe(match, p, eye, max_d=85.0):
    best = None
    best_d = 1e9
    for q in match.players.values():
        if not q["alive"] or q["team"] == p["team"]:
            continue
        d = dist3(p["pos"], q["pos"])
        if d >= best_d or d > max_d:
            continue
        qe = (q["pos"][0], q["pos"][1] + 1.15, q["pos"][2])
        if not has_line_of_sight(eye, qe):
            continue
        best = q
        best_d = d
    return best, best_d


def think(match, p, dt_ms):
    events = []
    now = now_ms()
    dt = dt_ms / 1000.0
    st = p["bot_state"]
    if st is None:
        st = p["bot_state"] = new_state(p["team"])

    if not p["alive"]:
        if match.phase == "live" and now >= p["respawn_at"]:
            events.extend(match._spawn(p))
        return events
    if match.phase != "live":
        p["flags"] = {"move": False, "sprint": False, "crouch": False, "ground": True}
        return events

    bias = 1.0 if (1 - p["team"]) == 1 else -1.0
    eye = (p["pos"][0], p["pos"][1] + COMBAT["standEyeHeight"], p["pos"][2])
    w = WEAPONS[p["weapon"]]
    # Preferred engagement band, scaled off where the damage bottoms out, so SMGs
    # hug the fight while rifles and bolt-actions hold their distance.
    weapon_range = float(w.get("falloffMaxM") or float(w["rangeM"]) * 2.5) * 0.6

    visible, vis_d = _visible_foe(match, p, eye)
    nearest, near_d = _nearest_enemy(match, p)

    # ------------------------------------------------------------- shooting
    if visible is None:
        st["foe_id"] = None
        st["react_until"] = 0.0
    else:
        if st["foe_id"] != visible["id"]:
            st["foe_id"] = visible["id"]
            st["react_until"] = now + _RNG.uniform(*REACTION_MS)

        tx, ty, tz = visible["pos"][0], visible["pos"][1] + 1.15, visible["pos"][2]
        aim_yaw = math.degrees(math.atan2(tz - eye[2], tx - eye[0]))
        horiz = math.hypot(tx - eye[0], tz - eye[2])
        aim_pitch = math.degrees(math.atan2(ty - eye[1], max(0.001, horiz)))

        if now >= st["jitter_at"]:
            st["jitter"] = _RNG.uniform(-1.0, 1.0)
            st["jitter_at"] = now + _RNG.uniform(0.15, 0.45)
        wobble = st["jitter"] * min(0.9, 14.0 / max(8.0, vis_d))

        wanted_yaw = aim_yaw + wobble
        p["yaw"] = _turn_yaw(p["yaw"], wanted_yaw, TURN_DEG_PER_SEC * dt)
        p["pitch"] = clamp(_approach(p["pitch"], aim_pitch, PITCH_DEG_PER_SEC * dt), -89.0, 89.0)

        aligned = (abs(_angdiff(p["yaw"], wanted_yaw)) < AIM_TOLERANCE_DEG
                   and abs(p["pitch"] - aim_pitch) < AIM_TOLERANCE_DEG)
        if aligned and now >= st["react_until"] and vis_d <= weapon_range * 1.4:
            events.extend(match._on_fire(p, {
                "t": "fire", "o": list(eye),
                "d": list(dir_from_angles(p["yaw"], p["pitch"])),
            }))

        if now >= st["ability_at"] and vis_d < 30.0:
            # Throw at the enemy's feet -- the same landing the players' aim
            # preview would produce, so the server just range-checks it.
            events.extend(match._on_ability(p, {
                "t": "ability", "d": list(dir_from_angles(p["yaw"], p["pitch"] + 6.0)),
                "p": list(visible["pos"]),
            }))
            st["ability_at"] = now + _RNG.uniform(11000.0, 20000.0)
    if nearest is not None and visible is None:
        # look purposeful while closing: face the nearest known enemy
        ty = nearest["pos"][1] + 1.15
        hy = math.hypot(nearest["pos"][0] - eye[0], nearest["pos"][2] - eye[2])
        p["yaw"] = _turn_yaw(p["yaw"], math.degrees(
            math.atan2(nearest["pos"][2] - eye[2], nearest["pos"][0] - eye[0])),
            TURN_DEG_PER_SEC * 0.6 * dt)
        p["pitch"] = clamp(_approach(p["pitch"], math.degrees(
            math.atan2(ty - eye[1], max(0.001, hy))), PITCH_DEG_PER_SEC * 0.6 * dt), -89.0, 89.0)

    # ------------------------------------------------------------- movement
    if now >= st["strafe_until"]:
        st["strafe"] = -st["strafe"]
        st["strafe_until"] = now + _RNG.uniform(2500.0, 6000.0)

    lane = st["lane"]
    if visible is not None:
        ideal = weapon_range * 0.55
        if vis_d > ideal * 1.15:
            dx, dz = visible["pos"][0] - p["pos"][0], visible["pos"][2] - p["pos"][2]
        elif vis_d < ideal * 0.5:
            dx, dz = p["pos"][0] - visible["pos"][0], p["pos"][2] - visible["pos"][2]
        else:
            px, pz = -(visible["pos"][2] - p["pos"][2]), (visible["pos"][0] - p["pos"][0])
            length = math.hypot(px, pz) or 1.0
            dx, dz = (px / length) * st["strafe"], (pz / length) * st["strafe"]
        speed_mult = 0.6
    elif nearest is not None:
        # Walk the map's flow field: it threads the doorways and courtyards that
        # separate the two spawn areas, which a straight heading at the enemy
        # cannot (it just grinds into the first wall -- the spawn-courtyard trap).
        # A personal lateral lane keeps the squad spread out instead of single-file.
        nd = combat.nav_dir(p["pos"][0], p["pos"][2], p["team"])
        if nd is not None:
            dx, dz = nd
            px, pz = -dz, dx
            dx += px * lane * 0.04
            dz += pz * lane * 0.04
        else:
            dx = nearest["pos"][0] - p["pos"][0]
            dz = nearest["pos"][2] + lane * 0.5 - p["pos"][2]
        speed_mult = 0.95
    else:
        nd = combat.nav_dir(p["pos"][0], p["pos"][2], p["team"])
        if nd is not None:
            dx, dz = nd
        else:
            dx, dz = bias, 0.0
        speed_mult = 0.9

    # keep squadmates from occupying the same square metre
    for q in match.players.values():
        if q is p or not q["alive"]:
            continue
        rx = p["pos"][0] - q["pos"][0]
        rz = p["pos"][2] - q["pos"][2]
        r = math.hypot(rx, rz)
        if 0.01 < r < 2.6:
            push = (2.6 - r) * 2.2
            dx += rx / r * push
            dz += rz / r * push

    speed = COMBAT["maxMoveSpeed"] * CLASSES[p["cls"]]["speedMult"] * speed_mult
    step = min(2.0, speed * dt)
    off, nxt = _steer(p, dx, dz, step, st.get("detour"))
    if nxt is None:
        st["detour"] = None
        p["flags"] = {"move": False, "sprint": False, "crouch": False, "ground": True}
    else:
        # Walking straight clears the detour; otherwise stay committed to it so
        # the next tick cannot pick the mirrored heading and pace on the spot.
        st["detour"] = None if off == 0.0 else off
        # Read the feet height *before* overwriting the horizontal position: the
        # surface query needs it to know which step the bot may climb onto.
        oy = p["pos"][1]
        p["pos"][0], p["pos"][2] = nxt
        # Rely on the same surface query the humans use, so a bot walking a
        # staircase rides the treads instead of clipping through them.
        p["pos"][1] = combat.floor_at(nxt[0], nxt[1], oy)
        p["flags"] = {"move": True, "sprint": False, "crouch": False, "ground": True}

    return events