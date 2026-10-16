"""Custom collision, hit testing and actual bot motion; no physics dependency."""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'public/engine'))
import combat
import game
import bots


class CityTests(unittest.TestCase):
    def setUp(self):
        combat.set_map('proc_city')
        self.m=combat.MAP_DATA

    def tearDown(self):
        combat.set_map(combat.DEFAULT_MAP_ID)

    def walk(self,p,q):
        p=list(p)
        n=max(1,math.ceil(math.hypot(q[0]-p[0],q[2]-p[2])/.10))
        x,z=p[0],p[2]
        for k in range(1,n+1):
            tx,tz=x+(q[0]-x)*k/n,z+(q[2]-z)*k/n
            self.assertFalse(combat.blocked(tx,tz,p[1]),(p,q,tx,tz))
            y=combat.floor_at(tx,tz,p[1])
            self.assertLessEqual(abs(y-p[1]),.65)
            p=[tx,y,tz]
        self.assertAlmostEqual(p[1],q[1],places=5)

    def test_every_graph_edge_is_walkable_both_directions(self):
        g=self.m['bot_nav'];nodes={n['id']:n['p']for n in g['nodes']}
        for a,b in g['edges']:
            self.walk(nodes[a],nodes[b]);self.walk(nodes[b],nodes[a])

    def test_spawns_have_five_metres_clear_runout(self):
        for team,points in self.m['spawns'].items():
            for p in points:
                self.walk([p['x'],0,p['z']],[p['x']+(5 if team=='0' else -5),0,p['z']])

    def test_door_and_window_rays_are_not_whole_mesh_aabbs(self):
        for b in self.m['buildings']:
            x,z=b['x'],b['z']
            # Two door openings connect outside to inside, while adjacent jambs stop fire.
            for sign in (-1,1):
                direction=[0,0,-sign]
                self.assertIsNone(combat.ray_world([x-4,1.58,z+7*sign],direction,2))
                self.assertIsNotNone(combat.ray_world([x-2.5,1.58,z+7*sign],direction,2))
            self.assertIsNone(combat.ray_world([x+7,4.58,z],[-1,0,0],2))
            self.assertIsNotNone(combat.ray_world([x+7,3.5,z],[-1,0,0],2))

    def test_furniture_and_roof_collide(self):
        low=[b for b in combat.SOLID if b['t']=='cover'and .8<=b['h']<=1.1]
        high=[b for b in combat.SOLID if b['t']=='cover'and b['h']>=2]
        self.assertTrue(low and high)
        for b in low+high:
            if b['y']-b['h']/2<.01:self.assertTrue(combat.blocked(b['x'],b['z'],0))
        for b in self.m['buildings']:
            self.assertAlmostEqual(combat.floor_at(b['x']-3,b['z']-3,3),3)

    def test_all_upper_lookouts_have_routes_from_both_teams(self):
        for team in ('0','1'):
            p=self.m['spawns'][team][0];start=[p['x'],p['y'],p['z']]
            for n in self.m['bot_nav']['nodes']:
                if n.get('kind')!='lookout':continue
                path=combat.waypoint_route(start,n['p'])
                self.assertTrue(path)
                for q in path:self.walk(start,q);start=q
                start=[p['x'],p['y'],p['z']]

    def test_multiplayer_room_authority_keeps_the_same_city(self):
        from room import Room
        from host import Sink
        room=Room('24682468');host,guest=Sink(),Sink()
        first=room.join(host,dict(name='Host',map='proc_city',solo=False,bots=False))
        second=room.join(guest,dict(name='Guest',map='italy',solo=False,bots=False))
        self.assertEqual(first['mapId'],'proc_city')
        self.assertEqual(second['mapId'],'proc_city')
        self.assertEqual(first['map'],second['map'])
        self.assertEqual(room.match.human_count(),2)
        self.assertFalse(room.bots_on)
        self.assertEqual(len(combat.SOLID),len(self.m['boxes'])-1)

    def test_live_bot_reaches_second_floor_without_teleport_or_jump(self):
        match=game.Match()
        p=match.add_player('Route QA',None,cls='scout',bot=True)
        # Keep one team/no enemy so the bot exercises its navigation rather than a duel.
        p.update(team=0,pos=[-27,0,0],shield_until=0)
        now=100000.
        top=0
        with patch.object(bots,'now_ms',lambda:now),patch.object(game,'now_ms',lambda:now):
            for i in range(3000):
                now+=33
                old=list(p['pos'])
                bots.think(match,p,33)
                self.assertLessEqual(math.hypot(p['pos'][0]-old[0],p['pos'][2]-old[2]),.25)
                self.assertLessEqual(abs(p['pos'][1]-old[1]),.65)
                top=max(top,p['pos'][1])
                if top>=2.99:break
        self.assertGreaterEqual(top,2.99,(p['pos'],p['bot_state']))


if __name__=='__main__':unittest.main(verbosity=2)
