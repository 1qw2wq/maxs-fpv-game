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
import random
import socket
import sys
import time
import webbrowser
from collections import Counter, deque
from pathlib import Path

from aiohttp import WSMsgType, web

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SHARED = ROOT / "shared"
CHARS = SHARED / "characters"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from combat import (COMBAT, DEFAULT_MAP_ID, MAP_BY_ID, map_meta,  # noqa: E402
                    set_map, validate_shared_data)
from game import Match  # noqa: E402

# All interfaces: the host machine is reachable on 127.0.0.1 *and* on its LAN
# address, so other people on the same network can simply open the URL printed
# at startup.
HOST = "0.0.0.0"
START_PORT = 8080
MAX_PLAYERS = 32
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


class Lobby:
    def __init__(self):
        self.match = Match()
        self.sockets = {}          # websocket -> player id
        self.by_pid = {}           # player id -> websocket
        # Per-tab session id -> websocket. A refresh opens the new socket before
        # the old one has finished closing, so the lobby briefly holds two
        # connections from the same tab; this lets the new one evict its ghost.
        self.sessions = {}
        self.bots_on = False
        self.bot_target = 6
        # Map voting: one vote per connected human, settled during the gap
        # between rounds. Bots do not vote.
        self.votes = {}            # player id -> map id
        self.map_id = DEFAULT_MAP_ID

    # ------------------------------------------------------------- membership

    def join(self, ws, msg):
        if ws in self.sockets:
            return
        if self.match.human_count() >= MAX_PLAYERS:
            asyncio.ensure_future(ws.send_str(json.dumps({"t": "full"})))
            return
        # Evict this tab's stale socket before counting the room. A refresh
        # connects before the previous connection finishes closing, so without
        # this the ghost keeps the lobby "occupied" and the fresh pick is quietly
        # demoted to a between-rounds vote -- which is why reloading to change
        # the map sometimes had no effect at all. The id lives in sessionStorage:
        # it survives a refresh yet differs per tab, so two tabs on one machine
        # still count as two separate players.
        sid = str(msg.get("sid") or "")[:40]
        if sid:
            old = self.sessions.get(sid)
            if old is not None and old is not ws:
                self.leave(old)
                asyncio.ensure_future(_close_ws(old))
            self.sessions[sid] = ws
        raw_name = str(msg.get("name", "")).strip()[:16]
        name = raw_name or ("Soldier%02d" % (self.match.next_id,))
        # only ids that exist in the manifest are accepted: the field ends up in
        # every client's roster payload
        skin = str(msg.get("skin") or "")
        if skin and not known_skin(skin):
            skin = ""
        # A map change only ever happens between rounds, so a join can never
        # teleport someone mid-fight. The one exception is the first player in
        # an empty lobby, who picks the map outright.
        fresh = not self.sockets
        want = msg.get("map")
        if want not in MAP_BY_ID:
            want = self.map_id
        # Solo balancing flag; the last join wins and it clears when the lobby
        # empties, so a normal multi match is never affected.
        self.match.solo = bool(msg.get("solo"))
        if fresh:
            self._apply_map(want)
        p = self.match.add_player(name, ws, cls=str(msg.get("cls", "assault")),
                                  weapon=msg.get("weapon"), skin=skin)
        self.votes[p["id"]] = want
        self.sockets[ws] = p["id"]
        self.by_pid[p["id"]] = ws
        if self.match.solo and msg.get("bots"):
            self.bots_on = True
            self.bot_target = int(msg.get("botCount", 6))
        else:
            # Bots are a solo-only feature: a multiplayer join clears any AI
            # already in play, so a human match can never field bots.
            if self.bots_on:
                self.match.drop_bots()
            self.bots_on = False
        if self.bots_on:
            self.match.fill_bots(self.bot_target)
        meta = map_meta(self.map_id)
        log("join  id=%d name=%s team=%d cls=%s skin=%s map=%s players=%d"
            % (p["id"], name.encode("ascii", "replace").decode(), p["team"], p["cls"],
               p["skin"] or "-", meta["id"], len(self.match.players)))
        return {
            "t": "welcome", "id": p["id"], "team": p["team"], "name": name,
            "mapId": meta["id"], "map": meta["file"], "mapName": meta["name"],
            "scene": meta["scene"], "cfg": COMBAT, "tickRate": COMBAT["tickRate"],
            "spawn": [round(v, 2) for v in p["pos"]], "yaw": p["yaw"],
            "cls": p["cls"], "weapon": p["weapon"], "skin": p["skin"],
            "botsOn": self.bots_on,
            # Crates already standing, so joining mid-round still shows them.
            "fx": self.match.standing_crates(),
        }

    def leave(self, ws):
        pid = self.sockets.pop(ws, None)
        if pid is None:
            return
        for sid, sock in list(self.sessions.items()):
            if sock is ws:
                self.sessions.pop(sid, None)
        self.by_pid.pop(pid, None)
        self.votes.pop(pid, None)
        self.match.remove_player(pid)
        if self.match.human_count() == 0:
            self.match.drop_bots()
            self.bots_on = False
            self.match.solo = False
            self.votes.clear()
        log("leave id=%d players=%d" % (pid, len(self.match.players)))

    # ------------------------------------------------------------- map voting

    def _apply_map(self, map_id):
        """Swap the live map; caller decides who needs respawning."""
        mid, _meta = set_map(map_id)
        self.map_id = mid

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
        pick = self._resolve_vote()
        if pick == self.map_id:
            return []
        self._apply_map(pick)
        self.match.effects = []
        meta = map_meta(self.map_id)
        out = [{"to": None, "msg": {
            "t": "map", "id": meta["id"], "name": meta["name"],
            "map": meta["file"], "mapName": meta["name"], "scene": meta["scene"],
            "mapId": meta["id"],
        }}]
        for p in self.match.players.values():
            out.extend(self.match._spawn(p))
        log("map   round over -> %s (%s)" % (meta["id"], meta["nameEn"]))
        return out

    # ------------------------------------------------------------- transport

    async def _send(self, ws, payload):
        try:
            await ws.send_str(json.dumps(payload, separators=(",", ":")))
        except (ConnectionResetError, RuntimeError, asyncio.CancelledError):
            pass

    async def deliver(self, ev):
        to = ev.get("to")
        msg = ev.get("msg")
        if not msg:
            return
        if to is None:
            text = json.dumps(msg, separators=(",", ":"))
            for ws in list(self.sockets.keys()):
                try:
                    await ws.send_str(text)
                except (ConnectionResetError, RuntimeError):
                    pass
            return
        ws = self.by_pid.get(to)
        if ws is not None:
            await self._send(ws, msg)

    async def broadcast_state(self):
        base = self.match.status()
        base["ps"] = self.match.players_payload()
        text = json.dumps(base, separators=(",", ":"))
        for ws, pid in list(self.sockets.items()):
            try:
                await ws.send_str(text)
                p = self.match.players.get(pid)
                if p is not None:
                    await ws.send_str(json.dumps(self.match.me_payload(p),
                                                 separators=(",", ":")))
            except (ConnectionResetError, RuntimeError):
                pass


