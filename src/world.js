// world.js — turns generated tile data into 3D hex-prism meshes, and owns the
// visual state that lives on the map: fog of war and highlight overlays.
import * as THREE from 'three';
import { HEX_SIZE, hexToWorld, key } from './hex.js';
import { TERRAIN } from './worldgen.js';
import { RESOURCES } from './resources.js';

const UNEXPLORED = new THREE.Color(0x0c1018);

function tileHeight(tile) {
  if (!tile.passable && tile.terrain !== 'MOUNTAIN') return 0.45; // water sits low & flat
  return 0.45 + tile.elevation * 4.2;
}

export class WorldView {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.tileMeshes = new Map();   // "q,r" -> Mesh
    this.tops = new Map();         // "q,r" -> top-center world position
    scene.add(this.group);

    // Shared prism geometry; per-tile we only scale Y and recolor.
    this.geo = new THREE.CylinderGeometry(HEX_SIZE * 0.97, HEX_SIZE * 0.97, 1, 6);

    // Resource markers: a small floating gem over tiles that carry a resource.
    this.resGeo = new THREE.OctahedronGeometry(0.17);
    this.resourceGroup = new THREE.Group();
    scene.add(this.resourceGroup);
    this.resourceMarkers = new Map();   // "q,r" -> marker mesh

    for (const tile of world.tiles.values()) {
      const def = TERRAIN[tile.terrain];
      const h = tileHeight(tile);
      const mat = new THREE.MeshStandardMaterial({ color: def.color, flatShading: true, roughness: 0.95 });
      mat.userData.base = new THREE.Color(def.color);
      const mesh = new THREE.Mesh(this.geo, mat);
      const { x, z } = hexToWorld(tile.q, tile.r);
      mesh.position.set(x, h / 2, z);
      mesh.scale.y = h;
      mesh.userData.tile = tile;
      this.group.add(mesh);
      const k = key(tile.q, tile.r);
      this.tileMeshes.set(k, mesh);
      this.tops.set(k, new THREE.Vector3(x, h, z));

      if (tile.resource) {
        const rc = RESOURCES[tile.resource];
        const mk = new THREE.Mesh(this.resGeo, new THREE.MeshStandardMaterial({
          color: rc.color, flatShading: true, emissive: rc.color, emissiveIntensity: 0.3, roughness: 0.4,
        }));
        mk.position.set(x, h + 0.34, z);
        mk.castShadow = true;
        mk.visible = false; // revealed by fog once explored
        this.resourceGroup.add(mk);
        this.resourceMarkers.set(k, mk);
      }
    }

    this._initHighlights();
  }

  topOf(q, r) { return this.tops.get(key(q, r)); }

  // --- Fog of war -----------------------------------------------------------
  // visible: Set of "q,r" in current sight; explored: Set ever-seen.
  applyFog(visible, explored) {
    for (const [k, mesh] of this.tileMeshes) {
      const base = mesh.material.userData.base;
      if (visible.has(k)) {
        mesh.material.color.copy(base);
        mesh.material.emissive.setHex(0x000000);
      } else if (explored.has(k)) {
        mesh.material.color.copy(base).multiplyScalar(0.45); // dimmed memory
      } else {
        mesh.material.color.copy(UNEXPLORED);
      }
      const mk = this.resourceMarkers.get(k);
      if (mk) mk.visible = explored.has(k);
    }
  }

  // --- Highlight overlays ---------------------------------------------------
  _initHighlights() {
    this.hlGroup = new THREE.Group();
    this.scene.add(this.hlGroup);
    this.flatGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.86, HEX_SIZE * 0.86, 0.08, 6);
    this.pool = [];
    this.poolUsed = 0;

    // A single ring that marks the currently selected tile.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.0 });
    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(HEX_SIZE * 0.92, 0.06, 8, 6), ringMat);
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.rotation.z = Math.PI / 6;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
  }

  _takeMarker(color, opacity) {
    let m = this.pool[this.poolUsed];
    if (!m) {
      m = new THREE.Mesh(this.flatGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      this.hlGroup.add(m);
      this.pool.push(m);
    }
    m.material.color.setHex(color);
    m.material.opacity = opacity;
    m.visible = true;
    this.poolUsed++;
    return m;
  }

  clearHighlights() {
    for (const m of this.pool) m.visible = false;
    this.poolUsed = 0;
  }

  selectTile(q, r) {
    const top = this.topOf(q, r);
    if (!top) { this.selRing.visible = false; return; }
    this.selRing.position.set(top.x, top.y + 0.12, top.z);
    this.selRing.material.opacity = 0.9;
    this.selRing.visible = true;
  }

  deselect() { this.selRing.visible = false; }

  // reach: Map<"q,r", cost> of movable tiles; path: array of {q,r}.
  showReachable(reach) {
    for (const k of reach.keys()) {
      const top = this.tops.get(k);
      if (!top) continue;
      const m = this._takeMarker(0xffffff, 0.18);
      m.position.set(top.x, top.y + 0.06, top.z);
    }
  }

  showPath(path) {
    for (const step of path) {
      const top = this.topOf(step.q, step.r);
      if (!top) continue;
      const m = this._takeMarker(0xffe14a, 0.5);
      m.position.set(top.x, top.y + 0.07, top.z);
    }
  }

  // Red markers over enemies a selected unit can attack this turn.
  showTargets(list) {
    for (const t of list) {
      const top = this.topOf(t.q, t.r);
      if (!top) continue;
      const m = this._takeMarker(0xff5555, 0.6);
      m.position.set(top.x, top.y + 0.09, top.z);
    }
  }

  // --- Territory borders ----------------------------------------------------
  // Persistent (not cleared by clearHighlights) owner-colored tint over owned
  // hexes. entries: [{ q, r, color, center }]. Redrawn whenever territory shifts.
  showBorders(entries) {
    if (!this.borderGroup) {
      this.borderGroup = new THREE.Group();
      this.scene.add(this.borderGroup);
      this.borderPool = [];
    }
    let i = 0;
    for (const e of entries) {
      const top = this.topOf(e.q, e.r);
      if (!top) continue;
      let m = this.borderPool[i];
      if (!m) {
        m = new THREE.Mesh(this.flatGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
        this.borderGroup.add(m);
        this.borderPool.push(m);
      }
      m.material.color.setHex(e.color);
      m.material.opacity = e.center ? 0.32 : 0.13;
      m.position.set(top.x, top.y + 0.04, top.z);
      m.visible = true;
      i++;
    }
    for (; i < this.borderPool.length; i++) this.borderPool[i].visible = false;
  }
}
