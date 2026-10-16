"""Hitscan cover regressions + Python/JS fixtures. Stdlib only."""
import json
import math
from pathlib import Path
import random
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'public'/'engine'))
import combat
import game


class ShootingTests(unittest.TestCase):
    def setUp(self):
        self.clock=100000.
        self.timer=patch.object(game,'now_ms',lambda:self.clock);self.timer.start()
        self.match=game.Match()
        self.shooter=self.match.add_player('Shooter',None)
        self.target=self.match.add_player('Target',None)
        self.shooter.update(pos=[0,0,0],team=0)
        self.target.update(pos=[10,0,0],team=1,hp=1000,shield_until=0)
        game._seed_hist(self.target,self.clock)
        self.geometry([])
    def tearDown(self):
        self.timer.stop();combat.set_map('somme')
    def geometry(self,boxes):
        combat.SOLID=boxes;combat.GROUND_BOX=None;combat._build_grid()
    def wall(self,x=2,w=.02):
        self.geometry([dict(t='wall',x=x,y=2,z=0,w=w,h=4,d=8)])
    def shoot(self,origin=None,d=(1,0,0)):
        self.clock+=2000
        return self.match._on_fire(self.shooter,dict(o=origin or game.eye_pos(self.shooter),d=d))
    def test_all_guns_and_bots_stop_at_thin_cover(self):
        self.wall()
        for bot in (False,True):
            for weapon in combat.WEAPONS:
                self.shooter.update(bot=bot,weapon=weapon,mag=100,last_shot=0)
                self.shoot()
                self.assertEqual(self.target['hp'],1000,(bot,weapon))
                self.assertEqual(self.shooter['mag'],99)
    def test_unobstructed_shots_still_hit(self):
        self.shoot();self.assertLess(self.target['hp'],1000)
    def test_nearby_reported_origin_cannot_hop_across_cover(self):
        self.wall(x=.55,w=.03)
        self.shoot(origin=(1.1,1.58,0)) # within old 1.5m tolerance, beyond wall
        self.assertEqual(self.target['hp'],1000)
    def test_origin_inside_cover_cannot_shoot_out(self):
        self.wall(x=0,w=.1);self.shoot()
        self.assertEqual(self.target['hp'],1000)
    def test_origin_slack_in_open_space_remains_usable(self):
        self.shoot(origin=(.5,1.58,0));self.assertLess(self.target['hp'],1000)
    def test_zero_distance_and_sub_five_cm_walls_block(self):
        for x in (0,.005,.025):
            self.wall(x=x,w=.002)
            distance=combat.ray_world((0,1.58,0),(1,0,0),220)
            self.assertIsNotNone(distance);self.assertLess(distance,.03)
    def test_ramp_is_a_solid_wedge_not_just_a_top_plane(self):
        ramp=dict(t='ramp',x=2,y=1,z=0,w=4,h=2,d=4,ax='x',y0=0,y1=2)
        self.geometry([ramp])
        self.assertAlmostEqual(combat.ray_world((5,.5,0),(-1,0,0),20),1)
        self.assertAlmostEqual(combat.ray_world((2,.5,3),(0,0,-1),20),1)
        self.assertEqual(combat.ray_world((2,.5,0),(1,0,0),20),0)
        self.assertIsNone(combat.ray_world((-1,2.5,0),(1,0,0),20))
        self.assertAlmostEqual(combat.ray_world((-1,.25,0),(1,0,0),20),1.5)
    def test_nonfinite_directions_are_rejected_without_consuming_ammo(self):
        for d in ((math.nan,0,1),(math.inf,0,0),(1,0,-math.inf)):
            before=self.shooter['mag'];self.shoot(d=d)
            self.assertEqual(self.shooter['mag'],before)
            self.assertEqual(self.shooter['shot_seq'],0)
    def test_vertical_floor_and_ceiling_rays(self):
        self.geometry([dict(t='floor',x=0,y=3,z=0,w=10,h=.03,d=10)])
        self.assertAlmostEqual(combat.ray_world((0,1.58,0),(0,1,0),220),1.405)
        self.assertAlmostEqual(combat.ray_world((0,4,0),(0,-1,0),220),.985)
    def test_long_diagonal_ray_cannot_tunnel_through_thin_cover(self):
        self.geometry([dict(t='wall',x=80,y=2,z=80,w=.002,h=4,d=4)])
        distance=combat.ray_world((0,1.58,0),combat.normalize((1,0,1)),220)
        self.assertAlmostEqual(distance,(80-.001)*math.sqrt(2))


def fixtures():
    rng=random.Random(20261015);out=[]
    for map_id in ('somme','italy','synthetic'):
        combat.set_map(map_id if map_id!='synthetic' else 'somme')
        if map_id=='synthetic':
            combat.SOLID=[dict(t='wall',x=.025,y=2,z=0,w=.002,h=4,d=8),dict(t='ramp',x=4,y=1,z=0,w=4,h=2,d=4,ax='x',y0=0,y1=2)]
            combat.GROUND_BOX=None;combat._build_grid()
        rays=[((0,1.58,0),(1,0,0)),((0,3,0),(0,-1,0)),((4,.5,0),(1,0,0)),((7,.5,0),(-1,0,0))]
        rays += [(tuple(rng.uniform(-35,35) if i!=1 else rng.uniform(-2,10) for i in range(3)),combat.normalize(tuple(rng.uniform(-1,1) for _ in range(3)))) for _ in range(200)]
        out.append(dict(map=map_id,boxes=combat.SOLID,ground=combat.GROUND_BOX,rays=[dict(o=o,d=d,t=combat.ray_world(o,d,220)) for o,d in rays]))
    return out

if __name__=='__main__':
    if '--fixtures' in sys.argv:print(json.dumps(fixtures(),separators=(',',':')))
    else:unittest.main(verbosity=2)
