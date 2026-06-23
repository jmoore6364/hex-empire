// health.js — floating HP bars over units and cities. Billboarded (always face
// the camera) and only shown when something is damaged; full-health entities
// hide their bar. Pooled, so it's a handful of cheap meshes regardless of count.
import * as THREE from 'three';

const BG_W = 0.92, BG_H = 0.15, FILL_W = 0.86, FILL_H = 0.1;

export class HealthBars {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bgGeo = new THREE.PlaneGeometry(BG_W, BG_H);
    this.fillGeo = new THREE.PlaneGeometry(FILL_W, FILL_H);
    this.pool = [];
  }

  _bar(i) {
    if (this.pool[i]) return this.pool[i];
    const root = new THREE.Group();
    const bg = new THREE.Mesh(this.bgGeo, new THREE.MeshBasicMaterial({ color: 0x0a0d12, transparent: true, opacity: 0.85, depthTest: false }));
    const fill = new THREE.Mesh(this.fillGeo, new THREE.MeshBasicMaterial({ color: 0x6fd17f, depthTest: false }));
    bg.renderOrder = 20; fill.renderOrder = 21;
    fill.position.z = 0.001;
    root.add(bg); root.add(fill);
    this.group.add(root);
    const bar = { root, fill };
    this.pool[i] = bar;
    return bar;
  }

  // entities: [{ mesh, hp, maxHp, barY }]. Camera is used to billboard.
  update(entities, camera) {
    let i = 0;
    for (const e of entities) {
      if (!e.mesh.visible || !e.maxHp) continue;          // hidden by fog / no hp
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      if (frac >= 1 || frac <= 0) continue;                // full or dead -> no bar
      const bar = this._bar(i++);
      const p = e.mesh.position;
      bar.root.position.set(p.x, p.y + e.barY, p.z);
      bar.root.quaternion.copy(camera.quaternion);         // face the camera
      bar.fill.scale.x = frac;
      bar.fill.position.x = -(FILL_W / 2) * (1 - frac);    // left-anchored fill
      bar.fill.material.color.setHex(frac > 0.5 ? 0x6fd17f : frac > 0.25 ? 0xe0c14a : 0xe06a5a);
      bar.root.visible = true;
    }
    for (; i < this.pool.length; i++) this.pool[i].root.visible = false;
  }
}
