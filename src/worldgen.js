// worldgen.js — procedural terrain generation. Pure logic, NO rendering deps.
// Produces a Map of tile data keyed by "q,r" that the renderer turns into meshes.

import { hexMap, key, neighbors } from './hex.js';
import { RESOURCES, resourcesForTerrain, applyResource } from './resources.js';

// Terrain catalogue. `color` is consumed by the renderer; the gameplay fields
// (passable, moveCost, yields) are used by movement and the economy.
export const TERRAIN = {
  OCEAN:     { name: 'Ocean',     color: 0x1b4f72, elevation: 0.00, passable: false, moveCost: 99, yields: { food: 1, prod: 0, gold: 1 } },
  COAST:     { name: 'Coast',     color: 0x2e86c1, elevation: 0.06, passable: false, moveCost: 99, yields: { food: 1, prod: 0, gold: 2 } },
  LAKE:      { name: 'Lake',      color: 0x49b6e0, elevation: 0.09, passable: false, moveCost: 99, yields: { food: 2, prod: 0, gold: 1 } },
  BEACH:     { name: 'Beach',     color: 0xd9c77a, elevation: 0.10, passable: true,  moveCost: 1,  yields: { food: 1, prod: 0, gold: 0 } },
  GRASSLAND: { name: 'Grassland', color: 0x4f9d3a, elevation: 0.16, passable: true,  moveCost: 1,  yields: { food: 2, prod: 0, gold: 0 } },
  PLAINS:    { name: 'Plains',    color: 0x9bb53a, elevation: 0.18, passable: true,  moveCost: 1,  yields: { food: 1, prod: 1, gold: 0 } },
  FOREST:    { name: 'Forest',    color: 0x2f6d2f, elevation: 0.24, passable: true,  moveCost: 2,  yields: { food: 1, prod: 2, gold: 0 } },
  DESERT:    { name: 'Desert',    color: 0xe0c878, elevation: 0.16, passable: true,  moveCost: 1,  yields: { food: 0, prod: 0, gold: 1 } },
  TUNDRA:    { name: 'Tundra',    color: 0x9fb0a0, elevation: 0.18, passable: true,  moveCost: 1,  yields: { food: 1, prod: 1, gold: 0 } },
  SNOW:      { name: 'Snow',      color: 0xeaf2f8, elevation: 0.22, passable: true,  moveCost: 1,  yields: { food: 0, prod: 0, gold: 0 } },
  HILLS:     { name: 'Hills',     color: 0x6b8e23, elevation: 0.42, passable: true,  moveCost: 2,  yields: { food: 1, prod: 2, gold: 0 } },
  MOUNTAIN:  { name: 'Mountain',  color: 0x7d7d7d, elevation: 0.70, passable: false, moveCost: 99, yields: { food: 0, prod: 1, gold: 0 } },
};

// Water tiles (ocean, coast, lakes) — used by naval movement and embarking.
export const isWater = (t) => !!t && (t.terrain === 'OCEAN' || t.terrain === 'COAST' || t.terrain === 'LAKE');

// --- Deterministic seeded noise ----------------------------------------------

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Classic Perlin-style gradient noise built from a seeded permutation table.
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y) => ((h & 1) ? x : -x) + ((h & 2) ? y : -y);

  return function noise2D(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return (lerp(x1, x2, v) + 1) / 2; // normalize to 0..1
  };
}

// Fractal Brownian motion: stack octaves of noise for natural-looking detail.
function fbm(noise, x, y, octaves = 4) {
  let value = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}

// --- World assembly ----------------------------------------------------------

function pickTerrain(elevation, moisture, latitude) {
  if (elevation < 0.42) return 'OCEAN';
  if (elevation < 0.47) return 'COAST';
  if (elevation < 0.50) return 'BEACH';
  if (elevation > 0.76) return 'MOUNTAIN';
  if (elevation > 0.62) return 'HILLS';

  // Cold poles.
  if (latitude > 0.78) return 'SNOW';
  if (latitude > 0.62) return moisture > 0.5 ? 'TUNDRA' : 'SNOW';

  // Temperate band, varied by moisture.
  if (moisture < 0.30) return 'DESERT';
  if (moisture < 0.45) return 'PLAINS';
  if (moisture > 0.60) return 'FOREST';
  return 'GRASSLAND';
}

