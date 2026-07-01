// game.js — the rules layer: turns, fog of war, founding cities, movement
// budgets, combat, the 4X economy (production queues, tech, buildings, city
// territory), and a simple AI opponent. Holds no Three.js scene logic beyond
// adding/removing the meshes that units and cities carry.
import { key, distance, hexesInRange, neighbors } from './hex.js';
import { findPath, reachable } from './pathfinding.js';
import { Unit, City, UNIT_TYPES, OWNER_COLOR, buildBarbCampMesh } from './units.js';
import { TECHS, ERAS, availableTechs, pathTo } from './tech.js';
import { BUILDINGS, unlockedBuildings } from './buildings.js';
import { DISTRICTS, DISTRICT_COST, buildingDistrict, unlockedDistricts } from './districts.js';
import { WONDERS, unlockedWonders } from './wonders.js';
import { GREAT_PEOPLE, gppCost } from './greatpeople.js';
import { BELIEFS, RELIGION_NAMES } from './religions.js';
import { computeOwnership, ownedTiles, initialClaim, expandClaim } from './territory.js';
import { cityYields } from './economy.js';
import { RESOURCES, TRADEABLE } from './resources.js';
import { resolveAttack } from './combat.js';
import { isWater } from './worldgen.js';
import { CIVICS, GOVERNMENTS, POLICIES, availableCivics, availableGovernments, availablePolicies, pathTo as civicPathTo } from './civics.js';

const CITY_NAMES = ['Aurelia', 'Highkeep', 'Rivermouth', 'Stonewatch', 'Greenhollow', 'Saltspire', 'Ironford', 'Dawnvale'];
// Civ display names by owner index (0 = the human player).
const CIV_NAMES = ['Your Empire', 'Crimson', 'Verdant', 'Amber', 'Violet'];

// Years added per turn, by current age (time speeds up as history advances).
// One entry per era in tech.js ERAS (Ancient … Information).
const AGE_YEAR_STEP = [40, 28, 18, 10, 6, 3, 1];

