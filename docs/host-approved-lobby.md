# Host-approved rooms and synchronized launch

## Player flow / 玩家流程

1. **Create room / 创建房间** opens a transport immediately and **leaves the host on the main page**.
   No match engine is started yet. The page shows the code, pending requests, and approved members.
2. A guest enters the code and presses **Request to join / 申请加入** (same-origin, same-partition
   browser tabs), or exchanges the existing WebRTC invite/answer codes (other browsers/devices).
   **Pairing opens a transport; it does not approve or deploy the guest.**
3. The host sees the guest's name and presses **Accept / 接受** or **Reject / 拒绝** on the main page.
   Acceptance **automatically opens character selection** for that guest. Rejection returns them
   to the menu with an explanation. The host remains on the main page.
4. Only the host chooses the map and game rules. Approved guests choose their character, primary
   and pistol, then press **Ready / 准备**. Changing class/primary/pistol or returning to the main
   menu clears readiness. Names are frozen for the lifetime of the request so the approved name
   matches the name in the match. Leave the room to rename and request again.
5. The host presses **Choose character / 选择角色** and configures their own loadout. **Start game /
   开始游戏** is disabled while any approved guest is not ready. Pending, unaccepted applicants
   are not participants and do not block the host; they receive “match started” if launch proceeds.
6. The host presses Start once. The map/rules freeze, the host starts the authoritative browser
   engine, and guests wait during its load. **Only after the host's welcome and map load complete**
   are guests released to automatically join with their readied loadout and the host's map/rules.
   There is no additional guest Deploy click. Desktop users still click the canvas to obtain
   native pointer lock; automatic navigation cannot bypass the browser's gesture requirement.

Solo and the tutorial retain independent deployment. Switching to either closes any pre-match
room instead of accidentally allowing a host Start to interrupt practice.

## Files and protocol

- `public/js/room-lobby.js`: engine-independent approval/readiness/config/launch state machine.
- `public/js/room-lobby-view.js`: bilingual main-page requests/roster and selection status.
  Player names use `textContent`, never HTML. Layout remains in the normal scroll flow.
- `public/js/main.js`: menu and match lifecycle. `requestRoom` opens the guest transport only;
  `installRoomLobby` connects state to the UI and automatic match launch. Hosting remains on the
  menu; guest Ready captures the loadout rather than calling `deploy`.
- `public/js/relay.js`: the same existing room channel carries lobby and gameplay traffic. Envelope
  source IDs are retained across dispatch, and the lobby observer survives host handler adoption.
  Saved optional backend addresses cannot replace a lobby's transport, even for tab-only rooms.

Lobby envelopes use `{v:1,k:'lobby',room,cmd,...}` on `trench-front/v1/r/<code>` alongside existing
Net frames. Commands are `request`, `ready`, `leave`, `state`, `denied`, and `closed`.
The host holds pending/approved members by the guest RelayNet session ID and transport source ID;
public state includes approved names/readiness, host-owned config, epoch, revision, and phase.
A guest pins the first valid host/epoch and rejects other owners and older revisions.

The phases are:

```
waiting -> starting -> started
             |
             +---- failed engine boot -> waiting (same approvals/pairing)
```

Guests only launch on `started`, once per session, not on `starting` or a repeated heartbeat.
Readiness has increasing per-guest sequence numbers, acknowledgements in host state, and retries
on the one-second pulse until acknowledged. Old readiness packets cannot undo a newer choice.
The host only starts when all approved guests are ready. Map/rules updates are host-only and
rejected after launch begins. Guests cannot approve themselves or start the match.

The authoritative host's gameplay routing independently checks admission and transport identity
before seating a guest or processing their input/bye/heartbeat. Hiding/disabling a UI button is
not the admission check. Guest gameplay dispatch also rejects envelopes from a different owner.

## Failure and lifetime behavior

- Pending/approved wait-room entries expire after 30 seconds without their request heartbeat;
  a returning waiting guest requests approval again. Guests stop waiting after 45 seconds without
  valid host state and receive room-code/pairing guidance.
- Reject, explicit leave, room close and terminal connection loss clear timers/UI/transports.
  An explicit approved departure also removes their authority-side seat.
