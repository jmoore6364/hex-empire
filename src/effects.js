// effects.js — short-lived combat visuals (lunge, hit-flash, arrow projectile,
// death fade) driven by the render loop. Purely cosmetic; the combat math lives
// in combat.js and the rules in game.js.
import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.projGeo = new THREE.SphereGeometry(0.07, 6, 6);
    this.sparkGeo = new THREE.SphereGeometry(0.05, 5, 4);
  }

  // Attacker darts toward the defender and back.
  lunge(unit, targetPos) {
    const home = unit.mesh.position.clone();
    const toward = targetPos.clone().sub(home); toward.y = 0;
    const d = toward.length();
    if (d < 1e-3) return;
    const peak = home.clone().addScaledVector(toward.normalize(), Math.min(0.5, d * 0.45));
    this.active.push({ type: 'lunge', mesh: unit.mesh, home, peak, t: 0, dur: 0.3 });
  }

  // Defender briefly glows red where it was hit.
  flash(unit) {
    const mats = [];
    unit.mesh.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) mats.push({ m: o.material, hex: o.material.emissive.getHex() }); });
    if (mats.length) this.active.push({ type: 'flash', mats, t: 0, dur: 0.32 });
  }

  // An arrow/bolt flying from one world position to another, in an arc.
  projectile(fromPos, toPos, color) {
    const mesh = new THREE.Mesh(this.projGeo, new THREE.MeshBasicMaterial({ color }));
    const start = fromPos.clone(); start.y += 0.5;
    const end = toPos.clone(); end.y += 0.5;
    mesh.position.copy(start);
    this.scene.add(mesh);
    this.active.push({ type: 'proj', mesh, start, end, t: 0, dur: 0.26 });
  }

  // A floating "-N" damage number that drifts up over a hit unit and fades.
  damage(worldPos, text, color = '#ff6b6b') {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 46px Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(text, 64, 34);
    ctx.fillStyle = color; ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(worldPos); s.position.y += 1.0;
    s.scale.set(1.2, 0.6, 1);
    this.scene.add(s);
    this.active.push({ type: 'dmg', mesh: s, mat, tex, t: 0, dur: 0.95, y0: s.position.y });
  }

  // A quick burst of sparks at the point of impact.
  spark(worldPos, color = 0xffd27f) {
    const bits = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.copy(worldPos); m.position.y += 0.5;
      const ang = (i / n) * Math.PI * 2;
      const sp = 1.6 + ((i * 37) % 10) / 10;
      m.userData.v = new THREE.Vector3(Math.cos(ang) * sp, 2.0 + ((i * 53) % 10) / 10, Math.sin(ang) * sp);
      this.scene.add(m);
      bits.push(m);
    }
    this.active.push({ type: 'spark', bits, t: 0, dur: 0.45 });
  }

  // Take ownership of a dead unit's mesh and play it out, then dispose it.
  death(mesh) {
    this.active = this.active.filter((e) => e.mesh !== mesh); // cancel any lunge on it
    const mats = [];
    mesh.traverse((o) => { if (o.isMesh && o.material) { o.material.transparent = true; mats.push(o.material); } });
    this.active.push({ type: 'death', mesh, mats, t: 0, dur: 0.5, scale0: mesh.scale.clone(), y0: mesh.position.y });
  }

  _dispose(mesh) {
    this.scene.remove(mesh);
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose());
    });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.t += dt;
      const p = Math.min(1, e.t / e.dur);

      if (e.type === 'lunge') {
        const f = Math.sin(p * Math.PI); // 0 -> 1 -> 0, there and back
        e.mesh.position.lerpVectors(e.home, e.peak, f);
        if (p >= 1) e.mesh.position.copy(e.home);
      } else if (e.type === 'flash') {
        const k = 1 - p;
        for (const { m } of e.mats) m.emissive.setRGB(0.95 * k, 0.12 * k, 0.05 * k);
        if (p >= 1) for (const { m, hex } of e.mats) m.emissive.setHex(hex);
      } else if (e.type === 'proj') {
        e.mesh.position.lerpVectors(e.start, e.end, p);
        e.mesh.position.y += Math.sin(p * Math.PI) * 0.6; // arc
        if (p >= 1) { this.scene.remove(e.mesh); e.mesh.material.dispose(); } // shared geo: keep it
      } else if (e.type === 'death') {
        const s = 1 - p;
        e.mesh.scale.set(e.scale0.x * s, e.scale0.y * s, e.scale0.z * s);
        e.mesh.position.y = e.y0 - p * 0.6;
        for (const m of e.mats) m.opacity = s;
        if (p >= 1) this._dispose(e.mesh);
      } else if (e.type === 'dmg') {
        e.mesh.position.y = e.y0 + p * 0.9;
        e.mat.opacity = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        if (p >= 1) { this.scene.remove(e.mesh); e.mat.dispose(); e.tex.dispose(); }
      } else if (e.type === 'spark') {
        for (const b of e.bits) {
          b.userData.v.y -= 7 * dt;                 // gravity
          b.position.addScaledVector(b.userData.v, dt);
          b.material.opacity = 1 - p;
        }
        if (p >= 1) for (const b of e.bits) { this.scene.remove(b); b.material.dispose(); } // shared geo kept
      }

      if (p >= 1) this.active.splice(i, 1);
    }
  }
}
