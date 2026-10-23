"""Authority regressions for crosshair hits on sprinting opponents. Stdlib only."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'public'/'engine'))
import game
import combat
from collections import deque

class HitLatency(unittest.TestCase):
    def setUp(self):
        self.now=100000.
        self.clock=patch.object(game,'now_ms',lambda:self.now);self.clock.start()
        self.match=game.Match();self.s=self.match.add_player('shooter',None);self.q=self.match.add_player('target',None)
        self.s.update(pos=[0,0,0],team=0,shield_until=0)
        self.q.update(team=1,shield_until=0,hp=1)
        combat.SOLID=[];combat.GROUND_BOX=None;combat._build_grid()
    def tearDown(self):
        self.clock.stop();combat.set_map('somme')
    def moving(self,rtt):
        # At click time the rendered opponent is host->client + interpolation
        # old. By fire receipt client->host has elapsed too: RTT+interp total.
        rewind=min(rtt,240)+game.INTERP_MS
        self.s['ping']=rtt
        self.q['hist']=deque((self.now-age,10,0,(rewind-age)*.0072) for age in range(1000,-1,-10))
        self.q['pos']=[10,0,rewind*.0072]
    def shoot(self):
        return self.match._on_fire(self.s,{'o':list(game.eye_pos(self.s)),'d':[1,0,0]})
    def test_sprinting_crosshair_targets_die_for_all_ballistic_weapons(self):
        for rtt in (0,80,120,180,240,5000):
            for weapon,w in combat.WEAPONS.items():
                if w.get('utility'):continue
                with self.subTest(rtt=rtt,weapon=weapon):
                    self.match.phase="live";self.match.scores=[0,0]
                    self.s.update(weapon=weapon,mag=100,last_shot=0)
                    self.q.update(alive=True,hp=1,shield_until=0)
                    self.moving(rtt);events=self.shoot()
                    self.assertFalse(self.q['alive'])
                    self.assertTrue(any(e['msg']['t']=='kill' for e in events))
    def test_rewind_never_bypasses_cover(self):
        self.moving(120)
        combat.SOLID=[dict(t='wall',x=5,y=1,z=0,w=.02,h=3,d=5)];combat._build_grid()
        self.shoot();self.assertEqual(self.q['hp'],1)
    def test_active_shield_still_stops_rewound_hit_then_expires(self):
        self.moving(120);self.q.update(shield_until=self.now+1000,spawned_at=self.now)
        self.shoot();self.assertEqual(self.q['hp'],1)
        self.now+=1100;self.s['last_shot']=0;self.moving(120)
        self.shoot();self.assertFalse(self.q['alive'])
    def test_bot_does_not_rewind_a_network_pose(self):
        self.moving(240);self.s['bot']=True
        self.shoot();self.assertEqual(self.q['hp'],1)
    def test_current_pose_off_crosshair_is_not_an_alternate_hitbox(self):
        self.moving(120)
        # Aim at current authority body instead of the displayed old body.
        d=combat.normalize((10,0,self.q['pos'][2]))
        self.match._on_fire(self.s,{'o':list(game.eye_pos(self.s)),'d':list(d)})
        self.assertEqual(self.q['hp'],1)

if __name__=='__main__':unittest.main()
