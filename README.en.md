# Trench Front 堑壕前线

A WW1-themed browser FPS: online team deathmatch over WebSocket, four classes (Assault / Medic /
Support / Scout), three weapons each, and every playable character is an **anime-style girl**
(semi-realistic proportions, roughly 5.7 heads tall).

No build step: the client is plain ES modules with an import map, and the server is one Python
process that serves both the static files and the WebSocket. **A backend is optional**: on a
pure static host (Vercel, any web server) the page loads the very same server code into the
browser with **Pyodide**, so solo-with-bots matches run exactly as they do against a real
server — see *Deployment → Vercel*.

> 中文说明见 [README.md](README.md)。

---

## Interface language

The whole interface — menu, class and weapon cards, tutorial, HUD, scoreboard, death and result
panels, settings — is **bilingual (简体中文 / English)** and switches at runtime:

| How | What it does |
| --- | --- |
| **EN / 中文 chip** in the top-right corner of the main menu | Flips to the other language, instantly and everywhere |
| **Settings → Interface language** (`中文` / `English` buttons) | Same switch, next to the character-rig tools |
| `https://your-site/?lang=en` or `?lang=zh` | Forces a language for that visit |
| Nothing at all | First visit follows the browser: a `zh`-preferring browser gets Chinese, everyone else gets English |

Your choice is remembered in `localStorage` (`tf.lang`) and applied again on the next visit.
Names and descriptions come from the data files, which carry both spellings
(`name` / `nameEn`, `desc` / `descEn`, …), so weapon, class, team and map names translate too —
class and weapon cards deliberately keep the *other* language on their second line, so both
spellings are always on screen. Switching back to Chinese renders exactly what a Chinese visitor
sees, character for character.

(The developer animation lab at `public/anim-lab.html` is a build-time tool rather than part of the
game, and is not translated.)

---

## Running it

You need **Python 3.10+** and **aiohttp** (no Node.js, no bundler).

**Easiest: double-click `启动服务器.bat` in the project root.** It installs aiohttp on first run,
starts the server and **opens the game in your default browser** — no URL to type. The same
window prints both the local and the LAN address. That window has nothing to do with your
editor; **closing the editor does not stop the server** — only closing the console window or
`Ctrl+C` does. To keep a match running for a while, start it this way rather than with the
editor's Run button. (If the port is taken the server walks up to the next free one, and the
browser still opens the right address because the server prints it itself.)

By hand (equivalent; `--open` is optional):

```bash
pip install aiohttp
python server/server.py --open
```

It prints the local address and a LAN address you can hand out:

```
[trench] ready -> http://127.0.0.1:8080
[trench] LAN   -> http://192.168.1.23:8080
[trench] share the LAN url above; allow python through the firewall if asked
```

Open `http://127.0.0.1:8080`. The default port is 8080 and it walks up to 8081, 8082, … when the
port is busy (**the console prints the real port**). `Ctrl+C` stops it.

### LAN play and room codes

The server listens on every interface, so any other device on the same network can simply open
the printed `LAN` URL (`http://192.168.1.23:8080`) — nothing else to configure.

In multiplayer, players are grouped by an **8-digit room code** and rooms never see each other:

- **Create a room**: the server hands out an 8-digit code, shown in the top-right corner for the
  whole match (`1958 0121` style, spaced so it can be read out loud). Send it to your friends.
- **Join a room**: pick *Join with code*, type the host's 8 digits (spaces optional). A code that
  does not exist says so instead of dropping you into somebody else's match.
- The menu remembers recently visited codes for one-click re-entry, and lists the **public rooms**
  that are currently open (players / map / phase).
- Only players in the same room can see or shoot each other; scores and scoreboards are per room.
- The server runs **one map at a time** (there is a single world state in
  `public/engine/combat.py`). If another room is playing a different map, yours keeps the current
  one for that round and the top of the screen says so explicitly — it never changes map behind
  your back. The next round after both rooms stop uses the map you picked.
- When the host leaves and a room empties, the code survives for 2 minutes (long enough to
  refresh and come back); solo practice rooms are reclaimed after 15 seconds. When the room limit
  (24) is reached the server reclaims the least recently used *empty* room instead of turning
  players away — you only get "too many rooms" when 24 rooms have real people in them.
- **Windows firewall**: the first run asks whether Python may use the network — click **Allow**.
  "Cancel" leaves other devices unable to connect, which is by far the most common "my friend
  can't join" cause. Fix it under *Windows Security → Firewall & network protection → Allow an
  app through firewall*, and tick Python.
