// Game-rule tests: exercise the real Game (combat, trade routes, persistent
// caravans, plunder, economy, fog, save/load, AI) headlessly via a stubbed
// renderer. Complements logic.test.mjs (pure modules) and the in-browser
// headless smoke test (rendering).
import { makeGame, foundAt, spawnTrader, landNear, runner, key, distance } from './harness.mjs';
import { findStartTile, connectedLand } from '../src/worldgen.js';
import { UNIT_TYPES } from '../src/units.js';
import { TECHS } from '../src/tech.js';
import { CIVICS, GOVERNMENTS, POLICIES } from '../src/civics.js';

const { check, done } = runner();

// Pick the player's capital tile and the farthest land tile on the same landmass
// (so a route between them is always path-connected by land).
function twoCities(game, world, owner = 0) {
  const start = findStartTile(world);
  const mass = [...connectedLand(world.tiles, start)].map(k => world.tiles.get(k));
  let far = start, best = -1;
  for (const t of mass) { const d = distance(start, t); if (d > best && !(t.q === start.q && t.r === start.r)) { best = d; far = t; } }
  const a = foundAt(game, owner, start.q, start.r);
  const b = foundAt(game, owner, far.q, far.r);
  return { a, b, dist: distance(a, b) };
}

// --- city founding ---------------------------------------------------------
{
  const { game, world } = makeGame();
  const s = findStartTile(world);
  const before = game.units.length;
  const c = foundAt(game, 0, s.q, s.r);
  check('foundCity creates a player city', game.cities.includes(c) && c.owner === 0);
  check('foundCity consumes the settler', game.units.length === before); // +1 settler, -1 founded
  check('a new city claims its centre + ring', c.tiles.size === 7);
  check('a new city starts at full HP', c.hp === game.cityMaxHp(c));
}

// --- distant trade routes + persistent caravans ----------------------------
{
  const { game, world } = makeGame();
  const { a, b, dist } = twoCities(game, world);
  check('test cities are genuinely distant (not adjacent)', dist > 1);
  const trader = spawnTrader(game, 0, a);
  const res = game.establishRoute(trader, b);
  check('a route to a distant city establishes', res.ok);
  check('the route is recorded', game.tradeRoutes.length === 1);
  check('the Trader is NOT consumed (becomes a caravan)', game.units.includes(trader) && !!trader.route);
  check('the caravan starts its outbound leg', trader.legTo === 'to');
  check('the origin city now earns trade gold', a.tradeGold > 0);
  check('distance adds to the route gold', a.tradeGold >= 2 + Math.floor(dist / 4));

  // duplicate + self rejections
  const trader2 = spawnTrader(game, 0, a);
  check('a duplicate route is rejected', !game.establishRoute(trader2, b).ok);
  check('routing a city to itself is rejected', !game.establishRoute(trader2, a).ok);
}

// --- caravan shuttle + manual end ------------------------------------------
{
  const { game, world } = makeGame();
  const { a, b } = twoCities(game, world);
  const trader = spawnTrader(game, 0, a);
  game.establishRoute(trader, b);

  // Drop the caravan right next to its target: the next caravan tick flips it home.
  trader.q = b.q + 1; trader.r = b.r; trader.legTo = 'to';
  game._runCaravans();
  check('a caravan flips legs when it reaches an endpoint', trader.legTo === 'from');

  // It keeps moving and stays alive across several ticks.
  const startK = key(trader.q, trader.r);
  let moved = false;
  for (let i = 0; i < 4; i++) { game._runCaravans(); if (key(trader.q, trader.r) !== startK) moved = true; }
  check('a caravan keeps travelling its route', moved);
  check('a caravan persists across turns', game.units.includes(trader) && !!trader.route);

  // Manually ending the route frees the Trader and stops the yield.
  game.endRoute(trader);
  check('ending a route removes it', game.tradeRoutes.length === 0);
  check('ending a route keeps the Trader alive', game.units.includes(trader) && !trader.route);
  check('ending a route stops the trade gold', a.tradeGold === 0);
}

