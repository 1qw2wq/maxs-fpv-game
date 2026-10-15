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

    def use_skill(self, name):
        self.bot['bot_skill'] = name
        self.bot['bot_state'] = bots.new_state(self.bot['team'], name)
        self.bot.update(pos=[0, 0, 0], yaw=0, pitch=0, reload_end=0)

    def test_tier_distribution_is_balanced_and_mostly_non_veteran(self):
        match = game.Match()
        match.fill_bots(12)
        for team in (0, 1):
            levels = [p['bot_skill'] for p in match.players.values() if p['team'] == team]
            self.assertEqual(levels, list(bots.SKILL_ROTATION))
            self.assertEqual(levels.count('veteran'), 1)
        for row in match.players_payload():
            self.assertEqual(row['ai'], match.players[row['i']]['bot_skill'])
        human = match.add_player('Human', None)
        self.assertEqual(human['bot_skill'], '')

    def test_skill_survives_respawn_and_missing_tactical_state(self):
        for name in bots.SKILLS:
            self.use_skill(name)
            self.match._spawn(self.bot)
            self.assertEqual(self.bot['bot_state']['skill'], name)
            self.bot['bot_state'] = None
            self.advance()
            self.assertEqual(self.bot['bot_state']['skill'], name)

    def test_reaction_ranges_and_no_firing_before_reaction(self):
        for name, skill in bots.SKILLS.items():
            self.use_skill(name)
            with patch.object(self.match, '_on_fire', return_value=[]) as fire:
                self.advance(25)
                st = self.bot['bot_state']
                remaining = st['react_until'] - self.clock
                self.assertGreaterEqual(remaining, skill['reaction'][0])
                self.assertLessEqual(remaining, skill['reaction'][1])
                self.assertFalse(fire.called)
                st.update(burst_end=self.clock+5000, burst_ready=self.clock+6000,
                          jitter=0, pitch_jitter=0, jitter_at=self.clock+6000)
                self.advance(remaining-1)
                self.assertFalse(fire.called)
                self.advance(2)
                self.assertTrue(fire.called, name)

    def test_tracking_turn_rate_differs_by_skill(self):
        turns = []
        for name, skill in bots.SKILLS.items():
            self.use_skill(name)
            self.bot['yaw'] = 90
            self.advance(100)
            turn = abs(bots._angdiff(90, self.bot['yaw']))
            self.assertAlmostEqual(turn, skill['turn'] * .1)
            turns.append(turn)
        self.assertEqual(turns, sorted(turns))
        self.assertEqual(len(set(turns)), 3)

    def test_aim_error_and_trigger_pauses_differ_by_skill(self):
        errors, pauses = [], []
        for name, skill in bots.SKILLS.items():
            self.use_skill(name)
            st = self.bot['bot_state']
            st.update(jitter=1, pitch_jitter=1, jitter_at=self.clock+5000)
            self.advance(100)
            errors.append(abs(bots._angdiff(0, self.bot['yaw'])))
            self.assertAlmostEqual(errors[-1], skill['aim_error'])
            tx, ty, tz = bots._target_point(self.foe)
            exact_pitch = math.degrees(math.atan2(ty-1.58, math.hypot(tx, tz)))
            self.assertAlmostEqual(self.bot['pitch']-exact_pitch, skill['aim_error']*.6)
            pause = st['burst_ready']-st['burst_end']
            self.assertGreaterEqual(pause, skill['pause'][0])
            self.assertLessEqual(pause, skill['pause'][1])
            pauses.append(sum(skill['pause'])/2)
        self.assertEqual(errors, sorted(errors, reverse=True))
        self.assertEqual(pauses, sorted(pauses, reverse=True))

    def test_all_skills_obey_walls_smoke_and_friendly_lane(self):
        for name in bots.SKILLS:
            self.use_skill(name)
            self.geometry([dict(t='wall', x=9, y=2, z=0, w=.2, h=4, d=20)])
            with patch.object(self.match, '_on_fire', return_value=[]) as fire:
                self.advance(100)
                self.assertIsNone(self.bot['bot_state']['foe_id'])
                self.assertFalse(fire.called)
            self.geometry([])
            self.match.effects = [dict(k='smoke', p=[9, 1, 0], r=4, start=0, until=self.clock+5000)]
            self.assertFalse(bots._can_see(self.match, self.bot, self.foe, (0, 1.58, 0)))
            self.match.effects = []
            friend = self.match.add_player('Friend', None)
            friend.update(team=self.bot['team'], pos=[9, 0, 0])
            self.assertTrue(bots._friendly_lane(self.match, self.bot, (0, 1.58, 0), (1, 0, 0), 18))
            self.match.remove_player(friend['id'])

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

    def test_lost_navigation_does_not_feed_lane_bias_back_into_yaw(self):
        # With no flow vector (including a reached goal), the old fallback
        # rotated its own yaw by the flank bias every tick: gun-holding circles.
        self.foe['alive'] = False
        for hz in (30, 60, 144):
            for lane in (-16, 16):
                self.bot.update(pos=[0, 0, 0], yaw=359, bot_state=bots.new_state(0))
                self.bot['bot_state']['lane'] = lane
                total_turn = 0
                with patch.object(combat, 'nav_dir', return_value=None):
                    for _ in range(hz):
                        before = self.bot['yaw']
                        self.advance(1000 / hz)
                        total_turn += abs(bots._angdiff(before, self.bot['yaw']))
                self.assertLess(total_turn, 1, (hz, lane, total_turn))
                self.assertGreater(math.hypot(self.bot['pos'][0], self.bot['pos'][2]), 4)

    def test_escape_heading_is_fixed_not_relative_to_changing_yaw(self):
        self.foe['alive'] = False
        st = self.bot['bot_state']
        st['progress_pos'], st['progress_at'] = list(self.bot['pos']), 0
        with patch.object(combat, 'nav_dir', return_value=(1, 0)):
            self.advance(33)
        first = list(self.bot['velocity'])
        for _ in range(12):
            # A corner or a new facing must not bend the chosen escape path.
            self.bot['yaw'] = (self.bot['yaw'] + 40) % 360
            with patch.object(combat, 'nav_dir', return_value=(0, 1)):
                self.advance(33)
            velocity = self.bot['velocity']
            dot = (first[0]*velocity[0]+first[2]*velocity[2]) / (math.hypot(first[0],first[2])*math.hypot(velocity[0],velocity[2]))
            self.assertGreater(dot, .999)

    def test_memory_and_objective_navigation_do_not_both_turn_the_body(self):
        self.foe['alive'] = False
        self.match.set_mode('control', 'somme')
        self.match.control.points = [dict(id='A', p=[-18, 0, 0], owner=-1,
                                         attacking=-1, contested=False)]
        st = self.bot['bot_state']
        st.update(last_seen=[0, 0, 18], seen_until=self.clock+4000)
        before = self.bot['yaw']
        self.advance(100)
        self.assertLessEqual(abs(bots._angdiff(before,self.bot['yaw'])), bots.SKILLS[self.bot["bot_state"]["skill"]]["turn"]*.1)
        self.assertAlmostEqual(self.bot['yaw'], bots.SKILLS[self.bot["bot_state"]["skill"]]["turn"]*.6*.1)

    def test_investigated_last_seen_position_expires(self):
        self.foe['alive'] = False
        st = self.bot['bot_state']
        st.update(last_seen=[.2, 0, 0], seen_until=self.clock+4000)
        self.advance(33)
        self.assertLessEqual(st['seen_until'], self.clock)

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
