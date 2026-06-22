// game.js — the rules layer: turns, fog of war, founding cities, movement
// budgets, combat, the 4X economy (production queues, tech, buildings, city
// territory), and a simple AI opponent. Holds no Three.js scene logic beyond
// adding/removing the meshes that units and cities carry.
import { key, distance, hexesInRange, neighbors } from './hex.js';
import { findPath, reachable } from './pathfinding.js';
import { Unit, City, UNIT_TYPES, OWNER_COLOR } from './units.js';
import { TECHS, availableTechs, pathTo } from './tech.js';
import { BUILDINGS, unlockedBuildings } from './buildings.js';
import { DISTRICTS, DISTRICT_COST, buildingDistrict, unlockedDistricts } from './districts.js';
import { computeOwnership, ownedTiles, initialClaim, expandClaim } from './territory.js';
import { cityYields } from './economy.js';
import { resolveAttack } from './combat.js';
import { isWater } from './worldgen.js';
import { CIVICS, GOVERNMENTS, POLICIES, availableCivics, availableGovernments, availablePolicies, pathTo as civicPathTo } from './civics.js';

const CITY_NAMES = ['Aurelia', 'Highkeep', 'Rivermouth', 'Stonewatch', 'Greenhollow', 'Saltspire', 'Ironford', 'Dawnvale'];
// Civ display names by owner index (0 = the human player).
const CIV_NAMES = ['Your Empire', 'Crimson', 'Verdant', 'Amber', 'Violet'];

// AI strength by difficulty: `mul` scales AI civ income/production, `combat`
// adds to AI attack strength.
const DIFFICULTY = {
  easy:   { mul: 0.8,  combat: 0 },
  normal: { mul: 1.0,  combat: 0 },
  hard:   { mul: 1.35, combat: 2 },
};

export class Game {
  constructor(scene, worldView, numCivs = 2, civConfigs = null, opts = {}) {
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
    this.wars = new Set();             // "a,b" (a<b) pairs of civs at war
    this.income = { food: 0, prod: 0, gold: 0, science: 0 }; // player (owner 0)
    this.events = [];                  // human-readable notices from the last turn
    this.gameOver = null;              // { win, reason } once the game is decided

    // Per-civ state: 0 = player, 1+ = AI. Science accrues in treasury.science as a
    // research "bank" that is spent when the current tech's cost is met.
    this.civs = [];
    for (let i = 0; i < numCivs; i++) {
      const cfg = civConfigs && civConfigs[i];
      if (cfg && cfg.color != null) OWNER_COLOR[i] = cfg.color; // recolour to the chosen civ
      this.civs.push({
        owner: i, name: (cfg && cfg.name) || CIV_NAMES[i] || `Civ ${i}`,
        id: (cfg && cfg.id) || null,   // civilization id, for unique units
        trait: (cfg && cfg.trait) || null,
        treasury: { gold: 0, science: 0, culture: 0 },
        research: { researched: new Set(), queue: [] },
        civics: { researched: new Set(), queue: [] },
        government: 'chiefdom',
        policies: [],            // adopted policy-card ids
      });
    }
    this.treasury = this.civs[0].treasury; // back-compat alias for the HUD

    this.difficulty = opts.difficulty || 'normal';
    this._diff = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
    this.turnLimit = opts.turnLimit || null; // score victory at this turn, if set
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
    this.updateDistricts();
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
    this.ownership = computeOwnership(this.cities);
  }

  // Owned (non-center) tile objects for a city.
  ownedTilesFor(city) { return ownedTiles(city, this.tiles); }

  // How much a city wants to claim a tile: yields, with a strong pull toward
  // resources and rivers, so borders grow toward good land automatically.
  _tileClaimValue(t) {
    let v = (t.yields?.food || 0) + (t.yields?.prod || 0) + (t.yields?.gold || 0);
    if (t.resource) v += 6;
    if (t.river) v += 2;
    if (!t.passable) v -= 2; // water/mountain is claimable but low priority
    return v;
  }

  // Feed the renderer a colored marker per owned hex, hiding unexplored enemy land.
  updateBorders() {
    const entries = [];
    for (const [k, city] of this.ownership) {
      if (city.owner !== 0 && !this.explored.has(k)) continue;
      const [q, r] = k.split(',').map(Number);
      entries.push({ q, r, owner: city.owner, color: OWNER_COLOR[city.owner], center: (city.q === q && city.r === r) });
    }
    this.view.showBorders(entries);
  }

