"""Trench Front - aiohttp server.

One process, one port: serves public/ as static files, exposes shared/*.json to
the client, hosts the WebSocket at /ws and runs the authoritative match loop.

Run:  python server/server.py
Then: open http://127.0.0.1:8080

Windows notes: no add_signal_handler (raises NotImplementedError), no .ps1
launcher (execution policy), and every log line is deliberately ASCII-only
because the console codepage may be GBK.
"""

import asyncio
import ipaddress
import json
import re
import random
import socket
import sys
import time
import webbrowser
from collections import deque
from pathlib import Path

from aiohttp import WSMsgType, web

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
# The match rules and the room class live under public/ so that a static
# deployment (Vercel) carries them too: an offline match in the browser runs
# this very code under Pyodide. Nothing here is a copy.
ENGINE = PUBLIC / "engine"
SHARED = PUBLIC / "shared"
CHARS = SHARED / "characters"

sys.path.insert(0, str(ENGINE))

from combat import (COMBAT, DEFAULT_MAP_ID, MAP_BY_ID, map_meta,  # noqa: E402
                    set_map, validate_shared_data)
from game import Match  # noqa: E402
import room as room_mod  # noqa: E402
from room import (MAX_PLAYERS, ROOM_CODE_RE, ROOM_MIN_AGE,  # noqa: E402
                   ROOM_TTL, ROOM_TTL_SOLO, Room)

# The room class lives with the rules (public/engine/) so the same code also
# runs inside the browser's offline match; point its hooks at this process.
room_mod.other_live_rooms = lambda r: ROOMS.values()
room_mod.known_skin = lambda cid: known_skin(cid)
room_mod.log = lambda line: log(line)

# All interfaces: the host machine is reachable on 127.0.0.1 *and* on its LAN
# address, so other people on the same network can simply open the URL printed
# at startup. A hosting platform overrides both with environment variables
# (PORT is what Render/Railway/Fly/Heroku all inject); HOST stays 0.0.0.0 by
# default because a container that binds 127.0.0.1 is unreachable from outside.
import os

HOST = os.environ.get("TRENCH_HOST") or os.environ.get("HOST") or "0.0.0.0"
# An explicit port (env or --port) is honoured exactly and never probed: a
# platform routes one public port to it, so silently moving would be a 502.
_ENV_PORT = os.environ.get("PORT")
try:
    ENV_PORT = int(_ENV_PORT) if _ENV_PORT else None
except ValueError:
    ENV_PORT = None
START_PORT = ENV_PORT or 8080
PORT_SPAN = 1 if ENV_PORT else 20      # local dev still walks 8080, 8081, ...
MAX_MSG = 8192
CHAR_MAX_BYTES = 24 * 1024 * 1024
CHAR_SUFFIXES = {".glb", ".gltf"}


def log(*parts):
    sys.stdout.write("[trench] " + " ".join(str(p) for p in parts) + "\n")
    sys.stdout.flush()


async def _close_ws(ws):
    """Close a socket that has already been dropped from the lobby, quietly."""
    try:
        await ws.close()
    except (ConnectionResetError, RuntimeError, asyncio.CancelledError):
        pass


def lan_ips():
    """IPv4 addresses other machines on this network can reach us on.

    The default-route address is listed first: it is almost always the real LAN
    interface. getaddrinfo() then adds any extra NICs, which on a dev box
    includes Hyper-V / VMware / WSL adapters -- those cannot be told apart from
    the real one in code, so they are listed too rather than guessing a single
    address and being confidently wrong. Every step fails soft so an offline
    machine still serves localhost.
    """
    found = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))      # picks a route, sends nothing
            found.append(probe.getsockname()[0])
        finally:
            probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass

    out = []
    for raw in found:
        try:
            ip = ipaddress.IPv4Address(raw)
        except ipaddress.AddressValueError:
            continue
        if ip.is_loopback or ip.is_unspecified or ip.is_link_local:
            continue
        if raw not in out:
            out.append(raw)
    return out


# ------------------------------------------------------- shared character store
#
# Every uploaded rig lives as a single file under shared/characters/, described
# by an index.json manifest that is also the source of truth for the /api list.
# Uploads are unauthenticated: this is a LAN demo, the only guard is that the
# bytes really look like a glTF container.

