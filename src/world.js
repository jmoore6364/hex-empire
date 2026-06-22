// world.js — turns generated tile data into 3D hex-prism meshes, and owns the
// visual state that lives on the map: fog of war and highlight overlays.
import * as THREE from 'three';
import { HEX_SIZE, hexToWorld, key } from './hex.js';
import { TERRAIN } from './worldgen.js';
import { RESOURCES } from './resources.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

const UNEXPLORED = new THREE.Color(0x0c1018);
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0); // collapses a hidden decoration
const WATER = new Set(['OCEAN', 'COAST', 'LAKE']);
const DECO_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });

// Stable per-tile pseudo-random in [0,1), so each hex gets its own subtle shade.
function hash2(q, r) { const s = Math.sin(q * 127.1 + r * 311.7) * 43758.5453; return s - Math.floor(s); }

// Tag every vertex of a geometry with a flat colour (so merged low-poly props
// keep multiple colours under one vertex-coloured material).
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

let TREE_GEO, MOUNTAIN_GEO;
function treeGeo() {
  if (TREE_GEO) return TREE_GEO;
  const trunk = paint(new THREE.CylinderGeometry(0.04, 0.06, 0.22, 5).translate(0, 0.11, 0), 0x6b4a2a);
  const l1 = paint(new THREE.ConeGeometry(0.17, 0.32, 6).translate(0, 0.34, 0), 0x2f7d3a);
  const l2 = paint(new THREE.ConeGeometry(0.12, 0.26, 6).translate(0, 0.52, 0), 0x3c9148);
  return (TREE_GEO = mergeGeometries([trunk, l1, l2]));
}
function mountainGeo() {
  if (MOUNTAIN_GEO) return MOUNTAIN_GEO;
  const base = paint(new THREE.ConeGeometry(0.74, 1.1, 6).translate(0, 0.55, 0), 0x6d6f74);
  const cap = paint(new THREE.ConeGeometry(0.3, 0.42, 6).translate(0, 1.12, 0), 0xeef3f9);
  return (MOUNTAIN_GEO = mergeGeometries([base, cap]));
}

function tileHeight(tile) {
  if (!tile.passable && tile.terrain !== 'MOUNTAIN') return 0.45; // water sits low & flat
  return 0.45 + tile.elevation * 4.2;
}

export class WorldView {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.tops = new Map();         // "q,r" -> top-center world position
    scene.add(this.group);

    // Shared prism geometry; one InstancedMesh holds every tile so even large
    // maps are a single draw call. Per-instance matrix encodes position/height;
    // per-instance colour is recoloured for fog of war.
    this.geo = new THREE.CylinderGeometry(HEX_SIZE * 0.97, HEX_SIZE * 0.97, 1, 6);

    this.resGeo = new THREE.OctahedronGeometry(0.17);
    this.resourceGroup = new THREE.Group();
    scene.add(this.resourceGroup);
    this.resourceMarkers = new Map();   // "q,r" -> marker mesh

    const tiles = [...world.tiles.values()];
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
    this.tileMesh = new THREE.InstancedMesh(this.geo, mat, tiles.length);
    this.tileMesh.castShadow = true;
    this.tileMesh.receiveShadow = true;
    this.instanceTiles = [];        // instance index -> tile
    this.tileIndex = new Map();     // "q,r" -> instance index
    this.baseColors = [];           // instance index -> THREE.Color

    const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    tiles.forEach((tile, i) => {
      const def = TERRAIN[tile.terrain];
      const h = tileHeight(tile);
      const { x, z } = hexToWorld(tile.q, tile.r);
      pos.set(x, h / 2, z); scl.set(1, h, 1);
      this.tileMesh.setMatrixAt(i, m.compose(pos, quat, scl));
      // Subtle per-tile variation in hue/saturation/lightness (plus a touch by
      // elevation) so blocks of the same terrain read as natural, not flat.
      const base = new THREE.Color(def.color);
      const h1 = hash2(tile.q, tile.r), h2 = hash2(tile.r * 1.3, tile.q * 1.7);
      base.offsetHSL((h1 - 0.5) * 0.025, (h2 - 0.5) * 0.07, (h1 - 0.5) * 0.10 + (tile.elevation - 0.45) * 0.06);
      this.tileMesh.setColorAt(i, base);
      const k = key(tile.q, tile.r);
      this.instanceTiles[i] = tile;
      this.tileIndex.set(k, i);
      this.baseColors[i] = base;
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
    });
    this.tileMesh.instanceMatrix.needsUpdate = true;
    if (this.tileMesh.instanceColor) this.tileMesh.instanceColor.needsUpdate = true;
    this.group.add(this.tileMesh);

    // Water tiles, for the shimmer animation.
    this.waterCells = [];
    this.instanceTiles.forEach((t, i) => { if (WATER.has(t.terrain)) this.waterCells.push({ i, k: key(t.q, t.r) }); });