  // Feed the renderer a marker per placed district (hiding unexplored ones).
  updateDistricts() {
    const entries = [];
    for (const c of this.cities) {
      for (const [k, id] of c.districts) {
        if (c.owner !== 0 && !this.explored.has(k)) continue;
        const [q, r] = k.split(',').map(Number);
        entries.push({ q, r, district: id, color: DISTRICTS[id].color });
      }
    }
    if (this.view.showDistricts) this.view.showDistricts(entries);
  }

  // --- player actions -------------------------------------------------------
  // Domain-aware movement: naval units travel on water; land units travel on
  // land and, with Sailing researched, may embark onto water.
  _moveOpts(unit) {
    if (unit.def.domain === 'sea') return { enter: (t) => isWater(t), cost: () => 1 };
    const canSail = this.civs[unit.owner].research.researched.has('sailing');
    return {
      enter: (t) => t.passable || (canSail && isWater(t)),
      cost: (t) => (t.passable ? t.moveCost : 1),
    };
  }

  // A city that can build/launch ships: it touches water.
  isCoastal(city) {
    return neighbors(city.q, city.r).some(n => isWater(this.tiles.get(key(n.q, n.r))));
  }

  reachableFor(unit) {
    return reachable(this.tiles, unit, unit.move, this.occupied(unit), this._moveOpts(unit));
  }

  pathFor(unit, q, r) {
    return findPath(this.tiles, unit, { q, r }, this.occupied(unit), this._moveOpts(unit));
  }

  // Move (or attack). Returns { ok, taken?, msg? }.
  tryMoveUnit(unit, q, r) {
    if (unit.move <= 0) return { ok: false, msg: 'No movement left' };

    const enemy = this.unitAt(q, r);
    if (enemy && enemy.owner !== unit.owner) {
      if (!this.atWar(unit.owner, enemy.owner)) return { ok: false, msg: `At peace with ${this.civs[enemy.owner].name}` };
      if (!unit.def.attack) return { ok: false, msg: 'This unit cannot attack' };
      if (unit.embarked) return { ok: false, msg: 'Cannot attack while embarked' };
      const d = distance(unit, { q, r });
      const range = unit.def.range || 1;
      if (d >= 1 && d <= range) return this.resolveCombat(unit, enemy, range > 1);
      return { ok: false, msg: 'Out of range' };
    }
    if (enemy && enemy.owner === unit.owner) return { ok: false, msg: 'Tile occupied' };
    const tcity = this.cityAt(q, r);
    if (tcity && tcity.owner !== unit.owner) {
      if (!this.atWar(unit.owner, tcity.owner)) return { ok: false, msg: `At peace with ${this.civs[tcity.owner].name}` };
      return this.attackCity(unit, tcity);
    }

    const opts = this._moveOpts(unit);
    const path = findPath(this.tiles, unit, { q, r }, this.occupied(unit), opts);
    if (!path || !path.length) return { ok: false, msg: 'No path' };

    // Spend movement along the path; a unit may always take at least one step.
    let remaining = unit.move;
    const taken = [];
    for (const step of path) {
      if (remaining <= 0) break;
      taken.push(step);
      remaining -= opts.cost(this.tiles.get(key(step.q, step.r)));
    }
    unit.move = Math.max(0, remaining);
    unit.enqueuePath(taken, this.view);
    if (unit.def.domain !== 'sea') unit.setEmbarked(isWater(this.tiles.get(key(unit.q, unit.r))));
    this.recomputeFog();
    return { ok: true, taken };
  }

  foundCity(unit) {
    if (!unit.def.canFound) return { ok: false, msg: 'This unit cannot found a city' };
    const here = this.tiles.get(key(unit.q, unit.r));
    if (!here || !here.passable) return { ok: false, msg: 'Must be on land to found a city' };
    if (this.cityAt(unit.q, unit.r)) return { ok: false, msg: 'Already a city here' };
    const baseName = CITY_NAMES[this.cityNameIdx++ % CITY_NAMES.length];
    const name = unit.owner === 0 ? baseName : `${this.civs[unit.owner].name} ${baseName}`;
    const city = new City(unit.owner, unit.q, unit.r, name);
    city.placeAt(this.view);
    this.scene.add(city.mesh);
    this.cities.push(city);
    city.hp = this.cityMaxHp(city);
    city.tiles = initialClaim(city, this.tiles, this.ownership); // centre + six neighbours
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
    if (defender.embarked) extraDef *= 0.5; // a unit caught at sea is very vulnerable
    const atk = (attacker.def.attack || 0) + this.civMods(attacker.owner).combat;
    const res = resolveAttack(atk, defender.def.attack || 0, dt ? dt.terrain : null, isRanged, extraDef);

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
    this._checkGameOver();
    return { ok: true, combat: true, msg };
  }

  // --- city assault --------------------------------------------------------
  cityMaxHp(city) {
    return 60 + city.population * 6 + (city.buildings.has('walls') ? 40 : 0);
  }

