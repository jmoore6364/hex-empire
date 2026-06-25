// tech.js — the technology tree. Pure logic, NO rendering deps, so it can be
// unit-tested in plain Node. Science (banked per civ in game.js) is spent to
// research techs; picking a deep tech queues the whole prerequisite path to it.
//
// `era` places a tech in a column for the tree view; `requires` lists
// prerequisite tech ids; `unlocks` is a human label for what it grants. The
// early tech ids (pottery/writing/bronze/currency/masonry/sailing/…) are also
// referenced by units.js / buildings.js / wonders.js / districts.js — keep
// existing ids and their prerequisites stable.
export const ERAS = ['Ancient', 'Classical', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Information'];

export const TECHS = {
  // ── Era I · Ancient ──────────────────────────────────────────────────────
  pottery:           { name: 'Pottery',          era: 0, cost: 20,  requires: [],                                 unlocks: 'Granary' },
  animal_husbandry:  { name: 'Animal Husbandry', era: 0, cost: 20,  requires: [],                                 unlocks: 'Horseman' },
  trapping:          { name: 'Trapping',         era: 0, cost: 24,  requires: ['animal_husbandry'],               unlocks: 'Stable' },
  masonry:           { name: 'Masonry',          era: 0, cost: 25,  requires: [],                                 unlocks: 'City Walls' },
  sailing:           { name: 'Sailing',          era: 0, cost: 25,  requires: ['pottery'],                        unlocks: 'Galley, Harbor & embarking' },
  writing:           { name: 'Writing',          era: 0, cost: 30,  requires: ['pottery'],                        unlocks: 'Library' },
  bronze:            { name: 'Bronze Working',   era: 0, cost: 30,  requires: ['pottery'],                        unlocks: 'Workshop & Spearman' },

  // ── Era II · Classical ───────────────────────────────────────────────────
  currency:          { name: 'Currency',         era: 1, cost: 55,  requires: ['writing'],                        unlocks: 'Market' },
  the_wheel:         { name: 'The Wheel',        era: 1, cost: 55,  requires: ['animal_husbandry'],               unlocks: 'Catapult' },
  iron_working:      { name: 'Iron Working',     era: 1, cost: 60,  requires: ['bronze'],                         unlocks: 'Swordsman' },
  mathematics:       { name: 'Mathematics',      era: 1, cost: 70,  requires: ['writing', 'masonry'],             unlocks: 'University' },
  construction:      { name: 'Construction',     era: 1, cost: 65,  requires: ['masonry', 'the_wheel'],           unlocks: 'Engineering & roads' },
  philosophy:        { name: 'Philosophy',       era: 1, cost: 65,  requires: ['writing'],                        unlocks: 'The Oracle' },

  // ── Era III · Medieval ───────────────────────────────────────────────────
  engineering:       { name: 'Engineering',      era: 2, cost: 110, requires: ['mathematics', 'construction'],    unlocks: 'Aqueduct' },
  banking:           { name: 'Banking',          era: 2, cost: 120, requires: ['currency', 'mathematics'],        unlocks: 'Bank' },
  machinery:         { name: 'Machinery',        era: 2, cost: 120, requires: ['iron_working', 'engineering'],    unlocks: 'Crossbowman' },
  chivalry:          { name: 'Chivalry',         era: 2, cost: 125, requires: ['the_wheel', 'iron_working'],      unlocks: 'Knight & Castle' },
  education:         { name: 'Education',        era: 2, cost: 115, requires: ['mathematics', 'philosophy'],      unlocks: 'Astronomy & Economics' },

  // ── Era IV · Renaissance ─────────────────────────────────────────────────
  gunpowder:         { name: 'Gunpowder',        era: 3, cost: 160, requires: ['machinery', 'iron_working'],      unlocks: 'Musketman & Frigate' },
  metallurgy:        { name: 'Metallurgy',       era: 3, cost: 175, requires: ['gunpowder'],                      unlocks: 'Cannon' },
  astronomy:         { name: 'Astronomy',        era: 3, cost: 155, requires: ['mathematics', 'education'],       unlocks: 'Observatory' },
  economics:         { name: 'Economics',        era: 3, cost: 185, requires: ['banking', 'education'],           unlocks: 'Stock Exchange & Big Ben' },
  printing_press:    { name: 'Printing Press',   era: 3, cost: 165, requires: ['education', 'machinery'],         unlocks: 'Knowledge spreads' },
  navigation:        { name: 'Navigation',       era: 3, cost: 170, requires: ['astronomy', 'sailing'],           unlocks: 'Destroyer' },

  // ── Era V · Industrial ───────────────────────────────────────────────────
  industrialization: { name: 'Industrialization', era: 4, cost: 215, requires: ['banking', 'machinery'],         unlocks: 'Factory' },
  steel:             { name: 'Steel',            era: 4, cost: 225, requires: ['gunpowder', 'engineering'],       unlocks: 'Artillery' },
  scientific_method: { name: 'Scientific Method', era: 4, cost: 210, requires: ['education', 'printing_press'],   unlocks: 'Laboratory' },
  sanitation:        { name: 'Sanitation',       era: 4, cost: 220, requires: ['scientific_method', 'engineering'], unlocks: 'Sewer' },
  rifling:           { name: 'Rifling',          era: 4, cost: 235, requires: ['metallurgy', 'gunpowder'],        unlocks: 'Rifleman' },
  electricity:       { name: 'Electricity',      era: 4, cost: 230, requires: ['industrialization', 'scientific_method'], unlocks: 'Power Plant' },

  // ── Era VI · Modern ──────────────────────────────────────────────────────
  combustion:        { name: 'Combustion',       era: 5, cost: 290, requires: ['industrialization', 'steel'],     unlocks: 'Tank' },
  ballistics:        { name: 'Ballistics',       era: 5, cost: 300, requires: ['steel', 'rifling'],               unlocks: 'Battleship' },
  radio:             { name: 'Radio',            era: 5, cost: 285, requires: ['electricity'],                     unlocks: 'Bomber' },
  flight:            { name: 'Flight',           era: 5, cost: 320, requires: ['combustion'],                      unlocks: 'Airplane ✈' },
  plastics:          { name: 'Plastics',         era: 5, cost: 295, requires: ['combustion', 'electricity'],       unlocks: 'Infantry' },
  mass_production:    { name: 'Mass Production',  era: 5, cost: 330, requires: ['industrialization', 'combustion'], unlocks: 'Assembly lines' },

  // ── Era VII · Information ─────────────────────────────────────────────────
  computers:         { name: 'Computers',        era: 6, cost: 410, requires: ['mass_production', 'radio'],        unlocks: 'Modern Armor, Research Lab & the Internet' },
  rocketry:          { name: 'Rocketry',         era: 6, cost: 440, requires: ['ballistics', 'flight'],            unlocks: 'Jet Fighter & Apollo Program' },
  nuclear_fission:   { name: 'Nuclear Fission',  era: 6, cost: 470, requires: ['mass_production', 'electricity'],  unlocks: 'The Atomic Age' },
  robotics:          { name: 'Robotics',         era: 6, cost: 490, requires: ['computers', 'mass_production'],    unlocks: 'Automation' },
  telecommunications:{ name: 'Telecommunications', era: 6, cost: 460, requires: ['computers', 'radio'],            unlocks: 'Global networks' },
};

// Have all prerequisites of `id` been researched (and `id` not already known)?
export function canResearch(id, researched) {
  const t = TECHS[id];
  if (!t || researched.has(id)) return false;
  return t.requires.every(req => researched.has(req));
}

// Tech ids that can be picked right now (prereqs met), cheapest first.
export function availableTechs(researched) {
  return Object.keys(TECHS)
    .filter(id => canResearch(id, researched))
    .sort((a, b) => TECHS[a].cost - TECHS[b].cost);
}

// The ordered list of techs to research to reach `target`: every unresearched
// prerequisite first (in dependency order), ending with `target`. Returns [] if
// `target` is already researched. This is what lets you click a distant tech and
// have the path to it queued automatically.
export function pathTo(target, researched = new Set()) {
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (!TECHS[id] || researched.has(id) || seen.has(id)) return;
    seen.add(id);
    for (const req of TECHS[id].requires) visit(req);
    order.push(id);
  };
  visit(target);
  return order;
}
