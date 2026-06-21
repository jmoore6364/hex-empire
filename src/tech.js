// tech.js — a small starter technology tree. Pure logic, NO rendering deps,
// so it can be unit-tested in plain Node. Science (banked per civ in game.js)
// is spent to research techs; each tech unlocks a building in the city queue.

// `cost` is in science points; `requires` lists prerequisite tech ids.
export const TECHS = {
  pottery:  { name: 'Pottery',        cost: 20, requires: [],          unlocks: 'Granary' },
  writing:  { name: 'Writing',        cost: 30, requires: ['pottery'], unlocks: 'Library' },
  bronze:   { name: 'Bronze Working', cost: 30, requires: ['pottery'], unlocks: 'Workshop' },
  currency: { name: 'Currency',       cost: 45, requires: ['writing'], unlocks: 'Market' },
};

// Have all prerequisites of `id` been researched (and `id` not already known)?
export function canResearch(id, researched) {
  const t = TECHS[id];
  if (!t || researched.has(id)) return false;
  return t.requires.every(req => researched.has(req));
}

// Tech ids that can be picked right now, cheapest first.
export function availableTechs(researched) {
  return Object.keys(TECHS)
    .filter(id => canResearch(id, researched))
    .sort((a, b) => TECHS[a].cost - TECHS[b].cost);
}
