import type { Game } from '../game/Game';
import type { GameEvents } from '../game/events';
import { COMBO_WINDOW, formatScore } from '../game/scoring';
import { HYPE_MAX } from '../game/hype';
import { timingLabelFor, type BattingResult } from '../baseball/batting';
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
  private comboBar!: HTMLElement;
  private hypeWrap!: HTMLElement;
  private hypeFill!: HTMLElement;
  private hypeLabel!: HTMLElement;
  private badge!: HTMLElement;
  private pitchLabel!: HTMLElement;
  private card!: HTMLElement;
  private cardTimer = 0;
  private skipHint!: HTMLElement;
  private flash!: HTMLElement;
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
  private pendingBonus: { label: string; points: number; timer: number } | null = null;

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
    this.badge = el('div', 'sb-badge');
    sb.append(head, teams, situation, this.clockWrap, this.badge);

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
    this.comboBar = el('div', 'ps-combo-bar');
    // Hype meter: fills with every meaningful shot, a full meter starts a RALLY.
    this.hypeWrap = el('div', 'ps-hype');
    const track = el('div', 'ps-hype-track');
    this.hypeFill = el('div', 'ps-hype-fill');
    track.append(this.hypeFill);
    this.hypeLabel = el('span', 'ps-hype-label', 'HYPE');
    this.hypeWrap.append(this.hypeLabel, track);
    ps.append(this.score, row, this.comboBar, this.hypeWrap);

    // Centre: toasts + swing meter.
    const center = el('div', 'hud-center');
    this.toastWrap = el('div', 'hud-toasts');
    this.swing = el('div', 'hud-swing');
    this.swingRing = el('div', 'swing-ring');
    this.swingText = el('div', 'swing-text', 'SWING!');
    this.pitchLabel = el('div', 'swing-pitch', '');
    this.swing.append(this.swingRing, this.swingText, this.pitchLabel);
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
    // Contact card: why the swing did what it did.
    this.card = el('div', 'hud-card contact-card');
    this.skipHint = el('div', 'skip-hint', 'TAP A FLIPPER TO SKIP');
    this.flash = el('div', 'hud-flash');
    this.root.append(this.flash, sb, ps, center, bottom, this.popupLayer, this.swing, this.card, this.skipHint);
  }

  private wire(): void {
    const on = <K extends keyof GameEvents>(name: K, fn: (p: GameEvents[K]) => void) => this.unsubscribe.push(this.game.bus.on(name, fn));
    on('baseball', (e) => this.renderBaseball(e.state));
    on('score', (e) => {
      this.targetScore = e.total;
      if (e.at && e.points >= 1000) this.popup(e.at, `+${formatScore(e.points)}`, e.points >= 20000 ? 'big' : '');
      else if (e.label && e.points >= 10000) {
        // Bundle the burst of bonuses one play produces into a single readable popup.
        if (!this.pendingBonus) this.pendingBonus = { label: e.label, points: 0, timer: 0.12 };
        this.pendingBonus.points += e.points;
      }
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
      this.swing.classList.remove('is-perfect');
      this.swingText.textContent = 'WAIT…';
      this.pitchLabel.textContent = `${e.pitch.label} ${e.pitch.mph}`;
      this.setPrompt('Tap a flipper as the ring closes to swing');
    });
    on('battingSwing', (e) => {
      if (this.swingState) this.swingState.swung = true;
      const q = timingLabelFor(e.offset);
      this.swingText.textContent = q;
      this.swing.classList.toggle('is-perfect', q === 'PERFECT');
    });
    on('battingResult', (e) => {
      setTimeout(() => this.swing.classList.remove('is-visible', 'is-perfect'), 600);
      this.showContactCard(e.result, e.play.label);
      if (e.result.play.type === 'homeRun' || e.result.grade === 'perfect') this.doFlash(e.result.play.type === 'homeRun');
      this.setPrompt(this.game.offense ? 'Shoot a ramp to bat' : 'Keep the ball busy to make outs');
    });
    on('pitchTaken', (e) => {
      if (this.swingState) this.swingState.swung = true;
      this.swingText.textContent = e.play.play.type === 'ball' ? 'BALL' : 'TAKEN';
      setTimeout(() => this.swing.classList.remove('is-visible'), 600);
    });
    on('cinematic', () => this.skipHint.classList.add('is-visible'));
    on('cinematicEnd', () => this.skipHint.classList.remove('is-visible'));
    on('rally', (e) => {
      this.root.classList.toggle('is-rally', e.active);
      if (e.active) this.doFlash(false);
    });
    on('clutch', (e) => {
      this.badge.textContent = e.active ? e.label : '';
      this.badge.classList.toggle('is-visible', e.active);
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
        this.badge.classList.remove('is-visible');
        this.root.classList.remove('is-rally', 'is-multiball');
        this.card.classList.remove('is-visible');
        this.skipHint.classList.remove('is-visible');
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

  private doFlash(big: boolean): void {
    this.flash.classList.remove('is-on', 'is-big');
    void this.flash.offsetWidth;
    this.flash.classList.add('is-on');
    if (big) this.flash.classList.add('is-big');
  }

  private showContactCard(r: BattingResult, label: string): void {
    const pct = (v: number, max: number) => `${Math.round(Math.max(0, Math.min(1, v / max)) * 100)}%`;
    const row = (name: string, v: number, max: number, note: string) =>
      `<div class="cc-row"><span class="cc-name">${name}</span><span class="cc-bar"><i style="width:${pct(v, max)}"></i></span><span class="cc-note">${note}</span></div>`;
    const f = r.factors;
    const launch = r.grade === 'foul' ? 'FOUL' : r.trajectory === 'ground' ? 'GROUNDER' : r.trajectory === 'line' ? 'LINER' : r.trajectory === 'pop' ? 'POP-UP' : 'FLY BALL';
    const bonus = f.bonus > 0.001 ? `+${Math.round(f.bonus * 100)}` : f.bonus < -0.001 ? `${Math.round(f.bonus * 100)}` : '0';
    this.card.innerHTML =
      `<div class="cc-head"><span>${label}</span><em>${launch}</em></div>` +
      row('TIMING', f.timing, 0.34, r.timingLabel) +
      row('RAMP', f.shot, 0.26, `${Math.round((f.shot / 0.26) * 100)}`) +
      row('BARREL', f.barrel, 0.14, f.barrel / 0.14 > 0.85 ? 'SWEET' : f.barrel / 0.14 > 0.5 ? 'OK' : 'EDGE') +
      row('POWER', f.power + f.combo, 0.21, `BONUS ${bonus}`) +
      `<div class="cc-foot">EXIT VELO <b>${Math.round(62 + r.contact * 54)} MPH</b></div>`;
    this.card.classList.add('is-visible');
    this.cardTimer = 2.6;
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
    if (this.pendingBonus) {
      this.pendingBonus.timer -= dt;
      if (this.pendingBonus.timer <= 0) {
        const b = this.pendingBonus;
        this.pendingBonus = null;
        this.popup({ x: 10.1, y: 18 }, `${b.label} +${formatScore(b.points)}`, 'big');
      }
    }
    const mult = `x${this.game.multiplier}`;
    if (this.mult.textContent !== mult) this.mult.textContent = mult;
    // Hype meter and combo timer read straight from the game state.
    const h = this.game.hype;
    this.hypeFill.style.transform = `scaleX(${Math.max(0, Math.min(1, h.value / HYPE_MAX))})`;
    const label = h.rally > 0 ? `RALLY x2 · ${Math.ceil(h.rally)}s` : 'HYPE';
    if (this.hypeLabel.textContent !== label) this.hypeLabel.textContent = label;
    const c = this.game.combo;
    this.comboBar.style.transform = `scaleX(${c.count >= 2 ? Math.max(0, c.timer / COMBO_WINDOW) : 0})`;
    if (this.cardTimer > 0) {
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) this.card.classList.remove('is-visible');
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
