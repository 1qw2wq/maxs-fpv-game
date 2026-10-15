"""Shared sprint/ADS movement authority: python tools/test-movement.py."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'public' / 'engine'))
import combat
import game


class MovementTests(unittest.TestCase):
    def setUp(self):
        self.match = game.Match()
        self.player = self.match.add_player('Runner', None)
        combat.SOLID = []
        combat._build_grid()
        combat.GROUND_BOX = None
        combat.GROUND_Y = combat.FLOOR_BASE = 0
        combat.BOUNDS = dict(minX=-50, maxX=50, minZ=-50, maxZ=50)

    def tearDown(self):
        combat.set_map(combat.DEFAULT_MAP_ID)

    def move(self, **flags):
        self.player.update(pos=[0, 0, 0], alive=True, last_input=99900)
        with patch.object(game, 'now_ms', lambda: 100000):
            self.match._on_input(self.player, dict(p=[30, 0, 0], s=flags))
        # Remove the existing network tolerance before comparing speed ratios.
        return self.player['pos'][0] - .3

    def test_sprint_multiplier_matches_shared_client_config(self):
        walk = self.move()
        sprint = self.move(sprint=True)
        self.assertAlmostEqual(sprint / walk, game.COMBAT['sprintMult'])
        self.assertTrue(self.player['flags']['sprint'])

    def test_ads_slows_and_overrides_sprint_claim(self):
        walk = self.move()
        ads = self.move(ads=True, sprint=True)
        self.assertAlmostEqual(ads / walk, game.COMBAT['adsMoveMult'])
        self.assertTrue(self.player['flags']['ads'])
        self.assertFalse(self.player['flags']['sprint'])

    def test_crouch_cannot_stack_with_sprint(self):
        walk = self.move()
        crouch = self.move(crouch=True, sprint=True)
        self.assertAlmostEqual(crouch / walk, .55)
        self.assertFalse(self.player['flags']['sprint'])
        combined = self.move(crouch=True, ads=True, sprint=True)
        self.assertAlmostEqual(combined / walk, .55 * game.COMBAT['adsMoveMult'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
