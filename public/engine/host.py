"""Run one room inside the page: the server's own code, with its socket removed.

A static deployment (Vercel and friends) can serve files but cannot run the
Python server, so the browser runs it instead: this module drives exactly the
same `room.Room` the aiohttp host drives, with `Sink` standing in for a socket.
Everything the room would have sent is collected as JSON strings and handed
back to `public/js/local.js`, which dispatches it into the client's ordinary
message switch -- the same welcome/state/me/chat/kill messages a real match
sends. Bots, ballistics, abilities, scoring and the map vote are therefore the
server's code, not a second implementation that could drift from it.

`RelayHost` is the same thing with several sockets: the page that created the
room serves it to the other players through public/js/relay.js, so a static
deployment can host a real multiplayer match without any backend of its own.
The host's own player keeps the plain `Sink`; every guest gets a `RelaySink`
that tags what the room sends it with that guest's session id, and the page
forwards each tag to its owner.

Loaded by `public/js/local.js` under Pyodide (`import host` with
`/public/engine` on sys.path). Nothing here is used by the Python server.
"""

import json

import combat
from combat import COMBAT
from room import Room


class Sink:
    """Stands in for the client socket: what the room sends lands in `out`."""

    def __init__(self):
        self.out = []
        self.closed = False

    async def send_str(self, text):
        self.out.append(text)


class Host:
    """One offline room, stepped from JavaScript."""

    def __init__(self):
        self.room = None
        self.sink = None
        self.cfg = None
        self.tick = 0
        self.state_every = 1
        self.notes = []

    # ------------------------------------------------------------------- setup

    @staticmethod
    def _run(coro):
        """Drive one room coroutine to completion, without an event loop.

        room.py keeps its network host's async signatures, but the only thing
        it ever awaits is this file's sink, which appends to a list and returns
        at once -- so the coroutine can simply be stepped to the end. Pyodide
        runs a wasm build where a real event loop would need WebAssembly stack
        switching, which browsers only have behind a flag; skipping asyncio
        sidesteps that entirely.

        The guards matter: if an edit ever makes the room await something that
        really suspends, this raises with the awaitable named instead of
        hanging the page.
        """
        if not hasattr(coro, "send"):
            raise RuntimeError("room coroutine expected, got %r" % (coro,))
        try:
            pending = coro.send(None)
        except StopIteration as done:
            return done.value
        raise RuntimeError("the room suspended on %r -- it must not await real I/O"
                           % (pending,))

    def start(self, text):
        """Create the room and join it. `text` is the client's own join message."""
        msg = json.loads(text)
        self.cfg = COMBAT
        # No code: the room is not reachable from anywhere else, and the client
        # hides the room chip when there is nothing to share.
        self.room = Room(code="")
        self.sink = Sink()
        self.tick = 0
        # Mirrors the server's own loop: a state broadcast every stateRate ticks,
        # at tickRate ticks a second.
        self.state_every = max(1, int(round(float(COMBAT["tickRate"]) / float(COMBAT["stateRate"]))))
        welcome = self.room.join(self.sink, msg)
        if welcome is None:
            welcome = {"t": "joinError", "why": "bad"}
        out = [json.dumps(welcome, separators=(",", ":"), ensure_ascii=False)]
        return json.dumps(out, ensure_ascii=False)

    # ------------------------------------------------------------ game messages

    def command(self, text):
        """One message from the page -> whatever the room answers with."""
        if self.room is None:
            return "[]"
        msg = json.loads(text)
        self.sink.out = []
        self._run(self.room.handle(self.sink, msg))
        out, self.sink.out = self.sink.out, []
        return json.dumps(out, ensure_ascii=False)

    # ------------------------------------------------------------- the 30 Hz tick

    def step(self, dt_ms):
        """Advance the match and hand back everything it wants to send.

        Order matches server.py's game loop: one authoritative tick, its events
        delivered, a new round settled when one just ended, and -- every
        `state_every` ticks -- the state snapshot followed by this player's own
        private payload.
        """
        if self.room is None:
            return "[]"
        self.tick += 1
        self.sink.out = []
        phase_before = self.room.match.phase
        self.room.match.tick(dt_ms)
        self._run(self._deliver_events())
        if phase_before == "ended" and self.room.match.phase == "live":
            self._run(self._deliver(self.room.on_new_round()))
        if self.tick % self.state_every == 0:
            self._run(self.room.broadcast_state())
        out, self.sink.out = self.sink.out, []
        return json.dumps(out, ensure_ascii=False)

    async def _deliver_events(self):
        for ev in self.room.match.drain():
            await self.room.deliver(ev)

    async def _deliver(self, events):
        for ev in events:
            await self.room.deliver(ev)

    # ------------------------------------------------------------------ readout

    def status(self):
        """Diagnostics for the HUD: room code (none), players, bots, phase."""
        if self.room is None:
            return "{}"
        m = self.room.match
        return json.dumps({
            "code": self.room.code,
            "players": len(m.players),
            "humans": m.human_count(),
            "bots": sum(1 for p in m.players.values() if p["bot"]),
            "phase": m.phase,
            "map": combat.CUR_MAP_ID,
            "tickRate": COMBAT["tickRate"],
            "tick": self.tick,
        }, ensure_ascii=False)



# What the host's own player is tagged with. It is not an empty string: the
# empty tag means "this frame went to every seat", which is how the page knows
# what to publish to the room rather than keep to itself.
HOST_SEAT = "@host"


