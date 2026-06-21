// Self-test for the pure-logic modules (no browser / Three needed).
// Run with:  npm test
import { neighbors, distance, hexToWorld, worldToHex, hexMap, key, hexesInRange } from '../src/hex.js';
import { generateWorld, findStartTile, TERRAIN } from '../src/worldgen.js';
import { findPath, reachable } from '../src/pathfinding.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
