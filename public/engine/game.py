"""Authoritative match state for one team-deathmatch lobby.

The server owns health, ammo, fire rate, ability cooldowns and scoring.
Clients only ever report where they are and where they shot; nothing they say
about damage is trusted.
"""

import math
import random
import time
from collections import deque

from combat import (
    CLASSES, CLASS_WEAPONS, COMBAT, WEAPONS,
    clamp, compute_damage, dir_from_angles, dist3, weapon_reserve,
    normalize, random_spawn, ray_capsule, ray_world, reload_duration,
    reload_is_clip, resolve_move, zone_of,
)
import combat
import bots as bots_mod
from throwing import GRENADES, simulate as simulate_throw

# One sampled position per tick, kept long enough to cover the deepest rewind.
HIST_MAXLEN = int(COMBAT["tickRate"] * float(COMBAT.get("historyMs", 1000)) / 1000.0) + 2
LAGCOMP_MAX_MS = float(COMBAT.get("lagCompMaxMs", 220))
INTERP_MS = float(COMBAT["interpDelayMs"])
# Never trust a client's latency claim beyond this: an inflated ping would widen
# the rewind window and make shooting easier.
MAX_ONE_WAY_MS = 120.0

# Out-of-combat breathing: once REGEN_DELAY_MS have passed since the last bullet
# or blast landed on you, health refills completely over REGEN_SECONDS. Applies
# to humans and bots alike. The medic zone stacks on top of this.
REGEN_DELAY_MS = 8000.0
REGEN_SECONDS = 8.0

# A bot firing through smoke at anything past this range only lands one shot in
# ten: the cloud is thin enough to see through up close, but a bot has no way to
# keep a bead on a target it cannot see.
SMOKE_BLIND_DIST = 5.0
SMOKE_BLIND_CHANCE = 0.1

# A heal/ammo crate stands until its owner puts the next one down, so its
# lifetime is only a safety net -- longer than a match, and the client is told
# to hold it until an explicit removal arrives.
CRATE_LIFE_MS = 600000.0
# How long a flare keeps a player marked after the tick that last saw them in
# range. Roughly one state frame, so leaving the circle (or entering smoke)
# clears the mark on the very next snapshot rather than lingering.
REVEAL_HOLD_MS = 120.0


def now_ms():
    return time.monotonic() * 1000.0


def _hist_pos(p, t_target):
    """Player position interpolated to t_target, from their position ring buffer.

    Sampling is one entry per server tick, so any point in the last
    ``historyMs`` is reconstructed by lerping between the two bracketing
    samples. Targets older/newer than the buffer clamp to its ends.
    """
    h = p["hist"]
    if not h:
        return tuple(p["pos"])
    if t_target >= h[-1][0]:
        return h[-1][1], h[-1][2], h[-1][3]
    if t_target <= h[0][0]:
        return h[0][1], h[0][2], h[0][3]
    for i in range(len(h) - 1, 0, -1):
        t0, t1 = h[i - 1][0], h[i][0]
        if t0 <= t_target <= t1:
            if t1 - t0 < 1e-6:
                return h[i][1], h[i][2], h[i][3]
            k = (t_target - t0) / (t1 - t0)
            a, b = h[i - 1], h[i]
            return (a[1] + (b[1] - a[1]) * k,
                    a[2] + (b[2] - a[2]) * k,
                    a[3] + (b[3] - a[3]) * k)
    return h[-1][1], h[-1][2], h[-1][3]


def _seed_hist(p, t):
    """Start a fresh buffer, so a body can never be hit at a stale spot.

    Called on spawn and on death: rewinding across a respawn would otherwise
    resurrect the pre-death position.
    """
    p["hist"] = deque(maxlen=HIST_MAXLEN)
    p["hist"].append((t, p["pos"][0], p["pos"][1], p["pos"][2]))


def eye_pos(p):
    h = COMBAT["crouchEyeHeight"] if p["flags"].get("crouch") else COMBAT["standEyeHeight"]
    return (p["pos"][0], p["pos"][1] + h, p["pos"][2])


def body_height(p):
    """Collision capsule height: the crouched body is shorter, so it fits low gaps."""
    return COMBAT["crouchHeight"] if p["flags"].get("crouch") else COMBAT["playerHeight"]


def mag_size(weapon_id):
    return int(WEAPONS[weapon_id]["mag"])


def reserve_cap(weapon_id):
    """Spare rounds carried on top of the loaded magazine, straight off the gun.

    reserve is a per-weapon figure (see weapons.json), so swapping guns also
    swaps the amount of spare ammo behind them.
    """
    return max(0, weapon_reserve(weapon_id))


def max_hp(match, p):
    """Class health, straight off the class table for bots and humans alike."""
    return float(CLASSES[p["cls"]]["maxHp"])