LOBBY = Lobby()


async def handle_client_message(client, data):
    """One decoded message from a player, whatever carried it here.

    Shared by the WebSocket handler and the HTTP long-poll fallback so both
    transports are the same game: join, ping, bot flaps and every gameplay
    action take the identical path.
    """
    if not isinstance(data, dict):
        return
    kind = data.get("t")
    if kind == "join":
        welcome = LOBBY.join(client, data)
        if welcome:
            await LOBBY._send(client, welcome)
        return
    if kind == "ping":
        await LOBBY._send(client, {"t": "pong", "c": data.get("c", 0)})
        pid = LOBBY.sockets.get(client)
        p = LOBBY.match.players.get(pid) if pid is not None else None
        if p is not None:
            try:
                rtt = float(data.get("rtt") or 0.0)
            except (TypeError, ValueError):
                rtt = 0.0
            # Clamped hard: an inflated self-reported ping would widen the
            # lag-compensation rewind window in the sender's favour.
            p["ping"] = max(0.0, min(240.0, rtt))
        return
    if client not in LOBBY.sockets:
        return
    if kind == "bots":
        # Solo-only, same rule as join: never let a multiplayer lobby spawn
        # bots through this path either.
        if not LOBBY.match.solo:
            return
        LOBBY.bots_on = bool(data.get("on"))
        try:
            LOBBY.bot_target = int(data.get("n", LOBBY.bot_target))
        except (TypeError, ValueError):
            pass
        if LOBBY.bots_on:
            LOBBY.match.fill_bots(LOBBY.bot_target)
        else:
            LOBBY.match.drop_bots()
        return
    pid = LOBBY.sockets[client]
    for ev in LOBBY.match.handle(pid, data):
        await LOBBY.deliver(ev)


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
        LOBBY.leave(ws)
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


async def poll_reaper():
    """Drop poll clients that stopped asking (closed tab, lost network)."""
    while True:
        await asyncio.sleep(3.0)
        now = time.monotonic()
        for sid, client in list(POLL_CLIENTS.items()):
            if now - client.seen > POLL_IDLE:
                POLL_CLIENTS.pop(sid, None)
                LOBBY.leave(client)
                log("poll  dropped stale sid=%s" % sid)


async def index(request):
    return web.FileResponse(PUBLIC / "index.html")


@web.middleware
async def no_store(request, handler):
    if request.method == "OPTIONS":
        # Preflight for the JSON POSTs (the polling fallback): answer it here so
        # every route has one, and let the real handlers stay untouched.
        resp = web.Response()
    else:
        resp = await handler(request)
    if not isinstance(resp, web.WebSocketResponse):
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
        phase_before = LOBBY.match.phase
        LOBBY.match.tick(tick_ms)
        n += 1
        for ev in LOBBY.match.drain():
            await LOBBY.deliver(ev)
        # The gap between rounds is the only moment the map may change: players
        # are already being respawned, so a swap is never felt mid-fight.
        if phase_before == "ended" and LOBBY.match.phase == "live":
            for ev in LOBBY.on_new_round():
                await LOBBY.deliver(ev)
        if n % state_every == 0:
            await LOBBY.broadcast_state()
        spent = (time.monotonic() - last) * 1000.0
        if spent > tick_ms * 4:
            log("WARN tick took %.1fms" % spent)


async def main():
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
    for candidate in range(START_PORT, START_PORT + 20):
        try:
            site = web.TCPSite(runner, HOST, candidate)
            await site.start()
            port = candidate
            break
        except OSError:
            continue
    if site is None:
        log("ERROR no free port in range %d-%d" % (START_PORT, START_PORT + 19))
        raise SystemExit(1)

    asyncio.ensure_future(game_loop())
    asyncio.ensure_future(poll_reaper())
    log("ready -> http://127.0.0.1:%d" % port)
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