// The Space Race finale: a one-off city "project" unlocked by Rocketry. The
// first civ to finish it launches the Exodus Spaceship and wins the game.
const SPACESHIP = { kind: 'project', id: 'spaceship', name: 'Exodus Spaceship', cost: 600, glyph: '🚀', requires: 'rocketry', desc: 'Win the Space Race — launch a colony ship to the stars' };

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
    this.year = -4000;     // 4000 BC; advances each turn, faster in later ages
    this.age = 0;          // index into ERAS, from the player's most advanced tech
    this.ageAdvanced = null; // set to the new age name on the turn it changes
    this.cityNameIdx = 0;
    this.explored = new Set();
    this.visible = new Set();
    this.ownership = new Map();        // "q,r" -> owning city
    this.wars = new Set();             // "a,b" (a<b) pairs of civs at war
    this.wonders = new Map();          // wonder id -> owning civ (one per game)
    this.wonderBuilt = null;           // {name, owner, you} on the turn one completes
    this.greatPersonBorn = null;       // {name, glyph, …} on the turn the player earns one
    this.tradeRoutes = [];             // { from, to } city pairs, for rendering
    this.deals = [];                   // active diplomatic deals (resource/gold leases)
    this.dealSeq = 1;                  // monotonic id source for deals
    this.dealOffers = [];              // pending trade offers an AI has made TO the player
    this.offerSeq = 1;                 // monotonic id source for offers
    this.income = { food: 0, prod: 0, gold: 0, science: 0 }; // player (owner 0)
    this.events = [];                  // human-readable notices from the last turn
    this.gameOver = null;              // { win, reason } once the game is decided
    this.spaceLaunched = null;         // owner id of the civ that launched the Exodus Spaceship
    this.spaceLaunchedBy = null;       // { owner, you, city } on the turn it launches, for a banner

    // Per-civ state: 0 = player, 1+ = AI. Science accrues in treasury.science as a
    // research "bank" that is spent when the current tech's cost is met.
    this.civs = [];
    for (let i = 0; i < numCivs; i++) {
      const cfg = civConfigs && civConfigs[i];
      if (cfg && cfg.color != null) OWNER_COLOR[i] = cfg.color; // recolour to the chosen civ
      this.civs.push({
        owner: i, name: (cfg && cfg.name) || CIV_NAMES[i] || `Civ ${i}`,
        id: (cfg && cfg.id) || null,   // civilization id, for unique units
        ruler: (cfg && cfg.ruler) || null, // the ruler's name+title, for portraits/diplomacy
        trait: (cfg && cfg.trait) || null,
        age: 0,                        // most advanced tech era reached
        gpp: 0, gpEarned: 0, generalTurns: 0, greatPeople: [], // Great People
        religion: null,                // { name, belief } once founded

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

    // Barbarians: a neutral hostile faction outside the civs list. Always at war
    // with everyone; raids out of camps scattered in the wilds.
    this.barbOwner = 99; // well above any civ index so it never collides
    OWNER_COLOR[this.barbOwner] = 0x6e4a36;
    this.barbCamps = [];
  }

  isBarb(owner) { return owner === this.barbOwner; }

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
    for (const c of this.barbCamps) c.mesh.visible = this.explored.has(key(c.q, c.r));
    this.updateBorders();
    this.updateDistricts();
    this.updateWonders();
    this.updateTradeView();
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

  // A golden spire over every city that holds a world wonder (fog-aware).
  updateWonders() {
    const entries = [];
    for (const c of this.cities) {
      if (!c.wonders || c.wonders.size === 0) continue;
      if (c.owner !== 0 && !this.explored.has(key(c.q, c.r))) continue;
      entries.push({ q: c.q, r: c.r, count: c.wonders.size });
    }
    if (this.view.showWonders) this.view.showWonders(entries);
  }

  // --- player actions -------------------------------------------------------
  // Domain-aware movement: naval units travel on water; land units travel on
  // land and, with Sailing researched, may embark onto water.
  _moveOpts(unit) {
    if (unit.def.domain === 'sea') return { enter: (t) => isWater(t), cost: () => 1 };
    const civ = this.civs[unit.owner]; // barbarians (no civ) never embark
    const canSail = !!civ && civ.research.researched.has('sailing');
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
    this._maybeClearCamp(unit); // razed a camp by moving onto it?
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
    this._recomputeTrade();
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
      if (isRanged) { this.fx.projectile(attacker.mesh.position, defender.mesh.position, OWNER_COLOR[attacker.owner], attacker.def.volley || 1); attacker.attack && attacker.attack(); }
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
    if (defender.hp <= 0) {
      let bonus = '';
      if (defender.route) bonus = ` Plundered +${this._plunderCaravan(attacker, defender)} gold!`;
      this._removeUnit(defender);
      msg = `${defender.def.name} destroyed!${bonus}`;
    }
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
      if (range > 1 && d > 1) { this.fx.projectile(unit.mesh.position, city.mesh.position, OWNER_COLOR[unit.owner], unit.def.volley || 1); unit.attack && unit.attack(); }
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
    this._recomputeTrade();
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
    if (unit.route) { this.tradeRoutes = this.tradeRoutes.filter(r => r !== unit.route); unit.route = null; this._recomputeTrade(); }
    this.units = this.units.filter(u => u !== unit);
    if (this.fx) this.fx.death(unit.mesh); // play a death animation, then dispose
    else this.scene.remove(unit.mesh);
  }

  // --- diplomacy ------------------------------------------------------------
  _warKey(a, b) { return a < b ? `${a},${b}` : `${b},${a}`; }
  atWar(a, b) {
    if (a === b) return false;
    if (a === this.barbOwner || b === this.barbOwner) return true; // barbarians fight all
    return this.wars.has(this._warKey(a, b));
  }
  isCivAlive(owner) { return this.cities.some(c => c.owner === owner) || this.units.some(u => u.owner === owner); }

  declareWar(a, b) {
    if (a === b || this.atWar(a, b)) return;
    this.wars.add(this._warKey(a, b));
    this._cancelDealsBetween(a, b); // trade dies with the peace
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

  // --- diplomatic deals (resource / gold trade) -----------------------------
  // A deal moves goods between two nations at peace. Each side may stake a gold
  // lump, gold-per-turn, a science lump, and resource leases. `term` is how many
  // turns the per-turn streams and resource leases run (0 = an instant lump-only
  // swap). Shape:
  //   { id, a, b, term, turnsLeft,
  //     give: { gold, goldPerTurn, science, res:[ids] },   // a -> b
  //     take: { gold, goldPerTurn, science, res:[ids] } }  // b -> a

  // Distinct resource ids a civ holds on its own territory, with a count each.
  civResources(owner) {
    const counts = {};
    for (const c of this.cities) {
      if (c.owner !== owner || !c.tiles) continue;
      for (const k of c.tiles) {
        const t = this.tiles.get(k);
        if (t && t.resource) counts[t.resource] = (counts[t.resource] || 0) + 1;
      }
    }
    return counts;
  }

  // How many copies of `res` a civ can still lease out — owned tiles minus copies
  // already promised away in active deals.
  _resAvailable(owner, res) {
    const owned = this.civResources(owner)[res] || 0;
    let leasedOut = 0;
    for (const d of this.deals) {
      if (d.a === owner) leasedOut += d.give.res.filter(r => r === res).length;
      if (d.b === owner) leasedOut += d.take.res.filter(r => r === res).length;
    }
    return owned - leasedOut;
  }

  // The set of resource TYPES a civ has access to: any type it still controls a
  // copy of, plus any type leased in from a partner. Access (not raw count) is
  // what grants the empire-wide `trade` bonus, once per type.
  resourceAccess(owner) {
    const access = new Set();
    const counts = this.civResources(owner);
    for (const id in counts) if (this._resAvailable(owner, id) > 0) access.add(id);
    for (const d of this.deals) {
      if (d.a === owner) d.take.res.forEach(r => access.add(r)); // a leases in `take`
      if (d.b === owner) d.give.res.forEach(r => access.add(r)); // b leases in `give`
    }
    return access;
  }

  // Empire-wide gold/science from the resource types a civ has access to.
  resourceIncome(owner) {
    const out = { gold: 0, science: 0 };
    for (const id of this.resourceAccess(owner)) {
      const tr = RESOURCES[id]?.trade;
      if (tr) { out.gold += tr.gold || 0; out.science += tr.science || 0; }
    }
    return out;
  }

  // Per-turn gold a deal pays `owner` (negative = owner pays out). Resource
  // leases are NOT counted here — their worth shows up via resourceIncome.
  _dealFlow(owner) {
    let gold = 0;
    for (const d of this.deals) {
      if (d.a === owner) gold += d.take.goldPerTurn - d.give.goldPerTurn;
      else if (d.b === owner) gold += d.give.goldPerTurn - d.take.goldPerTurn;
    }
    return gold;
  }

  // Gold-equivalent worth of a resource type's empire bonus.
  _resWorth(id) { const tr = RESOURCES[id]?.trade; return tr ? (tr.gold || 0) + (tr.science || 0) * 1.2 : 0; }

  // Net per-turn gold-equivalent value of a deal to `owner`, plus the up-front
  // lump. Positive `perTurn` means owner profits each turn. A leased-in resource
  // is only worth something if owner lacks the type; leasing one OUT only costs
  // owner if it is their last accessible copy (a duplicate is free to rent out).
  dealValue(deal, owner) {
    const incoming = owner === deal.b ? deal.give : deal.take; // what owner receives
    const outgoing = owner === deal.b ? deal.take : deal.give; // what owner gives
    const access = this.resourceAccess(owner);
    let inRes = 0;
    for (const id of incoming.res) if (!access.has(id)) inRes += this._resWorth(id);
    let outRes = 0;
    for (const id of outgoing.res) if (this._resAvailable(owner, id) <= 1) outRes += this._resWorth(id);
    const perTurn = (incoming.goldPerTurn + inRes) - (outgoing.goldPerTurn + outRes);
    const lump = (incoming.gold + incoming.science * 1.2) - (outgoing.gold + outgoing.science * 1.2);
    return { perTurn, lump, total: lump + perTurn * (deal.term || 0) };
  }

  // Would `owner` (either party) want this deal? It must profit clearly, not
  // bleed per turn, and be able to cover any up-front gold it owes.
  _wantsDeal(deal, owner) {
    if (this.atWar(deal.a, deal.b)) return false;
    const owesLump = owner === deal.a ? deal.give.gold : deal.take.gold;
    if (this.civs[owner].treasury.gold < owesLump) return false;
    const v = this.dealValue(deal, owner);
    return v.total >= 12 && v.perTurn >= -1;
  }

  // Would the AI civ on the receiving end (deal.b) accept this proposal?
  aiWouldAccept(deal) { return this._wantsDeal(deal, deal.b); }

  // Normalise a loosely-built basket so every field exists.
  _basket(b) {
    return { gold: Math.max(0, Math.floor(b?.gold || 0)), goldPerTurn: Math.max(0, Math.floor(b?.goldPerTurn || 0)),
      science: Math.max(0, Math.floor(b?.science || 0)), res: Array.isArray(b?.res) ? b.res.slice() : [] };
  }

  // Validate, settle the lumps, and (if it runs over time) register the deal.
  // Returns { ok, deal?, msg? }. `a` proposes; `b` is the partner.
  proposeDeal(a, b, give, take, term) {
    if (a === b || this.atWar(a, b) || !this.isCivAlive(b)) return { ok: false, msg: 'No deal possible.' };
    give = this._basket(give); take = this._basket(take); term = Math.max(0, Math.floor(term || 0));
    // The proposer must actually own the resources & gold it offers.
    for (const id of give.res) if (this._resAvailable(a, id) <= 0) return { ok: false, msg: `You have no spare ${RESOURCES[id]?.name || id}.` };
    for (const id of take.res) if (this._resAvailable(b, id) <= 0) return { ok: false, msg: `They have no spare ${RESOURCES[id]?.name || id}.` };
    if (this.civs[a].treasury.gold < give.gold) return { ok: false, msg: 'You cannot afford that.' };
    if ((give.res.length || take.res.length || give.goldPerTurn || take.goldPerTurn) && term <= 0)
      return { ok: false, msg: 'Resource and per-turn deals need a term.' };
    const deal = { id: this.dealSeq++, a, b, term, turnsLeft: term, give, take };
    // Settle up-front lumps immediately.
    this.civs[a].treasury.gold += take.gold - give.gold;
    this.civs[b].treasury.gold += give.gold - take.gold;
    this.civs[a].treasury.science += take.science - give.science;
    this.civs[b].treasury.science += give.science - take.science;
    if (term > 0) this.deals.push(deal); // streams & leases persist
    return { ok: true, deal };
  }

  _cancelDealsBetween(a, b) {
    this.deals = this.deals.filter(d => !((d.a === a && d.b === b) || (d.a === b && d.b === a)));
    this.dealOffers = this.dealOffers.filter(o => !((o.a === a && o.b === b) || (o.a === b && o.b === a)));
  }

  // End a running deal early (either party may walk away).
  cancelDeal(id) {
    const d = this.deals.find(x => x.id === id);
    if (!d) return false;
    this.deals = this.deals.filter(x => x.id !== id);
    if (d.a === 0 || d.b === 0) {
      const other = d.a === 0 ? d.b : d.a;
      this.events.push(`Trade deal with ${this.civs[other].name} ended`);
    }
    return true;
  }

  // Pay out per-turn streams and age every deal. A party that cannot cover what
  // it owes defaults and the deal collapses. Called once per turn.
  _processDeals() {
    const live = [];
    for (const d of this.deals) {
      const aPays = d.give.goldPerTurn, bPays = d.take.goldPerTurn;
      if (this.civs[d.a].treasury.gold < aPays || this.civs[d.b].treasury.gold < bPays) {
        if (d.a === 0 || d.b === 0) {
          const other = d.a === 0 ? d.b : d.a;
          this.events.push(`Trade deal with ${this.civs[other].name} defaulted`);
        }
        continue; // dropped
      }
      this.civs[d.a].treasury.gold += bPays - aPays;
      this.civs[d.b].treasury.gold += aPays - bPays;
      d.turnsLeft--;
      if (d.turnsLeft > 0) live.push(d);
      else if (d.a === 0 || d.b === 0) {
        const other = d.a === 0 ? d.b : d.a;
        this.events.push(`Trade deal with ${this.civs[other].name} expired`);
      }
    }
    this.deals = live;
  }

  // --- AI-initiated trade ----------------------------------------------------
  // Build the "buyer leases a resource type it lacks for gold-per-turn" deal:
  // `buyer` pays `seller` for access to `res`. Priced so both sides profit when
  // the seller has a spare (duplicate) copy to rent out.
  _resLeaseDeal(buyer, seller, res, term = 20) {
    const worth = this._resWorth(res);
    const price = Math.max(1, Math.floor(worth * 0.6)); // buyer keeps ~40% of the value
    return { a: buyer, b: seller, term, turnsLeft: term,
      give: this._basket({ goldPerTurn: price }), take: this._basket({ res: [res] }) };
  }

  // Find a resource `seller` can spare that `buyer` lacks (prefer duplicates so
  // renting it out costs the seller no access). Returns the resource id or null.
  _tradableResource(buyer, seller) {
    const have = this.resourceAccess(buyer);
    let fallback = null;
    for (const id of TRADEABLE) {
      if (have.has(id)) continue;
      const spare = this._resAvailable(seller, id);
      if (spare >= 2) return id;            // duplicate — free for the seller to rent
      if (spare >= 1 && fallback == null) fallback = id;
    }
    return fallback;
  }

  // AI ↔ AI: once in a while an AI buys a resource type it lacks from a peer,
  // auto-executed when the price profits both sides. Player deals go through the
  // offer system instead (the player always chooses).
  _aiTryTrade(owner) {
    if ((this.turn + owner) % 4 !== 0) return;
    for (let other = 1; other < this.civs.length; other++) {
      if (other === owner || this.atWar(owner, other) || !this.isCivAlive(other)) continue;
      const res = this._tradableResource(owner, other);
      if (!res) continue;
      const deal = this._resLeaseDeal(owner, other, res);
      if (this._wantsDeal(deal, owner) && this._wantsDeal(deal, other)) {
        this.proposeDeal(owner, other, deal.give, deal.take, deal.term);
        return; // one trade per cadence keeps it measured
      }
    }
  }

  // AI → player: queue a standing offer the player can accept or decline. The AI
  // either sells the player a type it lacks, or buys a spare type from the
  // player — whichever the AI can make profitable for itself.
  _aiOfferToPlayer(owner) {
    if ((this.turn + owner) % 6 !== 0 || this.atWar(owner, 0) || !this.isCivAlive(0)) return;
    if (this.dealOffers.some(o => o.a === owner)) return; // one pending offer per AI
    let deal = null;
    const sell = this._tradableResource(0, owner); // player lacks it, AI can spare it
    if (sell) deal = this._resLeaseDeal(0, owner, sell); // player buys: a=0 pays, b=owner sells
    else {
      const buy = this._tradableResource(owner, 0); // AI lacks it, player can spare it
      if (buy) deal = this._resLeaseDeal(owner, 0, buy); // AI buys: a=owner pays, b=0 sells
    }
    if (!deal) return;
    // Only bother the player if the AI itself profits (its motivation) and the
    // player at least breaks even (a credible offer worth showing).
    if (!this._wantsDeal(deal, owner)) return;
    const v = this.dealValue(deal, 0);
    if (v.total < 0) return;
    const offer = { id: this.offerSeq++, a: deal.a, b: deal.b, term: deal.term, turnsLeft: 8, give: deal.give, take: deal.take, from: owner };
    this.dealOffers.push(offer);
    this.events.push(`${this.civs[owner].name} proposes a trade`);
  }

  // Player accepts a standing AI offer: settle it like any proposed deal.
  acceptOffer(id) {
    const o = this.dealOffers.find(x => x.id === id);
    if (!o) return { ok: false, msg: 'Offer gone.' };
    this.dealOffers = this.dealOffers.filter(x => x.id !== id);
    return this.proposeDeal(o.a, o.b, o.give, o.take, o.term);
  }

  declineOffer(id) { this.dealOffers = this.dealOffers.filter(x => x.id !== id); }

  // Age out offers the player ignored.
  _expireOffers() {
    this.dealOffers = this.dealOffers.filter(o => --o.turnsLeft > 0);
  }

  // --- barbarians -----------------------------------------------------------
  addBarbCamp(q, r) {
    const mesh = buildBarbCampMesh();
    const top = this.view.topOf(q, r);
    if (top) mesh.position.set(top.x, top.y, top.z);
    this.scene.add(mesh);
    this.barbCamps.push({ q, r, mesh });
  }

  _freeLandNeighbor(q, r) {
    for (const n of neighbors(q, r)) {
      const t = this.tiles.get(key(n.q, n.r));
      if (t && t.passable && t.terrain !== 'MOUNTAIN' && !this.unitAt(n.q, n.r) && !this.cityAt(n.q, n.r)) return n;
    }
    return null;
  }

  // Moving a non-barbarian unit onto a camp tile razes it for a gold reward.
  _maybeClearCamp(unit) {
    if (unit.owner === this.barbOwner) return;
    const i = this.barbCamps.findIndex(c => c.q === unit.q && c.r === unit.r);
    if (i < 0) return;
    this.scene.remove(this.barbCamps[i].mesh);
    this.barbCamps.splice(i, 1);
    this.civs[unit.owner].treasury.gold += 50;
    if (unit.owner === 0) this.events.push('Barbarian camp cleared! +50 gold');
  }

  // Clear any camp now standing under a non-barbarian unit (catches AI captures).
  _sweepCamps() {
    for (let i = this.barbCamps.length - 1; i >= 0; i--) {
      const c = this.barbCamps[i];
      const u = this.unitAt(c.q, c.r);
      if (u && u.owner !== this.barbOwner) this._maybeClearCamp(u);
    }
  }

  // Camps spawn raiders (throttled & capped); raiders hunt the nearest non-barb.
  _runBarbarians() {
    const barb = this.barbOwner;
    const cap = 1 + this.barbCamps.length;
    for (const camp of this.barbCamps) {
      const guarded = this.units.some(u => u.owner === barb && u.q === camp.q && u.r === camp.r);
      const count = this.units.filter(u => u.owner === barb).length;
      if (!guarded && count < cap && (this.turn + camp.q * 7 + camp.r * 13) % 3 === 0) {
        const here = this.tiles.get(key(camp.q, camp.r));
        const spot = (here && here.passable && !this.unitAt(camp.q, camp.r)) ? { q: camp.q, r: camp.r } : this._freeLandNeighbor(camp.q, camp.r);
        if (spot) this.spawnUnit(this.turn > 35 ? 'swordsman' : 'warrior', barb, spot.q, spot.r);
      }
    }
    for (const u of this.units.filter(u => u.owner === barb)) {
      u.move = u.def.move;
      const range = u.def.range || 1;
      const foe = this.units.filter(e => e.owner !== barb).sort((a, b) => distance(u, a) - distance(u, b))
        .find(e => distance(u, e) >= 1 && distance(u, e) <= range);
      if (foe) { this.resolveCombat(u, foe, range > 1); continue; }
      const city = this.cities.find(c => !this.unitAt(c.q, c.r) && distance(u, c) >= 1 && distance(u, c) <= range);
      if (city) { this.attackCity(u, city); continue; }
      const targets = [...this.units.filter(t => t.owner !== barb), ...this.cities];
      if (!targets.length) continue;
      targets.sort((a, b) => distance(u, a) - distance(u, b));
      const dest = targets[0];
      const opts = this._moveOpts(u);
      const reach = reachable(this.tiles, u, u.move, this.occupied(u), opts);
      const options = [...reach.keys()];
      if (!options.length) continue;
      let pick = options[0], bestD = Infinity;
      for (const k of options) { const [q, r] = k.split(',').map(Number); const d = distance({ q, r }, dest); if (d < bestD) { bestD = d; pick = k; } }
      const [q, r] = pick.split(',').map(Number);
      const path = findPath(this.tiles, u, { q, r }, this.occupied(u), opts);
      if (path) u.enqueuePath(path, this.view);
    }
  }

  // --- civics: governments & policies ---------------------------------------
  // Aggregate a civ's active modifiers from its government plus adopted policies.
  civMods(owner) {
    const mods = { foodMul: 1, prodMul: 1, goldMul: 1, sciMul: 1, combat: 0, settlerDiscount: 1, militaryDiscount: 1 };
    if (owner === this.barbOwner) { mods.combat = Math.floor(this.turn / 40); return mods; } // barbs toughen over time
    const civ = this.civs[owner];
    const merge = (eff) => {
      if (!eff) return;
      for (const k in eff) {
        if (k === 'combat') mods.combat += eff[k];
        else if (k.endsWith('Mul') || k.endsWith('Discount')) mods[k] *= eff[k];
        else mods[k] = eff[k];
      }
    };
    merge(civ.trait?.effect);
    if (civ.religion) merge(BELIEFS.find(b => b.id === civ.religion.belief)?.effect);
    merge(GOVERNMENTS[civ.government]?.bonus);
    for (const id of civ.policies) merge(POLICIES[id]?.effect);
    for (const [wid, wowner] of this.wonders) if (wowner === owner) merge(WONDERS[wid]?.effect);
    if (civ.generalTurns > 0) mods.combat += 2; // Great General aura
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
    for (const [tk, id] of city.districts) { // flat district yields + adjacency
      const dy = DISTRICTS[id]?.yield;
      if (dy) for (const k in dy) out[k] = (out[k] || 0) + dy[k];
      const adj = this.districtAdjacency(city, tk, id);
      for (const k in adj) out[k] = (out[k] || 0) + adj[k];
    }
    if (city.tradeGold) out.gold += city.tradeGold;       // gold from trade routes
    if (city.tradeScience) out.science += city.tradeScience; // foreign routes bring knowledge
    return out;
  }

  // A district's adjacency bonus from its neighbouring tiles: Campus loves
  // mountains, the Commercial Hub rivers, the Industrial Zone hills/resources,
  // and the Theater Square clustering with other districts.
  districtAdjacency(city, tileKey, districtId) {
    const [q, r] = tileKey.split(',').map(Number);
    const b = { food: 0, prod: 0, gold: 0, science: 0, culture: 0 };
    for (const n of neighbors(q, r)) {
      const t = this.tiles.get(key(n.q, n.r));
      if (!t) continue;
      if (districtId === 'campus' && t.terrain === 'MOUNTAIN') b.science += 1;
      else if (districtId === 'commercial' && t.river) b.gold += 1;
      else if (districtId === 'industrial' && (t.terrain === 'HILLS' || t.terrain === 'MOUNTAIN' || t.resource)) b.prod += 1;
      else if (districtId === 'theater' && city.districts.has(key(n.q, n.r))) b.culture += 1;
    }
    return b;
  }

  // Aggregate yields for a civ (used by the HUD for the player).
  computeIncome(owner = 0) {
    const inc = { food: 0, prod: 0, gold: 0, science: 0, culture: 0 };
    for (const c of this.cities) {
      if (c.owner !== owner) continue;
      const y = this.cityYields(c);
      inc.food += y.food; inc.prod += y.prod; inc.gold += y.gold; inc.science += y.science; inc.culture += y.culture;
    }
    const ri = this.resourceIncome(owner); // empire bonus from connected resources
    inc.gold += ri.gold + this._dealFlow(owner); // + net per-turn from trade deals
    inc.science += ri.science;
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
      if (def.needsReligion && !civ.religion) continue;                   // needs a founded faith
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
    for (const id of unlockedWonders(researched, new Set(this.wonders.keys()))) {
      if (WONDERS[id].coastal && city && !this.isCoastal(city)) continue;
      items.push({ kind: 'wonder', id, name: WONDERS[id].name, cost: WONDERS[id].cost, desc: WONDERS[id].desc, glyph: WONDERS[id].glyph });
    }
    // The Space Race finale, once Rocketry is in and nobody has launched yet.
    if (researched.has(SPACESHIP.requires) && this.spaceLaunched == null) {
      items.push({ kind: 'project', id: SPACESHIP.id, name: SPACESHIP.name, cost: SPACESHIP.cost, desc: SPACESHIP.desc, glyph: SPACESHIP.glyph });
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
    if (item.kind === 'wonder') {
      if (this.wonders.has(item.id)) { // another civ finished it first — refund half
        this.civs[city.owner].treasury.gold += Math.round(WONDERS[item.id].cost * 0.5);
        if (city.owner === 0) this.events.push(`${WONDERS[item.id].name} was completed elsewhere — production refunded`);
        return;
      }
      this.wonders.set(item.id, city.owner);
      city.wonders.add(item.id);
      this.wonderBuilt = { name: WONDERS[item.id].name, glyph: WONDERS[item.id].glyph, owner: city.owner, you: city.owner === 0, city: city.name };
      this.events.push(`${city.owner === 0 ? 'You' : this.civs[city.owner].name} completed ${WONDERS[item.id].name}!`);
      return;
    }
    if (item.kind === 'project') {
      if (item.id === SPACESHIP.id && this.spaceLaunched == null) {
        this.spaceLaunched = city.owner;
        this.spaceLaunchedBy = { owner: city.owner, you: city.owner === 0, city: city.name };
        this.events.push(`${city.owner === 0 ? 'You' : this.civs[city.owner].name} launched the Exodus Spaceship!`);
      }
      return;
    }
    if (item.kind === 'district') {
      if (item.tile && city.tiles.has(item.tile)) city.districts.set(item.tile, item.id);
      if (city.owner === 0) this.events.push(`${DISTRICTS[item.id].name} built in ${city.name}`);
    } else if (item.kind === 'building') {
      city.buildings.add(item.id);
      if (city.owner === 0) this.events.push(`${BUILDINGS[item.id].name} built in ${city.name}`);
    } else {
      const spot = this._spawnSpot(city, UNIT_TYPES[item.id]);
      const u = this.spawnUnit(item.id, city.owner, spot.q, spot.r);
      if (UNIT_TYPES[item.id].canTrade) u.home = { q: city.q, r: city.r }; // Trader remembers its origin
      if (city.owner === 0) this.events.push(`${UNIT_TYPES[item.id].name} trained in ${city.name}`);
    }
  }

  // Pour this turn's production into the queue, completing affordable items.
  _processProduction(city) {
    city.production += this.cityYields(city).prod;
    while (city.queue.length) {
      const item = city.queue[0];
      if (item.kind === 'wonder' && this.wonders.has(item.id)) { // claimed elsewhere — drop it
        city.queue.shift();
        this.civs[city.owner].treasury.gold += Math.round(WONDERS[item.id].cost * 0.25);
        if (city.owner === 0) this.events.push(`${WONDERS[item.id].name} was claimed by another civ`);
        continue;
      }
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
    if (!availableGovernments(this.civs[owner].civics.researched).includes(govId)) return;
    this.civs[owner].government = govId;
    this.setPolicies(owner, this.civs[owner].policies); // re-fit cards to the new slots
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
    const ri = this.resourceIncome(owner); // empire-wide bonus from connected resources
    const rmul = owner === 0 ? 1 : this._diff.mul;
    civ.treasury.gold += ri.gold * rmul;
    civ.treasury.science += ri.science * rmul;
    this._processResearch(civ);
    this._processCivics(civ);
    this._advanceAge(owner);
    this._processGreatPeople(owner);
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
      units: this.units.map(u => ({ type: u.type, owner: u.owner, q: u.q, r: u.r, hp: u.hp, move: u.move, embarked: !!u.embarked, home: u.home, spreads: u.spreads,
        route: u.route ? { from: [u.route.from.q, u.route.from.r], to: [u.route.to.q, u.route.to.r] } : undefined, legTo: u.legTo })),
      cities: this.cities.map(c => ({ owner: c.owner, q: c.q, r: c.r, name: c.name, population: c.population, food: c.food, production: c.production, hp: c.hp, tiles: [...(c.tiles || [])], districts: [...c.districts], wonders: [...c.wonders], religion: c.religion, borderProgress: c.borderProgress, queue: c.queue, buildings: [...c.buildings] })),
      civs: this.civs.map((v, i) => ({
        name: v.name, id: v.id, ruler: v.ruler, trait: v.trait, age: v.age, color: OWNER_COLOR[i],
        gpp: v.gpp, gpEarned: v.gpEarned, generalTurns: v.generalTurns, greatPeople: [...(v.greatPeople || [])],
        religion: v.religion,
        treasury: { ...v.treasury },
        research: { researched: [...v.research.researched], queue: [...v.research.queue] },
        civics: { researched: [...v.civics.researched], queue: [...v.civics.queue] },
        government: v.government,
        policies: [...v.policies],
      })),
      wars: [...this.wars],
      wonders: [...this.wonders],
      tradeRoutes: this.tradeRoutes.map(r => ({ from: [r.from.q, r.from.r], to: [r.to.q, r.to.r], gold: r.gold, science: r.science, owner: r.owner })),
      deals: this.deals.map(d => ({ id: d.id, a: d.a, b: d.b, term: d.term, turnsLeft: d.turnsLeft, give: { ...d.give, res: [...d.give.res] }, take: { ...d.take, res: [...d.take.res] } })),
      dealSeq: this.dealSeq,
      dealOffers: this.dealOffers.map(o => ({ id: o.id, a: o.a, b: o.b, term: o.term, turnsLeft: o.turnsLeft, from: o.from, give: { ...o.give, res: [...o.give.res] }, take: { ...o.take, res: [...o.take.res] } })),
      offerSeq: this.offerSeq,
      barbCamps: this.barbCamps.map(c => ({ q: c.q, r: c.r })),
      year: this.year,
      age: this.age,
      difficulty: this.difficulty,
      turnLimit: this.turnLimit,
      gameOver: this.gameOver,
      spaceLaunched: this.spaceLaunched,
    };
  }

  // Rebuild entities from a snapshot (the world must already be generated from
  // the same seed). Replaces any current units/cities.
  restore(data) {
    for (const u of this.units) this.scene.remove(u.mesh);
    for (const c of this.cities) this.scene.remove(c.mesh);
    for (const c of this.barbCamps) this.scene.remove(c.mesh);
    this.units = []; this.cities = []; this.barbCamps = [];
    this.turn = data.turn;
    this.year = data.year ?? -4000;
    this.age = data.age || 0;
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
      city.wonders = new Set(cd.wonders || []);
      city.religion = cd.religion || null;
      city.borderProgress = cd.borderProgress || 0;
      city.placeAt(this.view);
      this.scene.add(city.mesh);
      this.cities.push(city);
    }
    for (const ud of data.units) {
      const u = this.spawnUnit(ud.type, ud.owner, ud.q, ud.r);
      u.hp = ud.hp; u.move = ud.move; u.setEmbarked(!!ud.embarked); if (ud.home) u.home = ud.home;
      if (ud.spreads != null) u.spreads = ud.spreads;
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
      if (cd.ruler) v.ruler = cd.ruler;
      if ('trait' in cd) v.trait = cd.trait;
      v.age = cd.age || 0;
      v.gpp = cd.gpp || 0; v.gpEarned = cd.gpEarned || 0; v.generalTurns = cd.generalTurns || 0; v.greatPeople = cd.greatPeople || [];
      v.religion = cd.religion || null;
    });
    this.treasury = this.civs[0].treasury;
    this.wars = new Set(data.wars || []);
    this.wonders = new Map(data.wonders || []);
    this.tradeRoutes = (data.tradeRoutes || []).map(r => {
      const from = this.cities.find(c => c.q === r.from[0] && c.r === r.from[1]);
      const to = this.cities.find(c => c.q === r.to[0] && c.r === r.to[1]);
      return from && to ? { from, to, gold: r.gold, science: r.science, owner: r.owner } : null;
    }).filter(Boolean);
    this.deals = (data.deals || []).map(d => ({ id: d.id, a: d.a, b: d.b, term: d.term, turnsLeft: d.turnsLeft,
      give: this._basket(d.give), take: this._basket(d.take) }));
    this.dealSeq = data.dealSeq || (this.deals.reduce((m, d) => Math.max(m, d.id), 0) + 1);
    this.dealOffers = (data.dealOffers || []).map(o => ({ id: o.id, a: o.a, b: o.b, term: o.term, turnsLeft: o.turnsLeft, from: o.from,
      give: this._basket(o.give), take: this._basket(o.take) }));
    this.offerSeq = data.offerSeq || (this.dealOffers.reduce((m, o) => Math.max(m, o.id), 0) + 1);
    // Re-link each caravan to the route object it runs (units restored in order).
    data.units.forEach((ud, i) => {
      const u = this.units[i];
      if (u && ud.route) {
        u.route = this.tradeRoutes.find(r => r.from.q === ud.route.from[0] && r.from.r === ud.route.from[1] && r.to.q === ud.route.to[0] && r.to.r === ud.route.to[1]) || null;
        u.legTo = ud.legTo || 'to';
      }
    });
    for (const cd of (data.barbCamps || [])) this.addBarbCamp(cd.q, cd.r);
    this.difficulty = data.difficulty || 'normal';
    this._diff = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
    this.turnLimit = data.turnLimit || null;
    this.gameOver = data.gameOver || null;
    this.spaceLaunched = data.spaceLaunched ?? null;
    this.recomputeOwnership();
    this._recomputeTrade();
    this.income = this.computeIncome(0);
    this.recomputeFog();
  }

  // Decide the game on a space-race launch, a wipe-out, or a turn-limit score.
  _checkGameOver() {
    if (this.gameOver) return;
    const alive = (owner) => this.cities.some(c => c.owner === owner) || this.units.some(u => u.owner === owner);
    // Science/space victory: the first civ to launch the Exodus Spaceship wins.
    if (this.spaceLaunched != null) {
      this.gameOver = this.spaceLaunched === 0
        ? { win: true, reason: 'Space Race won — your colony ship reaches the stars!' }
        : { win: false, reason: `${this.civs[this.spaceLaunched].name} won the Space Race.` };
      return;
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

  // Civs ranked by score, with the headline stats for the standings panel.
  standings() {
    const rows = this.civs.map((c, o) => ({
      owner: o, name: c.name, id: c.id, alive: this.isCivAlive(o),
      score: this._score(o),
      cities: this.cities.filter(x => x.owner === o).length,
      tech: c.research.researched.size,
      wonders: [...this.wonders.values()].filter(w => w === o).length,
      greatPeople: (c.greatPeople || []).length,
      age: ERAS[c.age] || ERAS[0],
    }));
    rows.sort((a, b) => b.score - a.score);
    return rows;
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
  ageName() { return ERAS[this.age] || ERAS[ERAS.length - 1]; }
  yearLabel() { return this.year < 0 ? `${-this.year} BC` : `AD ${this.year}`; }

  // How many of the current age's techs the player has, for the HUD indicator.
  eraProgress() {
    let done = 0, total = 0;
    for (const [id, t] of Object.entries(TECHS)) if (t.era === this.age) { total++; if (this.civs[0].research.researched.has(id)) done++; }
    return { done, total };
  }

  // Promote a civ to a new age when it researches a tech of a higher era, and
  // grant a one-time era bonus (scaled by age) to its treasury.
  _advanceAge(owner) {
    const civ = this.civs[owner];
    let era = 0;
    for (const id of civ.research.researched) era = Math.max(era, TECHS[id]?.era ?? 0);
    if (era <= (civ.age || 0)) return;
    civ.age = era;
    const bonus = { gold: era * 50, science: era * 40, culture: era * 20 };
    civ.treasury.gold += bonus.gold;
    civ.treasury.science += bonus.science;
    civ.treasury.culture += bonus.culture;
    if (owner === 0) { this.age = era; this.ageAdvanced = this.ageName(); this.ageBonus = bonus; this.events.push(`A new age dawns: the ${this.ageName()} Era`); }
  }

  // --- great people ---------------------------------------------------------
  _processGreatPeople(owner) {
    const civ = this.civs[owner];
    if (civ.generalTurns > 0) civ.generalTurns--;
    const myCities = this.cities.filter(c => c.owner === owner);
    if (!myCities.length) return;
    const pop = myCities.reduce((s, c) => s + c.population, 0);
    civ.gpp = (civ.gpp || 0) + 2 + myCities.length + Math.floor(pop / 4);
    if (owner === 0) return; // the player picks their Great Person (recruitGreatPerson)
    const cost = gppCost(civ.gpEarned || 0);
    if (civ.gpp >= cost) {
      civ.gpp -= cost;
      const gp = GREAT_PEOPLE[(civ.gpEarned || 0) % GREAT_PEOPLE.length];
      civ.gpEarned = (civ.gpEarned || 0) + 1;
      (civ.greatPeople ||= []).push(gp.id);
      this._applyGreatPerson(owner, gp);
    }
  }

  // The player has enough points to recruit; they choose which one.
  gpReady() { const c = this.civs[0]; return (c.gpp || 0) >= gppCost(c.gpEarned || 0); }
  recruitGreatPerson(gpId) {
    const civ = this.civs[0];
    const cost = gppCost(civ.gpEarned || 0);
    if ((civ.gpp || 0) < cost) return false;
    const gp = GREAT_PEOPLE.find(g => g.id === gpId);
    if (!gp) return false;
    civ.gpp -= cost;
    civ.gpEarned = (civ.gpEarned || 0) + 1;
    (civ.greatPeople ||= []).push(gp.id);
    this._applyGreatPerson(0, gp);
    this.greatPersonBorn = gp;
    return true;
  }

  _applyGreatPerson(owner, gp) {
    const civ = this.civs[owner];
    const scale = 1 + (civ.age || 0) * 0.4;
    const e = gp.effect;
    if (e.science) civ.treasury.science += Math.round(e.science * scale);
    if (e.gold) civ.treasury.gold += Math.round(e.gold * scale);
    if (e.culture) civ.treasury.culture += Math.round(e.culture * scale);
    if (e.production) for (const c of this.cities) if (c.owner === owner) c.production += Math.round(e.production * scale);
    if (e.combatTurns) civ.generalTurns = e.combatTurns;
  }

  // --- religion -------------------------------------------------------------
  // A civ may found one religion once it has a place of worship (a Monument or
  // Amphitheater somewhere).
  canFoundReligion(owner) {
    return !this.civs[owner].religion &&
      this.cities.some(c => c.owner === owner && (c.buildings.has('monument') || c.buildings.has('amphitheater')));
  }

  foundReligion(owner, beliefId, name) {
    const civ = this.civs[owner];
    if (civ.religion) return false;
    const belief = BELIEFS.find(b => b.id === beliefId) || BELIEFS[0];
    const used = new Set(this.civs.map(c => c.religion && c.religion.name).filter(Boolean));
    name = name || RELIGION_NAMES.find(n => !used.has(n)) || `Faith ${owner}`;
    civ.religion = { name, belief: belief.id };
    for (const c of this.cities) if (c.owner === owner) c.religion = name; // its cities convert at once
    this.events.push(`${owner === 0 ? 'You' : civ.name} founded ${name}`);
    if (owner === 0) this.religionFounded = name;
    return true;
  }

  _religionFounder(name) { return this.civs.findIndex(c => c.religion && c.religion.name === name); }

  // Per-religion tally for the UI: follower cities & population, founder civ,
  // and the belief. Sorted by reach (most follower cities first).
  religionStats() {
    const map = new Map();
    for (const c of this.cities) {
      if (!c.religion) continue;
      let e = map.get(c.religion);
      if (!e) {
        const fo = this._religionFounder(c.religion);
        e = { name: c.religion, cities: 0, pop: 0, founder: fo, belief: fo >= 0 ? this.civs[fo].religion.belief : null };
        map.set(c.religion, e);
      }
      e.cities++; e.pop += c.population;
    }
    return [...map.values()].sort((a, b) => b.cities - a.cities);
  }

  // Each turn: faith spreads to nearby unconverted cities, and foreign followers
  // pay their religion's founder a small tithe.
  _processReligion() {
    const sources = this.cities.filter(c => c.religion);
    for (const c of this.cities) {
      if (c.religion) continue;
      const near = sources.find(s => distance(s, c) <= 2);
      if (near) c.religion = near.religion;
    }
    for (const c of this.cities) {
      if (!c.religion) continue;
      const fo = this._religionFounder(c.religion);
      if (fo >= 0 && fo !== c.owner) this.civs[fo].treasury.gold += 1; // tithe from foreign followers
    }
  }

  // Cities a missionary may convert right now: on its own tile or adjacent,
  // that don't already follow the missionary's religion.
  spreadTargets(unit) {
    if (!unit.def.canSpread || (unit.spreads || 0) <= 0) return [];
    const faith = this.civs[unit.owner].religion;
    if (!faith) return [];
    return this.cities.filter(c => distance(c, unit) <= 1 && c.religion !== faith.name);
  }

  // A missionary converts a city to its founder's religion, spending one charge
  // and its move for the turn. The unit is consumed when its last charge is used.
  spreadFaith(unit, city) {
    if (!unit.def.canSpread) return { ok: false, msg: 'This unit cannot spread faith' };
    const faith = this.civs[unit.owner].religion;
    if (!faith) return { ok: false, msg: 'Found a religion first' };
    if ((unit.spreads || 0) <= 0) return { ok: false, msg: 'No conversions left' };
    if (unit.move <= 0) return { ok: false, msg: 'No moves left this turn' };
    if (!city || distance(city, unit) > 1) return { ok: false, msg: 'Move next to a city first' };
    if (city.religion === faith.name) return { ok: false, msg: `${city.name} already follows ${faith.name}` };
    const converted = !!city.religion;
    city.religion = faith.name;
    unit.spreads -= 1;
    unit.move = 0;
    this.events.push(unit.owner === 0
      ? `${city.name} ${converted ? 'converted to' : 'embraced'} ${faith.name}`
      : `${this.civs[unit.owner].name} spread ${faith.name} to ${city.name}`);
    let removed = false;
    if (unit.spreads <= 0) { this._removeUnit(unit); removed = true; }
    return { ok: true, removed, religion: faith.name, city };
  }

  // --- trade routes (built by Traders) --------------------------------------
  // Recompute each city's trade yield from its established routes; drop routes
  // whose cities are gone or who are now at war.
  _recomputeTrade() {
    this.tradeRoutes = this.tradeRoutes.filter(r =>
      this.cities.includes(r.from) && this.cities.includes(r.to) && !this.atWar(r.from.owner, r.to.owner));
    for (const c of this.cities) { c.tradeGold = 0; c.tradeScience = 0; }
    for (const r of this.tradeRoutes) { r.from.tradeGold += r.gold; r.from.tradeScience += (r.science || 0); }
    this.updateTradeView();
  }

  // Cities a Trader can link its home city to: any city other than home that you
  // own, or are at peace with (and — for the human player — have explored; the
  // AI knows the whole map). Reachability is checked in establishRoute.
  tradeTargets(trader) {
    const home = trader.home;
    return this.cities.filter(c => {
      if (home && c.q === home.q && c.r === home.r) return false;
      if (c.owner !== trader.owner) {
        if (this.atWar(trader.owner, c.owner)) return false;
        if (trader.owner === 0 && !this.explored.has(key(c.q, c.r))) return false;
      }
      return true;
    });
  }

  // Establish a route from the Trader's home city to `target`. The Trader is NOT
  // consumed: it becomes a caravan that shuttles between the two cities, and the
  // route's yield lasts as long as that caravan lives. The route must be
  // traversable overland/by sea from the home city.
  establishRoute(trader, target) {
    const home = this.cities.find(c => trader.home && c.q === trader.home.q && c.r === trader.home.r);
    if (!home) return { ok: false, msg: 'Home city is gone' };
    if (target === home) return { ok: false, msg: 'Pick a different city' };
    if (target.owner !== trader.owner) {
      if (this.atWar(trader.owner, target.owner)) return { ok: false, msg: 'Cannot trade with an enemy' };
      if (trader.owner === 0 && !this.explored.has(key(target.q, target.r))) return { ok: false, msg: 'Cannot trade there' };
    }
    if (this.tradeRoutes.some(r => r.from === home && r.to === target)) return { ok: false, msg: 'Route already exists' };
    // A caravan has to be able to physically reach the target city.
    if (!findPath(this.tiles, home, target, new Set(), this._moveOpts(trader))) return { ok: false, msg: 'No route to that city' };
    const foreign = target.owner !== trader.owner;
    const gold = (foreign ? 4 : 2) + Math.floor(target.population / 2) + Math.floor(distance(home, target) / 4) + (home.buildings.has('market') ? 2 : 0);
    const science = foreign ? 2 : 0;
    const route = { from: home, to: target, gold, science, owner: trader.owner };
    this.tradeRoutes.push(route);
    trader.route = route;
    trader.legTo = 'to'; // head out toward the target first
    this._recomputeTrade();
    if (trader.owner === 0) this.events.push(`Trade route to ${target.name}: +${gold} gold${science ? ` +${science} science` : ''}`);
    return { ok: true, msg: `Caravan now trading with ${target.name}` };
  }

  // Raiding a caravan hands its killer a one-time gold haul scaled by the value
  // of the route it was running. Returns the amount looted.
  _plunderCaravan(attacker, caravan) {
    const r = caravan.route;
    const gold = Math.round(15 + (r ? r.gold + (r.science || 0) : 0) * 4);
    const civ = this.civs[attacker.owner]; // barbarians have no treasury — they just burn it
    if (civ) civ.treasury.gold += gold;
    if (caravan.owner === 0 && attacker.owner !== 0) this.events.push(`Your caravan was plundered! ${civ ? civ.name : 'Barbarians'} seized ${gold} gold`);
    return gold;
  }

  // Disband a caravan's route, turning it back into a free Trader.
  endRoute(unit) {
    if (!unit.route) return;
    this.tradeRoutes = this.tradeRoutes.filter(r => r !== unit.route);
    unit.route = null; unit.legTo = null;
    this._recomputeTrade();
  }

  // Move every caravan one leg of its route. Caravans shuttle between their two
  // cities forever; a route whose cities are gone or now at war dissolves (its
  // caravan reverts to a free Trader).
  _runCaravans() {
    for (const u of this.units) {
      if (!u.route) continue;
      const rt = u.route;
      if (!this.cities.includes(rt.from) || !this.cities.includes(rt.to) || this.atWar(rt.from.owner, rt.to.owner)) {
        this.endRoute(u);
        continue;
      }
      let dest = u.legTo === 'from' ? rt.from : rt.to;
      // A foreign city tile can't be entered, so adjacency counts as arrival —
      // turn around for the return leg.
      if (distance(u, dest) <= 1) {
        u.legTo = u.legTo === 'from' ? 'to' : 'from';
        dest = u.legTo === 'from' ? rt.from : rt.to;
      }
      u.move = u.def.move;
      const opts = this._moveOpts(u);
      const reach = reachable(this.tiles, u, u.move, this.occupied(u), opts);
      let pick = null, bestD = Infinity;
      for (const k of reach.keys()) {
        const [q, r] = k.split(',').map(Number);
        const d = distance({ q, r }, dest);
        if (d < bestD) { bestD = d; pick = k; }
      }
      if (pick) {
        const [q, r] = pick.split(',').map(Number);
        const path = findPath(this.tiles, u, { q, r }, this.occupied(u), opts);
        if (path) {
          u.enqueuePath(path, this.view);
          if (u.def.domain !== 'sea') u.setEmbarked(isWater(this.tiles.get(key(u.q, u.r))));
        }
      }
      u.move = 0;
    }
  }

  updateTradeView() {
    if (!this.view.showTradeRoutes) return;
    const ex = (c) => c.owner === 0 || this.explored.has(key(c.q, c.r));
    this.view.showTradeRoutes(this.tradeRoutes.filter(r => ex(r.from) && ex(r.to)).map(r => ({ from: r.from, to: r.to })));
  }

  endTurn() {
    this.events = [];
    this.ageAdvanced = null;
    this.ageBonus = null;
    this.wonderBuilt = null;
    this.greatPersonBorn = null;
    this.religionFounded = null;
    this._recomputeTrade();
    this._runAI();
    this._runBarbarians();
    this._runCaravans();
    this._sweepCamps();

    for (let o = 1; o < this.civs.length; o++) this._processEconomy(o); // AI economies
    this._processEconomy(0); // player economy
    this._processReligion();
    this._processDeals(); // pay out trade-deal streams, age & expire deals
    this._expireOffers(); // drop AI offers the player let sit
    this.income = this.computeIncome(0);

    this.turn++;
    // Advance the calendar (faster as history accelerates). Ages advance per-civ
    // in _processEconomy.
    this.year += AGE_YEAR_STEP[this.age] || AGE_YEAR_STEP[AGE_YEAR_STEP.length - 1];

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

    // Found a religion once it has a place of worship.
    if (this.canFoundReligion(owner)) this.foundReligion(owner, BELIEFS[(owner + this.turn) % BELIEFS.length].id);

    // Diplomacy: pick fights it can win, sue for peace when outmatched.
    this._aiDiplomacy(owner);
    // Trade: deal with peer AIs directly, and float an offer to the player.
    this._aiTryTrade(owner);
    this._aiOfferToPlayer(owner);

    // Production: defend threatened cities first, then expand, build, and arm.
    const myCities = this.cities.filter(c => c.owner === owner);
    const mySettlers = this.units.filter(u => u.owner === owner && u.def.canFound).length;
    const myMissionaries = this.units.filter(u => u.owner === owner && u.def.canSpread).length;
    // Worth proselytising only if some foreign city doesn't already follow us.
    const faithToSpread = civ.religion && this.cities.some(c => c.owner !== owner && c.religion !== civ.religion.name);
    for (const c of myCities) {
      if (c.queue.length) continue;
      const opts = this.buildOptions(owner, c);
      const building = opts.find(o => o.kind === 'building' && !c.buildings.has(o.id));
      const district = opts.find(o => o.kind === 'district');
      const wonder = opts.find(o => o.kind === 'wonder' && !c.queue.some(i => i.kind === 'wonder'));
      const threatened = this.units.some(e => e.owner !== owner && distance(e, c) <= 5);
      const defended = this.units.some(u => u.owner === owner && u.def.attack && !u.def.canFound && distance(u, c) <= 3);
      if (threatened && !defended) {
        if (civ.research.researched.has('masonry') && !c.buildings.has('walls')) c.queue.push(this._aiItem('building', 'walls'));
        else c.queue.push(this._aiItem('unit', this._aiBestUnit(owner)));
      } else if (civ.research.researched.has(SPACESHIP.requires) && this.spaceLaunched == null
                 && !this.cities.some(cc => cc.owner === owner && cc.queue.some(i => i.kind === 'project'))) {
        c.queue.push({ kind: 'project', id: SPACESHIP.id, name: SPACESHIP.name, cost: SPACESHIP.cost }); // race for space
      } else if (myCities.length < 3 && mySettlers === 0) {
        c.queue.push(this._aiItem('unit', 'settler'));
      } else if (faithToSpread && myMissionaries < 1 && (this.turn + c.q) % 4 === 0) {
        c.queue.push(this._aiItem('unit', 'missionary')); // send out a missionary now and then
      } else if (wonder && (this.turn + c.q) % 2 === 0) { // sometimes chase a wonder
        c.queue.push({ kind: 'wonder', id: wonder.id, name: wonder.name, cost: wonder.cost });
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
      if (u.route) continue; // caravans are driven by _runCaravans

      // A Trader sets up a route to the richest reachable city, then becomes a caravan.
      if (u.def.canTrade) {
        if (!u.home) { const h = this.cities.filter(c => c.owner === owner).sort((a, b) => distance(u, a) - distance(u, b))[0]; if (h) u.home = { q: h.q, r: h.r }; }
        for (const t of this.tradeTargets(u).sort((a, b) => b.population - a.population)) if (this.establishRoute(u, t).ok) break;
        if (u.route) continue;
      }

      if (u.def.canFound) {
        const tile = this.tiles.get(key(u.q, u.r));
        const crowded = this.cities.some(c => distance(c, u) < 3);
        if (tile && tile.passable && !crowded && !this.cityAt(u.q, u.r)) { this.foundCity(u); continue; }
      }

      // A Missionary converts an adjacent foreign city, else walks to the
      // nearest one that doesn't yet follow our faith.
      if (u.def.canSpread) {
        const faith = civ.religion;
        if (faith) {
          const adjacent = this.spreadTargets(u).filter(c => c.owner !== owner);
          if (adjacent.length) { this.spreadFaith(u, adjacent.sort((a, b) => distance(u, a) - distance(u, b))[0]); continue; }
          const goal = this.cities.filter(c => c.owner !== owner && c.religion !== faith.name).sort((a, b) => distance(u, a) - distance(u, b))[0];
          if (goal) {
            const opts = this._moveOpts(u);
            const reach = reachable(this.tiles, u, u.move, this.occupied(u), opts);
            let pick = null, bestD = Infinity;
            for (const k of reach.keys()) { const [q, r] = k.split(',').map(Number); const d = distance({ q, r }, goal); if (d < bestD) { bestD = d; pick = k; } }
            if (pick) { const [q, r] = pick.split(',').map(Number); const path = findPath(this.tiles, u, { q, r }, this.occupied(u), opts); if (path) u.enqueuePath(path, this.view); }
          }
        }
        continue;
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
