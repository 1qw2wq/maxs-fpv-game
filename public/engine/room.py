"""One match: players, bots, scores, map vote and the messages around it.

This module is deliberately transport-free -- it never touches a socket. The
aiohttp host (server/server.py) drives it with real WebSocket and long-poll
clients; the browser host (public/engine/host.py, run under Pyodide) drives the
same class with a sink that collects the JSON it would have sent. That is what
makes an offline match on a static deployment (Vercel) behave exactly like one
on the server: there is only one implementation of a room.

The host fills in the three hooks at the bottom before the first join.
"""

import json
import random
import re
import time

# asyncio exists in both hosts (the aiohttp server and Pyodide), but only one of
# them can ever have a cancelled socket task: importing the name keeps this
# module importable everywhere without an undefined-name trap in the except.
try:
    from asyncio import CancelledError as _CancelledError
except ImportError:            # pragma: no cover - stdlib asyncio is always there
    class _CancelledError(Exception):
        pass
from collections import Counter

import combat
import game
from combat import COMBAT, DEFAULT_MAP_ID, MAP_BY_ID, map_meta, set_map
from game import Match

# A room is one match: its own players, bots, scores, map vote and sockets,
# addressed by an 8-digit code the host hands out. Solo play is simply a room
# nobody else is told about. Rooms live in memory only and are reclaimed once
# they have been empty for ROOM_TTL (ROOM_TTL_SOLO for practice rooms), so
# nothing needs a database.
MAX_PLAYERS = 32
# How long an *empty* room survives. A multiplayer room is kept a couple of
# minutes so a refresh (or a quick alt-tab reload) lands back in it, but
# practice rooms are private by construction, so they go almost immediately --
# otherwise a few abandoned matches would fill MAX_ROOMS and lock everyone else
# out of hosting at all.
ROOM_TTL = 120.0
ROOM_TTL_SOLO = 15.0
ROOM_MIN_AGE = 5.0         # never reclaim a room younger than this (join in flight)
ROOM_CODE_RE = re.compile(r"^\d{8}$")


def _bot_count(raw):
    """Clamped bot count; anything unparsable means the default of six."""
    try:
        return max(0, min(16, int(raw)))
    except (TypeError, ValueError):
        return 6


