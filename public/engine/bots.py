"""Perception-driven bot tactics, using the same collision, ammo and fire rules
as humans. No hidden-player tracking: investigate a last-seen position briefly,
then resume the map flow field. Bounded/cached pathfinding keeps Pyodide cheap.
"""

import heapq
import math
import random
import time

from combat import (
    CLASSES, COMBAT, WEAPONS, blocked, clamp, dir_from_angles, dist3,
    has_line_of_sight, weapon_reserve, ray_capsule,
)
import combat

_RNG = random.Random(20240)

TURN_DEG_PER_SEC = 320.0
PITCH_DEG_PER_SEC = 240.0
# Firing while merely "roughly" on target missed badly: 4.5 deg at 13 m is a ~1 m
# error against a 0.32 m capsule. Bots aim tightly and miss only by design wobble.
AIM_TOLERANCE_DEG = 0.8
REACTION_MS = (110.0, 380.0)
STEER_OFFSETS = (0.0, 22.0, -22.0, 45.0, -45.0, 68.0, -68.0, 95.0, -95.0, 125.0, -125.0, 160.0, -160.0, 180.0)


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
        "last_seen": None, "seen_until": 0.0,
        "sense_at": 0.0, "visible_id": None,
        "burst_end": 0.0, "burst_ready": 0.0,
        "cover": None, "cover_at": 0.0,
        "route": [], "route_goal": None, "route_at": 0.0,
        "progress_at": now + 900.0, "progress_pos": None,
        "escape_until": 0.0,
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
    if math.hypot(dx, dz) < 1e-6:
        return 0.0, (p["pos"][0], p["pos"][2])
    base = math.atan2(dz, dx)
    x, y, z = p["pos"]          # pos is [x, y, z]

    def probe(off):
        a = base + math.radians(off)
        tx = clamp(x + math.cos(a) * step, combat.BOUNDS["minX"] + 1.5, combat.BOUNDS["maxX"] - 1.5)
        tz = clamp(z + math.sin(a) * step, combat.BOUNDS["minZ"] + 1.5, combat.BOUNDS["maxZ"] - 1.5)
        # Sweep, rather than only testing the endpoint: long/slow ticks must
        # not teleport bots through a thin wall or off a balcony.
        n = max(1, math.ceil(step / 0.16))
        feet = y
        for i in range(1, n + 1):
            px, pz = x + (tx - x) * i / n, z + (tz - z) * i / n
            if blocked(px, pz, feet):
                return None
            floor = combat.floor_at(px, pz, feet)
            if feet - floor > 1.2:
                return None
            feet = floor
        return tx, tz

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


def _target_point(q):
    height = COMBAT["crouchHeight"] if q["flags"].get("crouch") else COMBAT["playerHeight"]
    return (q["pos"][0], q["pos"][1] + height * 0.68, q["pos"][2])


def _can_see(match, p, q, eye):
    if now_ms() < p.get("flash_until", 0):
        return False
    if not q or not q["alive"] or q["team"] == p["team"]:
        return False
    d = dist3(p["pos"], q["pos"])
    if d > 95.0:
        return False
    bearing = math.degrees(math.atan2(q["pos"][2] - eye[2], q["pos"][0] - eye[0]))
    # Close footsteps and recent damage allow a quick turn; otherwise no eyes
    # in the back of the head. A remembered target still needs fresh LOS.
    if d > 7 and now_ms() - p["last_hit_ms"] > 900 and abs(_angdiff(p["yaw"], bearing)) > 105:
        return False
    point = _target_point(q)
    return has_line_of_sight(eye, point) and (d <= 5 or not match._path_in_smoke(eye, point))


def _visible_foe(match, p, eye, max_d=95.0):
    best, score = None, float("inf")
    for q in match.players.values():
        if not _can_see(match, p, q, eye):
            continue
        d = dist3(p["pos"], q["pos"])
        if d > max_d:
            continue
        # Hysteresis keeps a duel stable rather than resetting reaction time
        # every time two opponents swap which one is a centimetre closer.
        value = d * (0.72 if q["id"] == p["bot_state"]["foe_id"] else 1.0)
        if value < score:
            best, score = q, value
    return best, dist3(p["pos"], best["pos"]) if best else float("inf")


