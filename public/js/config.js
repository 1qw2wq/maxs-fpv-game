// Loads the same JSON the Python server uses. There is exactly one copy of the
// numbers, served from /shared/, so client and server can never drift.

export async function loadConfig() {
  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
    return r.json();
  });

  const [w, reg] = await Promise.all([
    get('/shared/weapons.json'),
    get('/shared/maps.json'),
  ]);

  const data = {
    combat: w.combat,
    grenades: w.grenades,
    grenadeById: Object.fromEntries(w.grenades.map(g=>[g.id,g])),
    teams: w.teams,
    teamById: Object.fromEntries(w.teams.map((t) => [t.id, t])),
    classes: w.classes,
    classById: Object.fromEntries(w.classes.map((c) => [c.id, c])),
    weapons: w.weapons,
    weaponById: Object.fromEntries(w.weapons.map((x) => [x.id, x])),
    weaponsByClass: {},
    // Registry only: the map JSON itself is fetched on demand by setMap(), so a
    // 92 MB model map never delays the menu.
    maps: reg.maps,
    mapById: Object.fromEntries(reg.maps.map((m) => [m.id, m])),
    defaultMapId: reg.default || reg.maps[0].id,
  };
  for (const x of w.weapons) {
    (data.weaponsByClass[x.class] ||= []).push(x);
  }

  // Sanity: the server rejects unknown ids, so catching it here gives a much
  // better error than silently falling back to the default rifle.
  for (const c of data.classes) {
    if (!data.weaponsByClass[c.id]?.length) throw new Error(`兵种 ${c.id} 没有可用武器`);
  }
  return data;
}
