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

_RNG = random.Random()  # Runtime variety; regression tests explicitly seed it.

# Same navigation, health, LOS and authoritative weapons for every tier. Skill
# changes human-like reaction/tracking/trigger discipline, never hidden info.
BOT_CONFIG = combat._load("bots.json")
SKILLS = BOT_CONFIG["skills"]
SKILL_ROTATION = tuple(BOT_CONFIG["rotation"])


def normalize_difficulty(value):
    return value if isinstance(value, str) and (value == "mixed" or value in SKILLS) else "mixed"


def difficulty_for_slot(difficulty, slot):
    level = normalize_difficulty(difficulty)
    return skill_for_slot(slot) if level == "mixed" else level


AIM_TOLERANCE_DEG = 0.8


def skill_for_slot(slot):
    return SKILL_ROTATION[slot % len(SKILL_ROTATION)]


STEER_OFFSETS = (0.0, 22.0, -22.0, 45.0, -45.0, 68.0, -68.0, 95.0, -95.0, 125.0, -125.0, 160.0, -160.0, 180.0)


def now_ms():
    return time.monotonic() * 1000.0


def new_state(team, skill="regular"):
    now = now_ms()
    return {
        "skill": skill if skill in SKILLS else "regular",
        "pitch_jitter": 0.0,
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
        "escape_until": 0.0, "escape_heading": 0.0,
        "search_heading": None,
        "steadiness": _RNG.uniform(.85, 1.2),
        "aggression": _RNG.uniform(.75, 1.25),
        "jitter_target": None, "pitch_target": None,
        "aim_sample": None, "sample_id": None, "sample_at": 0.0,
        "observed_velocity": [0.0, 0.0, 0.0],
        "hesitate_until": 0.0,
        "tactic": None, "tactic_until": 0.0, "tactic_foe": None,
        "flank_goal": None,
        "objective_id": None, "objective_until": 0.0,
        "visible_count": 0, "role": "maneuver", "confidence": 0.0, "utilities": {},
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
    contacts = 0
    for q in match.players.values():
        if not _can_see(match, p, q, eye):
            continue
        d = dist3(p["pos"], q["pos"])
        if d > max_d:
            continue
        contacts += 1
        # Hysteresis keeps a duel stable rather than resetting reaction time
        # every time two opponents swap which one is a centimetre closer.
        value = d * (0.72 if q["id"] == p["bot_state"]["foe_id"] else 1.0)
        if value < score:
            best, score = q, value
    p["bot_state"]["visible_count"] = contacts
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
    if combat.MAP_DATA.get('bot_nav'):
        key=tuple(round(v,1) for v in goal)
        path=st.get('city_route',[])
        if st.get('city_goal_key')!=key or not path:
            path=combat.waypoint_route(p['pos'],goal)
            st['city_route'],st['city_goal_key']=path,key
        while path and dist3(p['pos'],path[0])<.45:path.pop(0)
        target=path[0] if path else p['pos']
        return target[0]-p['pos'][0],target[2]-p['pos'][2]
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


def _observe(st, visible, now):
    """Estimate motion from sight samples, not a hidden player's live velocity."""
    point = list(_target_point(visible))
    elapsed = (now-st["sample_at"])/1000.0
    velocity = [0.0, 0.0, 0.0]
    if st["sample_id"] == visible["id"] and st["aim_sample"] and elapsed > .04:
        delta = [point[i]-st["aim_sample"][i] for i in range(3)]
        cap = COMBAT["maxMoveSpeed"]*COMBAT.get("sprintMult", 1.35)
        if math.sqrt(sum(v*v for v in delta)) <= cap*elapsed+1:
            velocity = [clamp(delta[i]/elapsed, -cap, cap)*.65+st["observed_velocity"][i]*.35 for i in range(3)]
    st.update(aim_sample=point, sample_id=visible["id"], sample_at=now,
              observed_velocity=velocity, last_seen=list(visible["pos"]),
              seen_until=now+SKILLS[st["skill"]]["memory"])


def _aim_point(st, skill, now):
    # Modest extrapolation bridges delayed observations. A sudden juke can fool
    # even a veteran; never consult a live position/velocity between samples.
    horizon = min(.18, max(0, (now-st["sample_at"])/1000.0)+skill["lead"])
    return [st["aim_sample"][i]+clamp(st["observed_velocity"][i]*horizon, -1.2, 1.2) for i in range(3)]


def _tactical_scores(match, p, distance, ideal, now):
    """Small utility model: only own state, friendly roles and perceived threats.

    Inspired by utility DSEs / squad confidence, not a planner or machine learning.
    No enemy positions are consulted here, particularly not hidden opponents.
    """
    st = p["bot_state"]
    skill = SKILLS[st["skill"]]
    allies = [] if match is None else [q for q in match.players.values()
        if q is not p and q["alive"] and q["team"] == p["team"]
        and dist3(q["pos"], p["pos"]) < 18]
    engaged = [q for q in allies if (q.get("bot_state") or {}).get("tactic_foe") == st["foe_id"]
               and now < (q.get("bot_state") or {}).get("tactic_until", 0)]
    flankers = sum((q.get("bot_state") or {}).get("tactic") == "flank" for q in engaged)
    threats = max(1, st["visible_count"])
    hp = p["hp"] / CLASSES[p["cls"]]["maxHp"]
    pressure = float(now < p.get("suppress_until", 0))
    close = clamp(1-distance/ideal, 0, 1)
    far = clamp(distance/ideal-1, 0, 2)
    fit = 1-min(1, abs(distance-ideal)/ideal)
    confidence = clamp((len(allies)+1-threats)*.3 + (hp-.65) - pressure*.4, -1, 1)
    st["confidence"] = confidence
    coordination = skill["coordination"]
    # A support gun / existing maneuver element becomes the anchor. Limit the
    # number of committed flankers instead of sending the entire group around.
    anchor = WEAPONS[p["weapon"]]["shape"] == "lmg" or flankers >= max(1, (len(allies)+1)//3)
    st["role"] = "anchor" if anchor else "maneuver"
    return {
        "withdraw": .2+close*3.4+(1-hp)*3.0+pressure*.8-max(0, confidence)*.5,
        "push": .6+far*2.3+confidence*.6-close*.8-pressure*.8,
        "hold": .9+fit*.8-far*.8+coordination*(1.7 if anchor else 0),
        "strafe": 1.1+fit*.9-pressure*.3,
        "flank": 1.0+max(0, confidence)*.6+far*.3-close*.8+coordination*(-2 if anchor else .9),
    }


def _choose_tactic(p, foe, distance, ideal, now, match=None):
    st = p["bot_state"]
    if st["tactic_foe"] == foe["id"] and now < st["tactic_until"]:
        return st["tactic"]
    st["tactic_foe"], st["tactic_until"] = foe["id"], now+_RNG.uniform(1300, 3100)
    # Score competing needs, add bounded personality/mistakes, then commit.
    # Lower difficulty has noisier decisions, not reduced health/damage.
    skill = SKILLS[st["skill"]]
    st["utilities"] = _tactical_scores(match, p, distance, ideal, now)
    scores = {action: value + _RNG.uniform(-skill["decision_noise"], skill["decision_noise"])
              for action, value in st["utilities"].items()}
    tactic = max(scores, key=scores.get)
    st["flank_goal"] = None
    if tactic == "flank":
        dx, dz = foe["pos"][0]-p["pos"][0], foe["pos"][2]-p["pos"][2]
        length = math.hypot(dx, dz) or 1
        side, reach = st["strafe"], _RNG.uniform(4, 8)
        x = p["pos"][0]+(dx*.35-dz*side)/length*reach
        z = p["pos"][2]+(dz*.35+dx*side)/length*reach
        y = combat.floor_at(x, z, p["pos"][1])
        if (combat.BOUNDS["minX"]+1.5 < x < combat.BOUNDS["maxX"]-1.5
                and combat.BOUNDS["minZ"]+1.5 < z < combat.BOUNDS["maxZ"]-1.5
                and abs(y-p["pos"][1]) < .6 and not blocked(x, z, y)):
            st["flank_goal"] = [x, y, z]
        else:
            tactic = "strafe"
    if tactic == "hold":
        st["tactic_until"] = now+_RNG.uniform(350, 850)
    st["tactic"] = tactic
    return tactic


def _objective_goal(match, p, now):
    st = p["bot_state"]
    candidates = [point for point in match.control.points if point['owner'] != p['team'] or point['contested'] or point['attacking'] not in (-1, p['team'])]
    candidates = candidates or match.control.points
    held = next((point for point in candidates if point['id'] == st["objective_id"]), None)
    if held and now < st["objective_until"]:
        return held
    allies = [q for q in match.players.values() if q is not p and q['alive'] and q['team'] == p['team']]
    def score(point):
        assigned = sum(1 for q in allies if (q.get('bot_state') or {}).get('objective_id') == point['id'] or dist3(q['pos'], point['p']) < 5)
        urgency = -5 if point['owner'] == p['team'] and (point['contested'] or point['attacking'] not in (-1, p['team'])) else 0
        return dist3(p['pos'], point['p'])+assigned*7+urgency+_RNG.uniform(0, 5)
    target = min(candidates, key=score)
    st["objective_id"], st["objective_until"] = target['id'], now+_RNG.uniform(1800, 3500)
    return target


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


def _manage_weapon(match, p):
    """Use the same equip delay and independent ammunition as human switching."""
    other = "secondary" if p["slot"] == "primary" else "primary"
    stored = p["inventory"].get(p[other], {})
    available = stored.get("mag", 0)+stored.get("reserve", 0) > 0
    if available and (p["mag"]+p["reserve"] <= 0 or other == "primary"):
        match._on_switch(p, {"slot": other})


def think(match, p, dt_ms):
    events = []
    now, dt = now_ms(), min(0.2, max(0, dt_ms / 1000.0))
    st = p["bot_state"]
    if st is None:
        st = p["bot_state"] = new_state(p["team"], p.get("bot_skill", "regular"))
    skill = SKILLS.get(st.get("skill"), SKILLS["regular"])
    if not p["alive"]:
        if match.phase == "live" and now >= p["respawn_at"]:
            events.extend(match._spawn(p))
        return events
    if match.phase != "live":
        p["flags"] = {"move": False, "sprint": False, "crouch": False, "ground": True}
        return events

    # React to actual inhalation, not hidden/future clouds or the thrower's intent.
    # Same 750 ms seal as humans; lower tiers take longer to notice the hazard.
    if p.get("gas_until", 0) > now:
        st["mask_last_gas"] = now
        if not p.get("mask_on"):
            if not st.get("mask_react_at"):
                st["mask_react_at"] = now + _RNG.uniform(*skill["reaction"])
            elif now >= st["mask_react_at"]:
                match._on_mask(p, {"on": True})
    else:
        st["mask_react_at"] = 0
        if p.get("mask_on") and now-st.setdefault("mask_last_gas", now) > 2000:
            match._on_mask(p, {"on": False})

    crouch = p["flags"].get("crouch", False)
    eye = (p["pos"][0], p["pos"][1] + COMBAT["crouchEyeHeight" if crouch else "standEyeHeight"], p["pos"][2])
    _manage_weapon(match, p)
    w = WEAPONS[p["weapon"]]
    # A full scan is staggered, but LOS/smoke of the held target is rechecked on
    # every tick so cached perception can never fire through new cover/smoke.
    sampled = now >= st["sense_at"]
    if sampled:
        visible, _ = _visible_foe(match, p, eye)
        st["visible_id"] = visible["id"] if visible else None
        st["sense_at"] = now + _RNG.uniform(*skill["sense"])
    visible = match.players.get(st["visible_id"])
    if not _can_see(match, p, visible, eye):
        visible = None
    distance = dist3(p["pos"], visible["pos"]) if visible else float("inf")
    if visible:
        if st["foe_id"] != visible["id"]:
            st["react_until"] = now + _RNG.uniform(*skill["reaction"])
        st["foe_id"] = visible["id"]
        if sampled or st["sample_id"] != visible["id"]:
            _observe(st, visible, now)
    else:
        st["foe_id"] = None
    memory = st["last_seen"] if now < st["seen_until"] else None
    if not visible and memory and dist3(p["pos"], memory) <= 1.2:
        # We investigated this location. Do not keep aiming back through it
        # while resuming patrol (which made the body chase its own position).
        st["seen_until"], memory = 0.0, None
    if visible or memory:
        st["search_heading"] = None
    ideal = {"smg": 12.0, "rifle": 25.0, "lmg": 30.0, "bolt": 42.0, "pistol": 9.0}.get(w["shape"], 22.0)
    hurt = p["hp"] < CLASSES[p["cls"]]["maxHp"] * skill["cover_health"]
    reloading = now < p["reload_end"]
    if not reloading and p["reserve"] > 0 and (p["mag"] <= 0 or (p["mag"] < int(w["mag"]) * 0.35 and (not visible or distance > ideal * 1.4))):
        match._on_reload(p)
        reloading = now < p["reload_end"]
    events.extend(_ability(match, p, visible, reloading, now))

    if visible:
        tx, ty, tz = _aim_point(st, skill, now)
        aim_yaw = math.degrees(math.atan2(tz - eye[2], tx - eye[0]))
        aim_pitch = math.degrees(math.atan2(ty - eye[1], max(0.001, math.hypot(tx - eye[0], tz - eye[2]))))
        if now >= st["jitter_at"]:
            st["jitter_target"], st["jitter_at"] = _RNG.uniform(-1, 1), now + _RNG.uniform(150, 450)
            st["pitch_target"] = _RNG.uniform(-1, 1)
        if st["jitter_target"] is not None:
            ease = 1-math.exp(-7*dt)
            st["jitter"] += (st["jitter_target"]-st["jitter"])*ease
            st["pitch_jitter"] += (st["pitch_target"]-st["pitch_jitter"])*ease
        # Error must not shrink towards laser accuracy at long range. Pressure
        # and moving-target tracking amplify human mistakes, not damage rolls.
        pressure = 1.6 if now < p.get("suppress_until", 0) else 1.0
        error = skill["aim_error"]*st["steadiness"]*(1+clamp((distance-24)/70, 0, .8))*pressure
        wanted = aim_yaw + st["jitter"] * error
        wanted_pitch = clamp(aim_pitch + st["pitch_jitter"] * error * 0.6, -89, 89)
        p["yaw"] = _turn_yaw(p["yaw"], wanted, skill["turn"] * dt)
        p["pitch"] = clamp(_approach(p["pitch"], wanted_pitch, skill["pitch"] * dt), -89, 89)
        aligned = abs(_angdiff(p["yaw"], wanted)) < AIM_TOLERANCE_DEG and abs(p["pitch"] - wanted_pitch) < AIM_TOLERANCE_DEG
        if now >= st["burst_ready"] and now >= st["burst_end"]:
            st["hesitate_until"] = now+_RNG.uniform(180, 550) if _RNG.random() < skill["lapse"] else now
            st["burst_end"] = st["hesitate_until"] + _RNG.uniform(*skill["burst"])
            st["burst_ready"] = st["burst_end"] + _RNG.uniform(*skill["pause"])
        direction = dir_from_angles(p["yaw"], p["pitch"])
        if aligned and not reloading and now >= max(st["react_until"], st["hesitate_until"]) and now < st["burst_end"] and not _friendly_lane(match, p, eye, direction, distance):
            events.extend(match._on_fire(p, {"t": "fire", "o": list(eye), "d": list(direction)}))
    elif memory:
        bearing = math.degrees(math.atan2(memory[2] - eye[2], memory[0] - eye[0]))
        p["yaw"] = _turn_yaw(p["yaw"], bearing, skill["turn"] * 0.6 * dt)

    # Low health/reload: seek actual occluding cover, not a random backwards
    # sidestep. Keep a chosen spot for a second instead of oscillating each tick.
    under_pressure = now < p.get("suppress_until", 0) and st["visible_count"] >= 2 and skill["coordination"] >= .8
    retreat = bool(memory and (hurt or reloading or under_pressure) or st["cover"] and hurt and now - p["last_hit_ms"] < 10500)
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
        target = _objective_goal(match, p, now)
        if math.hypot(p['pos'][0]-target['p'][0],p['pos'][2]-target['p'][2]) < 1.8:
            dx, dz, speed_mult = 0, 0, 0
        else:
            dx, dz = _route_direction(p,target['p'],now)
            speed_mult = .85
        st["search_heading"] = None
    elif visible:
        tactic = _choose_tactic(p, visible, distance, ideal, now, match)
        dx, dz = visible["pos"][0]-p["pos"][0], visible["pos"][2]-p["pos"][2]
        speed_mult = .5*st["aggression"]
        if tactic == "hold" and distance < ideal*1.7:
            dx, dz, speed_mult = 0.0, 0.0, 0.0
        elif tactic == "flank" and st["flank_goal"]:
            dx, dz = _route_direction(p, st["flank_goal"], now)
            if dist3(p["pos"], st["flank_goal"]) < .7:
                st["tactic_until"] = now
        elif tactic == "withdraw":
            dx, dz = -dx, -dz
        elif tactic == "strafe":
            dx, dz = -dz*st["strafe"], dx*st["strafe"]
    elif memory and dist3(p["pos"], memory) > 1.2:
        dx, dz = _route_direction(p, memory, now)
        speed_mult = 0.8
    elif combat.MAP_DATA.get('bot_nav'):
        # Patrol an upper lookout, then the opposing end of the city. No jump
        # impulses or privileged teleports: _steer walks the authored ramp.
        lookouts=[n['p'] for n in combat.MAP_DATA['bot_nav']['nodes'] if n.get('kind')=='lookout']
        stage=st.get('city_patrol',0)
        if stage%2==0 and lookouts:
            if st.get('patrol_stage') != stage:
                st['patrol_stage'], st['patrol_index'] = stage, _RNG.randrange(len(lookouts))
            goal=lookouts[st['patrol_index']]
        else:
            spawn=combat.SPAWNS[str(1-p['team'])][p['id']%len(combat.SPAWNS[str(1-p['team'])])]
            goal=[spawn['x'],spawn['y'],spawn['z']]
        if dist3(p['pos'],goal)<.7:st['city_patrol']=stage+1
        dx,dz=_route_direction(p,goal,now)
        speed_mult=.8
        st['search_heading']=None
    else:
        nd = combat.nav_dir(p["pos"][0], p["pos"][2], p["team"])
        if nd:
            st["search_heading"] = None
            dx, dz = nd
            dx, dz = dx - dz * st["lane"] * 0.015, dz + dx * st["lane"] * 0.015
        else:
            # No path / reached the flow-field goal: keep an absolute heading.
            # Applying the lane bias to our own yaw here feeds each turn back
            # into the next tick and produces endless gun-holding circles.
            if st["search_heading"] is None:
                st["search_heading"] = math.radians(p["yaw"])
            dx, dz = math.cos(st["search_heading"]), math.sin(st["search_heading"])
        speed_mult = 0.9
    if now >= st["strafe_until"]:
        st["strafe"] = _RNG.choice((-1, 1))
        st["strafe_until"] = now + _RNG.uniform(1400, 4200)
    if now >= st["progress_at"]:
        last = st["progress_pos"]
        if last and speed_mult and dist3(last, p["pos"]) < 0.4:
            st["escape_until"] = now + 700
            # Commit in world space, not relative to the changing aim/body yaw.
            st["escape_heading"] = math.atan2(dz, dx) + math.radians(125 * st["strafe"])
            st["detour"], st["route_at"] = None, 0
            st["strafe"] *= -1
        st["progress_pos"], st["progress_at"] = list(p["pos"]), now + 900
    if now < st["escape_until"]:
        angle = st["escape_heading"]
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
    crouch = at_cover and (hurt or reloading or under_pressure)
    speed = COMBAT["maxMoveSpeed"] * CLASSES[p["cls"]]["speedMult"] * speed_mult * (0.55 if crouch else 1)
    old = list(p["pos"])
    off, nxt = _steer(p, dx, dz, speed * dt, st.get("detour")) if speed_mult else (0.0, None)
    if nxt:
        st["detour"] = None if off == 0 else off
        p["pos"] = [nxt[0], combat.floor_at(nxt[0], nxt[1], old[1]), nxt[1]]
    if not visible and not memory and dist3(old, p["pos"]) > 0.005:
        # Exactly one facing controller per tick: combat/investigation above,
        # otherwise the direction we actually walked, including obstacle turns.
        bearing = math.degrees(math.atan2(p["pos"][2]-old[2], p["pos"][0]-old[0]))
        p["yaw"] = _turn_yaw(p["yaw"], bearing, skill["turn"] * dt)
    match._movement_spawn_shield(p, old)
    p["velocity"] = [(p["pos"][i]-old[i])/max(dt, 0.001) for i in range(3)]
    p["flags"] = {"move": dist3(old, p["pos"]) > 0.005, "sprint": False, "crouch": crouch, "ground": True}
    return events
