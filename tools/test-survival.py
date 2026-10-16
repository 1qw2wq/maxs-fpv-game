"""Spawn shield, authoritative movement/recovery and continuous collision regressions."""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'public' / 'engine'))
import combat
import game


class SurvivalTests(unittest.TestCase):
    def setUp(self):
        self.clock = 100000.
        self.timer = patch.object(game, 'now_ms', lambda: self.clock)
        self.timer.start()
        self.match = game.Match()
        self.owner = self.match.add_player('Shooter', None)
        self.target = self.match.add_player('Spawn', None)
        self.owner.update(team=0, pos=[0,0,0], safe_pos=[0,0,0])
        self.target.update(team=1, pos=[10,0,0], safe_pos=[10,0,0])
        combat.SOLID=[]; combat._build_grid(); combat.GROUND_BOX=None
        combat.GROUND_Y=combat.FLOOR_BASE=0
        combat.BOUNDS=dict(minX=-50,maxX=50,minZ=-50,maxZ=50)
        game._seed_hist(self.target,self.clock)

    def tearDown(self):
        self.timer.stop()
        combat.set_map(combat.DEFAULT_MAP_ID)

    def shoot(self):
        self.owner.update(last_shot=0,mag=100)
        return self.match._on_fire(self.owner,dict(d=[1,0,0]))

    def test_exact_five_seconds_all_guns_humans_and_bots(self):
        for bot in (False,True):
            for wid,w in combat.WEAPONS.items():
                if w.get('utility'):continue  # Flares reveal; they never apply bullet damage.
                self.owner.update(bot=bot,weapon=wid)
                for elapsed in (0,4999,5000):
                    self.clock=100000+elapsed
                    self.target.update(hp=1000,alive=True,suppress_until=0,last_hit_ms=123)
                    result=self.shoot()
                    self.assertEqual(self.target['hp']==1000,elapsed<5000,(bot,wid,elapsed))
                    if elapsed<5000:
                        self.assertEqual(result,[])
                        self.assertEqual(self.target['suppress_until'],0)
                        self.assertEqual(self.target['last_hit_ms'],123)

    def test_shield_deadline_cannot_extend_same_life(self):
        self.target['shield_until']=float('inf')
        self.clock+=5000
        self.assertEqual(game.shield_remaining(self.target,self.clock),0)
        life=self.target['life']
        self.match._ensure_safe_position(self.target)
        self.match._on_reload(self.target)
        self.match._on_switch(self.target,{})
        self.assertEqual(self.target['life'],life)
        self.assertEqual(game.shield_remaining(self.target,self.clock),0)
        self.match._spawn(self.target)
        self.assertEqual(self.target['life'],life+1)
        self.assertEqual(self.match.me_payload(self.target)['life'],life+1)
        self.assertEqual(game.shield_remaining(self.target,self.clock),5000)

    def test_real_map_shield_expiry_all_guns_and_bots(self):
        for meta in combat.MAPS:
            combat.set_map(meta['id'])
            found=None
            for spawn in combat.MAP_DATA['spawns']['0']:
                base=[spawn['x'],spawn['y'],spawn['z']]
                for dx,dz in ((3,0),(-3,0),(0,3),(0,-3),(5,0),(0,5)):
                    q=[base[0]+dx,combat.floor_at(base[0]+dx,base[2]+dz,base[1]),base[2]+dz]
                    if combat.blocked(q[0],q[2],q[1]):continue
                    eye=[base[0],base[1]+1.58,base[2]]
                    target=[q[0],q[1]+1.3,q[2]]
                    if not combat.has_line_of_sight(eye,target):continue
                    found=(base,q,combat.normalize(tuple(target[i]-eye[i] for i in range(3))))
                    break
                if found:break
            self.assertIsNotNone(found,meta['id'])
            base,q,direction=found
            self.owner.update(pos=base,safe_pos=base)
            self.target.update(pos=q,safe_pos=q,alive=True)
            for bot in (False,True):
                for wid,w in combat.WEAPONS.items():
                    if w.get('utility'):continue
                    self.clock+=10000
                    start=self.clock
                    self.owner.update(bot=bot,weapon=wid,last_shot=0,equip_until=0,reload_end=0,mag=100)
                    self.target.update(hp=1000,alive=True,spawned_at=start,shield_until=start+5000)
                    game._seed_hist(self.target,self.clock)
                    for elapsed in (4999,5000,15000):
                        self.clock=start+elapsed
                        self.owner.update(last_shot=0,mag=100)
                        self.target['hp']=1000
                        self.match._on_fire(self.owner,dict(d=direction))
                        self.assertEqual(self.target['hp']==1000,elapsed<5000,(meta['id'],bot,wid,elapsed))

    def test_bullet_cannot_pass_shield_and_hit_body_behind(self):
        behind=self.match.add_player('Behind',None)
        behind.update(team=1,pos=[15,0,0],shield_until=0)
        game._seed_hist(behind,self.clock)
        self.shoot()
        self.assertEqual(behind['hp'],100)
        self.assertEqual(self.owner['mag'],99)

    def test_grenades_fire_and_flash_respect_shield(self):
        for kind in ('frag','incendiary','flare'):
            self.assertEqual(self.match._grenade_damage(dict(by=self.owner['id'],k=kind,p=[10,0,0]),self.target,1000,'fire'),[])
            self.assertEqual(self.target['hp'],100)
        e=dict(k='flash',by=self.owner['id'],team=0,p=[10,0,0],r=14,triggered=False)
        self.match._tick_grenade(e,self.clock,100)
        self.assertEqual(self.target['flash_until'],0)
        self.clock+=5000
        self.match._grenade_damage(dict(by=self.owner['id'],k='incendiary',p=[10,0,0]),self.target,10,'fire')
        self.assertEqual(self.target['hp'],90)
        e['triggered']=False
        self.match._tick_grenade(e,self.clock,100)
        self.assertGreater(self.target['flash_until'],self.clock)

    def test_respawn_and_new_round_reset_full_duration(self):
        for bot in (False,True):
            self.target['bot']=bot
            self.clock+=20000
            self.match._spawn(self.target)
            self.assertEqual(game.shield_remaining(self.target,self.clock),5000)
            self.assertEqual(self.match.me_payload(self.target)['shieldMs'],5000)
        self.match.phase='ended';self.match.ended_at=self.clock-10001
        self.match.tick(33)
        for p in self.match.players.values():
            self.assertEqual(game.shield_remaining(p,self.clock),5000)

    def test_payload_expiry_death_and_forged_client_claims(self):
        self.clock+=4999
        self.assertEqual(self.match.me_payload(self.target)['shieldMs'],1)
        row=next(p for p in self.match.players_payload() if p['i']==self.target['id'])
        self.assertEqual(row['sh'],1)
        self.clock+=1
        self.match._on_input(self.target,dict(p=[10,0,0],shieldMs=5000,s=dict(shield=True)))
        self.assertEqual(self.match.me_payload(self.target)['shieldMs'],0)
        self.match._spawn(self.target);self.target['alive']=False
        self.assertEqual(self.match.me_payload(self.target)['shieldMs'],0)

    def test_invalid_body_recovers_without_hp_ammo_or_shield_reset(self):
        self.target.update(hp=37,mag=4)
        expiry=self.target['shield_until']
        for bad in ([999,0,0],[-999,0,0],[0,0,999],[0,-999,0],[math.nan,0,0],[0,math.inf,0]):
            self.target['pos']=bad
            self.match._ensure_safe_position(self.target)
            self.assertEqual(self.target['pos'],[10,0,0])
            self.assertEqual(self.target['velocity'],[0,0,0])
            self.assertEqual(self.target['hp'],37)
            self.assertEqual(self.target['mag'],4)
            self.assertEqual(self.target['shield_until'],expiry)
            self.assertTrue(all(list(sample[1:])==[10,0,0] for sample in self.target['hist']))
            self.assertEqual(self.match.me_payload(self.target)['recovery']['p'],[10,0,0])
        self.assertEqual(self.target['recovery_seq'],6)

    def test_thin_walls_cannot_be_tunnelled_diagonally_or_on_late_packets(self):
        combat.SOLID=[dict(t='wall',x=2,y=2,z=0,w=.002,h=4,d=20)];combat._build_grid()
        for z in (-3,0,3):
            x,endz=combat.resolve_move([0,0,0],[8,0,z],0)
            self.assertLess(x,2-combat.PLAYER_RADIUS)
            self.assertAlmostEqual(endz,z)
            self.assertFalse(combat.blocked(x,endz,0))
        self.owner['last_input']=self.clock-500
        self.match._on_input(self.owner,dict(p=[8,-100,0],s={}))
        self.assertLess(self.owner['pos'][0],1.65)
        self.assertEqual(self.owner['pos'][1],0)

    def test_model_backstop_recovers_but_supported_basement_is_allowed(self):
        combat.FLOOR_BASE=-3
        combat.SOLID=[dict(t='floor',x=10,y=-.1,z=0,w=4,h=.2,d=4),
                      dict(t='floor',x=0,y=-2.1,z=0,w=4,h=.2,d=4)]
        combat._build_grid()
        with patch.dict(combat.MAP_BY_ID[combat.CUR_MAP_ID],scene=dict(model='/map.glb')):
            self.target['pos']=[0,-2,0]
            self.match._ensure_safe_position(self.target)
            self.assertEqual(self.target['pos'],[0,-2,0])
            self.target.update(safe_pos=[10,0,0],pos=[-6,-3,0])
            self.match._ensure_safe_position(self.target)
            self.assertEqual(self.target['pos'],[10,0,0])

    def test_real_maps_input_bounds_and_lower_floor(self):
        for meta in combat.MAPS:
            combat.set_map(meta['id'])
            self.match._spawn(self.owner)
            for target in ([1e6,-1e6,1e6],[-1e6,-1e6,-1e6]):
                for _ in range(100):
                    self.clock+=100
                    self.match._on_input(self.owner,dict(p=target,s=dict(sprint=True)))
                    x,y,z=self.owner['pos'];b=combat.BOUNDS
                    self.assertTrue(b['minX']+1.5<=x<=b['maxX']-1.5)
                    self.assertTrue(b['minZ']+1.5<=z<=b['maxZ']-1.5)
                    self.assertGreaterEqual(y,combat.FLOOR_BASE)
                    self.assertTrue(all(math.isfinite(v) for v in (x,y,z)))


if __name__=='__main__':
    unittest.main(verbosity=2)
