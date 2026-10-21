"""Authoritative inventory regressions (same engine runs in Python/Pyodide)."""
import sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'public/engine'))
import combat,game
from room import Room
from host import Sink

class SecondaryTests(unittest.TestCase):
    def setUp(self):
        combat.set_map(combat.DEFAULT_MAP_ID)
        self.now=100000.
        self.clock=patch.object(game,'now_ms',lambda:self.now);self.clock.start()
        self.match=game.Match();self.p=self.match.add_player('Inventory',None,secondary='g17')
    def tearDown(self):
        self.clock.stop();combat.set_map(combat.DEFAULT_MAP_ID)
    def switch(self,slot=None):
        self.match.handle(self.p['id'],{'t':'switch',**({'slot':slot}if slot is not None else{})})
    def test_every_class_can_carry_each_pistol(self):
        for cls in combat.CLASSES:
            for wid in combat.SECONDARIES:
                p=self.match.add_player(wid,None,cls=cls,secondary=wid)
                self.match.handle(p['id'],{'t':'switch','slot':'secondary'})
                self.assertEqual(p['weapon'],wid);self.assertEqual(p['cls'],cls)
                self.assertEqual(p['mag'],combat.WEAPONS[wid]['mag'])
                self.assertNotIn(wid,combat.CLASS_WEAPONS[cls])
    def test_bad_loadouts_and_switch_requests_do_not_equip_arbitrary_guns(self):
        for bad in ('awp','nope',{},[],17):
            p=self.match.add_player('Bad',None,secondary=bad)
            self.assertEqual(p['secondary'],'apx')
        for bad in ('awp',[],{},17):self.switch(bad)
        self.assertEqual(self.p['weapon'],'mp18')
    def test_separate_ammo_survives_switches_without_refilling(self):
        self.p.update(mag=4,reserve=17);self.switch()
        self.assertEqual(self.p['mag'],17)
        self.p.update(mag=3,reserve=9);self.now+=351;self.switch()
        self.assertEqual((self.p['mag'],self.p['reserve']),(4,17))
        self.now+=351;self.switch()
        self.assertEqual((self.p['mag'],self.p['reserve']),(3,9))
    def test_equip_delay_and_same_slot_requests(self):
        self.switch('primary');self.assertEqual(self.p['equip_until'],0)
        self.switch();mag=self.p['mag'];self.match._on_fire(self.p,{'d':[1,0,0]})
        self.assertEqual(self.p['mag'],mag);self.switch();self.assertEqual(self.p['slot'],'secondary')
        self.now+=351;self.match._on_fire(self.p,{'d':[1,0,0]});self.assertEqual(self.p['mag'],mag-1)
    def test_switch_cancels_magazine_reload_without_free_ammo(self):
        self.p.update(mag=2,reserve=40);self.match._on_reload(self.p)
        self.assertGreater(self.p['reload_end'],self.now)
        self.switch();self.assertEqual(self.p['reload_end'],0)
        self.now+=5000;self.match.tick(33);self.switch()
        self.assertEqual((self.p['mag'],self.p['reserve']),(2,40))
    def test_switch_bills_partially_seated_clip_rounds_once(self):
        p=self.match.add_player('Clip',None,cls='scout',weapon='smle')
        p.update(mag=2,reserve=30);self.match._on_reload(p)
        p['mag']=4.0
        self.match._on_switch(p,{})
        saved=p['inventory']['smle'];self.assertEqual((saved['mag'],saved['reserve']),(4,28))
        self.now+=351;self.match._on_switch(p,{})
        self.assertEqual((p['mag'],p['reserve']),(4,28))
    def test_dead_players_cannot_switch(self):
        self.p['alive']=False;self.switch();self.assertEqual(self.p['slot'],'primary')
    def test_respawn_while_holding_pistol_restores_primary_and_selected_sidearm(self):
        self.switch();self.p.update(alive=False,respawn_at=0)
        self.match._on_respawn(self.p,{'c':'support','w':'m249','secondary':'deagle'})
        self.assertEqual((self.p['weapon'],self.p['primary'],self.p['secondary']),('m249','m249','deagle'))
        self.switch();self.assertEqual(self.p['mag'],7)
    def test_human_death_picker_waits_for_confirmed_redeploy(self):
        self.match._kill(self.p,self.p,False)
        self.now+=60000
        self.match.tick(33)
        self.assertFalse(self.p['alive'], 'Automatic respawn discarded the open loadout picker')
        self.match._on_respawn(self.p,{'c':'scout','w':'m170','secondary':'deagle'})
        self.assertTrue(self.p['alive'])
        self.assertEqual((self.p['primary'],self.p['secondary']),('m170','deagle'))
    def test_bots_still_respawn_automatically(self):
        bot=self.match.add_player('Bot',None,bot=True)
        self.match._kill(bot,bot,False)
        self.now+=12000
        self.match.tick(33)
        self.assertTrue(bot['alive'])
    def test_payload_names_active_gun_but_remembers_primary(self):
        self.switch();me=self.match.me_payload(self.p)
        self.assertEqual((me['w'],me['primary'],me['secondary'],me['slot']),('g17','mp18','g17','secondary'))
        self.assertEqual(me['equipIn'],350)
        self.assertEqual(self.match.players_payload()[0]['w'],'g17')
    def test_flare_sidearm_uses_projectile_reveal_not_hitscan_damage(self):
        p=self.match.add_player('Flare',None,secondary='flarepistol')
        self.match._on_switch(p,{});self.now+=351
        out=self.match._on_fire(p,{'d':[1,.3,0]})
        self.assertEqual(p['mag'],0);self.assertEqual(len(out),1)
        self.assertEqual(out[0]['msg']['fx']['k'],'flare')
        self.assertGreater(out[0]['msg']['fx']['delay'],0)
        self.assertEqual(p['ability_charges'],int(combat.CLASSES[p['cls']].get('abilityCharges',1)))
    def test_host_guest_join_and_respawn_keep_sidearm_choice(self):
        room=Room('24682468');a,b=Sink(),Sink()
        first=room.join(a,dict(name='Host',secondary='apx',solo=False,bots=False))
        second=room.join(b,dict(name='Guest',secondary='deagle',solo=False,bots=False))
        self.assertEqual(first['secondary'],'apx');self.assertEqual(second['secondary'],'deagle')
        p=room.match.players[second['id']];room.match.handle(p['id'],{'t':'switch'})
        self.assertEqual(room.match.me_payload(p)['w'],'deagle')
    def test_all_thirty_uploaded_guns_have_valid_shared_data(self):
        self.assertEqual(combat.validate_shared_data(),[])
        self.assertEqual(len(combat.WEAPONS),30);self.assertEqual(len(combat.SECONDARIES),4)

if __name__=='__main__':unittest.main(verbosity=2)
