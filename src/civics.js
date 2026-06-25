// civics.js — the civics tree (the cultural counterpart to the tech tree),
// plus governments and policy cards. Pure logic, NO rendering deps.
//
// Civics are paid for with Culture (banked per civ). Researching a civic unlocks
// governments, policy cards, and culture buildings. A government provides policy
// slots by category (military / economic / wildcard); policy cards slotted into
// them grant empire-wide bonuses (merged into Game.civMods, same effect keys as
// techs/wonders: foodMul, prodMul, goldMul, sciMul, combat, settlerDiscount,
// militaryDiscount). Existing civic ids (code_of_laws, drama, …) are referenced
// by buildings.js / districts.js — keep them and their prerequisites stable.
export const ERAS = ['Ancient', 'Classical', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Information'];

export const CIVICS = {
  // ── Ancient ────────────────────────────────────────────────────────────
  code_of_laws:         { name: 'Code of Laws',         era: 0, cost: 20,  requires: [],                                    unlocks: 'Government · Monument · Discipline' },
  craftsmanship:        { name: 'Craftsmanship',        era: 0, cost: 35,  requires: ['code_of_laws'],                      unlocks: 'Urban Planning' },
  military_tradition:   { name: 'Military Tradition',   era: 0, cost: 40,  requires: ['code_of_laws'],                      unlocks: 'Maneuver' },
  mysticism:            { name: 'Mysticism',            era: 0, cost: 35,  requires: ['code_of_laws'],                      unlocks: 'Theocracy' },

  // ── Classical ──────────────────────────────────────────────────────────
  early_empire:         { name: 'Early Empire',         era: 1, cost: 60,  requires: ['craftsmanship'],                     unlocks: 'Autocracy · Colonization' },
  drama:                { name: 'Drama & Poetry',       era: 1, cost: 65,  requires: ['craftsmanship'],                     unlocks: 'Amphitheater' },
  state_workforce:      { name: 'State Workforce',      era: 1, cost: 70,  requires: ['craftsmanship'],                     unlocks: 'Public Works' },
  political_philosophy: { name: 'Political Philosophy', era: 1, cost: 80,  requires: ['early_empire'],                      unlocks: 'Republic' },
  military_training:    { name: 'Military Training',    era: 1, cost: 75,  requires: ['military_tradition'],                unlocks: 'Oligarchy · Logistics' },

  // ── Medieval ───────────────────────────────────────────────────────────
  feudalism:            { name: 'Feudalism',            era: 2, cost: 120, requires: ['military_tradition', 'early_empire'], unlocks: 'Serfdom · Levée' },
  theology:             { name: 'Theology',             era: 2, cost: 125, requires: ['mysticism', 'drama'],                unlocks: 'Faith' },
  civil_service:        { name: 'Civil Service',        era: 2, cost: 130, requires: ['political_philosophy'],              unlocks: 'Scientific Academy' },
  guilds:               { name: 'Guilds',               era: 2, cost: 135, requires: ['feudalism'],                         unlocks: 'Guilds policy' },
  divine_right:         { name: 'Divine Right',         era: 2, cost: 130, requires: ['theology'],                          unlocks: 'Monarchy' },

  // ── Renaissance ────────────────────────────────────────────────────────
  nationalism:          { name: 'Nationalism',          era: 3, cost: 175, requires: ['political_philosophy'],              unlocks: 'Democracy' },
  mercantilism:         { name: 'Mercantilism',         era: 3, cost: 180, requires: ['guilds', 'early_empire'],            unlocks: 'Merchant Republic · Free Trade' },
  humanism:             { name: 'Humanism',             era: 3, cost: 170, requires: ['civil_service', 'drama'],            unlocks: 'Inspiration' },
  reformation:          { name: 'Reformation',          era: 3, cost: 165, requires: ['theology', 'political_philosophy'],  unlocks: 'Religious Tolerance' },
  exploration:          { name: 'Exploration',          era: 3, cost: 185, requires: ['mercantilism'],                      unlocks: 'Colonial Offices' },

  // ── Industrial ─────────────────────────────────────────────────────────
  capitalism:           { name: 'Capitalism',           era: 4, cost: 230, requires: ['mercantilism', 'nationalism'],       unlocks: 'Free Market' },
  conscription:         { name: 'Conscription',         era: 4, cost: 225, requires: ['nationalism', 'feudalism'],          unlocks: 'Conscription policy' },

  // ── Modern ─────────────────────────────────────────────────────────────
  ideology:             { name: 'Ideology',             era: 5, cost: 300, requires: ['nationalism', 'capitalism'],         unlocks: 'Communism · Fascism · Total War' },

  // ── Information ─────────────────────────────────────────────────────────
  globalization:        { name: 'Globalization',        era: 6, cost: 400, requires: ['ideology', 'capitalism'],            unlocks: 'Public Health' },
  digital_age:          { name: 'Digital Age',          era: 6, cost: 420, requires: ['ideology'],                          unlocks: 'Online Communities' },
};

// Governments: `civic` is the civic that unlocks it (null = available from the
// start); `slots` are policy slots by category; `bonus` is an inherent effect.
export const GOVERNMENTS = {
  chiefdom:         { name: 'Chiefdom',          civic: null,                   slots: { mil: 1, eco: 1, wild: 0 }, bonus: {},                desc: 'The starting government.' },
  autocracy:        { name: 'Autocracy',         civic: 'early_empire',         slots: { mil: 2, eco: 1, wild: 0 }, bonus: { prodMul: 1.1 },  desc: '+10% production; militaristic slots.' },
  oligarchy:        { name: 'Oligarchy',         civic: 'military_training',    slots: { mil: 3, eco: 1, wild: 0 }, bonus: { combat: 1 },     desc: '+1 combat; extra military slots.' },
  monarchy:         { name: 'Monarchy',          civic: 'divine_right',         slots: { mil: 2, eco: 2, wild: 0 }, bonus: { goldMul: 1.1 },  desc: '+10% gold; balanced slots.' },
  theocracy:        { name: 'Theocracy',         civic: 'mysticism',            slots: { mil: 1, eco: 1, wild: 2 }, bonus: { sciMul: 1.1 },   desc: '+10% science; two wildcard slots.' },
  republic:         { name: 'Republic',          civic: 'political_philosophy', slots: { mil: 1, eco: 2, wild: 1 }, bonus: { goldMul: 1.15 }, desc: '+15% gold.' },
  merchant_republic:{ name: 'Merchant Republic', civic: 'mercantilism',         slots: { mil: 1, eco: 3, wild: 1 }, bonus: { goldMul: 1.2 },  desc: '+20% gold; a trade powerhouse.' },
  democracy:        { name: 'Democracy',         civic: 'nationalism',          slots: { mil: 2, eco: 2, wild: 1 }, bonus: { sciMul: 1.15 },  desc: '+15% science.' },
  communism:        { name: 'Communism',         civic: 'ideology',             slots: { mil: 2, eco: 3, wild: 0 }, bonus: { prodMul: 1.2 },  desc: '+20% production; a planned economy.' },
  fascism:          { name: 'Fascism',           civic: 'ideology',             slots: { mil: 4, eco: 1, wild: 1 }, bonus: { combat: 3 },     desc: '+3 combat; a war machine.' },
};

// Policy cards: `slot` is the category it fits (a wildcard slot accepts any);
// `civic` unlocks it; `effect` is merged into the civ's modifiers when active.
export const POLICIES = {
  // Military
  discipline:      { name: 'Discipline',       slot: 'mil', civic: 'code_of_laws',       desc: '+2 combat strength',         effect: { combat: 2 } },
  maneuver:        { name: 'Maneuver',         slot: 'mil', civic: 'military_tradition', desc: '+2 combat strength',         effect: { combat: 2 } },
  logistics:       { name: 'Logistics',        slot: 'mil', civic: 'military_training',  desc: '+3 combat strength',         effect: { combat: 3 } },
  levee:           { name: 'Levée en Masse',   slot: 'mil', civic: 'feudalism',          desc: 'Military units 25% cheaper', effect: { militaryDiscount: 0.75 } },
  conscription:    { name: 'Conscription',     slot: 'mil', civic: 'conscription',       desc: 'Military units 30% cheaper', effect: { militaryDiscount: 0.7 } },
  total_war:       { name: 'Total War',        slot: 'mil', civic: 'ideology',           desc: '+3 combat strength',         effect: { combat: 3 } },

  // Economic
  urban_planning:  { name: 'Urban Planning',   slot: 'eco', civic: 'craftsmanship',      desc: '+20% production',            effect: { prodMul: 1.2 } },
  public_works:    { name: 'Public Works',     slot: 'eco', civic: 'state_workforce',    desc: '+20% production',            effect: { prodMul: 1.2 } },
  colonization:    { name: 'Colonization',     slot: 'eco', civic: 'early_empire',       desc: 'Settlers 30% cheaper',       effect: { settlerDiscount: 0.7 } },
  colonial_offices:{ name: 'Colonial Offices', slot: 'eco', civic: 'exploration',        desc: 'Settlers 45% cheaper',       effect: { settlerDiscount: 0.55 } },
  serfdom:         { name: 'Serfdom',          slot: 'eco', civic: 'feudalism',          desc: '+25% city food',             effect: { foodMul: 1.25 } },
  guilds:          { name: 'Guilds',           slot: 'eco', civic: 'guilds',             desc: '+20% gold',                  effect: { goldMul: 1.2 } },
  free_trade:      { name: 'Free Trade',       slot: 'eco', civic: 'mercantilism',       desc: '+20% gold',                  effect: { goldMul: 1.2 } },
  free_market:     { name: 'Free Market',      slot: 'eco', civic: 'capitalism',         desc: '+30% gold',                  effect: { goldMul: 1.3 } },
  five_year_plan:  { name: 'Five-Year Plan',   slot: 'eco', civic: 'ideology',           desc: '+30% production',            effect: { prodMul: 1.3 } },
  public_health:   { name: 'Public Health',    slot: 'eco', civic: 'globalization',      desc: '+30% city food',             effect: { foodMul: 1.3 } },

  // Wildcard
  faith:               { name: 'Faith',               slot: 'wild', civic: 'theology',      desc: '+15% gold (tithes)',  effect: { goldMul: 1.15 } },
  inspiration:         { name: 'Inspiration',         slot: 'wild', civic: 'humanism',      desc: '+20% science',        effect: { sciMul: 1.2 } },
  scientific_academy:  { name: 'Scientific Academy',  slot: 'wild', civic: 'civil_service', desc: '+25% science',        effect: { sciMul: 1.25 } },
  religious_tolerance: { name: 'Religious Tolerance',  slot: 'wild', civic: 'reformation',   desc: '+15% gold',           effect: { goldMul: 1.15 } },
  propaganda:          { name: 'Propaganda',          slot: 'wild', civic: 'ideology',      desc: '+2 combat strength',  effect: { combat: 2 } },
  online_communities:  { name: 'Online Communities',  slot: 'wild', civic: 'digital_age',   desc: '+30% science',        effect: { sciMul: 1.3 } },
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
