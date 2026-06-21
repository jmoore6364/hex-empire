// camera.js — an RTS-style camera rig: a ground target with yaw/pitch/zoom.
// Keyboard pans the target, mouse wheel / trackpad / pinch zooms, right-drag
// (or two-finger drag) orbits.
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

    // Active touch/pen pointers for pinch-zoom (id -> {x, y}).
    this.pointers = new Map();
    this._lastPinch = 0;             // previous two-finger distance, px

    // Let us handle all touch gestures ourselves (no browser pan/zoom hijack).
    domElement.style.touchAction = 'none';

    this._bind();
    this.update(0);
  }

  _zoomBy(amount) {
    this.distance = THREE.MathUtils.clamp(this.distance + amount, this.minDist, this.maxDist);
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
    // Wheel + trackpad zoom. Proportional to the scroll delta so a notched
    // mouse wheel and a precision trackpad both feel right; ctrlKey marks a
    // trackpad pinch gesture (finer steps). Also scaled by distance so it's
    // smooth when zoomed both in and out.
    this.dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines/pages -> px
      const px = e.deltaY * unit;
      const factor = (e.ctrlKey ? 0.03 : 0.012) * (this.distance / 22);
      this._zoomBy(THREE.MathUtils.clamp(px * factor, -6, 6));
    }, { passive: false });

    // --- Touch / pen: two-finger pinch to zoom ---
    this.dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return; // mouse handled above
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this._lastPinch = this._pinchDist();
    });
    const endPointer = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this._lastPinch = 0;
    };
    this.dom.addEventListener('pointerup', endPointer);
    this.dom.addEventListener('pointercancel', endPointer);
    this.dom.addEventListener('pointerleave', endPointer);
    this.dom.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size !== 2) return;
      e.preventDefault();
      const dist = this._pinchDist();
      // Pinch apart (distance grows) zooms in; together zooms out.
      if (this._lastPinch) this._zoomBy((this._lastPinch - dist) * 0.05 * (this.distance / 22));
      this._lastPinch = dist;
    });
  }

  _pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
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
