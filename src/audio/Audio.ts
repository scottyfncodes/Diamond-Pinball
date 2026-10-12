import type { Game } from '../game/Game';

type Wave = OscillatorType;

/**
 * Entirely synthesised sound design (Web Audio). No audio files are shipped,
 * so the game never depends on a network asset. Audio stays silent until the
 * first user gesture unlocks the context, as browsers require.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private ambienceStarted = false;
  private crowdNode: GainNode | null = null;
  private unsubscribe: Array<() => void> = [];
  private lastWall = 0;
  private volumes = { master: 0.8, sfx: 1, ambience: 0.6 };
  muted = false;

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.ambience = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.ambience.connect(this.master);
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.ambienceStarted && this.ctx.state === 'running') this.startAmbience();
  }

  setVolumes(v: Partial<typeof this.volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.02);
    this.ambience.gain.setTargetAtTime(this.volumes.ambience * 0.5, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ------------------------------------------------------------------ primitives

  private tone(freq: number, type: Wave, duration: number, opts: { gain?: number; attack?: number; slideTo?: number; delay?: number; detune?: number; bus?: GainNode } = {}): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.detune) osc.detune.value = opts.detune;
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + duration);
    const gain = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(opts.bus ?? this.sfx);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private noise(duration: number, opts: { gain?: number; filter?: BiquadFilterType; freq?: number; q?: number; sweepTo?: number; attack?: number; delay?: number; bus?: GainNode } = {}): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.filter ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1500, t0);
    f.Q.value = opts.q ?? 0.8;
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + duration);
    const g = this.ctx.createGain();
    const gain = opts.gain ?? 0.15;
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(f);
    f.connect(g);
    g.connect(opts.bus ?? this.sfx);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  private startAmbience(): void {
    if (!this.ctx) return;
    this.ambienceStarted = true;
    // Crowd murmur: filtered noise with a slow swell.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.12;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(this.ambience);
    src.start();
    lfo.start();
    // Crowd reaction bus: swells on demand.
    this.crowdNode = this.ctx.createGain();
    this.crowdNode.gain.value = 0;
    const csrc = this.ctx.createBufferSource();
    csrc.buffer = this.noiseBuffer;
    csrc.loop = true;
    csrc.playbackRate.value = 0.6;
    const cf = this.ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 900;
    cf.Q.value = 0.6;
    csrc.connect(cf);
    cf.connect(this.crowdNode);
    this.crowdNode.connect(this.ambience);
    csrc.start();
  }

  private crowd(level: number, hold: number, attack = 0.15): void {
    if (!this.ctx || !this.crowdNode) return;
    const t = this.ctx.currentTime;
    const g = this.crowdNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.001), t);
    g.exponentialRampToValueAtTime(Math.max(0.002, level), t + attack);
    g.setValueAtTime(level, t + attack + hold);
    g.exponentialRampToValueAtTime(0.001, t + attack + hold + 1.4);
  }

  // ------------------------------------------------------------------ sounds

  flipper(pressed: boolean): void {
    if (pressed) {
      this.noise(0.05, { gain: 0.18, filter: 'lowpass', freq: 900 });
      this.tone(140, 'sine', 0.07, { gain: 0.2, slideTo: 70 });
    } else {
      this.noise(0.035, { gain: 0.07, filter: 'lowpass', freq: 600 });
    }
  }

  flipperHit(speed: number): void {
    const k = Math.min(1, speed / 180);
    this.tone(800 + k * 700, 'sine', 0.12, { gain: 0.1 + k * 0.15, slideTo: 500 });
    this.noise(0.03, { gain: 0.1 + k * 0.1, filter: 'highpass', freq: 2500 });
  }

  wall(speed: number, kind: string): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastWall < 0.045) return;
    this.lastWall = now;
    const k = Math.min(1, speed / 160);
    if (kind === 'post') {
      this.tone(1900 + Math.random() * 300, 'triangle', 0.06, { gain: 0.06 + k * 0.12 });
    } else if (kind === 'ball') {
      this.tone(2600, 'sine', 0.05, { gain: 0.1 + k * 0.1 });
      this.noise(0.02, { gain: 0.15, filter: 'highpass', freq: 3000 });
    } else {
      this.noise(0.025, { gain: 0.04 + k * 0.16, filter: 'bandpass', freq: 1200 + k * 1500, q: 1.2 });
    }
  }

  bumper(): void {
    this.tone(190, 'square', 0.11, { gain: 0.16, slideTo: 80 });
    this.tone(1760, 'sine', 0.16, { gain: 0.12, delay: 0.01 });
    this.noise(0.04, { gain: 0.1, filter: 'highpass', freq: 1800 });
  }

  slingshot(): void {
    this.noise(0.03, { gain: 0.14, filter: 'bandpass', freq: 2200, q: 1.5 });
    this.tone(420, 'triangle', 0.08, { gain: 0.14, slideTo: 180 });
  }

  target(drop: boolean): void {
    if (drop) {
      this.noise(0.05, { gain: 0.16, filter: 'lowpass', freq: 1500 });
      this.tone(1200, 'sine', 0.09, { gain: 0.1, delay: 0.01 });
    } else {
      this.tone(1500, 'sine', 0.08, { gain: 0.12 });
      this.noise(0.02, { gain: 0.1, filter: 'highpass', freq: 2500 });
    }
  }

  lane(): void {
    this.tone(880, 'sine', 0.12, { gain: 0.1 });
    this.tone(1320, 'sine', 0.14, { gain: 0.07, delay: 0.04 });
  }

  ramp(quality: number): void {
    this.noise(0.38, { gain: 0.12, filter: 'bandpass', freq: 500, sweepTo: 2600, q: 1.2, attack: 0.05 });
    const notes = [523, 659, 784, 1047];
    notes.slice(0, 2 + Math.round(quality * 2)).forEach((n, i) => this.tone(n, 'triangle', 0.14, { gain: 0.1, delay: 0.06 * i }));
  }

  launch(power: number): void {
    this.tone(120, 'sawtooth', 0.18, { gain: 0.12 + power * 0.1, slideTo: 60 });
    this.noise(0.45, { gain: 0.08 + power * 0.08, filter: 'lowpass', freq: 500, sweepTo: 1800, attack: 0.03 });
  }

  drain(): void {
    this.tone(420, 'sine', 0.5, { gain: 0.16, slideTo: 90 });
    this.noise(0.12, { gain: 0.12, filter: 'lowpass', freq: 400, delay: 0.3 });
    this.crowd(0.08, 0.4);
  }

  ballSaved(): void {
    [660, 880, 1320].forEach((n, i) => this.tone(n, 'square', 0.12, { gain: 0.08, delay: i * 0.08 }));
  }

  bat(grade: 'foul' | 'weak' | 'solid' | 'perfect'): void {
    const g = grade === 'perfect' ? 0.4 : grade === 'solid' ? 0.3 : 0.18;
    this.noise(0.07, { gain: g, filter: 'highpass', freq: grade === 'foul' ? 2500 : 1200 });
    this.tone(grade === 'perfect' ? 320 : 220, 'sine', 0.1, { gain: g * 0.6, slideTo: 90 });
    if (grade === 'perfect') this.tone(2200, 'sine', 0.3, { gain: 0.12, delay: 0.02 });
  }

  pitch(): void {
    this.noise(0.25, { gain: 0.05, filter: 'bandpass', freq: 800, sweepTo: 2000, attack: 0.1 });
  }

  catchPop(): void {
    this.noise(0.04, { gain: 0.12, filter: 'lowpass', freq: 1200 });
  }

  cheer(level: 'small' | 'big' | 'roar' | 'groan'): void {
    if (level === 'groan') {
      this.crowd(0.18, 0.3, 0.2);
      this.tone(200, 'sine', 0.8, { gain: 0.04, slideTo: 120, bus: this.ambience });
      return;
    }
    const lvl = level === 'small' ? 0.22 : level === 'big' ? 0.45 : 0.7;
    this.crowd(lvl, level === 'roar' ? 1.6 : 0.6);
  }

  homeRun(): void {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((n, i) => this.tone(n, 'square', i === notes.length - 1 ? 0.8 : 0.16, { gain: 0.1, delay: 0.1 * i }));
    notes.forEach((n, i) => this.tone(n * 0.5, 'triangle', i === notes.length - 1 ? 0.8 : 0.16, { gain: 0.08, delay: 0.1 * i }));
    this.cheer('roar');
    for (let i = 0; i < 4; i++) this.noise(0.25, { gain: 0.2, filter: 'lowpass', freq: 500, delay: 1.7 + i * 0.22 + Math.random() * 0.1 });
  }

  score(): void {
    this.tone(1568, 'sine', 0.08, { gain: 0.08 });
  }

  combo(count: number): void {
    const base = 660 * Math.pow(1.12, Math.min(count, 8));
    this.tone(base, 'triangle', 0.12, { gain: 0.1 });
    this.tone(base * 1.5, 'triangle', 0.14, { gain: 0.07, delay: 0.05 });
  }

  multiball(): void {
    for (let i = 0; i < 3; i++) this.tone(300, 'triangle', 0.35, { gain: 0.12, slideTo: 900, delay: i * 0.36 });
    this.cheer('big');
  }

  strike(): void {
    this.tone(110, 'square', 0.22, { gain: 0.1 });
    this.noise(0.08, { gain: 0.08, filter: 'lowpass', freq: 300 });
  }

  out(): void {
    this.tone(160, 'sine', 0.25, { gain: 0.14, slideTo: 70 });
  }

  lock(): void {
    this.noise(0.08, { gain: 0.18, filter: 'lowpass', freq: 700 });
    [784, 1175].forEach((n, i) => this.tone(n, 'sine', 0.2, { gain: 0.1, delay: 0.1 + i * 0.12 }));
  }

  jackpot(): void {
    [784, 988, 1175, 1568].forEach((n, i) => this.tone(n, 'square', 0.12, { gain: 0.09, delay: i * 0.06 }));
  }

  achievement(): void {
    [988, 1319, 1976].forEach((n, i) => this.tone(n, 'sine', 0.3, { gain: 0.1, delay: i * 0.12 }));
  }

  extraBall(): void {
    [659, 784, 988, 1319].forEach((n, i) => this.tone(n, 'square', 0.14, { gain: 0.09, delay: i * 0.09 }));
  }

  ui(): void {
    this.tone(1000, 'sine', 0.04, { gain: 0.08 });
  }

  gameOver(won: boolean): void {
    if (won) {
      [523, 659, 784, 1047].forEach((n, i) => this.tone(n, 'square', 0.25, { gain: 0.1, delay: i * 0.15 }));
      this.cheer('roar');
    } else {
      [392, 349, 311, 262].forEach((n, i) => this.tone(n, 'triangle', 0.35, { gain: 0.1, delay: i * 0.25 }));
      this.cheer('groan');
    }
  }

  // ------------------------------------------------------------------ wiring

  attach(game: Game): void {
    const on = game.bus.on.bind(game.bus);
    this.unsubscribe.push(
      on('flipper', (e) => this.flipper(e.pressed)),
      on('flipperHit', (e) => this.flipperHit(e.speed)),
      on('wallHit', (e) => this.wall(e.speed, e.kind)),
      on('bumper', () => this.bumper()),
      on('slingshot', () => this.slingshot()),
      on('target', (e) => this.target(e.down)),
      on('lane', () => this.lane()),
      on('rampEnter', (e) => this.ramp(e.quality)),
      on('launch', (e) => this.launch(e.power)),
      on('drain', () => this.drain()),
      on('ballSaved', () => this.ballSaved()),
      on('kickback', () => this.ballSaved()),
      on('battingStart', () => this.pitch()),
      on('battingSwing', () => {}),
      on('battingResult', (e) => {
        this.bat(e.result.grade);
        const t = e.result.play.type;
        if (t === 'homeRun') setTimeout(() => this.homeRun(), 250);
        else if (e.play.runs > 0) setTimeout(() => this.cheer('big'), 500);
        else if (e.play.hit) setTimeout(() => this.cheer('small'), 400);
        else if (e.result.grade !== 'foul') setTimeout(() => this.cheer('groan'), 500);
      }),
      on('defenseResult', (e) => {
        this.bat(e.result.quality > 0.6 ? 'weak' : 'solid');
        if (e.play.outs > 0) setTimeout(() => (e.play.doublePlay ? this.cheer('big') : this.cheer('small')), 450);
        else if (e.play.runs > 0) setTimeout(() => this.cheer('groan'), 500);
        if (e.play.outs > 0) setTimeout(() => this.out(), 650);
      }),
      on('strike', () => this.strike()),
      on('steal', () => this.cheer('small')),
      on('skillShot', () => this.jackpot()),
      on('combo', (e) => {
        if (!e.broke && e.count >= 2) this.combo(e.count);
      }),
      on('multiball', (e) => {
        if (e.active) this.multiball();
      }),
      on('saucer', (e) => (e.locked ? this.lock() : this.catchPop())),
      on('achievement', () => this.achievement()),
      on('extraBall', () => this.extraBall()),
      on('gameOver', (s) => this.gameOver(s.won && s.completed)),
      on('score', (e) => {
        if (e.label && e.points >= 20000) this.score();
      }),
      on('stateChange', (e) => {
        if (e.state === 'paused') this.suspend();
        else if (e.state === 'playing') this.resume();
      }),
    );
  }

  detach(): void {
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
  }
}
