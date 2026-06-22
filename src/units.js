// units.js — units and cities: their low-poly 3D meshes plus per-frame
// movement animation. Game rules (turns, movement budget) live in game.js.
import * as THREE from 'three';
import { key } from './hex.js';

export const OWNER_COLOR = [0x3a78d0, 0xd04545]; // 0 = player, 1 = AI

// Unit archetypes. `move` is movement points per turn; `sight` is fog reveal
// radius; `cost` is production points to build one in a city; `range` (if > 1)
// makes the unit attack from a distance without taking a counterattack;
// `requires` (if set) is the tech id that must be researched to build it.
export const UNIT_TYPES = {
  settler:    { name: 'Settler',     move: 2, sight: 2, hp: 10, cost: 30, canFound: true, build: 'body' },
  warrior:    { name: 'Warrior',     move: 2, sight: 2, hp: 20, cost: 20, attack: 6,                build: 'soldier' },
  scout:      { name: 'Scout',       move: 4, sight: 3, hp: 10, cost: 16, attack: 2,                build: 'scout' },
  archer:     { name: 'Archer',      move: 2, sight: 2, hp: 14, cost: 24, attack: 5, range: 2,      build: 'archer' },
  // Tech-gated units.
  horseman:   { name: 'Horseman',    move: 4, sight: 2, hp: 18, cost: 26, attack: 7,                requires: 'animal_husbandry', build: 'horseman' },
  swordsman:  { name: 'Swordsman',   move: 2, sight: 2, hp: 30, cost: 32, attack: 11,               requires: 'iron_working',     build: 'soldier' },
  catapult:   { name: 'Catapult',    move: 1, sight: 2, hp: 16, cost: 38, attack: 12, range: 2,     requires: 'the_wheel',        build: 'siege' },
  crossbow:   { name: 'Crossbowman', move: 2, sight: 2, hp: 20, cost: 34, attack: 9,  range: 2,     requires: 'machinery',        build: 'archer' },
  musketman:  { name: 'Musketman',   move: 2, sight: 2, hp: 40, cost: 46, attack: 15,               requires: 'gunpowder',        build: 'soldier' },
  artillery:  { name: 'Artillery',   move: 1, sight: 2, hp: 22, cost: 50, attack: 18, range: 3,     requires: 'steel',            build: 'siege' },
  tank:       { name: 'Tank',        move: 3, sight: 3, hp: 60, cost: 72, attack: 24,               requires: 'combustion',       build: 'tank' },
  airplane:   { name: 'Airplane',    move: 6, sight: 4, hp: 30, cost: 64, attack: 18, range: 3,     requires: 'flight',           build: 'plane' },
  // Naval units (domain 'sea') — built only in coastal cities, move on water.
  galley:     { name: 'Galley',      move: 4, sight: 3, hp: 24, cost: 30, attack: 8,                requires: 'sailing',  domain: 'sea', build: 'ship' },
  frigate:    { name: 'Frigate',     move: 5, sight: 3, hp: 34, cost: 50, attack: 16, range: 2,     requires: 'gunpowder', domain: 'sea', build: 'ship' },
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
    this.waypoints = [];           // queued world positions for animation
    this.embarked = false;         // a land unit currently at sea
    this.mesh = this._build();
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
    } else { // settler — a little wagon
      const cart = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), mat);
      cart.position.y = 0.4; g.add(cart);
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8, 1, false, 0, Math.PI), trim);
      cover.rotation.z = Math.PI / 2; cover.position.y = 0.58; g.add(cover);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
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

  update(dt) {
    if (!this.waypoints.length) return;
    const target = this.waypoints[0];
    const pos = this.mesh.position;
    const dir = target.clone().sub(pos);
    const dist = dir.length();
    const step = 6 * dt;
    if (dist <= step || dist < 1e-3) {
      pos.copy(target);
      this.waypoints.shift();
    } else {
      dir.multiplyScalar(step / dist);
      pos.add(dir);
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }
  }
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
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshStandardMaterial({ color: OWNER_COLOR[this.owner], side: THREE.DoubleSide }));
    flag.position.set(0.15, 0.9, 0); g.add(flag);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  placeAt(worldView) {
    const top = worldView.topOf(this.q, this.r);
    this.mesh.position.set(top.x, top.y, top.z);
  }
}
