// Self-test for the pure-logic modules (no browser / Three needed).
// Run with:  npm test
import { neighbors, distance, hexToWorld, worldToHex, hexMap, key, hexesInRange } from '../src/hex.js';
import { generateWorld, findStartTile, connectedLand, isWater, TERRAIN } from '../src/worldgen.js';
import { findPath, reachable } from '../src/pathfinding.js';
import { TECHS, ERAS, canResearch, availableTechs, pathTo } from '../src/tech.js';
import { BUILDINGS, unlockedBuildings, applyBuildings } from '../src/buildings.js';
import { computeOwnership, ownedTiles, initialClaim, expandClaim } from '../src/territory.js';
import { DISTRICTS, buildingDistrict, unlockedDistricts } from '../src/districts.js';
import { WONDERS, unlockedWonders } from '../src/wonders.js';
import { GREAT_PEOPLE, gppCost } from '../src/greatpeople.js';
import { BELIEFS, RELIGION_NAMES } from '../src/religions.js';
import { cityYields } from '../src/economy.js';
import { CIVICS, GOVERNMENTS, POLICIES, ERAS as CIVIC_ERAS, canResearch as canCivic, availableCivics, pathTo as civicPath, availableGovernments, availablePolicies } from '../src/civics.js';
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

// --- archipelago: lakes & landmasses ---
check('LAKE terrain is impassable water', TERRAIN.LAKE && TERRAIN.LAKE.passable === false);
check('isWater recognises ocean/coast/lake', isWater({ terrain: 'OCEAN' }) && isWater({ terrain: 'COAST' }) && isWater({ terrain: 'LAKE' }));
check('isWater rejects land', !isWater({ terrain: 'GRASSLAND' }) && !isWater(null));
{
  const wl = generateWorld(16, 1337);
  const lakes = [...wl.tiles.values()].filter(t => t.terrain === 'LAKE');
  check('lakes are enclosed (never touch the map border)',
    lakes.every(t => neighbors(t.q, t.r).every(n => wl.tiles.has(key(n.q, n.r)))));
  const land = [...wl.tiles.values()].find(t => t.passable);
  const mass = connectedLand(wl.tiles, land);
  check('connectedLand includes its start', mass.has(key(land.q, land.r)));
  check('connectedLand returns only passable tiles', [...mass].every(k => wl.tiles.get(k).passable));
  check('connectedLand is a subset of all land', mass.size <= [...wl.tiles.values()].filter(t => t.passable).length);
}
{
  const wr = generateWorld(20, 42);
  const rt = [...wr.tiles.values()].filter(t => t.river);
  check('rivers are generated', wr.rivers.length > 0 && rt.length > 0);
  check('river tiles are land', rt.every(t => t.passable && t.terrain !== 'MOUNTAIN'));
  check('river tiles cost more to ford', rt.every(t => t.moveCost >= 2));
  check('river tiles gain gold', rt.every(t => t.yields.gold >= 1));
}

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
// ...but a custom enter() predicate (e.g. a ship/embark) can path onto it.
check('findPath honours a custom enter() predicate',
  Array.isArray(findPath(grid, { q: -3, r: 0 }, { q: 3, r: 0 }, new Set(), { enter: () => true, cost: () => 1 })));
grid.get(key(3, 0)).passable = true;
// reachable with a blocking enter() yields nothing; permissive enter() reaches.
check('reachable respects a restrictive enter()',
  reachable(grid, { q: 0, r: 0 }, 2, new Set(), { enter: () => false }).size === 0);

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

// --- districts ---
{
  check('Bank and Market share the Commercial Hub', buildingDistrict('bank') === 'commercial' && buildingDistrict('market') === 'commercial');
  check('Library and University share the Campus', buildingDistrict('library') === 'campus' && buildingDistrict('university') === 'campus');
  check('Walls is a city-centre building (no district)', buildingDistrict('walls') === null);
  check('districts unlock by tech', unlockedDistricts(new Set(['currency'])).includes('commercial'));
  check('locked districts stay hidden', !unlockedDistricts(new Set()).includes('campus'));
  check('every district lists at least one building', Object.values(DISTRICTS).every(d => d.buildings.length > 0));
}

// --- great people ---
{
  check('great-people cost rises each time', gppCost(0) < gppCost(1) && gppCost(1) < gppCost(2));
  check('every great person has an effect', GREAT_PEOPLE.every(g => g.effect && Object.keys(g.effect).length > 0));
  check('great-people roster has variety', GREAT_PEOPLE.length >= 5);
}

// --- religion ---
{
  check('every belief has a civMods-style effect', BELIEFS.every(b => b.effect && Object.keys(b.effect).length > 0));
  check('enough religion names for many civs', RELIGION_NAMES.length >= 8);
  check('belief ids are unique', new Set(BELIEFS.map(b => b.id)).size === BELIEFS.length);
}