  // Attack an (undefended) enemy city. Ranged units bombard it; a melee unit
  // that reduces it to 0 HP captures it and marches in.
  attackCity(unit, city) {
    if (!unit.def.attack) return { ok: false, msg: 'This unit cannot attack' };
    if (unit.embarked) return { ok: false, msg: 'Cannot attack while embarked' };
    const range = unit.def.range || 1;
    const d = distance(unit, city);
    if (d < 1 || d > range) return { ok: false, msg: 'Out of range' };

    const dmg = Math.max(1, unit.def.attack + this.civMods(unit.owner).combat);
    city.hp = Math.max(0, city.hp - dmg);
    unit.move = 0;
    if (this.fx) {
      if (range > 1 && d > 1) this.fx.projectile(unit.mesh.position, city.mesh.position, OWNER_COLOR[unit.owner]);
      else this.fx.lunge(unit, city.mesh.position);
      this.fx.flash(city);
      this.fx.spark(city.mesh.position);
      this.fx.damage(city.mesh.position, '-' + dmg);
    }

    let msg = `${city.name} besieged (${city.hp} HP)`;
    const melee = range <= 1 && d === 1;
    if (city.hp <= 0 && melee) { this._captureCity(city, unit.owner, unit); msg = `Captured ${city.name}!`; }
    else if (city.hp <= 0) msg = `${city.name} breached — move a melee unit in to capture`;
    this.recomputeFog();
    this._checkGameOver();
    return { ok: true, combat: true, msg };
  }

  _captureCity(city, newOwner, unit) {
    city.setOwner(newOwner);
    city.population = Math.max(1, city.population - 1);
    city.hp = Math.round(this.cityMaxHp(city) * 0.5);
    city.food = 0; city.production = 0; city.queue = [];
    if (unit) { unit.enqueuePath([{ q: city.q, r: city.r }], this.view); unit.move = 0; }
    this.recomputeOwnership();
    this.events.push(newOwner === 0 ? `Captured ${city.name}!` : `${city.name} has fallen!`);
  }

  // Visible enemy units this unit could attack right now (melee or ranged).
  attackTargetsFor(unit) {
    if (!unit.def.attack || unit.move <= 0 || unit.embarked) return [];
    const range = unit.def.range || 1;
    const out = [];
    for (const e of this.units) {
      if (e.owner === unit.owner || !this.atWar(unit.owner, e.owner)) continue;
      if (!this.visible.has(key(e.q, e.r))) continue;
      const d = distance(unit, e);
      if (d >= 1 && d <= range) out.push({ q: e.q, r: e.r });
    }
    for (const c of this.cities) {
      if (c.owner === unit.owner || !this.atWar(unit.owner, c.owner) || this.unitAt(c.q, c.r)) continue;
      if (!this.visible.has(key(c.q, c.r))) continue;
      const d = distance(unit, c);
      if (d >= 1 && d <= range) out.push({ q: c.q, r: c.r });
    }
    return out;
  }

  _removeUnit(unit) {
    this.units = this.units.filter(u => u !== unit);
    if (this.fx) this.fx.death(unit.mesh); // play a death animation, then dispose
    else this.scene.remove(unit.mesh);
  }

  // --- diplomacy ------------------------------------------------------------
  _warKey(a, b) { return a < b ? `${a},${b}` : `${b},${a}`; }
  atWar(a, b) { return a !== b && this.wars.has(this._warKey(a, b)); }
  isCivAlive(owner) { return this.cities.some(c => c.owner === owner) || this.units.some(u => u.owner === owner); }

  declareWar(a, b) {
    if (a === b || this.atWar(a, b)) return;
    this.wars.add(this._warKey(a, b));
    if (a === 0 || b === 0) {
      const other = a === 0 ? b : a;
      this.events.push(a === 0 ? `War declared on ${this.civs[other].name}` : `${this.civs[other].name} has declared war on you!`);
    }
  }

  makePeace(a, b) {
    if (!this.atWar(a, b)) return;
    this.wars.delete(this._warKey(a, b));
    if (a === 0 || b === 0) {
      const other = a === 0 ? b : a;
      this.events.push(`Peace with ${this.civs[other].name}`);
    }
  }

  // A civ's total military strength (sum of unit attack), for AI war decisions.
  _mil(owner) {
    let s = 0;
    for (const u of this.units) if (u.owner === owner) s += u.def.attack || 0;
    return s;
  }