CHAR_INDEX = {"characters": []}


def _char_index_load():
    try:
        raw = json.loads((CHARS / "index.json").read_text("utf-8"))
    except (OSError, ValueError):
        return []
    items = raw.get("characters") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return []
    return [m for m in items if isinstance(m, dict) and m.get("id")]


def _char_index_save():
    CHARS.mkdir(parents=True, exist_ok=True)
    text = json.dumps(CHAR_INDEX, ensure_ascii=False, indent=1)
    (CHARS / "index.json").write_text(text, "utf-8")


def _new_char_id():
    taken = {m["id"] for m in CHAR_INDEX["characters"]}
    while True:
        cid = "sk%08x" % random.getrandbits(32)
        if cid not in taken:
            return cid


def known_skin(cid):
    return any(m["id"] == cid for m in CHAR_INDEX["characters"])


def _key(raw):
    if not isinstance(raw, str):
        return ""
    return "".join(c for c in raw if c.isalnum() or c == "_")[:24]


def _clean_bones(raw):
    out = {}
    if isinstance(raw, dict):
        for k, v in list(raw.items())[:32]:
            k2 = _key(k)
            if k2 and isinstance(v, str) and v:
                out[k2] = v[:64]
    return out


def _clean_offsets(raw):
    out = {}
    if isinstance(raw, dict):
        for k, v in list(raw.items())[:32]:
            k2 = _key(k)
            if not k2 or not isinstance(v, (list, tuple)) or len(v) != 3:
                continue
            try:
                out[k2] = [max(-180.0, min(180.0, round(float(x), 2))) for x in v]
            except (TypeError, ValueError):
                continue
    return out


def _clean_num(raw, default, lo, hi):
    try:
        return max(lo, min(hi, float(raw)))
    except (TypeError, ValueError):
        return default


async def list_characters(request):
    return web.json_response({"characters": CHAR_INDEX["characters"]})


async def upload_character(request):
    reader = await request.multipart()
    meta_raw = None
    payload = None
    suffix = None
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "meta":
            meta_raw = await part.text()
        elif part.name == "model":
            suffix = Path(part.filename or "").suffix.lower()
            payload = await part.read()
        else:
            await part.read()

    if meta_raw is None or payload is None:
        return web.json_response({"ok": False, "error": "缺少 meta 或 model 字段"}, status=400)
    if suffix not in CHAR_SUFFIXES:
        return web.json_response({"ok": False, "error": "只支持 .glb / .gltf 文件"}, status=400)
    if not payload:
        return web.json_response({"ok": False, "error": "模型文件为空"}, status=400)
    if len(payload) > CHAR_MAX_BYTES:
        return web.json_response({"ok": False, "error": "文件过大（上限 24MB）"}, status=413)
    if suffix == ".glb" and payload[:4] != b"glTF":
        return web.json_response({"ok": False, "error": "不是有效的 GLB 文件"}, status=400)
    try:
        meta = json.loads(meta_raw)
    except ValueError:
        return web.json_response({"ok": False, "error": "meta 不是合法 JSON"}, status=400)
    if not isinstance(meta, dict):
        return web.json_response({"ok": False, "error": "meta 必须是 JSON 对象"}, status=400)

    cid = _new_char_id()
    CHARS.mkdir(parents=True, exist_ok=True)
    (CHARS / (cid + suffix)).write_bytes(payload)
    entry = {
        "id": cid,
        "name": str(meta.get("name") or "自定义角色")[:24],
        "author": str(meta.get("author") or "")[:16],
        "file": "/shared/characters/" + cid + suffix,
        "size": len(payload),
        "bones": _clean_bones(meta.get("bones")),
        "offsets": _clean_offsets(meta.get("offsets")),
        "scale": _clean_num(meta.get("scale"), 1.0, 0.2, 5.0),
        "rotY": _clean_num(meta.get("rotY"), 0.0, -180.0, 180.0),
        "at": int(time.time()),
    }
    CHAR_INDEX["characters"].append(entry)
    _char_index_save()
    log("skin  id=%s name=%s bytes=%d total=%d"
        % (cid, entry["name"].encode("ascii", "replace").decode(), len(payload),
           len(CHAR_INDEX["characters"])))
    return web.json_response({"ok": True, "meta": entry})


