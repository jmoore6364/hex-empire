// camera.js — an RTS-style camera rig: a ground target with yaw/pitch/zoom.
// Keyboard (or one-finger touch drag) pans the target, mouse wheel / trackpad /
// two-finger pinch zooms, right-drag orbits.
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

    // Active touch/pen pointers (id -> {x, y}): one drives a one-finger pan,
    // two drive a pinch-zoom.
    this.pointers = new Map();
    this._lastPinch = 0;             // previous two-finger distance, px
    this._panOrigin = null;          // where a one-finger drag began
    this._panLast = null;            // previous one-finger position
    this._panning = false;           // past the tap/drag threshold?

    // Let us handle all touch gestures ourselves (no browser pan/zoom hijack).
    domElement.style.touchAction = 'none';

    this._bind();
    this.update(0);
  }

  _zoomBy(amount) {
    this.distance = THREE.MathUtils.clamp(this.distance + amount, this.minDist, this.maxDist);
  }

  // Pan the ground target by a screen-space drag (pixels), "grabbing" the map so
  // the world follows the finger. Scaled by zoom and rotated into the yaw frame.
  _panByScreen(dxPx, dyPx) {
    const k = 0.0026 * this.distance;            // world units per pixel
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Ground projections of the camera's screen axes:
    //   screen-right = (cos, -sin),  screen-down = (sin, cos).
    // Move the target opposite the finger's world displacement so the map follows.
    const wx = -(dxPx * cos + dyPx * sin) * k;
    const wz = -(dyPx * cos - dxPx * sin) * k;
    this.target.x = THREE.MathUtils.clamp(this.target.x + wx, -this.bounds, this.bounds);
    this.target.z = THREE.MathUtils.clamp(this.target.z + wz, -this.bounds, this.bounds);
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

    // --- Touch / pen: one-finger drag to pan, two-finger pinch to zoom ---
    const PAN_THRESH = 6; // px; below this a touch stays a tap (so selection works)
    this.dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return; // mouse handled above
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this._panOrigin = { x: e.clientX, y: e.clientY };
        this._panLast = { x: e.clientX, y: e.clientY };
        this._panning = false;
      } else if (this.pointers.size === 2) {
        this._lastPinch = this._pinchDist(); // a second finger turns it into a pinch
        this._panning = false;
      }
    });
    const endPointer = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this._lastPinch = 0;
      if (this.pointers.size === 1) {
        // Dropped from a pinch back to one finger — reseed the pan from it.
        const p = [...this.pointers.values()][0];
        this._panOrigin = { x: p.x, y: p.y };
        this._panLast = { x: p.x, y: p.y };
        this._panning = false;
      } else if (this.pointers.size === 0) {
        this._panning = false;
      }
    };
    this.dom.addEventListener('pointerup', endPointer);
    this.dom.addEventListener('pointercancel', endPointer);
    this.dom.addEventListener('pointerleave', endPointer);
    this.dom.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 2) {
        e.preventDefault();
        const dist = this._pinchDist();
        // Pinch apart (distance grows) zooms in; together zooms out.
        if (this._lastPinch) this._zoomBy((this._lastPinch - dist) * 0.05 * (this.distance / 22));
        this._lastPinch = dist;
        return;
      }

      if (this.pointers.size === 1 && this._panOrigin) {
        if (!this._panning && Math.hypot(e.clientX - this._panOrigin.x, e.clientY - this._panOrigin.y) > PAN_THRESH) {
          this._panning = true; // it's a drag, not a tap
        }
        if (this._panning) {
          e.preventDefault();
          this._panByScreen(e.clientX - this._panLast.x, e.clientY - this._panLast.y);
        }
        this._panLast = { x: e.clientX, y: e.clientY };
      }
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
      // Screen axes on the ground: right = (cos, -sin), down = (sin, cos).
      // dx is screen-right intent, dz is screen-down intent.
      this.target.x = THREE.MathUtils.clamp(this.target.x + (dx * cos + dz * sin) * speed, -this.bounds, this.bounds);
      this.target.z = THREE.MathUtils.clamp(this.target.z + (dz * cos - dx * sin) * speed, -this.bounds, this.bounds);
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
