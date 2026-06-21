// Self-test for the pure-logic modules (no browser / Three needed).
// Run with:  npm test
import { neighbors, distance, hexToWorld, worldToHex, hexMap, key, hexesInRange } from '../src/hex.js';
import { generateWorld, findStartTile, TERRAIN } from '../src/worldgen.js';
import { findPath, reachable } from '../src/pathfinding.js';
import { TECHS, canResearch, availableTechs, pathTo } from '../src/tech.js';
import { BUILDINGS, unlockedBuildings, applyBuildings } from '../src/buildings.js';
import { computeOwnership, ownedTiles } from '../src/territory.js';
import { cityYields } from '../src/economy.js';
import { RESOURCES, resourcesForTerrain, applyResource } from '../src/resources.js';
import { defenseMultiplier, resolveAttack } from '../src/combat.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL:', name); }
}

// --- hex math ---
check('neighbors returns 6', neighbors(0, 0).length === 6);
check('distance to self is 0', distance({ q: 2, r: -3 }, { q: 2, r: -3 }) === 0);
check('neighbor distance is 1', distance({ q: 0, r: 0 }, { q: 1, r: -1 }) === 1);
check('distance symmetric', distance({ q: 1, r: 2 }, { q: -3, r: 4 }) === distance({ q: -3, r: 4 }, { q: 1, r: 2 }));

let roundTripOk = true;
for (const { q, r } of hexMap(6)) {
  const w = hexToWorld(q, r);
  const back = worldToHex(w.x, w.z);
  if (back.q !== q || back.r !== r) roundTripOk = false;
}
check('hexToWorld/worldToHex round-trips', roundTripOk);

check('hexMap(0) has 1 tile', hexMap(0).length === 1);
check('hexMap(2) has 19 tiles', hexMap(2).length === 19);
check('hexMap(3) has 37 tiles', hexMap(3).length === 37);
check('hexesInRange(_,1) has 7 tiles', hexesInRange(0, 0, 1).length === 7);

// --- world generation (deterministic by seed) ---
const world = generateWorld(10, 42);
check('world has tiles', world.tiles.size === hexMap(10).length);
let allValid = true, hasLand = false, hasOcean = false;
for (const t of world.tiles.values()) {
  if (!TERRAIN[t.terrain]) allValid = false;
  if (t.passable) hasLand = true;
  if (t.terrain === 'OCEAN') hasOcean = true;
}
check('every tile has a valid terrain', allValid);
check('world has passable land', hasLand);
check('world has ocean', hasOcean);

const a = generateWorld(8, 99);
const b = generateWorld(8, 99);
check('generation is deterministic per seed',
  [...a.tiles.values()].every(t => b.tiles.get(key(t.q, t.r)).terrain === t.terrain));

const start = findStartTile(world);
check('findStartTile returns a passable tile', start && start.passable);

// --- pathfinding ---
// Build a tiny hand-made grid so the path result is predictable.
const grid = new Map();
for (const { q, r } of hexMap(3)) {
  grid.set(key(q, r), { q, r, passable: true, moveCost: 1, terrain: 'PLAINS' });
}
const p = findPath(grid, { q: -3, r: 0 }, { q: 3, r: 0 });
check('findPath finds a route', Array.isArray(p) && p.length > 0);
check('path ends at the goal', p && p[p.length - 1].q === 3 && p[p.length - 1].r === 0);
check('path length is the hex distance', p && p.length === distance({ q: -3, r: 0 }, { q: 3, r: 0 }));

// Wall off the goal -> unreachable.
grid.get(key(3, 0)).passable = false;
check('findPath returns null for impassable goal', findPath(grid, { q: -3, r: 0 }, { q: 3, r: 0 }) === null);

const reach = reachable(grid, { q: 0, r: 0 }, 2);
check('reachable excludes the start', !reach.has(key(0, 0)));
check('reachable includes an adjacent tile', reach.has(key(1, 0)));
check('reachable respects the cost budget', [...reach.values()].every(c => c <= 2));