def _friendly_lane(match, p, eye, direction, distance):
    for q in match.players.values():
        if q is p or not q["alive"] or q["team"] != p["team"]:
            continue
        height = COMBAT["crouchHeight"] if q["flags"].get("crouch") else COMBAT["playerHeight"]
        if ray_capsule(eye, direction, q["pos"], height, COMBAT["hitRadius"] + 0.1, distance) is not None:
            return True
    return False


def _route_direction(p, goal, now):
    """Bounded A* to a remembered/cover goal, never a hidden player's live pos."""
    st = p["bot_state"]
    c = combat.NAV_CELL
    field = combat.NAV_FLOW.get(p["team"], {})
    start = (math.floor(p["pos"][0] / c), math.floor(p["pos"][2] / c))
    end = (math.floor(goal[0] / c), math.floor(goal[2] / c))
    if now >= st["route_at"] or end != st["route_goal"]:
        st["route_at"], st["route_goal"] = now + 1200.0, end
        st["route"] = []
        if start in field and end in field:
            queue, cost, parent = [(0, start)], {start: 0}, {}
            for _ in range(700):
                if not queue:
                    break
                _, cur = heapq.heappop(queue)
                if cur == end:
                    path = []
                    while cur != start:
                        path.append(((cur[0] + 0.5) * c, (cur[1] + 0.5) * c))
                        cur = parent[cur]
                    st["route"] = path[::-1]
                    break
                for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nxt = cur[0] + dx, cur[1] + dz
                    nc = cost[cur] + 1
                    if nxt in field and nc < cost.get(nxt, float("inf")):
                        cost[nxt], parent[nxt] = nc, cur
                        heapq.heappush(queue, (nc + abs(nxt[0] - end[0]) + abs(nxt[1] - end[1]), nxt))
    while st["route"] and math.hypot(st["route"][0][0] - p["pos"][0], st["route"][0][1] - p["pos"][2]) < 0.55:
        st["route"].pop(0)
    target = st["route"][0] if st["route"] else (goal[0], goal[2])
    return target[0] - p["pos"][0], target[1] - p["pos"][2]


def _find_cover(p, threat):
    best, score = None, float("inf")
    for radius in (3.0, 6.0):
        for i in range(12):
            angle = i * math.tau / 12
            x, z = p["pos"][0] + math.cos(angle) * radius, p["pos"][2] + math.sin(angle) * radius
            if not (combat.BOUNDS["minX"] + 1.5 < x < combat.BOUNDS["maxX"] - 1.5 and combat.BOUNDS["minZ"] + 1.5 < z < combat.BOUNDS["maxZ"] - 1.5):
                continue
            y = combat.floor_at(x, z, p["pos"][1])
            if blocked(x, z, y) or abs(y - p["pos"][1]) > 1.2:
                continue
            if has_line_of_sight(threat, (x, y + COMBAT["crouchEyeHeight"], z)):
                continue
            value = radius - min(4.0, dist3((x, y, z), threat)) * 0.15
            if value < score:
                best, score = [x, y, z], value
    return best


def _ability(match, p, visible, reloading, now):
    st = p["bot_state"]
    if now < st["ability_at"]:
        return []
    st["ability_at"] = now + 1500.0
    kind = CLASSES[p["cls"]]["ability"]
    nearby = [q for q in match.players.values() if q["alive"] and q["team"] == p["team"] and dist3(q["pos"], p["pos"]) < 5.5]
    need = (kind == "heal" and any(q["hp"] < CLASSES[q["cls"]]["maxHp"] * 0.75 for q in nearby)
            or kind == "ammo" and any(q["reserve"] < weapon_reserve(q["weapon"]) * 0.35 for q in nearby)
            or kind == "smoke" and visible is not None and (reloading or p["hp"] < CLASSES[p["cls"]]["maxHp"] * 0.5)
            or kind == "flare" and visible is not None and dist3(p["pos"], visible["pos"]) < 70)
    if kind in ("heal", "ammo") and any(e["k"] == kind and e["team"] == p["team"] and dist3(e["p"], p["pos"]) < e["r"] and e.get("until", 0) > now for e in match.effects):
        need = False
    if not need:
        return []
    target = visible["pos"] if visible else p["pos"]
    if kind == "smoke":
        target = [(p["pos"][i] + target[i]) * 0.5 for i in range(3)]
    events = match._on_ability(p, {"t": "ability", "d": list(dir_from_angles(p["yaw"], p["pitch"] + 6)), "p": list(target)})
    if events:
        st["ability_at"] = now + _RNG.uniform(9000, 14000)
    return events


