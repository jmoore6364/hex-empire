// units.js — units and cities: their low-poly 3D meshes plus per-frame
// movement animation. Game rules (turns, movement budget) live in game.js.
import * as THREE from 'three';
import { key } from './hex.js';
import { hasModel, makeModel } from './models.js';

// 0 = player (blue); 1+ = AI civs (crimson, verdant, amber, violet).
export const OWNER_COLOR = [0x3a78d0, 0xd04545, 0x39a86b, 0xd49a2e, 0x9b59b6];

// Unit archetypes. `move` is movement points per turn; `sight` is fog reveal
// radius; `cost` is production points to build one in a city; `range` (if > 1)
// makes the unit attack from a distance without taking a counterattack;
// `requires` (if set) is the tech id that must be researched to build it.
export const UNIT_TYPES = {
  settler:    { name: 'Settler',     move: 2, sight: 2, hp: 10, cost: 30, canFound: true, build: 'body' },
  trader:     { name: 'Trader',      move: 3, sight: 2, hp: 8,  cost: 24, canTrade: true, build: 'body' },
  // Religious support unit: convert cities to your faith. Only buildable once
  // you have founded a religion (`needsReligion`); carries `spreads` charges.
  missionary: { name: 'Missionary',  move: 3, sight: 2, hp: 8,  cost: 30, canSpread: true, spreads: 2, needsReligion: true, build: 'missionary' },
  warrior:    { name: 'Warrior',     move: 2, sight: 2, hp: 20, cost: 20, attack: 6,                build: 'soldier', model: 'robot' },
  scout:      { name: 'Scout',       move: 4, sight: 3, hp: 10, cost: 16, attack: 2,                build: 'scout',   model: 'robot' },
  archer:     { name: 'Archer',      move: 2, sight: 2, hp: 14, cost: 24, attack: 5, range: 2,      build: 'archer', model: 'archer', volley: 3 },
  // Tech-gated units.
  horseman:   { name: 'Horseman',    move: 4, sight: 2, hp: 18, cost: 26, attack: 7,                requires: 'animal_husbandry', build: 'horseman' },
  swordsman:  { name: 'Swordsman',   move: 2, sight: 2, hp: 30, cost: 32, attack: 11,               requires: 'iron_working',     build: 'soldier', model: 'robot' },
  catapult:   { name: 'Catapult',    move: 1, sight: 2, hp: 16, cost: 38, attack: 12, range: 2,     requires: 'the_wheel',        build: 'siege' },
  crossbow:   { name: 'Crossbowman', move: 2, sight: 2, hp: 20, cost: 34, attack: 9,  range: 2,     requires: 'machinery',        build: 'archer' },
  musketman:  { name: 'Musketman',   move: 2, sight: 2, hp: 40, cost: 46, attack: 15,               requires: 'gunpowder',        build: 'soldier', model: 'robot' },
  artillery:  { name: 'Artillery',   move: 1, sight: 2, hp: 22, cost: 50, attack: 18, range: 3,     requires: 'steel',            build: 'siege' },
  tank:       { name: 'Tank',        move: 3, sight: 3, hp: 60, cost: 72, attack: 24,               requires: 'combustion',       build: 'tank' },
  airplane:   { name: 'Airplane',    move: 6, sight: 4, hp: 30, cost: 64, attack: 18, range: 3,     requires: 'flight',           build: 'plane' },
  // Deeper land/air units from the expanded tech tree (each has its own mesh).
  spearman:   { name: 'Spearman',    move: 2, sight: 2, hp: 24, cost: 22, attack: 8,                requires: 'bronze',           build: 'spearman' },
  knight:     { name: 'Knight',      move: 4, sight: 2, hp: 30, cost: 36, attack: 14,               requires: 'chivalry',         build: 'knight' },
  cannon:     { name: 'Cannon',      move: 1, sight: 2, hp: 22, cost: 46, attack: 17, range: 2,     requires: 'metallurgy',       build: 'cannon' },
  rifleman:   { name: 'Rifleman',    move: 2, sight: 2, hp: 48, cost: 52, attack: 20,               requires: 'rifling',          build: 'rifleman' },
  infantry:   { name: 'Infantry',    move: 2, sight: 2, hp: 60, cost: 66, attack: 28,               requires: 'plastics',         build: 'infantry' },
  modern_armor:{ name: 'Modern Armor', move: 4, sight: 3, hp: 90, cost: 98, attack: 38,             requires: 'computers',        build: 'modern_armor' },
  bomber:     { name: 'Bomber',      move: 7, sight: 4, hp: 40, cost: 78, attack: 28, range: 3,     requires: 'radio',            build: 'bomber' },
  jet_fighter:{ name: 'Jet Fighter', move: 9, sight: 5, hp: 50, cost: 94, attack: 34, range: 3,     requires: 'rocketry',         build: 'jet' },

  // Naval units (domain 'sea') — built only in coastal cities, move on water.
  galley:     { name: 'Galley',      move: 4, sight: 3, hp: 24, cost: 30, attack: 8,                requires: 'sailing',  domain: 'sea', build: 'ship' },
  frigate:    { name: 'Frigate',     move: 5, sight: 3, hp: 34, cost: 50, attack: 16, range: 2,     requires: 'gunpowder', domain: 'sea', build: 'ship' },
  destroyer:  { name: 'Destroyer',   move: 6, sight: 4, hp: 44, cost: 58, attack: 22, range: 2,     requires: 'navigation', domain: 'sea', build: 'destroyer' },
  battleship: { name: 'Battleship',  move: 5, sight: 4, hp: 64, cost: 86, attack: 32, range: 3,     requires: 'ballistics', domain: 'sea', build: 'battleship' },

  // Civilization-unique units (`onlyCiv`): a buffed variant only that civ can
  // build, replacing/upgrading a base unit for its play-style.
  berserker:  { name: 'Berserker',   move: 2, sight: 2, hp: 26, cost: 22, attack: 10,              onlyCiv: 'crimson', build: 'soldier', model: 'robot' },
  longship:   { name: 'Longship',    move: 5, sight: 3, hp: 32, cost: 28, attack: 11,              onlyCiv: 'azure', requires: 'sailing', domain: 'sea', build: 'ship' },
  ranger:     { name: 'Ranger',      move: 4, sight: 3, hp: 18, cost: 22, attack: 6, range: 2,     onlyCiv: 'verdant', build: 'archer' },
  mercenary:  { name: 'Mercenary',   move: 2, sight: 2, hp: 32, cost: 28, attack: 12,              onlyCiv: 'amber', requires: 'iron_working', build: 'soldier', model: 'robot' },
  arbalest:   { name: 'Arbalest',    move: 2, sight: 2, hp: 22, cost: 32, attack: 11, range: 2,    onlyCiv: 'violet', requires: 'machinery', build: 'archer' },
  bombard:    { name: 'Bombard',     move: 1, sight: 2, hp: 20, cost: 36, attack: 15, range: 2,    onlyCiv: 'onyx', requires: 'the_wheel', build: 'siege' },
  pikeman:    { name: 'Pikeman',     move: 2, sight: 2, hp: 34, cost: 28, attack: 11,              onlyCiv: 'jade', requires: 'bronze', build: 'soldier', model: 'robot' },
  hussar:     { name: 'Hussar',      move: 4, sight: 2, hp: 22, cost: 26, attack: 9,               onlyCiv: 'rose', requires: 'animal_husbandry', build: 'horseman' },
  templar:    { name: 'Templar',     move: 2, sight: 2, hp: 32, cost: 30, attack: 13,              onlyCiv: 'indigo', requires: 'iron_working', build: 'soldier', model: 'robot' },
  phalanx:    { name: 'Phalanx',     move: 2, sight: 2, hp: 36, cost: 30, attack: 10,              onlyCiv: 'ember', requires: 'bronze', build: 'soldier', model: 'robot' },
  ballista:   { name: 'Ballista',    move: 1, sight: 2, hp: 18, cost: 34, attack: 14, range: 2,    onlyCiv: 'bronze', requires: 'the_wheel', build: 'siege' },
  slinger:    { name: 'Slinger',     move: 3, sight: 2, hp: 14, cost: 18, attack: 5, range: 2,     onlyCiv: 'lime', build: 'archer' },
};

