// buildings.js — city buildings that modify yields, built through the city
// production queue and gated by tech. Pure logic, NO rendering deps.

// `cost` is in production points; `requires` is the tech id that unlocks it;
// `mult` multiplies the named yield(s) of the city it sits in.
// `mult` scales the named yield(s); `defense` (Walls) instead boosts a unit
// garrisoned in the city; `culture` adds a flat culture amount; `requires` is a
// tech id and `civic` (culture buildings) is a civic id that unlocks it.
export const BUILDINGS = {
  monument:    { name: 'Monument',    cost: 30,  civic: 'code_of_laws',         desc: '+2 culture',      culture: 2 },
  amphitheater:{ name: 'Amphitheater',cost: 45,  civic: 'drama',                desc: '+3 culture',      culture: 3 },
  granary:    { name: 'Granary',    cost: 35,  requires: 'pottery',           desc: '+25% food',       mult: { food: 1.25 } },
  workshop:   { name: 'Workshop',   cost: 45,  requires: 'bronze',            desc: '+25% production', mult: { prod: 1.25 } },
  library:    { name: 'Library',    cost: 45,  requires: 'writing',           desc: '+50% science',    mult: { science: 1.5 } },
  market:     { name: 'Market',     cost: 45,  requires: 'currency',          desc: '+50% gold',       mult: { gold: 1.5 } },
  walls:      { name: 'City Walls', cost: 40,  requires: 'masonry',           desc: '+ city defense',  defense: 1.5 },
  aqueduct:   { name: 'Aqueduct',   cost: 55,  requires: 'engineering',       desc: '+25% food',       mult: { food: 1.25 } },
  university: { name: 'University',  cost: 65,  requires: 'mathematics',       desc: '+50% science',    mult: { science: 1.5 } },
  bank:       { name: 'Bank',       cost: 65,  requires: 'banking',           desc: '+50% gold',       mult: { gold: 1.5 } },
  factory:    { name: 'Factory',    cost: 85,  requires: 'industrialization', desc: '+50% production', mult: { prod: 1.5 } },

  // Expanded tech tree adds more yield/defense buildings deeper in the tree.
  stable:       { name: 'Stable',        cost: 40,  requires: 'trapping',          desc: '+25% production', mult: { prod: 1.25 } },
  harbor:       { name: 'Harbor',        cost: 45,  requires: 'sailing',           desc: '+25% food & +25% gold', mult: { food: 1.25, gold: 1.25 } },
  castle:       { name: 'Castle',        cost: 70,  requires: 'chivalry',          desc: '++ city defense', defense: 2.0 },
  observatory:  { name: 'Observatory',   cost: 75,  requires: 'astronomy',         desc: '+50% science',    mult: { science: 1.5 } },
  stock_exchange:{ name: 'Stock Exchange', cost: 110, requires: 'economics',       desc: '+50% gold',       mult: { gold: 1.5 } },
  sewer:        { name: 'Sewer System',  cost: 95,  requires: 'sanitation',        desc: '+25% food',       mult: { food: 1.25 } },
  laboratory:   { name: 'Laboratory',    cost: 120, requires: 'scientific_method', desc: '+50% science',    mult: { science: 1.5 } },
  power_plant:  { name: 'Power Plant',   cost: 130, requires: 'electricity',       desc: '+50% production', mult: { prod: 1.5 } },
  research_lab: { name: 'Research Lab',  cost: 170, requires: 'computers',         desc: '+75% science',    mult: { science: 1.75 } },
};

// Building ids unlocked by the civ's researched techs and civics.
export function unlockedBuildings(researchedTech, researchedCivics = new Set()) {
  return Object.keys(BUILDINGS).filter(id => {
    const b = BUILDINGS[id];
    if (b.requires) return researchedTech.has(b.requires);
    if (b.civic) return researchedCivics.has(b.civic);
    return false;
  });
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