// --- tech tree ---
check('pottery needs no prereqs', canResearch('pottery', new Set()));
check('writing is gated by pottery', !canResearch('writing', new Set()));
check('writing opens after pottery', canResearch('writing', new Set(['pottery'])));
check('cannot re-research a known tech', !canResearch('pottery', new Set(['pottery'])));
check('availableTechs is cheapest-first', (() => {
  const a = availableTechs(new Set(['pottery']));
  return a.length && a.every((id, i) => i === 0 || TECHS[a[i - 1]].cost <= TECHS[id].cost);
})());
check('availableTechs hides locked & known', (() => {
  const a = availableTechs(new Set(['pottery', 'writing']));
  return !a.includes('pottery') && !a.includes('writing') && a.includes('currency') && a.includes('bronze');
})());
check('pathTo a base tech is just itself', JSON.stringify(pathTo('pottery', new Set())) === JSON.stringify(['pottery']));
check('pathTo includes prerequisites in order', JSON.stringify(pathTo('writing', new Set())) === JSON.stringify(['pottery', 'writing']));
check('pathTo skips already-researched prereqs', JSON.stringify(pathTo('writing', new Set(['pottery']))) === JSON.stringify(['writing']));
check('pathTo a known tech is empty', pathTo('pottery', new Set(['pottery'])).length === 0);
check('pathTo flight ends at flight and pulls the whole chain', (() => {
  const p = pathTo('flight', new Set());
  if (p[p.length - 1] !== 'flight') return false;
  if (!p.includes('pottery') || !p.includes('combustion')) return false;
  // every tech appears after all of its prerequisites
  const idx = Object.fromEntries(p.map((id, i) => [id, i]));
  return p.every(id => TECHS[id].requires.every(req => idx[req] === undefined || idx[req] < idx[id]));
})());

// --- buildings ---
check('no buildings without tech', unlockedBuildings(new Set()).length === 0);
check('pottery unlocks the granary', unlockedBuildings(new Set(['pottery'])).includes('granary'));
check('granary requires pottery', BUILDINGS.granary.requires === 'pottery');
check('applyBuildings multiplies the right yield', (() => {
  const out = applyBuildings({ food: 4, prod: 2, gold: 1, science: 1 }, ['granary']);
  return out.food === 5 && out.prod === 2; // +25% food only
})());
check('applyBuildings ignores unknown ids', applyBuildings({ food: 4 }, ['nope']).food === 4);

// --- territory ownership ---
{
  const tg = new Map();
  for (const { q, r } of hexMap(4)) tg.set(key(q, r), { q, r, passable: true, moveCost: 1, terrain: 'PLAINS', yields: { food: 1, prod: 1, gold: 0 } });
  const cityA = { q: -2, r: 0 }, cityB = { q: 2, r: 0 };
  const own = computeOwnership([cityA, cityB], tg, 2);
  check('ownership claims tiles around cities', own.size > 0);
  check('each owned tile has exactly one owner', [...own.values()].every(c => c === cityA || c === cityB));
  check('a tile is never owned by two cities', own.get(key(-2, 0)) === cityA && own.get(key(2, 0)) === cityB);
  const ownA = ownedTiles(cityA, own, tg);
  check('ownedTiles excludes the city center', !ownA.some(t => t.q === -2 && t.r === 0));
  check('ownedTiles all belong to that city', ownA.every(t => own.get(key(t.q, t.r)) === cityA));
}

