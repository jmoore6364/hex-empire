// resources.js — special tile resources that boost the yields of the tile they
// sit on (and therefore any city working it). Pure logic, NO rendering deps.

// `terrains` lists where a resource may spawn; `bonus` is added to the tile's
// base yields; `color` is consumed by the renderer for its map marker.
//
// `trade` is an empire-wide bonus a nation earns once for having ACCESS to that
// resource type (owning a tile that bears it, or leasing it in via a diplomatic
// deal). Duplicates of a type you already have add nothing — so the value of a
// resource is in acquiring a *type you lack*, which is what makes nation-to-
// nation resource trading worthwhile. `icon`/`label` drive the deal UI.
export const RESOURCES = {
  wheat:  { name: 'Wheat',  icon: '🌾', terrains: ['GRASSLAND', 'PLAINS'],   bonus: { food: 2 },          trade: { gold: 2 },             color: 0xe8d24a },
  fish:   { name: 'Fish',   icon: '🐟', terrains: ['COAST'],                 bonus: { food: 2, gold: 1 }, trade: { gold: 2, science: 1 }, color: 0x6fd0e8 },
  horses: { name: 'Horses', icon: '🐎', terrains: ['PLAINS', 'GRASSLAND'],   bonus: { prod: 1, gold: 1 }, trade: { gold: 3 },             color: 0xc8a06a },
  iron:   { name: 'Iron',   icon: '⛏', terrains: ['HILLS', 'MOUNTAIN'],     bonus: { prod: 2 },          trade: { gold: 2, science: 2 }, color: 0xb6bcc6 },
  gold:   { name: 'Gold',   icon: '💰', terrains: ['HILLS', 'DESERT'],       bonus: { gold: 3 },          trade: { gold: 5 },             color: 0xf5c542 },
  stone:  { name: 'Stone',  icon: '🪨', terrains: ['HILLS', 'TUNDRA'],       bonus: { prod: 1, gold: 1 }, trade: { gold: 2 },             color: 0x9aa0a6 },
};

// Every resource id is tradeable as a leased good in diplomatic deals.
export const TRADEABLE = Object.keys(RESOURCES);

// Resource ids that can appear on a given terrain.
export function resourcesForTerrain(terrain) {
  return Object.keys(RESOURCES).filter(id => RESOURCES[id].terrains.includes(terrain));
}

// Add a resource's bonus to a yields object. Returns a new object (the base
// yields are shared across tiles, so we never mutate them in place).
export function applyResource(yields, resourceId) {
  const r = RESOURCES[resourceId];
  if (!r) return yields;
  const out = { ...yields };
  for (const k in r.bonus) out[k] = (out[k] || 0) + r.bonus[k];
  return out;
}

// Short "+2 food, +1 gold" style summary for the UI.
export function resourceSummary(resourceId) {
  const r = RESOURCES[resourceId];
  if (!r) return '';
  return Object.entries(r.bonus).map(([k, v]) => `+${v} ${k}`).join(', ');
}