- The console lists **every** non-loopback IPv4 address, so a machine with VMware / Hyper-V / WSL
  shows virtual adapters too. Compare with `ipconfig` and hand out the Wi-Fi or Ethernet one.
- Campus and public Wi-Fi networks often have **AP isolation** (devices cannot see each other).
  In that case let the host create a hotspot, have everyone join it, and open the address again.
- If the port walked up, tell people the **actual** port (`http://192.168.1.23:8081`).
- The **server address** field in the menu is empty by default, which means "wherever this page
  came from" and is what you want almost always. Type an `IP` or `IP:port` only when you are on a
  stale address or a local copy; a wrong address falls back to the page and the menu reports what
  it actually tried.
- Security note: with the server listening on every interface, the unauthenticated character
  upload endpoint (24 MB per file) is open to the whole subnet — do not leave it running on a
  network you do not trust.
- Two tabs on one machine play each other just fine.

### Multiplayer on a static host (Vercel and friends, no server at all)

A static upload has no server process, but **multiplayer still works directly**: the room runs in
the browser of **whoever created it** (the same in-page Pyodide engine solo uses) and the others
connect straight to it. Nothing goes through a third-party service — no relay, no account, no key:

- **Two tabs of one browser**: press *Create room*, then type the 8-digit code into another tab
  (*Join with code*) and deploy. Both tabs must use the **same origin and browser storage partition**
  (not different Vercel deployment URLs or a normal/private window pair). They use `BroadcastChannel`.
- **Two different computers**: use *Invite a friend*. The host presses *Create an invite code*
  (a long piece of text starting with `TFi1.`) and sends it over; the friend's page takes it with
  *Join with an invite code* and produces an answer code (`TFa1.`), which goes back to the host and
  is pasted into the same box (*Pair up*). That builds a **direct WebRTC data channel** between the
  two pages (`js/p2p.js`); the match traffic only ever travels over it. **Pair up reports success only
  after the data channel is open.** Start the host's match, then deploy the guest; joins retry for up
  to 30 seconds while the host's engine loads. Generate a separate invite for each friend.
  Without external services, this requires a network that allows a direct connection (normally LAN
  or reachable public addresses). For different home networks, **both players** can enable
  *Different networks* **before generating their codes**, adding an optional external STUN service.
  STUN helps discover addresses; it does not relay gameplay or guarantee a connection. Symmetric NAT,
  blocked UDP or restrictive firewalls can still require **TURN**, which is **not provided by Vercel**.
  A Vercel-only deployment cannot guarantee multiplayer across those networks.
- **The room code exists the moment you press Create room** (it no longer waits for the in-page
  engine to boot). It shows in the top-right HUD chip and on the class screen, and **clicking the chip
  copies an invite link** (`https://your-site/?code=1958 0121`) that pre-fills the room code. A short
  room code/link alone only connects tabs in the same browser storage partition; a different
  computer still needs the invite/answer exchange.
- **The host's browser is the authority for that match**: hits, score, respawns and the map are all
  decided there; the others are clients. That is why **every host can pick their own map and several
  rooms can run different maps at the same time** — something the Python server cannot do, since
  `combat.py` holds one world state per process.
