// pathfinding.js — A* and movement-range search over the hex grid.
// Pure logic, NO rendering deps.

import { neighbors, key, parseKey, distance } from './hex.js';

function lowestF(openSet, f) {
  let bestK = null, best = Infinity;
  for (const k of openSet) {
    const v = f.get(k) ?? Infinity;
    if (v < best) { best = v; bestK = k; }
  }
  return bestK;
}

// A* from start to goal over passable tiles. Returns an array of {q,r} from the
// first step after `start` through `goal`, or null if unreachable.
// `blocked` is an optional Set of "q,r" keys treated as impassable (e.g. enemy units).
export function findPath(tiles, start, goal, blocked = new Set()) {
  const startK = key(start.q, start.r);
  const goalK = key(goal.q, goal.r);
  const goalTile = tiles.get(goalK);
  if (!goalTile || !goalTile.passable || blocked.has(goalK)) return null;

  const g = new Map([[startK, 0]]);
  const f = new Map([[startK, distance(start, goal)]]);
  const came = new Map();
  const open = new Set([startK]);

  while (open.size) {
    const curK = lowestF(open, f);
    if (curK === goalK) {
      const path = [];
      let c = curK;
      while (c !== startK) { path.unshift(parseKey(c)); c = came.get(c); }
      return path;
    }
    open.delete(curK);
    const cur = parseKey(curK);
    for (const n of neighbors(cur.q, cur.r)) {
      const nk = key(n.q, n.r);
      const tile = tiles.get(nk);
      if (!tile || !tile.passable || blocked.has(nk)) continue;
      const tentative = g.get(curK) + tile.moveCost;
      if (tentative < (g.get(nk) ?? Infinity)) {
        came.set(nk, curK);
        g.set(nk, tentative);
        f.set(nk, tentative + distance(n, goal));
        open.add(nk);
      }
    }
  }
  return null;
}

// Dijkstra-style flood fill: every tile reachable from `start` for at most
// `maxCost` movement. Returns a Map<"q,r", costToReach> excluding the start.
export function reachable(tiles, start, maxCost, blocked = new Set()) {
  const startK = key(start.q, start.r);
  const cost = new Map([[startK, 0]]);
  const frontier = new Set([startK]);
  const result = new Map();

  while (frontier.size) {
    let curK = null, best = Infinity;
    for (const k of frontier) { const c = cost.get(k); if (c < best) { best = c; curK = k; } }
    frontier.delete(curK);
    const cur = parseKey(curK);
    for (const n of neighbors(cur.q, cur.r)) {
      const nk = key(n.q, n.r);
      const tile = tiles.get(nk);
      if (!tile || !tile.passable || blocked.has(nk)) continue;
      // A unit may always take one step if it has any movement left, so the
      // step is affordable when the budget isn't already spent.
      if (cost.get(curK) >= maxCost) continue;
      const stepCost = cost.get(curK) + tile.moveCost;
      if (stepCost < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, stepCost);
        result.set(nk, stepCost);
        frontier.add(nk);
      }
    }
  }
  return result;
}
