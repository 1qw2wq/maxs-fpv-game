"""Grenade authority/physics regressions: python tools/test-grenades.py."""
import math
from pathlib import Path
import random
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'public' / 'engine'))
import bots
import combat
import game
import throwing


class GrenadeTests(unittest.TestCase):
    def setUp(self):
        self.clock = 100000.0
        self.patches = [patch.object(m, 'now_ms', lambda: self.clock) for m in (game, bots)]
        for p in self.patches:
            p.start()
        self.match = game.Match()
        self.owner = self.match.add_player('Thrower', None)
        self.enemy = self.match.add_player('Enemy', None)
        self.ally = self.match.add_player('Ally', None)
        for player, team, pos in ((self.owner, 0, [-10, 0, 0]), (self.enemy, 1, [0, 0, 0]), (self.ally, 0, [0, 0, 1])):
            player.update(team=team, pos=pos, hp=100, alive=True)
        self.match.phase = 'live'
        self.geometry([])

    def tearDown(self):
        for p in self.patches:
            p.stop()
        combat.set_map(combat.DEFAULT_MAP_ID)

    def geometry(self, boxes):
        combat.BOUNDS = dict(minX=-50, maxX=50, minZ=-50, maxZ=50)
        combat.GROUND_Y = combat.FLOOR_BASE = 0
        combat.GROUND_BOX = None
        combat.SOLID = boxes
        combat._build_grid()

    def throw(self, kind='frag', **kwargs):
        return self.match.handle(self.owner['id'], dict(t='grenade', kind=kind, d=[1, 0.2, 0], power=0.7, **kwargs))

    def effect(self, kind='frag', point=None):
        self.throw(kind)
        e = self.match.effects[-1]
        e['p'] = point or [0, 0.1, 0]
        return e

    def tick_to(self, time, dt=33.333):
        self.clock = time
        self.match.tick(dt)
        return self.match.drain()

    def test_gravity_ground_and_fuse(self):
        flight = throwing.simulate([0, 1.58, 0], [1, 0.2, 0], 0.7, 'frag')
        self.assertEqual(flight['delay'], 2600)
        self.assertGreater(flight['bounces'], 0)
        self.assertGreater(max(p[2] for p in flight['path']), 1.58)
        self.assertTrue(all(p[2] >= 0.089 for p in flight['path']))
        self.assertGreaterEqual(flight['p'][1], 0.09)
        self.assertLess(flight['p'][1], 0.2)
        self.assertLess(len(flight['path']), 512)
        self.assertTrue(all(a[0] < b[0] for a, b in zip(flight['path'], flight['path'][1:])))

    def test_charge_and_inherited_motion_change_range(self):
        low = throwing.simulate([0, 1.58, 0], [1, 0, 0], 0, 'smoke')
        high = throwing.simulate([0, 1.58, 0], [1, 0, 0], 1, 'smoke')
        moving = throwing.simulate([0, 1.58, 0], [1, 0, 0], 1, 'smoke', [4, 0, 0])
        self.assertGreater(high['p'][0], low['p'][0]+8)
        self.assertGreater(moving['p'][0], high['p'][0])

    def test_sweep_no_tunnelling_even_across_thin_wall(self):
        self.geometry([dict(t='wall', x=2, y=3, z=0, w=0.02, h=6, d=20)])
        hit = throwing.sweep([0, 1.5, 0], [20, 1.5, 0], 0.09)
        self.assertIsNotNone(hit)
        self.assertLess(hit[0], 0.1)
        flight = throwing.simulate([0, 1.58, 0], [1, 0, 0], 1, 'frag')
        self.assertTrue(all(row[1] < 1.91 for row in flight['path']))
        self.assertGreater(flight['bounces'], 0)

    def test_ramp_slope_not_its_bounding_box(self):
        ramp = dict(t='ramp', x=0, y=1, z=0, w=4, h=2, d=4, ax='x', y0=0, y1=2)
        self.geometry([ramp])
        # At x=-1 the ramp is only .5 high, not the 2m bounding-box roof.
        self.assertIsNone(throwing.sweep([-1, 1.5, -1], [-1, 1.5, 1], 0.09))
        hit = throwing.sweep([-1, 1.5, 0], [-1, 0, 0], 0.09)
        self.assertIsNotNone(hit)
        self.assertGreater(hit[1][1], 0.8)
        y = 1.5-1.5*hit[0]
        self.assertAlmostEqual(y, 0.5+0.09*math.sqrt(1.25), places=5)

    def test_bounds_reflect_instead_of_escaping(self):
        self.geometry([])
        combat.BOUNDS.update(minX=-2, maxX=2, minZ=-2, maxZ=2)
        flight = throwing.simulate([0, 1.58, 0], [1, 0.2, 0.6], 1, 'frag')
        self.assertTrue(all(abs(row[1]) <= 1.911 and abs(row[3]) <= 1.911 for row in flight['path']))
        self.assertGreaterEqual(flight['bounces'], 2)

    def test_incendiary_and_flare_ignite_on_impact(self):
        for kind in ('incendiary', 'flare'):
            f = throwing.simulate([0, 1.58, 0], [1, 0, 0], 0.6, kind)
            self.assertLess(f['delay'], 1500)
            self.assertGreaterEqual(f['delay'], 80)
            self.assertGreater(f['bounces'], 0)
        high = throwing.simulate([0, 40, 0], [0, 1, 0], 1, 'incendiary')
        self.assertEqual(high['delay'], 3000)  # bounded safety fuse, even in air

    def test_incendiary_wall_burst_spills_to_floor_not_through_roof(self):
        self.geometry([dict(t='wall',x=-5,y=3,z=0,w=.03,h=6,d=20)])
        fx = self.throw('incendiary')[0]['msg']['fx']
        self.assertGreater(fx['path'][-1][2], 1)
        self.assertAlmostEqual(fx['p'][1], .09)
        self.assertLess(fx['p'][0], -5)

    def test_authority_ignores_client_landing_and_velocity(self):
        a = self.throw(p=[49, 1000, 49], velocity=[9999, 9999, 9999])[0]['msg']['fx']
        b = self.throw(p=[-49, -1000, -49])[0]['msg']['fx']
        for field in ('p', 'path', 'delay', 'bounces'):
            self.assertEqual(a[field], b[field])
        self.assertNotIn('owner', a)
        self.assertNotIn('until', a)
        self.assertLess(math.dist(self.owner['pos'], a['p']), 35)

    def test_invalid_dead_and_nonlive_throws_rejected(self):
        for msg in (dict(kind='bad'), dict(kind=[]), dict(d=[float('nan'), 0, 0]), dict(d=[1]), dict(d=[0, 0, 0]), dict(power=float('inf'))):
            base = dict(t='grenade', kind='frag', d=[1, 0, 0])
            base.update(msg)
            self.assertEqual(self.match.handle(self.owner['id'], base), [])
        self.assertEqual(self.owner['grenades'], 2)
        self.owner['alive'] = False
        self.assertEqual(self.throw(), [])
        self.owner['alive'], self.match.phase = True, 'ended'
        self.assertEqual(self.throw(), [])

    def test_inventory_shared_cooldown_and_respawn(self):
        self.assertEqual(len(self.throw('frag')), 1)
        self.assertEqual(len(self.throw('smoke')), 1)
        self.assertEqual(self.throw('flash'), [])
        me = self.match.me_payload(self.owner)
        self.assertEqual((me['grenades'], me['grenadeIn']), (0, 24000))
        self.clock += 23999
        self.assertEqual(self.throw(), [])
        self.clock += 1
        self.assertEqual(self.match.me_payload(self.owner)['grenades'], 2)
        self.assertEqual(len(self.throw('incendiary')), 1)
        self.match._spawn(self.owner)
        self.assertEqual(self.owner['grenades'], 2)
        self.assertEqual(self.owner['grenade_ready'], 0)

    def test_frag_inert_before_fuse_and_blast_only_once(self):
        e = self.effect()
        self.tick_to(e['start']-1)
        self.assertEqual(self.enemy['hp'], 100)
        events = self.tick_to(e['start']+1)
        self.assertFalse(self.enemy['alive'])
        self.assertEqual(self.ally['hp'], 100)
        self.assertEqual(self.owner['hp'], 100)
        self.assertEqual(self.owner['kills'], 1)
        self.assertTrue(any(ev['msg'].get('w') == 'frag' for ev in events))
        self.tick_to(e['start']+34)
        self.assertEqual(self.owner['kills'], 1)

    def test_blast_falloff_and_cover(self):
        e = self.effect(point=[0, 0.1, 0])
        self.enemy['pos'] = [5, 0, 0]
        self.tick_to(e['start']+1)
        self.assertGreater(self.enemy['hp'], 50)
        self.assertLess(self.enemy['hp'], 100)
        self.owner['grenades'] = 2
        e = self.effect(point=[0, 0.1, 0])
        self.enemy['hp'] = 100
        self.geometry([dict(t='wall', x=2, y=2, z=0, w=0.03, h=4, d=10)])
        self.tick_to(e['start']+1)
        self.assertEqual(self.enemy['hp'], 100)

    def test_suicide_no_score_or_kill_farming(self):
        self.owner['pos'] = [0, 0, 0]
        self.enemy['pos'] = [40, 0, 0]
        e = self.effect()
        self.tick_to(e['start']+1)
        self.assertFalse(self.owner['alive'])
        self.assertEqual(self.owner['kills'], 0)
        self.assertEqual(self.match.scores, [0, 0])

    def test_fire_damage_is_rate_independent_and_stops_at_expiry(self):
        e = self.effect('incendiary')
        self.tick_to(e['start']-1)
        self.assertEqual(self.enemy['hp'], 100)
        self.tick_to(e['start']+500, 500)
        self.assertAlmostEqual(self.enemy['hp'], 86)
        self.assertEqual(self.ally['hp'], 100)
        self.tick_to(e['start']+1000, 500)
        self.assertAlmostEqual(self.enemy['hp'], 72)
        e['until'] = self.clock + 50
        self.tick_to(self.clock+100, 100)
        self.assertAlmostEqual(self.enemy['hp'], 70.6)
        self.tick_to(self.clock+100)
        self.assertAlmostEqual(self.enemy['hp'], 70.6)

    def test_fire_respects_cover_and_can_outlive_owner(self):
        e = self.effect('incendiary', [0, 0.1, 0])
        self.enemy['pos'] = [3, 0, 0]
        self.geometry([dict(t='wall', x=1.5, y=2, z=0, w=0.03, h=4, d=8)])
        self.tick_to(e['start']+100, 100)
        self.assertEqual(self.enemy['hp'], 100)
        self.geometry([])
        self.match.remove_player(self.owner['id'])
        self.enemy['hp'] = 1
        events = self.tick_to(self.clock+100, 100)
        self.assertFalse(self.enemy['alive'])
        self.assertTrue(any(ev['msg'].get('w') == 'incendiary' for ev in events))

    def test_flash_facing_cover_and_bot_blindness(self):
        e = self.effect('flash', [0, 1.5, 0])
        self.enemy.update(pos=[4, 0, 0], yaw=180, pitch=0)
        self.ally.update(pos=[-4, 0, 0], yaw=180, pitch=0)
        self.tick_to(e['start']+1)
        self.assertEqual(self.enemy['hp'], 100)
        self.assertGreater(self.enemy['flash_until'], self.ally['flash_until'])
        self.assertFalse(bots._can_see(self.match, self.enemy, self.ally, game.eye_pos(self.enemy)))
        e = self.effect('flash', [0, 1.5, 0])
        self.enemy['flash_until'] = 0
        self.geometry([dict(t='wall', x=2, y=2, z=0, w=0.03, h=4, d=8)])
        self.tick_to(e['start']+1)
        self.assertEqual(self.enemy['flash_until'], 0)

    def test_flash_is_opaque_at_edge_but_not_outside_range(self):
        e = self.effect('flash', [0, 1.5, 0])
        self.enemy.update(pos=[13.7, 0, 0], yaw=0, pitch=0)
        self.ally.update(pos=[20, 0, 0])
        events = self.tick_to(e['start']+1)
        hits = [ev for ev in events if ev['msg'].get('t') == 'flash']
        enemy = next(ev['msg'] for ev in hits if ev['to'] == self.enemy['id'])
        self.assertEqual(enemy['strength'], 1)
        self.assertGreaterEqual(enemy['ms'], 200)
        self.assertFalse(any(ev['to'] == self.ally['id'] for ev in hits))

    def test_late_join_includes_ongoing_fire_smoke_and_flight_age(self):
        e = self.effect('incendiary')
        self.clock = e['start']+1000
        snapshot = self.match.standing_crates()[0]
        self.assertAlmostEqual(snapshot['age'], e['delay']+1000)
        self.assertNotIn('owner', snapshot)
        self.assertNotIn('start', snapshot)
        self.clock = e['until']+1
        self.assertEqual(self.match.standing_crates(), [])

    def test_delayed_tick_cannot_drop_a_frag_without_detonating(self):
        e = self.effect()
        self.tick_to(e['until']+1000, 33)
        self.assertFalse(self.enemy['alive'])
        self.assertEqual(self.owner['kills'], 1)

    def test_q_smoke_and_flare_use_real_physics_and_keep_separate_inventory(self):
        for cls, kind in (('assault', 'smoke'), ('scout', 'flare')):
            self.owner.update(cls=cls, ability_ready=0, ability_charges=2)
            events = self.match.handle(self.owner['id'], dict(t='ability', d=[1, 0.1, 0], power=0.8, p=[40, 99, 40]))
            fx = events[0]['msg']['fx']
            self.assertEqual(fx['k'], kind)
            self.assertGreater(len(fx['path']), 2)
            self.assertEqual(fx['path'][-1][0], fx['delay'])
            self.assertEqual(self.owner['grenades'], 2)

    def test_real_maps_finite_bounded_grounded_flights(self):
        rng = random.Random(2026)
        for map_id in ('somme', 'italy'):
            combat.set_map(map_id)
            for team in (0, 1):
                for kind in ('frag', 'incendiary', 'smoke', 'flash', 'flare'):
                    for pitch in (-0.8, 0.0, 0.7):
                        pos, _ = combat.random_spawn(team, rng)
                        origin = [pos[0], pos[1]+1.58, pos[2]]
                        f = throwing.simulate(origin, [1, pitch, 0.2], 0.9, kind)
                        self.assertLess(len(f['path']), 512)
                        self.assertTrue(all(math.isfinite(v) for row in f['path'] for v in row))
                        self.assertTrue(all(row[2] >= combat.FLOOR_BASE+0.089 for row in f['path']))
                        self.assertTrue(all(combat.BOUNDS['minX'] <= row[1] <= combat.BOUNDS['maxX'] for row in f['path']))


