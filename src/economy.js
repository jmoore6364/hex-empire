// economy.js — per-city yield calculation. A city works its center plus the
// best `population` tiles it owns, then buildings multiply the result. Pure
// logic, NO rendering deps.

import { applyBuildings } from './buildings.js';

const tileValue = (t) => t.yields.food + t.yields.prod + t.yields.gold;

// Compute a single city's per-turn yields.
//   center      : the city-center tile object
//   owned       : array of owned tile objects (excluding the center)
//   population  : how many surrounding tiles the city can work
//   buildings   : iterable of constructed building ids
// Returns rounded { food, prod, gold, science }.
export function cityYields(center, owned, population, buildings = []) {
  const ranked = owned.slice().sort((a, b) => tileValue(b) - tileValue(a));
  const worked = [center, ...ranked.slice(0, population)];

  const y = { food: 0, prod: 0, gold: 0, science: 0 };
  for (const t of worked) {
    y.food += t.yields.food;
    y.prod += t.yields.prod;
    y.gold += t.yields.gold;
  }
  y.gold += 1;                     // city tax
  y.science += 1 + population;     // research from population

  const m = applyBuildings(y, buildings);
  return {
    food: Math.round(m.food),
    prod: Math.round(m.prod),
    gold: Math.round(m.gold),
    science: Math.round(m.science),
  };
}
