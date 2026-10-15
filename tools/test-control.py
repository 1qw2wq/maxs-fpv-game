"""Point-control rules, room authority and real-map reachability (stdlib only)."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'public'/'engine'))
import combat
import game
import bots
import room
from objectives import ControlPoints


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.clock=100000
        self.clock_patch=patch.object(game,'now_ms',lambda:self.clock);self.clock_patch.start()
        self.match=game.Match();self.match.set_mode('control','somme')
        self.a=self.match.add_player('A',None);self.b=self.match.add_player('B',None)
        self.a.update(team=0,pos=[0,0,0]);self.b.update(team=1,pos=[40,0,0])
        combat.SOLID=[];combat._build_grid()
        self.control=self.match.control
        self.control.points=[dict(id='A',p=[0,0,0],owner=-1,attacking=-1,progress=0.,contested=False)]
    def tearDown(self):
        self.clock_patch.stop();combat.set_map('somme')
    def step(self,ms=100):
        return self.control.tick(self.match.players,ms)
    def advance(self,ms):
        for _ in range(ms//100):self.step()
    def test_single_capture_requires_five_seconds(self):
        self.advance(4900);self.assertEqual(self.control.points[0]['owner'],-1)
        self.step();self.assertEqual(self.control.points[0]['owner'],0)
    def test_two_players_capture_faster_but_cap_at_two(self):
        for _ in range(3):
            ally=self.match.add_player('Ally',None);ally.update(team=0,pos=[0,0,0])
        self.advance(2400);self.assertEqual(self.control.points[0]['owner'],-1)
        self.step();self.assertEqual(self.control.points[0]['owner'],0)
    def test_contestation_blocks_even_outnumbered(self):
        self.b['pos']=[1,0,0]
        self.advance(6000)
        self.assertTrue(self.control.points[0]['contested']);self.assertEqual(self.control.points[0]['progress'],0)
    def test_enemy_flag_neutralizes_before_capture(self):
        self.control.points[0]['owner']=1
        self.advance(5000);self.assertEqual(self.control.points[0]['owner'],-1)
        self.advance(5000);self.assertEqual(self.control.points[0]['owner'],0)
    def test_unattended_progress_recovers(self):
        self.advance(2000);self.assertAlmostEqual(self.control.points[0]['progress'],.4)
        self.a['pos']=[20,0,0];self.advance(2000)
        self.assertEqual(self.control.points[0]['progress'],0)
        self.assertEqual(self.control.points[0]['attacking'],-1)
    def test_dead_outside_and_different_floor_do_not_capture(self):
        for state in (dict(alive=False),dict(alive=True,pos=[10,0,0]),dict(pos=[0,3,0])):
            self.a.update(**state);self.advance(6000)
            self.assertEqual(self.control.points[0]['owner'],-1)
    def test_wall_blocks_capture(self):
        combat.SOLID=[dict(t='wall',x=1.5,y=2,z=0,w=.1,h=4,d=10)];combat._build_grid()
        self.a['pos']=[3,0,0];self.advance(6000)
        self.assertEqual(self.control.points[0]['owner'],-1)
    def test_hold_all_requires_fifteen_uninterrupted_seconds(self):
        self.control.points[0]['owner']=0
        self.step();self.advance(14900)
        self.assertLess(self.control.hold_ms,15000)
        scores,winner=self.step();self.assertEqual((scores,winner),([1,0],0))
    def test_enemy_pressure_resets_all_hold_before_neutralization(self):
        self.control.points[0]['owner']=0;self.advance(8000)
        self.a['pos']=[20,0,0];self.b['pos']=[0,0,0];self.step()
        self.assertEqual(self.control.points[0]['owner'],0)
        self.assertEqual(self.control.hold_team,-1);self.assertEqual(self.control.hold_ms,0)
    def test_contested_hold_also_resets(self):
        self.control.points[0]['owner']=0;self.advance(8000)
        self.b['pos']=[0,0,0];self.step();self.assertEqual(self.control.hold_ms,0)
    def test_kills_cannot_win_control_mode(self):
        self.match.scores=[0,0];self.a['kills']=74
        self.match._kill(self.a,self.b,False)
        self.assertEqual(self.a['kills'],75);self.assertEqual(self.match.scores,[0,0]);self.assertEqual(self.match.phase,'live')
    def test_tdm_still_wins_at_kill_limit(self):
        self.match.set_mode('tdm');self.match.scores=[74,0]
        self.match._kill(self.a,self.b,False)
        self.assertEqual(self.match.phase,'ended');self.assertEqual(self.match.winner,0)
    def test_timeout_tie_is_draw_instead_of_team_zero_bias(self):
        self.match.start_ms=self.clock-combat.COMBAT['matchMs']-1;self.match.tick(33)
        self.assertEqual(self.match.winner,-1);self.assertEqual(self.match.end_reason,'time')
    def test_timeout_majority_and_round_reset_publish_spawn(self):
        self.match.scores=[2,1];self.match.start_ms=self.clock-combat.COMBAT['matchMs']-1
        self.match.tick(33);self.assertEqual(self.match.winner,0)
        self.b.update(alive=False,respawn_at=self.clock)
        self.clock+=10001;self.match.tick(33)
        self.assertEqual(self.match.phase,'live');self.assertEqual(self.match.scores,[0,0])
        self.assertTrue(all(p['owner']==-1 for p in self.match.control.points))
        self.assertTrue(all(p['alive'] for p in self.match.players.values()))
        spawned={ev['to'] for ev in self.match.drain() if ev['msg']['t']=='spawn'}
        self.assertEqual(spawned,{self.a['id'],self.b['id']})
    def test_no_client_capture_or_mode_command(self):
        for message in (dict(t='capture',point='A',owner=0),dict(t='gameMode',gameMode='tdm')):
            self.assertEqual(self.match.handle(self.a['id'],message),[])
        self.assertEqual(self.match.mode,'control');self.assertEqual(self.control.points[0]['owner'],-1)
    def test_host_picks_mode_guests_cannot_override(self):
        r=room.Room('12345678');a,b=object(),object()
        first=r.join(a,dict(name='Host',gameMode='control'));second=r.join(b,dict(name='Guest',gameMode='tdm'))
        self.assertEqual(first['gameMode'],'control');self.assertEqual(second['gameMode'],'control')
        self.assertEqual(len(r.match.status()['objectives']['points']),3)
    def test_real_map_flags_reachable_from_both_teams(self):
        for map_id in ('somme','italy'):
            combat.set_map(map_id);control=ControlPoints(map_id)
            self.assertEqual(len(control.points),3)
            for point in control.points:
                x,y,z=point['p'];cell=(int(x//1),int(z//1))
                for team in (0,1):self.assertIn(cell,combat.NAV_FLOW[team])
                self.assertFalse(combat.blocked(x,z,y))
                self.assertAlmostEqual(combat.floor_at(x,z,y),y)
    def test_real_map_bot_matches_reach_objectives(self):
        for map_id in ('somme','italy'):
            combat.set_map(map_id)
            bots._RNG.seed(2026)
            match=game.Match();match.set_mode('control',map_id);match.fill_bots(6)
            reached=set()
            # Isolate navigation/capture from a random team's combat victory.
            with patch.object(bots,'now_ms',lambda:self.clock), patch.object(match,'_on_fire',lambda p,msg:[]):
                for _ in range(1200):
                    self.clock+=50;match.tick(50);match.drain()
                    for point in match.control.points:
                        if point['owner']>=0:reached.add(point['owner'])
            self.assertEqual(reached,{0,1},map_id)

    def test_bots_choose_a_control_point_not_enemy_spawn(self):
        self.match.remove_player(self.a['id']);self.match.remove_player(self.b['id'])
        bot=self.match.add_player('Bot',None,bot=True);bot.update(team=0,pos=[-15,0,0],last_hit_ms=0)
        with patch.object(bots,'now_ms',lambda:self.clock):bots.think(self.match,bot,100)
        self.assertEqual(bot['bot_state']['route_goal'],(0,0))
        self.assertGreater(bot['pos'][0],-15)

if __name__=='__main__':unittest.main(verbosity=2)
