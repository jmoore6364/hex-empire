// civics.js — the civics tree (the cultural counterpart to the tech tree),
// plus governments and policy cards. Pure logic, NO rendering deps.
//
// Civics are paid for with Culture (banked per civ). Researching a civic unlocks
// governments, policy cards, and culture buildings. A government provides policy
// slots by category (military / economic / wildcard); policy cards slotted into
// them grant empire-wide bonuses.
export const ERAS = ['Ancient', 'Classical', 'Medieval', 'Industrial', 'Modern'];

export const CIVICS = {
  code_of_laws:         { name: 'Code of Laws',         era: 0, cost: 20,  requires: [],                                  unlocks: 'Government · Monument · Discipline' },
  craftsmanship:        { name: 'Craftsmanship',        era: 0, cost: 35,  requires: ['code_of_laws'],                    unlocks: 'Urban Planning' },
  military_tradition:   { name: 'Military Tradition',   era: 0, cost: 40,  requires: ['code_of_laws'],                    unlocks: 'Maneuver' },
  early_empire:         { name: 'Early Empire',         era: 1, cost: 60,  requires: ['craftsmanship'],                   unlocks: 'Autocracy · Colonization' },
  drama:                { name: 'Drama & Poetry',       era: 1, cost: 65,  requires: ['craftsmanship'],                   unlocks: 'Amphitheater' },
  political_philosophy: { name: 'Political Philosophy', era: 1, cost: 80,  requires: ['early_empire'],                    unlocks: 'Republic' },
  feudalism:            { name: 'Feudalism',            era: 2, cost: 120, requires: ['military_tradition', 'early_empire'], unlocks: 'Serfdom · Levée' },
  nationalism:          { name: 'Nationalism',          era: 3, cost: 170, requires: ['political_philosophy'],            unlocks: 'Democracy' },
};

// Governments: `civic` is the civic that unlocks it (null = available from the
// start); `slots` are policy slots by category; `bonus` is an inherent effect.
export const GOVERNMENTS = {
  chiefdom:  { name: 'Chiefdom',  civic: null,                   slots: { mil: 1, eco: 1, wild: 0 }, bonus: {},               desc: 'The starting government.' },
  autocracy: { name: 'Autocracy', civic: 'early_empire',         slots: { mil: 2, eco: 1, wild: 0 }, bonus: { prodMul: 1.1 }, desc: '+10% production.' },
  republic:  { name: 'Republic',  civic: 'political_philosophy', slots: { mil: 1, eco: 2, wild: 1 }, bonus: { goldMul: 1.15 }, desc: '+15% gold.' },
  democracy: { name: 'Democracy', civic: 'nationalism',          slots: { mil: 2, eco: 2, wild: 1 }, bonus: { sciMul: 1.15 }, desc: '+15% science.' },
};

// Policy cards: `slot` is the category it fits (a wildcard slot accepts any);
// `civic` unlocks it; `effect` is merged into the civ's modifiers when active.
export const POLICIES = {
  discipline:     { name: 'Discipline',     slot: 'mil', civic: 'code_of_laws',       desc: '+2 combat strength',       effect: { combat: 2 } },
  maneuver:       { name: 'Maneuver',       slot: 'mil', civic: 'military_tradition', desc: '+2 combat strength',       effect: { combat: 2 } },
  levee:          { name: 'Levée en Masse', slot: 'mil', civic: 'feudalism',          desc: 'Military units 25% cheaper', effect: { militaryDiscount: 0.75 } },
  urban_planning: { name: 'Urban Planning', slot: 'eco', civic: 'craftsmanship',      desc: '+20% production',          effect: { prodMul: 1.2 } },
  colonization:   { name: 'Colonization',   slot: 'eco', civic: 'early_empire',       desc: 'Settlers 30% cheaper',     effect: { settlerDiscount: 0.7 } },
  serfdom:        { name: 'Serfdom',        slot: 'eco', civic: 'feudalism',          desc: '+25% city food',           effect: { foodMul: 1.25 } },
};

export function canResearch(id, researched) {
  const c = CIVICS[id];
  if (!c || researched.has(id)) return false;
  return c.requires.every(req => researched.has(req));
}

export function availableCivics(researched) {
  return Object.keys(CIVICS).filter(id => canResearch(id, researched)).sort((a, b) => CIVICS[a].cost - CIVICS[b].cost);
}

export function pathTo(target, researched = new Set()) {
  const order = [], seen = new Set();
  const visit = (id) => {
    if (!CIVICS[id] || researched.has(id) || seen.has(id)) return;
    seen.add(id);
    for (const req of CIVICS[id].requires) visit(req);
    order.push(id);
  };
  visit(target);
  return order;
}

// Governments a civ may adopt given its researched civics (Chiefdom is always on).
export function availableGovernments(researched) {
  return Object.keys(GOVERNMENTS).filter(id => !GOVERNMENTS[id].civic || researched.has(GOVERNMENTS[id].civic));
}

// Policy cards a civ has unlocked.
export function availablePolicies(researched) {
  return Object.keys(POLICIES).filter(id => researched.has(POLICIES[id].civic));
}
