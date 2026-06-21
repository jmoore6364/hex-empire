// worldgen.js — procedural terrain generation. Pure logic, NO rendering deps.
// Produces a Map of tile data keyed by "q,r" that the renderer turns into meshes.

import { hexMap, key } from './hex.js';

// Terrain catalogue. `color` is consumed by the renderer; the gameplay fields
// (passable, moveCost, yields) are used by movement and the economy.
export const TERRAIN = {
  OCEAN:     { name: 'Ocean',     color: 0x1b4f72, elevation: 0.00, passable: false, moveCost: 99, yields: { food: 1, prod: 0, gold: 1 } },
  COAST:     { name: 'Coast',     color: 0x2e86c1, elevation: 0.06, passable: false, moveCost: 99, yields: { food: 1, prod: 0, gold: 2 } },
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
  if (elevation < 0.34) return 'OCEAN';
  if (elevation < 0.40) return 'COAST';
  if (elevation < 0.44) return 'BEACH';
  if (elevation > 0.82) return 'MOUNTAIN';
  if (elevation > 0.68) return 'HILLS';

  // Cold poles.
  if (latitude > 0.78) return 'SNOW';
  if (latitude > 0.62) return moisture > 0.5 ? 'TUNDRA' : 'SNOW';

  // Temperate band, varied by moisture.
  if (moisture < 0.30) return 'DESERT';
  if (moisture < 0.45) return 'PLAINS';
  if (moisture > 0.68) return 'FOREST';
  return 'GRASSLAND';
}

// Build the world. Returns { tiles: Map<"q,r", tile>, radius, seed }.
export function generateWorld(radius = 12, seed = 1337) {
  const elevNoise = makeNoise(seed);
  const moistNoise = makeNoise(seed ^ 0x9e3779b9);
  const tiles = new Map();
  const scale = 0.16;

  for (const { q, r } of hexMap(radius)) {
    // Sample noise in axial space, biased downward near the map edge so the
    // continent is ringed by ocean instead of running off the border.
    const nx = q + r / 2, ny = r;
    let elevation = fbm(elevNoise, nx * scale + 10, ny * scale + 10, 5);
    const edge = Math.hypot(nx, ny) / (radius * 1.15);
    elevation -= Math.pow(Math.max(0, edge), 2.2) * 0.9;
    elevation = Math.max(0, Math.min(1, elevation + 0.12));

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
      yields: def.yields,
    });
  }
  return { tiles, radius, seed };
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