// Shared boat hull shown under a land unit while it's embarked at sea.
const BOAT_GEO = new THREE.BoxGeometry(0.6, 0.16, 0.32);
const BOAT_MAT = new THREE.MeshStandardMaterial({ color: 0x6b4f2a, flatShading: true, roughness: 0.8 });

let nextId = 1;

export class Unit {
  constructor(type, owner, q, r) {
    this.id = nextId++;
    this.type = type;
    this.def = UNIT_TYPES[type];
    this.owner = owner;
    this.q = q; this.r = r;
    this.move = this.def.move;
    this.hp = this.def.hp;
    this.sight = this.def.sight;
    this.spreads = this.def.spreads || 0;   // remaining faith-conversions (missionary)
    this.waypoints = [];           // queued world positions for animation
    this.embarked = false;         // a land unit currently at sea
    this.mixer = null;             // animation mixer when using a GLTF model
    this._anim = 'idle';
    this.mesh = hasModel(this.def.model) ? this._buildModel() : this._build();
    // Land units carry a hidden boat hull, shown when they embark.
    if (this.def.domain !== 'sea') {
      this.boat = new THREE.Mesh(BOAT_GEO, BOAT_MAT);
      this.boat.position.y = 0.12;
      this.boat.visible = false;
      this.boat.castShadow = true;
      this.mesh.add(this.boat);
    }
  }

