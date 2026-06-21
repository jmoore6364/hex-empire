// game.js — the rules layer: turns, fog of war, founding cities, movement
// budgets, combat, the 4X economy (production queues, tech, buildings, city
// territory), and a simple AI opponent. Holds no Three.js scene logic beyond
// adding/removing the meshes that units and cities carry.
import { key, distance, hexesInRange, neighbors } from './hex.js';
import { findPath, reachable } from './pathfinding.js';
import { Unit, City, UNIT_TYPES, OWNER_COLOR } from './units.js';
import { TECHS, availableTechs, pathTo } from './tech.js';
import { BUILDINGS, unlockedBuildings } from './buildings.js';
import { computeOwnership, ownedTiles } from './territory.js';
import { cityYields } from './economy.js';
import { resolveAttack } from './combat.js';

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
    this.ownership = new Map();        // "q,r" -> owning city
    this.income = { food: 0, prod: 0, gold: 0, science: 0 }; // player (owner 0)
    this.events = [];                  // human-readable notices from the last turn

    // Per-civ state: 0 = player, 1 = AI. Science accrues in treasury.science as a
    // research "bank" that is spent when the current tech's cost is met.
    this.civs = [
      { owner: 0, name: 'Your Empire', treasury: { gold: 0, science: 0 }, research: { researched: new Set(), queue: [] } },
      { owner: 1, name: 'Crimson',     treasury: { gold: 0, science: 0 }, research: { researched: new Set(), queue: [] } },
    ];
    this.treasury = this.civs[0].treasury; // back-compat alias for the HUD
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
    this.updateBorders();
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

  // --- territory ------------------------------------------------------------
  recomputeOwnership() {
    this.ownership = computeOwnership(this.cities, this.tiles, 2);
  }

  // Owned (non-center) tile objects for a city.
  ownedTilesFor(city) { return ownedTiles(city, this.ownership, this.tiles); }

  // Feed the renderer a colored marker per owned hex, hiding unexplored enemy land.
  updateBorders() {
    const entries = [];
    for (const [k, city] of this.ownership) {
      if (city.owner !== 0 && !this.explored.has(k)) continue;
      const [q, r] = k.split(',').map(Number);
      entries.push({ q, r, color: OWNER_COLOR[city.owner], center: (city.q === q && city.r === r) });
    }
    this.view.showBorders(entries);
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
      if (!unit.def.attack) return { ok: false, msg: 'This unit cannot attack' };
      const d = distance(unit, { q, r });
      const range = unit.def.range || 1;
      if (d >= 1 && d <= range) return this.resolveCombat(unit, enemy, range > 1);
      return { ok: false, msg: 'Out of range' };
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
    this.recomputeOwnership();
    this.recomputeFog();
    return { ok: true, city };
  }

  // Ranged attackers (range > 1) strike without taking a counterattack; the
  // defender's terrain reduces the damage it takes.
  resolveCombat(attacker, defender, isRanged = false) {
    const dt = this.tiles.get(key(defender.q, defender.r));
    // A unit defending its own city tile is harder to kill; City Walls more so.
    const city = this.cityAt(defender.q, defender.r);
    let extraDef = 1;
    if (city && city.owner === defender.owner) extraDef = city.buildings.has('walls') ? 1.75 : 1.25;
    const res = resolveAttack(attacker.def.attack || 0, defender.def.attack || 0, dt ? dt.terrain : null, isRanged, extraDef);

    // Cosmetic combat animation (skipped in headless/logic contexts).
    if (this.fx) {
      if (isRanged) this.fx.projectile(attacker.mesh.position, defender.mesh.position, OWNER_COLOR[attacker.owner]);
      else this.fx.lunge(attacker, defender.mesh.position);
      this.fx.flash(defender);
      this.fx.spark(defender.mesh.position);
      this.fx.damage(defender.mesh.position, '-' + res.dmgToDefender);
    }

    defender.hp -= res.dmgToDefender;
    let msg = `${attacker.def.name} ${isRanged ? 'shoots' : 'strikes'} ${defender.def.name}`;
    if (defender.hp > 0 && res.dmgToAttacker) {
      attacker.hp -= res.dmgToAttacker; // counterattack
      if (this.fx) this.fx.damage(attacker.mesh.position, '-' + res.dmgToAttacker, '#ffd27f');
    }
    attacker.move = 0;
    if (defender.hp <= 0) { this._removeUnit(defender); msg = `${defender.def.name} destroyed!`; }
    if (attacker.hp <= 0) { this._removeUnit(attacker); msg = `${attacker.def.name} lost in battle!`; }
    this.recomputeFog();
    return { ok: true, combat: true, msg };
  }

  // Visible enemy units this unit could attack right now (melee or ranged).
  attackTargetsFor(unit) {
    if (!unit.def.attack || unit.move <= 0) return [];
    const range = unit.def.range || 1;
    const out = [];
    for (const e of this.units) {
      if (e.owner === unit.owner) continue;
      if (!this.visible.has(key(e.q, e.r))) continue;
      const d = distance(unit, e);
      if (d >= 1 && d <= range) out.push({ q: e.q, r: e.r });
    }
    return out;
  }

  _removeUnit(unit) {
    this.units = this.units.filter(u => u !== unit);
    if (this.fx) this.fx.death(unit.mesh); // play a death animation, then dispose
    else this.scene.remove(unit.mesh);
  }

  // --- economy --------------------------------------------------------------
  // One city's per-turn yields, from the tiles it works plus its buildings.
  cityYields(city) {
    const center = this.tiles.get(key(city.q, city.r));
    return cityYields(center, this.ownedTilesFor(city), city.population, city.buildings);
  }

  // Aggregate yields for a civ (used by the HUD for the player).
  computeIncome(owner = 0) {
    const inc = { food: 0, prod: 0, gold: 0, science: 0 };
    for (const c of this.cities) {
      if (c.owner !== owner) continue;
      const y = this.cityYields(c);
      inc.food += y.food; inc.prod += y.prod; inc.gold += y.gold; inc.science += y.science;
    }
    return inc;
  }

  // --- production queue -----------------------------------------------------
  // Build items a civ may queue right now: every unit, plus tech-unlocked
  // buildings. Per-city filtering (already built / queued) happens in the UI.
  buildOptions(owner) {
    const civ = this.civs[owner];
    const researched = civ.research.researched;
    const items = [];
    for (const [id, def] of Object.entries(UNIT_TYPES)) {
      if (def.requires && !researched.has(def.requires)) continue; // gated by tech
      items.push({ kind: 'unit', id, name: def.name, cost: def.cost });
    }
    for (const id of unlockedBuildings(researched)) {
      items.push({ kind: 'building', id, name: BUILDINGS[id].name, cost: BUILDINGS[id].cost, desc: BUILDINGS[id].desc });
    }
    return items;
  }

  enqueue(city, item) { city.queue.push({ ...item }); }

  // Turns left for the front item (accounts for stockpiled production); for any
  // other cost, a from-scratch estimate. Returns '∞' if the city makes no prod.
  turnsFor(city, cost, isFront = false) {
    const prod = this.cityYields(city).prod;
    if (prod <= 0) return '∞';
    const remaining = isFront ? Math.max(0, cost - city.production) : cost;
    return Math.max(1, Math.ceil(remaining / prod));
  }

  // Where a freshly built unit appears: the city tile if free, else a neighbor.
  _spawnSpot(city) {
    if (!this.unitAt(city.q, city.r)) return { q: city.q, r: city.r };
    for (const n of neighbors(city.q, city.r)) {
      const t = this.tiles.get(key(n.q, n.r));
      if (t && t.passable && !this.unitAt(n.q, n.r) && !this.cityAt(n.q, n.r)) return n;
    }
    return null;
  }

  _completeBuild(city, item) {
    if (item.kind === 'building') {
      city.buildings.add(item.id);
      if (city.owner === 0) this.events.push(`${BUILDINGS[item.id].name} built in ${city.name}`);
    } else {
      const spot = this._spawnSpot(city);
      this.spawnUnit(item.id, city.owner, spot.q, spot.r);
      if (city.owner === 0) this.events.push(`${UNIT_TYPES[item.id].name} trained in ${city.name}`);
    }
  }

  // Pour this turn's production into the queue, completing affordable items.
  _processProduction(city) {
    city.production += this.cityYields(city).prod;
    while (city.queue.length) {
      const item = city.queue[0];
      if (city.production < item.cost) break;
      if (item.kind === 'unit' && !this._spawnSpot(city)) break; // no room — wait a turn
      city.production -= item.cost;
      city.queue.shift();
      this._completeBuild(city, item);
    }
  }

  // Queue the prerequisite path to a target tech (Civ-style: pick a distant tech
  // and everything leading to it is lined up in order).
  setResearchPath(owner, target) {
    const civ = this.civs[owner];
    civ.research.queue = pathTo(target, civ.research.researched);
    return civ.research.queue;
  }

  // The tech currently being worked on (front of the queue), or null.
  currentResearch(owner) { return this.civs[owner].research.queue[0] || null; }

  _processResearch(civ) {
    const r = civ.research;
    // Spend banked science down the queue; usually completes one tech per turn,
    // but a big bank can clear several at once.
    while (r.queue.length) {
      const tech = TECHS[r.queue[0]];
      if (civ.treasury.science < tech.cost) break;
      civ.treasury.science -= tech.cost;
      r.researched.add(r.queue.shift());
      if (civ.owner === 0) this.events.push(`Researched ${tech.name} — unlocks ${tech.unlocks}`);
    }
  }

  // Run a civ's whole economy for one turn: growth, production, banking, research.
  _processEconomy(owner) {
    const civ = this.civs[owner];
    for (const c of this.cities) {
      if (c.owner !== owner) continue;
      const y = this.cityYields(c);
      // Growth from this city's own food.
      c.food += y.food;
      const need = c.population * 10;
      if (c.food >= need) { c.food -= need; c.population++; }
      this._processProduction(c);
      civ.treasury.gold += y.gold;
      civ.treasury.science += y.science;
    }
    this._processResearch(civ);
  }

  // --- turns ----------------------------------------------------------------
  endTurn() {
    this.events = [];
    this._runAI();

    this._processEconomy(1); // AI economy
    this._processEconomy(0); // player economy
    this.income = this.computeIncome(0);

    this.turn++;
    for (const u of this.units) if (u.owner === 0) u.move = u.def.move;
    this.recomputeOwnership();
    this.recomputeFog();
    return this.income;
  }

  // A simple opponent: research the cheapest tech, queue settlers to expand then
  // buildings and military, and push units toward the player.
  _runAI() {
    const civ = this.civs[1];
    for (const u of this.units) if (u.owner === 1) u.move = u.def.move;

    // Research: always be working on the cheapest available tech.
    if (!civ.research.queue.length) {
      const opts = availableTechs(civ.research.researched);
      if (opts.length) civ.research.queue = [opts[0]];
    }

    // Production: decide what each idle AI city should build next.
    const aiCities = this.cities.filter(c => c.owner === 1);
    const aiSettlers = this.units.filter(u => u.owner === 1 && u.def.canFound).length;
    for (const c of aiCities) {
      if (c.queue.length) continue;
      const unlocked = unlockedBuildings(civ.research.researched).filter(id => !c.buildings.has(id));
      if (aiCities.length < 3 && aiSettlers === 0) {
        c.queue.push(this._aiItem('unit', 'settler'));
      } else if (unlocked.length) {
        c.queue.push(this._aiItem('building', unlocked[0]));
      } else {
        c.queue.push(this._aiItem('unit', this._aiBestUnit()));
      }
    }

    // Movement: settlers expand, others scout/hunt the player.
    for (const u of this.units.filter(u => u.owner === 1)) {
      if (u.def.canFound) {
        const tile = this.tiles.get(key(u.q, u.r));
        const crowded = this.cities.some(c => c.owner === 1 && distance(c, u) < 3);
        if (tile && tile.passable && !crowded && !this.cityAt(u.q, u.r)) { this.foundCity(u); continue; }
      }

      // Head toward the nearest visible player asset, else wander.
      const targets = [...this.units.filter(t => t.owner === 0), ...this.cities.filter(c => c.owner === 0)];
      let dest = null;
      if (targets.length && u.def.attack) {
        // Shoot/strike the nearest enemy unit already within reach.
        const range = u.def.range || 1;
        const inReach = this.units
          .filter(e => e.owner === 0)
          .sort((a, b) => distance(u, a) - distance(u, b))
          .find(e => distance(u, e) >= 1 && distance(u, e) <= range);
        if (inReach) { this.resolveCombat(u, inReach, range > 1); continue; }
        targets.sort((a, b) => distance(u, a) - distance(u, b));
        dest = targets[0];
      }
      const reach = reachable(this.tiles, u, u.move, this.occupied(u));
      const options = [...reach.keys()];
      if (!options.length) continue;
      let pick = options[0];
      if (dest) {
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

  _aiItem(kind, id) {
    const def = kind === 'unit' ? UNIT_TYPES[id] : BUILDINGS[id];
    return { kind, id, name: def.name, cost: def.cost };
  }

  // The strongest combat unit the AI can currently build (by attack).
  _aiBestUnit() {
    const researched = this.civs[1].research.researched;
    let best = 'warrior', bestAtk = 0;
    for (const [id, def] of Object.entries(UNIT_TYPES)) {
      if (!def.attack || def.canFound) continue;
      if (def.requires && !researched.has(def.requires)) continue;
      if (def.attack > bestAtk) { bestAtk = def.attack; best = id; }
    }
    return best;
  }
}
