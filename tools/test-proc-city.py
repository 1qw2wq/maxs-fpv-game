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
        normal={'n':(0,-1),'s':(0,1),'w':(-1,0),'e':(1,0)}
        for b in self.m['buildings']:
            walls=[w for w in combat.SOLID if w['t']=='wall' and w.get('building')==b['id']]
            for o in b['openings']:
                nx,nz=normal[o['side']]
                direction=[-nx,0,-nz]
                centre=[o['x']+nx,o['y']+o['height']/2,o['z']+nz]
                # Visible furniture behind a window may legitimately block a
                # world ray. The facade itself must leave the full aperture open.
                axis=0 if nx==0 else 2
                for u,v in [(0,.5),(-.45,.1),(.45,.1),(-.45,.9),(.45,.9)]:
                    point=list(centre);point[axis]+=o['width']*u;point[1]=o['y']+o['height']*v
                    self.assertFalse(any(combat.ray_box(point,direction,w,1.3) is not None for w in walls),(b['id'],o,point))
                if o['kind']=='door':self.assertIsNone(combat.ray_world(centre,direction,1.3),(b['id'],o))
                # Solid jambs must remain beside every real aperture.
                jamb=list(centre)
                axis=0 if nx==0 else 2
                jamb[axis]+=o['width']/2+.18
                self.assertIsNotNone(combat.ray_world(jamb,direction,1.3),(b['id'],o))
                if o['kind']=='window':
                    sill=[centre[0],o['y']-.2,centre[2]]
                    self.assertIsNotNone(combat.ray_world(sill,direction,1.3),(b['id'],o))

    def test_closed_facade_bays_are_solid_not_hidden_openings(self):
        for b in self.m['buildings']:
            sx,sz=b['scale']
            for floor in range(b['stories']):
                for side,(nx,nz) in {'n':(0,-1),'s':(0,1),'e':(1,0),'w':(-1,0)}.items():
                    if side==b['attachedSide']:continue
                    bays={o['bay'] for o in b['openings'] if o['floor']==floor and o['side']==side}
                    for bay in set((-4,0,4))-bays:
                        x=b['x']+(bay*sx if nx==0 else nx*6*sx)+nx
                        z=b['z']+(bay*sz if nz==0 else nz*6*sz)+nz
                        self.assertIsNotNone(combat.ray_world([x,floor*3+1.58,z],[-nx,0,-nz],1.3),(b['id'],floor,side,bay))

    def test_furniture_and_roof_collide(self):
        low=[b for b in combat.SOLID if b['t']=='cover'and .8<=b['h']<=1.1]
        high=[b for b in combat.SOLID if b['t']=='cover'and b['h']>=2]
        self.assertTrue(low and high)
        for b in low+high:
            if b['y']-b['h']/2<.01:self.assertTrue(combat.blocked(b['x'],b['z'],0))
        for n in self.m['bot_nav']['nodes']:
            if n.get('kind')=='lookout':
                x,y,z=n['p'];self.assertAlmostEqual(combat.floor_at(x,z,y),y)

    def test_all_upper_lookouts_have_routes_from_both_teams(self):
        for team in ('0','1'):
            p=self.m['spawns'][team][0];start=[p['x'],p['y'],p['z']]
            for n in self.m['bot_nav']['nodes']:
                if n.get('kind')!='lookout':continue
                path=combat.waypoint_route(start,n['p'])
                self.assertTrue(path)
                for q in path:self.walk(start,q);start=q
                start=[p['x'],p['y'],p['z']]

    def test_stacked_flights_allow_under_headroom_but_not_inside_wedges(self):
        for b in self.m['buildings']:
            if b['stories']<3:continue
            upper=b['ramps'][1];start,end=upper['start'],upper['end']
            self.assertFalse(combat.blocked(start[0],start[2],0),b['id'])
            self.assertFalse(combat.blocked(end[0],end[2]-.1,start[1]),b['id'])
            self.assertTrue(combat.blocked(end[0],end[2]-.1,end[1]-1),b['id'])
        for ramp in (r for r in combat.SOLID if r['t']=='ramp'):
            surface=combat.ramp_height(ramp,ramp['x'],ramp['z'])
            for offset,solid in [(-.11,True),(-.5,False),(.1,False)]:
                hit=combat.ray_ramp([ramp['x']-ramp['w']/2-1,surface+offset,ramp['z']],[1,0,0],ramp,ramp['w']+2)
                self.assertEqual(hit is not None,solid)

    def test_all_wall_solids_stop_rays_from_both_sides(self):
        for b in combat.SOLID:
            if b['t']!='wall':continue
            # Fire through the thin axis, from both sides, at the solid center.
            axis=0 if b['w']<b['d'] else 2
            width=b['w'] if axis==0 else b['d']
            for sign in (-1,1):
                origin=[b['x'],b['y'],b['z']];origin[axis]+=sign*(width/2+.25)
                direction=[0,0,0];direction[axis]=-sign
                hit=combat.ray_world(origin,direction,width+.5)
                self.assertIsNotNone(hit,b)
                self.assertLessEqual(hit,.250001,b)

    def test_connected_doors_pass_shots_and_party_walls_stop_every_bullet_weapon(self):
        match=game.Match();shooter=match.add_player('Wall audit',None);target=match.add_player('Behind wall',None)
        clock=100000.
        weapons=[w for w in combat.WEAPONS.values() if not w.get('utility')]
        with patch.object(game,'now_ms',lambda:clock):
            for connection in self.m['connections']:
                x,y,z=connection['x'],connection['y'],connection['z']
                for weapon in weapons:
                    for doorway in (False,True):
                        zz=z if doorway else z-3
                        shooter.update(pos=[x-.75,y,zz],team=0,bot=True,weapon=weapon['id'],mag=100,last_shot=0,reload_end=0,equip_until=0)
                        target.update(pos=[x+.75,y,zz],team=1,hp=10000,alive=True,shield_until=0)
                        clock+=2000
                        match._on_fire(shooter,dict(o=game.eye_pos(shooter),d=[1,0,0]))
                        self.assertEqual(shooter['mag'],99)
                        if doorway:self.assertLess(target['hp'],10000,(connection,weapon['id']))
                        else:self.assertEqual(target['hp'],10000,(connection,weapon['id']))
                # An origin reported just beyond the shared wall must not bypass it.
                shooter.update(pos=[x-.75,y,z-3],weapon='mp18',mag=100,last_shot=0)
                target.update(pos=[x+.75,y,z-3],hp=10000,alive=True)
                clock+=2000;match._on_fire(shooter,dict(o=[x+.55,y+1.58,z-3],d=[1,0,0]))
                self.assertEqual(target['hp'],10000)

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

    def test_central_park_is_accessible_and_solid_props_match(self):
        park=self.m['park']
        self.assertEqual((park['x'],park['z']),(0,0))
        self.assertGreaterEqual(park['trees'],10)
        for a,b in [([-34,0,0],[34,0,0]),([0,0,-9],[0,0,9])]:self.walk(a,b)
        self.assertEqual(self.m['parkedVehicles'],8)
        for b in (b for b in combat.SOLID if b.get('park')):
            if b['h']>.65:self.assertTrue(combat.blocked(b['x'],b['z'],0))
            else:self.assertGreaterEqual(combat.floor_at(b['x'],b['z'],0),b['h']-.01)

    def test_city_defaults_to_fifteen_bots_but_honours_explicit_counts(self):
        from room import Room
        from host import Sink
        room=Room('12121212')
        room.join(Sink(),dict(name='Park QA',map='proc_city',solo=True,bots=True))
        self.assertEqual(room.bot_target,15)
        self.assertEqual(sum(p['bot'] for p in room.match.players.values()),15)
        other=Room('34343434')
        other.join(Sink(),dict(name='Low budget',map='proc_city',solo=True,bots=True,botCount=4))
        self.assertEqual(sum(p['bot'] for p in other.match.players.values()),4)

    def test_reload_clock_is_public_for_remote_animation(self):
        match=game.Match();p=match.add_player('Reload QA',None)
        p['mag']=0
        with patch.object(game,'now_ms',lambda:100000.):
            match._on_reload(p)
            row=next(row for row in match.players_payload() if row['i']==p['id'])
            self.assertGreater(row['rt'],0);self.assertEqual(row['ri'],row['rt'])
        with patch.object(game,'now_ms',lambda:100000.+row['rt']*.5):
            half=next(row for row in match.players_payload() if row['i']==p['id'])
            self.assertGreater(half['ri'],0);self.assertLess(half['ri'],half['rt'])
        p['reload_end']=0
        self.assertEqual(next(row for row in match.players_payload() if row['i']==p['id'])['rt'],0)

    def test_live_bot_reaches_second_floor_without_teleport_or_jump(self):
        match=game.Match()
        p=match.add_player('Route QA',None,cls='scout',bot=True)
        # Keep one team/no enemy so the bot exercises its navigation rather than a duel.
        lookouts=[n['p'] for n in self.m['bot_nav']['nodes'] if n.get('kind')=='lookout']
        goal=lookouts[p['id']%len(lookouts)]
        building=next(b for b in self.m['buildings'] if abs(b['x']-goal[0])<b['w']/2 and abs(b['z']-goal[2])<b['d']/2)
        p.update(team=0,pos=list(building['ramp']['start']),shield_until=0)
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