// --- routes break on war ----------------------------------------------------
{
  const { game, world } = makeGame();
  const start = findStartTile(world);
  const mass = [...connectedLand(world.tiles, start)].map(k => world.tiles.get(k));
  let far = start, best = -1;
  for (const t of mass) { const d = distance(start, t); if (d > best) { best = d; far = t; } }
  const mine = foundAt(game, 0, start.q, start.r);
  const theirs = foundAt(game, 1, far.q, far.r); // a foreign city, at peace by default
  const trader = spawnTrader(game, 0, mine);
  check('an unexplored foreign city cannot be a human trade target', !game.tradeTargets(trader).includes(theirs));
  game.explored.add(key(theirs.q, theirs.r)); // the player scouts it
  const res = game.establishRoute(trader, theirs);
  check('a foreign route (at peace, explored) establishes', res.ok);
  check('a foreign route brings science', mine.tradeScience > 0);
  game.declareWar(0, 1);
  game._recomputeTrade();
  check('war drops the trade route', game.tradeRoutes.length === 0 && mine.tradeGold === 0);
}

// --- caravan plunder --------------------------------------------------------
{
  const { game, world } = makeGame();
  const { a, b } = twoCities(game, world);
  const trader = spawnTrader(game, 0, a);
  game.establishRoute(trader, b);
  game.declareWar(0, 1);
  // a raider next to the caravan
  const raider = game.spawnUnit('swordsman', 1, trader.q + 1, trader.r);
  const goldBefore = game.civs[1].treasury.gold;
  const routesBefore = game.tradeRoutes.length;
  let msg = '';
  let safety = 0;
  while (game.units.includes(trader) && safety++ < 6) { raider.move = raider.def.move; msg = game.resolveCombat(raider, trader).msg; }
  check('raiding kills the caravan', !game.units.includes(trader));
  check('raiding loots gold for the attacker', game.civs[1].treasury.gold > goldBefore);
  check('plunder is reported in the combat message', /Plundered/.test(msg));
  check('the plundered route is gone', game.tradeRoutes.length === routesBefore - 1);
}

// barbarians can plunder without a treasury (no crash, nothing banked)
{
  const { game, world } = makeGame();
  const { a, b } = twoCities(game, world);
  const trader = spawnTrader(game, 0, a);
  game.establishRoute(trader, b);
  const barb = game.spawnUnit('swordsman', game.barbOwner, trader.q + 1, trader.r);
  let ok = true;
  try { let s = 0; while (game.units.includes(trader) && s++ < 6) { barb.move = barb.def.move; game.resolveCombat(barb, trader); } }
  catch (e) { ok = false; }
  check('a barbarian plunder does not crash', ok && !game.units.includes(trader));
  check('a barbarian plunder ends the route', game.tradeRoutes.length === 0);
}

// --- combat fundamentals ----------------------------------------------------
{
  const { game, world } = makeGame();
  const s = findStartTile(world);
  const atk = game.spawnUnit('swordsman', 0, s.q, s.r);
  const def = game.spawnUnit('warrior', 1, s.q + 1, s.r);
  game.declareWar(0, 1);
  const defHpBefore = def.hp;
  game.resolveCombat(atk, def);
  check('an attack damages the defender', def.hp < defHpBefore || !game.units.includes(def));
  check('melee provokes a counterattack', atk.hp < atk.def.hp || !game.units.includes(def));
  // finish it off
  let s2 = 0; while (game.units.includes(def) && s2++ < 8) { atk.move = atk.def.move; game.resolveCombat(atk, def); }
  check('a defeated unit is removed', !game.units.includes(def));
}

// --- economy: trade gold flows into income ---------------------------------
{
  const { game, world } = makeGame();
  const { a, b } = twoCities(game, world);
  const incBefore = game.computeIncome(0).gold;
  const trader = spawnTrader(game, 0, a);
  game.establishRoute(trader, b);
  const incAfter = game.computeIncome(0).gold;
  check('a trade route raises the civ gold income', incAfter > incBefore);
}