  // Toggle the embarked (at-sea) state and its boat hull.
  setEmbarked(on) {
    this.embarked = on;
    if (this.boat) this.boat.visible = on;
  }

  _build() {
    const g = new THREE.Group();
    const color = OWNER_COLOR[this.owner];
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, metalness: 0.1 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, flatShading: true });

    if (this.def.build === 'soldier') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.55, 6), mat);
      body.position.y = 0.45; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), trim);
      head.position.y = 0.82; g.add(head);
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), trim);
      spear.position.set(0.22, 0.6, 0); g.add(spear);
    } else if (this.def.build === 'scout') {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 6), mat);
      body.position.y = 0.45; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), trim);
      head.position.y = 0.8; g.add(head);
    } else if (this.def.build === 'archer') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 6), mat);
      body.position.y = 0.42; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), trim);
      head.position.y = 0.76; g.add(head);
      // a curved bow held to the side
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 8, Math.PI), trim);
      bow.position.set(-0.2, 0.5, 0); bow.rotation.z = -Math.PI / 2; g.add(bow);
    } else if (this.def.build === 'horseman') {
      const horse = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.22), mat);
      horse.position.y = 0.5; g.add(horse);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), mat);
      neck.position.set(0.26, 0.66, 0); g.add(neck);
      const rider = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.34, 6), trim);
      rider.position.set(-0.04, 0.84, 0); g.add(rider);
      for (const sx of [-0.18, 0.18]) for (const sz of [-0.08, 0.08]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 4), mat);
        leg.position.set(sx, 0.2, sz); g.add(leg);
      }
    } else if (this.def.build === 'siege') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.4), trim);
      base.position.y = 0.34; g.add(base);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.6, 8), mat);
      barrel.rotation.z = Math.PI / 3; barrel.position.set(0.08, 0.62, 0); g.add(barrel);
      for (const sx of [-0.18, 0.18]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10), mat);
        w.rotation.x = Math.PI / 2; w.position.set(sx, 0.22, 0); g.add(w);
      }
    } else if (this.def.build === 'tank') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.24, 0.4), mat);
      hull.position.y = 0.36; g.add(hull);
      const turret = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.3), mat);
      turret.position.y = 0.56; g.add(turret);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), trim);
      barrel.rotation.z = Math.PI / 2; barrel.position.set(0.36, 0.56, 0); g.add(barrel);
      for (const sz of [-0.22, 0.22]) {
        const tread = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.1), trim);
        tread.position.set(0, 0.24, sz); g.add(tread);
      }
    } else if (this.def.build === 'plane') {
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.7, 8), trim);
      fus.rotation.z = Math.PI / 2; fus.position.y = 0.75; g.add(fus);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.82), mat);
      wing.position.y = 0.75; g.add(wing);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.04), mat);
      tail.position.set(-0.32, 0.84, 0); g.add(tail);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 8), mat);
      nose.rotation.z = -Math.PI / 2; nose.position.set(0.42, 0.75, 0); g.add(nose);
    } else if (this.def.build === 'ship') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.34), new THREE.MeshStandardMaterial({ color: 0x6b4f2a, flatShading: true, roughness: 0.8 }));
      hull.position.y = 0.2; g.add(hull);
      const prow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 4), hull.material);
      prow.rotation.z = -Math.PI / 2; prow.position.set(0.46, 0.2, 0); g.add(prow);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), trim);
      mast.position.set(0, 0.6, 0); g.add(mast);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.4), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true }));
      sail.position.set(0, 0.62, 0); g.add(sail);
    } else if (this.def.build === 'spearman') {
      // foot soldier with a tall spear and a round shield
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.52, 6), mat);
      body.position.y = 0.44; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), trim);
      head.position.y = 0.78; g.add(head);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 4), trim);
      shaft.position.set(0.22, 0.6, 0); g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), trim);
      tip.position.set(0.22, 1.18, 0); g.add(tip);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12), mat);
      shield.rotation.z = Math.PI / 2; shield.position.set(0.02, 0.5, -0.18); g.add(shield);
    } else if (this.def.build === 'knight') {
      // armoured horse (grey barding) + rider in owner colour with a couched lance
      const barding = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, flatShading: true, roughness: 0.7 });
      const horse = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.24), barding);
      horse.position.y = 0.5; g.add(horse);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.16), barding);
      neck.position.set(0.28, 0.68, 0); g.add(neck);
      const hhead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.14), barding);
      hhead.position.set(0.4, 0.78, 0); g.add(hhead);
      for (const sx of [-0.18, 0.2]) for (const sz of [-0.09, 0.09]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 4), barding);
        leg.position.set(sx, 0.2, sz); g.add(leg);
      }
      const rider = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.36, 6), mat);
      rider.position.set(-0.02, 0.86, 0); g.add(rider);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat);
      helm.position.set(-0.02, 1.08, 0); g.add(helm);
      const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 5), trim);
      lance.rotation.z = Math.PI / 2; lance.position.set(0.34, 0.92, 0.14); g.add(lance);
      const pennant = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true }));
      pennant.position.set(0.72, 1.0, 0.14); g.add(pennant);
    } else if (this.def.build === 'cannon') {
      // wheeled gun carriage with a long iron barrel
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b4f2a, flatShading: true, roughness: 0.85 });
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), wood);
      carriage.position.y = 0.26; g.add(carriage);
      for (const sz of [-0.2, 0.2]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), wood);
        w.rotation.x = Math.PI / 2; w.position.set(-0.04, 0.22, sz); g.add(w);
      }
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.72, 12), mat);
      barrel.rotation.z = Math.PI / 2 - 0.18; barrel.position.set(0.08, 0.42, 0); g.add(barrel);
      const cascabel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat);
      cascabel.position.set(-0.26, 0.36, 0); g.add(cascabel);
    } else if (this.def.build === 'rifleman') {
      // line infantryman shouldering a rifle
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 6), mat);
      body.position.y = 0.42; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), trim);
      head.position.y = 0.74; g.add(head);
      const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 4), trim);
      rifle.rotation.z = Math.PI / 2; rifle.position.set(0.18, 0.52, 0.12); g.add(rifle);
    } else if (this.def.build === 'infantry') {
      // modern soldier: wide helmet and a slung rifle
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.5, 6), mat);
      body.position.y = 0.42; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), trim);
      head.position.y = 0.72; g.add(head);
      const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10), mat);
      helm.position.y = 0.8; g.add(helm);
      const rifle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.52, 4), trim);
      rifle.rotation.z = Math.PI / 2 - 0.5; rifle.position.set(0.16, 0.5, 0.12); g.add(rifle);
    } else if (this.def.build === 'modern_armor') {
      // big main battle tank: sloped glacis, long gun, side skirts
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.24, 0.5), mat);
      hull.position.y = 0.34; g.add(hull);
      const glacis = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.5), mat);
      glacis.rotation.z = -Math.PI / 5; glacis.position.set(0.42, 0.34, 0); g.add(glacis);
      const turret = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.38), mat);
      turret.position.y = 0.58; g.add(turret);
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.72, 8), trim);
      gun.rotation.z = Math.PI / 2; gun.position.set(0.52, 0.6, 0.04); g.add(gun);
      const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), trim);
      aerial.position.set(-0.15, 0.78, -0.12); g.add(aerial);
      for (const sz of [-0.26, 0.26]) {
        const tread = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.16, 0.12), trim);
        tread.position.set(0, 0.22, sz); g.add(tread);
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.03), mat);
        skirt.position.set(0, 0.34, sz + (sz > 0 ? -0.07 : 0.07)); g.add(skirt);
      }
    } else if (this.def.build === 'bomber') {
      // large aircraft: long fuselage, wide wing, twin underslung engines
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.95, 8), trim);
      fus.rotation.z = Math.PI / 2; fus.position.y = 0.85; g.add(fus);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), trim);
      nose.position.set(0.48, 0.85, 0); g.add(nose);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 1.2), mat);
      wing.position.y = 0.85; g.add(wing);
      for (const sz of [-0.34, 0.34]) {
        const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8), mat);
        eng.rotation.z = Math.PI / 2; eng.position.set(0.06, 0.78, sz); g.add(eng);
      }
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.05), mat);
      tail.position.set(-0.42, 0.96, 0); g.add(tail);
      const tailplane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.5), mat);
      tailplane.position.set(-0.42, 0.86, 0); g.add(tailplane);
    } else if (this.def.build === 'jet') {
      // sleek jet: pointed nose, swept delta wings, tail fin, afterburner nozzle
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.9, 8), mat);
      fus.rotation.z = Math.PI / 2; fus.position.y = 0.85; g.add(fus);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 8), trim);
      nose.rotation.z = -Math.PI / 2; nose.position.set(0.6, 0.85, 0); g.add(nose);
      for (const sz of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.34), mat);
        wing.position.set(-0.05, 0.84, sz * 0.22); wing.rotation.y = sz * 0.5; g.add(wing);
      }
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.03), mat);
      fin.position.set(-0.34, 0.98, 0); g.add(fin);
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.12, 8), trim);
      noz.rotation.z = Math.PI / 2; noz.position.set(-0.48, 0.85, 0); g.add(noz);
    } else if (this.def.build === 'destroyer') {
      // grey steel warship: superstructure, funnel, fore & aft gun turrets, no sail
      const steel = new THREE.MeshStandardMaterial({ color: 0x5f666e, flatShading: true, roughness: 0.7, metalness: 0.2 });
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.2, 0.32), steel);
      hull.position.y = 0.2; g.add(hull);
      const prow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 4), steel);
      prow.rotation.z = -Math.PI / 2; prow.position.set(0.56, 0.2, 0); g.add(prow);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.22), mat);
      bridge.position.set(-0.02, 0.4, 0); g.add(bridge);
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 8), steel);
      funnel.position.set(-0.2, 0.42, 0); g.add(funnel);
      for (const tx of [0.34, -0.36]) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 8), steel);
        base.position.set(tx, 0.33, 0); g.add(base);
        const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), trim);
        gun.rotation.z = Math.PI / 2; gun.position.set(tx + 0.18, 0.36, 0); g.add(gun);
      }
    } else if (this.def.build === 'battleship') {
      // large warship: tall superstructure, two funnels, three twin-barrel turrets
      const steel = new THREE.MeshStandardMaterial({ color: 0x4f565e, flatShading: true, roughness: 0.7, metalness: 0.25 });
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.24, 0.4), steel);
      hull.position.y = 0.22; g.add(hull);
      const prow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 4), steel);
      prow.rotation.z = -Math.PI / 2; prow.position.set(0.66, 0.22, 0); g.add(prow);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.26), mat);
      tower.position.set(-0.02, 0.5, 0); g.add(tower);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), steel);
      mast.position.set(-0.02, 0.78, 0); g.add(mast);
      for (const fx of [-0.22, -0.36]) {
        const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 8), steel);
        funnel.position.set(fx, 0.45, 0); g.add(funnel);
      }
      for (const tx of [0.42, 0.2, -0.5]) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 8), steel);
        base.position.set(tx, 0.36, 0); g.add(base);
        for (const bz of [-0.05, 0.05]) {
          const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 6), trim);
          gun.rotation.z = Math.PI / 2; gun.position.set(tx + 0.22, 0.39, bz); g.add(gun);
        }
      }
    } else if (this.def.build === 'missionary') {
      // a robed preacher in pale vestments with an owner-colour hood and a
      // tall staff topped by a glowing relic
      const robe = new THREE.MeshStandardMaterial({ color: 0xeae6dc, flatShading: true, roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.27, 0.62, 8), robe);
      body.position.y = 0.42; g.add(body);
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat);
      hood.position.y = 0.8; g.add(hood);
      const sash = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.52, 0.02), mat);
      sash.position.set(0, 0.46, 0.21); g.add(sash);
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.98, 5), trim);
      staff.position.set(0.24, 0.56, 0); g.add(staff);
      const relic = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffcf5a, emissiveIntensity: 0.85, roughness: 0.4 }));
      relic.position.set(0.24, 1.08, 0); g.add(relic);
    } else { // settler — a little wagon
      const cart = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), mat);
      cart.position.y = 0.4; g.add(cart);
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8, 1, false, 0, Math.PI), trim);
      cover.rotation.z = Math.PI / 2; cover.position.y = 0.58; g.add(cover);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // A little squad of three small rigged characters clustered on the tile, with
  // idle/walk animation (one shared mixer, staggered so they don't march in sync).
  _buildModel() {
    const g = new THREE.Group();
    this.mixer = new THREE.AnimationMixer(g);
    this.idleActions = [];
    this.walkActions = [];
    this.modelFigures = [];   // per-figure roots, for a procedural idle sway
    const proto = makeModel(this.def.model);
    const scale = proto.def.scale * 0.38;
    const find = (anims, name) => name && THREE.AnimationClip.findByName(anims, name);
    // Some models render as a single centred figure (squad:1); others as a
    // spread triangle of three on the tile (`spread` widens the triangle).
    const spr = proto.def.spread || 1;
    const spots = proto.def.squad === 1 ? [[0, 0]] : [[0, 0.3], [-0.27, -0.16], [0.27, -0.16]].map(([x, z]) => [x * spr, z * spr]);

    spots.forEach(([ox, oz], i) => {
      const m = i === 0 ? proto : makeModel(this.def.model);
      const root = m.scene;
      root.scale.setScalar(scale);
      root.position.set(ox, 0, oz);
      // squads either all face forward or fan out; faceOffset corrects a model
      // whose built-in forward axis differs from the travel-facing convention
      root.rotation.y = (proto.def.faceSame ? 0 : i * 2.2) + (proto.def.faceOffset || 0);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.frustumCulled = false;
        if (o.material) {
          o.material = o.material.clone();
          if (proto.def.flat) o.material.flatShading = true;
          // Tint the civ-coloured part ("Owner" material) to this unit's owner.
          if (proto.def.tint && o.material.name && o.material.name.startsWith('Owner')) o.material.color.setHex(OWNER_COLOR[this.owner]);
          o.material.needsUpdate = true;
        }
      });
      g.add(root);
      this.modelFigures.push({ root, phase: i * 2.1 });
      const idle = find(m.animations, m.def.idle);
      // A model exported in SCENE mode splits its walk across several clips (a
      // body-bob clip + one per leg); `walkAny` plays them ALL together as the
      // walk cycle. Otherwise use the single named walk clip.
      const walks = m.def.walkAny ? m.animations : [find(m.animations, m.def.walk)].filter(Boolean);
      if (idle) { const a = this.mixer.clipAction(idle, root); a.time = i * 0.4; a.play(); this.idleActions.push(a); }
      for (const clip of walks) { const a = this.mixer.clipAction(clip, root); a.time = i * 0.4; this.walkActions.push(a); } // staggered phase
    });

    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 16),
      new THREE.MeshStandardMaterial({ color: OWNER_COLOR[this.owner], flatShading: true, emissive: OWNER_COLOR[this.owner], emissiveIntensity: 0.3, roughness: 0.6 }));
    disc.position.y = 0.025; disc.castShadow = true; g.add(disc);
    return g;
  }

  // Snap mesh to a tile top immediately (no animation).
  placeAt(q, r, worldView) {
    this.q = q; this.r = r;
    const top = worldView.topOf(q, r);
    this.mesh.position.set(top.x, top.y, top.z);
  }

  // Queue an animated walk along a path of {q,r} steps.
  enqueuePath(path, worldView) {
    for (const step of path) {
      const top = worldView.topOf(step.q, step.r);
      if (top) this.waypoints.push(new THREE.Vector3(top.x, top.y, top.z));
    }
    if (path.length) { this.q = path[path.length - 1].q; this.r = path[path.length - 1].r; }
  }

  get isMoving() { return this.waypoints.length > 0; }

  // Trigger a quick draw-and-loose lean on a model squad (e.g. archers firing).
  attack() { if (this.modelFigures && this.modelFigures.length) { this._attackT = 0; this._attackDur = 0.42; } }

  update(dt) {
    const moving = this.waypoints.length > 0;
    if (this.mixer) {
      this.mixer.update(dt);
      const want = moving ? 'walk' : 'idle';
      if (want !== this._anim && this.idleActions && this.walkActions.length) {
        this._anim = want;
        const tos = want === 'walk' ? this.walkActions : this.idleActions;
        const froms = want === 'walk' ? this.idleActions : this.walkActions;
        tos.forEach((a) => a.reset().setEffectiveWeight(1).fadeIn(0.2).play());
        froms.forEach((a) => a.fadeOut(0.2));
      }
    }
    // Procedural idle sway for models without a baked idle clip (e.g. the
    // archer): a gentle breathing bob + lean when standing still.
    if (this.modelFigures && this.modelFigures.length && !this.idleActions.length) {
      this._clock = (this._clock || 0) + dt;
      for (const f of this.modelFigures) {
        if (moving) { f.root.position.y = 0; f.root.rotation.z = 0; }
        else {
          f.root.position.y = (Math.sin(this._clock * 2.1 + f.phase) * 0.5 + 0.5) * 0.03;
          f.root.rotation.z = Math.sin(this._clock * 1.5 + f.phase) * 0.05;
        }
      }
    }
    // A quick draw-and-loose lean when firing (overlays a backward tilt).
    if (this._attackT != null && this.modelFigures) {
      this._attackT += dt;
      const p = this._attackT / this._attackDur;
      const lean = p >= 1 ? 0 : -0.45 * Math.sin(p * Math.PI); // lean back, then settle
      for (const f of this.modelFigures) f.root.rotation.x = lean;
      if (p >= 1) this._attackT = null;
    }
    if (!moving) return;
    const target = this.waypoints[0];
    const pos = this.mesh.position;
    const dir = target.clone().sub(pos);
    const dist = dir.length();
    const step = 3 * dt;   // tile-to-tile travel speed (halved so the walk reads)
    if (dist <= step || dist < 1e-3) {
      pos.copy(target);
      this.waypoints.shift();
    } else {
      dir.multiplyScalar(step / dist);
      pos.add(dir);
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI; // face travel direction
    }
  }
}

