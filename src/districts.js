// districts.js — Civ-style districts. A district is placed on one of a city's
// owned tiles and groups a category of buildings (e.g. Market & Bank both live
// in the Commercial Hub). A building can only be built once its district exists
// in that city; the district also gives a small flat yield. Pure logic.

export const DISTRICT_COST = 54; // production to build a district

export const DISTRICTS = {
  campus:     { name: 'Campus',          glyph: '🔬', color: 0x4aa8e0, requires: 'writing',   yield: { science: 1 }, buildings: ['library', 'university'] },
  commercial: { name: 'Commercial Hub',  glyph: '🪙', color: 0xe0b23a, requires: 'currency',  yield: { gold: 1 },    buildings: ['market', 'bank'] },
  industrial: { name: 'Industrial Zone', glyph: '⚒',  color: 0xc8753a, requires: 'bronze',    yield: { prod: 1 },    buildings: ['workshop', 'factory'] },
  theater:    { name: 'Theater Square',  glyph: '🎭', color: 0xb060c8, civic: 'code_of_laws',  yield: { culture: 1 }, buildings: ['monument', 'amphitheater'] },
};

// The district a building belongs to, or null if it's a city-centre building
// (no district required).
export function buildingDistrict(buildingId) {
  for (const id in DISTRICTS) if (DISTRICTS[id].buildings.includes(buildingId)) return id;
  return null;
}

// District ids the civ can build, gated by tech or civic.
export function unlockedDistricts(researchedTech, researchedCivics = new Set()) {
  return Object.keys(DISTRICTS).filter(id => {
    const d = DISTRICTS[id];
    if (d.requires) return researchedTech.has(d.requires);
    if (d.civic) return researchedCivics.has(d.civic);
    return false;
  });
}
