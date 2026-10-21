"""Room authority, bounded population and shared skill settings. No packages needed."""
import asyncio
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'public'/'engine'))
import bots
import combat
import game
from room import Room

class Sink:
    async def send_str(self,text): pass

class DifficultyTests(unittest.TestCase):
    def tearDown(self): combat.set_map(combat.DEFAULT_MAP_ID)

    def count(self,r): return sum(p['bot'] for p in r.match.players.values())

    def test_all_levels_solo_and_multiplayer_host_choice_survives_guest_and_respawn(self):
        for solo in (False,True):
            for level in ['mixed',*bots.SKILLS]:
                r=Room('12345678');host,guest=Sink(),Sink()
                welcome=r.join(host,dict(name='Host',solo=solo,bots=True,botCount=6,botDifficulty=level))
                self.assertEqual(welcome['botDifficulty'],level)
                original={p['id']:p['bot_skill'] for p in r.match.players.values() if p['bot']}
                expected=set(bots.SKILL_ROTATION) if level=='mixed' else {level}
                self.assertTrue(set(original.values()).issubset(expected))
                r.join(guest,dict(name='Guest',solo=not solo,bots=False,botCount=0,botDifficulty='recruit'))
                self.assertEqual(r.match.solo,solo)
                self.assertTrue(r.bots_on);self.assertEqual(self.count(r),6)
                self.assertEqual(r.match.bot_difficulty,level)
                for p in list(r.match.players.values()):
                    if p['bot']:
                        r.match._spawn(p);self.assertEqual(p['bot_state']['skill'],original[p['id']])
                # Guests cannot change population or difficulty with live commands either.
                asyncio.run(r.handle(guest,dict(t='bots',on=True,n=16,difficulty='elite')))
                self.assertEqual(self.count(r),6);self.assertEqual(r.match.bot_difficulty,level)
                asyncio.run(r.handle(host,dict(t='bots',on=True,n=4,difficulty='elite')))
                self.assertEqual(self.count(r),4)
                self.assertTrue(all(p['bot_skill']=='elite' for p in r.match.players.values() if p['bot']))

    def test_guest_cannot_add_bots_to_humans_only_host(self):
        r=Room('12345678');r.join(Sink(),dict(bots=False,solo=False))
        welcome=r.join(Sink(),dict(bots=True,botCount=16,botDifficulty='elite',solo=True))
        self.assertFalse(welcome['botsOn']);self.assertFalse(r.match.solo);self.assertEqual(self.count(r),0)

    def test_zero_clamps_invalid_difficulty_and_last_human_cleanup(self):
        for raw,expected in [(0,0),(-99,0),(999,16),('bad',6),(float('inf'),6)]:
            r=Room('12345678');s=Sink()
            welcome=r.join(s,dict(bots=True,botCount=raw,botDifficulty={'bad':'elite'}))
            self.assertEqual(self.count(r),expected)
            self.assertEqual(welcome['botDifficulty'],'mixed')
            self.assertEqual(welcome['botsOn'],expected>0)
            r.leave(s);self.assertEqual(self.count(r),0);self.assertFalse(r.bots_on)

    def test_human_capacity_reclaims_and_restores_bot_slots(self):
        r=Room('12345678');r.join(Sink(),dict(bots=True,botCount=16,solo=False))
        guests=[]
        for i in range(25):
            s=Sink();guests.append(s);r.join(s,dict(name=str(i)))
            self.assertLessEqual(len(r.match.players),32)
        self.assertEqual(self.count(r),6)
        for s in guests:r.leave(s)
        self.assertEqual(self.count(r),16)

    def test_shared_tiers_have_finite_human_like_delays_and_monotonic_strength(self):
        for skill in bots.SKILLS.values():
            self.assertGreaterEqual(skill['reaction'][0],100)
            self.assertGreater(skill['aim_error'],0)
            self.assertGreater(skill['pause'][0],0)
        for raw in [None,{},[],42,'impossible']:
            self.assertEqual(bots.normalize_difficulty(raw),'mixed')

    def test_each_level_simulates_on_every_map_with_normal_hp_and_collision(self):
        for map_id in combat.MAP_BY_ID:
            combat.set_map(map_id)
            for level in ['mixed',*bots.SKILLS]:
                clock=[100000.0]
                with patch.object(bots,'now_ms',lambda:clock[0]),patch.object(game,'now_ms',lambda:clock[0]):
                    m=game.Match();m.set_bot_difficulty(level);m.fill_bots(8)
                    for _ in range(120):
                        clock[0]+=50;m.tick(50)
                for p in m.players.values():
                    self.assertLessEqual(p['hp'],combat.CLASSES[p['cls']]['maxHp'])
                    self.assertFalse(combat.blocked(*[p['pos'][i] for i in (0,2,1)]),(map_id,level,p['pos']))

if __name__=='__main__':unittest.main(verbosity=2)
