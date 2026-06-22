// audio.js — tiny synthesized sound effects + an ambient music loop via the Web
// Audio API. No asset files: everything is a few oscillators, so it works
// offline and adds nothing to the download. Muteable; prefs persist.

// A calm i–VI–III–VII progression in A minor: pad chord, bass root, and an
// arpeggio figure per chord (frequencies in Hz).
const MUSIC_PROG = [
  { pad: [220.0, 261.63, 329.63], bass: 110.0, arp: [440.0, 523.25, 659.25, 523.25] }, // Am
  { pad: [174.61, 220.0, 261.63], bass: 87.31, arp: [349.23, 440.0, 523.25, 440.0] },  // F
  { pad: [261.63, 329.63, 392.0], bass: 130.81, arp: [523.25, 659.25, 784.0, 659.25] }, // C
  { pad: [196.0, 246.94, 293.66], bass: 98.0, arp: [392.0, 493.88, 587.33, 493.88] },   // G
];

export class Sound {
  constructor() {
    this.enabled = localStorage.getItem('hexempire-mute') !== '1';
    this.musicOn = false;
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

  // --- ambient music --------------------------------------------------------
  startMusic() {
    if (this.musicOn) return;
    const ctx = this._ctx();
    if (!ctx) return;
    this.musicOn = true;
    localStorage.setItem('hexempire-music', '1');
    this.musicGain = ctx.createGain();
    this.musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 2.5); // gentle fade-in
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 1300;
    this.musicGain.connect(filt).connect(ctx.destination);
    this._beat = 0;
    this._nextNote = ctx.currentTime + 0.15;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 220);
  }

  stopMusic() {
    this.musicOn = false;
    localStorage.setItem('hexempire-music', '0');
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
    if (this.musicGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
      this.musicGain.gain.linearRampToValueAtTime(0.0001, t + 0.8);
    }
  }

  // Lookahead scheduler: queue any beats due within the next half-second.
  _scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    const BEAT = 0.5, PER_CHORD = 8;
    while (this._nextNote < ctx.currentTime + 0.5) {
      const t = this._nextNote, beat = this._beat;
      const chord = MUSIC_PROG[Math.floor(beat / PER_CHORD) % MUSIC_PROG.length];
      const inChord = beat % PER_CHORD;
      if (inChord === 0) { // new chord: lay down the sustained pad + bass
        for (const f of chord.pad) this._pad(f, t, PER_CHORD * BEAT, 'triangle', 0.05);
        this._pad(chord.bass, t, PER_CHORD * BEAT, 'sine', 0.09);
      }
      if (inChord % 2 === 0) this._pluck(chord.arp[(beat / 2) % chord.arp.length], t); // sparse arpeggio
      this._beat++;
      this._nextNote += BEAT;
    }
  }

  _pad(freq, t, dur, type, vol) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 1.2);          // slow swell
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.musicGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  _pluck(freq, t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g).connect(this.musicGain);
    osc.start(t); osc.stop(t + 0.65);
  }
}