def think(match, p, dt_ms):
    events = []
    now, dt = now_ms(), min(0.2, max(0, dt_ms / 1000.0))
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

    crouch = p["flags"].get("crouch", False)
    eye = (p["pos"][0], p["pos"][1] + COMBAT["crouchEyeHeight" if crouch else "standEyeHeight"], p["pos"][2])
    w = WEAPONS[p["weapon"]]
    # A full scan is staggered, but LOS/smoke of the held target is rechecked on
    # every tick so cached perception can never fire through new cover/smoke.
    if now >= st["sense_at"]:
        visible, _ = _visible_foe(match, p, eye)
        st["visible_id"] = visible["id"] if visible else None
        st["sense_at"] = now + _RNG.uniform(180, 270)
    visible = match.players.get(st["visible_id"])
    if not _can_see(match, p, visible, eye):
        visible = None
    distance = dist3(p["pos"], visible["pos"]) if visible else float("inf")
    if visible:
        if st["foe_id"] != visible["id"]:
            st["react_until"] = now + _RNG.uniform(*REACTION_MS)
        st["foe_id"] = visible["id"]
        st["last_seen"] = list(visible["pos"])
        st["seen_until"] = now + 4500
    else:
        st["foe_id"] = None
    memory = st["last_seen"] if now < st["seen_until"] else None
    ideal = {"smg": 12.0, "rifle": 25.0, "lmg": 30.0, "bolt": 42.0}.get(w["shape"], 22.0)
    hurt = p["hp"] < CLASSES[p["cls"]]["maxHp"] * 0.38
    reloading = now < p["reload_end"]
    if not reloading and p["reserve"] > 0 and (p["mag"] <= 0 or (p["mag"] < int(w["mag"]) * 0.35 and (not visible or distance > ideal * 1.4))):
        match._on_reload(p)
        reloading = now < p["reload_end"]
    events.extend(_ability(match, p, visible, reloading, now))

    if visible:
        tx, ty, tz = _target_point(visible)
        aim_yaw = math.degrees(math.atan2(tz - eye[2], tx - eye[0]))
        aim_pitch = math.degrees(math.atan2(ty - eye[1], max(0.001, math.hypot(tx - eye[0], tz - eye[2]))))
        if now >= st["jitter_at"]:
            st["jitter"], st["jitter_at"] = _RNG.uniform(-1, 1), now + _RNG.uniform(150, 450)
        wanted = aim_yaw + st["jitter"] * min(0.9, 14 / max(8, distance))
        p["yaw"] = _turn_yaw(p["yaw"], wanted, TURN_DEG_PER_SEC * dt)
        p["pitch"] = clamp(_approach(p["pitch"], aim_pitch, PITCH_DEG_PER_SEC * dt), -89, 89)
        aligned = abs(_angdiff(p["yaw"], wanted)) < AIM_TOLERANCE_DEG and abs(p["pitch"] - aim_pitch) < AIM_TOLERANCE_DEG
        if now >= st["burst_ready"] and now >= st["burst_end"]:
            st["burst_end"] = now + _RNG.uniform(300, 650)
            st["burst_ready"] = st["burst_end"] + _RNG.uniform(180, 380)
        direction = dir_from_angles(p["yaw"], p["pitch"])
        if aligned and not reloading and now >= st["react_until"] and now < st["burst_end"] and not _friendly_lane(match, p, eye, direction, distance):
            events.extend(match._on_fire(p, {"t": "fire", "o": list(eye), "d": list(direction)}))
    elif memory:
        bearing = math.degrees(math.atan2(memory[2] - eye[2], memory[0] - eye[0]))
        p["yaw"] = _turn_yaw(p["yaw"], bearing, TURN_DEG_PER_SEC * 0.6 * dt)

    # Low health/reload: seek actual occluding cover, not a random backwards
    # sidestep. Keep a chosen spot for a second instead of oscillating each tick.
    retreat = bool(memory and (hurt or reloading) or st["cover"] and hurt and now - p["last_hit_ms"] < 10500)
    if retreat and memory and now >= st["cover_at"]:
        st["cover"] = _find_cover(p, _target_point(visible) if visible else (memory[0], memory[1] + 1.15, memory[2]))
        st["cover_at"] = now + 1300
    if not retreat:
        st["cover"] = None
    at_cover = bool(st["cover"] and dist3(p["pos"], st["cover"]) < 0.65)
    if at_cover:
        dx, dz, speed_mult = 0.0, 0.0, 0.0
    elif retreat and st["cover"]:
        dx, dz = _route_direction(p, st["cover"], now)
        speed_mult = 0.8
    elif retreat and visible:
        dx, dz = p["pos"][0] - visible["pos"][0], p["pos"][2] - visible["pos"][2]
        speed_mult = 0.7
    elif match.control is not None and match.control.points and (not visible or distance > 10):
        candidates = [point for point in match.control.points if point['owner'] != p['team'] or point['contested'] or point['attacking'] not in (-1,p['team'])]
        if not candidates:
            candidates = match.control.points
        # Small squad bias spreads bots across objectives rather than one blob.
        target = min(candidates,key=lambda point: dist3(p['pos'],point['p'])+(0 if ord(point['id'])%3 == p['id']%3 else 12))
        if math.hypot(p['pos'][0]-target['p'][0],p['pos'][2]-target['p'][2]) < 1.8:
            dx, dz, speed_mult = 0, 0, 0
        else:
            dx, dz = _route_direction(p,target['p'],now)
            speed_mult = .85
        if not visible and abs(dx)+abs(dz) > .01:
            p['yaw'] = _turn_yaw(p['yaw'],math.degrees(math.atan2(dz,dx)),TURN_DEG_PER_SEC*dt)
    elif visible:
        dx, dz = visible["pos"][0] - p["pos"][0], visible["pos"][2] - p["pos"][2]
        if distance < ideal * 0.5:
            dx, dz = -dx, -dz
        elif distance < ideal * 1.2:
            dx, dz = -dz * st["strafe"], dx * st["strafe"]
        speed_mult = 0.55
    elif memory and dist3(p["pos"], memory) > 1.2:
        dx, dz = _route_direction(p, memory, now)
        speed_mult = 0.8
    else:
        nd = combat.nav_dir(p["pos"][0], p["pos"][2], p["team"])
        dx, dz = nd if nd else (math.cos(math.radians(p["yaw"])), math.sin(math.radians(p["yaw"])))
        dx, dz = dx - dz * st["lane"] * 0.015, dz + dx * st["lane"] * 0.015
        speed_mult = 0.9
        p["yaw"] = _turn_yaw(p["yaw"], math.degrees(math.atan2(dz, dx)), TURN_DEG_PER_SEC * dt)
    if now >= st["strafe_until"]:
        st["strafe"] *= -1
        st["strafe_until"] = now + _RNG.uniform(1800, 4000)
    if now >= st["progress_at"]:
        last = st["progress_pos"]
        if last and speed_mult and dist3(last, p["pos"]) < 0.4:
            st["escape_until"] = now + 700
            st["detour"], st["route_at"] = 125 * st["strafe"], 0
            st["strafe"] *= -1
        st["progress_pos"], st["progress_at"] = list(p["pos"]), now + 900
    if now < st["escape_until"]:
        angle = math.radians(p["yaw"] + 125 * st["strafe"])
        dx, dz = math.cos(angle), math.sin(angle)
    length = math.hypot(dx, dz) or 1
    dx, dz = dx / length, dz / length
    if speed_mult:
        for q in match.players.values():
            if q is p or not q["alive"]:
                continue
            rx, rz = p["pos"][0] - q["pos"][0], p["pos"][2] - q["pos"][2]
            r = math.hypot(rx, rz)
            if 0.01 < r < 1.6:
                dx += rx / r * (1.6 - r)
                dz += rz / r * (1.6 - r)
    crouch = at_cover and (hurt or reloading)
    speed = COMBAT["maxMoveSpeed"] * CLASSES[p["cls"]]["speedMult"] * speed_mult * (0.55 if crouch else 1)
    old = list(p["pos"])
    off, nxt = _steer(p, dx, dz, speed * dt, st.get("detour"))
    if nxt:
        st["detour"] = None if off == 0 else off
        p["pos"] = [nxt[0], combat.floor_at(nxt[0], nxt[1], old[1]), nxt[1]]
    p["velocity"] = [(p["pos"][i]-old[i])/max(dt, 0.001) for i in range(3)]
    p["flags"] = {"move": dist3(old, p["pos"]) > 0.005, "sprint": False, "crouch": crouch, "ground": True}
    return events
