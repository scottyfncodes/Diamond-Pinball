import type { Game } from '../game/Game';
import type { GameEvents } from '../game/events';
import { COMBO_TIER_LABEL, comboTier, formatScore } from '../game/scoring';
import { HYPE_MAX } from '../game/hype';
import { MODIFIERS, type ModifierId } from '../game/modifiers';
import { IMPOSSIBLE_LINK_LABEL } from '../game/modes';
import { timingLabelFor, type BattingResult } from '../baseball/batting';
import { PLAYER_SIDE, TEAM_NAMES } from '../game/Game';
import { STUNT_IDEAL, type CityRush } from '../attractions/cityRush';
import { PULSES } from '../attractions/reactor';

type Projector = (x: number, y: number, h?: number) => { x: number; y: number; visible: boolean };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

interface Toast {
  node: HTMLElement;
  life: number;
  rank: number;
  age: number;
  duration: number;
}

const TOAST_RANK: Record<string, number> = { info: 0, good: 1, bad: 2, great: 3, epic: 4, legend: 5 };

/**
 * In-game heads-up display: compact scoreboard, pinball score, difficulty and
 * multiplier, combo tier, modifier timers, boss objectives, swing timing meter,
 * context prompts and floating score popups.
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
  private diffChip!: HTMLElement;
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
  private modsWrap!: HTMLElement;
  private modRows = new Map<string, { node: HTMLElement; bar: HTMLElement; total: number }>();
  private bossPanel!: HTMLElement;
  private bossName!: HTMLElement;
  private bossObjective!: HTMLElement;
  private bossBar!: HTMLElement;
  private bossTimer!: HTMLElement;
  private chainWrap!: HTMLElement;
  private toasts: Toast[] = [];
  private shownScore = 0;
  private targetScore = 0;
  private swingState: { t: number; delay: number; window: number; swung: boolean } | null = null;
  private unsubscribe: Array<() => void> = [];
  private promptTimer = 0;
  private project: Projector | null = null;
  private popups: Array<{ node: HTMLElement; life: number }> = [];
  private bossState: { timer: number; total: number } | null = null;
  // ---- attractions ----
  private attrPanel!: HTMLElement;
  private attrTitle!: HTMLElement;
  private attrBar!: HTMLElement;
  private attrStats!: HTMLElement;
  private attrPips!: HTMLElement;
  private attrTimer = 0;
  private ring!: HTMLElement;
  private ringCircle!: HTMLElement;
  private ringText!: HTMLElement;
  private rush: CityRush | null = null;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = el('div', 'hud');
    this.build();
    parent.appendChild(this.root);
    this.wire();
  }

  setProjector(fn: Projector): void {
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
    cpu.append(el('span', 'sb-name', TEAM_NAMES[PLAYER_SIDE === 'away' ? 'home' : 'away'].slice(0, 3)));
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
    this.diffChip = el('div', 'ps-diff', 'ALL-STAR');
    // Hype meter: fills with every meaningful shot, a full meter starts a RALLY.
    this.hypeWrap = el('div', 'ps-hype');
    const track = el('div', 'ps-hype-track');
    this.hypeFill = el('div', 'ps-hype-fill');
    track.append(this.hypeFill);
    this.hypeLabel = el('span', 'ps-hype-label', 'HYPE');
    this.hypeWrap.append(this.hypeLabel, track);
    // Active table modifiers with their timers.
    this.modsWrap = el('div', 'ps-mods');
    ps.append(this.score, row, this.comboBar, this.diffChip, this.hypeWrap, this.modsWrap);

    // Attraction mini-game panel (bottom centre) and the projected timing ring.
    this.attrPanel = el('div', 'hud-card hud-attraction');
    this.attrTitle = el('div', 'attr-title', '');
    const attrTrack = el('div', 'attr-track');
    this.attrBar = el('div', 'attr-fill');
    attrTrack.append(this.attrBar);
    this.attrStats = el('div', 'attr-stats', '');
    this.attrPips = el('div', 'attr-pips');
    this.attrPanel.append(this.attrTitle, this.attrPips, this.attrStats, attrTrack);
    this.ring = el('div', 'hud-ring');
    this.ringCircle = el('div', 'ring-circle');
    this.ringText = el('div', 'ring-text', '');
    this.ring.append(this.ringCircle, this.ringText);

    // Boss / objective panel (below the scoreboard).
    this.bossPanel = el('div', 'hud-card hud-boss');
    this.bossName = el('div', 'boss-name', '');
    this.bossObjective = el('div', 'boss-objective', '');
    const bar = el('div', 'boss-bar');
    this.bossBar = el('div', 'boss-bar-fill');
    bar.append(this.bossBar);
    this.bossTimer = el('div', 'boss-timer', '');
    this.bossPanel.append(this.bossName, this.bossObjective, bar, this.bossTimer);

    // Centre: toasts + swing meter.
    const center = el('div', 'hud-center');
    this.toastWrap = el('div', 'hud-toasts');
    this.swing = el('div', 'hud-swing');
    this.swingRing = el('div', 'swing-ring');
    this.swingText = el('div', 'swing-text', 'SWING!');
    this.pitchLabel = el('div', 'swing-pitch', '');
    this.swing.append(this.swingRing, this.swingText, this.pitchLabel);
    center.append(this.toastWrap);

    // Bottom: power pips + impossible chain + prompt.
    const bottom = el('div', 'hud-bottom');
    const power = el('div', 'hud-power');
    power.append(el('span', 'hud-power-label', 'POWER'));
    for (let i = 0; i < 3; i++) {
      const p = el('span', 'hud-pip');
      this.powerPips.push(p);
      power.append(p);
    }
    this.chainWrap = el('div', 'hud-chain');
    this.chainWrap.append(el('span', 'hud-chain-label', 'IMPOSSIBLE INNING'));
    this.prompt = el('div', 'hud-prompt', 'Shoot a ramp to bat');
    bottom.append(power, this.chainWrap, this.prompt);

    this.popupLayer = el('div', 'hud-popups');
    // Contact card: why the swing did what it did.
    this.card = el('div', 'contact-card');
    this.skipHint = el('div', 'skip-hint', 'TAP A FLIPPER TO SKIP');
    this.flash = el('div', 'hud-flash');
    this.root.append(this.flash, sb, this.bossPanel, ps, center, bottom, this.popupLayer, this.swing, this.ring, this.attrPanel, this.card, this.skipHint);
  }

  private wire(): void {
    const on = <K extends keyof GameEvents>(name: K, fn: (p: GameEvents[K]) => void) => this.unsubscribe.push(this.game.bus.on(name, fn));
    on('baseball', (e) => this.renderBaseball(e.state));
    on('difficulty', (e) => {
      this.diffChip.textContent = `${e.profile.title} · SCORE x${e.profile.scoreScale}`;
      this.diffChip.style.setProperty('--diff', e.profile.color);
      // Shown for the opening seconds of a run only.
      this.diffChip.classList.add('is-visible');
      setTimeout(() => this.diffChip.classList.remove('is-visible'), 4000);
      this.root.dataset.difficulty = e.profile.id;
      this.renderChain([], e.profile.impossibleLinks);
    });
    on('score', (e) => {
      this.targetScore = e.total;
      // Table-space popups mean nothing while the camera is inside an attraction.
      if (this.game.director.diving) return;
      // Points float off the thing that was hit; small change and label-only bonuses stay quiet.
      if (e.at && e.points >= 5000) this.popup(e.at, `+${formatScore(e.points)}`, e.points >= 50000 ? 'big' : '');
    });
    on('toast', (e) => this.toast(e.text, e.kind, e.sub, e.duration));
    on('combo', (e) => {
      const tier = comboTier(e.count);
      this.comboChip.textContent = e.count >= 2 ? `${COMBO_TIER_LABEL[tier]} x${e.count}` : '';
      this.comboChip.dataset.tier = tier;
      this.comboChip.classList.toggle('is-hot', e.count >= 4);
    });
    on('power', (e) => {
      this.powerPips.forEach((p, i) => p.classList.toggle('is-on', i < e.level));
      this.powerPips[0].parentElement!.classList.toggle('is-visible', e.level > 0);
    });
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
      this.swing.classList.toggle('is-special', e.pitch.special);
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
      setTimeout(() => this.swing.classList.remove('is-visible', 'is-perfect', 'is-special'), 600);
      this.showContactCard(e.result, e.play.label);
      if (e.result.play.type === 'homeRun' || e.result.grade === 'perfect') this.doFlash(e.result.play.type === 'homeRun');
      this.setPrompt(this.game.offense ? 'Shoot a ramp to bat' : 'Keep the ball busy to make outs');
    });
    on('pitchTaken', (e) => {
      if (this.swingState) this.swingState.swung = true;
      this.swingText.textContent = e.play.play.type === 'ball' ? 'BALL' : 'TAKEN';
      setTimeout(() => this.swing.classList.remove('is-visible', 'is-special'), 600);
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
      this.mode.closest('.hud-scoreboard')?.classList.toggle('is-defense', !e.offense);
      this.setPrompt(e.offense ? 'Shoot ramps to bat, lit bases to steal' : 'Bumpers & targets build defense, ramps strike out');
    });
    on('multiball', (e) => {
      this.root.classList.toggle('is-multiball', e.active);
      this.root.dataset.multiball = e.active ? e.mode : '';
    });
    on('modifier', (e) => {
      if (e.active && e.duration > 0) this.addModRow(e.id, e.duration);
      else if (!e.active) this.removeModRow(e.id);
      if (e.id === 'slowMo') this.root.classList.toggle('is-slowmo', e.active);
    });
    on('scoreboardBoost', (e) => {
      if (e.active) this.addModRow('scoreboard', e.seconds, 'SCOREBOARD x2');
      else this.removeModRow('scoreboard');
    });
    on('derby', (e) => {
      if (e.active) {
        if (!this.modRows.has('derby')) this.addModRow('derby', e.remaining, 'HOME RUN DERBY');
        const row = this.modRows.get('derby');
        if (row) {
          row.node.querySelector('.mod-name')!.textContent = `DERBY x${e.multiplier} · ${e.homers} HR`;
          row.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, e.remaining / row.total))})`;
        }
      } else this.removeModRow('derby');
    });
    on('boss', (e) => {
      if (e.active) {
        this.bossPanel.classList.add('is-visible');
        this.bossPanel.dataset.boss = e.id;
        this.bossName.textContent = e.label;
        if (this.bossObjective.textContent !== e.sub) this.setPrompt(e.sub.charAt(0) + e.sub.slice(1).toLowerCase());
        this.bossObjective.textContent = e.sub;
        this.bossName.textContent = `${e.label} ${e.progress}/${e.goal}`;
        this.bossBar.style.transform = `scaleX(${e.goal > 0 ? e.progress / e.goal : 0})`;
        this.bossState = e.timer === Infinity ? null : { timer: e.timer, total: e.timer };
        if (this.bossState && this.bossState.total <= 0) this.bossState = null;
        this.bossTimer.textContent = e.timer === Infinity ? 'ONE SHOT' : `${Math.ceil(e.timer)}s`;
      } else {
        this.bossPanel.classList.remove('is-visible');
        this.bossState = null;
      }
    });
    on('impossible', (e) => this.renderChain(e.links, e.needed, e.stage === 'complete'));
    on('reactor', (e) => {
      if (e.event.type === 'capture') {
        this.showAttraction('REACTOR OVERLOAD', 'reactor');
        this.attrPips.innerHTML = '';
        for (let i = 0; i < PULSES; i++) this.attrPips.append(el('span', 'attr-pip'));
        this.attrStats.textContent = 'TAP ON GOLD';
        this.setPrompt('Tap a flipper as each pulse reaches the gold gate');
      } else if (e.event.type === 'pulse') {
        const pip = this.attrPips.children[e.event.index] as HTMLElement | undefined;
        pip?.classList.add(e.event.hit ? 'is-hit' : 'is-miss');
        const o = this.game.reactor.overload;
        if (o) this.attrStats.textContent = `${o.syncs} SYNCED`;
        this.ringText.textContent = e.event.hit ? 'SYNC!' : 'MISS';
        this.ring.classList.toggle('is-hit', e.event.hit);
      }
    });
    on('reactorResult', (e) => {
      if (e.outcome === 'instant') return;
      this.attrTitle.textContent = e.outcome === 'meltdown' ? 'MELTDOWN!' : e.outcome === 'overload' ? 'OVERLOAD!' : 'CORE FIZZLED';
      this.attrStats.textContent = `${e.syncs}/${PULSES} SYNCED · +${formatScore(e.points)}`;
      this.attrBar.style.transform = 'scaleX(1)';
      this.endAttraction();
    });
    on('cityRush', (e) => {
      if (e.event.type === 'start') {
        this.rush = e.rush;
        this.showAttraction('WALL CATCH', 'city');
        this.attrPips.innerHTML = '';
        this.attrStats.textContent = '◀ ▶ MOVE · CATCH';
        this.setPrompt('Left / right flipper moves the outfielder');
        this.setSteer(true);
        return;
      }
      const r = e.rush;
      if (e.event.type === 'stuntReady') {
        this.setSteer(false);
        this.ring.dataset.mode = 'stunt';
        this.ring.classList.add('is-visible');
        this.ring.classList.remove('is-hit');
        this.ringText.textContent = 'LEAP!';
        this.setPrompt('Tap a flipper as the ring closes to leap');
      } else if (e.event.type === 'stunt') {
        this.ringText.textContent = e.event.success ? 'GOT IT!' : 'TOO ' + (e.event.error < 0 ? 'EARLY' : 'LATE');
        this.ring.classList.toggle('is-hit', e.event.success);
        setTimeout(() => this.ring.classList.remove('is-visible'), 700);
      }
      this.attrStats.textContent = `CATCHES ${r.coinsTaken} · HITS ${r.crashes}`;
    });
    on('cityResult', (e) => {
      this.rush = null;
      this.setSteer(false);
      if (e.grade === 'cruise') return;
      this.attrTitle.textContent = e.stunt === 'jump' ? 'ROBBED!' : 'OVER THE WALL';
      this.attrStats.textContent = `+${formatScore(e.points)}${e.trophy ? ' · BANNER UP' : ''}`;
      this.attrBar.style.transform = 'scaleX(1)';
      this.endAttraction();
    });
    on('worldMult', () => (this.mult.textContent = `x${this.game.multiplier}`));
    on('shot', (e) => {
      if (e.phase === 'end' && (e.kind === 'city' || e.kind === 'reactor')) {
        // Live play resumes: nothing may sit over the flippers.
        this.ring.classList.remove('is-visible');
        this.setSteer(false);
        this.attrTimer = 0.6;
        this.setPrompt(this.game.offense ? 'Shoot a ramp to bat' : 'Keep the ball busy to make outs');
      }
    });
    on('stateChange', (e) => {
      this.root.classList.toggle('is-visible', e.state === 'playing' || e.state === 'paused');
      if (e.state === 'playing' && e.prev === 'title') {
        this.shownScore = 0;
        this.targetScore = 0;
        this.score.textContent = '0';
        this.comboChip.textContent = '';
        this.badge.classList.remove('is-visible');
        this.root.classList.remove('is-rally', 'is-multiball', 'is-slowmo');
        this.card.classList.remove('is-visible');
        this.skipHint.classList.remove('is-visible');
        this.bossPanel.classList.remove('is-visible');
        this.powerPips.forEach((p) => p.classList.remove('is-on'));
        for (const id of [...this.modRows.keys()]) this.removeModRow(id);
        this.renderBalls(this.game.ballsLeft);
        this.renderBaseball(this.game.baseball);
        this.mode.textContent = this.game.offense ? 'AT BAT' : 'DEFENSE';
        for (const t of this.toasts) t.node.remove();
        this.toasts = [];
        this.attrPanel.classList.remove('is-visible');
        this.ring.classList.remove('is-visible');
        this.setSteer(false);
        this.rush = null;
      }
    });
  }

  /** While steering in the city the flipper zones become the steering wheel. */
  private setSteer(on: boolean): void {
    this.root.parentElement?.classList.toggle('is-steer', on);
  }

  private showAttraction(title: string, kind: 'city' | 'reactor'): void {
    this.attrTitle.textContent = title;
    this.attrPanel.dataset.kind = kind;
    this.attrBar.style.transform = 'scaleX(0)';
    this.attrPanel.classList.add('is-visible');
    this.attrTimer = 0;
    if (kind === 'reactor') {
      this.ring.dataset.mode = 'reactor';
      this.ring.classList.add('is-visible');
      this.ring.classList.remove('is-hit');
      this.ringText.textContent = 'SYNC';
    }
  }

  /** Keeps the result on screen for a moment, then clears the panel. */
  private endAttraction(): void {
    this.attrTimer = 2.2;
    setTimeout(() => this.ring.classList.remove('is-visible'), 500);
  }

  private addModRow(id: string, total: number, label?: string): void {
    this.removeModRow(id);
    const def = MODIFIERS[id as ModifierId];
    const node = el('div', `mod-row mod-${id}`);
    const name = el('span', 'mod-name', label ?? def?.name ?? id.toUpperCase());
    const track = el('span', 'mod-track');
    const bar = el('i', 'mod-fill');
    track.append(bar);
    node.append(name, track);
    if (def) node.style.setProperty('--mod', `#${def.color.toString(16).padStart(6, '0')}`);
    this.modsWrap.append(node);
    this.modRows.set(id, { node, bar, total });
  }

  private removeModRow(id: string): void {
    const row = this.modRows.get(id);
    if (!row) return;
    row.node.remove();
    this.modRows.delete(id);
  }

  /** THE IMPOSSIBLE INNING: a single short chip once the chain is real (2+ links), not a grid of labels. */
  private renderChain(links: string[], needed: number, complete = false): void {
    const required = this.game.impossible.required;
    const have = links.filter((l) => required.includes(l as never)).length;
    this.chainWrap.classList.toggle('is-visible', have >= 2 && !complete);
    this.chainWrap.classList.toggle('is-complete', complete);
    this.chainWrap.querySelector('.hud-chain-label')!.textContent = `IMPOSSIBLE ${have}/${needed}`;
    const missing = required.filter((r) => !links.includes(r)).map((r) => IMPOSSIBLE_LINK_LABEL[r]);
    this.chainWrap.title = missing.length ? `Still needed: ${missing.join(', ')}` : '';
  }

  private renderBalls(left: number): void {
    this.ballDots.forEach((d, i) => d.classList.toggle('is-on', i < left));
    if (left > 3) this.ballDots[2].classList.add('is-extra');
    else this.ballDots[2].classList.remove('is-extra');
  }

  private renderBaseball(s: GameEvents['baseball']['state']): void {
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
    if (this.game.store.data.settings.reducedEffects) return;
    this.flash.classList.remove('is-on', 'is-big');
    void this.flash.offsetWidth;
    this.flash.classList.add('is-on');
    if (big) this.flash.classList.add('is-big');
  }

  /**
   * After a swing: one short tag pops up at home plate (timing + exit velocity) and
   * fades, instead of a stats card in the corner. The why is visible in the play itself.
   */
  private showContactCard(r: BattingResult, _label: string): void {
    const mph = Math.round(62 + r.contact * 54);
    this.card.textContent = r.grade === 'foul' ? `FOUL · ${mph} MPH` : `${r.timingLabel} · ${mph} MPH`;
    this.card.dataset.grade = r.grade;
    this.card.classList.add('is-visible');
    this.cardTimer = 1.4;
    this.placeContactTag();
  }

  private placeContactTag(): void {
    if (!this.project) return;
    const home = this.game.table.diamond.home;
    const p = this.project(home.x, home.y - 1.6, 0.5);
    this.card.style.left = `${p.x}px`;
    this.card.style.top = `${p.y}px`;
  }

  setPrompt(text: string): void {
    this.prompt.textContent = text;
    this.promptTimer = 6;
    this.prompt.classList.add('is-visible');
  }

  /**
   * One banner at a time. A bigger moment is never stepped on by a smaller one
   * (a smaller one is simply dropped while the bigger one is fresh). Only the
   * biggest moments keep a sub-line; every other explanation goes to the single
   * prompt line at the bottom, so the table never carries two blocks of text.
   */
  toast(text: string, kind: string, sub?: string, duration = 1.8): void {
    const rank = TOAST_RANK[kind] ?? 0;
    const cur = this.toasts[this.toasts.length - 1];
    if (cur && cur.rank > rank && cur.age < Math.min(1.4, cur.duration * 0.7)) {
      if (sub && rank >= 1) this.setPrompt(sub);
      return;
    }
    for (const t of this.toasts) this.fadeToast(t);
    this.toasts = [];
    const node = el('div', `toast toast-${kind}`);
    node.append(el('div', 'toast-main', text));
    if (sub) {
      // Only a short sub-line fits under a big banner; anything longer is an instruction for the prompt.
      if (rank >= TOAST_RANK.epic && sub.length <= 34) node.append(el('div', 'toast-sub', sub));
      else this.setPrompt(sub);
    }
    this.toastWrap.append(node);
    requestAnimationFrame(() => node.classList.add('is-in'));
    const life = rank <= TOAST_RANK.good ? Math.min(duration, 1.3) : duration;
    this.toasts.push({ node, life, rank, age: 0, duration: life });
  }

  private fadeToast(t: Toast): void {
    t.node.classList.remove('is-in');
    t.node.classList.add('is-out');
    const node = t.node;
    setTimeout(() => node.remove(), 300);
  }

  popup(at: { x: number; y: number }, text: string, cls = ''): void {
    if (!this.project) return;
    const p = this.project(at.x, at.y);
    // Never float numbers over the score cards at the top of the screen.
    if (!p.visible || p.y < 150) return;
    const node = el('div', `popup ${cls}`, text);
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    this.popupLayer.append(node);
    this.popups.push({ node, life: 1.1 });
    while (this.popups.length > 3) this.popups.shift()!.node.remove();
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
      t.age += dt;
      if (t.life <= 0) {
        this.fadeToast(t);
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
    const mult = `x${this.game.multiplier}`;
    if (this.mult.textContent !== mult) this.mult.textContent = mult;
    // Hype meter and combo timer read straight from the game state.
    const h = this.game.hype;
    this.hypeFill.style.transform = `scaleX(${Math.max(0, Math.min(1, h.value / HYPE_MAX))})`;
    const label = h.rally > 0 ? `RALLY ${Math.ceil(h.rally)}s` : '';
    if (this.hypeLabel.textContent !== label) this.hypeLabel.textContent = label;
    const c = this.game.combo;
    this.comboBar.style.transform = `scaleX(${c.count >= 2 ? Math.max(0, c.timer / this.game.comboWindow) : 0})`;
    // Modifier timers.
    for (const [id, row] of this.modRows) {
      if (id === 'derby') continue;
      const remaining = id === 'scoreboard' ? this.game.scoreboardBoost : this.game.modifiers.active.find((a) => a.id === id)?.remaining ?? 0;
      row.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, remaining / row.total))})`;
    }
    if (this.bossState && this.game.boss) {
      this.bossState.timer = this.game.boss.timer;
      this.bossTimer.textContent = `${Math.ceil(Math.max(0, this.game.boss.timer))}s`;
      this.bossTimer.classList.toggle('is-low', this.game.boss.timer < 10);
    }
    this.updateAttraction(dt);
    if (this.cardTimer > 0) {
      this.placeContactTag();
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) this.card.classList.remove('is-visible');
    }
    if (this.promptTimer > 0) {
      this.promptTimer -= dt;
      if (this.promptTimer <= 0) this.prompt.classList.remove('is-visible');
    }
  }

  private updateAttraction(dt: number): void {
    if (this.attrTimer > 0) {
      this.attrTimer -= dt;
      if (this.attrTimer <= 0) this.attrPanel.classList.remove('is-visible');
    }
    const r = this.rush;
    if (r && r.phase === 'race') this.attrBar.style.transform = `scaleX(${r.progress})`;
    const o = this.game.reactor.overload;
    if (o && this.attrPanel.dataset.kind === 'reactor' && this.attrTimer <= 0) {
      const judged = o.pulses.filter((p) => p.judged).length;
      this.attrBar.style.transform = `scaleX(${judged / o.pulses.length})`;
    }
    if (!this.ring.classList.contains('is-visible') || !this.project) return;
    // The ring sits on the thing to hit and closes onto it at the perfect moment.
    let k = 1;
    let inWindow = false;
    if (this.ring.dataset.mode === 'stunt' && r) {
      const s = this.game.table.attractions.city.stunt.ramp;
      const p = this.project(s.x, s.y, 2.0);
      this.ring.style.left = `${p.x}px`;
      this.ring.style.top = `${p.y}px`;
      k = Math.max(0, 1 - r.stuntT / STUNT_IDEAL);
      inWindow = r.phase === 'stunt' && Math.abs(r.stuntT - STUNT_IDEAL) <= r.stuntWindow;
    } else if (this.ring.dataset.mode === 'reactor' && o) {
      const core = this.game.table.attractions.reactor.core;
      const p = this.project(core.x, core.y - 2.15, 3.55);
      this.ring.style.left = `${p.x}px`;
      this.ring.style.top = `${p.y}px`;
      const next = o.pulses.find((x) => !x.judged);
      if (next) {
        k = Math.max(0, Math.min(1, (next.at - o.t) / next.lap));
        inWindow = Math.abs(o.t - next.at) <= o.window;
        if (k < 0.98 && !this.ring.classList.contains('is-hit')) this.ringText.textContent = inWindow ? 'NOW!' : 'SYNC';
        if (k >= 0.98) this.ring.classList.remove('is-hit');
      }
    }
    this.ringCircle.style.transform = `translate(-50%, -50%) scale(${1 + k * 1.4})`;
    this.ringCircle.classList.toggle('is-window', inWindow);
  }

  dispose(): void {
    this.unsubscribe.forEach((u) => u());
    this.root.remove();
  }
}
