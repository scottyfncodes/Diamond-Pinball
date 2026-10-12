import type { Game } from '../game/Game';
import type { GameEvents } from '../game/events';
import { formatScore } from '../game/scoring';
import { PLAYER_SIDE, TEAM_NAMES } from '../game/Game';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

interface Toast {
  node: HTMLElement;
  life: number;
}

/**
 * In-game heads-up display: compact scoreboard, pinball score, combo,
 * swing timing meter, context prompts and floating score popups.
 */
export class Hud {
  readonly root: HTMLElement;
  private inning!: HTMLElement;
  private outs: HTMLElement[] = [];
  private count!: HTMLElement;
  private bases: HTMLElement[] = [];
  private runsYou!: HTMLElement;
  private runsCpu!: HTMLElement;
  private mode!: HTMLElement;
  private clockBar!: HTMLElement;
  private clockWrap!: HTMLElement;
  private score!: HTMLElement;
  private mult!: HTMLElement;
  private ballDots: HTMLElement[] = [];
  private comboChip!: HTMLElement;
  private powerPips: HTMLElement[] = [];
  private prompt!: HTMLElement;
  private toastWrap!: HTMLElement;
  private swing!: HTMLElement;
  private swingRing!: HTMLElement;
  private swingText!: HTMLElement;
  private popupLayer!: HTMLElement;
  private toasts: Toast[] = [];
  private shownScore = 0;
  private targetScore = 0;
  private swingState: { t: number; delay: number; window: number; swung: boolean } | null = null;
  private unsubscribe: Array<() => void> = [];
  private promptTimer = 0;
  private project: ((x: number, y: number) => { x: number; y: number; visible: boolean }) | null = null;
  private popups: Array<{ node: HTMLElement; life: number }> = [];

  constructor(private game: Game, parent: HTMLElement) {
    this.root = el('div', 'hud');
    this.build();
    parent.appendChild(this.root);
    this.wire();
  }

  setProjector(fn: (x: number, y: number) => { x: number; y: number; visible: boolean }): void {
    this.project = fn;
  }

  private build(): void {
    // Baseball scoreboard (top-left).
    const sb = el('div', 'hud-card hud-scoreboard');
    const head = el('div', 'sb-head');
    this.inning = el('span', 'sb-inning', 'TOP 1');
    this.mode = el('span', 'sb-mode', 'AT BAT');
    head.append(this.inning, this.mode);
    const teams = el('div', 'sb-teams');
    const you = el('div', 'sb-team sb-you');
    you.append(el('span', 'sb-name', 'YOU'));
    this.runsYou = el('span', 'sb-runs', '0');
    you.append(this.runsYou);
    const cpu = el('div', 'sb-team');
    cpu.append(el('span', 'sb-name', TEAM_NAMES[PLAYER_SIDE === 'away' ? 'home' : 'away']));
    this.runsCpu = el('span', 'sb-runs', '0');
    cpu.append(this.runsCpu);
    teams.append(you, cpu);
    const situation = el('div', 'sb-situation');
    const outsWrap = el('div', 'sb-outs');
    outsWrap.append(el('span', 'sb-label', 'OUTS'));
    for (let i = 0; i < 3; i++) {
      const d = el('span', 'sb-dot');
      this.outs.push(d);
      outsWrap.append(d);
    }
    this.count = el('span', 'sb-count', '0-0');
    const diamond = el('div', 'sb-diamond');
    for (let i = 0; i < 3; i++) {
      const b = el('span', `sb-base sb-base-${i + 1}`);
      this.bases.push(b);
      diamond.append(b);
    }
    situation.append(outsWrap, this.count, diamond);
    this.clockWrap = el('div', 'sb-clock');
    this.clockBar = el('div', 'sb-clock-bar');
    this.clockWrap.append(this.clockBar);
    sb.append(head, teams, situation, this.clockWrap);

    // Pinball score (top-right).
    const ps = el('div', 'hud-card hud-pinball');
    this.score = el('div', 'ps-score', '0');
    const row = el('div', 'ps-row');
    this.mult = el('span', 'ps-mult', 'x1');
    const balls = el('span', 'ps-balls');
    for (let i = 0; i < 3; i++) {
      const d = el('span', 'ps-ball');
      this.ballDots.push(d);
      balls.append(d);
    }
    this.comboChip = el('span', 'ps-combo', '');
    row.append(this.mult, balls, this.comboChip);
    ps.append(this.score, row);

    // Centre: toasts + swing meter.
    const center = el('div', 'hud-center');
    this.toastWrap = el('div', 'hud-toasts');
    this.swing = el('div', 'hud-swing');
    this.swingRing = el('div', 'swing-ring');
    this.swingText = el('div', 'swing-text', 'SWING!');
    this.swing.append(this.swingRing, this.swingText);
    center.append(this.toastWrap);

    // Bottom: power pips + prompt.
    const bottom = el('div', 'hud-bottom');
    const power = el('div', 'hud-power');
    power.append(el('span', 'hud-power-label', 'POWER'));
    for (let i = 0; i < 3; i++) {
      const p = el('span', 'hud-pip');
      this.powerPips.push(p);
      power.append(p);
    }
    this.prompt = el('div', 'hud-prompt', 'Shoot a ramp to bat');
    bottom.append(power, this.prompt);

    this.popupLayer = el('div', 'hud-popups');
    this.root.append(sb, ps, center, bottom, this.popupLayer, this.swing);
  }