  // AI diplomacy: pounce on a beatable peaceful rival, sue for peace if outmatched.
  _aiDiplomacy(owner) {
    if ((this.turn + owner) % 5 !== 0) return;
    const myMil = this._mil(owner);
    for (let other = 0; other < this.civs.length; other++) {
      if (other === owner) continue;
      if (this.atWar(owner, other) && this._mil(other) > myMil * 1.6) this.makePeace(owner, other);
    }
    if (myMil <= 0) return;
    const prey = [];
    for (let other = 0; other < this.civs.length; other++) {
      if (other === owner || this.atWar(owner, other) || !this.isCivAlive(other)) continue;
      if (this._mil(other) <= myMil) prey.push(other);
    }
    prey.sort((a, b) => this._mil(a) - this._mil(b));
    if (prey.length) this.declareWar(owner, prey[0]);
  }

  // --- civics: governments & policies ---------------------------------------
  // Aggregate a civ's active modifiers from its government plus adopted policies.
  civMods(owner) {
    const civ = this.civs[owner];
    const mods = { foodMul: 1, prodMul: 1, goldMul: 1, sciMul: 1, combat: 0, settlerDiscount: 1, militaryDiscount: 1 };
    const merge = (eff) => {
      if (!eff) return;
      for (const k in eff) {
        if (k === 'combat') mods.combat += eff[k];
        else if (k.endsWith('Mul') || k.endsWith('Discount')) mods[k] *= eff[k];
        else mods[k] = eff[k];
      }
    };
    merge(civ.trait?.effect);
    merge(GOVERNMENTS[civ.government]?.bonus);
    for (const id of civ.policies) merge(POLICIES[id]?.effect);
    if (owner !== 0 && this._diff) mods.combat += this._diff.combat; // AI combat handicap
    return mods;
  }

  // --- economy --------------------------------------------------------------
  // One city's per-turn yields: worked tiles + buildings, then civic modifiers.
  cityYields(city) {
    const center = this.tiles.get(key(city.q, city.r));
    const y = cityYields(center, this.ownedTilesFor(city), city.population, city.buildings);
    const m = this.civMods(city.owner);
    const out = {
      food: Math.round(y.food * m.foodMul),
      prod: Math.round(y.prod * m.prodMul),
      gold: Math.round(y.gold * m.goldMul),
      science: Math.round(y.science * m.sciMul),
      culture: y.culture,
    };
    for (const id of city.districts.values()) { // flat district yields
      const dy = DISTRICTS[id]?.yield;
      if (dy) for (const k in dy) out[k] = (out[k] || 0) + dy[k];
    }
    return out;
  }

  // Aggregate yields for a civ (used by the HUD for the player).
  computeIncome(owner = 0) {
    const inc = { food: 0, prod: 0, gold: 0, science: 0, culture: 0 };
    for (const c of this.cities) {
      if (c.owner !== owner) continue;
      const y = this.cityYields(c);
      inc.food += y.food; inc.prod += y.prod; inc.gold += y.gold; inc.science += y.science; inc.culture += y.culture;
    }
    return inc;
  }

  // Effective production cost of a build item after civic discounts.
  itemCost(owner, item) {
    let mult = 1;
    if (item.kind === 'unit') {
      const m = this.civMods(owner);
      const def = UNIT_TYPES[item.id];
      if (def?.canFound) mult = m.settlerDiscount;
      else if (def?.attack) mult = m.militaryDiscount;
    }
    return Math.max(1, Math.round(item.cost * mult));
  }

  // --- production queue -----------------------------------------------------
  // Build items a civ may queue right now: every unit, plus tech-unlocked
  // buildings. Per-city filtering (already built / queued) happens in the UI.
  buildOptions(owner, city = null) {
    const civ = this.civs[owner];
    const researched = civ.research.researched;
    const has = city ? new Set(city.districts.values()) : null; // district types this city has
    const items = [];
    for (const [id, def] of Object.entries(UNIT_TYPES)) {
      if (def.requires && !researched.has(def.requires)) continue;        // gated by tech
      if (def.onlyCiv && def.onlyCiv !== civ.id) continue;                // another civ's unique
      items.push({ kind: 'unit', id, name: def.name, cost: def.cost, domain: def.domain });
    }
    for (const id of unlockedDistricts(researched, civ.civics.researched)) {
      if (has && has.has(id)) continue; // one of each district per city
      items.push({ kind: 'district', id, name: DISTRICTS[id].name, cost: DISTRICT_COST, desc: `Holds ${DISTRICTS[id].buildings.map(b => BUILDINGS[b].name).join(' & ')}` });
    }
    for (const id of unlockedBuildings(researched, civ.civics.researched)) {
      const dist = buildingDistrict(id);
      if (dist && has && !has.has(dist)) continue; // its district isn't built in this city yet
      items.push({ kind: 'building', id, name: BUILDINGS[id].name, cost: BUILDINGS[id].cost, desc: BUILDINGS[id].desc, district: dist });
    }
    return items;
  }

