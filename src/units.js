// units.js — units and cities: their low-poly 3D meshes plus per-frame
// movement animation. Game rules (turns, movement budget) live in game.js.
import * as THREE from 'three';
import { key } from './hex.js';

export const OWNER_COLOR = [0x3a78d0, 0xd04545]; // 0 = player, 1 = AI

// Unit archetypes. `move` is movement points per turn; `sight` is fog reveal
// radius; `cost` is production points to build one in a city.
export const UNIT_TYPES = {
  settler: { name: 'Settler', move: 2, sight: 2, hp: 10, cost: 30, canFound: true,  build: 'body' },
  warrior: { name: 'Warrior', move: 2, sight: 2, hp: 20, cost: 20, attack: 6,      build: 'soldier' },
  scout:   { name: 'Scout',   move: 4, sight: 3, hp: 10, cost: 16, attack: 2,      build: 'scout' },
};

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
    this.mesh = this._build();
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