// Build the world. Returns { tiles: Map<"q,r", tile>, radius, seed }.
// The shape is an archipelago: a solid main continent in the middle, scattered
// islands around it, and enclosed inland water turned into lakes.
export function generateWorld(radius = 12, seed = 1337) {
  const elevNoise = makeNoise(seed);
  const moistNoise = makeNoise(seed ^ 0x9e3779b9);
  const detailNoise = makeNoise(seed ^ 0x85ebca6b);
  const tiles = new Map();
  const scale = 0.16;

  for (const { q, r } of hexMap(radius)) {
    const nx = q + r / 2, ny = r;
    // Broad landmasses, broken up by a finer detail octave into islands.
    let elevation = fbm(elevNoise, nx * 0.10 + 10, ny * 0.10 + 10, 5);
    const detail = fbm(detailNoise, nx * 0.26 + 80, ny * 0.26 + 80, 3);
    elevation = elevation * 0.6 + detail * 0.4;

    // Central bias: raise the middle into a main continent, sink the rim into
    // ocean. Islands survive in the mid-ring where the detail noise pokes up.
    const dist = Math.hypot(nx, ny) / radius;           // 0 center .. ~1 edge
    elevation += (0.30 - dist) * 0.26;
    elevation -= Math.pow(Math.max(0, dist - 0.46), 2) * 1.4;
    // Mountain ranges: where a ridge noise peaks over already-high land, push it
    // up into hills and snow-capped mountains.
    const ridge = fbm(detailNoise, nx * 0.13 + 200, ny * 0.13 + 200, 2);
    if (elevation > 0.48) elevation += Math.max(0, ridge - 0.52) * 1.7;
    elevation = Math.max(0, Math.min(1, elevation));

    const moisture = fbm(moistNoise, nx * scale + 50, ny * scale + 50, 4);
    const latitude = Math.min(1, Math.abs(r) / radius);

    const terrainKey = pickTerrain(elevation, moisture, latitude);
    const def = TERRAIN[terrainKey];
    tiles.set(key(q, r), {
      q, r,
      terrain: terrainKey,
      elevation,
      moisture,
      passable: def.passable,
      moveCost: def.moveCost,
      yields: def.yields,   // shared base; replaced for lakes / resources below
      resource: null,
    });
  }
  classifyLakes(tiles);
  placeBeaches(tiles);
  const rivers = placeRivers(tiles, seed);
  placeResources(tiles, seed);
  return { tiles, radius, seed, rivers };
}

// Trace rivers downhill from high land to the sea/a lake. Each river is a chain
// of land tiles; a river tile gains +1 food and +1 gold (fresh water & trade)
// and costs +1 to ford. Returns an array of chains ([{q,r},…]).
function placeRivers(tiles, seed) {
  const rand = mulberry32(seed ^ 0x27d4eb2f);
  const land = (t) => t && t.passable && t.terrain !== 'MOUNTAIN';
  const sources = [...tiles.values()].filter(t => land(t) && t.elevation > 0.55);
  // Deterministic shuffle, then take the highest few as springs.
  for (let i = sources.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [sources[i], sources[j]] = [sources[j], sources[i]]; }
  sources.sort((a, b) => b.elevation - a.elevation);

  const rivers = [];
  const used = new Set();
  const target = Math.min(8, 2 + Math.round(sources.length / 60));
  for (const src of sources) {
    if (rivers.length >= target) break;
    if (used.has(key(src.q, src.r))) continue;
    const chain = [];
    const seen = new Set();
    let cur = src, reachedWater = false;
    while (cur && land(cur) && !seen.has(key(cur.q, cur.r)) && chain.length < 40) {
      seen.add(key(cur.q, cur.r));
      chain.push(cur);
      let next = null, lowest = cur.elevation;
      for (const n of neighbors(cur.q, cur.r)) {
        const nt = tiles.get(key(n.q, n.r));
        if (!nt) continue;
        if (isWater(nt)) { reachedWater = true; next = null; break; }
        if (nt.elevation < lowest && !seen.has(key(n.q, n.r))) { lowest = nt.elevation; next = nt; }
      }
      if (reachedWater) break;
      cur = next;
    }
    if (chain.length < 3) continue;
    for (const t of chain) {
      if (t.river) continue;
      t.river = true;
      t.yields = { ...t.yields, food: t.yields.food + 1, gold: t.yields.gold + 1 };
      t.moveCost = t.moveCost + 1;
      used.add(key(t.q, t.r));
    }
    rivers.push(chain.map(t => ({ q: t.q, r: t.r })));
  }
  return rivers;
}

