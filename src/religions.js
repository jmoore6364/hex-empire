// religions.js — a light religion layer. A civ may found one religion and pick a
// belief (an empire-wide bonus, civMods-shaped). The faith then spreads city to
// city; foreign converts pay the founder a small tithe. Pure logic.

export const BELIEFS = [
  { id: 'tithe',      name: 'Tithe',       desc: '+15% gold',       effect: { goldMul: 1.15 } },
  { id: 'scriptoria', name: 'Scriptoria',  desc: '+15% science',    effect: { sciMul: 1.15 } },
  { id: 'feast',      name: 'Feast Days',  desc: '+15% food',       effect: { foodMul: 1.15 } },
  { id: 'workethic',  name: 'Work Ethic',  desc: '+15% production', effect: { prodMul: 1.15 } },
  { id: 'crusade',    name: 'Crusade',     desc: '+2 combat',       effect: { combat: 2 } },
];

export const RELIGION_NAMES = [
  'Solarism', 'The Old Faith', 'Aetherism', 'The Covenant', 'Verdance',
  'Stormcall', 'The Eternal Flame', 'Lunar Path', 'The Deep Current', 'Ironcreed',
];
