// audio.js — tiny synthesized sound effects via the Web Audio API. No asset
// files: every sound is a couple of oscillator blips, so it works offline and
// adds nothing to the download. Muteable; preference persists in localStorage.

export class Sound {
  constructor() {
    this.enabled = localStorage.getItem('hexempire-mute') !== '1';
    this.ctx = null;
  }

  // Lazily create the audio context (must be kicked off inside a user gesture on
  // mobile; our sounds fire from clicks, so resuming here is allowed).
  _ctx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { this.ctx = new AC(); } catch (e) { /* no audio */ } }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    localStorage.setItem('hexempire-mute', on ? '0' : '1');
    if (on) this._ctx();
  }

  // One short enveloped tone. `slideTo` bends the pitch over its duration.
  _tone(freq, dur, type = 'sine', vol = 0.18, delay = 0, slideTo = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  play(name) {
    if (!this.enabled) return;
    if (!this._ctx()) return;
    switch (name) {
      case 'select':   this._tone(520, 0.07, 'triangle', 0.12); break;
      case 'move':     this._tone(320, 0.10, 'sine', 0.10, 0, 440); break;
      case 'attack':   this._tone(170, 0.12, 'sawtooth', 0.20, 0, 80); this._tone(90, 0.16, 'square', 0.10, 0.02); break;
      case 'city':     this._tone(440, 0.12, 'triangle', 0.18); this._tone(660, 0.16, 'triangle', 0.18, 0.10); break;
      case 'build':    this._tone(500, 0.08, 'square', 0.12); this._tone(720, 0.10, 'square', 0.10, 0.07); break;
      case 'research': this._tone(523, 0.12, 'sine', 0.16); this._tone(784, 0.18, 'sine', 0.16, 0.10); break;
      case 'turn':     this._tone(300, 0.06, 'sine', 0.08); break;
      case 'victory':  [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.32, 'triangle', 0.2, i * 0.14)); break;
      case 'defeat':   [392, 311, 247, 175].forEach((f, i) => this._tone(f, 0.36, 'sawtooth', 0.18, i * 0.16)); break;
    }
  }
}