// --- per-city yields ---
{
  const center = { yields: { food: 2, prod: 1, gold: 0 } };
  const owned = [
    { yields: { food: 3, prod: 0, gold: 0 } },
    { yields: { food: 0, prod: 3, gold: 0 } },
    { yields: { food: 0, prod: 0, gold: 1 } },
  ];
  const y1 = cityYields(center, owned, 1, []);
  // pop 1 works center + best owned tile (value 3); food = 2 + 3 = 5
  check('cityYields works population-many tiles', y1.food === 5);
  check('cityYields adds the city tax (gold+1)', y1.gold === 1);
  check('cityYields adds science from population', y1.science === 2); // 1 + pop
  const y2 = cityYields(center, owned, 2, ['granary']);
  // pop 2 works center + two best owned (food3, prod3): food=5 -> *1.25 = 6.25 -> 6
  check('granary boosts a city food yield', y2.food === 6);

  // A city on barren terrain still makes at least 1 food and 1 production.
  const barren = { yields: { food: 0, prod: 0, gold: 0 } };
  const yb = cityYields(barren, [], 0, []);
  check('a city always makes at least 1 production', yb.prod >= 1);
  check('a city always makes at least 1 food', yb.food >= 1);
}

// --- resources ---
check('wheat lives on grassland/plains', resourcesForTerrain('GRASSLAND').includes('wheat') && resourcesForTerrain('PLAINS').includes('wheat'));
check('ocean has no resources', resourcesForTerrain('OCEAN').length === 0);
check('applyResource adds the bonus', (() => {
  const out = applyResource({ food: 2, prod: 0, gold: 0 }, 'wheat');
  return out.food === 4; // +2 food
})());
check('applyResource does not mutate the input', (() => {
  const base = { food: 2 }; applyResource(base, 'wheat'); return base.food === 2;
})());
check('applyResource ignores unknown resource', applyResource({ food: 1 }, 'nope').food === 1);
check('every resource only lists real terrains', Object.values(RESOURCES).every(r => r.terrains.length > 0));
{
  // Deterministic placement: same seed -> same resources.
  const w1 = generateWorld(8, 7), w2 = generateWorld(8, 7), w3 = generateWorld(8, 8);
  const sig = (w) => [...w.tiles.values()].map(t => t.resource || '-').join('');
  check('resource placement is deterministic per seed', sig(w1) === sig(w2));
  check('different seeds differ in resources', sig(w1) !== sig(w3));
  const placed = [...w1.tiles.values()].filter(t => t.resource);
  check('some resources get placed', placed.length > 0);
  check('placed resources match their terrain', placed.every(t => RESOURCES[t.resource].terrains.includes(t.terrain)));
  check('a resourced tile out-yields its base terrain', placed.every(t => {
    const base = TERRAIN[t.terrain].yields;
    return (t.yields.food + t.yields.prod + t.yields.gold) >= (base.food + base.prod + base.gold);
  }));
}

// --- combat ---
check('open ground gives no defense bonus', defenseMultiplier('GRASSLAND') === 1.0);
check('hills give a defense bonus', defenseMultiplier('HILLS') > 1.0);
check('terrain reduces damage taken', resolveAttack(6, 0, 'HILLS').dmgToDefender < resolveAttack(6, 0, 'GRASSLAND').dmgToDefender);
check('an attack always does at least 1 damage', resolveAttack(1, 0, 'MOUNTAIN').dmgToDefender >= 1);
check('melee provokes a counterattack', resolveAttack(6, 6, 'GRASSLAND', false).dmgToAttacker > 0);
check('ranged takes no counterattack', resolveAttack(6, 6, 'GRASSLAND', true).dmgToAttacker === 0);
check('an unarmed defender never counters', resolveAttack(6, 0, 'GRASSLAND', false).dmgToAttacker === 0);
check('extra defense (walls/city) reduces damage', resolveAttack(12, 0, 'GRASSLAND', true, 1.75).dmgToDefender < resolveAttack(12, 0, 'GRASSLAND', true, 1).dmgToDefender);
check('extra defense stacks with terrain', resolveAttack(20, 0, 'HILLS', true, 1.75).dmgToDefender < resolveAttack(20, 0, 'HILLS', true, 1).dmgToDefender);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
