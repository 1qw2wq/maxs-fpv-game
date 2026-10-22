# Bots and difficulty

## Population and permissions

Main-page setup separates **Solo AI count** from **Multiplayer AI count (host)** and shares an AI difficulty selector. Solo remembers counts per map; Procedural City recommends **15**. Presets are 0/4/6/8/12/15/16; zero is target practice, while Tutorial is its own zero-bot match.

Multiplayer defaults to **zero bots**. The host can add **0–16** in deathmatch or point control. Guests see but cannot change the policy. Changing it in a waiting lobby clears guest Ready; guests must ready again before host Start. Settings lock during launch/play. Guest observations do not overwrite locally saved preferences.

The first human owns the room's bot policy; authority checks reject guest overrides, including direct commands. Bots share the **32-seat** cap: human arrivals reclaim bot seats, departures restore the requested target, and the last human leaving removes bots. Ownership does not migrate after host shutdown.

## Skill levels

Tuning lives in [bots.json](../public/shared/bots.json), shared by Python and Pyodide.

| Choice | Tier | Reaction window | Last-seen memory |
| --- | --- | --- | --- |
| Mixed | Per-team recruit, regular, veteran, recruit, regular, regular rotation | Per bot | Per bot |
| Easy | Recruit | 550–1000 ms | 2.5 s |
| Normal | Regular | 300–600 ms | 4.5 s |
| Hard | Veteran | 150–300 ms | 6 s |
| Expert | Elite | 120–240 ms | 7 s |

Reaction windows are not guaranteed first-shot times: sensing, facing, aim, burst hesitation, reload and equip delays also apply. Expert still has finite tracking, nonzero aim error and a 4% burst-hesitation chance. Mixed does not include Elite.

## Behavior

- Utility scores choose withdraw, push, hold, strafe or flank from health, weapon range, suppression and recently **visible** threats. Friendly strength and nearby allies' roles influence bounded confidence and anchor/flank coordination.
- Lower levels add more decision noise. Hard/Expert seek cover under multiple observed threats. Healing, ammo support, objectives, committed plans and stuck recovery remain class-aware.
- Delayed sight samples and bounded prediction guide tracking. Last-seen positions are frozen observations that expire or clear after investigation—not live knowledge through walls. LOS, smoke, flash and friendly firing lanes gate shots.
- An empty primary can trigger a normal pistol switch, respecting the 350 ms equip delay and independent ammo. Bots do not manufacture ammunition.
- Gas exposure uses ordinary reaction timing and the same mask seal delay as humans; a mask does not reveal targets through smoke.

This is lightweight hand-authored AI, not learning, GOAP or an external service. Harder levels do not change health, weapon damage, fire rate, ammo, collision or vision rules. **Solo-only balance relief** (bot-to-human hit discard and faster human regeneration) is separate and does not apply to multiplayer.

## Checks and design references

```sh
python tools/test-ai.py
python tools/test-bot-difficulty.py
node tools/test-room-lobby-unit.mjs
node tools/test-bot-settings.mjs
BOT_LOBBY_TEST=1 node tools/test-room-lobby.mjs
```

See [browser setup and limits](testing.md). `BOT_SCREENSHOTS=1 node tools/test-bot-settings.mjs` writes review images to `/tmp`. Automated checks are not a player study or device/performance certification.

The original simplified heuristics were informed by Mike Lewis's [Choosing Effective Utility-Based Considerations](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf) and Tobias Karlsson's [Squad Coordination in Days Gone](https://www.gameaipro.com/GameAIProOnlineEdition2021/GameAIProOnlineEdition2021_Chapter12_Squad_Coordination_in_Days_Gone.pdf). No source code was copied, and this is not an implementation of either complete system.

中文：单人和联机 AI 数量分别保存；联机只允许房主调整，修改后客人须重新准备。高难度仍有反应延迟和失误，不会穿墙读取敌人位置。