class RelaySink:
    """Stands in for one player's socket -- remote guests and the host alike.

    The room treats it exactly like a websocket; the difference is that what it
    "sends" is tagged with the session id it belongs to, so the page can hand
    each guest their own frames and publish the rest (the room's broadcast
    frames, which every seat received, are tagged with an empty id).
    """

    def __init__(self, sid, collector):
        self.sid = sid
        self.out = collector      # shared list of [sid, text]

    async def send_str(self, text):
        """A frame for this seat alone."""
        self.out.append([self.sid, text])

    async def send_all(self, text):
        """The room offered a frame that goes to every seat (see room.deliver)."""
        self.out.append(["", text])


class RelayHost:
    """One room, several browsers, hosted by whoever created it.

    The host's own player is a plain `Sink`; every guest is a `RelaySink`. Both
    append to the same list, so a single `step()` returns everything the room
    wants to send to everyone, tagged by recipient.
    """

    def __init__(self):
        self.room = None
        self.sink = None
        self.out = []
        self.sinks = {}           # session id -> RelaySink
        self.tick = 0
        self.state_every = 1
        self.cfg = COMBAT
        self.code = ""
        self.notes = []

    # ------------------------------------------------------------------- setup

    @staticmethod
    def _run(coro):
        """Same trick as Host._run: the room must not await real I/O."""
        if not hasattr(coro, "send"):
            raise RuntimeError("room coroutine expected, got %r" % (coro,))
        try:
            pending = coro.send(None)
        except StopIteration as done:
            return done.value
        raise RuntimeError("the room suspended on %r -- it must not await real I/O"
                           % (pending,))

    def _drain(self, extra=None):
        """Everything collected since the last call, as JSON, then clear.

        A frame addressed to everyone (tagged with an empty id) reached every
        seat, so it only has to travel once: duplicates are dropped here rather
        than sent per player. Anything a single seat received keeps its tag.
        """
        rows = list(self.out)
        del self.out[:]
        for row in extra or ():
            rows.append(row)
        out = []
        sent = set()
        for sid, text in rows:
            if sid == "":
                if text in sent:
                    continue
                sent.add(text)
            out.append([sid, text])
        return json.dumps(out, ensure_ascii=False)

    def _open_room(self, code):
        self.code = str(code or "")
        self.room = Room(code=self.code)
        self.sink = RelaySink(HOST_SEAT, self.out)
        self.sinks = {}
        self.tick = 0
        self.state_every = max(1, int(round(float(COMBAT["tickRate"]) / float(COMBAT["stateRate"]))))

    def start(self, text, code=""):
        """The host's own join: it opens the room the guests will be sent."""
        self._open_room(code)
        welcome = self.room.join(self.sink, json.loads(text))
        if welcome is None:
            welcome = {"t": "joinError", "why": "bad"}
        return self._drain([[HOST_SEAT, json.dumps(welcome, separators=(",", ":"), ensure_ascii=False)]])

    # -------------------------------------------------------------------- guests

    def join(self, sid, text):
        """A guest joins. Its welcome (or refusal) is addressed to that guest."""
        sid = str(sid)
        if self.room is None:
            return self._drain([[sid, json.dumps({"t": "joinError", "why": "closed"})]])
        if sid in self.sinks:
            return "[]"        # a retransmit of a join already handled
        sink = RelaySink(sid, self.out)
        self.sinks[sid] = sink
        welcome = self.room.join(sink, json.loads(text))
        if welcome is None:
            return self._drain()
        return self._drain([[sid, json.dumps(welcome, separators=(",", ":"), ensure_ascii=False)]])

    def command(self, sid, text):
        """One message from one guest."""
        sink = self.sinks.get(str(sid))
        if self.room is None or sink is None:
            return "[]"
        self._run(self.room.handle(sink, json.loads(text)))
        return self._drain()

    def leave(self, sid):
        """A guest went away (said goodbye, or stopped answering)."""
        sink = self.sinks.pop(str(sid), None)
        if sink is not None and self.room is not None:
            self.room.leave(sink)
        return self._drain()

    # ------------------------------------------------------------- the 30 Hz tick

    def step(self, dt_ms):
        """Advance the match; return every frame, tagged with its recipient."""
        if self.room is None:
            return "[]"
        self.tick += 1
        phase_before = self.room.match.phase
        self.room.match.tick(dt_ms)
        for ev in self.room.match.drain():
            self._run(self.room.deliver(ev))
        if phase_before == "ended" and self.room.match.phase == "live":
            for ev in self.room.on_new_round():
                self._run(self.room.deliver(ev))
        if self.tick % self.state_every == 0:
            # As on the server: one state frame for everyone, then each player's
            # own private payload (sinks tag them, so nothing is misrouted).
            self._run(self.room.broadcast_state())
        return self._drain()

    # ------------------------------------------------------------------ readout

    def status(self):
        if self.room is None:
            return "{}"
        m = self.room.match
        return json.dumps({
            "code": self.room.code,
            "players": len(m.players),
            "humans": m.human_count(),
            "bots": sum(1 for p in m.players.values() if p["bot"]),
            "phase": m.phase,
            "map": combat.CUR_MAP_ID,
            "tickRate": COMBAT["tickRate"],
            "tick": self.tick,
            "relay": True,
        }, ensure_ascii=False)


_host = Host()
_relay = RelayHost()
