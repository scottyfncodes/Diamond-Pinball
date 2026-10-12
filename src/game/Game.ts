import { computeBatting, timingScore, type BattingResult, type ShotLane } from '../baseball/batting';
import { resolveDefense } from '../baseball/defense';
import { applyPlay, basesLoaded, createBaseballState } from '../baseball/rules';
import type { BaseballState, Play, PlayResult } from '../baseball/types';
import { EventBus } from '../core/EventBus';
import { clamp01 } from '../core/math';
import { Random } from '../core/Random';
import type { Vec2 } from '../physics/Vec2';
import { World } from '../physics/World';
import type { Ball, PhysicsEvent } from '../physics/types';
import { buildTable, type TableDef } from '../table/layout';
import { achievementById } from './achievements';
import type { GameEvents, GameState, GameSummary, LampState } from './events';
import { SaveStore, type Settings } from './save';
import { POINTS, applyScore, createCombo, registerComboShot, resetCombo, scoreMultiplier, tickCombo, type ComboState } from './scoring';

export interface GameOptions {
  innings: number;
  difficulty: Settings['difficulty'];
  seed?: number;
}

export interface BattingSession {
  lane: ShotLane;
  shotQuality: number;
  t: number;
  pitchDelay: number;
  windowSeconds: number;
  swung: boolean;
  resolved: boolean;
  /** Seconds after the swing before the next batting event may begin. */
  cooldown: number;
}

const DIFFICULTY = {
  rookie: { batting: 0.15, pitchClock: 26, defenseInterval: 11, ballSave: 15 },
  pro: { batting: 0.45, pitchClock: 20, defenseInterval: 9, ballSave: 12 },
  allstar: { batting: 0.8, pitchClock: 15, defenseInterval: 7.5, ballSave: 9 },
} as const;

export const BALLS_PER_GAME = 3;
export const PLAYER_SIDE = 'away' as const;
export const TEAM_NAMES = { away: 'SLUGGERS', home: 'RIVALS' } as const;