  // Owned tiles where a new district may be placed (not the centre, on land, and
  // not already holding a district or queued for one).
  districtSites(city) {
    const center = key(city.q, city.r);
    const queued = new Set(city.queue.filter(i => i.kind === 'district' && i.tile).map(i => i.tile));
    return [...city.tiles].filter(k => {
      if (k === center || city.districts.has(k) || queued.has(k)) return false;
      const t = this.tiles.get(k);
      return t && t.passable && t.terrain !== 'MOUNTAIN';
    });
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

  // Where a freshly built unit appears. Ships launch onto adjacent water; land
  // units take the city tile if free, else a free neighbouring land tile.
  _spawnSpot(city, def) {
    const sea = def && def.domain === 'sea';
    if (sea) {
      for (const n of neighbors(city.q, city.r)) {
        const t = this.tiles.get(key(n.q, n.r));
        if (t && isWater(t) && !this.unitAt(n.q, n.r)) return n;
      }
      return null;
    }
    if (!this.unitAt(city.q, city.r)) return { q: city.q, r: city.r };
    for (const n of neighbors(city.q, city.r)) {
      const t = this.tiles.get(key(n.q, n.r));
      if (t && t.passable && !this.unitAt(n.q, n.r) && !this.cityAt(n.q, n.r)) return n;
    }
    return null;
  }

  _completeBuild(city, item) {
    if (item.kind === 'district') {
      if (item.tile && city.tiles.has(item.tile)) city.districts.set(item.tile, item.id);
      if (city.owner === 0) this.events.push(`${DISTRICTS[item.id].name} built in ${city.name}`);
    } else if (item.kind === 'building') {
      city.buildings.add(item.id);
      if (city.owner === 0) this.events.push(`${BUILDINGS[item.id].name} built in ${city.name}`);
    } else {
      const spot = this._spawnSpot(city, UNIT_TYPES[item.id]);
      this.spawnUnit(item.id, city.owner, spot.q, spot.r);
      if (city.owner === 0) this.events.push(`${UNIT_TYPES[item.id].name} trained in ${city.name}`);
    }
  }

  // Pour this turn's production into the queue, completing affordable items.
  _processProduction(city) {
    city.production += this.cityYields(city).prod;
    while (city.queue.length) {
      const item = city.queue[0];
      const cost = this.itemCost(city.owner, item);
      if (city.production < cost) break;
      if (item.kind === 'unit' && !this._spawnSpot(city, UNIT_TYPES[item.id])) break; // no room — wait
      city.production -= cost;
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

  // --- civics (mirror of research, paid with culture) -----------------------
  setCivicPath(owner, target) {
    const civ = this.civs[owner];
    civ.civics.queue = civicPathTo(target, civ.civics.researched);
    return civ.civics.queue;
  }
  currentCivic(owner) { return this.civs[owner].civics.queue[0] || null; }

  setGovernment(owner, govId) {
    if (availableGovernments(this.civs[owner].civics.researched).includes(govId)) this.civs[owner].government = govId;
  }

  // Adopt a set of policy cards, keeping only unlocked cards that fit the
  // government's slots (military / economic / wildcard).
  setPolicies(owner, cards) {
    const civ = this.civs[owner];
    const slots = GOVERNMENTS[civ.government].slots;
    const unlocked = new Set(availablePolicies(civ.civics.researched));
    const left = { mil: slots.mil, eco: slots.eco, wild: slots.wild };
    const accepted = [];
    for (const id of cards) {
      const p = POLICIES[id];
      if (!p || !unlocked.has(id) || accepted.includes(id)) continue;
      if (left[p.slot] > 0) { left[p.slot]--; accepted.push(id); }
      else if (left.wild > 0) { left.wild--; accepted.push(id); }
    }
    civ.policies = accepted;
  }

  _processCivics(civ) {
    const c = civ.civics;
    while (c.queue.length) {
      const civic = CIVICS[c.queue[0]];
      if (civ.treasury.culture < civic.cost) break;
      civ.treasury.culture -= civic.cost;
      c.researched.add(c.queue.shift());
      if (civ.owner === 0) this.events.push(`Adopted ${civic.name} — unlocks ${civic.unlocks}`);
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
      // Territory grows one tile at a time as the city banks culture, steering
      // toward the best unclaimed frontier tile (resources & rich land).
      if (!c.tiles) c.tiles = initialClaim(c, this.tiles, this.ownership);
      c.borderProgress = (c.borderProgress || 0) + 1 + Math.floor(c.population / 2);
      const cost = 4 + c.tiles.size; // each new tile costs a little more
      if (c.borderProgress >= cost) {
        const k = expandClaim(c, c.tiles, this.tiles, this.ownership, (t) => this._tileClaimValue(t), 3);
        if (k) {
          c.borderProgress -= cost;
          c.tiles.add(k);
          this.ownership.set(k, c); // reserve it so other cities don't double-claim this turn
          if (owner === 0) this.events.push(`${c.name}'s borders grew`);
        }
      }
      this._processProduction(c);
      const mul = owner === 0 ? 1 : this._diff.mul; // AI handicap by difficulty
      if (mul !== 1) c.production += y.prod * (mul - 1);
      c.hp = Math.min(this.cityMaxHp(c), c.hp + 8); // walls heal between assaults
      civ.treasury.gold += y.gold * mul;
      civ.treasury.science += y.science * mul;
      civ.treasury.culture += y.culture * mul;
    }
    this._processResearch(civ);
    this._processCivics(civ);
  }

  // A unit that held position recovers HP — most inside a friendly city, some on
  // owned territory, a little in the field, none while embarked at sea.
  _heal(u) {
    if (u.embarked || u.hp >= u.def.hp) return;
    const k = key(u.q, u.r);
    const inCity = this.cities.some(c => c.owner === u.owner && c.q === u.q && c.r === u.r);
    const terr = this.ownership.get(k);
    const amt = inCity ? 15 : (terr && terr.owner === u.owner) ? 10 : 5;
    u.hp = Math.min(u.def.hp, u.hp + amt);
  }

  // --- save / load ----------------------------------------------------------
  // A plain-data snapshot. The map regenerates identically from its seed, so we
  // only persist the seed plus the mutable game state.
  serialize() {
    return {
      v: 1,
      seed: this.world.seed,
      radius: this.world.radius,
      turn: this.turn,
      cityNameIdx: this.cityNameIdx,
      explored: [...this.explored],
      units: this.units.map(u => ({ type: u.type, owner: u.owner, q: u.q, r: u.r, hp: u.hp, move: u.move, embarked: !!u.embarked })),
      cities: this.cities.map(c => ({ owner: c.owner, q: c.q, r: c.r, name: c.name, population: c.population, food: c.food, production: c.production, hp: c.hp, tiles: [...(c.tiles || [])], districts: [...c.districts], borderProgress: c.borderProgress, queue: c.queue, buildings: [...c.buildings] })),
      civs: this.civs.map((v, i) => ({
        name: v.name, id: v.id, trait: v.trait, color: OWNER_COLOR[i],
        treasury: { ...v.treasury },
        research: { researched: [...v.research.researched], queue: [...v.research.queue] },
        civics: { researched: [...v.civics.researched], queue: [...v.civics.queue] },
        government: v.government,
        policies: [...v.policies],
      })),
      wars: [...this.wars],
      difficulty: this.difficulty,
      turnLimit: this.turnLimit,
      gameOver: this.gameOver,
    };
  }

  // Rebuild entities from a snapshot (the world must already be generated from
  // the same seed). Replaces any current units/cities.
  restore(data) {
    for (const u of this.units) this.scene.remove(u.mesh);
    for (const c of this.cities) this.scene.remove(c.mesh);
    this.units = []; this.cities = [];
    this.turn = data.turn;
    this.cityNameIdx = data.cityNameIdx || 0;
    this.explored = new Set(data.explored || []);

    // Restore civ colours before rebuilding meshes (they read OWNER_COLOR).
    (data.civs || []).forEach((cd, i) => { if (cd && cd.color != null) OWNER_COLOR[i] = cd.color; });

    for (const cd of data.cities) {
      const city = new City(cd.owner, cd.q, cd.r, cd.name);
      city.population = cd.population; city.food = cd.food; city.production = cd.production;
      city.hp = cd.hp; city.queue = cd.queue || []; city.buildings = new Set(cd.buildings || []);
      city.tiles = cd.tiles ? new Set(cd.tiles) : initialClaim(city, this.tiles, new Map());
      city.districts = new Map(cd.districts || []);
      city.borderProgress = cd.borderProgress || 0;
      city.placeAt(this.view);
      this.scene.add(city.mesh);
      this.cities.push(city);
    }
    for (const ud of data.units) {
      const u = this.spawnUnit(ud.type, ud.owner, ud.q, ud.r);
      u.hp = ud.hp; u.move = ud.move; u.setEmbarked(!!ud.embarked);
    }
    this.civs.forEach((v, i) => {
      const cd = data.civs[i];
      if (!cd) return;
      v.treasury = { gold: cd.treasury.gold || 0, science: cd.treasury.science || 0, culture: cd.treasury.culture || 0 };
      v.research.researched = new Set(cd.research.researched || []);
      v.research.queue = cd.research.queue || [];
      v.civics.researched = new Set((cd.civics && cd.civics.researched) || []);
      v.civics.queue = (cd.civics && cd.civics.queue) || [];
      v.government = cd.government || 'chiefdom';
      v.policies = cd.policies || [];
      if (cd.name) v.name = cd.name;
      if ('id' in cd) v.id = cd.id;
      if ('trait' in cd) v.trait = cd.trait;
    });
    this.treasury = this.civs[0].treasury;
    this.wars = new Set(data.wars || []);
    this.difficulty = data.difficulty || 'normal';
    this._diff = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
    this.turnLimit = data.turnLimit || null;
    this.gameOver = data.gameOver || null;
    this.recomputeOwnership();
    this.income = this.computeIncome(0);
    this.recomputeFog();
  }

  // Decide the game once a civ is wiped out or someone reaches Flight.
  _checkGameOver() {
    if (this.gameOver) return;
    const alive = (owner) => this.cities.some(c => c.owner === owner) || this.units.some(u => u.owner === owner);
    for (let o = 0; o < this.civs.length; o++) {
      if (this.civs[o].research.researched.has('flight')) {
        this.gameOver = o === 0
          ? { win: true, reason: 'Flight achieved — your aircraft rule the skies!' }
          : { win: false, reason: `${this.civs[o].name} reached Flight first.` };
        return;
      }
    }
    if (!alive(0)) { this.gameOver = { win: false, reason: 'Your empire has fallen.' }; return; }
    const rivals = this.civs.slice(1).filter(c => alive(c.owner));
    if (rivals.length === 0) { this.gameOver = { win: true, reason: 'Every rival civilization has been conquered.' }; return; }

    // Score victory: at the turn limit, the highest-scoring surviving civ wins.
    if (this.turnLimit && this.turn > this.turnLimit) {
      const ranked = this.civs.map((c, o) => ({ o, s: this._score(o) })).filter(x => alive(x.o)).sort((a, b) => b.s - a.s);
      const top = ranked[0];
      this.gameOver = top.o === 0
        ? { win: true, reason: `Turn limit reached — you led on score (${top.s}).` }
        : { win: false, reason: `Turn limit reached — ${this.civs[top.o].name} led on score (${top.s}).` };
    }
  }

  // A civ's score: cities & population, knowledge, and claimed territory.
  _score(owner) {
    let s = 0;
    for (const c of this.cities) if (c.owner === owner) s += 5 + c.population;
    const civ = this.civs[owner];
    s += civ.research.researched.size * 3 + civ.civics.researched.size * 2;
    for (const [, c] of this.ownership) if (c.owner === owner) s += 1;
    return s;
  }

  // --- turns ----------------------------------------------------------------
  endTurn() {
    this.events = [];
    this._runAI();

    for (let o = 1; o < this.civs.length; o++) this._processEconomy(o); // AI economies
    this._processEconomy(0); // player economy
    this.income = this.computeIncome(0);

    this.turn++;
    for (const u of this.units) if (u.owner === 0) {
      if (u.move === u.def.move) this._heal(u); // didn't act this turn — recover
      u.move = u.def.move;
    }
    this.recomputeOwnership();
    this.recomputeFog();
    this._checkGameOver();
    return this.income;
  }

  // A simple opponent: research the cheapest tech, queue settlers to expand then
  // buildings and military, and push units toward the player.
  _runAI() {
    for (let owner = 1; owner < this.civs.length; owner++) this._runAICiv(owner);
  }

  // One AI civilization's whole turn: heal, research, produce, and move/fight
  // against every rival (the player and other AI civs alike).
  _runAICiv(owner) {
    const civ = this.civs[owner];
    for (const u of this.units) if (u.owner === owner) {
      if (u.move === u.def.move) this._heal(u); // idle units recover
      u.move = u.def.move;
    }

    // Research & civics: always work on the cheapest available of each.
    if (!civ.research.queue.length) {
      const opts = availableTechs(civ.research.researched);
      if (opts.length) civ.research.queue = [opts[0]];
    }
    if (!civ.civics.queue.length) {
      const opts = availableCivics(civ.civics.researched);
      if (opts.length) civ.civics.queue = [opts[0]];
    }
    // Adopt the best available government and fill its policy slots.
    const govs = availableGovernments(civ.civics.researched);
    if (govs.length) civ.government = govs[govs.length - 1];
    this.setPolicies(owner, availablePolicies(civ.civics.researched));

    // Diplomacy: pick fights it can win, sue for peace when outmatched.
    this._aiDiplomacy(owner);

    // Production: defend threatened cities first, then expand, build, and arm.
    const myCities = this.cities.filter(c => c.owner === owner);
    const mySettlers = this.units.filter(u => u.owner === owner && u.def.canFound).length;
    for (const c of myCities) {
      if (c.queue.length) continue;
      const opts = this.buildOptions(owner, c);
      const building = opts.find(o => o.kind === 'building' && !c.buildings.has(o.id));
      const district = opts.find(o => o.kind === 'district');
      const threatened = this.units.some(e => e.owner !== owner && distance(e, c) <= 5);
      const defended = this.units.some(u => u.owner === owner && u.def.attack && !u.def.canFound && distance(u, c) <= 3);
      if (threatened && !defended) {
        if (civ.research.researched.has('masonry') && !c.buildings.has('walls')) c.queue.push(this._aiItem('building', 'walls'));
        else c.queue.push(this._aiItem('unit', this._aiBestUnit(owner)));
      } else if (myCities.length < 3 && mySettlers === 0) {
        c.queue.push(this._aiItem('unit', 'settler'));
      } else if (building) {
        c.queue.push(this._aiItem('building', building.id));
      } else if (district && this.districtSites(c).length) {
        c.queue.push({ kind: 'district', id: district.id, name: district.name, cost: district.cost, tile: this.districtSites(c)[0] });
      } else {
        c.queue.push(this._aiItem('unit', this._aiBestUnit(owner)));
      }
    }

    // Movement: settlers expand, others scout/hunt any rival.
    for (const u of this.units.filter(u => u.owner === owner)) {
      if (u.def.canFound) {
        const tile = this.tiles.get(key(u.q, u.r));
        const crowded = this.cities.some(c => distance(c, u) < 3);
        if (tile && tile.passable && !crowded && !this.cityAt(u.q, u.r)) { this.foundCity(u); continue; }
      }

      // Badly wounded units break off and fall back to the nearest city to heal.
      if (u.def.attack && u.hp < u.def.hp * 0.4) {
        const refuge = this.cities.filter(c => c.owner === owner).sort((a, b) => distance(u, a) - distance(u, b))[0];
        if (refuge) {
          const opts = this._moveOpts(u);
          const reach = reachable(this.tiles, u, u.move, this.occupied(u), opts);
          let pick = null, bestD = Infinity;
          for (const k of reach.keys()) { const [q, r] = k.split(',').map(Number); const d = distance({ q, r }, refuge); if (d < bestD) { bestD = d; pick = k; } }
          if (pick) { const [q, r] = pick.split(',').map(Number); const path = findPath(this.tiles, u, { q, r }, this.occupied(u), opts); if (path) u.enqueuePath(path, this.view); }
          continue;
        }
      }

      // Head toward the nearest enemy we're at war with, else wander.
      const targets = [...this.units.filter(t => this.atWar(owner, t.owner)), ...this.cities.filter(c => this.atWar(owner, c.owner))];
      let dest = null;
      if (targets.length && u.def.attack) {
        const range = u.def.range || 1;
        const inReach = this.units
          .filter(e => this.atWar(owner, e.owner))
          .sort((a, b) => distance(u, a) - distance(u, b))
          .find(e => distance(u, e) >= 1 && distance(u, e) <= range);
        if (inReach) { this.resolveCombat(u, inReach, range > 1); continue; }
        if (!u.embarked) {
          const city = this.cities.find(c => this.atWar(owner, c.owner) && !this.unitAt(c.q, c.r) && distance(u, c) >= 1 && distance(u, c) <= range);
          if (city) { this.attackCity(u, city); continue; }
        }
        targets.sort((a, b) => distance(u, a) - distance(u, b));
        dest = targets[0];
      }
      const opts = this._moveOpts(u);
      const reach = reachable(this.tiles, u, u.move, this.occupied(u), opts);
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
      const path = findPath(this.tiles, u, { q, r }, this.occupied(u), opts);
      if (path) u.enqueuePath(path, this.view);
    }
  }

  _aiItem(kind, id) {
    const def = kind === 'unit' ? UNIT_TYPES[id] : BUILDINGS[id];
    return { kind, id, name: def.name, cost: def.cost };
  }

  // The strongest combat unit a civ can currently build (by attack).
  _aiBestUnit(owner = 1) {
    const researched = this.civs[owner].research.researched;
    let best = 'warrior', bestAtk = 0;
    for (const [id, def] of Object.entries(UNIT_TYPES)) {
      if (!def.attack || def.canFound || def.domain === 'sea') continue; // AI builds land units
      if (def.requires && !researched.has(def.requires)) continue;
      if (def.onlyCiv && def.onlyCiv !== this.civs[owner].id) continue;  // only its own unique
      if (def.attack > bestAtk) { bestAtk = def.attack; best = id; }
    }
    return best;
  }
}