// --- AI sets up its own routes (and the explored-gate fix) ------------------
{
  const { game, world } = makeGame();
  const start = findStartTile(world);
  const mass = [...connectedLand(world.tiles, start)].map(k => world.tiles.get(k));
  // two cities for AI civ 1, plus a peaceful AI civ 2 city the human hasn't seen
  let p1 = mass[0], p2 = mass[0], best = -1;
  for (const t of mass) { const d = distance(start, t); if (d > best) { best = d; p2 = t; } }
  const home1 = foundAt(game, 1, p1.q, p1.r);
  const other = foundAt(game, 2, p2.q, p2.r); // foreign to civ1, at peace, unexplored by player
  const trader = game.spawnUnit('trader', 1, home1.q + 1, home1.r);
  trader.home = { q: home1.q, r: home1.r };
  check('an unexplored foreign city is a valid AI trade target', game.tradeTargets(trader).includes(other));
  game._runAICiv(1);
  check('the AI turns its Trader into a caravan', !!trader.route && game.units.includes(trader));
  check('the AI route is recorded', game.tradeRoutes.some(r => r.owner === 1));
}

// --- save / load round-trip with a live caravan ----------------------------
{
  const { game, world } = makeGame();
  const { a, b } = twoCities(game, world);
  const trader = spawnTrader(game, 0, a);
  game.establishRoute(trader, b);
  const cityCount = game.cities.length, unitCount = game.units.length, routeCount = game.tradeRoutes.length;
  const goldYield = a.tradeGold;

  const snap = JSON.parse(JSON.stringify(game.serialize()));
  // restore into a brand-new game built from the same seed
  const { game: g2 } = makeGame();
  g2.restore(snap);
  check('save/load preserves cities', g2.cities.length === cityCount);
  check('save/load preserves units', g2.units.length === unitCount);
  check('save/load preserves trade routes', g2.tradeRoutes.length === routeCount);
  const caravans = g2.units.filter(u => u.route);
  check('save/load keeps the caravan', caravans.length === 1);
  check('save/load re-links the caravan to a live route object', caravans.every(u => g2.tradeRoutes.includes(u.route)));
  check('save/load preserves the trade yield', g2.cities.find(c => c.q === a.q && c.r === a.r).tradeGold === goldYield);
}

// --- a full turn cycle runs cleanly ----------------------------------------
{
  const { game, world } = makeGame();
  const { a, b } = twoCities(game, world);
  const trader = spawnTrader(game, 0, a);
  game.establishRoute(trader, b);
  const turnBefore = game.turn;
  let threw = false;
  try { for (let i = 0; i < 3; i++) game.endTurn(); } catch (e) { threw = true; console.error('   endTurn threw:', e.message); }
  check('endTurn runs without throwing (AI, barbarians, caravans, economy)', !threw);
  check('endTurn advances the turn counter', game.turn === turnBefore + 3);
  check('the caravan survives normal turns', game.units.includes(trader));
}

// --- tech tree gates units, buildings, wonders -----------------------------
{
  // every unit's `requires` (if any) is a real tech in the expanded tree
  check('every unit gate points at a real tech',
    Object.values(UNIT_TYPES).every(u => !u.requires || TECHS[u.requires]));

  // Every unit type must build its mesh without throwing (catches a bad _build
  // branch for the units that now have their own meshes).
  check('every unit type builds a mesh', (() => {
    const { game, world } = makeGame();
    const s = findStartTile(world);
    return Object.keys(UNIT_TYPES).every(type => {
      try { const u = game.spawnUnit(type, 0, s.q, s.r); return !!u.mesh; } catch (e) { console.error('   build failed for', type, e.message); return false; }
    });
  })());
  check('the new units each have a distinct build (not a reused one)',
    ['spearman', 'knight', 'cannon', 'rifleman', 'infantry', 'modern_armor', 'bomber', 'jet', 'destroyer', 'battleship']
      .every(b => Object.values(UNIT_TYPES).some(u => u.build === b)));
  check('the expanded tree adds deeper military units',
    ['spearman', 'knight', 'cannon', 'rifleman', 'infantry', 'modern_armor', 'bomber', 'jet_fighter', 'destroyer', 'battleship'].every(id => UNIT_TYPES[id]));

  const { game, world } = makeGame();
  const c = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  const civ = game.civs[0];

  const earlyUnits = game.buildOptions(0, c).filter(o => o.kind === 'unit').length;
  const earlyBuildings = game.buildOptions(0, c).filter(o => o.kind === 'building').length;

  // research the entire tree
  for (const id of Object.keys(TECHS)) civ.research.researched.add(id);
  const lateOpts = game.buildOptions(0, c);
  const lateUnits = lateOpts.filter(o => o.kind === 'unit').length;

  check('researching the tree unlocks many more units', lateUnits > earlyUnits + 6);
  check('a late-era unit (Modern Armor) becomes buildable', lateOpts.some(o => o.kind === 'unit' && o.id === 'modern_armor'));
  check('a late wonder (the Internet) becomes available', lateOpts.some(o => o.kind === 'wonder' && o.id === 'internet'));

  // centre buildings (no district) unlock straight from tech
  check('a Laboratory (centre building) unlocks from its tech',
    game.buildOptions(0, c).some(o => o.kind === 'building' && o.id === 'laboratory'));
  check('the science multiplier stacks deep into the tree', game.cityYields(c).science >= 1);
}