// --- wonders ---
{
  check('wonders unlock by tech', unlockedWonders(new Set(['masonry'])).includes('pyramids'));
  check('locked wonders hidden', !unlockedWonders(new Set()).includes('great_library'));
  check('already-built wonders are excluded', !unlockedWonders(new Set(['masonry']), new Set(['pyramids'])).includes('pyramids'));
  check('every wonder has an effect & cost', Object.values(WONDERS).every(w => w.effect && w.cost > 0));
}

// --- territory ownership ---
{
  const tg = new Map();
  for (const { q, r } of hexMap(4)) tg.set(key(q, r), { q, r, passable: true, moveCost: 1, terrain: 'PLAINS', yields: { food: 1, prod: 1, gold: 0 } });
  const cityA = { q: -2, r: 0 }, cityB = { q: 2, r: 0 };
  cityA.tiles = initialClaim(cityA, tg);
  cityB.tiles = initialClaim(cityB, tg, computeOwnership([cityA]));
  check('initial claim is centre + six neighbours', cityA.tiles.size === 7);
  const own = computeOwnership([cityA, cityB]);
  check('ownership claims tiles around cities', own.size > 0);
  check('each owned tile has exactly one owner', [...own.values()].every(c => c === cityA || c === cityB));
  check('a tile is never owned by two cities', own.get(key(-2, 0)) === cityA && own.get(key(2, 0)) === cityB);
  const ownA = ownedTiles(cityA, tg);
  check('ownedTiles excludes the city center', !ownA.some(t => t.q === -2 && t.r === 0));
  check('ownedTiles all belong to that city', ownA.every(t => own.get(key(t.q, t.r)) === cityA));
  // expansion prefers the resource tile on the frontier
  tg.get(key(-2, 2)).resource = 'wheat';
  const grew = expandClaim(cityA, cityA.tiles, tg, own, (t) => (t.resource ? 10 : t.yields.food), 3);
  check('expandClaim returns a frontier tile', typeof grew === 'string' && !cityA.tiles.has(grew));
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

// --- civics, governments, policies ---
check('code_of_laws needs no prereqs', canCivic('code_of_laws', new Set()));
check('craftsmanship is gated by code_of_laws',
  !canCivic('craftsmanship', new Set()) && canCivic('craftsmanship', new Set(['code_of_laws'])));
check('availableCivics is cheapest-first & only researchable', (() => {
  const a = availableCivics(new Set(['code_of_laws']));
  return a.includes('craftsmanship') && a.includes('military_tradition') && !a.includes('code_of_laws');
})());
check('civic pathTo pulls prerequisites in order', (() => {
  const p = civicPath('feudalism', new Set());
  return p[p.length - 1] === 'feudalism' && p.includes('code_of_laws');
})());
check('Chiefdom is always available', availableGovernments(new Set()).includes('chiefdom'));
check('Autocracy needs Early Empire',
  !availableGovernments(new Set()).includes('autocracy') && availableGovernments(new Set(['early_empire'])).includes('autocracy'));
check('policies unlock with their civic', availablePolicies(new Set(['craftsmanship'])).includes('urban_planning'));
check('no policies without civics', availablePolicies(new Set()).length === 0);

// --- culture yield ---
check('a city produces culture', cityYields({ yields: { food: 1, prod: 1, gold: 0 } }, [], 0, []).culture >= 1);
check('a Monument adds flat culture', (() => {
  const c = { yields: { food: 1, prod: 1, gold: 0 } };
  return cityYields(c, [], 0, ['monument']).culture === cityYields(c, [], 0, []).culture + 2;
})());

// --- tech-tree integrity (guards the expanded catalogue) ---
{
  const ids = Object.keys(TECHS);
  check('the tech tree is sizeable', ids.length >= 40);
  check('every prerequisite is a real tech', ids.every(id => TECHS[id].requires.every(r => TECHS[r])));
  check('no tech requires itself', ids.every(id => !TECHS[id].requires.includes(id)));
  check('prerequisites never sit in a later era', ids.every(id => TECHS[id].requires.every(r => TECHS[r].era <= TECHS[id].era)));
  check('every tech has a name, cost and unlocks label', ids.every(id => TECHS[id].name && TECHS[id].cost > 0 && TECHS[id].unlocks));
  check('ERAS covers exactly the eras techs use', (() => {
    const maxEra = Math.max(...ids.map(id => TECHS[id].era));
    const used = new Set(ids.map(id => TECHS[id].era));
    return ERAS.length === maxEra + 1 && [...used].every(e => e >= 0 && e < ERAS.length);
  })());
  check('every era has at least one tech', ERAS.every((_, e) => ids.some(id => TECHS[id].era === e)));

  // the whole tree is reachable from the roots (no node islanded by a typo)
  const reachable = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of ids) if (!reachable.has(id) && TECHS[id].requires.every(r => reachable.has(r))) { reachable.add(id); grew = true; }
  }
  check('every tech is reachable from the roots (no cycles/orphans)', reachable.size === ids.length);

  // pathTo any tech is a valid topological order ending at that tech
  check('pathTo every tech is topologically valid', ids.every(id => {
    const p = pathTo(id, new Set());
    if (p[p.length - 1] !== id) return false;
    const idx = Object.fromEntries(p.map((t, i) => [t, i]));
    return p.every(t => TECHS[t].requires.every(r => idx[r] === undefined || idx[r] < idx[t]));
  }));
  // a deep Information-era tech pulls a long chain through every prior era
  check('a deep tech path spans the whole tree', (() => {
    const p = pathTo('computers', new Set());
    const eras = new Set(p.map(id => TECHS[id].era));
    return p.includes('computers') && eras.size >= 6;
  })());
}

