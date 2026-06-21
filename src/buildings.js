// buildings.js — city buildings that modify yields, built through the city
// production queue and gated by tech. Pure logic, NO rendering deps.

// `cost` is in production points; `requires` is the tech id that unlocks it;
// `mult` multiplies the named yield(s) of the city it sits in.
export const BUILDINGS = {
  granary:  { name: 'Granary',  cost: 35, requires: 'pottery',  desc: '+25% food',       mult: { food: 1.25 } },
  workshop: { name: 'Workshop', cost: 45, requires: 'bronze',   desc: '+25% production', mult: { prod: 1.25 } },
  market:   { name: 'Market',   cost: 45, requires: 'currency', desc: '+50% gold',       mult: { gold: 1.5 } },
  library:  { name: 'Library',  cost: 45, requires: 'writing',  desc: '+50% science',    mult: { science: 1.5 } },
};

// Building ids whose prerequisite tech is in `researched`.
export function unlockedBuildings(researched) {
  return Object.keys(BUILDINGS).filter(id => researched.has(BUILDINGS[id].requires));
}

// Apply every constructed building's multipliers to a yields object.
// `built` is an iterable of building ids. Returns a new (unrounded) yields object.
export function applyBuildings(yields, built) {
  const out = { ...yields };
  for (const id of built) {
    const m = BUILDINGS[id]?.mult;
    if (!m) continue;
    for (const k in m) out[k] = (out[k] || 0) * m[k];
  }
  return out;
}
