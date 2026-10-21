"""Server-owned capture points. No client capture commands or trusted timers."""
import math
import combat


class ControlPoints:
    def __init__(self, map_id):
        self.cfg = combat.COMBAT['control']
        meta = combat.MAP_BY_ID.get(map_id) or combat.MAP_BY_ID[combat.DEFAULT_MAP_ID]
        self.points = [dict(id=p['id'], p=list(p['p']), owner=-1, attacking=-1,
                            progress=0.0, contested=False) for p in meta.get('controlPoints', [])]
        self.hold_team = -1
        self.hold_ms = 0.0

    def tick(self, players, dt_ms):
        dt_ms = max(0, min(250, dt_ms))
        for point in self.points:
            present = [0, 0]
            for player in players.values():
                if not player['alive']:
                    continue
                x, y, z = player['pos']
                px, py, pz = point['p']
                if abs(y-py) > 1.8 or math.hypot(x-px,z-pz) > self.cfg['radius']:
                    continue
                if not combat.has_line_of_sight((px,py+1,pz),(x,y+0.9,z)):
                    continue  # cannot capture through a wall or another floor
                present[player['team']] += 1
            point['contested'] = bool(present[0] and present[1])
            if point['contested']:
                continue
            team = 0 if present[0] else 1 if present[1] else -1
            if team < 0 or team == point['owner']:
                point['progress'] = max(0,point['progress']-dt_ms/self.cfg['captureMs'])
                if not point['progress']:
                    point['attacking'] = -1
                continue
            if point['attacking'] != team:
                point['progress'] = 0.0
                point['attacking'] = team
            point['progress'] += dt_ms/self.cfg['captureMs'] * min(2,present[team])
            if point['progress'] >= 1-1e-9:
                # Enemy flags must be neutralized first, then captured.
                point['owner'] = team if point['owner'] < 0 else -1
                point['progress'] = 0.0
                point['attacking'] = -1
        scores = [sum(p['owner']==team for p in self.points) for team in (0,1)]
        team = next((t for t in (0,1) if self.points and scores[t]==len(self.points)), -1)
        safe = team >= 0 and all(not p['contested'] and p['attacking'] in (-1,team) for p in self.points)
        if not safe:
            self.hold_team, self.hold_ms = -1, 0.0
        else:
            self.hold_ms = self.hold_ms+dt_ms if self.hold_team==team else 0.0
            self.hold_team = team
        winner = team if safe and self.hold_ms >= self.cfg['holdAllMs'] else -1
        return scores, winner

    def payload(self):
        return dict(points=[dict(p, progress=round(p['progress'],4)) for p in self.points],
                    radius=self.cfg['radius'],holdTeam=self.hold_team,
                    holdRemaining=max(0,round(self.cfg['holdAllMs']-self.hold_ms)),holdRequired=self.cfg['holdAllMs'])
