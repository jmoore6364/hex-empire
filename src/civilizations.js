// civilizations.js — pickable civs for the start menu. Each has a colour and a
// unique trait whose `effect` is folded straight into Game.civMods (same shape
// as a government bonus / policy effect), so traits "just work" everywhere
// civMods is applied (yields, combat, unit costs).
export const CIVILIZATIONS = [
  { id: 'azure',   name: 'Azure',   color: 0x3a78d0, ruler: 'Jarl Sigrún',        unique: 'Longship',  trait: { name: 'Seafarers',   desc: '-30% settler cost',  effect: { settlerDiscount: 0.7 } } },
  { id: 'crimson', name: 'Crimson', color: 0xd04545, ruler: 'Khan Tarok',         unique: 'Berserker', trait: { name: 'Warmongers',  desc: '+3 combat strength', effect: { combat: 3 } } },
  { id: 'verdant', name: 'Verdant', color: 0x39a86b, ruler: 'Matriarch Elowen',   unique: 'Ranger',    trait: { name: 'Cultivators', desc: '+15% food',          effect: { foodMul: 1.15 } } },
  { id: 'amber',   name: 'Amber',   color: 0xd49a2e, ruler: 'Doge Aurelio',       unique: 'Mercenary', trait: { name: 'Merchants',    desc: '+25% gold',          effect: { goldMul: 1.25 } } },
  { id: 'violet',  name: 'Violet',  color: 0x9b59b6, ruler: 'Archon Theron',      unique: 'Arbalest',  trait: { name: 'Scholars',     desc: '+25% science',       effect: { sciMul: 1.25 } } },
  { id: 'onyx',    name: 'Onyx',    color: 0x6f8296, ruler: 'Overseer Goran',     unique: 'Bombard',   trait: { name: 'Industrious',  desc: '+15% production',    effect: { prodMul: 1.15 } } },
  { id: 'jade',    name: 'Jade',    color: 0x27b0a0, ruler: 'Master Bohai',       unique: 'Pikeman',   trait: { name: 'Builders',     desc: '+12% production',    effect: { prodMul: 1.12 } } },
  { id: 'rose',    name: 'Rose',    color: 0xd45a8a, ruler: 'Countess Vela',      unique: 'Hussar',    trait: { name: 'Traders',      desc: '+20% gold',          effect: { goldMul: 1.2 } } },
  { id: 'indigo',  name: 'Indigo',  color: 0x5560d8, ruler: 'Grandmaster Aldric', unique: 'Templar',   trait: { name: 'Crusaders',    desc: '+2 combat strength', effect: { combat: 2 } } },
  { id: 'ember',   name: 'Ember',   color: 0xe07028, ruler: 'Forgelord Brann',    unique: 'Phalanx',   trait: { name: 'Smiths',       desc: '-20% military cost', effect: { militaryDiscount: 0.8 } } },
  { id: 'bronze',  name: 'Bronze',  color: 0x9c6b3a, ruler: 'Warden Cato',        unique: 'Ballista',  trait: { name: 'Stonemasons',  desc: '+13% production',    effect: { prodMul: 1.13 } } },
  { id: 'lime',    name: 'Lime',    color: 0x9bc23a, ruler: 'Elder Saffi',        unique: 'Slinger',   trait: { name: 'Farmers',      desc: '+20% food',          effect: { foodMul: 1.2 } } },
];

export const CIV_BY_ID = Object.fromEntries(CIVILIZATIONS.map(c => [c.id, c]));