// A barbarian camp marker: dark tents, a campfire, and a red banner.
export function buildBarbCampMesh() {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({ color: 0x5a4632, flatShading: true, roughness: 0.95 });
  for (const [x, z] of [[-0.24, 0.08], [0.24, 0.12]]) {
    const tent = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), hide);
    tent.position.set(x, 0.2, z); tent.rotation.y = Math.PI / 4; tent.castShadow = true; g.add(tent);
  }
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a18, emissiveIntensity: 0.9, roughness: 0.5 }));
  fire.position.set(0, 0.11, -0.16); g.add(fire);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0x2b2b2b }));
  pole.position.set(-0.02, 0.25, 0.3); g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.13), new THREE.MeshStandardMaterial({ color: 0x8a2b2b, side: THREE.DoubleSide }));
  flag.position.set(0.08, 0.42, 0.3); flag.castShadow = true; g.add(flag);
  return g;
}

export class City {
  constructor(owner, q, r, name) {
    this.owner = owner;
    this.q = q; this.r = r;
    this.name = name;
    this.population = 1;
    this.food = 0;
    this.production = 0;        // production points stockpiled toward queue[0]
    this.queue = [];            // build items: { kind:'unit'|'building', id, name, cost }
    this.buildings = new Set(); // constructed building ids
    this.hp = 0;                // defence; set to max when founded (see game.js)
    this.tiles = new Set();     // owned tile-keys; grows one tile at a time
    this.districts = new Map(); // tile-key -> district id placed there
    this.wonders = new Set();   // world wonders completed here
    this.religion = null;       // name of the religion this city follows
    this.borderProgress = 0;    // culture banked toward claiming the next tile
    this.ownerMats = [];        // materials recoloured when the city changes hands
    this.mesh = this._build();
  }

