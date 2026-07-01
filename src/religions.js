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

// A stable display colour per religion, aligned to RELIGION_NAMES; custom names
// fall back to a deterministic pick so every faith still gets a colour.
export const RELIGION_COLORS = [
  0xf2c14e, 0x9b6bd6, 0x4ea3f2, 0xd98c3a, 0x5fbf6a,
  0x6fc9d6, 0xe0603a, 0xc9ccd6, 0x39b0a0, 0xb07a3a,
];

export function religionColor(name) {
  const i = RELIGION_NAMES.indexOf(name);
  if (i >= 0) return RELIGION_COLORS[i % RELIGION_COLORS.length];
  let n = 0; for (let k = 0; k < (name || '').length; k++) n = (n * 31 + name.charCodeAt(k)) >>> 0;
  return RELIGION_COLORS[n % RELIGION_COLORS.length];
}