  private wire(): void {
    const on = <K extends keyof GameEvents>(name: K, fn: (p: GameEvents[K]) => void) => this.unsubscribe.push(this.game.bus.on(name, fn));
    on('baseball', (e) => this.renderBaseball(e.state));
    on('score', (e) => {
      this.targetScore = e.total;
      if (e.at && e.points >= 1000) this.popup(e.at, `+${formatScore(e.points)}`, e.points >= 20000 ? 'big' : '');
      else if (e.label && e.points >= 10000) this.popup({ x: 10.1, y: 17 + this.popups.length * 1.6 }, `${e.label} +${formatScore(e.points)}`, 'big');
    });
    on('toast', (e) => this.toast(e.text, e.kind, e.sub, e.duration));
    on('combo', (e) => {
      this.comboChip.textContent = e.count >= 2 ? `COMBO x${e.count}` : '';
      this.comboChip.classList.toggle('is-hot', e.count >= 3);
    });
    on('power', (e) => this.powerPips.forEach((p, i) => p.classList.toggle('is-on', i < e.level)));
    on('ballServed', (e) => {
      this.renderBalls(e.ballsLeft);
      this.setPrompt(e.extra ? 'Extra ball incoming' : 'Hold LAUNCH and release to plunge');
    });
    on('ballLost', (e) => this.renderBalls(e.ballsLeft));
    on('launch', () => this.setPrompt(this.game.offense ? 'Shoot a ramp to bat' : 'Keep the ball busy to make outs'));
    on('battingStart', (e) => {
      this.swingState = { t: 0, delay: e.pitchDelay, window: e.windowSeconds, swung: false };
      this.swing.classList.add('is-visible');
      this.swingText.textContent = 'WAIT…';
      this.setPrompt('Tap a flipper as the pitch arrives!');
    });
    on('battingSwing', (e) => {
      if (this.swingState) this.swingState.swung = true;
      const q = e.timing >= 0.85 ? 'PERFECT' : e.timing >= 0.5 ? 'GOOD' : e.auto ? 'LATE' : e.timing > 0.15 ? 'EARLY' : 'MISS';
      this.swingText.textContent = q;
      this.swing.classList.toggle('is-perfect', e.timing >= 0.85);
    });
    on('battingResult', () => {
      setTimeout(() => this.swing.classList.remove('is-visible', 'is-perfect'), 500);
      this.setPrompt(this.game.offense ? 'Shoot a ramp to bat' : 'Keep the ball busy to make outs');
    });
    on('pitchClock', (e) => {
      const k = e.seconds / e.total;
      this.clockBar.style.transform = `scaleX(${k})`;
      this.clockBar.classList.toggle('is-low', e.seconds < 6);
    });
    on('defensePitch', (e) => {
      const k = e.secondsToPitch / this.game.difficulty.defenseInterval;
      this.clockBar.style.transform = `scaleX(${k})`;
      this.clockBar.classList.toggle('is-low', e.secondsToPitch < 2.5);
    });
    on('modeChange', (e) => {
      this.mode.textContent = e.offense ? 'AT BAT' : 'DEFENSE';
      this.mode.classList.toggle('is-defense', !e.offense);
      this.setPrompt(e.offense ? 'Shoot ramps to bat, lit bases to steal' : 'Bumpers & targets build defense, ramps strike out');
    });
    on('multiball', (e) => this.root.classList.toggle('is-multiball', e.active));
    on('stateChange', (e) => {
      this.root.classList.toggle('is-visible', e.state === 'playing' || e.state === 'paused');
      if (e.state === 'playing' && e.prev === 'title') {
        this.shownScore = 0;
        this.targetScore = 0;
        this.score.textContent = '0';
        this.comboChip.textContent = '';
        this.powerPips.forEach((p) => p.classList.remove('is-on'));
        this.renderBalls(this.game.ballsLeft);
        this.renderBaseball(this.game.baseball);
        this.mode.textContent = this.game.offense ? 'AT BAT' : 'DEFENSE';
        for (const t of this.toasts) t.node.remove();
        this.toasts = [];
      }
    });
  }