  _build() {
    const g = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: 0xb9a37e, flatShading: true, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: OWNER_COLOR[this.owner], flatShading: true });
    const positions = [[0, 0], [0.34, 0.1], [-0.3, 0.18], [0.12, -0.32], [-0.18, -0.22]];
    positions.forEach(([x, z], i) => {
      const h = 0.4 + (i % 3) * 0.18;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, h, 0.26), wall);
      b.position.set(x, h / 2, z); g.add(b);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 4), roof);
      cap.position.set(x, h + 0.1, z); cap.rotation.y = Math.PI / 4; g.add(cap);
    });
    const banner = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 4), wall);
    banner.position.y = 0.5; g.add(banner);
    const flagMat = new THREE.MeshStandardMaterial({ color: OWNER_COLOR[this.owner], side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), flagMat);
    flag.position.set(0.15, 0.9, 0); g.add(flag);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.ownerMats = [roof, flagMat];
    return g;
  }

  // Repaint the city's banner & roofs when it's captured.
  setOwner(owner) {
    this.owner = owner;
    for (const m of this.ownerMats) m.color.setHex(OWNER_COLOR[owner]);
  }

  placeAt(worldView) {
    const top = worldView.topOf(this.q, this.r);
    this.mesh.position.set(top.x, top.y, top.z);
  }
}
