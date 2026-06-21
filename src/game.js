// game.js — the rules layer: turns, fog of war, founding cities, movement
// budgets, combat, and a simple AI opponent. Holds no Three.js scene logic
// beyond adding/removing the meshes that units and cities carry.
import { key, distance, hexesInRange, neighbors } from './hex.js';
import { TERRAIN } from './worldgen.js';
import { findPath, reachable } from './pathfinding.js';
import { Unit, City } from './units.js';

const CITY_NAMES = ['Aurelia', 'Highkeep', 'Rivermouth', 'Stonewatch', 'Greenhollow', 'Saltspire', 'Ironford', 'Dawnvale'];

export class Game {
  constructor(scene, worldView) {
    this.scene = scene;
    this.view = worldView;
    this.world = worldView.world;
    this.tiles = this.world.tiles;
    this.units = [];
    this.cities = [];
    this.turn = 1;
    this.cityNameIdx = 0;
    this.explored = new Set();
    this.visible = new Set();
    this.income = { food: 0, prod: 0, gold: 0, science: 0 };
    this.treasury = { gold: 0, science: 0 };
  }

  // --- spawning -------------------------------------------------------------
  spawnUnit(type, owner, q, r) {
    const u = new Unit(type, owner, q, r);
    u.placeAt(q, r, this.view);
    this.scene.add(u.mesh);
    this.units.push(u);
    return u;
  }

  unitAt(q, r) { return this.units.find(u => u.q === q && u.r === r); }
  cityAt(q, r) { return this.cities.find(c => c.q === q && c.r === r); }

  // Tiles occupied by units other than `self` (blocks movement / pathing).
  occupied(self) {
    const s = new Set();
    for (const u of this.units) if (u !== self) s.add(key(u.q, u.r));
    for (const c of this.cities) if (!self || c.owner !== self.owner) s.add(key(c.q, c.r));
    return s;
  }

  // --- fog of war -----------------------------------------------------------
  recomputeFog() {
    this.visible = new Set();
    const reveal = (q, r, range) => {
      for (const h of hexesInRange(q, r, range)) {
        const k = key(h.q, h.r);
        if (this.tiles.has(k)) { this.visible.add(k); this.explored.add(k); }
      }
    };
    for (const u of this.units) if (u.owner === 0) reveal(u.q, u.r, u.sight);
    for (const c of this.cities) if (c.owner === 0) reveal(c.q, c.r, 3);
    this.view.applyFog(this.visible, this.explored);
    this._updateMeshVisibility();
  }

  // Enemy units/cities are only shown when inside the player's current sight.
  _updateMeshVisibility() {
    for (const u of this.units) {
      if (u.owner === 0) { u.mesh.visible = true; continue; }
      u.mesh.visible = this.visible.has(key(u.q, u.r));
    }
    for (const c of this.cities) {
      if (c.owner === 0) { c.mesh.visible = true; continue; }
      c.mesh.visible = this.explored.has(key(c.q, c.r));
    }
  }

  // --- player actions -------------------------------------------------------
  reachableFor(unit) {
    return reachable(this.tiles, unit, unit.move, this.occupied(unit));
  }

  pathFor(unit, q, r) {
    return findPath(this.tiles, unit, { q, r }, this.occupied(unit));
  }

  // Move (or attack). Returns { ok, taken?, msg? }.
  tryMoveUnit(unit, q, r) {
    if (unit.move <= 0) return { ok: false, msg: 'No movement left' };

    const enemy = this.unitAt(q, r);
    if (enemy && enemy.owner !== unit.owner) {
      if (distance(unit, { q, r }) === 1 && unit.def.attack) {
        return this.resolveCombat(unit, enemy);
      }
      return { ok: false, msg: 'Cannot reach that enemy' };
    }
    if (enemy && enemy.owner === unit.owner) return { ok: false, msg: 'Tile occupied' };
    if (this.cityAt(q, r) && this.cityAt(q, r).owner !== unit.owner) return { ok: false, msg: 'Enemy city' };

    const path = this.pathFor(unit, q, r);
    if (!path || !path.length) return { ok: false, msg: 'No path' };

    // Spend movement along the path; a unit may always take at least one step.
    let remaining = unit.move;
    const taken = [];
    for (const step of path) {
      if (remaining <= 0) break;
      taken.push(step);
      remaining -= this.tiles.get(key(step.q, step.r)).moveCost;
    }
    unit.move = Math.max(0, remaining);
    unit.enqueuePath(taken, this.view);
    this.recomputeFog();
    return { ok: true, taken };
  }

