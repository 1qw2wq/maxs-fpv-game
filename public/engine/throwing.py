"""Authoritative fixed-step sphere throwing. JS preview mirrors this module;
parity fixtures test the two on identical maps. Client landing points are never
trusted. The entire short flight is solved once and sent as a bounded polyline.
"""
import math
import combat

GRENADES = {g['id']: g for g in combat.WEAPONS_DATA['grenades']}


def planes(b):
    x0, x1 = b['x']-b['w']/2, b['x']+b['w']/2
    y0, y1 = b['y']-b['h']/2, b['y']+b['h']/2
    z0, z1 = b['z']-b['d']/2, b['z']+b['d']/2
    out = [(1, 0, 0, x1), (-1, 0, 0, -x0), (0, -1, 0, -y0), (0, 0, 1, z1), (0, 0, -1, -z0)]
    if b['t'] == 'ramp':
        z = b['ax'] == 'z'
        slope = (b['y1']-b['y0']) / max(1e-6, b['d'] if z else b['w'])
        length = math.hypot(slope, 1)
        out.append((0 if z else -slope/length, 1/length, -slope/length if z else 0,
                    (b['y0']-slope*(z0 if z else x0))/length))
    else:
        out.append((0, 1, 0, y1))
    return out


def sweep(origin, end, radius, cache=None):
    """Earliest padded convex-solid hit on a segment, including ramps."""
    delta = [end[i]-origin[i] for i in range(3)]
    reach = math.hypot(delta[0], delta[2])/2 + radius
    boxes = combat._near((origin[0]+end[0])/2, (origin[2]+end[2])/2, reach)
    if cache is None:
        cache = {}
    shapes = []
    for box in boxes:
        key = id(box)
        if key not in cache:
            cache[key] = planes(box)
        shapes.append(cache[key])
    shapes.append([(0, 1, 0, combat.FLOOR_BASE)])
    best, normal = 1.0, None
    for shape in shapes:
        enter, leave, n, hit = 0.0, best, None, True
        for plane in shape:
            start = plane[0]*origin[0]+plane[1]*origin[1]+plane[2]*origin[2]-plane[3]-radius
            speed = plane[0]*delta[0]+plane[1]*delta[1]+plane[2]*delta[2]
            if abs(speed) < 1e-10:
                if start > 0:
                    hit = False
                    break
            else:
                t = -start/speed
                if speed < 0 and t >= enter:
                    enter, n = t, plane[:3]
                elif speed > 0:
                    leave = min(leave, t)
                if enter > leave:
                    hit = False
                    break
        if hit and n is not None and 0 <= enter <= best and leave >= 0:
            best, normal = enter, n
    # Invisible map bounds keep a high lob inside the playable area.
    for axis, lo, hi in ((0, combat.BOUNDS['minX'], combat.BOUNDS['maxX']), (2, combat.BOUNDS['minZ'], combat.BOUNDS['maxZ'])):
        if abs(delta[axis]) < 1e-10:
            continue
        bound = hi-radius if delta[axis] > 0 else lo+radius
        t = (bound-origin[axis])/delta[axis]
        if 0 <= t <= best:
            best, normal = t, tuple((-1 if delta[axis] > 0 else 1) if i == axis else 0 for i in range(3))
    return (best, normal) if normal else None


def simulate(origin, direction, power, kind, inherited=(0, 0, 0)):
    cfg = combat.THROW
    spec = GRENADES.get(kind, dict(fuseMs=3500, impact=True))  # scout flare
    d = combat.normalize(direction)
    if d == (0, 0, 0):
        d = (1, 0, 0)
    power = combat.clamp(power, 0, 1)
    speed = cfg['minSpeed'] + ((cfg['flareSpeed'] if kind == 'flare' else cfg['maxSpeed'])-cfg['minSpeed'])*power
    cap = combat.COMBAT['maxMoveSpeed']*1.35
    velocity = [d[i]*speed + combat.clamp(inherited[i], -cap, cap)*0.45 for i in range(3)]
    velocity[1] += cfg['upBoost']*(1-abs(d[1])*0.5)
    position = list(origin)
    path = [[0]+[round(v, 4) for v in position]]
    dt, rest, bounces, time_ms = 1/cfg['stepHz'], False, 0, 0
    cache = {}
    steps = math.ceil(spec['fuseMs']/1000/dt)
    for step in range(1, steps+1):
        hit_this_step = False
        if not rest:
            velocity[1] -= cfg['gravity']*dt
            remaining = dt
            for _ in range(4):
                target = [position[i]+velocity[i]*remaining for i in range(3)]
                collision = sweep(position, target, cfg['radius'], cache)
                if collision is None:
                    position = target
                    break
                fraction, normal = collision
                position = [position[i]+(target[i]-position[i])*fraction+normal[i]*0.001 for i in range(3)]
                vn = sum(velocity[i]*normal[i] for i in range(3))
                friction = cfg['friction'] if normal[1] > 0.45 else 0.9
                velocity = [(velocity[i]-normal[i]*vn)*friction-normal[i]*vn*cfg['restitution'] for i in range(3)]
                bounces += 1
                hit_this_step = True
                remaining *= 1-fraction
                if normal[1] > 0.45 and math.sqrt(sum(v*v for v in velocity)) < 1.3:
                    velocity, rest = [0, 0, 0], True
                    break
                if spec.get('impact') and step*dt >= 0.08:
                    break
        time_ms = round(step*dt*1000, 3)
        if step % 4 == 0 or hit_this_step or step == steps:
            path.append([time_ms]+[round(v, 4) for v in position])
        if hit_this_step and spec.get('impact') and step*dt >= 0.08:
            break
    if path[-1][0] != time_ms:
        path.append([time_ms]+[round(v, 4) for v in position])
    return dict(path=path, delay=time_ms, p=[round(v, 4) for v in position], bounces=bounces)