  private renderBalls(left: number): void {
    this.ballDots.forEach((d, i) => d.classList.toggle('is-on', i < left));
    if (left > 3) this.ballDots[2].classList.add('is-extra');
    else this.ballDots[2].classList.remove('is-extra');
  }

  private renderBaseball(s: Parameters<Hud['renderBaseballState']>[0]): void {
    this.renderBaseballState(s);
  }

  private renderBaseballState(s: GameEvents['baseball']['state']): void {
    this.inning.textContent = s.gameOver ? 'FINAL' : `${s.half === 'top' ? 'TOP' : 'BOT'} ${s.inning}`;
    this.outs.forEach((d, i) => d.classList.toggle('is-on', i < s.outs));
    this.count.textContent = `${s.balls}-${s.strikes}`;
    this.bases.forEach((b, i) => b.classList.toggle('is-on', !!s.bases[i]));
    const you = s[PLAYER_SIDE].runs;
    const cpu = s[PLAYER_SIDE === 'away' ? 'home' : 'away'].runs;
    if (this.runsYou.textContent !== String(you)) this.bump(this.runsYou);
    this.runsYou.textContent = String(you);
    this.runsCpu.textContent = String(cpu);
    this.mult.textContent = `x${this.game.multiplier}`;
  }

  private bump(node: HTMLElement): void {
    node.classList.remove('is-bump');
    void node.offsetWidth;
    node.classList.add('is-bump');
  }

  setPrompt(text: string): void {
    this.prompt.textContent = text;
    this.promptTimer = 6;
    this.prompt.classList.add('is-visible');
  }

  toast(text: string, kind: string, sub?: string, duration = 1.8): void {
    const node = el('div', `toast toast-${kind}`);
    node.append(el('div', 'toast-main', text));
    if (sub) node.append(el('div', 'toast-sub', sub));
    this.toastWrap.append(node);
    requestAnimationFrame(() => node.classList.add('is-in'));
    this.toasts.push({ node, life: duration });
    while (this.toasts.length > 2) {
      const old = this.toasts.shift()!;
      old.node.remove();
    }
  }

  popup(at: { x: number; y: number }, text: string, cls = ''): void {
    if (!this.project) return;
    const p = this.project(at.x, at.y);
    if (!p.visible) return;
    const node = el('div', `popup ${cls}`, text);
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    this.popupLayer.append(node);
    this.popups.push({ node, life: 1.1 });
    while (this.popups.length > 8) this.popups.shift()!.node.remove();
  }

  update(dt: number): void {
    // Score counts up smoothly.
    if (this.shownScore !== this.targetScore) {
      const diff = this.targetScore - this.shownScore;
      const step = Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 8)));
      this.shownScore += Math.sign(diff) * Math.min(Math.abs(diff), step);
      this.score.textContent = formatScore(this.shownScore);
    }
    for (const t of [...this.toasts]) {
      t.life -= dt;
      if (t.life <= 0) {
        t.node.classList.remove('is-in');
        t.node.classList.add('is-out');
        const node = t.node;
        setTimeout(() => node.remove(), 300);
        this.toasts.splice(this.toasts.indexOf(t), 1);
      }
    }
    for (const p of [...this.popups]) {
      p.life -= dt;
      p.node.style.opacity = String(Math.min(1, p.life * 2));
      p.node.style.transform = `translate(-50%, ${-60 * (1.1 - p.life)}px)`;
      if (p.life <= 0) {
        p.node.remove();
        this.popups.splice(this.popups.indexOf(p), 1);
      }
    }
    if (this.swingState) {
      const s = this.swingState;
      s.t += dt;
      if (this.project) {
        const p = this.project(this.game.table.diamond.home.x, this.game.table.diamond.home.y + 1.2);
        this.swing.style.left = `${p.x}px`;
        this.swing.style.top = `${p.y}px`;
      }
      const k = Math.max(0, Math.min(1.3, s.t / s.delay));
      // Ring shrinks onto the target as the pitch arrives.
      const scale = 2.2 - 1.2 * Math.min(1, k);
      this.swingRing.style.transform = `translate(-50%, -50%) scale(${scale})`;
      this.swingRing.classList.toggle('is-window', Math.abs(s.t - s.delay) <= s.window);
      if (!s.swung && s.t > s.delay - 0.45) this.swingText.textContent = 'SWING!';
      if (s.t > s.delay + 1.2) this.swingState = null;
    }
    if (this.promptTimer > 0) {
      this.promptTimer -= dt;
      if (this.promptTimer <= 0) this.prompt.classList.remove('is-visible');
    }
  }

  dispose(): void {
    this.unsubscribe.forEach((u) => u());
    this.root.remove();
  }
}
