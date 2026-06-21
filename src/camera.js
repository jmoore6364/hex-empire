// camera.js — an RTS-style camera rig: a ground target with yaw/pitch/zoom.
// Keyboard pans the target, scroll zooms, right-drag orbits.
import * as THREE from 'three';

export class CameraRig {
  constructor(camera, domElement, bounds = 24) {
    this.camera = camera;
    this.dom = domElement;
    this.bounds = bounds;            // how far the target may pan from origin
    this.target = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI * 0.25;       // rotation around Y
    this.pitch = 0.95;               // radians above the horizon
    this.distance = 22;
    this.minDist = 6;
    this.maxDist = 60;

    this.keys = new Set();
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;

    this._bind();
    this.update(0);
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button === 2) { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.lastY) * 0.004, 0.35, 1.45);
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    this.dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = THREE.MathUtils.clamp(this.distance + Math.sign(e.deltaY) * 2.2, this.minDist, this.maxDist);
    }, { passive: false });
  }

  // Smoothly snap the target to a world position (used when selecting a unit).
  focus(x, z) {
    this.target.x = THREE.MathUtils.clamp(x, -this.bounds, this.bounds);
    this.target.z = THREE.MathUtils.clamp(z, -this.bounds, this.bounds);
  }

  update(dt) {
    // Keyboard pan, relative to current yaw so "up" is always away from camera.
    const speed = 14 * dt * (this.distance / 22);
    let dx = 0, dz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('q')) this.yaw += 1.4 * dt;
    if (this.keys.has('e')) this.yaw -= 1.4 * dt;

    if (dx || dz) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      this.target.x = THREE.MathUtils.clamp(this.target.x + (dx * cos - dz * sin) * speed, -this.bounds, this.bounds);
      this.target.z = THREE.MathUtils.clamp(this.target.z + (dx * sin + dz * cos) * speed, -this.bounds, this.bounds);
    }

    // Place the camera on a sphere around the target.
    const horiz = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    this.camera.lookAt(this.target);
  }
}