# ---------------------------------------------------------------- rooms
#
# A room is one match: its own players, bots, scores, map vote and sockets,
# addressed by an 8-digit code the host hands out. Solo play is simply a room
# nobody else is told about. Rooms live in memory only and are reclaimed once
# they have been empty for ROOM_TTL (ROOM_TTL_SOLO for practice rooms), so
# nothing needs a database.

MAX_ROOMS = 24
# How long an *empty* room survives. A multiplayer room is kept a couple of
# minutes so a refresh (or a quick alt-tab reload) lands back in it, but
# practice rooms are private by construction, so they go almost immediately --
# otherwise a few abandoned matches would fill MAX_ROOMS and lock everyone else
# out of hosting at all.


rooms = room_mod               # the module the Room class lives in
ROOMS = {}                 # code -> Room
CLIENT_ROOM = {}           # connection -> Room (websocket or PollClient)
SESSIONS = {}              # per-tab id -> (Room, connection), for reload eviction




def normalize_room_code(raw):
    """'1234 5678' / '1234-5678' / 12345678 -> '12345678', otherwise ''."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        raw = "%08d" % int(raw)
    if not isinstance(raw, str):
        return ""
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) != 8:
        return ""
    return digits if ROOM_CODE_RE.match(digits) else ""


def _new_room_code():
    for _ in range(400):
        code = "%08d" % random.randint(10000000, 99999999)
        if code not in ROOMS:
            return code
    return ""


def _reclaim_one_idle():
    """Free the most idle empty room. False if every room is occupied.

    Hitting the cap must not mean "come back later" while a dozen rooms sit
    empty for two minutes: the oldest empty one is worth less than the player
    standing in the menu right now.
    """
    idle = [r for r in ROOMS.values() if not r.sockets]
    if not idle:
        return False
    victim = min(idle, key=lambda r: r.empty_since if r.empty_since is not None else r.created)
    ROOMS.pop(victim.code, None)
    log("room  reclaimed idle %s for a new room (rooms=%d)" % (victim.code, len(ROOMS)))
    return True


def resolve_room(msg):
    """(room, error) for an incoming join: an existing code or a fresh room."""
    code = normalize_room_code(msg.get("room"))
    if not code:
        # No code: the host (or a solo player) is starting a room of their own.
        if len(ROOMS) >= MAX_ROOMS and not _reclaim_one_idle():
            return None, "toomany"
        code = _new_room_code()
        if not code:
            return None, "toomany"
        room = ROOMS[code] = Room(code)
        room.private = bool(msg.get("solo"))
        log("room  created %s%s (rooms=%d)"
            % (code, " private" if room.private else "", len(ROOMS)))
        return room, None
    room = ROOMS.get(code)
    if room is None:
        log("room  join refused, unknown code %s" % code)
        return None, "notfound"
    return room, None


def _evict_session(sid, keep):
    """Drop whatever connection this tab id still holds, in any room.

    A refresh opens its replacement socket before the old one has finished
    closing, so the lobby briefly holds two connections from the same tab. The
    id lives in sessionStorage: it survives a refresh yet differs per tab, so
    two tabs on one machine still count as two separate players.
    """
    if not sid:
        return
    prev = SESSIONS.get(sid)
    if prev is None:
        return
    room, client = prev
    if client is keep:
        return
    room.leave(client)
    CLIENT_ROOM.pop(client, None)
    asyncio.ensure_future(_close_ws(client))


async def leave_everywhere(client):
    """Disconnect a connection, wherever it joined (used by the reaper)."""
    room = CLIENT_ROOM.pop(client, None)
    if room is None:
        return
    room.leave(client)
    for sid, (_r, c) in list(SESSIONS.items()):
        if c is client:
            SESSIONS.pop(sid, None)


async def handle_client_message(client, data):
    """One decoded message from a player, whatever carried it here.

    Shared by the WebSocket handler and the HTTP long-poll fallback so both
    transports are the same game: join, ping, bot flaps and every gameplay
    action take the identical path. A connection is routed to its room here and
    nowhere else, which is what lets one process host several matches.
    """
    if not isinstance(data, dict):
        return
    kind = data.get("t")
    if kind == "join":
        _evict_session(str(data.get("sid") or "")[:40], client)
        room, why = resolve_room(data)
        if room is None:
            await _send_direct(client, {"t": "joinError", "why": why})
            return
        welcome = room.join(client, data)
        if welcome is None:
            return
        if welcome.get("t") == "joinError":
            await _send_direct(client, welcome)
            return
        CLIENT_ROOM[client] = room
        sid = str(data.get("sid") or "")[:40]
        if sid:
            SESSIONS[sid] = (room, client)
        await room._send(client, welcome)
        return
    room = CLIENT_ROOM.get(client)
    if room is not None:
        await room.handle(client, data)


async def _send_direct(client, payload):
    """Answer a connection that is not (or not yet) in a room."""
    try:
        await client.send_str(json.dumps(payload, separators=(",", ":")))
    except (ConnectionResetError, RuntimeError, asyncio.CancelledError):
        pass


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                await handle_client_message(ws, data)
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        await leave_everywhere(ws)
        _forget_client(ws)
    return ws


# ----------------------------------------------------------- long-poll transport
#
# Not every environment lets a browser open a WebSocket: a hosted preview that
# proxies the port can, and a plain HTTP reverse proxy in front of the game may
# refuse the Upgrade. The client tries /ws first and falls back to this, which
# carries exactly the same JSON messages over ordinary POSTs.
#
# The trick that keeps the rest of the server untouched: PollClient looks enough
# like a websocket (an object with async send_str and close) for the lobby, the
# match and every reply path to use it verbatim. Each POST hands over whatever
# the client has queued, then holds the response until something is available --
# so the game still gets pushed state at the normal rate instead of polling.

POLL_TIMEOUT = 1.5        # seconds a poll may wait for the first message
POLL_MAX_BATCH = 64       # messages per response
POLL_IDLE = 12.0          # no poll for this long -> treat as disconnected
POLL_MAX_WAITERS = 64     # poll clients allowed at once


class PollClient:
    def __init__(self, sid):
        self.sid = sid
        self.out = deque(maxlen=256)
        self.wake = asyncio.Event()
        self.seen = time.monotonic()

    async def send_str(self, text):
        self.out.append(text)
        self.wake.set()

    async def close(self):
        self.out.clear()
        self.wake.set()

    def drain(self):
        batch = []
        while self.out and len(batch) < POLL_MAX_BATCH:
            batch.append(self.out.popleft())
        if not self.out:
            self.wake.clear()
        return batch


POLL_CLIENTS = {}


def _poll_id(raw):
    if not isinstance(raw, str):
        return ""
    return "".join(c for c in raw if c.isalnum() or c in "-_")[:40]


async def poll(request):
    try:
        data = await request.json()
    except (ValueError, TypeError):
        return web.json_response({"ok": False, "error": "bad json"}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"ok": False, "error": "bad body"}, status=400)

    sid = _poll_id(data.get("sid"))
    if not sid:
        return web.json_response({"ok": False, "error": "missing sid"}, status=400)
    client = POLL_CLIENTS.get(sid)
    if client is None:
        if len(POLL_CLIENTS) >= POLL_MAX_WAITERS:
            return web.json_response({"ok": False, "error": "too many pollers"}, status=503)
        client = POLL_CLIENTS[sid] = PollClient(sid)
    client.seen = time.monotonic()

    # Everything the client queued since the last poll travels with this one.
    for item in list(data.get("msgs") or [])[:POLL_MAX_BATCH]:
        await handle_client_message(client, item)

    batch = client.drain()
    if not batch:
        # Nothing to say yet: hold the request open for a moment so state
        # arrives immediately instead of up to a poll interval late.
        try:
            await asyncio.wait_for(client.wake.wait(), timeout=POLL_TIMEOUT)
        except asyncio.TimeoutError:
            pass
        batch = client.drain()
    return web.json_response({"ok": True, "msgs": batch})


def _forget_client(client):
    CLIENT_ROOM.pop(client, None)
    for sid, (_room, c) in list(SESSIONS.items()):
        if c is client:
            SESSIONS.pop(sid, None)


async def room_reaper():
    """Reclaim rooms that have been empty for a while, and log the census."""
    while True:
        await asyncio.sleep(10.0)
        now = time.monotonic()
        for code, room in list(ROOMS.items()):
            if now - room.created < ROOM_MIN_AGE:
                continue
            if room.sockets:
                room.empty_since = None
                continue
            if room.empty_since is None:
                room.empty_since = now
            ttl = ROOM_TTL_SOLO if room.private else ROOM_TTL
            if now - room.empty_since > ttl:
                ROOMS.pop(code, None)
                log("room  reclaimed %s (rooms=%d)" % (code, len(ROOMS)))


async def poll_reaper():
    """Drop poll clients that stopped asking (closed tab, lost network)."""
    while True:
        await asyncio.sleep(3.0)
        now = time.monotonic()
        for sid, client in list(POLL_CLIENTS.items()):
            if now - client.seen > POLL_IDLE:
                POLL_CLIENTS.pop(sid, None)
                await leave_everywhere(client)
                _forget_client(client)
                log("poll  dropped stale sid=%s" % sid)


async def health(request):
    """Liveness for a hosting platform: proves the match loop is actually up.

    Deliberately cheap and dependency-free -- it is polled every few seconds by
    the platform's own health checker.
    """
    return web.json_response({
        "ok": True,
        "rooms": len(ROOMS),
        "maxRooms": MAX_ROOMS,
        "players": sum(r.match.human_count() for r in ROOMS.values()),
        "maps": len(MAP_BY_ID),
        "tickRate": COMBAT["tickRate"],
        "waiters": len(POLL_CLIENTS),
    })


async def list_rooms(request):
    """Open rooms, so the menu can show what is running without a database."""
    rooms = sorted((r.as_meta() for r in ROOMS.values()), key=lambda m: (-m["players"], m["code"]))
    return web.json_response({"rooms": rooms, "max": MAX_ROOMS})


async def index(request):
    return web.FileResponse(PUBLIC / "index.html")


# Content that is stable for a session: the 33 MB of models, the sounds and the
# vendored three.js. Served with a short max-age (and aiohttp's ETag, so the
# revalidation after it is a 304) because re-downloading all of it on every visit
# is what makes a hosted deployment feel slow. Code, JSON and HTML keep the
# no-store treatment above: they are small, and editing them must be visible on
# the very next reload.
CACHEABLE_PREFIXES = ("/models/", "/sounds/", "/vendor/", "/img/", "/motions/")
CACHE_MAX_AGE = 600


@web.middleware
async def no_store(request, handler):
    if request.method == "OPTIONS":
        # Preflight for the JSON POSTs (the polling fallback): answer it here so
        # every route has one, and let the real handlers stay untouched.
        resp = web.Response()
    else:
        resp = await handler(request)
    if not isinstance(resp, web.WebSocketResponse):
        if resp.status == 200 and request.path.startswith(CACHEABLE_PREFIXES):
            resp.headers["Cache-Control"] = "public, max-age=%d" % CACHE_MAX_AGE
        else:
            resp.headers["Cache-Control"] = "no-store, must-revalidate"
            resp.headers["Pragma"] = "no-cache"
        # The game can be opened from a preview pane whose page has an opaque
        # origin (sandboxed iframe). Without this header that frame refuses to
        # run its own module scripts or read its own JSON files, so nothing
        # loads at all. Nothing here is authenticated or cookie based, so a
        # wildcard gives away nothing the LAN demo does not already expose.
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


def create_app():
    # 1 MB is not enough for an uploaded rig; 32 MB covers a typical GLB.
    app = web.Application(middlewares=[no_store], client_max_size=1 << 25)
    # /ws must be registered before the static catch-all.
    app.router.add_get("/ws", ws_handler)
    app.router.add_post("/api/poll", poll)
    app.router.add_get("/api/rooms", list_rooms)
    app.router.add_get("/api/health", health)
    app.router.add_get("/api/characters", list_characters)
    app.router.add_post("/api/character", upload_character)
    app.router.add_static("/shared/", SHARED, show_index=False)
    app.router.add_get("/", index)
    app.router.add_static("/", PUBLIC, show_index=False)
    return app


async def game_loop():
    tick_ms = 1000.0 / float(COMBAT["tickRate"])
    state_every = max(1, int(round(float(COMBAT["tickRate"]) / float(COMBAT["stateRate"]))))
    nxt = time.monotonic()
    n = 0
    while True:
        nxt += tick_ms / 1000.0
        delay = nxt - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        else:
            nxt = time.monotonic()
        last = time.monotonic()
        # Every room gets its own authoritative tick; the sockets, scores, bots
        # and map votes are all room-scoped, so matches cannot bleed into each
        # other. Empty rooms cost one dictionary lookup.
        for room in list(ROOMS.values()):
            phase_before = room.match.phase
            room.match.tick(tick_ms)
            for ev in room.match.drain():
                await room.deliver(ev)
            # The gap between rounds is the only moment the map may change:
            # players are already being respawned, so a swap is never felt
            # mid-fight (and _apply_map refuses while another room is live).
            if phase_before == "ended" and room.match.phase == "live":
                for ev in room.on_new_round():
                    await room.deliver(ev)
        n += 1
        if n % state_every == 0:
            for room in list(ROOMS.values()):
                await room.broadcast_state()
        spent = (time.monotonic() - last) * 1000.0
        if spent > tick_ms * 4:
            log("WARN tick took %.1fms" % spent)


def _flag_value(name):
    """`--port 9000` / `--port=9000` from argv, or None."""
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == name and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return None


async def main():
    global START_PORT, PORT_SPAN
    cli_port = _flag_value("--port")
    if cli_port:
        try:
            START_PORT = int(cli_port)
            PORT_SPAN = 1          # explicit: never silently move
        except ValueError:
            log("ERROR --port needs a number, got %r" % cli_port)
            raise SystemExit(2)

    problems = validate_shared_data()
    if problems:
        for p in problems:
            log("PROBLEM:", p)
        raise SystemExit(1)

    CHAR_INDEX["characters"] = _char_index_load()
    log("characters ready: %d shared skin(s)" % len(CHAR_INDEX["characters"]))

    meta = map_meta()
    log("maps ready: %d registered, default=%s (%s)"
        % (len(MAP_BY_ID), meta["id"], meta["nameEn"]))

    app = create_app()
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()

    site = None
    port = None
    for candidate in range(START_PORT, START_PORT + PORT_SPAN):
        try:
            site = web.TCPSite(runner, HOST, candidate)
            await site.start()
            port = candidate
            break
        except OSError:
            continue
    if site is None:
        log("ERROR no free port in range %d-%d" % (START_PORT, START_PORT + PORT_SPAN - 1))
        raise SystemExit(1)

    asyncio.ensure_future(game_loop())
    asyncio.ensure_future(poll_reaper())
    asyncio.ensure_future(room_reaper())
    log("ready -> http://127.0.0.1:%d" % port)
    if ENV_PORT:
        # Deployed: the platform terminates TLS and proxies to this port, so a
        # LAN address would only confuse the log.
        log("deployed on port %d (PORT env); health at /api/health" % port)
    else:
        ips = lan_ips()
        for ip in ips:
            log("LAN   -> http://%s:%d" % (ip, port))
        if not ips:
            log("LAN   -> no non-loopback IPv4 found; check ipconfig")
        log("share the LAN url above; allow python through the firewall if asked")
        log("open two browser tabs on that URL for a real match; enable bots for solo play")
    print("Serving on http://127.0.0.1:%d  (Ctrl+C to stop)" % port)
    sys.stdout.flush()

    # --open is passed by the launcher .bat: the server is the only party that
    # knows which port it actually got (8080 can already be taken), so it opens
    # the right URL instead of a hard-coded one. A headless box simply fails
    # silently here, which is why this is best-effort.
    if "--open" in sys.argv:
        try:
            webbrowser.open("http://127.0.0.1:%d" % port)
            log("opened the browser at http://127.0.0.1:%d" % port)
        except Exception as exc:      # noqa: BLE001 - never let this stop the server
            log("could not open a browser: %s" % exc)

    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("stopped")