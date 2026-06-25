// Test harness: construct a real Game in Node with stubbed rendering.
// Three.js builds meshes fine without a GL context (only the renderer needs
// WebGL), so the actual game rules in game.js can be exercised headlessly.
import { generateWorld } from '../src/worldgen.js';
import { Game } from '../src/game.js';
import { key, distance } from '../src/hex.js';

// A scene/view that swallow every render call but answer the few data queries
// Game makes (view.world, view.topOf).
function stubScene() { return new Proxy({}, { get: () => () => {} }); }
function stubView(world) {
  return new Proxy(
    { world, topOf: (q, r) => ({ x: q, y: 0, z: r }) },
    { get: (t, p) => (p in t ? t[p] : () => {}) },
  );
}

// Build a fresh game. Defaults: radius 12, 3 civs (player + 2 AI).
export function makeGame({ radius = 12, seed = 42, civs = 3, configs = null, opts = {} } = {}) {
  const world = generateWorld(radius, seed);
  const cfg = configs || [
    { id: 'crimson', name: 'You' }, { id: 'azure', name: 'Azuria' }, { id: 'verdant', name: 'Verda' },
  ].slice(0, civs);
  const game = new Game(stubScene(), stubView(world), civs, cfg, opts);
  return { game, world };
}

// Find a passable, unoccupied tile whose hex-distance from (q,r) is in [min,max].
export function landNear(game, q, r, min = 0, max = 99, exclude = () => false) {
  for (const [k, t] of game.tiles) {
    if (!t.passable) continue;
    const [tq, tr] = k.split(',').map(Number);
    const d = distance({ q, r }, { q: tq, r: tr });
    if (d < min || d > max) continue;
    if (game.unitAt(tq, tr) || game.cityAt(tq, tr) || exclude(tq, tr)) continue;
    return { q: tq, r: tr };
  }
  return null;
}

// Found a city for `owner` on a passable tile whose distance from (q,r) is in
// [min,max], and return it. Default ring (0..99) just grabs the first land tile.
export function foundCity(game, owner, q, r, min = 0, max = 99) {
  const spot = landNear(game, q, r, min, max);
  if (!spot) throw new Error('no land tile to found on');
  const s = game.spawnUnit('settler', owner, spot.q, spot.r);
  const res = game.foundCity(s);
  if (!res.ok) throw new Error('foundCity failed: ' + res.msg);
  return res.city;
}

// Found a city for `owner` exactly at (q,r) (the tile must be passable & free).
export function foundAt(game, owner, q, r) {
  const s = game.spawnUnit('settler', owner, q, r);
  const res = game.foundCity(s);
  if (!res.ok) throw new Error('foundAt failed: ' + res.msg);
  return res.city;
}

// Spawn a trader for `owner` near `home` city, pointed at it, and return it.
export function spawnTrader(game, owner, home) {
  const spot = landNear(game, home.q, home.r, 1, 3);
  const t = game.spawnUnit('trader', owner, spot.q, spot.r);
  t.home = { q: home.q, r: home.r };
  return t;
}

// Tiny test runner shared by the game tests.
export function runner() {
  let passed = 0, failed = 0;
  const check = (name, cond) => { if (cond) passed++; else { failed++; console.error('  FAIL:', name); } };
  const done = () => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); };
  return { check, done };
}

export { key, distance };
