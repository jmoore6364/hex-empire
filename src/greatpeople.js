// greatpeople.js — Great People: every civ accrues Great-Person points and, at
// rising thresholds, a Great Person is born granting a one-time bonus (scaled by
// the civ's age). Pure logic, NO rendering deps.

export const GREAT_PEOPLE = [
  { id: 'scientist', name: 'Great Scientist', glyph: '🔬', desc: 'A burst of research',      effect: { science: 120 } },
  { id: 'merchant',  name: 'Great Merchant',  glyph: '🪙', desc: 'A windfall of gold',       effect: { gold: 160 } },
  { id: 'engineer',  name: 'Great Engineer',  glyph: '⚒',  desc: 'Accelerates construction', effect: { production: 70 } },
  { id: 'artist',    name: 'Great Artist',    glyph: '🎭', desc: 'A cultural masterpiece',   effect: { culture: 110 } },
  { id: 'general',   name: 'Great General',   glyph: '⚔',  desc: '+2 combat for 12 turns',   effect: { combat: 2, combatTurns: 12 } },
];

// Points needed for a civ's next Great Person (it rises each time).
export function gppCost(earned) { return 120 + earned * 80; }
