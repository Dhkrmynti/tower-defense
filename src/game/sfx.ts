/* Procedural sound: every effect and the music loop are synthesised with WebAudio, no files. */

export type SfxName = 'shot' | 'gatling' | 'tesla' | 'rail' | 'lance' | 'kill' | 'bigkill' | 'build' | 'upgrade' | 'sell' | 'leak' | 'block' | 'wave' | 'boss' | 'purge' | 'over' | 'click' | 'clear' | 'heal';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastAt: Partial<Record<SfxName, number>> = {};
  private musicTimer = 0;
  private nextNoteTime = 0;
  private stepIndex = 0;
  enabled = true;
  musicOn = true;

  private init() {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }
  /** Call from a user gesture so the context is allowed to play. */
  unlock() {
    const ctx = this.init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  private tone(freq: number, type: OscillatorType, dur: number, vol: number, opts: { to?: number; attack?: number; detune?: number; delay?: number } = {}) {
    const ctx = this.init();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  private hiss(dur: number, vol: number, opts: { lp?: number; hp?: number; delay?: number; lpTo?: number } = {}) {
    const ctx = this.init();
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = src;
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.lp, t0);
      if (opts.lpTo) f.frequency.exponentialRampToValueAtTime(opts.lpTo, t0 + dur);
      node.connect(f);
      node = f;
    }
    if (opts.hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = opts.hp;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(name: SfxName) {
    if (!this.enabled) return;
    const now = performance.now();
    const minGap: Partial<Record<SfxName, number>> = { shot: 70, gatling: 45, tesla: 90, kill: 60, heal: 400 };
    if (minGap[name] && now - (this.lastAt[name] ?? 0) < minGap[name]!) return;
    this.lastAt[name] = now;
    try {
      switch (name) {
        case 'shot':
          this.hiss(0.06, 0.12, { hp: 1800 });
          this.tone(520, 'square', 0.05, 0.04, { to: 180 });
          break;
        case 'gatling':
          this.hiss(0.04, 0.1, { hp: 2400 });
          this.tone(700, 'square', 0.03, 0.03, { to: 300 });
          break;
        case 'tesla':
          this.tone(1800, 'sawtooth', 0.14, 0.05, { to: 200 });
          this.hiss(0.12, 0.08, { hp: 3000 });
          break;
        case 'rail':
          this.tone(90, 'sawtooth', 0.35, 0.16, { to: 30 });
          this.tone(2400, 'sine', 0.2, 0.04, { to: 600 });
          this.hiss(0.25, 0.2, { lp: 1200, lpTo: 200 });
          break;
        case 'lance':
          this.hiss(0.3, 0.1, { lp: 600, lpTo: 4000 });
          this.tone(60, 'triangle', 0.4, 0.16, { to: 30, delay: 0.28 });
          this.hiss(0.35, 0.22, { lp: 900, lpTo: 120, delay: 0.28 });
          break;
        case 'kill':
          this.tone(380, 'square', 0.08, 0.05, { to: 120 });
          this.hiss(0.08, 0.08, { lp: 1500 });
          break;
        case 'bigkill':
          this.tone(80, 'sawtooth', 0.6, 0.2, { to: 25 });
          this.hiss(0.6, 0.3, { lp: 1400, lpTo: 100 });
          this.tone(440, 'square', 0.3, 0.05, { to: 110, delay: 0.05 });
          break;
        case 'build':
          this.tone(330, 'square', 0.08, 0.06);
          this.tone(494, 'square', 0.12, 0.06, { delay: 0.08 });
          this.hiss(0.05, 0.06, { lp: 2000, delay: 0.02 });
          break;
        case 'upgrade':
          [392, 494, 587, 784].forEach((f, i) => this.tone(f, 'triangle', 0.12, 0.07, { delay: i * 0.06 }));
          break;
        case 'sell':
          this.tone(880, 'sine', 0.08, 0.06);
          this.tone(1320, 'sine', 0.12, 0.05, { delay: 0.07 });
          break;
        case 'leak':
          this.tone(140, 'square', 0.25, 0.1, { to: 90 });
          this.tone(140, 'square', 0.25, 0.1, { to: 90, delay: 0.3 });
          this.hiss(0.2, 0.15, { lp: 800 });
          break;
        case 'block':
          this.tone(1200, 'sine', 0.12, 0.06, { to: 2400 });
          this.hiss(0.1, 0.06, { hp: 2500 });
          break;
        case 'wave':
          this.tone(196, 'sawtooth', 0.35, 0.08, { attack: 0.05 });
          this.tone(247, 'sawtooth', 0.35, 0.08, { attack: 0.05, delay: 0.18 });
          this.tone(294, 'sawtooth', 0.5, 0.09, { attack: 0.05, delay: 0.36 });
          break;
        case 'clear':
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'square', 0.16, 0.06, { delay: i * 0.09 }));
          break;
        case 'boss':
          this.tone(55, 'sawtooth', 1.2, 0.2, { to: 40, attack: 0.1 });
          this.tone(58, 'sawtooth', 1.2, 0.14, { to: 42, attack: 0.1, detune: 12 });
          this.hiss(1.0, 0.12, { lp: 400, lpTo: 80 });
          break;
        case 'purge':
          this.tone(200, 'sawtooth', 0.9, 0.14, { to: 1600, attack: 0.3 });
          this.hiss(0.9, 0.2, { lp: 300, lpTo: 5000 });
          this.tone(60, 'triangle', 0.8, 0.18, { to: 30, delay: 0.85 });
          this.hiss(0.7, 0.3, { lp: 1200, lpTo: 100, delay: 0.85 });
          break;
        case 'over':
          [330, 294, 262, 196].forEach((f, i) => this.tone(f, 'sawtooth', 0.45, 0.09, { delay: i * 0.3, attack: 0.03 }));
          this.hiss(1.2, 0.08, { lp: 500 });
          break;
        case 'click':
          this.tone(1000, 'square', 0.03, 0.03);
          break;
        case 'heal':
          this.tone(660, 'sine', 0.2, 0.04, { to: 990 });
          break;
      }
    } catch {
      // audio needs a gesture first; the next one will work
    }
  }

  /* ───────── music: a four-bar loop in A minor, 104 bpm ───────── */
  private bass = [55, 55, 0, 55, 65.4, 0, 55, 0, 49, 49, 0, 49, 58.3, 0, 65.4, 0];
  private lead = [220, 0, 261.6, 0, 329.6, 0, 261.6, 0, 196, 0, 246.9, 0, 293.7, 0, 246.9, 0, 220, 0, 261.6, 0, 329.6, 440, 0, 329.6, 196, 0, 246.9, 0, 293.7, 349.2, 0, 293.7];
  startMusic() {
    const ctx = this.init();
    if (!ctx || this.musicTimer) return;
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 90);
  }
  stopMusic() {
    window.clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.enabled || !this.musicOn) return;
    const stepDur = 60 / 104 / 2;
    // after a background tab the clock has run ahead: skip the missed steps instead of playing them all at once
    if (this.nextNoteTime < ctx.currentTime) this.nextNoteTime = ctx.currentTime;
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      const t = this.nextNoteTime;
      const i = this.stepIndex;
      const b = this.bass[i % this.bass.length];
      if (b) this.note(b, 'square', t, stepDur * 0.9, 0.5);
      const l = this.lead[i % this.lead.length];
      if (l) this.note(l, 'triangle', t, stepDur * 0.8, 0.35);
      if (i % 4 === 2) this.hat(t, 0.12);
      if (i % 8 === 0) this.kick(t);
      this.nextNoteTime += stepDur;
      this.stepIndex += 1;
    }
  }
  private note(freq: number, type: OscillatorType, t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.musicGain!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  private hat(t: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicGain!);
    src.start(t);
    src.stop(t + 0.06);
  }
  private kick(t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g);
    g.connect(this.musicGain!);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}

export const sfx = new Sfx();