// Water connected to the map border is sea; any water it can't reach is an
// enclosed lake. Reclassifies enclosed OCEAN/COAST tiles to LAKE.
function classifyLakes(tiles) {
  const isWater = (t) => t && (t.terrain === 'OCEAN' || t.terrain === 'COAST');
  const sea = new Set();
  const stack = [];
  for (const t of tiles.values()) {
    if (!isWater(t)) continue;
    const onBorder = neighbors(t.q, t.r).some(n => !tiles.has(key(n.q, n.r)));
    if (onBorder) { const k = key(t.q, t.r); if (!sea.has(k)) { sea.add(k); stack.push(t); } }
  }
  while (stack.length) {
    const t = stack.pop();
    for (const n of neighbors(t.q, t.r)) {
      const k = key(n.q, n.r);
      const nt = tiles.get(k);
      if (isWater(nt) && !sea.has(k)) { sea.add(k); stack.push(nt); }
    }
  }
  for (const t of tiles.values()) {
    if (isWater(t) && !sea.has(key(t.q, t.r))) {
      t.terrain = 'LAKE';
      t.passable = false;
      t.moveCost = 99;
      t.yields = TERRAIN.LAKE.yields;
    }
  }
}

// Sandy shoreline: open land directly touching the sea becomes a beach, so every
// continent and island gets a clear sandy coast ring.
function placeBeaches(tiles) {
  const sandable = new Set(['GRASSLAND', 'PLAINS', 'DESERT', 'TUNDRA']);
  const shore = [];
  for (const t of tiles.values()) {
    if (!sandable.has(t.terrain)) continue;
    if (neighbors(t.q, t.r).some(n => { const nt = tiles.get(key(n.q, n.r)); return nt && (nt.terrain === 'OCEAN' || nt.terrain === 'COAST'); })) shore.push(t);
  }
  for (const t of shore) { t.terrain = 'BEACH'; t.passable = true; t.moveCost = 1; t.yields = TERRAIN.BEACH.yields; }
}

// The set of passable land tile-keys reachable from `start` without crossing
// water — i.e. one connected landmass.
export function connectedLand(tiles, start) {
  const seen = new Set();
  const startK = key(start.q, start.r);
  const startTile = tiles.get(startK);
  if (!startTile || !startTile.passable) return seen;
  seen.add(startK);
  const stack = [start];
  while (stack.length) {
    const t = stack.pop();
    for (const n of neighbors(t.q, t.r)) {
      const k = key(n.q, n.r);
      const nt = tiles.get(k);
      if (nt && nt.passable && !seen.has(k)) { seen.add(k); stack.push(nt); }
    }
  }
  return seen;
}

// Scatter special resources across eligible terrain, deterministically by seed.
// A resourced tile gets its own yields object (base + bonus) so we never mutate
// the shared per-terrain yields.
function placeResources(tiles, seed) {
  const rand = mulberry32(seed ^ 0x5bf03635);
  for (const tile of tiles.values()) {
    const opts = resourcesForTerrain(tile.terrain);
    if (!opts.length) continue;
    if (rand() < 0.11) {
      const id = opts[Math.floor(rand() * opts.length)];
      tile.resource = id;
      tile.yields = applyResource(tile.yields, id);
    }
  }
}

// Find a reasonable starting hex for a civ: a passable land tile near the
// continent's center, preferring grassland/plains and adjacency to coast.
export function findStartTile(world) {
  let best = null, bestScore = -Infinity;
  for (const tile of world.tiles.values()) {
    if (!tile.passable || tile.terrain === 'MOUNTAIN') continue;
    const central = 1 - Math.hypot(tile.q + tile.r / 2, tile.r) / world.radius;
    const land = (tile.terrain === 'GRASSLAND' || tile.terrain === 'PLAINS') ? 0.5 : 0;
    const score = central + land + (tile.yields.food + tile.yields.prod) * 0.1;
    if (score > bestScore) { bestScore = score; best = tile; }
  }
  return best;
}
