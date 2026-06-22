// territory.js — city tile ownership. Each city claims the hexes within
// `radius`; a contested hex goes to the nearest city (ties broken toward the
// city that appears first, for determinism). Pure logic, NO rendering deps.

import { key, distance, hexesInRange } from './hex.js';

// Returns Map<"q,r", city> assigning every claimable tile to exactly one city,
// so two cities never work the same hex. `tiles` is the world tile Map; only
// keys present in it are claimed.
// `radius` may be a number (same for every city) or a function (city) => number,
// so a city's claim can grow as it accumulates culture.
export function computeOwnership(cities, tiles, radius = 2) {
  const owner = new Map();
  const bestDist = new Map();
  for (const c of cities) {
    const rad = typeof radius === 'function' ? radius(c) : radius;
    for (const h of hexesInRange(c.q, c.r, rad)) {
      const k = key(h.q, h.r);
      if (!tiles.has(k)) continue;
      const d = distance(c, h);
      const prev = bestDist.get(k);
      if (prev === undefined || d < prev) { // strict: first city wins ties
        bestDist.set(k, d);
        owner.set(k, c);
      }
    }
  }
  return owner;
}

// The tiles a given city owns, excluding its own center. Returns an array of
// tile objects (looked up in `tiles`).
export function ownedTiles(city, ownership, tiles) {
  const centerK = key(city.q, city.r);
  const out = [];
  for (const [k, c] of ownership) {
    if (c !== city || k === centerK) continue;
    const t = tiles.get(k);
    if (t) out.push(t);
  }
  return out;
}