def heal_rate(match, p):
    """Health per second restored by a medic zone, faster in solo for the human.

    Solo keeps the recovery speed-up even though the health pool is no longer
    padded: the lone player still has to be able to disengage and heal.
    """
    return 14.0 * (2.0 if (match.solo and not p["bot"]) else 1.0)


def _f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError, OverflowError):
        return default


class Match:
    def __init__(self, bot_count=0):
        self.players = {}
        self.effects = []
        self.next_id = 1
        # Effect ids are separate from player ids: a crate is taken back down by
        # id, and player ids get reused as people come and go.
        self.next_eid = 1
        self.scores = [0, 0]
        self.start_ms = None
        self.phase = "waiting"
        self.winner = -1
        self.ended_at = 0.0
        self.tick_count = 0
        self.rng = random.Random(1914)
        self.bot_count = bot_count
        self.suppress_window = 1500.0
        self.outbox = []
        # Solo balancing is opt-in per join: see Lobby.join. In solo a bot only
        # lands half of its shots on the lone human, and its bullets through
        # smoke barely connect at all.
        self.solo = False
        # Kept apart from self.rng so the miss coin-flip never shifts spawn luck.
        self.hit_rng = random.Random(90210)

    # ------------------------------------------------------------------ roster

    def _pick_team(self):
        a = sum(1 for p in self.players.values() if p["team"] == 0)
        b = sum(1 for p in self.players.values() if p["team"] == 1)
        if a < b:
            return 0
        if b < a:
            return 1
        return self.next_id % 2

    def add_player(self, name, ws, cls="assault", weapon=None, bot=False, skin=""):
        pid = self.next_id
        self.next_id += 1
        team = self._pick_team()
        cls = cls if cls in CLASSES else "assault"
        if weapon not in CLASS_WEAPONS.get(cls, []):
            weapon = CLASS_WEAPONS[cls][0]
        spawn, spawn_yaw = random_spawn(team, self.rng)
        hp = float(CLASSES[cls]["maxHp"])
        p = {
            "id": pid, "name": name, "team": team, "cls": cls, "weapon": weapon,
            "hp": hp, "alive": True,
            "pos": list(spawn),
            # the spawn point carries the facing that looks across the map
            "yaw": spawn_yaw,
            "pitch": 0.0, "flags": {}, "mag": mag_size(weapon),
            "reserve": reserve_cap(weapon),
            "reload_end": 0.0, "reload_from": 0.0, "reload_total": 0.0,
            "last_shot": 0.0, "shot_seq": 0, "ability_ready": 0.0,
            "ability_charges": int(CLASSES[cls].get("abilityCharges", 1)),
            "grenades": int(combat.THROW["grenadeCharges"]), "grenade_ready": 0.0,
            "velocity": [0.0, 0.0, 0.0], "flash_until": 0.0,
            "kills": 0, "deaths": 0, "respawn_at": 0.0, "reveal_until": 0.0,
            "last_input": now_ms(), "bot": bot, "ws": ws, "ping": 0,
            "suppress_until": 0.0, "healed_at": 0.0, "resupply_at": 0.0,
            # last bullet/blast that landed; drives out-of-combat regeneration
            "last_hit_ms": now_ms(),
            "hist": deque(maxlen=HIST_MAXLEN),
            "bot_state": bots_mod.new_state(team) if bot else None,
            # shared character id; bots always use the built-in girl
            "skin": "" if bot else skin,
        }
        _seed_hist(p, now_ms())
        self.players[pid] = p
        if self.start_ms is None:
            self.start_ms = now_ms()
            self.phase = "live"
        return p

    def remove_player(self, pid):
        if self.players.pop(pid, None) is None:
            return
        # A crate outlives its owner's socket but not their absence: take it down
        # so the field does not fill with orphaned boxes. Queued on the outbox
        # because leave() cannot return events.
        self.outbox.extend(self._drop_crates(pid))

    def human_count(self):
        return sum(1 for p in self.players.values() if not p["bot"])

    def fill_bots(self, want):
        """Top up with bots so a lone player still sees a running match."""
        # Solo never fields bot scouts: a bot sniper one-shots the lone player
        # across the map, and there is no team to trade the pick back.
        pool = ["assault", "medic", "support"] if self.solo else ["assault", "medic", "support", "scout"]
        live_bots = sum(1 for p in self.players.values() if p["bot"])
        while live_bots < want:
            n = live_bots + 1
            cls = pool[n % len(pool)]
            self.add_player("BOT-%02d" % n, None, cls=cls, bot=True)
            live_bots += 1

    def drop_bots(self):
        for pid in [p["id"] for p in self.players.values() if p["bot"]]:
            self.remove_player(pid)

    # ---------------------------------------------------------------- handlers

    def handle(self, pid, msg):
        p = self.players.get(pid)
        if p is None or p["bot"]:
            return []
        t = msg.get("t")
        if t == "input":
            self._on_input(p, msg)
        elif t == "fire":
            return self._on_fire(p, msg)
        elif t == "reload":
            self._on_reload(p)
        elif t == "ability":
            return self._on_ability(p, msg)
        elif t == "grenade":
            return self._on_grenade(p, msg)
        elif t == "respawn":
            return self._on_respawn(p, msg)
        elif t == "chat":
            text = str(msg.get("m", ""))[:120]
            if text:
                return [{"to": None, "msg": {"t": "chat", "n": p["name"], "tm": p["team"], "m": text}}]
        return []

    def _on_input(self, p, msg):
        if not p["alive"]:
            return
        pos = msg.get("p")
        if not (isinstance(pos, (list, tuple)) and len(pos) == 3):
            return
        target = [_f(pos[0]), _f(pos[1]), _f(pos[2])]
        if any(math.isnan(v) or math.isinf(v) for v in target):
            return

        rot = msg.get("r")
        if isinstance(rot, (list, tuple)) and len(rot) >= 2:
            p["yaw"] = _f(rot[0]) % 360.0
            p["pitch"] = clamp(_f(rot[1]), -89.0, 89.0)

        flags = msg.get("s")
        if isinstance(flags, dict):
            p["flags"] = {
                "crouch": bool(flags.get("crouch")),
                "sprint": bool(flags.get("sprint")),
                "move": bool(flags.get("move")),
                "ground": bool(flags.get("ground", True)),
            }

        now = now_ms()
        dt = clamp((now - p["last_input"]) / 1000.0, 0.001, 0.5)
        p["last_input"] = now

        speed = COMBAT["maxMoveSpeed"] * CLASSES[p["cls"]]["speedMult"]
        if p["flags"].get("sprint"):
            speed *= 1.35
        if p["flags"].get("crouch"):
            speed *= 0.55
        maxd = speed * dt * 1.8 + 0.3

        ox, oy, oz = p["pos"]
        dx, dz = target[0] - ox, target[2] - oz
        d = math.hypot(dx, dz)
        if d > maxd:
            k = maxd / d
            target[0] = ox + dx * k
            target[2] = oz + dz * k

        target[0] = clamp(target[0], combat.BOUNDS["minX"] + 1.5, combat.BOUNDS["maxX"] - 1.5)
        target[2] = clamp(target[2], combat.BOUNDS["minZ"] + 1.5, combat.BOUNDS["maxZ"] - 1.5)
        nx, nz = resolve_move(p["pos"], target, oy, body_height(p))
        # Anchor the vertical clamp to the surface under the new spot rather than
        # to a constant street height: a stair tread then carries the player up
        # (and a landing carries them down) instead of the body sinking through
        # the geometry. oy caps how far one tick can climb, so walls still block.
        floor = combat.floor_at(nx, nz, oy)
        ny = clamp(target[1], floor - 0.05, floor + 1.6)
        cap = COMBAT["maxMoveSpeed"] * 1.35
        p["velocity"] = [clamp((nx-ox)/dt, -cap, cap), clamp((ny-oy)/dt, -cap, cap), clamp((nz-oz)/dt, -cap, cap)]
        p["pos"] = [nx, ny, nz]

    def _on_reload(self, p):
        if not p["alive"]:
            return
        if p["mag"] >= mag_size(p["weapon"]):
            return
        if int(p["reserve"]) <= 0:
            return
        if now_ms() < p["reload_end"]:
            return
        mag = int(p["mag"])
        dur = reload_duration(p["weapon"], mag, p["reserve"])
        p["reload_from"] = float(mag)
        p["reload_total"] = dur
        p["reload_end"] = now_ms() + dur

    def _on_fire(self, p, msg):
        if not p["alive"] or self.phase != "live":
            return []
        w = WEAPONS[p["weapon"]]
        now = now_ms()
        if now < p["reload_end"]:
            # A clip-fed bolt-action can be cut short: any round already seated
            # stays in the magazine, so the player may fire mid-reload. Those
            # seated rounds are billed to the reserve here, because an interrupted
            # reload never reaches the completion step that normally charges them.
            if reload_is_clip(p["weapon"]) and p["mag"] >= 1:
                seated = int(p["mag"])
                p["reserve"] = max(0, p["reserve"] - max(0, seated - int(p["reload_from"])))
                p["mag"] = float(seated)
                p["reload_end"] = 0.0
                p["reload_total"] = 0.0
            else:
                return []
        if now - p["last_shot"] < (60000.0 / float(w["rpm"])) * 0.9:
            return []
        if p["mag"] <= 0:
            self._on_reload(p)
            return []

        eye = eye_pos(p)
        o = msg.get("o")
        if isinstance(o, (list, tuple)) and len(o) == 3:
            o = (_f(o[0]), _f(o[1]), _f(o[2]))
            # 1.5m of slack: a sprinting client's reported eye is one one-way
            # trip stale, and that has to stay inside tolerance or shots get
            # silently relocated to the server's copy of the shooter.
            if any(math.isnan(v) or math.isinf(v) for v in o) or dist3(o, eye) > 1.5:
                o = eye
        else:
            o = eye
        d = msg.get("d")
        if isinstance(d, (list, tuple)) and len(d) == 3:
            d = normalize((_f(d[0]), _f(d[1]), _f(d[2])))
        else:
            d = dir_from_angles(p["yaw"], p["pitch"])
        if d == (0.0, 0.0, 0.0):
            return []

        p["last_shot"] = now
        p["shot_seq"] = p.get("shot_seq", 0) + 1
        p["mag"] -= 1

        max_range = 220.0
        wall = ray_world(o, d, max_range)
        limit = wall if wall is not None else max_range

        # Lag compensation. The shooter aimed at whatever their client happened
        # to be drawing: that is one one-way trip plus the remote interpolation
        # delay behind the server's clock. Rewind every target to that instant.
        # Bots have no network, so rewinding them would only make them miss.
        if p["bot"]:
            back = 0.0
        else:
            one_way = clamp(float(p.get("ping") or 0.0) * 0.5, 0.0, MAX_ONE_WAY_MS)
            back = clamp(one_way + INTERP_MS, 0.0, LAGCOMP_MAX_MS)
        target_t = now - back

        best = None
        for q in self.players.values():
            if q is p or not q["alive"] or q["team"] == p["team"]:
                continue
            base = q["pos"] if back < 1.0 else _hist_pos(q, target_t)
            qh = body_height(q)
            t = ray_capsule(o, d, base, qh, COMBAT["hitRadius"], limit)
            if t is not None and (best is None or t < best[0]):
                hit_y = o[1] + d[1] * t
                best = (t, q, zone_of(hit_y, base[1], qh))

        if best is None:
            return []

        t, vic, zone = best

        # Solo only: a bot's shots at the human are voided half the time, so the
        # lone player is not deleted by accurate fire. Bot-vs-bot and every human
        # shot resolve exactly as before.
        if self.solo and p["bot"] and not vic["bot"] and self.hit_rng.random() < 0.5:
            return []

        # Smoke blinds bots on either team: a bullet that crosses a cloud while
        # the target is past SMOKE_BLIND_DIST only lands SMOKE_BLIND_CHANCE of the
        # time. Up close the cloud is thin enough to shoot through, so the rule
        # only bites at range.
        if p["bot"] and dist3(o, vic["pos"]) > SMOKE_BLIND_DIST:
            end = (o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t)
            if (self._path_in_smoke(o, end)
                    and self.hit_rng.random() >= SMOKE_BLIND_CHANCE):
                return []

        dmg = compute_damage(p["weapon"], t, zone)
        vic["hp"] -= dmg
        vic["last_hit_ms"] = now
        if p["cls"] == "support":
            vic["suppress_until"] = now + self.suppress_window

        shown = int(min(dmg, 999))
        out = [
            {"to": p["id"], "msg": {"t": "hit", "r": "deal", "dmg": shown, "zone": zone,
                                    "lethal": vic["hp"] <= 0,
                                    "p": [round(v, 2) for v in vic["pos"]]}},
            {"to": vic["id"], "msg": {"t": "hit", "r": "take", "dmg": shown, "zone": zone,
                                      "from": p["id"],
                                      "p": [round(v, 2) for v in p["pos"]]}},
        ]
        if vic["hp"] <= 0:
            out.extend(self._kill(p, vic, zone == "head"))
        return out

    def _kill(self, killer, victim, headshot, weapon=None):
        now = now_ms()
        victim["hp"] = 0.0
        victim["alive"] = False
        victim["deaths"] += 1
        victim["respawn_at"] = now + float(COMBAT["respawnMs"])
        victim["flags"] = {}
        _seed_hist(victim, now)
        if killer["id"] == victim["id"]:
            killer["kills"] = max(0, killer["kills"] - 1)
        else:
            killer["kills"] += 1
        if killer["team"] != victim["team"]:
            self.scores[killer["team"]] += 1
            if self.scores[killer["team"]] >= int(COMBAT["scoreLimit"]):
                self._end(killer["team"])
        return [{"to": None, "msg": {
            "t": "kill",
            "k": {"id": killer["id"], "n": killer["name"], "c": killer["cls"], "tm": killer["team"]},
            "v": {"id": victim["id"], "n": victim["name"], "c": victim["cls"], "tm": victim["team"]},
            "w": weapon or killer["weapon"], "head": headshot,
            "score": list(self.scores),
        }}]

    def _end(self, winner):
        self.phase = "ended"
        self.winner = winner
        self.ended_at = now_ms()

    def _on_respawn(self, p, msg):
        if p["alive"] or self.phase != "live":
            return []
        if now_ms() < p["respawn_at"]:
            return []
        cls = msg.get("c")
        weapon = msg.get("w")
        if cls in CLASSES:
            p["cls"] = cls
        if weapon in CLASS_WEAPONS.get(p["cls"], []):
            p["weapon"] = weapon
        elif p["weapon"] not in CLASS_WEAPONS.get(p["cls"], []):
            p["weapon"] = CLASS_WEAPONS[p["cls"]][0]
        return self._spawn(p)

    def _spawn(self, p):
        p["hp"] = max_hp(self, p)
        p["alive"] = True
        p["mag"] = mag_size(p["weapon"])
        p["reserve"] = reserve_cap(p["weapon"])
        p["reload_end"] = 0.0
        p["reload_from"] = 0.0
        p["reload_total"] = 0.0
        p["last_shot"] = 0.0
        p["grenades"] = int(combat.THROW["grenadeCharges"])
        p["grenade_ready"] = p["flash_until"] = 0.0
        p["velocity"] = [0.0, 0.0, 0.0]
        p["suppress_until"] = 0.0
        p["reveal_until"] = 0.0
        s, spawn_yaw = random_spawn(p["team"], self.rng)
        p["pos"] = list(s)
        p["yaw"] = spawn_yaw
        p["pitch"] = 0.0
        p["last_input"] = now_ms()
        # a fresh body starts the out-of-combat timer over
        p["last_hit_ms"] = p["last_input"]
        _seed_hist(p, p["last_input"])
        if p["bot"]:
            p["bot_state"] = bots_mod.new_state(p["team"])
        return [{"to": p["id"], "msg": {"t": "spawn", "p": [round(v, 2) for v in p["pos"]],
                                        "yaw": p["yaw"], "hp": p["hp"], "c": p["cls"], "w": p["weapon"]}}]

    # ---------------------------------------------------------------- abilities

    def _on_ability(self, p, msg):
        if not p["alive"] or self.phase != "live":
            return []
        now = now_ms()
        cls = CLASSES[p["cls"]]
        cd = float(cls.get("abilityCdMs", 15000))
        charges = int(cls.get("abilityCharges", 1))
        # Abilities hold one or more charges. The cooldown only starts once the
        # last charge is spent, so a class with two can drop both back to back
        # and only then wait out the timer. Charges come back together when the
        # timer is done.
        if p["ability_charges"] <= 0 and now >= p["ability_ready"]:
            p["ability_charges"] = charges
        if p["ability_charges"] <= 0:
            return []
        kind = cls["ability"]
        eye = eye_pos(p)
        out = []
        # Every effect carries a stable id so the client can take one persistent
        # crate back down again by itself when it is replaced.
        fx = {"k": kind, "team": p["team"], "by": p["id"], "eid": self.next_eid}
        self.next_eid += 1

        if kind in ("smoke", "flare"):
            flight = self._throw_flight(p, msg, kind)
            if flight is None:
                return []
            spec = GRENADES.get(kind, {"radius": 30, "dur": 9000})
            fx.update(flight)
            fx.update({"from": list(eye), "r": spec["radius"], "dur": spec["dur"]})

        elif kind in ("heal", "ammo"):
            # Placed at the caster's feet and left standing until they put the
            # next one down, so the team has an area it can come back to rather
            # than a six-second pulse. Re-casting takes the old one down first.
            out.extend(self._drop_crates(p["id"]))
            radius = 6.0
            fx.update({"p": [round(v, 2) for v in p["pos"]], "r": radius,
                       "dur": CRATE_LIFE_MS, "persist": True})

        p["ability_charges"] -= 1
        if p["ability_charges"] <= 0:
            p["ability_ready"] = now + cd
        # A thrown effect only goes live on impact; a crate is live at once.
        fx["start"] = now + fx.get("delay", 0.0)
        fx["until"] = fx["start"] + fx["dur"]
        self.effects.append(fx)
        out.append({"to": None, "msg": {"t": "fx", "fx": {k: v for k, v in fx.items()
                                                          if k not in ("until", "start")}}})
        return out

    def _throw_flight(self, p, msg, kind):
        direction = msg.get("d", dir_from_angles(p["yaw"], p["pitch"]))
        if not isinstance(direction, (list, tuple)) or len(direction) != 3:
            return None
        direction = [_f(v) for v in direction]
        power = _f(msg.get("power", 0.55))
        if not all(math.isfinite(v) for v in direction) or not math.isfinite(power):
            return None
        if sum(v*v for v in direction) < 1e-8:
            return None
        # Neither msg.p (legacy landing) nor a client velocity is authoritative.
        inherited = p.get("velocity", (0, 0, 0)) if p["bot"] or now_ms()-p["last_input"] < 200 else (0, 0, 0)
        return simulate_throw(eye_pos(p), direction, clamp(power, 0, 1), kind, inherited)

    def _on_grenade(self, p, msg):
        if not p["alive"] or self.phase != "live":
            return []
        kind = msg.get("kind")
        if not isinstance(kind, str) or kind not in GRENADES:
            return []
        now = now_ms()
        if p["grenades"] <= 0 and now >= p["grenade_ready"]:
            p["grenades"] = int(combat.THROW["grenadeCharges"])
        if p["grenades"] <= 0:
            return []
        flight = self._throw_flight(p, msg, kind)
        if flight is None:
            return []
        spec = GRENADES[kind]
        fx = dict(k=kind, team=p["team"], by=p["id"], eid=self.next_eid,
                  r=spec["radius"], dur=spec["dur"], **flight)
        if kind == "incendiary":
            # The shell bursts at the path endpoint; its fuel spills onto the
            # first floor BELOW that contact, never onto the roof above it.
            x, y, z = flight["p"]
            fx["p"] = [x, round(combat.floor_at(x, z, y-combat.STEP_UP_MAX)+combat.THROW["radius"], 4), z]
        fx["from"] = list(eye_pos(p))
        fx["start"] = now + flight["delay"]
        fx["until"] = fx["start"] + fx["dur"]
        fx["owner"] = {key: p[key] for key in ("id", "name", "team", "cls", "weapon", "kills")}
        self.next_eid += 1
        self.effects.append(fx)
        p["grenades"] -= 1
        if p["grenades"] <= 0:
            p["grenade_ready"] = now + combat.THROW["grenadeCdMs"]
        return [{"to": None, "msg": {"t": "fx", "fx": self._public_effect(fx)}}]

    @staticmethod
    def _public_effect(effect):
        return {k: v for k, v in effect.items() if k not in ("until", "start", "owner", "triggered")}

    def _grenade_damage(self, effect, victim, damage, zone):
        owner = self.players.get(effect["by"]) or effect["owner"]
        victim["hp"] -= damage
        victim["last_hit_ms"] = now_ms()
        out = [{"to": victim["id"], "msg": {"t": "hit", "r": "take", "dmg": int(math.ceil(damage)), "zone": zone,
                                            "from": owner["id"], "p": effect["p"]}}]
        if victim["id"] != owner["id"]:
            out.append({"to": owner["id"], "msg": {"t": "hit", "r": "deal", "dmg": int(math.ceil(damage)), "zone": zone,
                                                  "lethal": victim["hp"] <= 0, "p": list(victim["pos"])}})
        if victim["hp"] <= 0:
            out.extend(self._kill(owner, victim, False, effect["k"]))
        return out

    def _tick_grenade(self, e, now, dt_ms):
        if self.phase != "live":
            return
        kind = e["k"]
        spec = GRENADES[kind]
        if kind in ("frag", "flash"):
            if e.get("triggered"):
                return
            e["triggered"] = True
        for victim in self.players.values():
            if not victim["alive"]:
                continue
            if kind != "flash" and victim["team"] == e["team"] and victim["id"] != e["by"]:
                continue  # no friendly damage, but one's own grenade still hurts
            point = [victim["pos"][0], victim["pos"][1] + body_height(victim)*0.55, victim["pos"][2]]
            distance = dist3(point, e["p"])
            source = [e["p"][0], e["p"][1]+0.12, e["p"][2]]
            if distance >= e["r"] or not combat.has_line_of_sight(source, point):
                continue
            if kind == "flash":
                facing = dir_from_angles(victim["yaw"], victim["pitch"])
                toward = normalize(tuple(e["p"][i]-eye_pos(victim)[i] for i in range(3)))
                dot = sum(facing[i]*toward[i] for i in range(3))
                strength = (1-distance/e["r"]) * (1.0 if dot > 0.25 else 0.35)
                duration = int(spec["flashMs"]*strength)
                victim["flash_until"] = max(victim["flash_until"], now+duration)
                self.outbox.append({"to": victim["id"], "msg": {"t": "flash", "strength": strength, "ms": duration}})
            else:
                active = max(0, min(now, e["until"])-max(now-dt_ms, e["start"])) / 1000
                damage = spec["damage"]*max(0, 1-distance/e["r"]) if kind == "frag" else spec["damagePerSecond"]*active
                if damage > 0:
                    self.outbox.extend(self._grenade_damage(e, victim, damage, "blast" if kind == "frag" else "fire"))

    def _drop_crates(self, pid):
        """Take down a caster's standing heal/ammo crates.

        Returns the broadcast events that tell every client to remove them; the
        caller decides where those go (straight out, or through the outbox).
        """
        keep = []
        out = []
        for e in self.effects:
            if e.get("persist") and e["by"] == pid:
                out.append({"to": None, "msg": {"t": "fx", "fx": {"k": "remove", "eid": e["eid"]}}})
            else:
                keep.append(e)
        self.effects = keep
        return out

    def _in_smoke(self, pos):
        """True when ``pos`` sits inside a live smoke cloud.

        Smoke is what a flare cannot see through, so this is checked before a
        player is marked.
        """
        now = now_ms()
        for e in self.effects:
            # A cloud still in the air (start in the future) blinds nobody yet.
            if (e["k"] == "smoke" and e.get("start", 0.0) <= now
                    and dist3(pos, e["p"]) <= e["r"]):
                return True
        return False

    def _path_in_smoke(self, a, b):
        """True when the segment ``a``-``b`` clips any live smoke cloud.

        The shooter and the victim can both sit outside a cloud while the bullet
        still flies through one, so a plain _in_smoke on either end is not
        enough: this tests the closest approach of each cloud's centre to the
        segment instead.
        """
        now = now_ms()
        ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
        for e in self.effects:
            if e["k"] != "smoke" or e.get("start", 0.0) > now:
                continue
            c = e["p"]
            if ab2 < 1e-9:
                t = 0.0
            else:
                t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1]
                     + (c[2] - a[2]) * ab[2]) / ab2
                t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
            near = (a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t)
            if dist3(near, c) <= e["r"]:
                return True
        return False

    def standing_crates(self):
        """Public live payloads and pending flights, with receiver-relative age."""
        now = now_ms()
        return [dict(self._public_effect(e), age=max(0, now-e["start"]+e.get("delay", 0)))
                for e in self.effects if e.get("persist") or e["until"] > now]

    # -------------------------------------------------------------- simulation

    def tick(self, dt_ms):
        self.tick_count += 1
        now = now_ms()
        dt = dt_ms / 1000.0

        if self.phase == "live":
            if self.start_ms is None:
                self.start_ms = now
            if now - self.start_ms >= float(COMBAT["matchMs"]):
                self._end(0 if self.scores[0] >= self.scores[1] else 1)
        elif self.phase == "ended" and now - self.ended_at > 10000.0:
            self.scores = [0, 0]
            self.start_ms = now
            self.phase = "live"
            self.winner = -1
            for p in self.players.values():
                if p["alive"]:
                    self._spawn(p)
                else:
                    p["respawn_at"] = now

        for p in self.players.values():
            if not p["alive"] and now >= p["respawn_at"] + 8000.0 and self.phase == "live":
                self._spawn(p)
            if not p["alive"]:
                continue
            if p["reload_end"] > 0:
                # Rounds still to load are bounded by the spare ammo on hand.
                need = min(mag_size(p["weapon"]) - int(p["reload_from"]), int(p["reserve"]))
                if reload_is_clip(p["weapon"]):
                    # Seat whole rounds as the clip feeds in, so an interrupted
                    # reload keeps exactly what has already gone in.
                    total = max(1.0, p["reload_total"])
                    done = min(1.0, 1.0 - max(0.0, p["reload_end"] - now) / total)
                    p["mag"] = float(int(p["reload_from"]) + int(need * done))
                if now >= p["reload_end"]:
                    # Finalise: top the magazine up from the reserve and stop.
                    # This has to fire on the clock alone. Testing ``mag < mag_size``
                    # instead left reload_end set once the clip had filled, and the
                    # following ticks then recomputed mag back to full after every
                    # shot -- the magazine that would never empty.
                    p["mag"] = float(int(p["reload_from"]) + need)
                    p["reserve"] -= need
                    p["reload_end"] = 0.0
                    p["reload_total"] = 0.0

        # Crates have no expiry of their own (persist=True); anything else lives
        # out its duration. Publish the pruned list first so _in_smoke only ever
        # sees clouds that are actually still burning.
        self.effects = [e for e in self.effects if e.get("persist") or e["until"] > now
                        or e["k"] in ("frag", "flash") and not e.get("triggered")
                        or e["k"] == "incendiary" and e["until"] > now-dt_ms]
        for e in self.effects:
            # A thrown cloud/flare is inert until it lands (start = impact time).
            if now < e.get("start", 0.0):
                continue
            if e["k"] in ("frag", "incendiary", "flash"):
                self._tick_grenade(e, now, dt_ms)
            elif e["k"] == "heal":
                for p in self.players.values():
                    if p["alive"] and p["team"] == e["team"] and dist3(p["pos"], e["p"]) <= e["r"]:
                        cap = max_hp(self, p)
                        if p["hp"] < cap:
                            p["hp"] = min(cap, p["hp"] + heal_rate(self, p) * dt)
                            p["healed_at"] = now
            elif e["k"] == "ammo":
                for p in self.players.values():
                    if p["alive"] and p["team"] == e["team"] and dist3(p["pos"], e["p"]) <= e["r"]:
                        # The crate refills spare ammo, not the magazine: the
                        # player still has to reload, which is what makes the
                        # class's ammo allowance mean anything.
                        cap = reserve_cap(p["weapon"])
                        if p["reserve"] < cap:
                            p["reserve"] = min(cap, p["reserve"] + 20.0 * dt)
                            p["resupply_at"] = now
            elif e["k"] == "flare":
                for p in self.players.values():
                    # Smoke beats the flare: a player inside a cloud is not
                    # marked even when the flare is right on top of them.
                    if (p["alive"] and p["team"] != e["team"]
                            and dist3(p["pos"], e["p"]) <= e["r"]
                            and not self._in_smoke(p["pos"])):
                        p["reveal_until"] = now + REVEAL_HOLD_MS

        # Out-of-combat breathing. Runs after the medic zones so a zone heal and
        # the regen add up rather than fight; both clamp to max_hp.
        for p in self.players.values():
            if not p["alive"] or now - p["last_hit_ms"] < REGEN_DELAY_MS:
                continue
            cap = max_hp(self, p)
            if p["hp"] < cap:
                p["hp"] = min(cap, p["hp"] + (cap / REGEN_SECONDS) * dt)
                p["healed_at"] = now

        for p in self.players.values():
            if p["bot"]:
                self.outbox.extend(bots_mod.think(self, p, dt_ms))

        # One position sample per player per tick, which is what _hist_pos
        # rewinds through when a shot arrives.
        for p in self.players.values():
            p["hist"].append((now, p["pos"][0], p["pos"][1], p["pos"][2]))

    def drain(self):
        out = self.outbox
        self.outbox = []
        return out

    # ---------------------------------------------------------------- snapshot

    def status(self):
        remaining = 0.0
        if self.start_ms is not None:
            remaining = max(0.0, float(COMBAT["matchMs"]) - (now_ms() - self.start_ms))
        return {
            "t": "state", "tick": self.tick_count, "phase": self.phase,
            "s": list(self.scores), "limit": int(COMBAT["scoreLimit"]),
            "endsIn": int(remaining), "winner": self.winner,
        }

    def players_payload(self):
        now = now_ms()
        out = []
        for p in self.players.values():
            f = 0
            if p["flags"].get("crouch"):
                f |= 1
            if p["flags"].get("sprint"):
                f |= 2
            if p["flags"].get("move"):
                f |= 4
            # Bit 3 marks a shot inside the last tick-and-a-bit. Clients use it to
            # put a muzzle flash on somebody else's gun and to play that weapon's
            # own report from a distance; it is presentation only, and the bit is
            # simply absent from older clients' reading of the field.
            if p.get("last_shot") and now - p["last_shot"] < 120.0:
                f |= 8
            out.append({
                "i": p["id"], "n": p["name"], "tm": p["team"], "c": p["cls"], "w": p["weapon"],
                "hp": int(max(0, p["hp"])), "al": 1 if p["alive"] else 0,
                "p": [round(v, 2) for v in p["pos"]],
                # Monotonic accepted-shot sequence survives respawns. Unlike
                # the short flag pulse, slow weapons cannot disappear between
                # snapshots, and a repeated snapshot cannot replay a shot.
                "y": round(p["yaw"], 1), "pi": round(p["pitch"], 1), "f": f, "sq": p.get("shot_seq", 0),
                "rv": 1 if p["reveal_until"] > now else 0,
                "sp": 1 if p["suppress_until"] > now else 0,
                "sk": p["skin"],
                "k": p["kills"], "d": p["deaths"],
            })
        return out

    def me_payload(self, p):
        now = now_ms()
        return {
            "t": "me", "id": p["id"], "hp": int(max(0, p["hp"])),
            "hpMax": int(max_hp(self, p)),
            "mag": int(max(0, p["mag"])), "magMax": mag_size(p["weapon"]),
            "reserve": int(max(0, p["reserve"])),
            "reloadIn": int(max(0, p["reload_end"] - now)),
            "reloadTotal": int(p["reload_total"]),
            "reloading": 1 if p["reload_end"] > now else 0,
            "alive": 1 if p["alive"] else 0,
            "respawnIn": int(max(0, p["respawn_at"] - now)) if not p["alive"] else 0,
            "abilityIn": int(max(0, p["ability_ready"] - now)),
            "grenades": p["grenades"] if p["grenades"] > 0 or now < p["grenade_ready"] else int(combat.THROW["grenadeCharges"]),
            "grenadeIn": int(max(0, p["grenade_ready"]-now)) if p["grenades"] <= 0 else 0,
            "c": p["cls"], "w": p["weapon"],
            "team": p["team"], "nm": p["name"],
        }