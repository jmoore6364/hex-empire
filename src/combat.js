// combat.js — combat math: terrain defense bonuses and attack resolution,
// including ranged attacks that take no counterattack. Pure logic, NO rendering
// deps, so it can be unit-tested in plain Node.

// Defensive multipliers by terrain. A defender on rough ground takes less
// damage (incoming damage is divided by this). 1.0 = open ground.
export const TERRAIN_DEFENSE = {
  HILLS: 1.5,
  FOREST: 1.4,
  MOUNTAIN: 2.0,
  JUNGLE: 1.4,
  CITY: 1.5, // a garrisoned city tile (applied by the caller when relevant)
};

export function defenseMultiplier(terrain) {
  return TERRAIN_DEFENSE[terrain] ?? 1.0;
}

// Resolve a single attack. Pure — returns the damage each side takes; the caller
// applies it and decides survival.
//   attackerAtk     : attacker's attack stat
//   defenderAtk     : defender's attack stat (0 for non-combatants)
//   defenderTerrain : terrain key the defender stands on
//   isRanged        : true if the attacker strikes from range (no counter)
// The counterattack is only meaningful if the defender survives the hit; the
// caller checks that before applying `dmgToAttacker`.
export function resolveAttack(attackerAtk, defenderAtk, defenderTerrain, isRanged = false) {
  const defMul = defenseMultiplier(defenderTerrain);
  const dmgToDefender = Math.max(1, Math.round(attackerAtk / defMul));
  const dmgToAttacker = (!isRanged && defenderAtk) ? Math.round(defenderAtk * 0.6) : 0;
  return { dmgToDefender, dmgToAttacker, defMul };
}