  foundCity(unit) {
    if (!unit.def.canFound) return { ok: false, msg: 'This unit cannot found a city' };
    if (this.cityAt(unit.q, unit.r)) return { ok: false, msg: 'Already a city here' };
    const name = unit.owner === 0
      ? CITY_NAMES[this.cityNameIdx++ % CITY_NAMES.length]
      : 'Crimson ' + CITY_NAMES[this.cityNameIdx++ % CITY_NAMES.length];
    const city = new City(unit.owner, unit.q, unit.r, name);
    city.placeAt(this.view);
    this.scene.add(city.mesh);
    this.cities.push(city);
    this._removeUnit(unit);
    this.recomputeFog();
    return { ok: true, city };
  }

  resolveCombat(attacker, defender) {
    defender.hp -= attacker.def.attack || 0;
    let msg = `${attacker.def.name} strikes ${defender.def.name}`;
    if (defender.hp > 0 && defender.def.attack) {
      attacker.hp -= Math.round(defender.def.attack * 0.6); // counterattack
    }
    attacker.move = 0;
    if (defender.hp <= 0) { this._removeUnit(defender); msg = `${defender.def.name} destroyed!`; }
    if (attacker.hp <= 0) { this._removeUnit(attacker); msg = `${attacker.def.name} lost in battle!`; }
    this.recomputeFog();
    return { ok: true, combat: true, msg };
  }

  _removeUnit(unit) {
    this.scene.remove(unit.mesh);
    this.units = this.units.filter(u => u !== unit);
  }

  // --- economy --------------------------------------------------------------
  computeIncome() {
    const inc = { food: 0, prod: 0, gold: 0, science: 0 };
    for (const c of this.cities) {
      if (c.owner !== 0) continue;
      // Work the city center plus up to `population` of the best surrounding tiles.
      const ring = neighbors(c.q, c.r)
        .map(n => this.tiles.get(key(n.q, n.r)))
        .filter(Boolean)
        .sort((a, b) => (b.yields.food + b.yields.prod + b.yields.gold) - (a.yields.food + a.yields.prod + a.yields.gold));
      const worked = [this.tiles.get(key(c.q, c.r)), ...ring.slice(0, c.population)];
      for (const t of worked) {
        inc.food += t.yields.food; inc.prod += t.yields.prod; inc.gold += t.yields.gold;
      }
      inc.gold += 1;                       // city tax
      inc.science += 1 + c.population;     // research from population
    }
    return inc;
  }

  // --- turns ----------------------------------------------------------------
  endTurn() {
    this._runAI();

    // Player economy: grow cities, bank gold & science.
    this.income = this.computeIncome();
    for (const c of this.cities) {
      if (c.owner !== 0) continue;
      c.food += this.income.food / Math.max(1, this.cities.filter(x => x.owner === 0).length);
      if (c.food >= c.population * 10) { c.food = 0; c.population++; }
    }
    this.treasury.gold += this.income.gold;
    this.treasury.science += this.income.science;

    this.turn++;
    for (const u of this.units) if (u.owner === 0) u.move = u.def.move;
    this.recomputeFog();
    return this.income;
  }

  // A deliberately simple opponent: found a city early, then scout/hunt.
  _runAI() {
    for (const u of this.units) if (u.owner === 1) u.move = u.def.move;

    const hasAICity = this.cities.some(c => c.owner === 1);
    for (const u of this.units.filter(u => u.owner === 1)) {
      if (u.def.canFound && !hasAICity) { this.foundCity(u); continue; }

      // Head toward the nearest visible player asset, else wander.
      const targets = [...this.units.filter(t => t.owner === 0), ...this.cities.filter(c => c.owner === 0)];
      let dest = null;
      if (targets.length) {
        targets.sort((a, b) => distance(u, a) - distance(u, b));
        const t = targets[0];
        if (distance(u, t) === 1 && u.def.attack && this.unitAt(t.q, t.r)) {
          this.resolveCombat(u, this.unitAt(t.q, t.r));
          continue;
        }
        dest = t;
      }
      const reach = reachable(this.tiles, u, u.move, this.occupied(u));
      const options = [...reach.keys()];
      if (!options.length) continue;
      let pick = options[0];
      if (dest) {
        // Greedily step toward the target.
        let bestD = Infinity;
        for (const k of options) {
          const [q, r] = k.split(',').map(Number);
          const d = distance({ q, r }, dest);
          if (d < bestD) { bestD = d; pick = k; }
        }
      } else {
        pick = options[(this.turn * 7 + u.id) % options.length]; // deterministic wander
      }
      const [q, r] = pick.split(',').map(Number);
      const path = findPath(this.tiles, u, { q, r }, this.occupied(u));
      if (path) u.enqueuePath(path, this.view);
    }
  }
}
