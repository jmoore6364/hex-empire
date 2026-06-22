// territory.js — city tile ownership. Each city owns an explicit, growing *set*
// of hexes: it starts with the six tiles around it and then claims one new
// frontier tile at a time (steered toward resources & rich land). Pure logic,
// NO rendering deps.

import { key, parseKey, distance, neighbors } from './hex.js';

// A city's starting claim: its centre plus each passable adjacent map tile that
// isn't already owned by another city ("one tile in each direction").
export function initialClaim(city, worldTiles, ownership = new Map()) {
  const claim = new Set([key(city.q, city.r)]);
  for (const n of neighbors(city.q, city.r)) {
    const k = key(n.q, n.r);
    if (worldTiles.has(k) && !ownership.has(k)) claim.add(k);
  }
  return claim;
}

// Claim one new tile: the highest-value unclaimed map tile on the frontier of
// the city's current territory (within `maxRadius` of the centre). `value(tile)`
// ranks candidates — higher wins, with a small pull toward closer tiles. Returns
// the chosen tile-key, or null if the city is hemmed in.
export function expandClaim(city, ownedSet, worldTiles, ownership, value, maxRadius = 3) {
  let best = null, bestScore = -Infinity;
  const seen = new Set();
  for (const k of ownedSet) {
    const { q, r } = parseKey(k);
    for (const n of neighbors(q, r)) {
      const nk = key(n.q, n.r);
      if (seen.has(nk) || ownedSet.has(nk) || ownership.has(nk)) continue;
      seen.add(nk);
      const t = worldTiles.get(nk);
      if (!t || distance(city, n) > maxRadius) continue;
      const score = value(t) - distance(city, n) * 0.15;
      if (score > bestScore) { bestScore = score; best = nk; }
    }
  }
  return best;
}

// Build the global ownership map (tile-key -> city) from each city's tile set.
export function computeOwnership(cities) {
  const owner = new Map();
  for (const c of cities) {
    if (!c.tiles) continue;
    for (const k of c.tiles) if (!owner.has(k)) owner.set(k, c);
  }
  return owner;
}

// The owned (non-centre) tile objects for a city.
export function ownedTiles(city, worldTiles) {
  const centerK = key(city.q, city.r);
  const out = [];
  for (const k of (city.tiles || [])) {
    if (k === centerK) continue;
    const t = worldTiles.get(k);
    if (t) out.push(t);
  }
  return out;
}
