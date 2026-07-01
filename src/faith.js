// faith.js — a small glowing gem floating above every city that follows a
// religion, tinted with that faith's colour. Billboarded and pooled, like the
// HP bars, so it costs a handful of meshes regardless of city count.
import * as THREE from 'three';

export class FaithBadges {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // a little diamond/gem — reads as a faith icon hovering over the town
    this.geo = new THREE.OctahedronGeometry(0.16);
    this.pool = [];
  }

  _badge(i) {
    if (this.pool[i]) return this.pool[i];
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.renderOrder = 22; // above the HP bars
    this.group.add(mesh);
    const badge = { mesh, mat };
    this.pool[i] = badge;
    return badge;
  }

  // entities: [{ mesh, color, y }] — one per city that has a religion. `now` is
  // used for a gentle bob/spin so the gems catch the eye.
  update(entities, camera, now = 0) {
    let i = 0;
    for (const e of entities) {
      if (!e.mesh.visible) continue;                 // hidden by fog
      const badge = this._badge(i++);
      const p = e.mesh.position;
      badge.mesh.position.set(p.x, p.y + e.y + Math.sin(now / 600 + p.x) * 0.05, p.z);
      badge.mesh.rotation.y = now / 900;             // slow spin
      badge.mat.color.setHex(e.color);
      badge.mesh.visible = true;
    }
    for (; i < this.pool.length; i++) this.pool[i].mesh.visible = false;
  }
}
