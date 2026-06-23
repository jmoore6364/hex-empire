// wonders.js — World Wonders: powerful, one-per-game buildings. The first civ to
// finish one claims it; everyone else loses it from their options. Each grants an
// empire-wide bonus (same `effect` shape as a civ trait / policy, folded into
// Game.civMods). Pure logic, NO rendering deps.

export const WONDERS = {
  pyramids:        { name: 'The Pyramids',       glyph: '🔺', cost: 120, requires: 'masonry',     desc: '+20% production', effect: { prodMul: 1.2 } },
  hanging_gardens: { name: 'The Hanging Gardens', glyph: '🌿', cost: 130, requires: 'pottery',     desc: '+25% food',       effect: { foodMul: 1.25 } },
  great_library:   { name: 'The Great Library',  glyph: '📚', cost: 150, requires: 'writing',     desc: '+30% science',    effect: { sciMul: 1.3 } },
  colossus:        { name: 'The Colossus',       glyph: '🗿', cost: 140, requires: 'sailing', coastal: true, desc: '+30% gold (coastal city)', effect: { goldMul: 1.3 } },
  great_wall:      { name: 'The Great Wall',     glyph: '🧱', cost: 150, requires: 'masonry',     desc: '+3 combat strength', effect: { combat: 3 } },
  terracotta_army: { name: 'The Terracotta Army', glyph: '🪖', cost: 170, requires: 'iron_working', desc: '-30% military cost', effect: { militaryDiscount: 0.7 } },
};

// Wonder ids the civ can attempt, gated by tech (excludes ones already built —
// the caller passes the set of taken wonder ids).
export function unlockedWonders(researchedTech, taken = new Set()) {
  return Object.keys(WONDERS).filter(id => !taken.has(id) && researchedTech.has(WONDERS[id].requires));
}
