"""Deterministic engine regressions: python tools/test-ai.py (no dependencies)."""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'public' / 'engine'))
import bots
import combat
import game


class BotTests(unittest.TestCase):
    def setUp(self):
        self.clock = 100000.0
        self.patches = [patch.object(bots, 'now_ms', lambda: self.clock), patch.object(game, 'now_ms', lambda: self.clock)]
        for p in self.patches:
            p.start()
        bots._RNG.seed(123)
        self.match = game.Match()
        self.bot = self.match.add_player('Bot', None, bot=True)
        self.foe = self.match.add_player('Enemy', None)
        # add_player returns the player dict; no network is required.
        self.bot['team'], self.foe['team'] = 0, 1
        self.bot['pos'], self.foe['pos'] = [0, 0, 0], [18, 0, 0]
        self.bot['yaw'] = 0
        self.bot['last_hit_ms'] = 0
        self.match.phase = 'live'
        combat.BOUNDS = dict(minX=-30, maxX=30, minZ=-30, maxZ=30)
        combat.GROUND_Y = combat.FLOOR_BASE = 0
        combat.GROUND_BOX = None
        self.geometry([])

    def geometry(self, boxes):
        combat.SOLID = boxes
        combat._build_grid()
        # Synthetic street-level graph, with the same walkability rule.
        combat.NAV_FLOW = {team: {(x, z): (0, 1, 0) for x in range(-29, 29) for z in range(-29, 29)
                                  if combat._nav_walkable(x, z)} for team in (0, 1)}

    def tearDown(self):
        for p in self.patches:
            p.stop()
        combat.set_map(combat.DEFAULT_MAP_ID)

    def advance(self, ms=100):
        self.clock += ms
        return bots.think(self.match, self.bot, ms)

    def test_perception_respects_walls_smoke_and_facing(self):
        eye = (0, 1.58, 0)
        self.assertTrue(bots._can_see(self.match, self.bot, self.foe, eye))
        self.geometry([dict(t='wall', x=9, y=2, z=0, w=0.15, h=4, d=8)])
        self.assertFalse(bots._can_see(self.match, self.bot, self.foe, eye))
        self.geometry([])
        self.match.effects = [dict(k='smoke', p=[9, 1, 0], r=4, start=0, until=self.clock+5000)]
        self.assertFalse(bots._can_see(self.match, self.bot, self.foe, eye))
        self.match.effects = []
        self.bot['yaw'] = 180
        self.assertFalse(bots._can_see(self.match, self.bot, self.foe, eye))
        self.bot['last_hit_ms'] = self.clock
        self.assertTrue(bots._can_see(self.match, self.bot, self.foe, eye))

    def test_last_seen_is_a_snapshot_not_hidden_tracking(self):
        self.advance()
        remembered = list(self.bot['bot_state']['last_seen'])
        self.geometry([dict(t='wall', x=9, y=2, z=0, w=0.2, h=4, d=30)])
        self.foe['pos'] = [22, 0, 8]
        for _ in range(5):
            self.advance()
        self.assertEqual(self.bot['bot_state']['last_seen'], remembered)
        self.assertIsNone(self.bot['bot_state']['foe_id'])
        self.assertEqual(self.bot['shot_seq'], 0)

    def test_empty_and_safe_partial_magazines_reload(self):
        self.foe['alive'] = False
        self.bot['mag'] = 3
        self.advance()
        self.assertGreater(self.bot['reload_end'], self.clock)
        self.assertEqual(self.bot['shot_seq'], 0)
        # Do not interrupt an active clip reload just because a target appears.
        self.foe['alive'] = True
        self.bot['weapon'] = 'smle'
        self.bot['mag'] = 1
        self.bot['reload_end'] = self.clock + 2000
        self.advance(500)
        self.assertEqual(self.bot['shot_seq'], 0)

    def test_friendly_firing_lane(self):
        ally = self.match.add_player('Ally', None)
        ally['team'], ally['pos'] = 0, [8, 0, 0]
        self.assertTrue(bots._friendly_lane(self.match, self.bot, (0, 1.15, 0), (1, 0, 0), 18))
        ally['pos'][2] = 3
        self.assertFalse(bots._friendly_lane(self.match, self.bot, (0, 1.15, 0), (1, 0, 0), 18))

    def test_crouched_target_point_and_stable_target_selection(self):
        self.foe['flags']['crouch'] = True
        self.assertLess(bots._target_point(self.foe)[1], combat.COMBAT['crouchHeight'])
        other = self.match.add_player('Other', None)
        other['team'], other['pos'] = 1, [17, 0, 1]
        self.bot['bot_state']['foe_id'] = self.foe['id']
        chosen, _ = bots._visible_foe(self.match, self.bot, (0, 1.58, 0))
        self.assertIs(chosen, self.foe)

    def test_cover_actually_occludes_the_threat(self):
        self.geometry([dict(t='wall', x=2, y=1.5, z=0, w=0.3, h=3, d=6)])
        cover = bots._find_cover(self.bot, (18, 1.15, 0))
        self.assertIsNotNone(cover)
        self.assertFalse(combat.blocked(cover[0], cover[2], cover[1]))
        self.assertFalse(combat.has_line_of_sight((18, 1.15, 0), (cover[0], cover[1]+0.75, cover[2])))

    def test_astar_routes_around_a_wall_and_is_cached(self):
        self.geometry([dict(t='wall', x=3, y=2, z=0, w=1, h=4, d=8)])
        bots._route_direction(self.bot, [7, 0, 0], self.clock)
        route = self.bot['bot_state']['route']
        self.assertTrue(route)
        self.assertGreater(max(abs(z) for _, z in route), 4)
        self.assertTrue(all(not combat.blocked(x, z, 0) for x, z in route))
        due = self.bot['bot_state']['route_at']
        bots._route_direction(self.bot, [7, 0, 0], self.clock+100)
        self.assertEqual(self.bot['bot_state']['route_at'], due)

    def test_long_step_cannot_tunnel_through_a_thin_wall(self):
        self.geometry([dict(t='wall', x=0.9, y=2, z=0, w=0.05, h=4, d=40)])
        off, pos = bots._steer(self.bot, 1, 0, 2)
        self.assertNotEqual(off, 0)
        self.assertLess(pos[0], 0.9)
        self.assertFalse(combat.blocked(pos[0], pos[1], 0))

    def test_heal_and_ammo_use_team_needs_without_an_enemy(self):
        self.foe['alive'] = False
        self.bot['cls'] = 'medic'
        self.bot['hp'] = 25
        self.bot['bot_state']['ability_at'] = 0
        self.advance()
        self.assertTrue(any(e['k'] == 'heal' for e in self.match.effects))
        self.bot['cls'] = 'support'
        self.bot['reserve'] = 0
        self.bot['ability_charges'] = 1
        self.bot['bot_state']['ability_at'] = 0
        self.advance()
        self.assertTrue(any(e['k'] == 'ammo' for e in self.match.effects))

    def test_shot_sequence_counts_only_accepted_shots(self):
        for weapon in combat.WEAPONS:
            self.bot['weapon'] = weapon
            self.bot['mag'] = game.mag_size(weapon)
            self.bot['reload_end'] = 0
            self.bot['last_shot'] = 0
            before = self.bot['shot_seq']
            msg = dict(o=[0, 1.58, 0], d=[0, 1, 0])
            self.match._on_fire(self.bot, msg)
            self.match._on_fire(self.bot, msg)
            self.assertEqual(self.bot['shot_seq'], before+1, weapon)
            snapshot = next(q for q in self.match.players_payload() if q['i'] == self.bot['id'])
            self.assertEqual(snapshot['sq'], before+1)

    def test_burst_pause_and_jitter_use_milliseconds(self):
        st = self.bot['bot_state']
        st.update(foe_id=self.foe['id'], visible_id=self.foe['id'], sense_at=self.clock+1000,
                  react_until=0, jitter=0, jitter_at=0, burst_end=self.clock-1, burst_ready=self.clock+500)
        self.bot['pitch'] = -1.35
        with patch.object(self.match, '_on_fire', return_value=[]) as fire:
            self.advance(10)
            fire.assert_not_called()
            self.assertGreaterEqual(st['jitter_at']-self.clock, 150)
            self.assertLessEqual(st['jitter_at']-self.clock, 450)
            self.advance(600)
            self.assertGreater(st['burst_end'], self.clock)
            self.assertGreater(st['burst_ready'], st['burst_end'])

    def test_stuck_bot_commits_to_an_escape(self):
        self.foe['alive'] = False
        st = self.bot['bot_state']
        st['progress_pos'], st['progress_at'] = list(self.bot['pos']), 0
        self.advance()
        self.assertGreater(st['escape_until'], self.clock)
        self.assertEqual(st['route_at'], 0)

    def test_real_maps_simulation_stays_finite_and_outside_walls(self):
        for map_id in ('somme', 'italy'):
            combat.set_map(map_id)
            match = game.Match()
            for i in range(8):
                match.add_player('Bot '+str(i), None, cls=list(combat.CLASSES)[i % 4], bot=True)
            match.phase = 'live'
            for _ in range(600):
                self.clock += 100
                match.tick(100)
                for p in match.players.values():
                    self.assertTrue(all(math.isfinite(v) for v in p['pos']))
                    self.assertFalse(combat.blocked(p['pos'][0], p['pos'][2], p['pos'][1]), (map_id, p['pos']))
            self.assertGreater(sum(p['shot_seq'] for p in match.players.values()), 0, 'Bots never engage on '+map_id)


if __name__ == '__main__':
    unittest.main(verbosity=2)