class Room:
    def __init__(self, code):
        self.code = code
        self.match = Match()
        self.sockets = {}          # connection (websocket or PollClient) -> player id
        self.by_pid = {}           # player id -> connection
        self.bots_on = False
        self.bot_target = 6
        # Map voting: one vote per connected human, settled during the gap
        # between rounds. Bots do not vote.
        self.votes = {}            # player id -> map id
        self.map_id = DEFAULT_MAP_ID
        self.created = time.monotonic()
        self.empty_since = time.monotonic()
        self.rounds = 0
        # A room started without a code by a solo player is private: nobody else
        # can even reach it, so it is reclaimed as soon as its player is gone.
        self.private = False

    # ------------------------------------------------------------- membership

    def join(self, client, msg):
        if client in self.sockets:
            return None
        if self.match.human_count() >= MAX_PLAYERS:
            return {"t": "joinError", "why": "full"}
        # The map change can only happen between rounds, so a join can never
        # teleport someone mid-fight. The one exception is the first player in
        # an empty room, who picks the map outright -- and even that waits its
        # turn when another room is mid-round (the map is one global in
        # combat.py; see _apply_map).
        fresh = not self.sockets
        want = msg.get("map")
        if want not in MAP_BY_ID:
            want = self.map_id
        if fresh:
            self._apply_map(want)
        else:
            self.map_id = map_meta()["id"]      # follow whatever is actually live
        raw_name = str(msg.get("name", "")).strip()[:16]
        name = raw_name or ("Soldier%02d" % (self.match.next_id,))
        # only ids that exist in the manifest are accepted: the field ends up in
        # every client's roster payload
        skin = str(msg.get("skin") or "")
        if skin and not known_skin(skin):
            skin = ""
        # Solo balancing flag; the last join wins and it clears when the room
        # empties, so a normal multi match is never affected.
        self.match.solo = bool(msg.get("solo"))
        p = self.match.add_player(name, client, cls=str(msg.get("cls", "assault")),
                                  weapon=msg.get("weapon"), skin=skin)
        self.votes[p["id"]] = want
        self.sockets[client] = p["id"]
        self.by_pid[p["id"]] = client
        self.empty_since = None
        if self.match.solo and msg.get("bots"):
            self.bots_on = True
            self.bot_target = _bot_count(msg.get("botCount", 6))
        else:
            # Bots are a solo-only feature: a multiplayer join clears any AI
            # already in play, so a human match can never field bots.
            if self.bots_on:
                self.match.drop_bots()
            self.bots_on = False
        if self.bots_on:
            self.match.fill_bots(self.bot_target)
        meta = map_meta(self.map_id)
        log("join  room=%s id=%d name=%s team=%d cls=%s skin=%s map=%s players=%d"
            % (self.code, p["id"], name.encode("ascii", "replace").decode(), p["team"],
               p["cls"], p["skin"] or "-", meta["id"], len(self.match.players)))
        return {
            "t": "welcome", "id": p["id"], "team": p["team"], "name": name,
            "room": self.code,
            "mapId": meta["id"], "map": meta["file"], "mapName": meta["name"],
            "scene": meta["scene"], "cfg": COMBAT, "tickRate": COMBAT["tickRate"],
            "spawn": [round(v, 2) for v in p["pos"]], "yaw": p["yaw"],
            "cls": p["cls"], "weapon": p["weapon"], "skin": p["skin"],
            "botsOn": self.bots_on,
            # Existing clouds, fire, crates and pending flights retain their age.
            "fx": self.match.standing_crates(),
        }

    def leave(self, client):
        pid = self.sockets.pop(client, None)
        if pid is None:
            return
        self.by_pid.pop(pid, None)
        self.votes.pop(pid, None)
        self.match.remove_player(pid)
        if self.match.human_count() == 0:
            self.match.drop_bots()
            self.bots_on = False
            self.match.solo = False
            self.votes.clear()
            self.empty_since = time.monotonic()
        log("leave room=%s id=%d players=%d" % (self.code, pid, len(self.match.players)))

    # ------------------------------------------------------- message handling

    async def handle(self, client, data):
        if client not in self.sockets:
            return
        kind = data.get("t")
        if kind == "ping":
            await self._send(client, {"t": "pong", "c": data.get("c", 0)})
            pid = self.sockets.get(client)
            p = self.match.players.get(pid) if pid is not None else None
            if p is not None:
                try:
                    rtt = float(data.get("rtt") or 0.0)
                except (TypeError, ValueError):
                    rtt = 0.0
                # Clamped hard: an inflated self-reported ping would widen the
                # lag-compensation rewind window in the sender's favour.
                p["ping"] = max(0.0, min(240.0, rtt))
            return
        if kind == "bots":
            # Solo-only, same rule as join: never let a multiplayer room spawn
            # bots through this path either.
            if not self.match.solo:
                return
            self.bots_on = bool(data.get("on"))
            self.bot_target = _bot_count(data.get("n", self.bot_target))
            if self.bots_on:
                self.match.fill_bots(self.bot_target)
            else:
                self.match.drop_bots()
            return
        pid = self.sockets[client]
        for ev in self.match.handle(pid, data):
            await self.deliver(ev)

    # ------------------------------------------------------------- map voting

    def _apply_map(self, map_id):
        """Swap the live map when it is safe; otherwise stay where everyone is.

        combat.py holds exactly one live map for the whole process (collision,
        spawns and navmesh all read it), so a room may only move it while no
        other room is mid-round -- a change would otherwise rebuild the floor
        under someone else's firefight.
        """
        if not self._may_change_map():
            self.map_id = map_meta()["id"]
            log("map   room=%s wants %s but another room is live -> staying on %s"
                % (self.code, map_id, self.map_id))
            return
        mid, _meta = set_map(map_id)
        self.map_id = mid

    def _may_change_map(self):
        return not any(r is not self and r.match.phase == "live"
                   for r in other_live_rooms(self))

    def _resolve_vote(self):
        """Highest-vote map; ties broken at random. Current map on no votes."""
        live = {pid: m for pid, m in self.votes.items() if pid in self.by_pid}
        if not live:
            return self.map_id
        counts = Counter(live.values())
        top = max(counts.values())
        return random.choice([m for m, n in counts.items() if n == top])

    def on_new_round(self):
        """Settle the vote as a round ends. Returns the events to deliver."""
        self.rounds += 1
        pick = self._resolve_vote()
        if pick == self.map_id:
            return []
        self._apply_map(pick)
        if pick != self.map_id:
            # Another room was live: keep playing where we are, re-vote next gap.
            return []
        self.match.effects = []
        meta = map_meta(self.map_id)
        out = [{"to": None, "msg": {
            "t": "map", "id": meta["id"], "name": meta["name"],
            "map": meta["file"], "mapName": meta["name"], "scene": meta["scene"],
            "mapId": meta["id"], "room": self.code,
        }}]
        for p in self.match.players.values():
            out.extend(self.match._spawn(p))
        log("map   room=%s round over -> %s (%s)" % (self.code, meta["id"], meta["nameEn"]))
        return out

    # ------------------------------------------------------------- transport

    async def _send(self, client, payload):
        try:
            await client.send_str(json.dumps(payload, separators=(",", ":")))
        except (ConnectionResetError, RuntimeError, _CancelledError):
            pass

    async def deliver(self, ev):
        to = ev.get("to")
        msg = ev.get("msg")
        if not msg:
            return
        if to is None:
            text = json.dumps(msg, separators=(",", ":"))
            for client in list(self.sockets.keys()):
                # A frame meant for everyone is offered to `send_all` first: the
                # in-page relay host needs to know it can send this one out once
                # (see its Sink), while a websocket just takes the string.
                try:
                    await getattr(client, "send_all", client.send_str)(text)
                except (ConnectionResetError, RuntimeError):
                    pass
            return
        client = self.by_pid.get(to)
        if client is not None:
            await self._send(client, msg)

    async def broadcast_state(self):
        if not self.sockets:
            return
        base = self.match.status()
        base["ps"] = self.match.players_payload()
        base["room"] = self.code
        text = json.dumps(base, separators=(",", ":"))
        for client, pid in list(self.sockets.items()):
            try:
                await getattr(client, "send_all", client.send_str)(text)
                p = self.match.players.get(pid)
                if p is not None:
                    await client.send_str(json.dumps(self.match.me_payload(p),
                                                     separators=(",", ":")))
            except (ConnectionResetError, RuntimeError):
                pass

    def as_meta(self):
        """Public view of the room, for the menu's room list."""
        return {
            "code": self.code,
            "players": sum(1 for p in self.match.players.values() if not p.get("bot")),
            "max": MAX_PLAYERS,
            "phase": self.match.phase,
            "mapId": self.map_id,
            "bots": self.bots_on,
        }


# ------------------------------------------------------------------- hooks
#
# Defaults suit a lone room in a browser tab; server.py overrides all three.


def other_live_rooms(room):
    """Other rooms whose live match a map change would disturb."""
    return ()


def known_skin(cid):
    """Is `cid` a character the clients can actually load?"""
    return bool(cid)


def log(line):
    """Host logger; silent by default."""