// --- ages advance cleanly across the expanded era list ---------------------
{
  const { game, world } = makeGame();
  foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  const civ = game.civs[0];
  for (const id of Object.keys(TECHS)) civ.research.researched.add(id);
  let threw = false;
  try { game._advanceAge(0); } catch (e) { threw = true; console.error('   _advanceAge threw:', e.message); }
  check('advancing to the final era does not throw', !threw);
  check('the player reaches the Information era', game.age === Math.max(...Object.values(TECHS).map(t => t.era)));
  check('the age name resolves for the top era', typeof game.ageName() === 'string' && game.ageName().length > 0);
}

// --- governments & policy slots ---------------------------------------------
{
  const { game, world } = makeGame();
  foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  const civ = game.civs[0];

  // unlock the whole civics tree so every government/policy is available
  for (const id of Object.keys(CIVICS)) civ.civics.researched.add(id);

  // Adopt a government with limited slots, then try to slot more cards than fit.
  game.setGovernment(0, 'chiefdom'); // mil 1, eco 1, wild 0
  game.setPolicies(0, ['discipline', 'maneuver', 'urban_planning', 'public_works', 'inspiration']);
  const slots = GOVERNMENTS.chiefdom.slots;
  check('setPolicies respects the military slot count', civ.policies.filter(p => POLICIES[p].slot === 'mil').length <= slots.mil);
  check('setPolicies respects the economic slot count', civ.policies.filter(p => POLICIES[p].slot === 'eco').length <= slots.eco);
  check('a wildcard policy cannot slot when there are no wild slots', !civ.policies.includes('inspiration'));

  // A government with wildcard slots lets a wildcard card (or overflow) fit.
  game.setGovernment(0, 'theocracy'); // mil 1, eco 1, wild 2
  game.setPolicies(0, ['discipline', 'urban_planning', 'inspiration', 'scientific_academy']);
  check('wildcard slots accept wildcard policies', civ.policies.includes('inspiration') && civ.policies.includes('scientific_academy'));

  // Switching to a tighter government re-trims overflow policies.
  game.setGovernment(0, 'chiefdom');
  check('switching government re-fits policies to the new slots',
    civ.policies.length <= slots.mil + slots.eco + slots.wild);

  // Government bonus + an active policy both fold into civMods.
  game.setGovernment(0, 'democracy'); // +15% science
  const mods = game.civMods(0);
  check('a government bonus reaches civMods', mods.sciMul > 1);
  game.setPolicies(0, ['discipline']);
  check('an active military policy adds combat in civMods', game.civMods(0).combat >= 2);

  // The AI also adopts a government and fills policy slots without throwing.
  const { game: g2, world: w2 } = makeGame();
  foundAt(g2, 1, findStartTile(w2).q, findStartTile(w2).r);
  for (const id of Object.keys(CIVICS)) g2.civs[1].civics.researched.add(id);
  let threw = false;
  try { g2._runAICiv(1); } catch (e) { threw = true; console.error('   AI civics threw:', e.message); }
  check('the AI adopts a government & policies cleanly', !threw && !!GOVERNMENTS[g2.civs[1].government]);
  check('the AI never over-fills its policy slots', (() => {
    const s = GOVERNMENTS[g2.civs[1].government].slots;
    return g2.civs[1].policies.length <= s.mil + s.eco + s.wild;
  })());
}