/**
 * Orchestrates the whole arcade loop: pinball physics events feed table modes,
 * table modes feed the baseball simulation, and the baseball situation lights
 * the table. Rendering, audio and HUD only observe the event bus.
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly world: World;
  readonly table: TableDef;
  readonly store: SaveStore;
  state: GameState = 'title';
  options: GameOptions = { innings: 3, difficulty: 'pro' };
  baseball: BaseballState = createBaseballState(3);
  rng = new Random(1);

  score = 0;
  ballsLeft = BALLS_PER_GAME;
  ballNumber = 0;
  combo: ComboState = createCombo();
  bonusLevel = 0;
  power = 0;
  hrLit = false;
  lockLit = false;
  lockedBalls = 0;
  multiball = false;
  leftFieldLit = false;
  rightFieldLit = false;
  kickbackLit = false;
  bankDown: Record<'leftField' | 'rightField', boolean[]> = { leftField: [false, false, false], rightField: [false, false, false] };
  bankResetTimer: Record<'leftField' | 'rightField', number> = { leftField: 0, rightField: 0 };
  baseTargetsHit = new Set<string>();
  topLanesHit = [false, false, false];
  litTopLane = 1;
  skillShotTimer = 0;
  ballSaveTimer = 0;
  batting: BattingSession | null = null;
  pitchClock = 0;
  defenseClock = 0;
  defenseRating = 0.3;
  litFielderTarget: 'base_1b' | 'base_3b' = 'base_1b';
  fielderRotateTimer = 4;
  stealCooldown = 0;
  autoLaunchTimer = 0;
  autoLaunchPending = false;
  plunger = { charging: false, charge: 0 };
  flippersPressed = { left: false, right: false };
  stats = { hits: 0, homeRuns: 0, runs: 0, rampStreak: 0, bestRampStreak: 0, doublePlays: 0, steals: 0, perfect: 0, trailedInFinal: false };
  earnedThisGame: string[] = [];
  summary: GameSummary | null = null;
  elapsed = 0;
  private wallSoundTimer = 0;
  private lampStates = new Map<string, LampState>();

  constructor(store: SaveStore = new SaveStore()) {
    this.store = store;
    this.world = new World();
    this.table = buildTable(this.world);
  }

  // ------------------------------------------------------------------ lifecycle

  get offense(): boolean {
    return (this.baseball.half === 'top') === (PLAYER_SIDE === 'away');
  }

  get difficulty() {
    return DIFFICULTY[this.options.difficulty];
  }

  get playerRuns(): number {
    return this.baseball[PLAYER_SIDE].runs;
  }

  get cpuRuns(): number {
    return this.baseball[PLAYER_SIDE === 'away' ? 'home' : 'away'].runs;
  }

  get multiplier(): number {
    return scoreMultiplier(this.playerRuns, this.multiball, this.bonusLevel);
  }

  startGame(options: Partial<GameOptions> = {}): void {
    this.options = { innings: this.store.data.settings.innings, difficulty: this.store.data.settings.difficulty, ...options };
    this.rng = new Random(this.options.seed ?? (Date.now() & 0xffffffff));
    this.world.reset();
    this.baseball = createBaseballState(this.options.innings);
    this.score = 0;
    this.ballsLeft = BALLS_PER_GAME;
    this.ballNumber = 0;
    this.combo = createCombo();
    this.bonusLevel = 0;
    this.power = 0;
    this.hrLit = false;
    this.lockLit = false;
    this.lockedBalls = 0;
    this.multiball = false;
    this.leftFieldLit = false;
    this.rightFieldLit = false;
    this.kickbackLit = false;
    this.bankDown = { leftField: [false, false, false], rightField: [false, false, false] };
    this.bankResetTimer = { leftField: 0, rightField: 0 };
    this.baseTargetsHit.clear();
    this.topLanesHit = [false, false, false];
    this.litTopLane = 1;
    this.skillShotTimer = 0;
    this.ballSaveTimer = 0;
    this.batting = null;
    this.pitchClock = this.difficulty.pitchClock;
    this.defenseClock = this.difficulty.defenseInterval;
    this.defenseRating = 0.3;
    this.stealCooldown = 0;
    this.autoLaunchTimer = 0;
    this.autoLaunchPending = false;
    this.plunger = { charging: false, charge: 0 };
    this.flippersPressed = { left: false, right: false };
    this.stats = { hits: 0, homeRuns: 0, runs: 0, rampStreak: 0, bestRampStreak: 0, doublePlays: 0, steals: 0, perfect: 0, trailedInFinal: false };
    this.earnedThisGame = [];
    this.summary = null;
    this.elapsed = 0;
    this.lampStates.clear();
    this.setState('playing');
    this.bus.emit('baseball', { state: this.baseball });
    this.bus.emit('modeChange', { offense: this.offense });
    this.refreshLamps();
    this.serveBall();
    this.bus.emit('toast', { text: this.offense ? 'PLAY BALL!' : 'TAKE THE FIELD!', kind: 'great', sub: this.offense ? 'Shoot a ramp to bat' : 'Keep the ball busy to make outs', duration: 2.6 });
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.setState('playing');
  }

  togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  restart(): void {
    this.startGame(this.options);
  }

  quitToTitle(): void {
    this.world.reset();
    this.batting = null;
    this.setState('title');
  }

  private setState(state: GameState): void {
    const prev = this.state;
    if (prev === state) return;
    this.state = state;
    if (state !== 'playing') {
      this.world.setFlipper('left_flipper', false);
      this.world.setFlipper('right_flipper', false);
      this.plunger.charging = false;
    }
    this.bus.emit('stateChange', { state, prev });
  }

  // ------------------------------------------------------------------ input

  setFlipper(side: 'left' | 'right', pressed: boolean): void {
    if (this.state !== 'playing') return;
    if (this.flippersPressed[side] === pressed) return;
    this.flippersPressed[side] = pressed;
    this.world.setFlipper(side === 'left' ? 'left_flipper' : 'right_flipper', pressed);
    this.bus.emit('flipper', { id: side, pressed });
    if (pressed) {
      // Lane change: pressing a flipper rotates the lit top lane.
      if (!this.topLanesHit.every(Boolean)) {
        this.litTopLane = (this.litTopLane + (side === 'left' ? 2 : 1)) % 3;
        this.refreshTopLaneLamps();
      }
      this.trySwing();
    }
  }

  plungerDown(): void {
    if (this.state !== 'playing') return;
    const ball = this.launcherBall();
    if (!ball) return;
    this.plunger.charging = true;
    this.plunger.charge = 0;
  }

  plungerUp(): void {
    if (!this.plunger.charging) return;
    this.plunger.charging = false;
    const ball = this.launcherBall();
    if (!ball) return;
    this.launch(ball, Math.max(0.35, this.plunger.charge), true);
    this.plunger.charge = 0;
    this.bus.emit('plungerCharge', { charge: 0 });
  }

  /** Taps launch with a strong plunge (used by keyboard shortcut and tutorial). */
  quickLaunch(): void {
    const ball = this.launcherBall();
    if (!ball || this.state !== 'playing') return;
    this.launch(ball, 0.85, true);
  }

  launcherBall(): Ball | undefined {
    return this.world.balls.find((b) => b.state === 'launcher');
  }

  // ------------------------------------------------------------------ frame update

  update(dt: number): void {
    if (this.state !== 'playing') return;
    dt = Math.min(dt, 0.1);
    this.elapsed += dt;
    this.updateTimers(dt);
    const events = this.world.step(dt);
    for (const e of events) this.handlePhysicsEvent(e);
    if (this.wallSoundTimer > 0) this.wallSoundTimer -= dt;
  }

  private updateTimers(dt: number): void {
    if (this.plunger.charging) {
      this.plunger.charge = Math.min(1, this.plunger.charge + dt / 1.1);
      this.bus.emit('plungerCharge', { charge: this.plunger.charge });
    }
    if (this.autoLaunchPending) {
      this.autoLaunchTimer -= dt;
      if (this.autoLaunchTimer <= 0) {
        this.autoLaunchPending = false;
        const ball = this.launcherBall();
        if (ball) this.launch(ball, 0.7 + this.rng.next() * 0.25, false);
      }
    }
    if (this.ballSaveTimer > 0) {
      this.ballSaveTimer -= dt;
      if (this.ballSaveTimer <= 0) this.setLamp('lamp_kickback', this.kickbackLit ? 'on' : 'off');
    }
    if (this.skillShotTimer > 0) this.skillShotTimer -= dt;
    if (this.stealCooldown > 0) this.stealCooldown -= dt;
    if (tickCombo(this.combo, dt)) {
      this.stats.rampStreak = 0;
      this.bus.emit('combo', { count: 0, best: this.combo.best, broke: true });
    }
    for (const bank of ['leftField', 'rightField'] as const) {
      if (this.bankResetTimer[bank] > 0) {
        this.bankResetTimer[bank] -= dt;
        if (this.bankResetTimer[bank] <= 0) this.resetBank(bank);
      }
    }

    const ballInPlay = this.world.balls.some((b) => b.state === 'free' || b.state === 'guided');
    if (this.batting) this.updateBatting(dt);
    else if (ballInPlay && !this.baseball.gameOver) {
      if (this.offense) {
        this.pitchClock -= dt;
        this.bus.emit('pitchClock', { seconds: Math.max(0, this.pitchClock), total: this.difficulty.pitchClock });
        if (this.pitchClock <= 0) {
          this.pitchClock = this.difficulty.pitchClock;
          this.calledStrike();
        }
      } else {
        this.defenseRating = Math.max(0, this.defenseRating - 0.035 * dt);
        this.defenseClock -= dt;
        this.fielderRotateTimer -= dt;
        if (this.fielderRotateTimer <= 0) {
          this.fielderRotateTimer = 4;
          this.litFielderTarget = this.litFielderTarget === 'base_1b' ? 'base_3b' : 'base_1b';
          this.refreshBaseLamps();
        }
        this.bus.emit('defensePitch', { secondsToPitch: Math.max(0, this.defenseClock) });
        if (this.defenseClock <= 0) {
          this.defenseClock = this.difficulty.defenseInterval;
          this.resolveOpponentAtBat(false, 'The batter puts it in play.');
        }
      }
    }
  }

  // ------------------------------------------------------------------ balls

  private serveBall(extra = false, autoLaunch = false): Ball {
    const ball = this.world.createLauncherBall(extra);
    if (!extra) this.ballNumber += 1;
    this.bus.emit('ballServed', { ball, ballsLeft: this.ballsLeft, extra });
    if (autoLaunch) {
      this.autoLaunchPending = true;
      this.autoLaunchTimer = 0.9;
    }
    return ball;
  }

  private launch(ball: Ball, power: number, manual: boolean): void {
    this.world.launch(ball, power);
    this.ballSaveTimer = this.difficulty.ballSave;
    this.skillShotTimer = manual ? 3.5 : 0;
    this.bus.emit('launch', { power, ball });
    if (manual) this.bus.emit('toast', { text: 'SKILL SHOT', kind: 'info', sub: 'Hit the lit top lane', duration: 1.4 });
  }

  private onDrain(ball: Ball): void {
    this.world.removeBall(ball);
    this.bus.emit('drain', { ball });
    resetCombo(this.combo);
    this.stats.rampStreak = 0;
    this.bus.emit('combo', { count: 0, best: this.combo.best, broke: true });
    const remaining = this.world.balls.filter((b) => b.state !== 'drained' && b.state !== 'locked').length;
    if (remaining > 0) {
      if (this.multiball && remaining === 1) this.endMultiball();
      return;
    }
    if (this.multiball) this.endMultiball();
    if (this.batting) this.cancelBatting();
    if (this.ballSaveTimer > 0) {
      this.ballSaveTimer = 0;
      this.bus.emit('ballSaved', { ball });
      this.bus.emit('toast', { text: 'BALL SAVED', kind: 'good', duration: 1.4 });
      this.serveBall(false, true);
      this.ballNumber -= 1; // same ball
      return;
    }
    this.ballsLeft -= 1;
    this.bus.emit('ballLost', { ballsLeft: this.ballsLeft, ball });
    if (this.ballsLeft <= 0) {
      this.finishGame('ballsLost');
      return;
    }
    this.power = 0;
    this.bus.emit('power', { level: 0 });
    this.refreshLamps();
    this.bus.emit('toast', { text: 'BALL LOST', kind: 'bad', sub: `${this.ballsLeft} ball${this.ballsLeft === 1 ? '' : 's'} left`, duration: 1.8 });
    this.serveBall();
  }

  // ------------------------------------------------------------------ physics event routing

  private handlePhysicsEvent(e: PhysicsEvent): void {
    switch (e.type) {
      case 'hit':
        this.onHit(e.colliderId, e.kind, e.speed, e.point, e.ball);
        break;
      case 'flipperHit':
        this.bus.emit('flipperHit', { at: e.point, speed: e.speed });
        break;
      case 'sensor':
        this.onSensor(e.sensorId, e.ball, e.speed);
        break;
      case 'rampEnter':
        this.onRamp(e.rampId, e.quality, e.ball);
        break;
      case 'rampExit':
        this.bus.emit('rampExit', { id: e.rampId });
        break;
      case 'drain':
        this.onDrain(e.ball);
        break;
      case 'stuckRecovered':
        this.bus.emit('stuck', { method: e.method });
        if (e.method === 'relaunch') {
          this.bus.emit('toast', { text: 'BALL RESCUED', kind: 'info', sub: 'Back to the plunger', duration: 1.5 });
          this.autoLaunchPending = true;
          this.autoLaunchTimer = 0.8;
        }
        break;
      case 'ballBall':
        this.bus.emit('wallHit', { at: e.a.pos, speed: e.speed, kind: 'ball' });
        break;
      case 'released':
        break;
      case 'launched':
        break;
    }
  }

  private onHit(id: string, kind: string, speed: number, at: Vec2, _ball: Ball): void {
    switch (kind) {
      case 'bumper':
        this.addScore(POINTS.bumper, at);
        this.bus.emit('bumper', { id, at, speed });
        this.addDefense(0.07);
        break;
      case 'slingshot':
        this.addScore(POINTS.slingshot, at);
        this.bus.emit('slingshot', { id, at });
        this.addDefense(0.03);
        break;
      case 'target':
        this.onTarget(id, at);
        break;
      case 'post':
        if (speed > 12) {
          this.addScore(POINTS.post);
          this.bus.emit('wallHit', { at, speed, kind: 'post' });
        }
        break;
      default:
        if (speed > 10 && this.wallSoundTimer <= 0) {
          this.wallSoundTimer = 0.05;
          this.bus.emit('wallHit', { at, speed, kind });
        }
    }
  }

  private onTarget(id: string, at: Vec2): void {
    if (id.startsWith('leftField') || id.startsWith('rightField')) {
      const bank = id.startsWith('leftField') ? 'leftField' : 'rightField';
      const index = Number(id.split('_')[1]);
      if (this.bankDown[bank][index]) return;
      this.bankDown[bank][index] = true;
      this.world.setColliderEnabled(id, false);
      this.addScore(POINTS.dropTarget, at);
      this.bus.emit('target', { id, down: true, at });
      this.addDefense(0.1);
      if (this.bankDown[bank].every(Boolean)) {
        this.addScore(POINTS.bankComplete, at, bank === 'leftField' ? 'LEFT FIELD' : 'RIGHT FIELD');
        registerComboShot(this.combo);
        this.bus.emit('combo', { count: this.combo.count, best: this.combo.best, broke: false });
        this.bankResetTimer[bank] = 1.4;
        if (this.offense) {
          if (bank === 'leftField') this.leftFieldLit = true;
          else this.rightFieldLit = true;
          this.bus.emit('toast', { text: `${bank === 'leftField' ? 'LEFT' : 'RIGHT'} FIELD LIT`, kind: 'good', sub: `Next ${bank === 'leftField' ? 'left' : 'right'} ramp hits harder`, duration: 1.8 });
        } else {
          this.bus.emit('toast', { text: 'WEB GEM!', kind: 'great', sub: 'Bank complete: the defense makes a play', duration: 1.8 });
          this.instantOut('A diving catch ends the at-bat!');
        }
        this.refreshLamps();
      }
      return;
    }
    if (id === 'base_1b' || id === 'base_3b') {
      this.addScore(POINTS.standupTarget, at);
      this.bus.emit('target', { id, down: false, at });
      this.onBaseTarget(id === 'base_1b' ? 1 : 3, id);
    }
  }

  private onBaseTarget(base: 1 | 2 | 3, id: string): void {
    if (this.offense) {
      const runner = this.baseball.bases[base - 1];
      if (runner && this.stealCooldown <= 0 && !this.batting) {
        const { state, result } = applyPlay(this.baseball, { type: 'steal', base });
        if (result.moves.length) {
          this.stealCooldown = 2.5;
          this.commitBaseball(state, result, true);
          this.stats.steals += 1;
          this.addScore(POINTS.stolenBase, undefined, 'STEAL');
          this.bus.emit('steal', { base, play: result });
          this.bus.emit('toast', { text: result.label, kind: result.runs ? 'great' : 'good', sub: result.description, duration: 1.6 });
          this.award('steal');
          return;
        }
      }
      if (!this.baseTargetsHit.has(id)) {
        this.baseTargetsHit.add(id);
        if (this.baseTargetsHit.size >= 3 && !this.lockLit) {
          this.lockLit = true;
          this.bus.emit('toast', { text: 'LOCK IS LIT', kind: 'good', sub: 'Shoot the dugout to lock a ball', duration: 1.8 });
        }
      }
      this.refreshBaseLamps();
    } else {
      // Defense: the lit fielder target makes a play.
      this.addDefense(0.12);
      if (id === this.litFielderTarget) {
        this.fielderRotateTimer = 4;
        this.litFielderTarget = this.litFielderTarget === 'base_1b' ? 'base_3b' : 'base_1b';
        this.instantOut('The infielder makes the play!');
        this.refreshBaseLamps();
      }
    }
  }

  private onSensor(id: string, ball: Ball, speed: number): void {
    switch (id) {
      case 'center_lane':
        this.addScore(POINTS.centerLane, this.table.lanes.find((l) => l.id === id)?.a);
        this.bus.emit('lane', { id });
        if (this.offense) {
          if (this.power < 3) {
            this.power += 1;
            this.bus.emit('power', { level: this.power });
            this.bus.emit('toast', { text: `POWER ${this.power}`, kind: 'good', sub: this.power === 3 ? 'Max batting power!' : 'Batting power charged', duration: 1.2 });
          }
          registerComboShot(this.combo);
          this.bus.emit('combo', { count: this.combo.count, best: this.combo.best, broke: false });
          this.onBaseTarget(2, 'center_lane');
        } else {
          this.addDefense(0.25);
          this.bus.emit('toast', { text: 'INFIELD SHIFT', kind: 'good', sub: 'Defense rating up', duration: 1.2 });
        }
        this.refreshLamps();
        break;
      case 'top_lane_0':
      case 'top_lane_1':
      case 'top_lane_2': {
        const index = Number(id.slice(-1));
        this.addScore(POINTS.topLane);
        this.bus.emit('lane', { id });
        this.addDefense(0.1);
        if (this.skillShotTimer > 0 && index === this.litTopLane) {
          this.skillShotTimer = 0;
          this.addScore(POINTS.skillShot, undefined, 'SKILL SHOT');
          this.bus.emit('skillShot', { points: POINTS.skillShot });
          this.bus.emit('toast', { text: 'SKILL SHOT!', kind: 'great', sub: `+${POINTS.skillShot.toLocaleString()}`, duration: 1.8 });
          this.award('skill_shot');
          if (this.offense && this.power < 3) {
            this.power += 1;
            this.bus.emit('power', { level: this.power });
          }
        }
        if (!this.topLanesHit[index]) {
          this.topLanesHit[index] = true;
          if (this.topLanesHit.every(Boolean)) {
            this.topLanesHit = [false, false, false];
            this.bonusLevel = Math.min(2, this.bonusLevel + 1);
            this.kickbackLit = true;
            this.addScore(POINTS.topLanesComplete, undefined, 'LANES');
            this.bus.emit('toast', { text: 'BONUS X UP', kind: 'good', sub: 'Kickback lit', duration: 1.6 });
          }
        }
        this.refreshTopLaneLamps();
        this.refreshLamps();
        break;
      }
      case 'hr_lane':
        this.onHomeRunLane(speed, ball);
        break;
      case 'dugout':
        this.onSaucer(ball);
        break;
      case 'left_inlane':
      case 'right_inlane':
        this.addScore(POINTS.inlane);
        this.bus.emit('lane', { id });
        break;
      case 'left_outlane':
        if (!this.kickbackLit && !this.multiball && this.ballSaveTimer <= 0) this.bus.emit('toast', { text: 'OUTLANE', kind: 'bad', duration: 0.9 });
        break;
      case 'right_outlane':
        if (!this.multiball && this.ballSaveTimer <= 0) this.bus.emit('toast', { text: 'OUTLANE', kind: 'bad', duration: 0.9 });
        break;
      case 'kickback':
        if (this.kickbackLit && ball.state === 'free') {
          this.kickbackLit = false;
          ball.vel = { x: 0.6, y: 150 };
          ball.pos = { x: 0.9, y: 3.2 };
          this.addScore(POINTS.kickback, undefined, 'KICKBACK');
          this.bus.emit('kickback', { ball });
          this.bus.emit('toast', { text: 'KICKBACK!', kind: 'good', duration: 1.2 });
          this.refreshLamps();
        }
        break;
      case 'launch_bottom':
        if (ball.state === 'free' && ball.vel.y <= 0 && ball.pos.x > 20.2) {
          // Weak plunge rolled back: re-arm the plunger.
          this.world.resetBallToLauncher(ball);
          this.ballSaveTimer = 0;
        }
        break;
    }
  }

  private onHomeRunLane(speed: number, _ball: Ball): void {
    const quality = clamp01((speed - 25) / 75);
    this.addScore(POINTS.hrLane, { x: 1.3, y: 30 });
    this.bus.emit('lane', { id: 'hr_lane' });
    registerComboShot(this.combo);
    this.bus.emit('combo', { count: this.combo.count, best: this.combo.best, broke: false });
    if (this.offense) {
      if (this.hrLit && !this.batting) {
        this.hrLit = false;
        this.startBatting('homeRun', Math.max(quality, 0.4));
      } else if (!this.hrLit) {
        this.hrLit = true;
        this.bus.emit('toast', { text: 'HOME RUN LANE LIT', kind: 'good', sub: 'Shoot it again for a premium at-bat', duration: 1.8 });
      }
    } else {
      const lead = this.baseball.bases[2] ? 3 : this.baseball.bases[1] ? 2 : this.baseball.bases[0] ? 1 : 0;
      if (lead) {
        const { state, result } = applyPlay(this.baseball, { type: 'caughtStealing', base: lead as 1 | 2 | 3 });
        this.commitBaseball(state, result, false);
        this.addScore(POINTS.defenseOut, undefined, 'PICKOFF');
        this.bus.emit('toast', { text: 'PICKED OFF!', kind: 'great', sub: 'Runner caught leaning', duration: 1.6 });
        this.bus.emit('defenseResult', { result: { play: result.play, quality: 1, direction: 'center', trajectory: 'ground', distance: 0.2, reason: 'Picked off.' }, play: result, state, instant: true, reason: 'Pickoff!' });
      } else {
        this.addDefense(0.3);
        this.bus.emit('toast', { text: 'BULLPEN HEAT', kind: 'good', sub: 'Defense rating way up', duration: 1.2 });
      }
    }
    this.refreshLamps();
  }

  private onSaucer(ball: Ball): void {
    if (ball.state !== 'free') return;
    const pos = this.table.saucer.pos;
    if (this.lockLit && this.lockedBalls < 2 && !this.multiball) {
      this.lockedBalls += 1;
      this.lockLit = false;
      this.baseTargetsHit.clear();
      this.world.lockBall(ball, pos);
      this.addScore(POINTS.lock, pos, 'LOCK');
      this.bus.emit('saucer', { ball, locked: true, lockedCount: this.lockedBalls });
      this.bus.emit('toast', { text: `BALL ${this.lockedBalls} LOCKED`, kind: 'great', sub: this.lockedBalls >= 2 ? 'Light lock again for MULTIBALL' : 'Hit the bases again to relight lock', duration: 2 });
      this.serveBall(true, true);
      this.refreshLamps();
      return;
    }
    if (this.lockLit && this.lockedBalls >= 2 && !this.multiball) {
      this.lockLit = false;
      this.baseTargetsHit.clear();
      this.world.holdBall(ball, pos, 1.2, { x: -10, y: -75 }, { x: 18.6, y: 27.2 });
      this.startMultiball();
      this.refreshLamps();
      return;
    }
    this.world.holdBall(ball, pos, 0.9, { x: -10, y: -75 }, { x: 18.6, y: 27.2 });
    this.addScore(POINTS.centerLane, pos, 'DUGOUT');
    this.bus.emit('saucer', { ball, locked: false, lockedCount: this.lockedBalls });
    if (this.offense && this.power < 3) {
      this.power += 1;
      this.bus.emit('power', { level: this.power });
      this.bus.emit('toast', { text: 'DUGOUT', kind: 'info', sub: 'Batting power +1', duration: 1.2 });
    } else if (!this.offense) {
      this.addDefense(0.2);
    }
    this.refreshLamps();
  }

  private startMultiball(): void {
    this.multiball = true;
    this.addScore(POINTS.multiballStart, undefined, 'MULTIBALL');
    const locked = this.world.balls.filter((b) => b.state === 'locked');
    let delay = 0.3;
    for (const b of locked) {
      // Stagger the release so the balls do not overlap.
      this.world.holdBall(b, this.table.saucer.pos, 1.2 + delay, { x: -12, y: -75 }, { x: 18.6, y: 27.2 });
      delay += 0.7;
    }
    this.lockedBalls = 0;
    this.bus.emit('multiball', { active: true, balls: this.world.balls.length });
    this.bus.emit('toast', { text: 'MULTIBALL!', kind: 'epic', sub: 'Every ramp is a JACKPOT at-bat', duration: 2.6 });
    this.bus.emit('cameraEvent', { kind: 'multiball' });
    this.award('multiball');
    this.refreshLamps();
  }

  private endMultiball(): void {
    if (!this.multiball) return;
    this.multiball = false;
    this.bus.emit('multiball', { active: false, balls: this.world.balls.length });
    this.bus.emit('toast', { text: 'MULTIBALL OVER', kind: 'info', duration: 1.2 });
    this.refreshLamps();
  }

  private onRamp(id: string, quality: number, _ball: Ball): void {
    const lane: ShotLane = id === 'left_ramp' ? 'left' : 'right';
    registerComboShot(this.combo);
    this.stats.rampStreak += 1;
    this.stats.bestRampStreak = Math.max(this.stats.bestRampStreak, this.stats.rampStreak);
    if (this.stats.rampStreak >= 3) this.award('ramp_streak');
    this.bus.emit('combo', { count: this.combo.count, best: this.combo.best, broke: false });
    const pts = POINTS.ramp + Math.round(POINTS.rampQualityBonus * quality) + (this.multiball ? POINTS.jackpot : 0);
    this.addScore(pts, this.table.ramps.find((r) => r.id === id)?.entrance.a, this.multiball ? 'JACKPOT' : 'RAMP');
    this.bus.emit('rampEnter', { id, quality });
    if (this.baseball.gameOver) return;
    if (this.offense) {
      if (!this.batting) this.startBatting(lane, quality);
      else this.bus.emit('toast', { text: 'COMBO!', kind: 'good', sub: 'Already swinging: bonus points', duration: 1 });
    } else {
      this.addDefense(0.3);
      this.instantOut('Strike three! The ramp shot blows the batter away.', { type: 'strikeout' });
      this.addScore(POINTS.strikeoutPitch, undefined, 'K');
    }
  }

  // ------------------------------------------------------------------ batting (offense)

  startBatting(lane: ShotLane, shotQuality: number): void {
    if (this.batting || !this.offense || this.baseball.gameOver) return;
    this.batting = { lane, shotQuality, t: 0, pitchDelay: 1.05, windowSeconds: 0.3, swung: false, resolved: false, cooldown: 0.8 };
    this.pitchClock = this.difficulty.pitchClock;
    this.bus.emit('battingStart', { lane, shotQuality, pitchDelay: this.batting.pitchDelay, windowSeconds: this.batting.windowSeconds, half: this.baseball.half, power: this.power });
  }

  private cancelBatting(): void {
    this.batting = null;
  }

  private updateBatting(dt: number): void {
    const b = this.batting!;
    b.t += dt;
    if (!b.swung && b.t >= b.pitchDelay + b.windowSeconds * 0.9) {
      this.swing(0.5, true);
    } else if (b.swung) {
      b.cooldown -= dt;
      if (b.cooldown <= 0) this.batting = null;
    }
  }

  private trySwing(): void {
    const b = this.batting;
    if (!b || b.swung) return;
    const offset = b.t - b.pitchDelay;
    if (offset < -0.75) return; // batter waits on the pitch
    this.swing(timingScore(offset, b.windowSeconds), false);
  }

  private swing(timing: number, auto: boolean): void {
    const b = this.batting;
    if (!b || b.swung) return;
    b.swung = true;
    b.cooldown = 0.9;
    this.bus.emit('battingSwing', { timing, auto });
    const fieldBonus = (b.lane === 'left' && this.leftFieldLit) || (b.lane === 'right' && this.rightFieldLit);
    const result = computeBatting(
      {
        shotQuality: b.shotQuality,
        timing,
        power: this.power,
        combo: this.combo.count,
        lane: b.lane,
        fieldBonus,
        multiball: this.multiball,
        hrLit: b.lane === 'homeRun',
        difficulty: this.difficulty.batting,
        runnerOnFirst: !!this.baseball.bases[0],
        outs: this.baseball.outs,
      },
      this.rng,
    );
    if (b.lane === 'left') this.leftFieldLit = false;
    if (b.lane === 'right') this.rightFieldLit = false;
    this.power = 0;
    this.bus.emit('power', { level: 0 });
    this.resolveBattingResult(result, b.lane);
  }

  private resolveBattingResult(result: BattingResult, lane: ShotLane): void {
    const { state, result: play } = applyPlay(this.baseball, result.play);
    const prevHits = this.baseball[PLAYER_SIDE].hits;
    this.commitBaseball(state, play, true);
    if (result.grade === 'perfect') {
      this.stats.perfect += 1;
      this.addScore(POINTS.perfectContact, undefined, 'PERFECT');
      this.award('perfect_contact');
    }
    if (play.hit) {
      this.stats.hits += 1;
      const base = result.play.type === 'single' ? POINTS.single : result.play.type === 'double' ? POINTS.double : result.play.type === 'triple' ? POINTS.triple : play.grandSlam ? POINTS.grandSlam : POINTS.homeRun;
      this.addScore(base, undefined, play.label);
    }
    if (result.play.type === 'homeRun') {
      this.stats.homeRuns += 1;
      this.award('first_hr');
      if (this.stats.homeRuns >= 3) this.award('three_hr');
      if (play.grandSlam) {
        this.award('grand_slam');
        this.grantExtraBall();
      }
      this.ballSaveTimer = Math.max(this.ballSaveTimer, 6);
      this.bus.emit('cameraEvent', { kind: 'homeRun', direction: result.direction, distance: result.distance });
    }
    if (basesLoaded(state)) this.award('bases_loaded');
    if (play.runs > 0) {
      this.stats.runs += play.runs;
      this.addScore(POINTS.run * play.runs, undefined, play.runs > 1 ? `${play.runs} RUNS` : 'RUN');
    }
    const kind = result.play.type === 'homeRun' ? 'epic' : play.hit || play.runs ? 'great' : result.grade === 'foul' ? 'info' : 'bad';
    this.bus.emit('battingResult', { result, play, state, lane });
    this.bus.emit('toast', { text: play.label, kind, sub: result.reason, duration: result.play.type === 'homeRun' ? 3 : 2 });
    void prevHits;
    this.pitchClock = this.difficulty.pitchClock;
  }

  private calledStrike(): void {
    const { state, result } = applyPlay(this.baseball, { type: 'strike' });
    this.commitBaseball(state, result, true);
    this.bus.emit('strike', { strikes: state.strikes, reason: 'Pitch clock expired' });
    this.bus.emit('toast', { text: result.label, kind: 'bad', sub: result.outs ? 'Too slow: strikeout looking' : 'Shoot a ramp before the pitch clock runs out', duration: 1.8 });
  }

  // ------------------------------------------------------------------ defense (opponent batting)

  private addDefense(amount: number): void {
    if (this.offense) return;
    this.defenseRating = Math.min(1, this.defenseRating + amount);
  }

  private instantOut(reason: string, play?: Play): void {
    if (this.offense || this.baseball.gameOver) return;
    let p: Play = play ?? { type: 'flyOut' };
    if (!play) {
      const dp = !!this.baseball.bases[0] && this.baseball.outs < 2 && this.defenseRating >= 0.5;
      p = dp ? { type: 'groundOut', doublePlay: true } : this.rng.chance(0.5) ? { type: 'groundOut' } : { type: 'flyOut' };
    }
    const { state, result } = applyPlay(this.baseball, p);
    this.commitBaseball(state, result, false);
    this.scoreDefensivePlay(result);
    this.bus.emit('defenseResult', {
      result: { play: p, quality: 1, direction: this.rng.pick(['left', 'center', 'right'] as const), trajectory: p.type === 'flyOut' ? 'fly' : 'ground', distance: p.type === 'flyOut' ? 0.75 : 0.35, reason },
      play: result,
      state,
      instant: true,
      reason,
    });
    this.bus.emit('toast', { text: result.label, kind: result.doublePlay ? 'great' : 'good', sub: reason, duration: 1.8 });
    this.defenseClock = this.difficulty.defenseInterval;
  }

  private resolveOpponentAtBat(instant: boolean, reason: string): void {
    if (this.offense || this.baseball.gameOver) return;
    const res = resolveDefense(
      { defenseRating: this.defenseRating, inning: this.baseball.inning, difficulty: this.difficulty.batting, runnerOnFirst: !!this.baseball.bases[0], outs: this.baseball.outs },
      this.rng,
    );
    this.defenseRating *= 0.45;
    const { state, result } = applyPlay(this.baseball, res.play);
    this.commitBaseball(state, result, false);
    this.scoreDefensivePlay(result);
    this.bus.emit('defenseResult', { result: res, play: result, state, instant, reason: res.reason });
    const kind = result.outs ? (result.doublePlay ? 'great' : 'good') : result.runs ? 'bad' : 'info';
    this.bus.emit('toast', { text: result.label, kind, sub: res.reason, duration: 1.8 });
    void reason;
  }

  private scoreDefensivePlay(result: PlayResult): void {
    if (result.doublePlay) {
      this.stats.doublePlays += 1;
      this.addScore(POINTS.doublePlay, undefined, 'DOUBLE PLAY');
      this.award('double_play');
    } else if (result.outs) {
      this.addScore(POINTS.defenseOut * result.outs, undefined, 'OUT');
    }
  }

  // ------------------------------------------------------------------ baseball bookkeeping

  private commitBaseball(state: BaseballState, result: PlayResult, offense: boolean): void {
    const wasOffense = this.offense;
    this.baseball = state;
    this.bus.emit('playResult', { play: result, state, offense });
    this.bus.emit('baseball', { state });
    if (!wasOffense && this.baseball.inning >= this.baseball.totalInnings && this.cpuRuns > this.playerRuns) this.stats.trailedInFinal = true;
    if (result.halfInningEnded && !state.gameOver) {
      this.onHalfInning();
    }
    this.refreshLamps();
    if (state.gameOver) this.finishGame('complete');
  }

  private onHalfInning(): void {
    this.batting = null;
    this.pitchClock = this.difficulty.pitchClock;
    this.defenseClock = this.difficulty.defenseInterval;
    this.defenseRating = 0.35;
    this.stealCooldown = 0;
    this.addScore(POINTS.inningComplete, undefined, 'INNING');
    const offense = this.offense;
    this.bus.emit('halfInning', { state: this.baseball, offense });
    this.bus.emit('modeChange', { offense });
    const inn = `${this.baseball.half === 'top' ? 'TOP' : 'BOTTOM'} ${this.baseball.inning}`;
    this.bus.emit('toast', {
      text: offense ? `${inn}: YOU'RE UP` : `${inn}: DEFENSE`,
      kind: 'info',
      sub: offense ? 'Shoot ramps to bat, bases to steal' : 'Bumpers and targets make outs, ramps strike out',
      duration: 2.6,
    });
  }

  private grantExtraBall(): void {
    this.ballsLeft += 1;
    this.bus.emit('extraBall', {});
    this.bus.emit('toast', { text: 'EXTRA BALL!', kind: 'epic', duration: 2 });
  }

  private finishGame(reason: 'complete' | 'ballsLost'): void {
    if (this.state === 'gameover') return;
    const won = this.baseball.gameOver ? this.baseball.winner === PLAYER_SIDE : this.playerRuns > this.cpuRuns;
    const tie = !this.baseball.gameOver && this.playerRuns === this.cpuRuns;
    if (reason === 'complete' && won) {
      this.addScore(POINTS.win, undefined, 'WIN');
      if (this.cpuRuns === 0) this.addScore(POINTS.shutout, undefined, 'SHUTOUT');
      this.award('complete_win');
      if (this.stats.trailedInFinal) this.award('comeback');
    }
    const stats = this.store.data.stats;
    stats.gamesPlayed += 1;
    stats.totalHomeRuns += this.stats.homeRuns;
    stats.totalRuns += this.playerRuns;
    if (won && reason === 'complete') stats.wins += 1;
    stats.bestCombo = Math.max(stats.bestCombo, this.combo.best);
    const rank = this.store.submitHighScore({
      name: this.store.data.settings.playerName || 'YOU',
      pinballScore: this.score,
      homeRuns: this.stats.homeRuns,
      hits: this.stats.hits,
      runsFor: this.playerRuns,
      runsAgainst: this.cpuRuns,
      won: won && reason === 'complete',
      innings: this.options.innings,
      date: new Date().toISOString().slice(0, 10),
    });
    this.summary = {
      pinballScore: this.score,
      baseball: this.baseball,
      playerRuns: this.playerRuns,
      cpuRuns: this.cpuRuns,
      won: reason === 'complete' ? won : this.playerRuns > this.cpuRuns,
      tie,
      completed: reason === 'complete',
      hits: this.stats.hits,
      homeRuns: this.stats.homeRuns,
      bestCombo: this.combo.best,
      achievements: [...this.store.data.achievements],
      newAchievements: [...this.earnedThisGame],
      highScoreRank: rank,
      innings: this.options.innings,
      reason,
    };
    this.world.reset();
    this.batting = null;
    this.setState('gameover');
    this.bus.emit('gameOver', this.summary);
  }

  // ------------------------------------------------------------------ helpers

  private addScore(points: number, at?: Vec2, label?: string): void {
    const gained = applyScore(points, this.multiplier, this.combo.count);
    this.score += gained;
    this.bus.emit('score', { points: gained, total: this.score, at, label });
  }

  private award(id: string): void {
    const def = achievementById(id);
    if (!def) return;
    if (!this.store.unlockAchievement(id)) return;
    this.earnedThisGame.push(id);
    if (def.unlock) this.store.unlock(def.unlock.id);
    this.bus.emit('achievement', { id, title: def.title, description: def.description, unlock: def.unlock?.title });
  }

  private resetBank(bank: 'leftField' | 'rightField'): void {
    this.bankDown[bank] = [false, false, false];
    for (let i = 0; i < 3; i++) this.world.setColliderEnabled(`${bank}_${i}`, true);
    this.bus.emit('bankReset', { bank });
  }

  private setLamp(id: string, state: LampState): void {
    if (this.lampStates.get(id) === state) return;
    this.lampStates.set(id, state);
    this.bus.emit('lamp', { id, state });
  }

  private refreshTopLaneLamps(): void {
    for (let i = 0; i < 3; i++) {
      const lit = this.topLanesHit[i];
      const target = !this.topLanesHit.every(Boolean) && i === this.litTopLane && this.skillShotTimer > 0;
      this.setLamp(`lamp_top_${i}`, target ? 'blink' : lit ? 'on' : i === this.litTopLane ? 'blink' : 'off');
    }
  }

  private refreshBaseLamps(): void {
    if (this.offense) {
      const b = this.baseball.bases;
      this.setLamp('lamp_1b', b[0] ? 'blink' : this.baseTargetsHit.has('base_1b') ? 'on' : 'off');
      this.setLamp('lamp_2b', b[1] ? 'blink' : this.baseTargetsHit.has('center_lane') ? 'on' : 'off');
      this.setLamp('lamp_3b', b[2] ? 'blink' : this.baseTargetsHit.has('base_3b') ? 'on' : 'off');
    } else {
      this.setLamp('lamp_1b', this.litFielderTarget === 'base_1b' ? 'blink' : 'off');
      this.setLamp('lamp_2b', 'on');
      this.setLamp('lamp_3b', this.litFielderTarget === 'base_3b' ? 'blink' : 'off');
    }
  }

  refreshLamps(): void {
    this.setLamp('lamp_hr', this.offense ? (this.hrLit ? 'blink' : 'off') : 'on');
    this.setLamp('lamp_lock', this.lockLit ? 'blink' : this.lockedBalls > 0 ? 'on' : 'off');
    this.setLamp('lamp_leftField', this.leftFieldLit ? 'on' : this.bankDown.leftField.some(Boolean) ? 'blink' : 'off');
    this.setLamp('lamp_rightField', this.rightFieldLit ? 'on' : this.bankDown.rightField.some(Boolean) ? 'blink' : 'off');
    this.setLamp('lamp_kickback', this.kickbackLit ? 'on' : this.ballSaveTimer > 0 ? 'blink' : 'off');
    this.setLamp('lamp_left_ramp', this.offense ? (this.batting ? 'off' : 'blink') : 'on');
    this.setLamp('lamp_right_ramp', this.offense ? (this.batting ? 'off' : 'blink') : 'on');
    for (let i = 1; i <= 3; i++) this.setLamp(`lamp_power${i}`, this.power >= i ? 'on' : 'off');
    this.refreshBaseLamps();
    this.refreshTopLaneLamps();
  }

  // ------------------------------------------------------------------ debug / test hooks

  readonly debug = {
    /** Places the first in-play ball at a position with a velocity (tests + tutorial). */
    placeBall: (pos: Vec2, vel: Vec2): Ball | undefined => {
      let ball = this.world.balls.find((b) => b.state === 'free' || b.state === 'launcher');
      if (!ball) ball = this.world.createBall(pos, vel);
      ball.state = 'free';
      ball.pos = { ...pos };
      ball.vel = { ...vel };
      ball.guide = null;
      ball.hold = null;
      ball.height = 0;
      return ball;
    },
    forceBatting: (lane: ShotLane, quality = 0.9): void => this.startBatting(lane, quality),
    forcePlay: (play: Play): void => {
      const { state, result } = applyPlay(this.baseball, play);
      this.commitBaseball(state, result, this.offense);
    },
    forceDefense: (): void => this.resolveOpponentAtBat(true, 'debug'),
    drain: (): void => {
      const ball = this.world.balls.find((b) => b.state !== 'drained');
      if (ball) this.onDrain(ball);
    },
    setBallSave: (seconds: number): void => {
      this.ballSaveTimer = seconds;
    },
    finish: (): void => this.finishGame('complete'),
  };
}
