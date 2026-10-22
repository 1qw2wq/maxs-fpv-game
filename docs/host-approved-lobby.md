# Rooms, approval and synchronized launch

## Player flow

1. **Create room** opens a transport and leaves the **host on the main page**, showing the code, pending requests and approved roster. The match engine is not running yet.
2. A guest requests admission using the code in same-origin/same-partition tabs, or pairs via WebRTC invite/answer in another browser/device. **Pairing is not approval or deployment.**
3. The host accepts/rejects names on the main page. Acceptance automatically opens the guest's character/loadout selection; the host stays on the main page.
4. The host chooses map, rules and optional **0–16 bots/difficulty** (default zero). Guests choose character, primary and pistol, then press **Ready**. Loadout changes/Back clear their Ready; host AI-policy changes also require guests to ready again. Names stay fixed until leaving/re-requesting.
5. The host chooses their own character and presses **Start game** once all approved guests are ready. Pending applicants do not block Start and are not admitted when the match begins.
6. Configuration locks. The host boots the authority and finishes welcome/map loading **before** releasing guests into the game with their readied loadouts. Guests do not click Deploy again. Desktop pointer lock still requires a user gesture on the canvas.

Solo/Tutorial are separate; switching to them closes the pre-match room. See [bot settings and ownership](bot-difficulty.md).

## Connection choices and limits

- **Same-origin tabs in the same storage partition:** BroadcastChannel and room code.
- **Other profiles/browsers/devices:** exchange one `TFi1...` invite and `TFa1...` answer per friend, complete pairing, then follow approval/Ready/Start.
- A code or room link is **not cross-device signalling**. Static Vercel supplies no signalling backend or TURN relay. Optional STUN discovers addresses but cannot relay traffic through every NAT/firewall; direct connectivity must be possible.
- No required account, broker, backend, runtime npm install or build. The browser host must stay open; suspended phones/tabs cannot guarantee continuous authority. **No host migration.**
- Source/session checks are not cryptographic account authentication. This is cooperative peer hosting, not an adversarial security boundary. The optional legacy Python-server API is separate; a saved backend address cannot replace a lobby's chosen channel.

## State and authority contract

[room-lobby.js](../public/js/room-lobby.js) owns admission/readiness/config; [room-lobby-view.js](../public/js/room-lobby-view.js) renders safe bilingual names/status. [main.js](../public/js/main.js) controls lifecycle; [relay.js](../public/js/relay.js) preserves the same channel through gameplay adoption.

Envelopes use `{v:1,k:'lobby',room,cmd,...}` on `trench-front/v1/r/<code>`. Commands include request, ready, leave, state, denied and closed. Host state includes config, epoch, revision and phase; guests pin the owner/epoch and reject older revisions. Ready uses increasing sequence numbers, acknowledgements and one-second retries; stale packets cannot undo newer choices or ready a different AI policy.

```text
waiting → starting → started
             └─ engine boot failure → waiting
```

Guests launch exactly once on `started`, not `starting`. Failed engine boot preserves pairing/approvals for retry; failed welcome/map loading closes the room with an error. Gameplay routing independently checks approval and transport identity before seating/processing commands—not merely whether a button is enabled.

## Lifetime and recovery

- Waiting entries expire after **30 s** without heartbeat; guests time out after **45 s** without valid host state. The pending-plus-approved guest cap is **31**, plus host; this is not a 32-player performance guarantee.
- Reject, leave, close and terminal loss clean up UI/timers/transports; approved leave removes the authority seat.
- No new sessions after launch. An already-approved **same session** can recover a dropped authority seat. Refresh creates a new session and needs a new host lobby; a broken RTC link may need new pairing too.
- Late/cancelled loading cannot silently redeploy a user after they leave. Host shutdown ends the room.

## Checks

```sh
node tools/test-room-lobby-unit.mjs
node tools/test-room-lobby.mjs
BOT_LOBBY_TEST=1 node tools/test-room-lobby.mjs
GAS_LOBBY_TEST=1 node tools/test-room-lobby.mjs
node tools/test-vercel.mjs
```

See [test setup and known limits](testing.md). Focused suites exercise native menu approval, readiness ordering, boot-failure retry, admission/source rejection, same-session recovery and real invite/answer across isolated contexts with BroadcastChannel/WebSocket disabled. Local RTC checks are not deployed-Vercel or cross-NAT certification.

中文：房主在主页接收申请并选地图；批准后客人自动进入角色选择并准备。房主选好角色后按开始，主机加载完成才统一放行。跨设备需要邀请/回答配对，单独房间号不能完成跨设备连接。
