"""Stair movement authority and optional exact browser-math parity. No packages.
STAIR_JS_PARITY=1 python tools/test-stairs.py  # adds Node >=22.15 parity audit
"""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'public/engine'))
import combat
import game


class StairTests(unittest.TestCase):
    def setUp(self):
        combat.set_map('proc_city')

    def tearDown(self):
        combat.set_map(combat.DEFAULT_MAP_ID)

    def samples(self):
        for b in combat.MAP_DATA['buildings']:
            for r in b['ramps']:
                x,y,z=r['start'];length=r['end'][2]-z
                for side in [-.7,0,.7]:
                    for down in [False,True]:
                        point=lambda t:[x+side,y+t/length*3,z+t]
                        yield point(3.3 if down else .5),point(.5 if down else 3.3)

    def fixture(self, boxes, base=0):
        combat.SOLID=boxes;combat._build_grid();combat.GROUND_Y=combat.FLOOR_BASE=base

    def test_delayed_packets_follow_every_city_flight_both_ways(self):
        match=game.Match();p=match.add_player('Stair QA',None)
        for old,target in self.samples():
            with self.subTest(old=old,target=target):
                p.update(pos=old[:],safe_pos=old[:],last_input=99500)
                with patch.object(game,'now_ms',lambda:100000):
                    match._on_input(p,dict(p=target,s=dict(move=True,ground=True)))
                for actual,wanted in zip(p['pos'],target):self.assertAlmostEqual(actual,wanted,places=7)
                self.assertFalse(combat.blocked(p['pos'][0],p['pos'][2],p['pos'][1]))

    def test_raising_onto_step_checks_full_headroom(self):
        self.fixture([dict(t='cover',x=1,y=.25,z=0,w=1,h=.5,d=4),dict(t='floor',x=0,y=2.1,z=0,w=8,h=.2,d=8)])
        x,z,y=combat.resolve_move([0,0,0],[1,0,0],0,return_height=True)
        self.assertLess(x,.151);self.assertEqual(y,0)
        x,z,y=combat.resolve_move([0,0,0],[1,0,0],0,combat.COMBAT['crouchHeight'],return_height=True)
        self.assertAlmostEqual(x,1);self.assertEqual(y,.5)

    def test_large_move_cannot_scale_tall_wall(self):
        self.fixture([dict(t='wall',x=1,y=1.5,z=0,w=.04,h=3,d=10)])
        x,z,y=combat.resolve_move([0,0,0],[8,0,0],0,return_height=True)
        self.assertLess(x,.64);self.assertEqual(y,0)

    def test_cliff_and_airborne_moves_do_not_snap_to_surfaces(self):
        self.fixture([dict(t='floor',x=0,y=2.9,z=0,w=2,h=.2,d=4)])
        x,z,y=combat.resolve_move([0,3,0],[4,3,0],3,return_height=True)
        self.assertAlmostEqual(x,4);self.assertEqual(y,3)
        self.fixture([dict(t='cover',x=1,y=.25,z=0,w=1,h=.5,d=4)])
        x,z,y=combat.resolve_move([0,.2,0],[1,.2,0],.2,return_height=True,follow_ground=False)
        self.assertEqual(y,.2)

    def test_sloped_underside_not_flat_bounding_box(self):
        ramp=dict(t='ramp',x=0,y=4.39,z=0,w=4,h=3.22,d=6,ax='z',y0=3,y1=6,thickness=.22)
        self.fixture([ramp],base=1.2)
        self.assertAlmostEqual(combat.ceiling_at(0,0,1.2),4.28)
        self.assertAlmostEqual(combat.ceiling_at(0,-2,1.2),3.28)
        self.assertEqual(combat.ceiling_at(0,0,5),math.inf)
        legacy={**ramp};legacy.pop('thickness');self.fixture([legacy])
        self.assertAlmostEqual(combat.ceiling_at(0,0,0),2.78)

    def test_authority_clamps_jump_below_actual_stair_underside(self):
        match=game.Match();p=match.add_player('Headroom QA',None)
        self.fixture([dict(t='ramp',x=0,y=4.39,z=0,w=4,h=3.22,d=6,ax='z',y0=3,y1=6,thickness=.22)],base=1.2)
        p.update(pos=[0,1.2,0],safe_pos=[0,1.2,0],last_input=99500)
        with patch.object(game,'now_ms',lambda:100000):match._on_input(p,dict(p=[0,2.8,0],s=dict(ground=False)))
        self.assertAlmostEqual(p['pos'][1],4.28-combat.COMBAT['playerHeight']-.002)
        self.assertFalse(combat.blocked(0,0,p['pos'][1]))

    @unittest.skipUnless(os.environ.get('STAIR_JS_PARITY'),'set STAIR_JS_PARITY=1 for Node/browser arithmetic parity')
    def test_python_browser_sweep_and_ceiling_parity(self):
        env={**os.environ,'STAIR_PARITY_JSON':'1'}
        rows=json.loads(subprocess.check_output(['node','tools/test-stairs.mjs'],cwd=ROOT,env=env,text=True))
        self.assertEqual(len(rows),978)
        for row in rows:
            old,target=row['old'],row['target']
            x,z,y=combat.resolve_move(old,target,old[1],return_height=True)
            for a,b in zip([x,y,z],row['result']):self.assertAlmostEqual(a,b,places=8)
            ceiling=combat.ceiling_at(x,z,y)
            if row['ceiling'] is None:self.assertEqual(ceiling,math.inf)
            else:self.assertAlmostEqual(ceiling,row['ceiling'],places=8)


if __name__=='__main__':unittest.main(verbosity=2)
