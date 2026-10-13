"""Run one room inside the page: the server's own code, with its socket removed.

A static deployment (Vercel and friends) can serve files but cannot run the
Python server, so the browser runs it instead: this module drives exactly the
same `room.Room` the aiohttp host drives, with `Sink` standing in for a socket.
Everything the room would have sent is collected as JSON strings and handed
back to `public/js/local.js`, which dispatches it into the client's ordinary
message switch -- the same welcome/state/me/chat/kill messages a real match
sends. Bots, ballistics, abilities, scoring and the map vote are therefore the
server's code, not a second implementation that could drift from it.

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


_host = Host()