// --- Space Race victory (reachable late game) ------------------------------
{
  const { game, world } = makeGame();
  const s0 = findStartTile(world);
  foundAt(game, 0, s0.q, s0.r);
  game.spawnUnit('warrior', 1, s0.q + 3, s0.r); // keep a rival alive so domination doesn't fire
  const c = game.cities.find(cc => cc.owner === 0);

  // Flight no longer ends the game (it used to be the science victory).
  game.civs[0].research.researched.add('flight');
  game._checkGameOver();
  check('reaching Flight no longer ends the game', game.gameOver === null);

  // The spaceship project unlocks only with Rocketry.
  check('no spaceship project before Rocketry', !game.buildOptions(0, c).some(o => o.kind === 'project'));
  for (const id of Object.keys(TECHS)) game.civs[0].research.researched.add(id); // includes rocketry
  check('spaceship project unlocks once Rocketry is researched', game.buildOptions(0, c).some(o => o.kind === 'project' && o.id === 'spaceship'));

  // Building it wins the Space Race for the player.
  game.enqueue(c, game.buildOptions(0, c).find(o => o.kind === 'project'));
  c.production = 100000; // enough to finish at once
  game._processProduction(c);
  check('finishing the spaceship sets the launch flag', game.spaceLaunched === 0);
  game._checkGameOver();
  check('launching the spaceship wins the game', !!(game.gameOver && game.gameOver.win));
  check('the spaceship is one-per-game (no longer offered after launch)', !game.buildOptions(0, c).some(o => o.kind === 'project'));
}

// The AI races for space and can win it (a loss for the player).
{
  const { game, world } = makeGame();
  foundAt(game, 1, findStartTile(world).q, findStartTile(world).r);
  for (const id of Object.keys(TECHS)) game.civs[1].research.researched.add(id);
  game._runAICiv(1);
  const aiCity = game.cities.find(cc => cc.owner === 1);
  check('the AI queues the spaceship once it has Rocketry', aiCity.queue.some(i => i.kind === 'project'));
  aiCity.production = 100000;
  game._processProduction(aiCity);
  game._checkGameOver();
  check('an AI space launch ends the game as a player loss', !!(game.gameOver && !game.gameOver.win && game.spaceLaunched === 1));
}

// Save/load preserves a launch.
{
  const { game, world } = makeGame();
  foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  game.spaceLaunched = 0;
  const snap = JSON.parse(JSON.stringify(game.serialize()));
  const { game: g2 } = makeGame();
  g2.restore(snap);
  check('save/load preserves the space launch', g2.spaceLaunched === 0);
}

// --- diplomatic trade deals (resources & gold) -------------------------------
// Force a resource onto one of a city's owned tiles.
function giveResource(game, city, res) {
  const k = [...city.tiles].find(tk => { const t = game.tiles.get(tk); return t && !t.resource; });
  game.tiles.get(k).resource = res;
  return k;
}
// Found a city for `owner` a few hexes from the player's start (so both nations
// exist — proposeDeal requires the partner to be alive).
function foundRival(game, world, owner = 1) {
  const s = findStartTile(world);
  const spot = landNear(game, s.q, s.r, 4, 12);
  return foundAt(game, owner, spot.q, spot.r);
}

// Resource ownership feeds an empire-wide bonus.
{
  const { game, world } = makeGame();
  const s = findStartTile(world);
  const cap = foundAt(game, 0, s.q, s.r);
  // Clear any worldgen resources already inside the capital's borders so the
  // test measures only what we add.
  for (const tk of cap.tiles) { const t = game.tiles.get(tk); if (t) t.resource = null; }
  const ironN = game.civResources(0).iron || 0;
  giveResource(game, cap, 'iron'); // iron trade bonus = +2 gold, +2 science
  check('civResources counts owned resource tiles', (game.civResources(0).iron || 0) === ironN + 1);
  check('resourceAccess includes an owned type', game.resourceAccess(0).has('iron'));
  const ri = game.resourceIncome(0);
  check('resourceIncome reflects the resource trade bonus', ri.gold === 2 && ri.science === 2);
  giveResource(game, cap, 'iron'); // a second iron — duplicate type, no extra bonus
  check('a duplicate resource type adds no extra bonus', game.resourceIncome(0).gold === 2);
}

// A one-time lump swap settles immediately and leaves no standing deal.
{
  const { game, world } = makeGame();
  foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  game.civs[0].treasury.gold = 100; game.civs[1].treasury.science = 40;
  const res = game.proposeDeal(0, 1, { gold: 60 }, { science: 30 }, 0);
  check('a one-time lump swap succeeds', res.ok);
  check('lump gold leaves the proposer', game.civs[0].treasury.gold === 40);
  check('lump gold reaches the partner', game.civs[1].treasury.gold === 60);
  check('lump science crosses back', game.civs[0].treasury.science === 30 && game.civs[1].treasury.science === 10);
  check('an instant swap stores no standing deal', game.deals.length === 0);
}

