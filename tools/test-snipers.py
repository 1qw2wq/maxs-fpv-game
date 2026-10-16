"""New Scout rifle catalog, authoritative loadout, firing and reload regressions."""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'public'/'engine'))
import combat
import game

SCOPED={'sentinel':'sniper.glb','awp':'sniper_rifle_-_awp.glb',
        'longbow':'titanfall_2_weapon_longbow-dmr_sniper.glb'}


class SniperTests(unittest.TestCase):
    def setUp(self):
        self.clock=100000.
        self.timer=patch.object(game,'now_ms',lambda:self.clock);self.timer.start()
        self.match=game.Match()
        combat.SOLID=[];combat._build_grid();combat.GROUND_BOX=None
        combat.GROUND_Y=combat.FLOOR_BASE=0
        combat.BOUNDS=dict(minX=-60,maxX=60,minZ=-60,maxZ=60)

    def tearDown(self):
        self.timer.stop();combat.set_map(combat.DEFAULT_MAP_ID)

    def test_uploaded_scopes_keep_legacy_iron_sights(self):
        self.assertEqual(len(combat.WEAPONS),30)
        self.assertEqual({w['id'] for w in combat.WEAPONS.values() if w.get('scope')},set(SCOPED)|{'ar15','gm6','m170','pgm'})
        self.assertEqual(len(combat.CLASS_WEAPONS['scout']),9)
        self.assertEqual(combat.validate_shared_data(),[])
        for wid in ('smle','m95','springfield'):
            self.assertIs(combat.WEAPONS[wid]['scope'],False)
            self.assertGreaterEqual(combat.WEAPONS[wid]['zoomFov'],40)
        for wid,file in SCOPED.items():
            w=combat.WEAPONS[wid]
            self.assertTrue(w['name'] and w['nameEn'] and w['descEn'])
            self.assertLess(w['zoomFov'],25)
            self.assertEqual((ROOT/'public/models/guns'/file).read_bytes()[:4],b'glTF')

    def test_all_six_scout_loadouts_join_and_respawn_without_fallback(self):
        for bot in (False,True):
            for wid in combat.CLASS_WEAPONS['scout']:
                p=self.match.add_player(wid,None,cls='scout',weapon=wid,bot=bot)
                self.assertEqual(p['weapon'],wid)
                p.update(alive=False,respawn_at=0)
                packets=self.match._on_respawn(p,dict(c='scout',w=wid))
                self.assertEqual(packets[0]['msg']['w'],wid)
                self.assertEqual(self.match.me_payload(p)['mag'],combat.WEAPONS[wid]['mag'])
                self.match.remove_player(p['id'])

    def test_new_rifles_fire_consume_ammo_and_reload(self):
        for wid in SCOPED:
            p=self.match.add_player('QA',None,cls='scout',weapon=wid)
            q=self.match.add_player('Target',None)
            p.update(team=0,pos=[0,0,0]);q.update(team=1,pos=[10,0,0],hp=1000,shield_until=0)
            game._seed_hist(q,self.clock)
            w=combat.WEAPONS[wid]
            for _ in range(2):
                self.clock+=math.ceil(60000/w['rpm'])+1
                before=q['hp']
                self.match._on_fire(p,dict(d=[1,0,0]))
                self.assertLess(q['hp'],before)
            self.assertEqual(p['mag'],w['mag']-2)
            self.match._on_reload(p)
            self.assertGreater(p['reload_end'],self.clock)
            self.clock=p['reload_end']+1
            self.match.tick(33)
            self.assertEqual(p['mag'],w['mag'])
            self.assertEqual(p['reserve'],w['reserve']-2)
            self.match.remove_player(p['id']);self.match.remove_player(q['id'])

    def test_longbow_is_semiautomatic_not_bolt_gated(self):
        w=combat.WEAPONS['longbow']
        self.assertEqual(w['shape'],'rifle')
        self.assertIs(w['auto'],False)
        self.assertNotIn('clip',w)
        self.assertNotIn('straightPull',w)
        self.assertGreater(w['rpm'],max(combat.WEAPONS[x]['rpm'] for x in ('sentinel','awp')))


if __name__=='__main__':
    unittest.main(verbosity=2)