def fixtures():
    """Emit real-map fixtures for the browser's independently executed solver."""
    import json
    worlds = []
    rng = random.Random(2026)
    for map_id in ('somme', 'italy', 'ramp-x', 'ramp-z', 'thin-wall'):
        combat.set_map('somme' if map_id not in ('somme', 'italy') else map_id)
        if map_id.startswith('ramp') or map_id == 'thin-wall':
            combat.SOLID = [dict(t='ramp', x=0, y=1, z=0, w=4, h=2, d=4, ax=map_id[-1], y0=0, y1=2)] if map_id.startswith('ramp') else [dict(t='wall', x=2, y=3, z=0, w=0.02, h=6, d=20)]
            combat._build_grid()
        cases = []
        for team in (0, 1):
            for kind in ('frag', 'incendiary', 'smoke', 'flash', 'flare'):
                for pitch, power in ((-.7, 0.1), (0, .6), (.7, 1)):
                    pos, _ = combat.random_spawn(team, rng)
                    origin = [pos[0], pos[1]+1.58, pos[2]] if map_id in ('somme','italy') else [-1, 3, 0]
                    direction, inherited = [1, pitch, .2], [2, .5, -1]
                    cases.append(dict(origin=origin, direction=direction, power=power, kind=kind, inherited=inherited,
                                      expected=throwing.simulate(origin,direction,power,kind,inherited)))
        worlds.append(dict(id=map_id,solid=combat.SOLID,bounds=combat.BOUNDS,floorBase=combat.FLOOR_BASE,cases=cases))
    print(json.dumps(dict(worlds=worlds, config=combat.THROW, definitions=list(throwing.GRENADES.values()), maxSpeed=combat.COMBAT['maxMoveSpeed'])))


if __name__ == '__main__':
    if '--fixtures' in sys.argv:
        fixtures()
    else:
        unittest.main(verbosity=2)
