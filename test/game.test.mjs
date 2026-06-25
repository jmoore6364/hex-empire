// Game-rule tests: exercise the real Game (combat, trade routes, persistent
// caravans, plunder, economy, fog, save/load, AI) headlessly via a stubbed
// renderer. Complements logic.test.mjs (pure modules) and the in-browser
// headless smoke test (rendering).
import { makeGame, foundAt, spawnTrader, runner, key, distance } from './harness.mjs';
import { findStartTile, connectedLand } from '../src/worldgen.js';

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

done();
