// civilizations.js — pickable civs for the start menu. Each has a colour and a
// unique trait whose `effect` is folded straight into Game.civMods (same shape
// as a government bonus / policy effect), so traits "just work" everywhere
// civMods is applied (yields, combat, unit costs).
export const CIVILIZATIONS = [
  { id: 'azure',   name: 'Azure',   color: 0x3a78d0, unique: 'Longship',  trait: { name: 'Seafarers',   desc: '-30% settler cost',  effect: { settlerDiscount: 0.7 } } },
  { id: 'crimson', name: 'Crimson', color: 0xd04545, unique: 'Berserker', trait: { name: 'Warmongers',  desc: '+3 combat strength', effect: { combat: 3 } } },
  { id: 'verdant', name: 'Verdant', color: 0x39a86b, unique: 'Ranger',    trait: { name: 'Cultivators', desc: '+15% food',          effect: { foodMul: 1.15 } } },
  { id: 'amber',   name: 'Amber',   color: 0xd49a2e, unique: 'Mercenary', trait: { name: 'Merchants',    desc: '+25% gold',          effect: { goldMul: 1.25 } } },
  { id: 'violet',  name: 'Violet',  color: 0x9b59b6, unique: 'Arbalest',  trait: { name: 'Scholars',     desc: '+25% science',       effect: { sciMul: 1.25 } } },
  { id: 'onyx',    name: 'Onyx',    color: 0x6f8296, unique: 'Bombard',   trait: { name: 'Industrious',  desc: '+15% production',    effect: { prodMul: 1.15 } } },
];

export const CIV_BY_ID = Object.fromEntries(CIVILIZATIONS.map(c => [c.id, c]));
