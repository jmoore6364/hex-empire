// Self-test for the pure-logic modules (no browser / Three needed).
// Run with:  npm test
import { neighbors, distance, hexToWorld, worldToHex, hexMap, key, hexesInRange } from '../src/hex.js';
import { generateWorld, findStartTile, TERRAIN } from '../src/worldgen.js';
import { findPath, reachable } from '../src/pathfinding.js';
import { TECHS, canResearch, availableTechs } from '../src/tech.js';
import { BUILDINGS, unlockedBuildings, applyBuildings } from '../src/buildings.js';
import { computeOwnership, ownedTiles } from '../src/territory.js';
import { cityYields } from '../src/economy.js';

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
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
