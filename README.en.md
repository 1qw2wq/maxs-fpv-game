# Trench Front · 堑壕前线

A browser FPS combining WW1-inspired battlefields, anime-style characters, team combat, and optional AI opponents. Play solo or with friends, switch between first and third person, and choose English or Chinese.

**No client installation or production build step.** Deploy to Vercel or another static host and run matches in the browser through Python/Pyodide, or use the optional Python server.

[中文指南](README.md)

## The game

- **Two modes:** Team Deathmatch ends at 75 kills, or compares scores after 8 minutes. Point Control requires capturing all A/B/C points and holding them together for 15 seconds.
- **Three maps:** the trenches of Somme No Man's Land, close-quarters Italy Town, and Procedural City with connected buildings, accessible floors, and a central park.
- **Four classes, 30 weapons:** 26 class-specific primary weapons, plus a choice of APX Carry, G17, Desert Eagle, or Flare Pistol as your secondary. Each slot keeps its own ammunition.
- **Grenades and protection:** frag, incendiary, smoke, flash, and yellow poison gas. A sealed gas mask prevents poison damage but does not clear the smoke.
- **Optional bots:** 0–16 AI with Mixed, Easy, Normal, Hard, and Expert difficulty. Multiplayer bot count and difficulty are host-controlled.
- **Desktop and mobile controls:** native pointer lock on desktop; a separate mobile mode with a joystick, translucent rounded buttons, fullscreen, and customizable layouts saved per orientation.

| Class | Role | Ability |
| --- | --- | --- |
| Assault | Close-quarters attack | Smoke grenade to break sight lines |
| Medic | Mid-range combat and recovery | Medical crate to heal nearby teammates |
| Support | Suppressive fire | Ammo crate to replenish reserve ammunition |
| Scout | Long-range reconnaissance | Flare to mark enemies; smoke blocks spotting |

## Start playing

1. Open the game page and enter a nickname. Switch English/Chinese in the top-right corner.
2. Choose **Solo** or **Multiplayer**, then set the map, rules, and bots. Try the **Tutorial** for guided practice.
3. Choose a class, character, primary weapon, and secondary, then deploy. Multiplayer guests follow the Ready flow below.
4. On desktop, click the game to capture the mouse. On mobile, select mobile mode and use the joystick/buttons. After death, choose your loadout and redeploy.

The first visit downloads the engine and models; larger maps can take time to load. If an embedded preview cannot acquire pointer lock, open the game in a standalone browser tab. Mobile mode is not a fallback for denied desktop pointer lock.

## Controls

Defaults are listed below. Customize main/alternate keys in **Settings → Keyboard layout**; changes apply immediately and are saved locally. [Keyboard layout guide](docs/keyboard-layout.md).

| Input | Action |
| --- | --- |
| `W A S D` / mouse | Move / look |
| Left / right mouse button | Fire / aim |
| `Shift` / `Space` | Sprint / jump |
| `C` / `Ctrl` | Crouch |
| `1` / `2` | Select main / secondary gun directly; numeric keypad supported |
| `X` / `R` | Toggle weapon slots / reload |
| `Q` | Class ability; hold/release to charge and throw smoke or a flare |
| `B` / hold and release `G` | Select grenade type / charge and throw |
| `M` | Put on/remove gas mask; takes 0.75 seconds to seal |
| `V` | First-/third-person camera |
| `Tab` / `Enter` | Scoreboard / chat |
| `Esc` | Release mouse and open pause menu |

Mobile uses the corresponding on-screen buttons. Push the joystick continuously for 1.5 seconds to sprint. Customize button placement from the pause menu.

## Play with friends

**Room flow:** the host creates a room, accepts requests on the main page, and sets the map/rules. Accepted guests automatically enter character selection, choose their loadout, and press **Ready**. The host chooses their own loadout and presses **Start game** to bring everyone into the match together.

- **Tabs in the same browser:** use the room code or room link. Tabs must share the same site origin and storage partition; normal and private windows cannot be mixed.
- **Other browsers/devices:** use **Invite friends** to exchange an invite code and answer code for WebRTC pairing, then have the host accept the join request. Pair each friend separately.
- **Optional Python server:** friends can open its printed LAN address and join a room on that server, provided their devices can reach it.

Static hosting needs no persistent backend or message broker, but **the host must keep their page running**. Cross-device direct connections depend on the network. Optional STUN does not guarantee cross-NAT connectivity; strict firewalls or symmetric NAT may require TURN, which Vercel itself does not supply.

## Run and deploy

### Static deployment on Vercel

1. Import the repository and select **Other** as the Framework Preset.
2. Set **Root Directory** to `public`, using its `vercel.json`. Leave Build Command and Output Directory empty.
3. Deploy and open the site for Solo or browser-hosted multiplayer. No npm, bundling, or additional game backend is required.

### Local play / optional server

Requires **Python 3.10+**:

```sh
pip install -r requirements.txt
python server/server.py --open
```

Open the address printed in the terminal (normally `http://127.0.0.1:8080`). Friends on the same network use the printed LAN address. On Windows, you can also double-click [`启动服务器.bat`](启动服务器.bat). Stop with `Ctrl+C`.

For optional container hosting, see [`Dockerfile`](Dockerfile); for Render, see [`render.yaml`](render.yaml). The Python server also supports shared character uploads; static hosting does not provide upload storage.

## Settings, tools, and documentation

The in-game settings/operations tools provide character import and bone mapping, color repair, animation previews, weapon-placement calibration, and connection diagnostics. Profiles and preferences belong to the current browser, not a cloud account.

- [Multiplayer rooms and Ready flow](docs/host-approved-lobby.md)
- [Weapons, sidearms, and loadouts](docs/arsenal-and-sidearms.md)
- [Bot difficulty and behavior](docs/bot-difficulty.md)
- [Poison gas, masks, and throwables](docs/poison-gas-and-mask.md)
- [Maps and Procedural City](docs/proc-city.md)
- [Weapon-placement tools](docs/gun-placement-lab.md) · [Diagnostics](docs/diagnostics.md)

The client uses native ES modules and vendored Three.js. Match logic and shared data live in `public/engine/` and `public/shared/`. The linked guides contain technical details and focused test commands; test dependencies are not required to play.

## Asset credits and licenses

Assets retain their individual licenses; using the project code does not grant commercial rights to every asset. **The gas mask and AWP models have non-commercial license restrictions.** Check original terms and relevant rights before publishing, redistributing, or commercial use.

[Character credits](public/models/genshin/CREDITS.md) · [Weapon, grenade, and mask credits](public/models/guns/CREDITS.md) · [Vehicle sources](public/models/maps/VEHICLES.md)

## Camera hands and combat troubleshooting

First person uses connected, closed gloves for every skin; third person keeps the uploaded character costumes. Gas received while Italy loads retains its remaining lifetime rather than disappearing during scene teardown. Moving-target hits use bounded RTT + interpolation rewind; walls, team rules and each player’s five-second/action-canceled spawn shield still apply. See [the implementation and focused tests](docs/combat-rendering-and-hits.md) for details and limitations.
