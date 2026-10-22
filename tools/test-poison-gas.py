"""Poison/mask authority regressions: python tools/test-poison-gas.py (stdlib only)."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('grenade_tests', Path(__file__).with_name('test-grenades.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
game, combat, bots = base.game, base.combat, base.bots


class PoisonGasTests(unittest.TestCase):
    setUp = base.GrenadeTests.setUp
    tearDown = base.GrenadeTests.tearDown
    geometry = base.GrenadeTests.geometry
    throw = base.GrenadeTests.throw
    effect = base.GrenadeTests.effect
    tick_to = base.GrenadeTests.tick_to

    def cloud(self, duration=12000):
        self.owner['grenades'] = 2
        e = self.effect('gas')
        e.update(start=self.clock, until=self.clock+duration, dur=duration)
        return e

    def mask(self, player=None, on=True, **extra):
        p = player or self.enemy
        return self.match.handle(p['id'], dict(t='mask', on=on, life=p['life'], **extra))

    def test_registered_tuning_and_shared_inventory(self):
        g = base.throwing.GRENADES['gas']
        self.assertEqual((g['fuseMs'], g['dur'], g['radius'], g['damagePerSecond']), (1800, 12000, 6.5, 18))
        self.assertTrue(self.throw('gas'))
        self.assertTrue(self.throw('frag'))
        self.assertEqual(self.owner['grenades'], 0)
        self.assertEqual(self.throw('gas'), [])

    def test_inert_before_fuse(self):
        e = self.effect('gas')
        self.tick_to(e['start']-1)
        self.assertEqual(self.enemy['hp'], 100)
        self.assertEqual(self.match.me_payload(self.enemy)['gas'], 0)

    def test_18_damage_per_second_self_enemy_not_ally(self):
        self.owner['pos'] = [0, 0, 0]
        e = self.cloud()
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertAlmostEqual(self.enemy['hp'], 82)
        self.assertAlmostEqual(self.owner['hp'], 82)
        self.assertEqual(self.ally['hp'], 100)
        self.assertEqual(self.match.me_payload(self.enemy)['gas'], 1)

    def test_seal_not_immediate_and_partial_tick_is_exact(self):
        e = self.cloud()
        self.mask()
        self.assertEqual(self.match.me_payload(self.enemy)['maskIn'], 750)
        self.assertFalse(game.mask_protected(self.enemy, self.clock))
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertAlmostEqual(self.enemy['hp'], 100-18*.75)
        self.assertTrue(game.mask_protected(self.enemy, self.clock))
        self.assertEqual(self.match.me_payload(self.enemy)['maskIn'], 0)

    def test_fully_sealed_mask_blocks_gas_and_still_reports_exposure(self):
        self.mask()
        self.clock += 1000
        e = self.cloud()
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        me = self.match.me_payload(self.enemy)
        self.assertEqual((self.enemy['hp'], me['mask'], me['maskProtected'], me['gas']), (100, 1, 1, 1))

    def test_removal_restores_damage_and_rewear_requires_new_seal(self):
        self.mask()
        self.clock += 1000
        e = self.cloud()
        self.mask(on=False)
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertEqual(self.enemy['hp'], 82)
        self.mask()
        self.assertFalse(game.mask_protected(self.enemy, self.clock))
        self.assertEqual(self.match.me_payload(self.enemy)['maskIn'], 750)

    def test_sealing_repeated_packets_idempotent_and_timestamps_ignored(self):
        self.mask(maskProtected=True, mask_ready=0)
        ready = self.enemy['mask_ready']
        self.clock += 100
        self.mask()
        self.assertEqual(self.enemy['mask_ready'], ready)
        self.assertFalse(game.mask_protected(self.enemy, self.clock))

    def test_malformed_commands_do_not_equip(self):
        for value in (1, 0, 'true', [], {}, None):
            self.match.handle(self.enemy['id'], dict(t='mask', on=value))
            self.assertFalse(self.enemy['mask_on'])
        self.match.handle(self.enemy['id'], dict(t='mask'))
        self.assertFalse(self.enemy['mask_on'])

    def test_dead_ended_and_stale_life_commands_rejected(self):
        self.match.handle(self.enemy['id'], dict(t='mask', on=True, life=self.enemy['life']-1))
        self.assertFalse(self.enemy['mask_on'])
        self.enemy['alive'] = False
        self.mask()
        self.assertFalse(self.enemy['mask_on'])
        self.enemy['alive'] = True
        self.match.phase = 'ended'
        self.mask()
        self.assertFalse(self.enemy['mask_on'])

    def test_death_and_respawn_clear_mask_and_exposure(self):
        self.mask()
        self.enemy['gas_until'] = self.clock+1000
        self.match._kill(self.owner, self.enemy, False)
        self.assertEqual((self.enemy['mask_on'], self.enemy['mask_ready'], self.enemy['gas_until']), (False, 0, 0))
        self.match._spawn(self.enemy)
        me = self.match.me_payload(self.enemy)
        self.assertEqual((me['mask'], me['maskProtected'], me['gas']), (0, 0, 0))

    def test_public_private_state_do_not_grant_other_immunities(self):
        self.mask()
        self.clock += 1000
        row = next(p for p in self.match.players_payload() if p['i'] == self.enemy['id'])
        self.assertEqual(row['mk'], 1)
        self.assertEqual(self.match.me_payload(self.enemy)['maskProtected'], 1)
        e = self.effect('incendiary')
        e.update(start=self.clock, until=self.clock+7000)
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertEqual(self.enemy['hp'], 72)

    def test_mask_does_not_stop_frag(self):
        self.mask()
        self.clock += 1000
        e = self.effect('frag', [2, .1, 0])
        self.match._tick_grenade(e, self.clock, 33)
        self.assertLess(self.enemy['hp'], 100)

    def test_mask_does_not_stop_flash(self):
        self.mask()
        self.clock += 1000
        e = self.effect('flash')
        self.match._tick_grenade(e, self.clock, 33)
        self.assertGreater(self.enemy['flash_until'], self.clock)

    def test_wall_blocks_poison(self):
        e = self.cloud()
        self.enemy['pos'] = [2, 0, 0]
        self.geometry([dict(t='wall', x=1, y=2, z=0, w=.1, h=4, d=20)])
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertEqual(self.enemy['hp'], 100)
        self.assertEqual(self.match.me_payload(self.enemy)['gas'], 0)

    def test_floor_blocks_poison_between_storeys(self):
        e = self.cloud()
        self.enemy['pos'] = [0, 2, 0]
        self.geometry([dict(t='box', x=0, y=1.5, z=0, w=10, h=.2, d=10)])
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertEqual(self.enemy['hp'], 100)

    def test_radius_and_spawn_shield(self):
        e = self.cloud()
        self.enemy['pos'] = [7, 0, 0]
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertEqual(self.enemy['hp'], 100)
        self.enemy.update(pos=[0, 0, 0], spawned_at=self.clock, shield_until=self.clock+1000, shield_cancelled=False)
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertEqual(self.enemy['hp'], 100)

    def test_rate_independence_and_exact_last_partial_tick(self):
        for step in (16, 33, 100, 250, 700):
            self.enemy.update(hp=100, mask_on=False)
            start = self.clock
            e = self.cloud(duration=1250)
            e['until'] = start+1250
            for elapsed in range(step, 1250+step, step):
                self.clock = start+elapsed
                self.match._tick_grenade(e, self.clock, step)
            self.assertAlmostEqual(self.enemy['hp'], 77.5, places=6)

    def test_expiry_pruning_keeps_last_partial_damage_without_extra_ticks(self):
        e = self.cloud(duration=1250)
        start = self.clock
        for elapsed in (500, 1000, 1500, 2000):
            self.tick_to(start+elapsed, 500)
        self.assertAlmostEqual(self.enemy['hp'], 77.5)
        self.assertNotIn(e, self.match.effects)
        self.assertEqual(self.match.me_payload(self.enemy)['gas'], 0)

    def test_vision_obscures_bots_and_flares_even_with_mask(self):
        e = self.cloud()
        self.mask()
        self.assertTrue(self.match._in_smoke([0, 1, 0]))
        self.assertTrue(self.match._path_in_smoke([-10, 1, 0], [10, 1, 0]))
        self.clock = e['until']
        self.assertFalse(self.match._in_smoke([0, 1, 0]))
        self.assertFalse(self.match._path_in_smoke([-10, 1, 0], [10, 1, 0]))

    def test_late_join_gets_remaining_age_and_mask(self):
        self.mask()
        e = self.cloud()
        self.clock += 1234
        payload = self.match.standing_crates()[-1]
        self.assertEqual(payload['k'], 'gas')
        self.assertEqual(payload['age'], 1234+e['delay'])
        self.assertNotIn('owner', payload)
        self.assertNotIn('until', payload)
        self.assertEqual(next(p for p in self.match.players_payload() if p['i']==self.enemy['id'])['mk'], 1)

    def test_poison_survives_owner_disconnect_and_records_gas_kill(self):
        e = self.cloud()
        self.match.remove_player(self.owner['id'])
        self.enemy['hp'] = 10
        self.clock += 1000
        self.match._tick_grenade(e, self.clock, 1000)
        self.assertFalse(self.enemy['alive'])
        kill = next(ev['msg'] for ev in self.match.drain() if ev['msg']['t']=='kill')
        self.assertEqual(kill['w'], 'gas')
        self.assertEqual(kill['k']['id'], self.owner['id'])

    def test_bots_react_to_exposure_with_normal_delay_and_remove_after_leaving(self):
        for level in bots.SKILLS:
            p = self.match.add_player('Gas bot', None, bot=True)
            p.update(pos=[0, 0, 0], team=1, hp=100, shield_until=0, shield_cancelled=True,
                     bot_skill=level, bot_state=bots.new_state(1, level))
            e = self.cloud()
            start = self.clock
            with patch.object(bots, '_steer', return_value=(None, None)):
                for elapsed in range(100, 2401, 100):
                    self.clock = start+elapsed
                    self.match._tick_grenade(e, self.clock, 100)
                    bots.think(self.match, p, 100)
                    if elapsed == 100:
                        self.assertFalse(p['mask_on'])
                self.assertTrue(game.mask_protected(p, self.clock), level)
                self.assertLess(p['hp'], 100, 'No instant/privileged bot immunity')
                hp = p['hp']
                self.clock += 100
                self.match._tick_grenade(e, self.clock, 100)
                self.assertEqual(p['hp'], hp)
                p['gas_until'] = 0
                self.clock += 2200
                bots.think(self.match, p, 100)
                self.assertFalse(p['mask_on'])
            self.match.remove_player(p['id'])

    def test_bot_difficulty_reset_does_not_leave_mask_on_forever(self):
        p = self.match.add_player('Masked bot', None, bot=True)
        p.update(mask_on=True, mask_ready=self.clock-1, gas_until=0)
        self.match.set_bot_difficulty('elite')
        bots.think(self.match, p, 33)
        self.clock += 2200
        bots.think(self.match, p, 33)
        self.assertFalse(p['mask_on'])

    def test_all_maps_apply_same_poison_and_mask_rules(self):
        for map_id in ('somme', 'italy', 'proc_city'):
            combat.set_map(map_id)
            pos, _ = combat.random_spawn(1, self.match.rng)
            self.enemy.update(pos=list(pos), hp=100, shield_until=0, mask_on=False)
            e = self.cloud()
            e['p'] = [pos[0], pos[1]+.1, pos[2]]
            self.clock += 1000
            self.match._tick_grenade(e, self.clock, 1000)
            self.assertEqual(self.enemy['hp'], 82, map_id)
            self.mask()
            self.clock += 1000
            self.match._tick_grenade(e, self.clock, 1000)
            hp = self.enemy['hp']
            self.clock += 1000
            self.match._tick_grenade(e, self.clock, 1000)
            self.assertEqual(self.enemy['hp'], hp, map_id)


if __name__ == '__main__':
    unittest.main(verbosity=2)