// A resource lease runs for its term, transfers access, pays per turn, reverts.
{
  const { game, world } = makeGame();
  const cap = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  giveResource(game, cap, 'gold'); // gold trade bonus = +5 gold
  game.civs[1].treasury.gold = 100;
  const res = game.proposeDeal(0, 1, { res: ['gold'] }, { goldPerTurn: 8 }, 3);
  check('a resource-for-gold/turn lease is accepted', res.ok && game.deals.length === 1);
  check('the partner gains access to the leased resource', game.resourceAccess(1).has('gold'));
  check('leasing your only copy costs you its access', !game.resourceAccess(0).has('gold'));
  check('the partner now earns the resource bonus', game.resourceIncome(1).gold === 5);
  const before0 = game.civs[0].treasury.gold, before1 = game.civs[1].treasury.gold;
  game._processDeals();
  check('the lessee pays gold per turn', game.civs[0].treasury.gold === before0 + 8 && game.civs[1].treasury.gold === before1 - 8);
  game._processDeals(); game._processDeals(); // term was 3
  check('the deal expires after its term', game.deals.length === 0);
  check('resource access reverts to the owner on expiry', game.resourceAccess(0).has('gold') && !game.resourceAccess(1).has('gold'));
}

// The AI weighs a proposal: it takes a profitable one, refuses a lopsided one.
{
  const { game, world } = makeGame();
  const cap = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  giveResource(game, cap, 'gold');
  game.civs[1].treasury.gold = 500;
  const good = { id: 0, a: 0, b: 1, term: 20, turnsLeft: 20, give: game._basket({ res: ['gold'] }), take: game._basket({ goldPerTurn: 2 }) };
  check('the AI accepts a deal that profits it', game.aiWouldAccept(good));
  const bad = { id: 0, a: 0, b: 1, term: 20, turnsLeft: 20, give: game._basket({ goldPerTurn: 1 }), take: game._basket({ gold: 400 }) };
  check('the AI refuses a deal that bleeds it', !game.aiWouldAccept(bad));
}

// War tears up any standing deal between the two nations.
{
  const { game, world } = makeGame();
  const cap = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  giveResource(game, cap, 'iron');
  game.civs[1].treasury.gold = 100;
  game.proposeDeal(0, 1, { res: ['iron'] }, { goldPerTurn: 5 }, 10);
  check('a deal is standing before war', game.deals.length === 1);
  game.declareWar(0, 1);
  check('declaring war cancels the deal', game.deals.length === 0);
}

// A party that cannot pay its per-turn obligation defaults and the deal dies.
{
  const { game, world } = makeGame();
  const cap = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  giveResource(game, cap, 'iron');
  game.civs[1].treasury.gold = 4; // can't cover a 5/turn obligation
  game.proposeDeal(0, 1, { res: ['iron'] }, { goldPerTurn: 5 }, 10);
  game._processDeals();
  check('an unaffordable per-turn deal defaults away', game.deals.length === 0);
}

// Save / load round-trips standing deals.
{
  const { game, world } = makeGame();
  const cap = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  giveResource(game, cap, 'iron');
  game.civs[1].treasury.gold = 100;
  game.proposeDeal(0, 1, { res: ['iron'] }, { goldPerTurn: 5 }, 7);
  const snap = JSON.parse(JSON.stringify(game.serialize()));
  const { game: g2, world: w2 } = makeGame();
  // restore needs the same cities present; rebuild from the snapshot's data
  g2.restore(snap);
  check('save/load preserves the standing deal', g2.deals.length === 1 && g2.deals[0].give.res[0] === 'iron');
  check('restored deal keeps its term countdown', g2.deals[0].turnsLeft === 7);
}