- A failed engine boot returns the host to `waiting` without destroying the pre-opened channel,
  roster or any RTC pairing. A failed map/welcome load closes the room with an error instead of
  leaving everyone on a permanently disabled Start button. A cancelled late welcome cannot
  silently put the user back into gameplay.
- New sessions are not admitted after launch. An already-approved session can still recover an
  authority-dropped seat through the existing same-session auto-rejoin path, without another
  approval/start. Refreshing creates a new session; restart the host lobby to admit it.
- Hosting is still browser authority, not host migration. Closing the host ends the room. A fully
  suspended browser/phone cannot promise timers or live networking. A broken RTC connection may
  require pairing and a new lobby; this is not a durable account or reconnect-token service.
- Maximum admission queue plus approved guests is 31 (plus the host). This does not promise a
  particular frame rate or tested 32-player WAN capacity.

## Vercel-only boundaries

No required server, broker, signalling service, account, production package or build step was
added. Same-browser tabs use BroadcastChannel. Other browser contexts/devices still exchange one
invite/answer pair per friend and use WebRTC. An eight-digit code/link is **not** cross-device
signalling. Without external services the network must permit direct connectivity. Optional
STUN is unchanged; Vercel provides no TURN relay, so arbitrary NAT/firewall traversal is not
promised.

Source/session checks prevent ordinary unapproved joins and mismatched-source commands, but the
room code and client-controlled IDs are **not cryptographic authentication**. This is a cooperative
peer-hosted game, not an adversarial multiplayer security boundary. Do not treat approval as
account verification or encryption from every other participant sharing the transport.
The optional Python-server room API remains legacy; the new main-menu multiplayer flow does not
hand its lobby over to a typed backend address.

## Reproducible checks

```sh
node tools/test-room-lobby-unit.mjs
node tools/test-room-lobby.mjs
node tools/test-vercel.mjs
```

The browser scripts use test-only Playwright/Chromium dependencies installed outside the repo,
with `TEST_DEPS` / `CHROMIUM_EXECUTABLE` overrides as in the existing static regression harness.
Run large WebGL scripts sequentially: concurrent software-rendering browsers can exceed a small
sandbox's memory. The static test server decodes URL paths so uploaded assets in folders such
as `GLB format` are tested under the same encoded-URL behavior as Vercel.

The focused unit and browser tests cover:

- Request/approve/reject/retry, host-only config, malformed/old-owner/old-revision rejection.
- Lost Ready retry, ordered readiness, start gate and engine-load-before-release ordering.
- Failed adopted-channel engine boot followed by successful retry, in both tab and RTC flows.
- Native main-page controls, automatic guest character selection, preserved medic loadout,
  authoritative Somme/control match, no individual guest deployment, and exactly-once release.
- Rejection of an unapproved raw game join and mismatched-source `bye`, while retaining two seats.
- Already-approved seat drop/automatic rejoin and actual pause-menu leave removing the seat.
- Bilingual map/rule locks after language re-render and narrow portrait/landscape main-page fit.
- Real invite/answer UI across isolated browser contexts with BroadcastChannel and WebSocket
  disabled; the host channel ID and paired RTC link survive launch and carry chat afterwards.
- No browser JavaScript errors in the focused flow.

These are local static-host browser tests, not a live Vercel deployment, a real-phone benchmark,
or a cross-NAT/network reliability certification.

### Verification snapshot

- Focused lobby unit + native tab/isolated-RTC browser flows: **PASS**, including readied-pistol
  changes, Back/re-entry primary preservation, failed engine boot/retry, host shutdown and chat.
- Grenade/survival/AI/shooting/secondary/control/movement/sniper/city engine checks plus stairs:
  **143 tests PASS**; stair JS parity, protection clock and render-independent engine clock PASS.
- The broader `test-vercel.mjs` run passed its existing multiplayer/RTC, layouts, movement, models,
  city, all-gun imported poses, and **60 live first/third-person weapon firing cases**, but was
  **not fully green**: `testLiveWeaponHold` reported 0.051 m remote torso-attachment drift.
  No attachment/rig placement implementation was changed for this lobby task; do not interpret
  the successful lobby checks as a clean pass of that unrelated assertion or the later skipped checks.
- Two old full-suite harness problems were corrected while running it: percent-encoded static
  asset paths now decode correctly, and the live pistol fixture uses a real character class
  instead of assigning the non-playable catalog class `secondary` to a player.
