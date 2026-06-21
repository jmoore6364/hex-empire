// resources.js — special tile resources that boost the yields of the tile they
// sit on (and therefore any city working it). Pure logic, NO rendering deps.

// `terrains` lists where a resource may spawn; `bonus` is added to the tile's
// base yields; `color` is consumed by the renderer for its map marker.
export const RESOURCES = {
  wheat:  { name: 'Wheat',  terrains: ['GRASSLAND', 'PLAINS'],   bonus: { food: 2 },          color: 0xe8d24a },
  fish:   { name: 'Fish',   terrains: ['COAST'],                 bonus: { food: 2, gold: 1 }, color: 0x6fd0e8 },
  horses: { name: 'Horses', terrains: ['PLAINS', 'GRASSLAND'],   bonus: { prod: 1, gold: 1 }, color: 0xc8a06a },
  iron:   { name: 'Iron',   terrains: ['HILLS', 'MOUNTAIN'],     bonus: { prod: 2 },          color: 0xb6bcc6 },
  gold:   { name: 'Gold',   terrains: ['HILLS', 'DESERT'],       bonus: { gold: 3 },          color: 0xf5c542 },
  stone:  { name: 'Stone',  terrains: ['HILLS', 'TUNDRA'],       bonus: { prod: 1, gold: 1 }, color: 0x9aa0a6 },
};

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
