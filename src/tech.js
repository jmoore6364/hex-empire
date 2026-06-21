// tech.js — the technology tree. Pure logic, NO rendering deps, so it can be
// unit-tested in plain Node. Science (banked per civ in game.js) is spent to
// research techs; picking a deep tech queues the whole prerequisite path to it.
//
// `era` places a tech in a column for the tree view; `requires` lists
// prerequisite tech ids; `unlocks` is a human label for what it grants. The
// four early tech ids (pottery/writing/bronze/currency) are also referenced by
// buildings.js, so keep them stable.
export const ERAS = ['Ancient', 'Classical', 'Medieval', 'Industrial', 'Modern'];

export const TECHS = {
  // Era I — Ancient
  pottery:           { name: 'Pottery',          era: 0, cost: 20,  requires: [],                              unlocks: 'Granary' },
  animal_husbandry:  { name: 'Animal Husbandry', era: 0, cost: 20,  requires: [],                              unlocks: 'Horseman' },
  masonry:           { name: 'Masonry',          era: 0, cost: 25,  requires: [],                              unlocks: 'City Walls' },
  writing:           { name: 'Writing',          era: 0, cost: 30,  requires: ['pottery'],                     unlocks: 'Library' },
  bronze:            { name: 'Bronze Working',    era: 0, cost: 30,  requires: ['pottery'],                     unlocks: 'Workshop' },

  // Era II — Classical
  currency:          { name: 'Currency',         era: 1, cost: 55,  requires: ['writing'],                     unlocks: 'Market' },
  the_wheel:         { name: 'The Wheel',        era: 1, cost: 55,  requires: ['animal_husbandry'],            unlocks: 'Catapult' },
  iron_working:      { name: 'Iron Working',     era: 1, cost: 60,  requires: ['bronze'],                      unlocks: 'Swordsman' },
  mathematics:       { name: 'Mathematics',      era: 1, cost: 70,  requires: ['writing', 'masonry'],          unlocks: 'University' },

  // Era III — Medieval
  engineering:       { name: 'Engineering',      era: 2, cost: 110, requires: ['mathematics', 'the_wheel'],    unlocks: 'Aqueduct' },
  banking:           { name: 'Banking',          era: 2, cost: 120, requires: ['currency', 'mathematics'],     unlocks: 'Bank' },
  machinery:         { name: 'Machinery',        era: 2, cost: 120, requires: ['iron_working', 'engineering'], unlocks: 'Crossbowman' },
  gunpowder:         { name: 'Gunpowder',        era: 2, cost: 150, requires: ['machinery', 'iron_working'],   unlocks: 'Musketman' },

  // Era IV — Industrial
  industrialization: { name: 'Industrialization', era: 3, cost: 210, requires: ['banking', 'machinery'],       unlocks: 'Factory' },
  steel:             { name: 'Steel',            era: 3, cost: 220, requires: ['gunpowder', 'engineering'],    unlocks: 'Artillery' },
  combustion:        { name: 'Combustion',       era: 3, cost: 280, requires: ['industrialization', 'steel'],  unlocks: 'Tank' },

  // Era V — Modern
  flight:            { name: 'Flight',           era: 4, cost: 340, requires: ['combustion'],                  unlocks: 'Airplane ✈' },
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
