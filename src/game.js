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
import { isWater } from './worldgen.js';

const CITY_NAMES = ['Aurelia', 'Highkeep', 'Rivermouth', 'Stonewatch', 'Greenhollow', 'Saltspire', 'Ironford', 'Dawnvale'];
// Civ display names by owner index (0 = the human player).
const CIV_NAMES = ['Your Empire', 'Crimson', 'Verdant', 'Amber', 'Violet'];

export class Game {
  constructor(scene, worldView, numCivs = 2) {
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
    this.gameOver = null;              // { win, reason } once the game is decided

    // Per-civ state: 0 = player, 1+ = AI. Science accrues in treasury.science as a
    // research "bank" that is spent when the current tech's cost is met.
    this.civs = [];
    for (let i = 0; i < numCivs; i++) {
      this.civs.push({ owner: i, name: CIV_NAMES[i] || `Civ ${i}`, treasury: { gold: 0, science: 0 }, research: { researched: new Set(), queue: [] } });
    }
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
      if (!unit.def.attack) return { ok: false, msg: 'This unit cannot attack' };
      if (unit.embarked) return { ok: false, msg: 'Cannot attack while embarked' };
      const d = distance(unit, { q, r });
      const range = unit.def.range || 1;
      if (d >= 1 && d <= range) return this.resolveCombat(unit, enemy, range > 1);
      return { ok: false, msg: 'Out of range' };
    }
    if (enemy && enemy.owner === unit.owner) return { ok: false, msg: 'Tile occupied' };
    const tcity = this.cityAt(q, r);
    if (tcity && tcity.owner !== unit.owner) return this.attackCity(unit, tcity);

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

    const dmg = Math.max(1, unit.def.attack);
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
      if (e.owner === unit.owner) continue;
      if (!this.visible.has(key(e.q, e.r))) continue;
      const d = distance(unit, e);
      if (d >= 1 && d <= range) out.push({ q: e.q, r: e.r });
    }
    for (const c of this.cities) {
      if (c.owner === unit.owner || this.unitAt(c.q, c.r)) continue; // garrison shown via its unit
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
      items.push({ kind: 'unit', id, name: def.name, cost: def.cost, domain: def.domain });
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
    if (item.kind === 'building') {
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
      if (city.production < item.cost) break;
      if (item.kind === 'unit' && !this._spawnSpot(city, UNIT_TYPES[item.id])) break; // no room — wait
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
      c.hp = Math.min(this.cityMaxHp(c), c.hp + 8); // walls heal between assaults
      civ.treasury.gold += y.gold;
      civ.treasury.science += y.science;
    }
    this._processResearch(civ);
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
      cities: this.cities.map(c => ({ owner: c.owner, q: c.q, r: c.r, name: c.name, population: c.population, food: c.food, production: c.production, hp: c.hp, queue: c.queue, buildings: [...c.buildings] })),
      civs: this.civs.map(v => ({ treasury: { ...v.treasury }, research: { researched: [...v.research.researched], queue: [...v.research.queue] } })),
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

    for (const cd of data.cities) {
      const city = new City(cd.owner, cd.q, cd.r, cd.name);
      city.population = cd.population; city.food = cd.food; city.production = cd.production;
      city.hp = cd.hp; city.queue = cd.queue || []; city.buildings = new Set(cd.buildings || []);
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
      v.treasury = { gold: cd.treasury.gold || 0, science: cd.treasury.science || 0 };
      v.research.researched = new Set(cd.research.researched || []);
      v.research.queue = cd.research.queue || [];
    });
    this.treasury = this.civs[0].treasury;
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
    if (rivals.length === 0) this.gameOver = { win: true, reason: 'Every rival civilization has been conquered.' };
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

    // Research: always be working on the cheapest available tech.
    if (!civ.research.queue.length) {
      const opts = availableTechs(civ.research.researched);
      if (opts.length) civ.research.queue = [opts[0]];
    }

    // Production: defend threatened cities first, then expand, build, and arm.
    const myCities = this.cities.filter(c => c.owner === owner);
    const mySettlers = this.units.filter(u => u.owner === owner && u.def.canFound).length;
    for (const c of myCities) {
      if (c.queue.length) continue;
      const unlocked = unlockedBuildings(civ.research.researched).filter(id => !c.buildings.has(id));
      const threatened = this.units.some(e => e.owner !== owner && distance(e, c) <= 5);
      const defended = this.units.some(u => u.owner === owner && u.def.attack && !u.def.canFound && distance(u, c) <= 3);
      if (threatened && !defended) {
        if (civ.research.researched.has('masonry') && !c.buildings.has('walls')) c.queue.push(this._aiItem('building', 'walls'));
        else c.queue.push(this._aiItem('unit', this._aiBestUnit(owner)));
      } else if (myCities.length < 3 && mySettlers === 0) {
        c.queue.push(this._aiItem('unit', 'settler'));
      } else if (unlocked.length) {
        c.queue.push(this._aiItem('building', unlocked[0]));
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

      // Head toward the nearest visible rival asset, else wander.
      const targets = [...this.units.filter(t => t.owner !== owner), ...this.cities.filter(c => c.owner !== owner)];
      let dest = null;
      if (targets.length && u.def.attack) {
        const range = u.def.range || 1;
        const inReach = this.units
          .filter(e => e.owner !== owner)
          .sort((a, b) => distance(u, a) - distance(u, b))
          .find(e => distance(u, e) >= 1 && distance(u, e) <= range);
        if (inReach) { this.resolveCombat(u, inReach, range > 1); continue; }
        if (!u.embarked) {
          const city = this.cities.find(c => c.owner !== owner && !this.unitAt(c.q, c.r) && distance(u, c) >= 1 && distance(u, c) <= range);
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
      if (def.attack > bestAtk) { bestAtk = def.attack; best = id; }
    }
    return best;
  }
}