    // Rivers: blue channels following their downhill chains.
    if (world.rivers && world.rivers.length) {
      const riverGroup = new THREE.Group();
      const riverMat = new THREE.MeshStandardMaterial({ color: 0x3aa0e0, emissive: 0x103048, emissiveIntensity: 0.6, roughness: 0.35 });
      for (const chain of world.rivers) {
        const pts = chain.map(c => this.tops.get(key(c.q, c.r))).filter(Boolean).map(t => new THREE.Vector3(t.x, t.y + 0.12, t.z));
        if (pts.length < 2) continue;
        const curve = new THREE.CatmullRomCurve3(pts);
        riverGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 6, 0.08, 6, false), riverMat));
      }
      scene.add(riverGroup);
    }

    this.visibleNow = null;
    this._buildDecorations(world);
    this._initHighlights();
  }

  topOf(q, r) { return this.tops.get(key(q, r)); }
  tileForInstance(id) { return this.instanceTiles[id]; }

  // Instanced low-poly props: trees on forests, peaks on mountains. Each prop
  // remembers its tile so fog can collapse it (scale 0) until explored.
  _buildDecorations(world) {
    this.decorations = [];
    const d = new THREE.Object3D();
    const make = (geo, placements) => {
      if (!placements.length) return;
      const mesh = new THREE.InstancedMesh(geo, DECO_MAT, placements.length);
      mesh.castShadow = true;
      const tiles = [], bases = [];
      placements.forEach((p, i) => { mesh.setMatrixAt(i, p.m); tiles.push(p.k); bases.push(p.m.clone()); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.decorations.push({ mesh, tiles, bases });
    };

    // How many trees a tile gets (forests are dense; grassland/plains/hills get
    // a scattered few).
    const treeCount = (tile) => {
      const h = hash2(tile.q, tile.r);
      if (tile.terrain === 'FOREST') return 3 + Math.floor(h * 2.5);
      if (tile.terrain === 'HILLS') return 1 + Math.floor(h * 2);
      if (tile.terrain === 'GRASSLAND') return h < 0.4 ? 1 : 0;
      if (tile.terrain === 'PLAINS') return h < 0.22 ? 1 : 0;
      return 0;
    };

    const trees = [], peaks = [];
    for (const tile of world.tiles.values()) {
      const top = this.tops.get(key(tile.q, tile.r));
      if (!top) continue;
      const n = treeCount(tile);
      for (let t = 0; t < n; t++) {
        const hx = hash2(tile.q * 3 + t, tile.r * 7), hz = hash2(tile.r * 5 + t + 1, tile.q * 11);
        d.position.set(top.x + (hx - 0.5) * 1.0, top.y, top.z + (hz - 0.5) * 1.0);
        d.scale.setScalar(0.62 + hash2(tile.q + t, tile.r - t) * 0.55);
        d.rotation.set(0, hx * 6.283, 0);
        d.updateMatrix();
        trees.push({ k: key(tile.q, tile.r), m: d.matrix.clone() });
      }
      if (tile.terrain === 'MOUNTAIN') {
        const s = 0.85 + hash2(tile.q, tile.r) * 0.5;
        d.position.set(top.x, top.y, top.z);
        d.scale.set(s, s * (0.9 + tile.elevation * 0.6), s);
        d.rotation.set(0, hash2(tile.r, tile.q) * 6.283, 0);
        d.updateMatrix();
        peaks.push({ k: key(tile.q, tile.r), m: d.matrix.clone() });
      }
    }
    make(treeGeo(), trees);
    make(mountainGeo(), peaks);
  }

  // Shimmer every explored water tile each frame (in-sight ones bright, the rest
  // dimmed like the fog). Cheap: just colour writes over the water-cell list.
  animateWater(time) {
    if (!this.exploredNow || !this.waterCells) return;
    const c = new THREE.Color();
    for (const { i, k } of this.waterCells) {
      if (!this.exploredNow.has(k)) continue; // unexplored stays dark
      const dim = this.visibleNow && this.visibleNow.has(k) ? 1 : 0.45;
      const f = dim * (0.82 + 0.2 * Math.sin(time * 1.3 + i * 0.7));
      this.tileMesh.setColorAt(i, c.copy(this.baseColors[i]).multiplyScalar(f));
    }
    if (this.tileMesh.instanceColor) this.tileMesh.instanceColor.needsUpdate = true;
  }

  // --- Fog of war -----------------------------------------------------------
  // visible: Set of "q,r" in current sight; explored: Set ever-seen.
  applyFog(visible, explored) {
    this.visibleNow = visible;
    this.exploredNow = explored;
    const c = new THREE.Color();
    for (const [k, i] of this.tileIndex) {
      const base = this.baseColors[i];
      if (visible.has(k)) c.copy(base);
      else if (explored.has(k)) c.copy(base).multiplyScalar(0.45); // dimmed memory
      else c.copy(UNEXPLORED);
      this.tileMesh.setColorAt(i, c);
      const mk = this.resourceMarkers.get(k);
      if (mk) mk.visible = explored.has(k);
    }
    if (this.tileMesh.instanceColor) this.tileMesh.instanceColor.needsUpdate = true;

    // Hide trees/peaks on tiles we've never seen.
    for (const deco of (this.decorations || [])) {
      for (let i = 0; i < deco.tiles.length; i++) deco.mesh.setMatrixAt(i, explored.has(deco.tiles[i]) ? deco.bases[i] : ZERO_MATRIX);
      deco.mesh.instanceMatrix.needsUpdate = true;
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