// Renting out a DUPLICATE resource costs the owner no access, so it is free to
// trade — this is what lets both sides of an AI deal profit.
{
  const { game, world } = makeGame();
  const cap = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  giveResource(game, cap, 'iron'); giveResource(game, cap, 'iron'); // two copies
  const deal = { a: 1, b: 0, term: 10, turnsLeft: 10, give: game._basket({ goldPerTurn: 3 }), take: game._basket({ res: ['iron'] }) };
  const v = game.dealValue(deal, 0); // player leases out one of two irons
  check('leasing a duplicate resource costs no access value', v.perTurn === 3); // +3 gold, no resource cost
  giveResource(game, cap, 'gold'); // single copy of gold
  const deal2 = { a: 1, b: 0, term: 10, turnsLeft: 10, give: game._basket({ goldPerTurn: 3 }), take: game._basket({ res: ['gold'] }) };
  const v2 = game.dealValue(deal2, 0); // leasing the only gold copy costs its bonus (5)
  check('leasing your last copy costs its bonus', v2.perTurn === 3 - 5);
}

// AI civs trade with each other automatically when it profits both.
{
  const { game, world } = makeGame();
  const a = foundAt(game, 1, findStartTile(world).q, findStartTile(world).r);
  const b = foundRival(game, world, 2);
  // Civ 2 controls two irons (a spare to rent); civ 1 has none.
  giveResource(game, b, 'iron'); giveResource(game, b, 'iron');
  game.civs[1].treasury.gold = 200; game.civs[2].treasury.gold = 200;
  game.turn = 3; // _aiTryTrade fires when (turn + owner) % 4 === 0 (owner 1)
  game._aiTryTrade(1); // owner 1 buys iron access from owner 2
  check('AI buys a resource type it lacks from a peer', game.deals.length === 1);
  check('the buying AI now has access to the resource', game.resourceAccess(1).has('iron'));
  check('the selling AI keeps access via its duplicate', game.resourceAccess(2).has('iron'));
}

// An AI floats a standing offer to the player; accepting settles it.
{
  const { game, world } = makeGame();
  const cap = foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  const rival = foundRival(game, world, 1);
  giveResource(game, rival, 'iron'); giveResource(game, rival, 'iron'); // AI can spare iron, player lacks it
  game.civs[1].treasury.gold = 200; game.civs[0].treasury.gold = 200;
  game.turn = 5; // _aiOfferToPlayer fires when (turn + owner) % 6 === 0 (owner 1)
  game._aiOfferToPlayer(1);
  check('the AI queues a trade offer to the player', game.dealOffers.length === 1);
  check('the offer is flagged from the proposing civ', game.dealOffers[0].from === 1);
  const id = game.dealOffers[0].id;
  const res = game.acceptOffer(id);
  check('accepting the offer settles a deal', res.ok && game.deals.length === 1);
  check('an accepted offer leaves the queue', game.dealOffers.length === 0);
  check('the player gains access to the offered resource', game.resourceAccess(0).has('iron'));
}

// Offers age out, and war clears them.
{
  const { game, world } = makeGame();
  foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  game.dealOffers.push({ id: 1, a: 1, b: 0, term: 10, turnsLeft: 2, from: 1, give: game._basket({ res: ['iron'] }), take: game._basket({ goldPerTurn: 2 }) });
  game._expireOffers();
  check('an offer ticks down but survives one turn', game.dealOffers.length === 1 && game.dealOffers[0].turnsLeft === 1);
  game.dealOffers[0].turnsLeft = 1; game._expireOffers();
  check('an ignored offer expires', game.dealOffers.length === 0);
  game.dealOffers.push({ id: 2, a: 1, b: 0, term: 10, turnsLeft: 5, from: 1, give: game._basket({ res: ['iron'] }), take: game._basket({ goldPerTurn: 2 }) });
  game.declareWar(0, 1);
  check('war clears any pending offer', game.dealOffers.length === 0);
}

// Offers survive save / load.
{
  const { game, world } = makeGame();
  foundAt(game, 0, findStartTile(world).q, findStartTile(world).r);
  foundRival(game, world, 1);
  game.dealOffers.push({ id: 7, a: 1, b: 0, term: 10, turnsLeft: 5, from: 1, give: game._basket({ res: ['iron'] }), take: game._basket({ goldPerTurn: 2 }) });
  const snap = JSON.parse(JSON.stringify(game.serialize()));
  const { game: g2 } = makeGame();
  g2.restore(snap);
  check('save/load preserves a pending offer', g2.dealOffers.length === 1 && g2.dealOffers[0].from === 1);
}

done();