// --- content gates point at real techs -------------------------------------
{
  const techReq = (cat) => Object.values(cat).map(x => x.requires).filter(r => typeof r === 'string');
  check('every tech-gated building requires a real tech', techReq(BUILDINGS).every(r => TECHS[r]));
  check('every wonder requires a real tech', techReq(WONDERS).every(r => TECHS[r]));
  check('every tech-gated district requires a real tech', techReq(DISTRICTS).every(r => TECHS[r]));
  check('the expanded building set has the new yield/defense buildings',
    ['stable', 'harbor', 'castle', 'observatory', 'stock_exchange', 'sewer', 'laboratory', 'power_plant', 'research_lab'].every(id => BUILDINGS[id]));
  check('new buildings unlock with their tech', unlockedBuildings(new Set(['scientific_method'])).includes('laboratory'));
  check('the expanded wonder set includes late-era wonders', WONDERS.internet && WONDERS.apollo_program && WONDERS.oracle);
}

// --- civics tree, governments & policies (guards the expanded set) ---
{
  const ids = Object.keys(CIVICS);
  check('the civics tree is sizeable', ids.length >= 20);
  check('every civic prerequisite is a real civic', ids.every(id => CIVICS[id].requires.every(r => CIVICS[r])));
  check('no civic requires itself', ids.every(id => !CIVICS[id].requires.includes(id)));
  check('civic prerequisites never sit in a later era', ids.every(id => CIVICS[id].requires.every(r => CIVICS[r].era <= CIVICS[id].era)));
  check('every civic has a name, cost and unlocks label', ids.every(id => CIVICS[id].name && CIVICS[id].cost > 0 && CIVICS[id].unlocks));
  check('civic ERAS covers exactly the eras civics use', (() => {
    const maxEra = Math.max(...ids.map(id => CIVICS[id].era));
    return CIVIC_ERAS.length === maxEra + 1;
  })());
  check('every civic era has at least one civic', CIVIC_ERAS.every((_, e) => ids.some(id => CIVICS[id].era === e)));
  // whole tree reachable from the roots
  const reach = new Set(); let grew = true;
  while (grew) { grew = false; for (const id of ids) if (!reach.has(id) && CIVICS[id].requires.every(r => reach.has(r))) { reach.add(id); grew = true; } }
  check('every civic is reachable from the roots (no cycles/orphans)', reach.size === ids.length);
  check('civicPath every civic is topologically valid', ids.every(id => {
    const p = civicPath(id, new Set());
    if (p[p.length - 1] !== id) return false;
    const idx = Object.fromEntries(p.map((t, i) => [t, i]));
    return p.every(t => CIVICS[t].requires.every(r => idx[r] === undefined || idx[r] < idx[t]));
  }));

  // governments
  const govs = Object.keys(GOVERNMENTS);
  check('there are many governments to choose from', govs.length >= 8);
  check('exactly one government is available from the start', govs.filter(id => !GOVERNMENTS[id].civic).length === 1);
  check('every other government is gated by a real civic', govs.every(id => !GOVERNMENTS[id].civic || CIVICS[GOVERNMENTS[id].civic]));
  check('every government defines all three slot categories', govs.every(id => {
    const s = GOVERNMENTS[id].slots; return ['mil', 'eco', 'wild'].every(k => Number.isInteger(s[k]) && s[k] >= 0);
  }));
  check('some governments provide wildcard slots', govs.some(id => GOVERNMENTS[id].slots.wild > 0));

  // policies
  const pols = Object.keys(POLICIES);
  check('there are many policy cards', pols.length >= 18);
  check('every policy is unlocked by a real civic', pols.every(id => CIVICS[POLICIES[id].civic]));
  check('every policy slot is mil/eco/wild', pols.every(id => ['mil', 'eco', 'wild'].includes(POLICIES[id].slot)));
  check('every policy has an effect with a known modifier key', pols.every(id => {
    const e = POLICIES[id].effect; const keys = Object.keys(e || {});
    return keys.length && keys.every(k => k === 'combat' || k.endsWith('Mul') || k.endsWith('Discount'));
  }));
  check('policies span all three slot types', ['mil', 'eco', 'wild'].every(s => pols.some(id => POLICIES[id].slot === s)));

  // wiring sanity against the catalogue
  check('researching every civic unlocks every policy', availablePolicies(new Set(ids)).length === pols.length);
  check('researching every civic unlocks every gated government', availableGovernments(new Set(ids)).length === govs.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