- **Pause and leaving**: press **Esc** for the menu. *Carry on* returns to the fight (while paused the
  whole match on the host's machine stands still, and the others are told so), *Invite a friend* hands
  out an invite code on the spot, and *Leave the match* goes back to the menu (the host's room closes
  with it and the others are told). Esc can never trap you in a match.
- Chat, scoreboard, kill feed and hit markers work exactly as on the LAN. If the host closes the
  page, everyone else is told *lost contact with the host* and can rejoin another room from the menu.
- **A relay of your own is still possible**: add `?relay=wss://host:port/mqtt` to the URL (an internal
  mosquitto / EMQX / HiveMQ), or pin it with `localStorage.setItem('tf.relay.broker', 'wss://…')`.
  Nothing outside is used by default, so the page works the same with no relay in sight.
- **When something looks wrong, open `/debug.html`**: it shows what each of the three `/api/*`
  endpoints returns, what this browser can do (WebRTC / BroadcastChannel / WebAssembly…), the current
  multiplayer state, a **local peer-to-peer self-test** (two WebRTC connections exchanging a line) and
  a report you can copy.
- Want to try "one host plus several players" on a single machine? Open a few tabs: create the room
  in the first, join with the code in the others. A real server (next section) is still the better
  answer when you want a permanent lobby and a shared character library.

### Running inside a restrictive browser environment

The game needs no plugins, but two browser environments restrict pages and both are handled:

- **Mouse look is native pointer lock only**: click the game view to capture the mouse. Moving the
  mouse turns the camera; **Esc releases the mouse and opens the pause menu**. Clicking to continue
  requests native lock again. There is **no cursor steering, edge turning or drag-to-aim fallback**.
  Failed requests can be retried on the next click; temporary failures do not permanently disable
  pointer lock. Blur, Esc and leaving a match clear held input and cancel ability charging.
- **Embedded pages / previews**: pointer lock works in an iframe **when the parent permits it**.
  If you own the embed, include `allow-pointer-lock` in its sandbox permissions, for example:

  ```html
  <iframe src="https://your-game.vercel.app/"
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"></iframe>
  ```

  If the parent preview forbids pointer lock, the game leaves the mouse free and shows a retry /
  **Open in new tab** action instead of switching controls. A child page cannot override the parent's
  sandbox. Use a top-level tab in a browser that supports the Pointer Lock API; browsers without
  that API cannot provide native mouse capture.
- **Vercel-only deployment without WebSocket**: multiplayer uses the browser-hosted engine plus
  `BroadcastChannel` / WebRTC described above. It needs **neither `/ws` nor `/api/poll`**. There is no
  always-on game server or shared room state in Vercel Functions. Blocking WebSocket does not block
  WebRTC automatically, but blocking WebRTC/UDP can still prevent cross-computer play.
- **A separately hosted Python server behind an HTTP-only proxy**: only this topology supports
  fallback to `POST /api/poll`, carrying the same messages. Long-poll is **not** a Vercel-only fallback.
- Also: a wrong or stale server address falls back to **the page's own server** with a note in the
  menu, and blocked local storage or missing WebGL produce a clear message on the loading screen
  instead of hanging there.


### Weapon presentation and smoke

- Guns share gun-local trigger/support grips, reload/feed points and receiver-ejection sockets across
  first-person arms and third-person IK. Imported models calibrate their muzzle to the actual front
  geometry instead of retaining a procedural gun's placeholder barrel length.
- Each of the 12 imported guns has mesh-measured hand contacts. Imported character hands use a
  calibrated palm/wrist frame, opposed thumbs and curled finger joints (with a lighter trigger-index
  curl), rather than putting an open wrist directly on the grip. The same orientation follows ADS,
  recoil and reloads. Fallback gloves have rounded palms and separate bent fingers, with sleeves
  ending at the wrist; their geometry is merged into one draw per hand.
- Reloads have presentation, feed/magazine service, seating and recovery phases; the support hand
  follows the feed while the trigger hand holds the weapon. Clip-fed rifles use a feeding motion.
  Progress follows the authoritative reload timer and stops when the reload ends or is interrupted.
- Recoil lifts the barrel with a damped return. First-person flashes track the animated muzzle;
  third-person shots start at the avatar's barrel, not its chest. Brass leaves the receiver.
  Ballistics still use the original eye/aim ray; these changes do not move hit detection.
- Smoke grenades use 36 bounded, layered, noise-textured puffs with outward expansion, rolling drift,
  a buoyant crown and gradual dissipation. Inside-cloud fog follows the same density envelope.
  Particle placement is seeded by effect id and animation is time-based, not frame-rate dependent.

### Static-deployment browser regression tests

Run with Node.js 22.17+ on Linux (or provide your own Chromium via `CHROMIUM_EXECUTABLE`):

```sh
npm install --prefix /tmp/maxs-fpv-browser-tests playwright-core@1.64.1 @sparticuz/chromium@153.0.0
node tools/test-vercel.mjs
```

The test serves only `public/` and the static API shims, disables WebSocket, and blocks external
requests. It checks actual Pyodide host/guest gameplay (welcome, state, input, firing, reloading,
abilities and chat), separate-room isolation, real WebRTC across isolated browser contexts,
duplicate delivery over two transports, joining during host startup, invalid codes/timeouts,
departure cleanup, native lock/retry/Esc/relock, permitted iframe locking, and denied sandbox requests
without alternative steering. This is a local
static-deployment test, **not** a live Vercel deployment or a cross-NAT connectivity guarantee.
The same command also runs `tools/test-effects.mjs`: 12 imported models / 84 weapon poses,
third-person grip tracking, animated flash/ejection sockets, reload cancellation, deterministic smoke
and an actual solo deploy/fire/reload/grenade render. `tools/test-hands.mjs` additionally exercises
all four shipped skeletons across 384 weapon/ADS/recoil/sprint/reload poses, checking wrist rotation,
30 finger joints per character, repeated-frame stability, unreachable-pose fallback and world-character
hold/run/fire grips. Set `HAND_SCREENSHOT=/tmp/hands.png` to capture hip/ADS/reload and fallback gloves.
Use `TEST_DEPS` to change the external test-dependency directory; no npm build step is added to Vercel.

---

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Left mouse button | Fire (hold to keep firing with automatic weapons) |
| Right mouse button | Aim down sights / raise the weapon (tighter spread, narrower view) |
| `Shift` | Crouch (half height, the only way through low passages) |
| `Space` | Jump |
| `R` | Reload |
| `Q` | Use your class ability |
| `V` | First / third person camera |
| `Tab` (hold) | Scoreboard |
| `Enter` | Chat input (`Esc` cancels) |
| `Esc` | Release pointer lock and open the pause menu |

Click the screen to continue with native pointer lock. The first entry into a match needs one click
before the mouse turns the view. If the browser refuses capture, click to retry or open the game in
its own tab; the game never switches to a different mouse control scheme.

### The four classes

| Class | Role | Ability | Weapons |
| --- | --- | --- | --- |
| Assault | Close-quarters burst · 100 hp · ×1.08 movement | **Smoke grenade** — a wide cloud that blocks sight lines; enemies inside cannot be spotted by flares | MP18 Bergmann, Automatico M1918, Hellriegel M1915 |
| Medic | Mid-range sustain · 100 hp | **Medic box** — heals you and nearby teammates continuously until you place the next one | Cei-Rigotti, RSC M1917 (6 rounds, 50 per shot), Fedorov Avtomat (26 rounds) |
| Support | Suppressive fire · 110 hp · ×0.94 movement | **Ammo crate** — refills reserve ammo for you and nearby teammates; hits suppress the enemy | Lewis Gun (97-round drum), BAR M1918, Chauchat M1915 (20 rounds, automatic but very slow) |
| Scout | Long-range sniping · 90 hp | **Flare** — spots enemies in the area for the whole team | SMLE MkIII, Mannlicher M95 (5 rounds, straight-pull), Springfield M1903 |

The scout's bolt-action rifles kill with **one shot to the head or torso** inside their range.

Bolt mechanism: the **Mannlicher M95** is a straight-pull, so it cycles while you are still aiming
down sights; the other two (SMLE, Springfield) only cycle **after you release the right button** —
you cannot fire the next round with the sights up.

### Three ways in

The three buttons in the main menu:

| Mode | What it does |
| --- | --- |
| Multiplayer | Online team deathmatch, humans only by default; the *AI bots* switch adds 4 / 6 / 8 / 12 of them |
| Solo | You plus AI teammates against AI enemies; bots are forced on and the switch becomes a read-only indicator |
| Setup | Import a skinned glTF/GLB, map its bones to the game's joints, tune the pose and upload it for everyone |

Bots go through exactly the same server-authoritative firing path as human players; there is no
special-case AI logic.

**Multiplayer always needs a room code** (create or join, above); solo and the tutorial start
straight from your browser.

### Tutorial

The *Tutorial* button in the main menu (it blinks gently on a fresh profile) walks you through the
whole loop: move → turn with the mouse → fire → aim → reload → crouch / jump → use an ability →
scoreboard / chat → room codes. Each step only ticks when you **actually perform it**, and the
panel tells you what to do next. The practice match is solo (no bots, nobody shoots at you), you
can skip it at any time or restart it from the panel, and finishing it is remembered on this
machine (`tf.profile`) so it stops offering itself.

### Local profile (no SQL server anywhere)

**All player data lives in the player's own browser.** The server stores and sends no personal
data at all:

- Name, class, weapon, skin, sensitivity, recent room codes, tutorial state and stats (matches,
  wins, kills, deaths, playtime) all live in `localStorage` under `tf.profile`.
- The bottom of the Setup screen shows a summary (name / last room / record / tutorial state),
  can export it as `trench-front-profile.json`, and can wipe it with one click.
- With local storage blocked the game degrades to in-memory storage (works for the session, lost
  when the page closes) and says so.
- Another machine, another browser or cleared site data means a fresh profile. That is expected —
  it is the price of having no server database at all.

### Custom characters (Setup mode)

1. Open *Setup* and pick a skinned `.glb` / `.gltf` (no Draco / meshopt / KTX2, and no `.gltf`
   that depends on external `.bin` files or textures).
2. Bones are matched to the 13 game joints by name (hips / spine / head / both shoulders / elbows /
   wrists / knees / feet) and every mapping can be corrected by hand. Shoulders, elbows and hands
   are not animated by the gait, so the offset sliders are what put the weapon in the hands.
3. *Scale* and *Facing* fine-tune the model; after normalisation it is aligned to the 1.70 m
   standing height the hit boxes assume.
4. *Upload shared* sends the model and its mapping to the server (`POST /api/character`, 24 MB per
   file). Everyone then sees it in the *Shared characters* list and can pick it with one click;
   inside a match other players see it on you.
5. *Save locally only* keeps the mapping and offsets in your own browser instead.

### Built-in class models

The four classes use the Genshin models shipped with the client (`public/models/genshin/`) unless
you have picked a custom character:

| Class | Model | Source and licence |
| --- | --- | --- |
| Assault | Hu Tao | no license.txt in the folder, origin and licence unknown |
| Medic | Furina | no license.txt in the folder, origin and licence unknown |
| Support | Navia | [Genshin impact - Navia](https://sketchfab.com/3d-models/genshin-impact-navia-e374754064824592b13bf2cb167ca0d9) by X9_YT, CC-BY-4.0 |
| Scout | Charlotte | [Genshin impact - Charlotte](https://sketchfab.com/3d-models/genshin-impact-charlotte-461c10166e584add99a9e5fc447a8df1) by X9_YT, CC-BY-4.0 |

The two CC-BY-4.0 models keep their attribution; settle the Hu Tao and Furina licences before
publishing anything.

Models load **lazily per class**: the first time a class appears on screen (4–10 MB), and a
built-in anime character stands in until the download finishes. A custom character takes priority
over the class model.

Teams are told apart by the triangle above each head — **green for teammates, red for enemies**,
shown for both sides. The models keep their original colours; nobody gets dyed team colours.

### Weapon models

All 12 primary weapons use imported glTF models (`public/models/guns/<weapon-id>.glb`), hot-swapped
in by `guns.js` once downloaded, over a procedural placeholder (first person, your own third-person
body and remote players all share the same `buildWeapon` path).

| Class | Weapons |
| --- | --- |
| Assault | `mp18` / `auto1918` / `hellriegel` |
| Medic | `cei` / `rsc1917` / `federov` |
| Support | `lewis` / `bar` / `chauchat` |
| Scout | `smle` / `m95` / `springfield` |

- Each model's **longest axis is aligned to +Z (muzzle) with +Y up**, and its length is normalised
  to the same envelope as the procedural gun (SMG 0.92 m / rifle 1.12 m / LMG 1.22 m / bolt 1.28 m)
  with per-model palm-contact sockets measured on the normalized mesh.
- Models are parsed once and shared through `clone(true)`; the procedural gun stays until the swap,
  so you never see empty hands.
- Some models in the asset pack point backwards (muzzle at −Z) or use spec-gloss materials (an
  extension three.js removed, which renders as untextured white). Both were fixed offline before
  import; the direction is in the `flip` field, and materials were converted to standard
  `pbrMetallicRoughness`.
- The origin and licence of these models are unknown (shipped with the asset folder, no
  license.txt); settle it before publishing.

### How each weapon fires

The twelve guns differ in more than numbers: muzzle flash, sound, recoil, ejected casings and
tracers all have their own character, all of it in the `fx` block of
`public/shared/weapons.json` (**presentation only — the server never reads it**, and a bad edit is
clamped back into range by `gunfx.js` instead of breaking a match).

| Weapon | Muzzle flash | Recoil (gun + camera) | Tracer | Sound |
| --- | --- | --- | --- | --- |
| MP18 | small, short | light | thin, every 3rd round | bright, dry |
| Automatico M1918 | smallest, fastest | lightest | thinnest, every 2nd | sharp, fastest rhythm |
| Hellriegel | medium-large, warm | heavy | thick-ish, every 2nd | deep (5.2 kHz low-pass) |
| Cei-Rigotti | medium | medium | medium, every 2nd | standard |
| RSC M1917 | large, bright | heavy (camera kicks) | thick, every round | loudest, tone pushed down |
| Fedorov | medium | light-medium | medium, every 3rd | clear, bright |
| Lewis | large, smoky | medium (steady muzzle) | thickest, every round | round, low |
| BAR | medium | medium-heavy | thick, every round | dry |
| Chauchat | largest, smokiest | heaviest | thickest and longest | dullest (4.2 kHz low-pass) |
| SMLE | huge | very heavy | thick and bright | brittle and long |
| Mannlicher M95 | large | heavy | thick, a little shorter | clear, snappy straight-pull |
| Springfield | largest and brightest | hardest | thickest and longest | deepest, longest tail |

Other people's gunfire is shown too: the server sets an "is firing" flag in the state, and the
client puts the same flash and smoke on their muzzle and plays the distant shot at **that weapon's
own rate of fire** — a Lewis does not sound like a rifle.

## Match rules

- First side to **75 kills** wins, or whoever leads when the **8-minute** clock runs out.
- Death costs 3 seconds; respawning lets you change class and weapon for free.
- **Breathing health regen**: 8 seconds without taking a bullet or blast starts the regen, which
  refills to full in another 8 seconds (capped at your own maximum). Any damage resets the 8-second
  timer; medic-box healing stacks with it. The same rule applies to humans and bots.
- Camera: first person by default, `V` switches to third person to watch your own character
  (first person shows the same arms and weapon as the model; third person only moves the camera —
  the aim ray and hit detection are untouched).
- There is no minimap: the scout's flare is the only way to actively reveal enemies (spotted
  enemies are visible to the whole team).

---

## Deployment

The server is a **single-process, single-port** aiohttp app with no database and no build step, so
deploying it means "install one dependency, run one command". Three ready-made paths ship with the
repo:

**Docker (works anywhere)**

```bash
docker build -t trench-front .
docker run -p 8080:8080 trench-front
```

The image is `python:3.12-slim` with only aiohttp, runs as a non-root user and carries a
`HEALTHCHECK` against `/api/health`. `PORT` is read explicitly (see below).

**Render** — `render.yaml` in the repo root is a ready Blueprint: connect the repository and pick
the Blueprint (the free tier sleeps; the first visitor after that waits a few seconds). Health
check path `/api/health`. **This is the least-effort "click and play" option**, because it hosts
the front end and the game server together.

**Heroku / Railway / Koyeb** — the `Procfile` is in place (`web: python server/server.py`) and the
`PORT` they inject is adopted automatically.

**Vercel — no backend required (recommended for just playing)**

Vercel functions are request-in / response-out: no WebSocket and no always-on 30 Hz match loop, so
the game server cannot run there. **But a match does not need one**: `public/engine/*.py` is the
same code the server runs, and the page pulls it into the browser with **Pyodide** (Python compiled
to WebAssembly, deployed with the repo in `public/vendor/pyodide/`), driven by
`public/js/local.js`. A purely static host is therefore **fully playable as-is**: solo plus bots
*and* multiplayer, where whoever creates the room runs that match in their own browser and the
players are joined by the host's own browser (`public/js/relay.js`, `public/js/p2p.js`) — see *Multiplayer on a static
host* above.

1. Import the repository in Vercel, pick **Other** as the framework preset and leave the build
   command / output directory empty.
2. **Set the Root Directory to `public`** (Settings → Build and Deployment → Root Directory). The
   project config lives in `public/vercel.json`: the three `/api/*` routes are rewritten to static
   shim files and `/vendor/pyodide/*` gets a long cache and the right MIME types. The
   `vercel.json` in the repo root is for the older setup with an empty Root Directory; both are
   kept, and which one applies follows from that setting.
3. Deploy. Open the URL → main menu → *Deploy* under either mode:
   - Solo: the in-page engine starts the match (the browser shows "static host: the match runs in
     the engine embedded in this page").
   - Multiplayer: **needs no server either** — *Create room* runs the match in your browser and
     your friends join with the code or the two copied invite codes. Several rooms can run
     different maps at the same time. A real server (Render or Docker, below) is only needed for a
     permanent lobby and a shared character library; put its address in the menu's **server
     address** field, or add `?server=your-app.onrender.com`.

On a static host the API routes are answered by `public/api/*.json` (`/api/health` returns
`{"ok":true,"engine":"local"}`, which is how the client knows "this origin has no server, use the
in-page engine"): the menu works, the built-in characters are all there, the room list is gathered
by the page from the relay (the shim's own list is empty), and character upload needs a real server
(the shim says so). The first visit downloads about 12 MB
of Python runtime (cached afterwards) — a few seconds slower, once.

Two traps: **an https page can only talk to an https backend** (browsers refuse `ws://` from
https), so host the backend over TLS too; and sub-path hosting such as GitHub Pages needs care,
because page assets use absolute paths (`/js/...`) and only work at a domain root.

Platform notes:

- `PORT`: when set, **that port only** — no 8080→8081 walk, which would 502 behind the platform's
  port mapping. Without `PORT` locally it still starts at 8080 and walks up to 20 ports. You can
  also run `python server/server.py --port 9000`.
- Binds `0.0.0.0` (override with `TRENCH_HOST`), because binding 127.0.0.1 inside a container makes
  it unreachable.
- An https page uses `wss://` automatically (`main.js` follows `location.protocol`), and a blocked
  WebSocket degrades to HTTP long polling, so it also works behind HTTP-only gateways.
- **Single instance only**: rooms, scores and the map live in memory, and the server runs one map
  at a time (a single world state in `combat.py`), so do not scale out, do not enable sticky
  sessions — one process is all of it.
- Uploaded shared characters are written to `public/shared/characters/` and vanish when the
  container restarts; mount that directory to keep them.
- Static assets come in two flavours: models, sounds and `vendor` (about 40 MB) get
  `Cache-Control: max-age=600` plus ETags (later visits are 304s), while `js` / `css` / `html` /
  `json` stay `no-store`, so a refresh always picks up your changes.
- The only difference between a static host (Vercel) and a self-hosted server is whether
  `/api/health` answers with `"engine":"local"`. If it does, the page uses the in-page engine
  (`public/js/local.js` + Pyodide); if not, everything goes over the network as before.
- Front and back end can be deployed separately: `public/js/api.js` remembers who to ask for
  `/api/...`. Once a player has typed a server address in the menu (or the URL carries
  `?server=`), the room list, the shared character library and character uploads follow that
  server; only models, sounds and `/shared/*.json` still come from the origin that served the page.

## Repository layout

```
FPS web game demo/
├── requirements.txt            # the only dependency: aiohttp (a static deployment needs none)
├── vercel.json / .vercelignore # rewrite rules + upload allowlist for an empty Root Directory
├── Dockerfile                  # deployment image (python:3.12-slim + HEALTHCHECK)
├── render.yaml / Procfile      # one-click config for Render / Heroku-style platforms
├── server/
│   └── server.py               # aiohttp: static files + /ws + /api/poll + room codes + upload API + 30 Hz loop
└── public/                     # the static root (Vercel's Root Directory)
    ├── index.html              # menu, class/weapon select, Setup, HUD, scoreboard, result
    ├── engine/                 # the server's brain: two hosts run this same code
    │   ├── game.py             # match state machine: teams, scoring, respawn, win, hit resolution
    │   ├── combat.py           # pure maths: ray-capsule, falloff, hit-box multipliers, movement collision
    │   ├── bots.py             # bot AI (navigation waypoints + aim tolerance)
    │   ├── room.py             # one room: players, score, map voting, message fan-out (no sockets)
    │   └── host.py             # in-page host: collects room output as JSON for js/local.js,
    │                           #   plus RelayHost: a multi-player room that tags every frame
    ├── shared/                 # the single data source shared by Python and JS
    │   ├── weapons.json        # 12 weapons + 4 classes + the global combat constants
    │   ├── map.json            # map A collision boxes / cover / spawns / navigation points
    │   ├── maps.json           # map list (default map, per-map scene settings)
    │   ├── maps/cs_italy.json  # the second map
    │   └── characters/         # uploaded shared characters (index.json is the manifest)
    ├── api/                    # /api/* shims for static hosting (Vercel rewrites into these)
    ├── vercel.json             # project config when Root Directory = public
    ├── vendor/pyodide/         # the in-page engine's runtime (13 MB, deployed with the repo)
    ├── css/style.css
    ├── img/classes/            # class-select portraits (4, already cropped to the 3:3.4 card)
    ├── models/
    │   ├── genshin/            # built-in class models (4 GLB files)
    │   └── guns/               # imported weapons: <weapon-id>.glb
    ├── vendor/
    │   ├── three.module.js     # three.js 0.169.0 (import map maps "three" to it)
    │   ├── loaders/GLTFLoader.js        # the loader for that same version
    │   └── utils/BufferGeometryUtils.js # a sibling dependency of GLTFLoader
    └── js/
        ├── config.js           # loads /shared/*.json
        ├── i18n.js             # the Chinese/English dictionary, language switch, DOM translation
        ├── local.js            # in-page engine host: starts Pyodide, drives host.py, feeds frames to main.js
        ├── relay.js            # web multiplayer: host/client network layers, tabs + direct links
        ├── p2p.js              # cross-computer links: invite/answer codes, WebRTC data channel, optional STUN
        ├── mqtt.js             # a very small MQTT 3.1.1-over-WebSocket client (only for ?relay=)
        ├── guns.js             # imported weapon models: facing / scale / hot swap
        ├── toon.js             # toon materials, outlines, procedural textures
        ├── gunfx.js            # per-weapon flash / smoke / casings / camera recoil (reads fx in weapons.json)
        ├── lighting.js         # map light, sky and fog validation, PMREM environment, imported-material fixes
        ├── profile.js          # local player profile (localStorage, no server database)
        ├── face.js             # procedural anime faces + class portraits
        ├── map.js              # the trench scene (collision identical to combat.py)
        ├── character.js        # the anime girl: hair / clothes / accessories / walk and run animation
        ├── rig.js              # external rigs: parsing / joint mapping / normalisation / Setup UI
        ├── viewmodel.js        # first-person arms and weapon view model
        ├── controls.js         # native pointer lock, mouse look, retry/release, client movement
        ├── hud.js              # all the DOM / HUD logic
        ├── audio.js            # procedural WebAudio sound (no audio files)
        ├── net.js              # WebSocket client (with long-poll fallback) + remote-player interpolation
        ├── tutorial.js         # the nine-step tutorial, driven by real input
        ├── storage.js          # safe localStorage / sessionStorage wrapper (falls back to memory)
        └── main.js             # orchestration and the main loop
```

---

## How it is built

- **One data source**: every number lives in `public/shared/*.json` and both the server and the
  client read the same files, so they cannot drift. `python public/engine/combat.py` validates that
  data at any time.
- **One server, two hosts**: `room.py` / `game.py` / `combat.py` / `bots.py` contain no socket code,
  so the aiohttp host (`server/server.py`) and the in-page host (`engine/host.py`, running inside
  Pyodide) drive the same `Room`. A "solo match on a static host" is therefore not a simplified
  rewrite: ballistics, falloff, hit-box multipliers, bot AI, map voting and scoring are one
  implementation, and the page behaves exactly like a self-hosted server.
- **Spawns always have a way out**: spawn points are already validated as "flat ground, nothing
  overhead" in the map data, but a map can still put a bunker two metres in front of one. So
  `random_spawn` prefers points with five clear metres ahead and turns wall-corner spawns towards
  open ground; the three spawns still rotate, nobody starts facing sandbags.
- **Server authority**: hit resolution, damage, ammo, rate of fire, ability cooldowns and scoring
  are all decided by the server. The client reports where it is and where it is aiming, nothing
  else counts.
- **Client-authoritative movement, server-clamped**: movement feels instant locally, and the server
  validates distance and bounds, then slides the player along walls.
- **Lag compensation**: the server keeps a one-second ring buffer of positions per player (one
  sample per 30 Hz tick, `historyMs: 1000`). On fire, **every target** is rewound to
  `ping/2 + interpDelayMs (120 ms)` earlier — the position the shooter actually had on screen — so
  "I aimed straight at him and did no damage" does not happen. Details: the rewind window is capped
  at `lagCompMaxMs: 220`; the client-reported RTT is clamped to 240 ms server-side (reporting a
  fake ping only makes you easier to hit); bots are not rewound (they have no latency); a player's
  buffer is reset on spawn and death so a rewind cannot reach across a death.
- **External rigs**: an uploaded model cannot know the game's joint names, so `rig.js` does not do
  bone retargeting — it captures the rest quaternion on import and applies `rest × delta` every
  frame, the only approach that holds across arbitrary models. Legs, spine and head are driven by
  the procedural gait; shoulders, elbows and wrists are left to the offset sliders. Scaling is
  measured with `Box3` and normalised to the 1.70 m standing height that matches the hit boxes.
  There is no SkeletonUtils in the project, so skinned cloning is hand-rolled (after `clone(true)`,
  the `Skeleton` and `boneInverses` are rebound in traversal order). A model's id travels with the
  player state (`state.ps[].sk`), remote players switch models on it and swap in automatically once
  the lazily loaded template arrives.
- **Lighting and material robustness**: map lights, fog and sky colour go through `lighting.js`
  first (missing values get defaults, invalid colours are dropped, `fogFar > fogNear` is forced),
  so a broken map file cannot black out the screen. A procedural sky is rendered into a PMREM
  environment map on `scene.environment` for the metal-heavy imported rifles — an imported PBR
  model with metalness 1.0 and no environment map renders pure black, which is the "black model"
  bug that got fixed; metal materials with no textures are pushed down to `metalness ≤ 0.6`.
  Unlit assets (`KHR_materials_unlit`) are left alone.
- **Everything about firing is pooled**: muzzle flashes, smoke and casings are pre-built pools
  (8 / 18 / 16) that are repositioned rather than allocated and destroyed, so 900 rpm weapons do
  not make the GC stutter. Muzzle light uses **two always-present** `PointLight`s in the scene
  (intensity 0 when idle): lights that come and go make three.js recompile the whole world's
  shaders, while permanent ones just cost a little per-pixel work. Camera recoil only moves the
  **render** camera — the crosshair and the server-shared aim ray do not move a pixel, so it feels
  like "the picture shakes" rather than "the bullets fly anywhere".
- **Anime rendering**: four-band `MeshToonMaterial` steps, inverted-hull outlines and a hair
  highlight band; no real-time shadows (a dark disc under the feet stands in), and every face and
  portrait is drawn procedurally on a canvas with no image assets.
