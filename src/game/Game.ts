import { computeBatting, sprayFor, sweetSpotFor, timingScore, type BattingResult, type ShotLane } from '../baseball/batting';
import { resolveDefense } from '../baseball/defense';
import { choosePitch, type Pitch, type PitchType } from '../baseball/pitching';
import { applyPlay, basesLoaded, createBaseballState } from '../baseball/rules';
import type { BaseballState, Play, PlayResult } from '../baseball/types';
import { EventBus } from '../core/EventBus';
import { clamp01 } from '../core/math';
import { Random } from '../core/Random';
import type { Vec2 } from '../physics/Vec2';
import { World } from '../physics/World';
import type { Ball, PhysicsEvent } from '../physics/types';
import { buildTable, type TableDef } from '../table/layout';
import { CAMERA_EXIT_LEAD, Director, type ShotKind } from './director';
import { CITY_CRUISE_POINTS, LANDMARKS, createRush, rushGrade, rushInput, rushScore, updateRush, type CityRush, type Landmark, type RushEvent } from '../attractions/cityRush';
import {
  CHARGE,
  addCharge,
  completeOverload,
  createReactor,
  forceReady,
  overloadJackpot,
  overloadOutcome,
  startOverload,
  tapOverload,
  updateOverload,
  type ReactorEvent,
  type ReactorState,
} from '../attractions/reactor';

/** The pitching machine's speed after each charge stage. */
const HEATER_MPH = [75, 88, 100];
import { achievementById } from './achievements';
import { difficultyFor, type DifficultyId, type DifficultyProfile } from './difficulty';
import type { GameEvents, GameState, GameSummary, LampState } from './events';
import { SaveStore } from './save';
import { HYPE_GAIN, addHype, createHype, drainHype, rallyActive, tickHype, type HypeState } from './hype';
import {
  MODIFIERS,
  activateModifier,
  clearModifiers as clearModifierState,
  createModifierState,
  hasModifier,
  tickModifiers,
  type ModifierId,
  type ModifierState,
} from './modifiers';
import {
  BOSSES,
  MULTIBALLS,
  addImpossibleLink,
  bossObjective,
  bossProgress,
  createBoss,
  createImpossible,
  derbyMultiplier,
  impossibleCount,
  resetImpossible,
  type BossId,
  type BossState,
  type ImpossibleLink,
  type ImpossibleState,
  type MultiballMode,
} from './modes';
import {
  COMBO_WINDOW,
  COMBO_TIER_LABEL,
  POINTS,
  allowScore,
  applyScore,
  comboTier,
  contactAnnouncement,
  createCombo,
  createRateLimiter,
  registerComboShot,
  resetCombo,
  scoreMultiplier,
  tickCombo,
  type ComboState,
  type RateLimiter,
} from './scoring';

export interface GameOptions {
  innings: number;
  difficulty: DifficultyId;
  seed?: number;
}

export interface BattingSession {
  lane: ShotLane;
  shotQuality: number;
  /** 1 = the ball went up the dead centre of the ramp mouth. */
  sweetSpot: number;
  /** Signed ramp entry angle in radians (positive = drifting right). */
  entryAngle: number;
  pitch: Pitch;
  t: number;
  pitchDelay: number;
  windowSeconds: number;
  swung: boolean;
  resolved: boolean;
  /** Seconds after the swing before the at-bat ends and the ball is released. */
  cooldown: number;
  /** The steel ball that earned this at-bat; parked on the ramp return until the play resolves. */
  ballId: number | null;
  held: boolean;
  cinematic: boolean;
}

export interface Highlight {
  text: string;
  weight: number;
  order: number;
}

/** Seconds the at-bat ball stays parked after a normal swing / a home-run cinematic. */
export const AT_BAT_RELEASE = 0.6;
export const HOME_RUN_CINEMATIC = 2.6;
/** With the at-bat camera dive running, the ball stays parked this long after the swing so the hit plays out up close. */
export const AT_BAT_WATCH = 1.5;
/** Safety net: a parked ball is always released after this long. */
export const AT_BAT_WATCHDOG = 9;
/** Seconds a SCOREBOARD bumper cycle doubles scoring. */
export const SCOREBOARD_BOOST = 10;
/** Seconds of HOME RUN DERBY (scaled by difficulty). */
export const DERBY_SECONDS = 40;

const labelFor = (s: BaseballState): string => `${s.half === 'top' ? 'T' : 'B'}${s.inning}`;

export const BALLS_PER_GAME = 3;
export const PLAYER_SIDE = 'away' as const;
export const TEAM_NAMES = { away: 'SLUGGERS', home: 'RIVALS' } as const;

type Bank = 'leftField' | 'rightField';
type WallSection = 'left' | 'center' | 'right';
const WALL_ORDER: WallSection[] = ['left', 'center', 'right'];

/**
 * Orchestrates the whole arcade loop: pinball physics events feed table modes,
 * table modes feed the baseball simulation, and the baseball situation lights
 * the table. Rendering, audio and HUD only observe the event bus.
 *
 * Every difficulty-dependent number comes from {@link DifficultyProfile}.
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly world: World;
  readonly table: TableDef;
  readonly store: SaveStore;
  state: GameState = 'title';
  options: GameOptions = { innings: 3, difficulty: 'medium' };
  profile: DifficultyProfile = difficultyFor('medium');
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
  multiballMode: MultiballMode = 'none';
  leftFieldLit = false;
  rightFieldLit = false;
  kickbackLit = false;
  bankDown: Record<Bank, boolean[]> = { leftField: [false, false, false], rightField: [false, false, false] };
  bankResetTimer: Record<Bank, number> = { leftField: 0, rightField: 0 };
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
  stats = {
    hits: 0,
    homeRuns: 0,
    runs: 0,
    rampStreak: 0,
    bestRampStreak: 0,
    doublePlays: 0,
    steals: 0,
    perfect: 0,
    trailedInFinal: false,
    grandSlams: 0,
    wallBounces: 0,
    squeezes: 0,
    modifiers: 0,
    derbyBest: 0,
  };
  earnedThisGame: string[] = [];
  summary: GameSummary | null = null;
  elapsed = 0;
  hype: HypeState = createHype();
  highlights: Highlight[] = [];

  // ---- new systems ----
  modifiers: ModifierState = createModifierState();
  modifiersUsed = new Set<ModifierId>();
  boss: BossState | null = null;
  bossesBeaten: BossId[] = [];
  bossesSeen = new Set<BossId>();
  impossible: ImpossibleState = createImpossible(difficultyFor('medium'));
  impossibleDone = false;
  derby: { active: boolean; timer: number; total: number; homers: number } = { active: false, timer: 0, total: 0, homers: 0 };
  scoreboardBoost = 0;
  bumperCycle: string[] = [];
  bumperCycleTimer = 0;
  scoreboardCycles = 0;
  blackHoleLit = false;
  wallSectionsLit = new Set<WallSection>();
  plateLit = 0;
  queuedPitch: PitchType | null = null;
  bullpenVisits = 0;
  turboQueued = false;
  rovingTarget: string | null = null;
  rovingTimer = 0;
  lastHomerPA = -5;
  aceStrikeouts = 0;
  nightmareArmed = false;
  blackHoleEject: { timer: number; at: Vec2 } | null = null;
  private slowMoCooldown = 0;
  private moundCooldown = 0;
  private wallCooldown = 0;
  private plateCooldown = 0;
  private baseballHitCooldown = 0;
  private lightningGuard = false;
  private skillRotateTimer = 0;
  private limiter: RateLimiter = createRateLimiter(2, 10);
  /** Clutch announcement already made for this half-inning. */
  private clutchAnnounced = false;
  private basesLoadedAnnounced = false;
  private opponentPitchAnnounced = false;
  private wallSoundTimer = 0;
  private lampStates = new Map<string, LampState>();
  private rampMinSpeeds = new Map<string, number>();

  // ---- the miniature universe ----
  /** Camera arbitration: every close-up goes through here. */
  readonly director = new Director();
  reactor: ReactorState = createReactor();
  city = { signals: [false, false, false], lit: false, level: 0, trophies: [] as Landmark[], runs: 0 };
  /** The running WALL CATCH at the sandlot (null when none is on). Internally the attraction keeps its original 'city' id. */
  rush: CityRush | null = null;
  /** A capture attraction owns the ball and the flippers right now. */
  attraction: { kind: 'city' | 'reactor'; ballId: number; phase: 'ride' | 'race' | 'overload' | 'finish'; t: number } | null = null;
  tour = { stadium: false, city: false, reactor: false };
  /** WORLD multiplier earned by the attractions (x1..x3, resets when a ball is lost). */
  worldMult = 1;
  private pending: Array<{ t: number; fn: () => void }> = [];
  private coreCooldown = 0;

  constructor(store: SaveStore = new SaveStore()) {
    this.store = store;
    this.world = new World();
    this.table = buildTable(this.world);
    for (const r of this.world.ramps.values()) this.rampMinSpeeds.set(r.id, r.minSpeed);
  }

  // ------------------------------------------------------------------ lifecycle

  get offense(): boolean {
    return (this.baseball.half === 'top') === (PLAYER_SIDE === 'away');
  }

  /** The active difficulty profile. */
  get difficulty(): DifficultyProfile {
    return this.profile;
  }

  get comboWindow(): number {
    return COMBO_WINDOW * this.profile.comboWindowScale;
  }

  get playerRuns(): number {
    return this.baseball[PLAYER_SIDE].runs;
  }

  get cpuRuns(): number {
    return this.baseball[PLAYER_SIDE === 'away' ? 'home' : 'away'].runs;
  }

  /** Mode multiplier (runs, bonus X, multiball, rally, scoreboard boost, chaos). */
  get multiplier(): number {
    let m = scoreMultiplier(this.playerRuns, this.multiball, this.bonusLevel) * (rallyActive(this.hype) ? 2 : 1);
    if (this.scoreboardBoost > 0) m *= 2;
    if (this.multiballMode === 'chaos') m *= 1.5;
    return m * this.worldMult;
  }

  get rally(): boolean {
    return rallyActive(this.hype);
  }

  get finalInning(): boolean {
    return this.baseball.inning >= this.baseball.totalInnings && !this.baseball.gameOver;
  }

  /** Final inning at bat, tied or trailing: every swing matters. */
  get clutch(): boolean {
    return this.offense && this.finalInning && this.playerRuns <= this.cpuRuns;
  }

  /** Final inning in the field protecting a lead. */
  get closer(): boolean {
    return !this.offense && this.finalInning && this.playerRuns > this.cpuRuns;
  }

  get inningLabel(): string {
    return `${this.baseball.half === 'top' ? 'T' : 'B'}${this.baseball.inning}`;
  }

  startGame(options: Partial<GameOptions> = {}): void {
    this.options = { innings: this.store.data.settings.innings, difficulty: this.store.data.settings.difficulty, ...options };
    this.profile = difficultyFor(this.options.difficulty);
    this.options.difficulty = this.profile.id;
    this.rng = new Random(this.options.seed ?? (Date.now() & 0xffffffff));
    this.world.reset();
    this.applyBaseline();
    this.baseball = createBaseballState(this.options.innings);
    this.score = 0;
    this.ballsLeft = this.profile.balls;
    this.ballNumber = 0;
    this.combo = createCombo();
    this.bonusLevel = 0;
    this.power = 0;
    this.hrLit = false;
    this.lockLit = false;
    this.lockedBalls = 0;
    this.multiball = false;
    this.multiballMode = 'none';
    this.leftFieldLit = false;
    this.rightFieldLit = false;
    this.kickbackLit = this.profile.kickbackPerBall;
    this.bankDown = { leftField: [false, false, false], rightField: [false, false, false] };
    this.bankResetTimer = { leftField: 0, rightField: 0 };
    this.baseTargetsHit.clear();
    this.topLanesHit = [false, false, false];
    this.litTopLane = 1;
    this.skillShotTimer = 0;
    this.ballSaveTimer = 0;
    this.batting = null;
    this.pitchClock = this.profile.pitchClock;
    this.defenseClock = this.profile.defenseInterval;
    this.defenseRating = 0.3;
    this.stealCooldown = 0;
    this.autoLaunchTimer = 0;
    this.autoLaunchPending = false;
    this.plunger = { charging: false, charge: 0 };
    this.flippersPressed = { left: false, right: false };
    this.stats = { hits: 0, homeRuns: 0, runs: 0, rampStreak: 0, bestRampStreak: 0, doublePlays: 0, steals: 0, perfect: 0, trailedInFinal: false, grandSlams: 0, wallBounces: 0, squeezes: 0, modifiers: 0, derbyBest: 0 };
    this.earnedThisGame = [];
    this.summary = null;
    this.elapsed = 0;
    this.hype = createHype();
    this.highlights = [];
    this.modifiers = createModifierState();
    this.modifiersUsed.clear();
    this.boss = null;
    this.bossesBeaten = [];
    this.bossesSeen.clear();
    this.impossible = createImpossible(this.profile);
    this.impossibleDone = false;
    this.derby = { active: false, timer: 0, total: 0, homers: 0 };
    this.scoreboardBoost = 0;
    this.bumperCycle = [];
    this.bumperCycleTimer = 0;
    this.scoreboardCycles = 0;
    this.blackHoleLit = false;
    this.wallSectionsLit.clear();
    this.plateLit = 0;
    this.queuedPitch = null;
    this.bullpenVisits = 0;
    this.turboQueued = false;
    this.rovingTarget = null;
    this.rovingTimer = 0;
    this.lastHomerPA = -5;
    this.aceStrikeouts = 0;
    this.nightmareArmed = false;
    this.blackHoleEject = null;
    this.slowMoCooldown = 0;
    this.moundCooldown = 0;
    this.wallCooldown = 0;
    this.plateCooldown = 0;
    this.baseballHitCooldown = 0;
    this.skillRotateTimer = 0;
    this.limiter = createRateLimiter(2, 10);
    this.clutchAnnounced = false;
    this.basesLoadedAnnounced = false;
    this.opponentPitchAnnounced = false;
    this.lampStates.clear();
    this.resetAttractions();
    this.director.mode = this.store.data.settings.cinematics ?? 'full';
    for (const b of this.table.blockers) this.world.setColliderEnabled(b.id, false);
    this.setState('playing');
    this.bus.emit('difficulty', { profile: this.profile });
    this.bus.emit('baseball', { state: this.baseball });
    this.bus.emit('modeChange', { offense: this.offense });
    this.refreshLamps();
    this.serveBall();
    this.bus.emit('toast', { text: this.offense ? 'PLAY BALL!' : 'TAKE THE FIELD!', kind: 'great', sub: `${this.profile.title} · ${this.offense ? 'Shoot a ramp to bat' : 'Keep the ball busy to make outs'}`, duration: 2.6 });
  }

  /** Establishes the difficulty's physics baseline (ball size, speed, flipper forgiveness, ramp thresholds). */
  private applyBaseline(): void {
    const p = this.profile;
    this.world.setBaseline({ ballRadius: this.world.config.ballRadius * p.ballScale, timeScale: p.speedScale, flipperScale: p.flipperScale, flipperPower: p.flipperPower });
    for (const r of this.world.ramps.values()) r.minSpeed = (this.rampMinSpeeds.get(r.id) ?? r.minSpeed) * p.rampMinSpeedScale;
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
    this.resetAttractions();
    this.modifiers = createModifierState();
    this.setState('title');
  }

  /** Skips a running cinematic and releases the parked ball. */
  skipCinematic(): void {
    const b = this.batting;
    if (!b || !b.cinematic || !b.swung) return;
    b.cooldown = 0;
    this.endAtBat(true);
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
      if (this.attractionInput(side)) return;
      if (this.batting?.cinematic && this.batting.swung) {
        this.skipCinematic();
        return;
      }
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
    if (this.attraction) {
      // A capture attraction owns the ball: table timers (ball save, combo,
      // hype, clocks, modes) are frozen so the mini-game never costs anything.
      this.updateAttraction(dt);
    } else {
      this.updateTimers(dt);
      this.updateModes(dt);
    }
    this.updatePending(dt);
    if (this.coreCooldown > 0) this.coreCooldown -= dt;
    if (this.reactor.critical > 0) {
      this.reactor.critical -= dt;
      if (this.reactor.critical <= 0) this.refreshLamps();
    }
    const events = this.world.step(dt);
    for (const e of events) {
      if (this.state !== 'playing') break;
      this.handlePhysicsEvent(e);
    }
    if (this.wallSoundTimer > 0) this.wallSoundTimer -= dt;
    this.director.update(dt, { liveBalls: this.liveBalls() });
    this.flushDirector();
  }

  /** Balls rolling freely on the playfield (the ones a camera dive must never hide). */
  liveBalls(excludeId: number | null = null): number {
    let n = 0;
    for (const b of this.world.balls) if (b.state === 'free' && b.id !== excludeId) n++;
    return n;
  }

  /** Asks the director for a shot and publishes the decision. */
  private requestShot(kind: ShotKind, excludeId: number | null = null): boolean {
    const r = this.director.request(kind, { liveBalls: this.liveBalls(excludeId) });
    this.flushDirector();
    return r === 'started' || r === 'merged' || r === 'queued';
  }

  private endShot(kind: ShotKind): void {
    if (this.director.end(kind)) this.flushDirector();
  }

  private flushDirector(): void {
    for (const e of this.director.drain()) {
      if (e.type === 'start') this.bus.emit('shot', { kind: e.shot.kind, phase: 'start', id: e.shot.id });
      else {
        this.bus.emit('shot', { kind: e.shot.kind, phase: 'end', id: e.shot.id, reason: e.reason });
        // A mini-game whose camera was pulled (watchdog / reset) wraps up immediately.
        const a = this.attraction;
        if (a && e.reason !== 'done' && e.reason !== 'reset' && e.shot.kind === a.kind && a.phase !== 'finish') this.abortAttraction();
      }
    }
  }

  private schedule(seconds: number, fn: () => void): void {
    this.pending.push({ t: seconds, fn });
  }

  private updatePending(dt: number): void {
    if (!this.pending.length) return;
    const due: Array<() => void> = [];
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].t -= dt;
      if (this.pending[i].t <= 0) {
        due.push(this.pending[i].fn);
        this.pending.splice(i, 1);
      }
    }
    for (const fn of due.reverse()) if (this.state === 'playing') fn();
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
    if (this.skillShotTimer > 0) {
      this.skillShotTimer -= dt;
      if (this.profile.skillShotRotates) {
        this.skillRotateTimer -= dt;
        if (this.skillRotateTimer <= 0) {
          this.skillRotateTimer = 1.4;
          this.litTopLane = (this.litTopLane + 1) % 3;
          this.refreshTopLaneLamps();
        }
      }
    }
    if (this.stealCooldown > 0) this.stealCooldown -= dt;
    if (this.moundCooldown > 0) this.moundCooldown -= dt;
    if (this.wallCooldown > 0) this.wallCooldown -= dt;
    if (this.plateCooldown > 0) this.plateCooldown -= dt;
    if (this.baseballHitCooldown > 0) this.baseballHitCooldown -= dt;
    if (this.slowMoCooldown > 0) this.slowMoCooldown -= dt;
    if (this.plateLit > 0) {
      this.plateLit -= dt;
      if (this.plateLit <= 0) this.setLamp('lamp_plate', 'off');
    }
    if (this.bumperCycleTimer > 0) {
      this.bumperCycleTimer -= dt;
      if (this.bumperCycleTimer <= 0) this.bumperCycle = [];
    }
    if (this.scoreboardBoost > 0) {
      this.scoreboardBoost -= dt;
      if (this.scoreboardBoost <= 0) {
        this.scoreboardBoost = 0;
        this.bus.emit('scoreboardBoost', { active: false, seconds: 0 });
        this.refreshLamps();
      }
    }
    if (tickHype(this.hype, dt)) {
      this.bus.emit('rally', { active: false });
      this.bus.emit('toast', { text: 'RALLY OVER', kind: 'info', sub: 'Fill the hype meter again', duration: 1.4 });
      this.refreshLamps();
    }
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
        this.bus.emit('pitchClock', { seconds: Math.max(0, this.pitchClock), total: this.profile.pitchClock });
        if (this.pitchClock <= 0) {
          this.pitchClock = this.profile.pitchClock;
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
        if (!this.opponentPitchAnnounced && this.defenseClock <= 1.0) {
          // The pitcher winds up so the tiny batter swings exactly when the play resolves.
          this.opponentPitchAnnounced = true;
          this.bus.emit('opponentPitch', { delay: Math.max(0.2, this.defenseClock) });
        }
        if (this.defenseClock <= 0) {
          this.defenseClock = this.profile.defenseInterval;
          this.resolveOpponentAtBat(false, 'The batter puts it in play.');
        }
      }
    }
  }

  /** Modifiers, bosses, derby, chaos jackpot, slow-motion clutch and the black hole. */
  private updateModes(dt: number): void {
    for (const id of tickModifiers(this.modifiers, dt)) this.onModifierEnd(id);
    if (this.boss && this.boss.timer !== Infinity) {
      this.boss.timer -= dt;
      if (this.boss.timer <= 0) this.endBoss(false);
    }
    if (this.derby.active) {
      this.derby.timer -= dt;
      if (this.derby.timer <= 0) this.endDerby();
      else this.bus.emit('derby', { active: true, homers: this.derby.homers, multiplier: derbyMultiplier(this.derby.homers), remaining: this.derby.timer });
    }
    if (this.multiballMode === 'chaos') {
      this.rovingTimer -= dt;
      if (this.rovingTimer <= 0) this.moveRovingJackpot();
    }
    if (this.blackHoleEject) {
      this.blackHoleEject.timer -= dt;
      if (this.blackHoleEject.timer <= 0) {
        const at = this.blackHoleEject.at;
        this.blackHoleEject = null;
        const spawned = this.world.spawnBallsAt({ x: at.x, y: at.y - 1.9 }, 2, 70, { radiusScale: 0.85, skin: 'baseball', spreadDeg: 120 });
        this.bus.emit('blackHole', { at, balls: spawned.length + 1, phase: 'eject' });
        this.bus.emit('toast', { text: 'EJECTED!', kind: 'epic', sub: 'The black hole spits out a burst of balls', duration: 1.8 });
        if (this.multiball && this.multiballMode !== 'chaos' && this.rng.chance(0.5)) this.startMultiball('chaos');
        else if (!this.multiball) this.startMultiball('standard', false);
      }
    }
    // SLOW-MOTION CLUTCH: a ball diving at the drain during a clutch or boss moment gets a beat of slow motion.
    if (this.slowMoCooldown <= 0 && !hasModifier(this.modifiers, 'slowMo') && (this.clutch || this.boss || this.combo.count >= 5) && !this.store.data.settings.reducedEffects) {
      const diving = this.world.balls.find((b) => b.state === 'free' && b.pos.y < 7.5 && b.pos.y > 2.5 && b.vel.y < -35 && b.pos.x > 6 && b.pos.x < 14.2);
      if (diving) {
        this.slowMoCooldown = 9;
        this.triggerModifier('slowMo', { silent: true });
      }
    }
  }

  // ------------------------------------------------------------------ balls

  private serveBall(extra = false, autoLaunch = false): Ball {
    const ball = this.world.createLauncherBall(extra);
    ball.skin = this.ballSkinFor();
    if (!extra) this.ballNumber += 1;
    this.bus.emit('ballServed', { ball, ballsLeft: this.ballsLeft, extra });
    if (autoLaunch) {
      this.autoLaunchPending = true;
      this.autoLaunchTimer = 0.9;
    }
    return ball;
  }

  private ballSkinFor(): string {
    const s = this.store.data.settings.ballSkin;
    return s && s.startsWith('skin_') ? s.slice(5) : 'steel';
  }

  private launch(ball: Ball, power: number, manual: boolean): void {
    if (this.turboQueued) {
      this.turboQueued = false;
      this.world.mods.launchScale = 1.6;
      this.bus.emit('toast', { text: 'TURBO LAUNCH!', kind: 'great', duration: 1.2 });
    }
    this.world.launch(ball, power);
    this.world.mods.launchScale = 1;
    this.ballSaveTimer = this.profile.ballSave;
    this.skillShotTimer = manual ? 3.5 : 0;
    this.skillRotateTimer = 1.4;
    this.bus.emit('launch', { power, ball });
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
    if (this.derby.active) this.endDerby();
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
    if (this.worldMult > 1) {
      this.worldMult = 1;
      this.bus.emit('worldMult', { value: 1 });
    }
    const wasRally = this.rally;
    drainHype(this.hype);
    if (wasRally) this.bus.emit('rally', { active: false });
    this.endAllModifiers();
    if (this.boss && this.boss.id !== 'nightmare') this.endBoss(false);
    this.bus.emit('ballLost', { ballsLeft: this.ballsLeft, ball });
    if (this.ballsLeft <= 0) {
      this.finishGame('ballsLost');
      return;
    }
    this.power = 0;
    this.bus.emit('power', { level: 0 });
    this.kickbackLit = this.profile.kickbackPerBall;
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
        this.onRamp(e.rampId, e.quality, e.ball, e.offset, e.angle);
        break;
      case 'rampExit':
        this.bus.emit('rampExit', { id: e.rampId });
        if (e.rampId === 'city_track') this.onCityGarage(e.ball);
        else this.maybeHoldAtBatBall(e.ball);
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

  private onHit(id: string, kind: string, speed: number, at: Vec2, ball: Ball): void {
    switch (kind) {
      case 'bumper':
        if (allowScore(this.limiter, id, this.elapsed)) {
          this.addScore(POINTS.bumper, at);
          // The bumpers are the reactor's coils.
          if (this.multiballMode === 'reactor' || this.reactor.critical > 0) this.addScore(POINTS.coilJackpot * (this.reactor.critical > 0 ? 3 : 1), at, 'HEATER');
          // Charge shares the scoring rate limit, so resting chatter cannot fill the core.
          this.chargeReactor(CHARGE.bumper);
        }
        this.bus.emit('bumper', { id, at, speed });
        this.addDefense(0.07);
        this.gainHype(HYPE_GAIN.bumper);
        this.onBumperCycle(id, ball, at);
        break;
      case 'slingshot':
        if (allowScore(this.limiter, id, this.elapsed)) {
          this.addScore(POINTS.slingshot, at);
          this.chargeReactor(CHARGE.slingshot);
        }
        this.bus.emit('slingshot', { id, at });
        this.addDefense(0.03);
        this.gainHype(HYPE_GAIN.slingshot);
        break;
      case 'target':
        this.onTarget(id, at);
        break;
      case 'post':
        if (speed > 12) {
          if (allowScore(this.limiter, id, this.elapsed)) this.addScore(POINTS.post);
          this.bus.emit('wallHit', { at, speed, kind: 'post' });
        }
        break;
      case 'rubber':
        if (id.startsWith('blocker_')) {
          this.addScore(POINTS.nearMiss, at, 'REBOUND');
          this.bus.emit('nearMiss', { at, points: POINTS.nearMiss });
          this.bus.emit('wallHit', { at, speed, kind: 'rubber' });
          break;
        }
        if (speed > 10 && this.wallSoundTimer <= 0) {
          this.wallSoundTimer = 0.05;
          this.bus.emit('wallHit', { at, speed, kind });
        }
        break;
      default:
        if (id.startsWith('outer_arc_')) this.onWallHit(id, speed, at);
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
      this.chargeReactor(CHARGE.target);
      this.bus.emit('target', { id, down: true, at });
      this.addDefense(0.1);
      this.gainHype(HYPE_GAIN.target);
      this.onRovingHit(id, at);
      this.onBaseballMultiballHit(at);
      if (this.bankDown[bank].every(Boolean)) {
        this.gainHype(HYPE_GAIN.bankComplete);
        this.addScore(POINTS.bankComplete, at, bank === 'leftField' ? 'LEFT FIELD' : 'RIGHT FIELD');
        this.registerCombo();
        this.citySignal(2);
        this.bankResetTimer[bank] = 1.4;
        if (this.offense) {
          if (bank === 'leftField') this.leftFieldLit = true;
          else this.rightFieldLit = true;
          this.bus.emit('toast', { text: `${bank === 'leftField' ? 'LEFT' : 'RIGHT'} FIELD LIT`, kind: 'good', sub: `Next ${bank === 'leftField' ? 'left' : 'right'} ramp hits harder`, duration: 1.8 });
        } else {
          this.instantOut('A diving catch ends the at-bat.', undefined, true);
          this.addHighlight('Diving web gem in the field', 3);
        }
        // Both banks down inside one combo: the infield turns magnetic.
        if (this.leftFieldLit && this.rightFieldLit && this.combo.count >= 2) this.triggerModifier('magnet');
        // A long combo of bank completions arms the commissioner.
        if (!this.boss && this.combo.count >= 5 && !this.bossesSeen.has('commissioner')) this.startBoss('commissioner');
        this.refreshLamps();
      }
      this.chainLightning(id, at);
      return;
    }
    if (id === 'base_1b' || id === 'base_3b') {
      this.addScore(POINTS.standupTarget, at);
      this.bus.emit('target', { id, down: false, at });
      this.gainHype(HYPE_GAIN.target);
      this.onRovingHit(id, at);
      this.onBaseTarget(id === 'base_1b' ? 1 : 3, id);
      this.onBaseballMultiballHit(at);
      this.chainLightning(id, at);
    }
  }

  /** LIGHTNING ROUND: a target hit also strikes every other target within reach. */
  private chainLightning(sourceId: string, at: Vec2): void {
    if (!hasModifier(this.modifiers, 'lightning') || this.lightningGuard) return;
    this.lightningGuard = true;
    const reach = 6.5;
    const struck: Vec2[] = [];
    for (const t of this.table.targets) {
      if (t.id === sourceId) continue;
      const mid = { x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2 };
      if (Math.hypot(mid.x - at.x, mid.y - at.y) > reach) continue;
      struck.push(mid);
      this.addScore(POINTS.lightning, mid);
      if (t.kind === 'drop') {
        const bank = t.bank as Bank;
        const index = Number(t.id.split('_')[1]);
        if (!this.bankDown[bank][index]) this.onTarget(t.id, mid);
      } else {
        this.bus.emit('target', { id: t.id, down: false, at: mid });
      }
    }
    if (struck.length) this.bus.emit('lightning', { from: at, to: struck });
    this.lightningGuard = false;
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
          this.gainHype(HYPE_GAIN.steal + HYPE_GAIN.run * result.runs);
          this.linkImpossible('steal');
          this.bossEvent('runnerAdvanced');
          if (result.runs) this.addHighlight(`${this.inningLabel}: Stole home!`, 5);
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

  /** The pitcher's mound post: rattle the pitcher, light home plate. */
  private onMound(at: Vec2, speed: number): void {
    if (this.moundCooldown > 0) return;
    this.moundCooldown = 3;
    this.addScore(POINTS.mound, at);
    this.gainHype(HYPE_GAIN.target);
    this.bus.emit('mound', { at, offense: this.offense });
    this.bus.emit('target', { id: 'mound', down: false, at });
    this.onRovingHit('mound', at);
    if (this.offense) {
      const wasLit = this.plateLit > 0;
      this.plateLit = this.profile.plateLit;
      this.setLamp('lamp_plate', 'blink');
      const runnerOnThird = !!this.baseball.bases[2];
      if (!wasLit) this.bus.emit('toast', { text: 'PITCHER RATTLED', kind: 'good', sub: runnerOnThird ? 'HOME PLATE LIT: roll over it for the squeeze' : 'HOME PLATE LIT: roll over it for power', duration: 1.5 });
    } else if (speed > 20 && !this.baseball.gameOver) {
      const { state, result } = applyPlay(this.baseball, { type: 'strike' });
      this.commitBaseball(state, result, false);
      this.bus.emit('strike', { strikes: state.strikes, reason: 'Mound shot' });
      this.bus.emit('toast', { text: result.outs ? 'STRIKEOUT!' : 'STRIKE!', kind: result.outs ? 'great' : 'good', sub: 'The mound shot paints the corner', duration: 1.3 });
      if (result.outs) this.scoreDefensivePlay(result);
    }
  }

  /** Home plate rollover: lit by the mound, it scores the runner from third. */
  private onPlate(ball: Ball): void {
    if (ball.state !== 'free' || this.plateCooldown > 0) return;
    this.plateCooldown = 1.5;
    if (this.plateLit <= 0 || !this.offense || this.batting || this.baseball.gameOver) return;
    this.plateLit = 0;
    this.setLamp('lamp_plate', 'off');
    const runner = this.baseball.bases[2];
    if (runner) {
      const { state, result } = applyPlay(this.baseball, { type: 'steal', base: 3 });
      if (result.moves.length) {
        this.commitBaseball(state, result, true);
        this.stats.squeezes += 1;
        this.stats.runs += result.runs;
        this.addScore(POINTS.squeeze, this.table.diamond.home, 'SQUEEZE');
        this.gainHype(HYPE_GAIN.run * 2);
        this.bus.emit('squeeze', { runs: result.runs });
        this.bus.emit('toast', { text: 'SQUEEZE PLAY!', kind: 'great', sub: 'The runner from third slides in safe', duration: 1.8 });
        this.award('squeeze');
        this.addHighlight(`${this.inningLabel}: Squeeze play scores`, 4);
        this.bossEvent('runnerAdvanced');
        return;
      }
    }
    if (this.power < 3) {
      this.power += 1;
      this.bus.emit('power', { level: this.power });
    }
    this.addScore(POINTS.centerLane, this.table.diamond.home, 'HOME PLATE');
    this.bus.emit('toast', { text: 'TOUCHED HOME', kind: 'good', sub: 'Batting power +1', duration: 1.2 });
    this.refreshLamps();
  }

  /** The outfield wall: hard hits bounce off it for a bonus and light its sections. */
  private onWallHit(id: string, speed: number, at: Vec2): void {
    if (speed < 28 || this.wallCooldown > 0) return;
    this.wallCooldown = 0.8;
    const index = Number(id.split('_')[2]);
    const ws = this.table.wallSections.find((w) => index >= w.from && index <= w.to);
    if (!ws) return;
    const section = ws.id;
    let lit = false;
    this.stats.wallBounces += 1;
    this.addScore(POINTS.wallBounce, at, 'OFF THE WALL');
    this.gainHype(HYPE_GAIN.lane);
    if (this.boss?.id === 'wall' && this.boss.stage === 0) {
      if (section === this.boss.litSection) {
        lit = true;
        const r = bossProgress(this.boss);
        this.boss.litSection = this.rng.pick(WALL_ORDER.filter((w) => w !== section));
        this.bus.emit('wallBounce', { section, at, speed, lit: true });
        if (r === 'stage') {
          this.hrLit = true;
          this.bus.emit('toast', { text: 'WALL CRACKED', kind: 'great', sub: 'Now hit one over it: HOME RUN lane lit', duration: 2 });
        } else this.bus.emit('toast', { text: 'WEAK POINT HIT', kind: 'good', duration: 1 });
        this.emitBoss();
        this.refreshLamps();
        return;
      }
    } else if (!this.wallSectionsLit.has(section)) {
      const nextRequired = WALL_ORDER[this.wallSectionsLit.size];
      if (!this.profile.orderedWall || section === nextRequired) {
        this.wallSectionsLit.add(section);
        lit = true;
        if (this.wallSectionsLit.size >= 3) {
          this.wallSectionsLit.clear();
          this.addScore(POINTS.wallCleared, at, 'WALL CLEARED');
          this.award('wall_bounce');
          this.registerCombo();
          this.bus.emit('toast', { text: 'WALL CLEARED!', kind: 'great', sub: this.offense ? 'Every section lit: HOME RUN lane lit' : 'Defense rating maxed', duration: 2 });
          if (this.offense) this.hrLit = true;
          else this.addDefense(0.5);
          if (!this.boss && !this.bossesSeen.has('wall') && this.offense) this.startBoss('wall');
        } else {
          this.bus.emit('toast', { text: `${ws.marker} MARKER LIT`, kind: 'good', sub: this.profile.orderedWall ? 'Light them left to right' : `${3 - this.wallSectionsLit.size} to go`, duration: 1 });
        }
      }
    }
    this.bus.emit('wallBounce', { section, at, speed, lit });
    this.refreshLamps();
  }

  /** Three different bumpers in a row (within 2 s) is a SCOREBOARD cycle: double scoring. */
  private onBumperCycle(id: string, ball: Ball, at: Vec2): void {
    if (this.blackHoleLit && id === 'bumper_c' && ball.state === 'free') {
      this.blackHoleLit = false;
      this.triggerBlackHole(ball, at);
      return;
    }
    if (!this.bumperCycle.includes(id)) this.bumperCycle.push(id);
    this.bumperCycleTimer = 2;
    if (this.bumperCycle.length >= 3) {
      this.bumperCycle = [];
      this.scoreboardCycles += 1;
      this.addScore(POINTS.scoreboardCycle, at, 'SCOREBOARD');
      this.scoreboardBoost = SCOREBOARD_BOOST * this.profile.modeTimeScale;
      this.bus.emit('scoreboardBoost', { active: true, seconds: this.scoreboardBoost });
      this.bus.emit('toast', { text: 'SCOREBOARD!', kind: 'great', sub: `Double scoring for ${Math.round(this.scoreboardBoost)}s`, duration: 1.8 });
      this.award('scoreboard');
      this.gainHype(HYPE_GAIN.bankComplete);
      this.registerCombo();
      if (this.scoreboardCycles % 2 === 0) {
        this.blackHoleLit = true;
        this.bus.emit('toast', { text: 'BLACK HOLE LIT', kind: 'epic', sub: 'The centre bumper is hungry', duration: 2 });
      } else this.triggerModifier('lightning');
      this.refreshLamps();
    }
  }

  private triggerBlackHole(ball: Ball, at: Vec2): void {
    const pos = this.table.bumpers.find((b) => b.id === 'bumper_c')?.pos ?? at;
    this.world.holdBall(ball, pos, 1.1, { x: 0, y: -60 }, { x: pos.x, y: pos.y - 1.9 });
    ball.height = 0;
    this.blackHoleEject = { timer: 1.1, at: pos };
    this.addScore(POINTS.blackHole, pos, 'BLACK HOLE');
    this.noteModifier('blackHole');
    this.bus.emit('modifier', { id: 'blackHole', active: true, duration: 0, name: MODIFIERS.blackHole.name, at: pos });
    this.bus.emit('blackHole', { at: pos, balls: 1, phase: 'capture' });
    this.bus.emit('toast', { text: 'PINBALL BLACK HOLE', kind: 'epic', sub: 'Captured...', duration: 1.2 });
    this.award('black_hole');
    this.refreshLamps();
  }

  private onSensor(id: string, ball: Ball, speed: number): void {
    switch (id) {
      case 'center_lane':
        this.chargeReactor(CHARGE.centerLane);
        this.addScore(POINTS.centerLane, this.table.lanes.find((l) => l.id === id)?.a);
        this.bus.emit('lane', { id });
        this.gainHype(HYPE_GAIN.lane);
        this.onRovingHit(id, { x: 10.1, y: 25.6 });
        if (this.offense) {
          if (this.power < 3) {
            this.power += 1;
            this.bus.emit('power', { level: this.power });
            this.bus.emit('toast', { text: `POWER ${this.power}`, kind: 'good', sub: this.power === 3 ? 'Max batting power!' : 'Batting power charged', duration: 1.2 });
          }
          this.registerCombo();
          this.onBaseTarget(2, 'center_lane');
          this.onBaseballMultiballHit({ x: 10.1, y: 25.6 });
          this.bossEvent('centerLane');
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
        this.chargeReactor(CHARGE.topLane);
        this.bus.emit('lane', { id });
        this.addDefense(0.1);
        this.gainHype(HYPE_GAIN.lane);
        if (this.skillShotTimer > 0 && index === this.litTopLane) {
          this.skillShotTimer = 0;
          this.addScore(POINTS.skillShot, undefined, 'SKILL SHOT');
          this.bus.emit('skillShot', { points: POINTS.skillShot });
          this.bus.emit('toast', { text: 'SKILL SHOT!', kind: 'great', sub: `+${POINTS.skillShot.toLocaleString()} · ROCKET BALL`, duration: 1.8 });
          this.award('skill_shot');
          this.gainHype(HYPE_GAIN.skillShot);
          if (this.offense && this.power < 3) {
            this.power += 1;
            this.bus.emit('power', { level: this.power });
          }
          this.triggerModifier('rocketBall');
        }
        if (!this.topLanesHit[index]) {
          this.topLanesHit[index] = true;
          if (this.topLanesHit.every(Boolean)) {
            this.topLanesHit = [false, false, false];
            this.bonusLevel = Math.min(2, this.bonusLevel + 1);
            this.kickbackLit = true;
            this.addScore(POINTS.topLanesComplete, undefined, 'LANES');
            this.bus.emit('toast', { text: 'BONUS X UP', kind: 'good', sub: 'Kickback lit', duration: 1.6 });
            this.triggerModifier(this.bonusLevel === 1 ? 'giantBall' : 'wallBounce');
          }
        }
        this.refreshTopLaneLamps();
        this.refreshLamps();
        break;
      }
      case 'hr_lane':
        this.gainHype(HYPE_GAIN.lane);
        this.onHomeRunLane(speed, ball);
        break;
      case 'dugout':
        this.onSaucer(ball);
        break;
      case 'home_plate':
        this.onPlate(ball);
        break;
      case 'mound':
        if (ball.state === 'free') this.onMound(this.table.mound.pos, speed);
        break;
      case 'left_inlane':
      case 'right_inlane':
        this.addScore(POINTS.inlane);
        this.bus.emit('lane', { id });
        this.citySignal(id === 'left_inlane' ? 0 : 1);
        break;
      case 'reactor_core':
        this.onReactorCore(ball);
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
          this.bus.emit('nearMiss', { at: ball.pos, points: POINTS.kickback });
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

  private onHomeRunLane(speed: number, ball: Ball): void {
    const quality = clamp01((speed - 25) / 75);
    this.addScore(POINTS.hrLane, { x: 1.3, y: 30 });
    this.bus.emit('lane', { id: 'hr_lane' });
    this.registerCombo();
    this.onRovingHit('hr_lane', { x: 1.3, y: 30 });
    if (this.offense) {
      if (this.hrLit && !this.batting) {
        this.hrLit = false;
        // The orbit is the sweet spot by definition: a premium, centred swing.
        this.startBatting('homeRun', Math.max(quality, 0.4), { sweetSpot: 0.9, entryAngle: 0, ball });
        // Park the ball in the orbit while the premium at-bat plays out.
        this.holdAtBatBall(ball);
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
        this.bus.emit('defenseResult', { result: { play: result.play, quality: 1, direction: 'center', sprayDeg: 0, trajectory: 'ground', distance: 0.2, reason: 'Picked off.' }, play: result, state, instant: true, reason: 'Pickoff!' });
        this.gainHype(HYPE_GAIN.out);
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
    const locksNeeded = this.profile.locksForMultiball;
    if (this.lockLit && this.lockedBalls < locksNeeded && !this.multiball) {
      this.lockedBalls += 1;
      this.lockLit = false;
      this.baseTargetsHit.clear();
      this.world.lockBall(ball, pos);
      this.addScore(POINTS.lock, pos, 'LOCK');
      this.gainHype(HYPE_GAIN.lock);
      this.bus.emit('saucer', { ball, locked: true, lockedCount: this.lockedBalls });
      this.bus.emit('toast', { text: `BALL ${this.lockedBalls} LOCKED`, kind: 'great', sub: this.lockedBalls >= locksNeeded ? 'Light lock again for MULTIBALL' : 'Hit the bases again to relight lock', duration: 2 });
      this.serveBall(true, true);
      this.refreshLamps();
      return;
    }
    if (this.lockLit && this.lockedBalls >= locksNeeded && !this.multiball) {
      this.lockLit = false;
      this.baseTargetsHit.clear();
      this.world.holdBall(ball, pos, 1.2, { x: -10, y: -75 }, { x: 18.6, y: 27.2 });
      this.startMultiball(this.boss ? 'chaos' : 'standard');
      this.refreshLamps();
      return;
    }
    this.world.holdBall(ball, pos, 0.9, { x: -10, y: -75 }, { x: 18.6, y: 27.2 });
    this.addScore(POINTS.bullpen, pos, 'BULLPEN');
    this.bus.emit('saucer', { ball, locked: false, lockedCount: this.lockedBalls });
    if (this.offense) {
      if (this.power < 3) {
        this.power += 1;
        this.bus.emit('power', { level: this.power });
      }
      // The bullpen sends in a special pitch for the next at-bat; two visits in a ball bring the baseballs out.
      this.bullpenVisits += 1;
      const special = this.rng.pick(['eephus', 'heater', 'knuckleball'] as const);
      this.queuedPitch = special;
      const label = special === 'eephus' ? 'EEPHUS incoming: slow, floating, crushable' : special === 'heater' ? '103 MPH HEATER incoming: tiny window, big payoff' : 'KNUCKLEBALL incoming: it breaks anywhere';
      this.bus.emit('toast', { text: 'BULLPEN', kind: 'info', sub: `${label} · power +1`, duration: 1.8 });
      if (this.bullpenVisits >= 2 && !this.multiball) {
        this.bullpenVisits = 0;
        this.startMultiball('baseball');
      }
    } else {
      this.addDefense(0.2);
      this.bus.emit('toast', { text: 'BULLPEN', kind: 'info', sub: 'Fresh arm: defense rating up', duration: 1.2 });
    }
    this.refreshLamps();
  }

  // ------------------------------------------------------------------ multiball modes

  /** Starts a multiball mode, releasing locked balls and spawning enough to reach the mode's ball count. */
  startMultiball(mode: Exclude<MultiballMode, 'none'>, announce = true): void {
    if (this.multiball && this.multiballMode === mode) return;
    const def = MULTIBALLS[mode];
    const upgrading = this.multiball;
    this.multiball = true;
    this.multiballMode = mode;
    if (!upgrading) this.addScore(POINTS.multiballStart, undefined, 'MULTIBALL');
    const locked = this.world.balls.filter((b) => b.state === 'locked');
    let delay = 0.3;
    for (const b of locked) {
      // Stagger the release so the balls do not overlap.
      this.world.holdBall(b, this.table.saucer.pos, 1.2 + delay, { x: -12, y: -75 }, { x: 18.6, y: 27.2 });
      delay += 0.7;
    }
    this.lockedBalls = 0;
    const inPlay = this.world.balls.filter((b) => b.state !== 'drained' && b.state !== 'launcher').length;
    const need = Math.max(0, def.balls - inPlay);
    if (need > 0) {
      const skin = mode === 'baseball' ? 'baseball' : mode === 'chaos' ? 'cosmic' : this.ballSkinFor();
      const spawned = this.world.spawnBallsAt({ x: 11, y: 40 }, need, 30, { skin, radiusScale: mode === 'baseball' ? 0.85 : undefined, spreadDeg: 150 });
      for (const b of spawned) this.bus.emit('ballSkin', { ball: b, skin });
    }
    if (mode === 'chaos') {
      this.moveRovingJackpot();
      this.award('chaos');
    } else {
      this.rovingTarget = null;
      this.bus.emit('rovingJackpot', { targetId: null });
    }
    this.addHighlight(`${this.inningLabel}: ${def.name.replace('!', '')}`, mode === 'chaos' ? 5 : 3);
    this.bus.emit('multiball', { active: true, balls: this.world.balls.length, mode });
    if (announce) this.bus.emit('toast', { text: def.name, kind: mode === 'chaos' ? 'legend' : 'epic', sub: def.sub, duration: 2.6 });
    this.bus.emit('cameraEvent', { kind: 'multiball' });
    this.award('multiball');
    this.linkImpossible('multiball');
    this.refreshLamps();
  }

  private endMultiball(): void {
    if (!this.multiball) return;
    const mode = this.multiballMode;
    this.multiball = false;
    this.multiballMode = 'none';
    this.rovingTarget = null;
    this.bus.emit('rovingJackpot', { targetId: null });
    this.bus.emit('multiball', { active: false, balls: this.world.balls.length, mode });
    this.bus.emit('toast', { text: mode === 'chaos' ? 'CHAOS OVER' : 'MULTIBALL OVER', kind: 'info', duration: 1.2 });
    this.refreshLamps();
  }

  private moveRovingJackpot(): void {
    const candidates = ['base_1b', 'base_3b', 'center_lane', 'hr_lane', 'mound', 'leftField_1', 'rightField_1'];
    const next = this.rng.pick(candidates.filter((c) => c !== this.rovingTarget));
    this.rovingTarget = next;
    this.rovingTimer = 2.2 * this.profile.modeTimeScale;
    this.bus.emit('rovingJackpot', { targetId: next });
  }

  private onRovingHit(id: string, at: Vec2): void {
    if (this.multiballMode !== 'chaos' || this.rovingTarget !== id) return;
    this.addScore(POINTS.jackpot, at, 'ROVING JACKPOT');
    this.gainHype(HYPE_GAIN.ramp);
    this.bus.emit('toast', { text: 'ROVING JACKPOT!', kind: 'great', duration: 1.2 });
    this.moveRovingJackpot();
  }

  /** BASEBALL MULTIBALL: every lit target hit is a base hit for the tiny team. */
  private onBaseballMultiballHit(at: Vec2): void {
    if (this.multiballMode !== 'baseball' || !this.offense || this.batting || this.baseball.gameOver || this.baseballHitCooldown > 0) return;
    this.baseballHitCooldown = 1.5;
    const { state, result } = applyPlay(this.baseball, { type: 'single', contact: 0.55 });
    this.commitBaseball(state, result, true);
    this.stats.hits += 1;
    this.stats.runs += result.runs;
    this.addScore(POINTS.single, at, 'BASE HIT');
    this.gainHype(HYPE_GAIN.single);
    this.bus.emit('playResult', { play: result, state, offense: true });
    this.bus.emit('toast', { text: result.runs ? `BASE HIT · ${result.runs} RUN${result.runs > 1 ? 'S' : ''}` : 'BASE HIT', kind: result.runs ? 'great' : 'good', sub: 'Baseball multiball: targets are hits', duration: 1.2 });
    this.bossEvent('hit');
  }

  // ------------------------------------------------------------------ home run derby

  private startDerby(): void {
    if (this.derby.active) return;
    const total = DERBY_SECONDS * this.profile.modeTimeScale;
    this.derby = { active: true, timer: total, total, homers: 0 };
    this.addHighlight(`${this.inningLabel}: HOME RUN DERBY`, 4);
    this.bus.emit('derby', { active: true, homers: 0, multiplier: 1, remaining: total });
    this.bus.emit('toast', { text: 'HOME RUN DERBY!', kind: 'epic', sub: 'Every ramp is an at-bat with loft. Chain homers.', duration: 2.6 });
    this.hrLit = true;
    if (!this.multiball) this.startMultiball('derby', false);
    this.refreshLamps();
  }

  private endDerby(): void {
    if (!this.derby.active) return;
    const homers = this.derby.homers;
    this.derby.active = false;
    this.stats.derbyBest = Math.max(this.stats.derbyBest, homers);
    if (homers >= 3) this.award('derby');
    this.bus.emit('derby', { active: false, homers, multiplier: derbyMultiplier(homers), remaining: 0 });
    this.bus.emit('toast', { text: 'DERBY OVER', kind: 'info', sub: `${homers} homer${homers === 1 ? '' : 's'}`, duration: 1.6 });
    if (this.multiballMode === 'derby') this.endMultiball();
  }

  // ------------------------------------------------------------------ table modifiers

  /** Starts a modifier if the stacking rules allow it. Returns true when it started or refreshed. */
  triggerModifier(id: ModifierId, opts: { silent?: boolean; ball?: Ball } = {}): boolean {
    const def = MODIFIERS[id];
    const duration = def.duration > 0 ? def.duration * (id === 'slowMo' ? 1 : this.profile.modeTimeScale) : 0;
    const result = activateModifier(this.modifiers, id, duration);
    if (result === 'refused') return false;
    this.noteModifier(id);
    const primary = opts.ball ?? this.world.balls.find((b) => b.state === 'free') ?? this.world.balls.find((b) => b.state !== 'drained');
    let at: Vec2 | undefined;
    switch (id) {
      case 'gravityFlip':
        this.world.mods.gravityScale = -0.8;
        break;
      case 'turboLaunch':
        this.turboQueued = true;
        break;
      case 'giantBall':
        this.world.mods.ballScale = 1.5;
        this.world.applyBallRadius();
        for (const b of this.world.balls) if (!b.radiusLocked) this.bus.emit('ballSkin', { ball: b, skin: 'giant' });
        break;
      case 'splitBall': {
        if (!primary || (primary.state !== 'free' && primary.state !== 'guided')) return false;
        at = { ...primary.pos };
        const spawned = this.world.spawnBallsAt(primary.pos, 2, Math.max(40, Math.hypot(primary.vel.x, primary.vel.y)), { radiusScale: 0.7, skin: 'baseball', spreadDeg: 90 });
        for (const b of spawned) this.bus.emit('ballSkin', { ball: b, skin: 'baseball' });
        break;
      }
      case 'magnet':
        for (const t of ['base_1b', 'base_3b']) {
          const target = this.table.targets.find((x) => x.id === t)!;
          this.world.addAttractor({ id: `mag_${t}`, pos: { x: (target.a.x + target.b.x) / 2, y: (target.a.y + target.b.y) / 2 - 1.2 }, strength: 320, radius: 7 });
        }
        for (const r of this.table.ramps) this.world.addAttractor({ id: `mag_${r.id}`, pos: { x: (r.entrance.a.x + r.entrance.b.x) / 2, y: r.entrance.a.y - 2 }, strength: 260, radius: 6 });
        this.world.addAttractor({ id: 'mag_center', pos: { x: 10.1, y: 24.4 }, strength: 260, radius: 6 });
        break;
      case 'lightning':
        break;
      case 'wallBounce':
        for (const b of this.table.blockers) this.world.setColliderEnabled(b.id, true);
        break;
      case 'slowMo':
        this.world.mods.timeScale = 0.42;
        break;
      case 'blackHole':
        if (!primary || primary.state !== 'free') return false;
        this.triggerBlackHole(primary, primary.pos);
        return true;
      case 'rocketBall':
        for (const b of this.world.balls) {
          if (b.state === 'drained' || b.radiusLocked) continue;
          b.thrust = 55;
          this.bus.emit('ballSkin', { ball: b, skin: 'rocket' });
        }
        break;
    }
    if (def.bonus > 0 && result === 'started') this.addScore(def.bonus, at, def.name);
    this.bus.emit('modifier', { id, active: true, duration, name: def.name, at });
    if (!opts.silent && result === 'started') this.bus.emit('toast', { text: def.name, kind: id === 'slowMo' ? 'info' : 'epic', sub: def.sub, duration: id === 'slowMo' ? 0.8 : 2.2 });
    return true;
  }

  private noteModifier(id: ModifierId): void {
    if (!this.modifiersUsed.has(id)) {
      this.modifiersUsed.add(id);
      this.stats.modifiers += 1;
      if (this.modifiersUsed.size >= 5) this.award('modifier_5');
    }
  }

  private onModifierEnd(id: ModifierId): void {
    switch (id) {
      case 'gravityFlip':
        this.world.mods.gravityScale = 1;
        break;
      case 'giantBall':
        this.world.mods.ballScale = 1;
        this.world.applyBallRadius();
        for (const b of this.world.balls) if (!b.radiusLocked) this.bus.emit('ballSkin', { ball: b, skin: b.thrust > 0 ? 'rocket' : b.skin });
        break;
      case 'magnet':
        for (const id2 of [...this.world.attractors.keys()]) if (id2.startsWith('mag_')) this.world.removeAttractor(id2);
        break;
      case 'wallBounce':
        for (const b of this.table.blockers) this.world.setColliderEnabled(b.id, false);
        break;
      case 'slowMo':
        this.world.mods.timeScale = 1;
        break;
      case 'rocketBall':
        for (const b of this.world.balls) {
          b.thrust = 0;
          this.bus.emit('ballSkin', { ball: b, skin: this.world.mods.ballScale > 1 && !b.radiusLocked ? 'giant' : b.skin });
        }
        break;
      default:
        break;
    }
    this.bus.emit('modifier', { id, active: false, duration: 0, name: MODIFIERS[id].name });
  }

  /** Ends every modifier and restores the baseline physics exactly. */
  private endAllModifiers(): void {
    for (const id of clearModifierState(this.modifiers)) this.onModifierEnd(id);
    this.turboQueued = false;
    this.blackHoleEject = null;
    this.world.clearModifiers();
    for (const b of this.table.blockers) this.world.setColliderEnabled(b.id, false);
  }

  // ------------------------------------------------------------------ bosses

  startBoss(id: BossId): void {
    if (this.boss) return;
    this.boss = createBoss(id, this.profile);
    this.bossesSeen.add(id);
    const def = BOSSES[id];
    if (id === 'wall') this.boss.litSection = this.rng.pick(WALL_ORDER);
    this.addHighlight(`${this.inningLabel}: ${def.name} appears`, 2);
    this.bus.emit('toast', { text: def.name, kind: 'legend', sub: def.intro, duration: 3 });
    this.bus.emit('cameraEvent', { kind: 'hit', direction: 'center' });
    this.emitBoss();
    this.refreshLamps();
  }

  private emitBoss(beaten = false): void {
    const b = this.boss;
    if (!b) return;
    const o = bossObjective(b);
    this.bus.emit('boss', { id: b.id, active: true, stage: b.stage, progress: o.progress, goal: o.goal, label: BOSSES[b.id].name, sub: o.label, timer: b.timer, beaten });
  }

  private endBoss(beaten: boolean): void {
    const b = this.boss;
    if (!b) return;
    const def = BOSSES[b.id];
    this.boss = null;
    if (beaten) {
      this.bossesBeaten.push(b.id);
      this.addScore(def.reward, undefined, `${def.name} BEATEN`);
      this.award(def.achievement);
      this.addHighlight(`${this.inningLabel}: Beat ${def.name}`, 7);
      this.gainHype(HYPE_GAIN.homeRun);
      this.bus.emit('toast', { text: `${def.name} DEFEATED!`, kind: 'legend', sub: `+${def.reward.toLocaleString()}`, duration: 2.8 });
      this.bus.emit('cameraEvent', { kind: 'hit', direction: 'center' });
      this.bus.emit('hitStop', { seconds: 0.25 });
      // Every boss hands over a table modifier as its prize.
      const prize: ModifierId = b.id === 'ace' ? 'splitBall' : b.id === 'wall' ? 'gravityFlip' : b.id === 'commissioner' ? 'turboLaunch' : 'rocketBall';
      this.triggerModifier(prize);
      if (b.id === 'nightmare') this.addScore(POINTS.nightmareWalkOff - def.reward, undefined, 'WALK-OFF');
    } else {
      this.bus.emit('toast', { text: `${def.name} ESCAPES`, kind: 'bad', sub: 'Next time.', duration: 1.8 });
    }
    this.bus.emit('boss', { id: b.id, active: false, stage: b.stage, progress: 0, goal: 1, label: def.name, sub: '', timer: 0, beaten });
    this.refreshLamps();
  }

  /** Boss objectives listen to gameplay events. */
  private bossEvent(kind: 'hit' | 'homeRun' | 'out' | 'centerLane' | 'runnerAdvanced' | 'runScored'): void {
    const b = this.boss;
    if (!b) return;
    let r: 'none' | 'stage' | 'done' = 'none';
    switch (b.id) {
      case 'ace':
        if (kind === 'hit' || kind === 'homeRun') r = bossProgress(b);
        else if (kind === 'out') {
          b.outs += 1;
          if (b.outs >= 3) {
            this.endBoss(false);
            return;
          }
        }
        break;
      case 'wall':
        if (b.stage === 1 && kind === 'homeRun') r = bossProgress(b);
        break;
      case 'commissioner':
        if (b.stage === 0 && kind === 'centerLane') r = bossProgress(b);
        else if (b.stage === 1 && (kind === 'hit' || kind === 'homeRun')) r = bossProgress(b);
        else if (b.stage === 2 && (kind === 'runnerAdvanced' || kind === 'hit' || kind === 'homeRun')) r = bossProgress(b);
        break;
      case 'nightmare':
        if (kind === 'runScored') r = bossProgress(b);
        break;
    }
    if (r === 'done') this.endBoss(true);
    else {
      if (r === 'stage') this.bus.emit('toast', { text: 'OBJECTIVE COMPLETE', kind: 'great', sub: bossObjective(b).label, duration: 1.6 });
      this.emitBoss();
    }
  }

  // ------------------------------------------------------------------ THE IMPOSSIBLE INNING

  private linkImpossible(link: ImpossibleLink): void {
    if (!this.offense || this.impossibleDone) return;
    const before = impossibleCount(this.impossible);
    const complete = addImpossibleLink(this.impossible, link);
    const have = impossibleCount(this.impossible);
    if (complete) {
      this.impossibleDone = true;
      this.bus.emit('impossible', { stage: 'complete', link, have, needed: this.impossible.needed, links: [...this.impossible.links] });
      this.triggerImpossibleInning();
    } else if (have > before) {
      this.bus.emit('impossible', { stage: 'link', link, have, needed: this.impossible.needed, links: [...this.impossible.links] });
      if (have >= 2) this.bus.emit('toast', { text: `IMPOSSIBLE INNING ${have}/${this.impossible.needed}`, kind: 'info', sub: 'Keep the chain alive this half-inning', duration: 1.4 });
    }
  }

  /** The signature event: every system links into one chain reaction. */
  private triggerImpossibleInning(): void {
    this.addHighlight(`${this.inningLabel}: THE IMPOSSIBLE INNING`, 20);
    this.store.data.stats.impossibleInnings += 1;
    this.addScore(POINTS.impossibleInning, undefined, 'THE IMPOSSIBLE INNING');
    this.award(`impossible_${this.profile.id}`);
    this.grantExtraBall();
    this.bus.emit('hitStop', { seconds: 0.5 });
    this.bus.emit('toast', { text: 'THE IMPOSSIBLE INNING', kind: 'legend', sub: 'Every system linked. ABSOLUTE LEGEND.', duration: 4 });
    this.bus.emit('cameraEvent', { kind: 'hit', direction: 'center' });
    if (!this.multiball || this.multiballMode !== 'chaos') this.startMultiball('chaos', false);
    this.triggerModifier('rocketBall', { silent: true });
    this.hrLit = true;
    this.scoreboardBoost = Math.max(this.scoreboardBoost, 20);
    this.bus.emit('scoreboardBoost', { active: true, seconds: this.scoreboardBoost });
    this.refreshLamps();
  }


  // ------------------------------------------------------------------ the miniature universe

  private resetAttractions(): void {
    this.director.reset();
    this.flushDirector();
    this.reactor = createReactor();
    this.city = { signals: [false, false, false], lit: false, level: 0, trophies: [], runs: 0 };
    this.rush = null;
    this.attraction = null;
    this.tour = { stadium: false, city: false, reactor: false };
    this.worldMult = 1;
    this.pending = [];
    this.coreCooldown = 0;
  }

  /** A capture attraction may take this ball: single ball in play, nothing else owns it. */
  private canCapture(ball: Ball): boolean {
    if (this.multiball || this.batting || this.attraction || this.blackHoleEject) return false;
    return !this.world.balls.some((b) => b.id !== ball.id && (b.state === 'free' || b.state === 'guided' || b.state === 'held' || b.state === 'launcher'));
  }

  /** Flipper input while an attraction owns the ball. Returns true when consumed. */
  private attractionInput(side: 'left' | 'right'): boolean {
    const a = this.attraction;
    if (!a) return false;
    if (a.kind === 'city' && this.rush && a.phase === 'race') this.handleRushEvents(rushInput(this.rush, side));
    else if (a.kind === 'reactor' && a.phase === 'overload') this.handleReactorEvents(tapOverload(this.reactor, side));
    // Every press is consumed while the ball is captured: nothing else on the table reacts.
    return true;
  }

  private updateAttraction(dt: number): void {
    const a = this.attraction!;
    a.t += dt;
    if (a.kind === 'city' && this.rush && a.phase === 'race') this.handleRushEvents(updateRush(this.rush, dt));
    else if (a.kind === 'reactor' && a.phase === 'overload') this.handleReactorEvents(updateOverload(this.reactor, dt));
    // Safety net: no attraction may hold the ball for long.
    if (a.phase !== 'finish' && a.t > 24) this.abortAttraction();
  }

  /** Ends a mini-game early (camera pulled, watchdog): pays what was earned and gives the ball back. */
  private abortAttraction(): void {
    const a = this.attraction;
    if (!a || a.phase === 'finish') return;
    if (a.kind === 'city') {
      if (this.rush && a.phase === 'race') this.finishRush();
      else this.handBack(a.ballId, 'city');
    } else if (a.phase === 'overload') this.finishOverload();
    else this.handBack(a.ballId, 'reactor');
  }

  /** Releases a captured ball once the camera is home, with a short ball save. */
  private handBack(ballId: number, kind: 'city' | 'reactor', after?: () => void): void {
    const a = this.attraction;
    if (a) a.phase = 'finish';
    const wasActive = this.director.isActive(kind);
    this.endShot(kind);
    const lead = wasActive ? CAMERA_EXIT_LEAD : 0;
    // The ejected ball must clear the core before it can be captured or fed again.
    if (kind === 'reactor') this.coreCooldown = lead + 1.5;
    const ball = this.world.balls.find((b) => b.id === ballId);
    if (ball) this.world.releaseHeldIn(ball, lead);
    this.schedule(lead, () => {
      this.attraction = null;
      this.ballSaveTimer = Math.max(this.ballSaveTimer, this.profile.attractionBallSave);
      this.refreshLamps();
      after?.();
    });
  }

  private markTour(stop: 'stadium' | 'city' | 'reactor'): void {
    if (this.tour[stop]) return;
    this.tour[stop] = true;
    const complete = this.tour.stadium && this.tour.city && this.tour.reactor;
    this.bus.emit('tour', { ...this.tour, complete });
    if (!complete) return;
    // GRAND TOUR: the whole miniature universe lights up at once.
    this.tour = { stadium: false, city: false, reactor: false };
    this.addScore(POINTS.grandTour, undefined, 'GRAND TOUR');
    this.raiseWorldMult(1);
    this.award('grand_tour');
    this.addHighlight(`${this.inningLabel}: THE GRAND TOUR`, 9);
    this.city.lit = true;
    if (!this.reactor.ready && !this.reactor.overload) {
      forceReady(this.reactor);
      this.bus.emit('reactor', { event: { type: 'ready' }, state: this.reactor });
    }
    this.bus.emit('hitStop', { seconds: 0.35 });
    this.bus.emit('toast', { text: 'GRAND TOUR!', kind: 'legend', sub: `Stadium · Sandlot · Heater · WORLD x${this.worldMult}`, duration: 3.2 });
    this.bus.emit('citySignal', { signals: [...this.city.signals], needed: this.profile.citySignalsNeeded, lit: true });
    this.requestShot('jackpot');
    this.refreshLamps();
  }

  private raiseWorldMult(step: number): void {
    const next = Math.min(3, this.worldMult + step);
    if (next === this.worldMult) return;
    this.worldMult = next;
    this.bus.emit('worldMult', { value: next });
  }

  // ---- THE SANDLOT (WALL CATCH) ----

  /** Inlanes and bank completions light the city's traffic signals; enough of them open the diverter. */
  private citySignal(index: number): void {
    if (this.city.lit || this.city.signals[index]) return;
    this.city.signals[index] = true;
    this.addScore(POINTS.citySignal);
    const have = this.city.signals.filter(Boolean).length;
    const needed = this.profile.citySignalsNeeded;
    if (have >= needed) {
      this.city.lit = true;
      this.city.signals = [false, false, false];
      this.addScore(POINTS.cityLit, undefined, 'SANDLOT OPEN');
      this.bus.emit('toast', { text: 'SANDLOT OPEN', kind: 'great', sub: 'Shoot the left ramp for WALL CATCH', duration: 2 });
    }
    this.bus.emit('citySignal', { signals: [...this.city.signals], needed, lit: this.city.lit });
    this.refreshLamps();
  }

  /** The left ramp's diverter flips and sends the ball into the city. */
  private tryDivertToCity(ball: Ball): boolean {
    if (!this.city.lit || ball.state !== 'guided' || !this.canCapture(ball)) return false;
    if (!this.world.divertGuided(ball, 'city_track')) return false;
    this.city.lit = false;
    const cruise = !this.director.miniGamesEnabled;
    this.attraction = { kind: 'city', ballId: ball.id, phase: 'ride', t: 0 };
    this.addScore(POINTS.cityDivert, undefined, 'SANDLOT');
    this.bus.emit('cityDivert', { ball, cruise });
    if (!cruise) {
      this.requestShot('city');
    }
    this.refreshLamps();
    return true;
  }

  /** The ball reached the garage at the end of the city track. */
  private onCityGarage(ball: Ball): void {
    const a = this.attraction;
    if (!a || a.kind !== 'city' || a.ballId !== ball.id) {
      // Not ours (should not happen): send it straight home.
      this.world.releaseHeldIn(ball, 0);
      return;
    }
    if (!this.director.miniGamesEnabled || !this.director.isActive('city')) {
      // Pure-pinball mode: a sightseeing lap and an instant award, no capture.
      this.city.level += 1;
      this.addScore(CITY_CRUISE_POINTS, undefined, 'SANDLOT TOUR');
      this.bus.emit('cityResult', { grade: 'cruise', points: CITY_CRUISE_POINTS, stunt: 'none', crashes: 0, nearMisses: 0, coins: 0, trophy: null, trophies: [...this.city.trophies], level: this.city.level });
      this.markTour('city');
      this.handBack(ball.id, 'city');
      return;
    }
    a.phase = 'race';
    a.t = 0;
    const p = this.profile;
    this.rush = createRush(this.rng, { seconds: p.cityRushSeconds, obstacles: p.cityObstacles + Math.min(3, this.city.level), windowScale: p.miniGameWindowScale });
    this.bus.emit('cityRush', { event: { type: 'start' }, rush: this.rush });
  }

  private handleRushEvents(events: RushEvent[]): void {
    const r = this.rush;
    if (!r) return;
    for (const e of events) {
      this.bus.emit('cityRush', { event: e, rush: r });
      switch (e.type) {
        case 'pass':
          this.addScore(4000);
          break;
        case 'nearMiss':
          this.addScore(12000, undefined, 'NEAR MISS');
          break;
        case 'coin':
          this.addScore(5000);
          break;
        case 'stunt':
          if (e.success) this.bus.emit('hitStop', { seconds: 0.18 });
          break;
        case 'done':
          this.finishRush();
          break;
      }
    }
  }

  private finishRush(): void {
    const r = this.rush;
    const a = this.attraction;
    if (!r || !a) return;
    this.rush = null;
    a.phase = 'finish';
    const grade = rushGrade(r);
    const points = rushScore(r, this.city.level);
    this.addScore(points, undefined, r.stunt === 'jump' ? 'HOME RUN ROBBED' : 'WALL CATCH');
    let trophy: Landmark | null = null;
    if (r.stunt === 'jump') {
      // Every robbed home run hangs a banner on the sandlot wall; it stays up for the whole game.
      trophy = LANDMARKS.find((l) => !this.city.trophies.includes(l)) ?? null;
      if (trophy) this.city.trophies.push(trophy);
    }
    this.city.level += 1;
    this.city.runs += 1;
    this.award('city_rush');
    if (grade === 'legendary') {
      this.award('city_legend');
      this.raiseWorldMult(0.5);
      this.addHighlight(`${this.inningLabel}: Robbed a home run at the wall`, 6);
    }
    this.bus.emit('cityResult', { grade, points, stunt: r.stunt === 'jump' ? 'jump' : 'crash', crashes: r.crashes, nearMisses: r.nearMisses, coins: r.coinsTaken, trophy, trophies: [...this.city.trophies], level: this.city.level });
    const title = r.stunt === 'jump' ? 'ROBBED!' : 'OVER THE WALL';
    const sub = grade === 'legendary' ? `Clean run · WORLD x${this.worldMult}` : `${r.coinsTaken} catch${r.coinsTaken === 1 ? '' : 'es'} · ${r.crashes} collision${r.crashes === 1 ? '' : 's'}`;
    this.bus.emit('toast', { text: title, kind: grade === 'legendary' ? 'legend' : r.stunt === 'jump' ? 'epic' : 'great', sub, duration: 2.4 });
    if (this.city.trophies.length >= LANDMARKS.length) {
      // Three banners up: WALL OF FAME pays out and the wall is cleared for the next set.
      this.city.trophies = [];
      this.addScore(POINTS.cityRebuild, undefined, 'WALL OF FAME');
      this.bus.emit('cityRebuild', { level: this.city.level });
      this.bus.emit('toast', { text: 'WALL OF FAME', kind: 'epic', sub: 'Three robbed homers', duration: 2.2 });
    }
    this.markTour('city');
    this.handBack(a.ballId, 'city');
  }

  // ---- REACTOR CORE ----

  private chargeReactor(amount: number): void {
    if (this.attraction?.kind === 'reactor') return;
    // Reactor multiball relights the core twice as fast.
    const k = this.multiballMode === 'reactor' ? 2 : 1;
    this.handleReactorEvents(addCharge(this.reactor, amount * k, this.profile.reactorChargeScale));
  }

  private handleReactorEvents(events: ReactorEvent[]): void {
    for (const e of events) {
      this.bus.emit('reactor', { event: e, state: this.reactor });
      switch (e.type) {
        case 'ring':
          this.addScore(POINTS.reactorRing, this.table.attractions.reactor.core, `${HEATER_MPH[e.ring]} MPH`);
          if (e.ring < 2) this.bus.emit('toast', { text: `THE HEATER · ${HEATER_MPH[e.ring]} MPH`, kind: 'good', sub: 'Bumpers and lanes spin the pitching machine up', duration: 1.3 });
          break;
        case 'ready':
          this.addScore(POINTS.reactorReady, this.table.attractions.reactor.core, '100 MPH');
          this.bus.emit('toast', { text: 'THE HEATER IS HOT', kind: 'epic', sub: 'Shoot the centre lane to step in and face it', duration: 2.2 });
          this.refreshLamps();
          break;
        case 'pulse': {
          const at = this.table.attractions.reactor.core;
          if (e.result === 'homer') {
            this.addScore(POINTS.reactorSync * 3, at, 'HOME RUN');
            this.gainHype(HYPE_GAIN.ramp * 2);
            this.bus.emit('crowdWave', {});
          } else if (e.result === 'hit') this.addScore(POINTS.reactorSync, at, 'BASE HIT');
          else if (e.result === 'take') this.addScore(Math.round(POINTS.reactorSync / 2), at, 'GOOD EYE');
          break;
        }
        case 'done':
          this.finishOverload();
          break;
      }
    }
  }

  /** The core rollover: feeds charge when closed, captures the ball when open. */
  private onReactorCore(ball: Ball): void {
    if (ball.state !== 'free' || this.coreCooldown > 0) return;
    const core = this.table.attractions.reactor;
    if (!this.reactor.ready) {
      this.coreCooldown = 1;
      this.addScore(POINTS.reactorFeed, core.core);
      this.chargeReactor(CHARGE.coreRollover);
      return;
    }
    if (this.multiball) {
      // Multiball: no capture, the open core pays a SUPER JACKPOT on contact.
      const points = POINTS.superJackpot * (1 + this.reactor.level * 0.5);
      completeOverload(this.reactor);
      this.addScore(points, core.core, 'SUPER JACKPOT');
      this.bus.emit('reactor', { event: { type: 'super' }, state: this.reactor });
      this.bus.emit('reactorResult', { syncs: 0, outcome: 'instant', points });
      this.coreCooldown = 1.5;
      this.bus.emit('toast', { text: 'SUPER JACKPOT!', kind: 'legend', sub: 'The Heater sprays fastballs across the table', duration: 2 });
      this.requestShot('jackpot');
      this.markTour('reactor');
      this.refreshLamps();
      return;
    }
    if (!this.canCapture(ball) || !this.director.miniGamesEnabled) {
      // Pure-pinball mode: the overload resolves instantly at the multiball threshold.
      const syncs = this.profile.overloadSyncsForMultiball;
      const points = overloadJackpot(syncs, this.reactor.level);
      completeOverload(this.reactor);
      this.addScore(points, core.core, 'HEATER JACKPOT');
      this.bus.emit('reactor', { event: { type: 'super' }, state: this.reactor });
      this.bus.emit('reactorResult', { syncs, outcome: 'instant', points });
      this.bus.emit('toast', { text: 'BEAT THE HEATER', kind: 'epic', sub: 'Heater multiball!', duration: 2 });
      this.award('reactor_overload');
      this.markTour('reactor');
      if (!this.batting) this.startMultiball('reactor');
      this.refreshLamps();
      return;
    }
    // Capture: the ball drops into the machine's hopper, the camera goes behind the batter, the showdown begins.
    this.world.holdBall(ball, core.core, 20, core.ejectVel, core.core);
    this.attraction = { kind: 'reactor', ballId: ball.id, phase: 'overload', t: 0 };
    startOverload(this.reactor, this.profile.miniGameWindowScale, this.rng.next() * 1e9);
    this.requestShot('reactor');
    this.bus.emit('reactor', { event: { type: 'capture' }, state: this.reactor });
    // The mini-game bar names it; the prompt line says what to do.
    this.refreshLamps();
  }

  private finishOverload(): void {
    const a = this.attraction;
    const o = this.reactor.overload;
    if (!a || a.kind !== 'reactor' || !o || a.phase === 'finish') return;
    a.phase = 'finish';
    const syncs = o.syncs;
    const homers = o.homers;
    const outcome = overloadOutcome(syncs, this.profile.overloadSyncsForMultiball);
    const points = overloadJackpot(syncs, this.reactor.level, homers);
    completeOverload(this.reactor);
    this.addScore(points, this.table.attractions.reactor.core, outcome === 'meltdown' ? 'PERFECT SHOWDOWN' : 'HEATER JACKPOT');
    if (homers >= 3) this.addHighlight(`${this.inningLabel}: ${homers} homers off THE HEATER`, 5);
    this.bus.emit('reactorResult', { syncs, outcome, points });
    this.markTour('reactor');
    if (outcome !== 'fizzle') this.award('reactor_overload');
    if (outcome === 'meltdown') {
      this.award('meltdown');
      this.reactor.critical = 20 * this.profile.modeTimeScale;
      this.raiseWorldMult(0.5);
      this.addHighlight(`${this.inningLabel}: PERFECT SHOWDOWN vs THE HEATER`, 7);
      this.bus.emit('hitStop', { seconds: 0.3 });
    }
    const title = outcome === 'meltdown' ? 'PERFECT SHOWDOWN!' : outcome === 'overload' ? 'YOU BEAT THE HEATER!' : 'THE HEATER WINS';
    const tally = `${syncs}/5 pitches won${homers ? ` · ${homers} HR` : ''}`;
    const sub = `${tally}${outcome === 'meltdown' ? ' · bumpers x3 for 20s' : outcome === 'overload' ? ' · HEATER MULTIBALL' : ' · jackpot paid, spin it up again'}`;
    this.bus.emit('toast', { text: title, kind: outcome === 'meltdown' ? 'legend' : outcome === 'overload' ? 'epic' : 'info', sub, duration: 2.4 });
    // Release first; the extra balls arrive once the camera is back on the table.
    this.handBack(a.ballId, 'reactor', () => {
      if (outcome !== 'fizzle' && !this.multiball) this.startMultiball('reactor');
    });
  }

  // ------------------------------------------------------------------ ramps + combos

  private registerCombo(): void {
    const before = this.combo.count;
    const count = registerComboShot(this.combo, this.comboWindow);
    this.bus.emit('combo', { count, best: this.combo.best, broke: false });
    const tier = comboTier(count);
    if (tier !== comboTier(before) && tier !== 'none' && tier !== 'warm') {
      this.bus.emit('toast', { text: `${COMBO_TIER_LABEL[tier]} x${count}`, kind: tier === 'legend' ? 'legend' : 'great', duration: 1.4 });
    }
    if (count >= 5) this.linkImpossible('combo5');
    if (count >= 7 && this.profile.id === 'hard') this.award('hard_combo');
    if (count >= 10) this.award('combo_10');
  }

  private onRamp(id: string, quality: number, ball: Ball, offset = 0.5, angle = 0): void {
    const lane: ShotLane = id === 'left_ramp' ? 'left' : 'right';
    this.registerCombo();
    this.stats.rampStreak += 1;
    this.stats.bestRampStreak = Math.max(this.stats.bestRampStreak, this.stats.rampStreak);
    if (this.stats.rampStreak >= 3) this.award('ramp_streak');
    const pts = POINTS.ramp + Math.round(POINTS.rampQualityBonus * quality) + (this.multiball ? POINTS.jackpot : 0);
    this.addScore(pts, this.table.ramps.find((r) => r.id === id)?.entrance.a, this.multiball ? 'JACKPOT' : 'RAMP');
    this.gainHype(HYPE_GAIN.ramp + Math.max(0, this.combo.count - 1) * 2);
    this.bus.emit('rampEnter', { id, quality });
    this.onRovingHit(id, this.table.ramps.find((r) => r.id === id)?.entrance.a ?? ball.pos);
    this.chargeReactor(CHARGE.ramp);
    if (id === 'left_ramp' && this.tryDivertToCity(ball)) return;
    if (this.baseball.gameOver) return;
    if (this.offense) {
      if (!this.batting) this.startBatting(lane, quality, { sweetSpot: sweetSpotFor(offset), entryAngle: angle, ball });
    } else {
      this.addDefense(0.3);
      this.instantOut('Strike three! The ramp shot blows the batter away.', { type: 'strikeout' });
      this.addScore(POINTS.strikeoutPitch, undefined, 'K');
      this.gainHype(HYPE_GAIN.strikeout);
    }
  }

  // ------------------------------------------------------------------ batting (offense)

  /**
   * Starts an at-bat. The pitch is announced immediately (type and speed) so
   * the player can time the swing; the steel ball that earned the at-bat is
   * parked on the ramp return until the play resolves, so swinging never costs
   * control of a live ball.
   */
  startBatting(lane: ShotLane, shotQuality: number, opts: { sweetSpot?: number; entryAngle?: number; ball?: Ball } = {}): void {
    if (this.batting || !this.offense || this.baseball.gameOver) return;
    const ace = this.boss?.id === 'ace';
    const pitch = choosePitch(this.rng, this.profile.batting, this.baseball.inning, { windowScale: this.profile.battingWindowScale, forced: this.queuedPitch ?? undefined, ace });
    this.queuedPitch = null;
    this.batting = {
      lane,
      shotQuality,
      sweetSpot: opts.sweetSpot ?? 0.6,
      entryAngle: opts.entryAngle ?? 0,
      pitch,
      t: 0,
      pitchDelay: pitch.delay,
      windowSeconds: pitch.window,
      swung: false,
      resolved: false,
      cooldown: AT_BAT_RELEASE,
      ballId: opts.ball?.id ?? null,
      held: false,
      cinematic: false,
    };
    this.pitchClock = this.profile.pitchClock;
    this.refreshLamps();
    this.bus.emit('battingStart', {
      lane,
      shotQuality,
      sweetSpot: this.batting.sweetSpot,
      pitchDelay: pitch.delay,
      windowSeconds: pitch.window,
      half: this.baseball.half,
      power: this.power,
      pitch,
      clutch: this.clutch,
      rally: this.rally,
    });
    // DIAMOND STADIUM camera: the broadcast push-in (only while every ball is parked).
    this.requestShot('atBat', opts.ball?.id ?? null);
  }

  /** Parks the at-bat ball where it is (ramp return or orbit) until the at-bat ends. */
  private holdAtBatBall(ball: Ball): void {
    const b = this.batting;
    if (!b || b.ballId !== ball.id || b.held || ball.state !== 'free') return;
    b.held = true;
    this.world.holdBall(ball, ball.pos, AT_BAT_WATCHDOG, { ...ball.vel }, { ...ball.pos });
    this.bus.emit('atBatHold', { ball });
  }

  private maybeHoldAtBatBall(ball: Ball): void {
    if (this.batting && this.batting.ballId === ball.id) this.holdAtBatBall(ball);
  }

  /** Ends the at-bat and releases the parked ball. */
  private endAtBat(skipped = false): void {
    const b = this.batting;
    if (!b) return;
    const ball = b.ballId !== null ? this.world.balls.find((x) => x.id === b.ballId) ?? null : null;
    // When the camera was in the stadium, the ball waits for it to get back to the table.
    const wasDiving = this.director.isActive('atBat') || this.director.isActive('homeRun');
    this.endShot('homeRun');
    this.endShot('atBat');
    if (ball && b.held) {
      if (wasDiving) this.world.releaseHeldIn(ball, CAMERA_EXIT_LEAD);
      else this.world.releaseHeld(ball);
    }
    const cinematic = b.cinematic;
    this.batting = null;
    this.bus.emit('atBatRelease', { ball });
    if (cinematic) this.bus.emit('cinematicEnd', { skipped });
    this.refreshLamps();
  }

  private cancelBatting(): void {
    this.endAtBat();
  }

  private updateBatting(dt: number): void {
    const b = this.batting!;
    b.t += dt;
    if (!b.swung && b.t >= b.pitchDelay + b.windowSeconds * 1.1) {
      this.takePitch();
    } else if (b.swung) {
      b.cooldown -= dt;
      // The camera starts home a beat before the ball is released.
      if (b.cooldown <= CAMERA_EXIT_LEAD) {
        this.endShot('homeRun');
        this.endShot('atBat');
      }
      if (b.cooldown <= 0) this.endAtBat();
    }
  }

  private trySwing(): void {
    const b = this.batting;
    if (!b || b.swung) return;
    const offset = b.t - b.pitchDelay;
    if (offset < -0.75) return; // batter waits on the pitch
    this.swing(offset, false);
  }

  /** No swing: the umpire calls it. Hard stuff in the zone is a strike, breaking balls can miss. */
  private takePitch(): void {
    const b = this.batting;
    if (!b || b.swung) return;
    b.swung = true;
    b.resolved = true;
    b.cooldown = this.director.isActive('atBat') ? AT_BAT_WATCH * 0.8 : AT_BAT_RELEASE;
    const breaking = b.pitch.type === 'curveball' || b.pitch.type === 'changeup' || b.pitch.type === 'knuckleball' || b.pitch.type === 'eephus';
    const play: Play = breaking && this.rng.next() < 0.4 ? { type: 'ball' } : { type: 'strike' };
    const { state, result } = applyPlay(this.baseball, play);
    this.commitBaseball(state, result, true);
    this.bus.emit('pitchTaken', { play: result, state, pitch: b.pitch });
    const label = play.type === 'ball' ? (result.label === 'WALK' ? 'WALK' : 'BALL') : result.outs ? 'STRIKEOUT LOOKING' : 'CALLED STRIKE';
    const sub = play.type === 'ball' ? `${b.pitch.label} misses the zone` : 'Tap a flipper as the pitch arrives to swing';
    this.bus.emit('toast', { text: label, kind: play.type === 'ball' ? 'info' : 'bad', sub, duration: 1.6 });
    if (result.outs) this.onStrikeoutTaken();
    this.pitchClock = this.profile.pitchClock;
  }

  /** Strikeouts against the player summon THE ACE after three in a game. */
  private onStrikeoutTaken(): void {
    this.aceStrikeouts += 1;
    this.bossEvent('out');
    if (this.aceStrikeouts >= 3 && !this.boss && !this.bossesSeen.has('ace') && this.offense && !this.baseball.gameOver) this.startBoss('ace');
  }

  private swing(offsetSeconds: number, auto: boolean): void {
    const b = this.batting;
    if (!b || b.swung) return;
    b.swung = true;
    b.resolved = true;
    const offset = offsetSeconds / b.windowSeconds;
    const timing = timingScore(offsetSeconds, b.windowSeconds);
    this.bus.emit('battingSwing', { timing, offset, auto });
    const fieldBonus = (b.lane === 'left' && this.leftFieldLit) || (b.lane === 'right' && this.rightFieldLit);
    const result = computeBatting(
      {
        shotQuality: b.shotQuality,
        timing,
        timingOffset: offset,
        sweetSpot: b.sweetSpot,
        spray: sprayFor(b.lane, b.entryAngle, offset),
        power: this.derby.active ? Math.max(2, this.power) : this.power,
        combo: this.combo.count,
        lane: b.lane,
        fieldBonus,
        multiball: this.multiball,
        hrLit: b.lane === 'homeRun' || this.derby.active,
        clutch: this.clutch,
        rally: this.rally,
        difficulty: this.profile.batting,
        runnerOnFirst: !!this.baseball.bases[0],
        outs: this.baseball.outs,
        pitchBonus: b.pitch.contactBonus + (this.boss?.id === 'nightmare' ? 0.04 : 0),
      },
      this.rng,
    );
    if (result.grade !== 'foul') {
      if (b.lane === 'left') this.leftFieldLit = false;
      if (b.lane === 'right') this.rightFieldLit = false;
      this.power = 0;
      this.bus.emit('power', { level: 0 });
    }
    // A home run in single-ball play earns a short, skippable cinematic while the ball is parked.
    const cinematic = result.play.type === 'homeRun' && !this.multiball && this.director.allows('homeRun') && this.liveBalls(b.ballId) === 0;
    b.cinematic = cinematic;
    b.cooldown = cinematic ? HOME_RUN_CINEMATIC : this.director.isActive('atBat') ? AT_BAT_WATCH : AT_BAT_RELEASE;
    if (cinematic) this.requestShot('homeRun', b.ballId);
    this.resolveBattingResult(result, b.lane, cinematic);
  }

  private resolveBattingResult(result: BattingResult, lane: ShotLane, cinematic: boolean): void {
    const before = this.baseball;
    const wasClutch = this.clutch;
    const wasNightmare = this.boss?.id === 'nightmare';
    const trailingBy = this.cpuRuns - this.playerRuns;
    const { state, result: play } = applyPlay(this.baseball, result.play);
    // Announce the play before bookkeeping so the stadium animates the right moment.
    this.bus.emit('battingResult', { result, play, state, lane, cinematic });
    if (cinematic) this.bus.emit('cinematic', { kind: 'homeRun', duration: HOME_RUN_CINEMATIC, sprayDeg: result.sprayDeg, distance: result.distance });
    else if (result.play.type === 'homeRun') this.bus.emit('cameraEvent', { kind: 'hit', direction: result.direction, distance: result.distance });
    this.commitBaseball(state, play, true);
    const backToBack = result.play.type === 'homeRun' && before.plateAppearances - this.lastHomerPA === 1;
    if (result.grade === 'perfect') {
      this.stats.perfect += 1;
      this.addScore(POINTS.perfectContact, undefined, 'PERFECT');
      this.award('perfect_contact');
      this.gainHype(HYPE_GAIN.perfect);
      this.linkImpossible('perfect');
    }
    if (play.hit) {
      this.stats.hits += 1;
      const t = result.play.type;
      const base = t === 'single' ? POINTS.single : t === 'double' ? POINTS.double : t === 'triple' ? POINTS.triple : play.grandSlam ? POINTS.grandSlam : POINTS.homeRun;
      this.addScore(base * (this.multiballMode === 'baseball' ? 2 : 1), undefined, play.label);
      this.gainHype(t === 'single' ? HYPE_GAIN.single : t === 'double' ? HYPE_GAIN.double : t === 'triple' ? HYPE_GAIN.triple : HYPE_GAIN.homeRun);
      if (t === 'triple') this.addHighlight(`${labelFor(before)}: Triple to the corner`, 3);
      this.bossEvent(t === 'homeRun' ? 'homeRun' : 'hit');
      if (play.moves.some((m) => m.from > 0 && m.to !== 'out')) this.bossEvent('runnerAdvanced');
    } else if (play.outs > 0) {
      this.bossEvent('out');
      if (result.play.type === 'strikeout') this.onStrikeoutTaken();
    }
    if (result.play.type === 'homeRun') {
      this.stats.homeRuns += 1;
      this.markTour('stadium');
      this.award('first_hr');
      if (this.profile.id === 'hard') this.award('hard_homer');
      if (this.stats.homeRuns >= 3) this.award('three_hr');
      if (play.grandSlam) {
        this.stats.grandSlams += 1;
        this.store.data.stats.grandSlams += 1;
        this.award('grand_slam');
        if (this.profile.id === 'easy') this.award('easy_grand');
        this.grantExtraBall();
      }
      this.ballSaveTimer = Math.max(this.ballSaveTimer, 6);
      const runs = play.runs;
      const what = play.grandSlam ? 'GRAND SLAM' : runs > 1 ? `${runs}-run homer` : 'Solo homer';
      this.addHighlight(`${labelFor(before)}: ${what}${result.grade === 'perfect' ? ' (perfect contact)' : ''}`, play.grandSlam ? 8 : 4 + runs);
      this.linkImpossible(result.grade === 'perfect' ? 'perfectHomer' : 'homer');
      if (this.derby.active) {
        this.derby.homers += 1;
        const mult = derbyMultiplier(this.derby.homers);
        this.addScore(POINTS.derbyHomer * mult, undefined, `DERBY x${mult}`);
        this.derby.timer = Math.min(this.derby.total, this.derby.timer + 6);
      } else if (backToBack && !this.derby.active) this.startDerby();
      this.lastHomerPA = before.plateAppearances;
      // The crowd fires the next plunge back in at turbo speed.
      this.triggerModifier('turboLaunch', { silent: true });
    }
    if (play.runs > 0) {
      this.stats.runs += play.runs;
      this.addScore(POINTS.run * play.runs * (wasClutch ? 2 : 1), undefined, play.runs > 1 ? `${play.runs} RUNS` : 'RUN');
      this.gainHype(HYPE_GAIN.run * play.runs);
      this.bossEvent('runScored');
      if (play.runs >= 3 && result.play.type !== 'homeRun') this.addHighlight(`${labelFor(before)}: Bases-clearing ${play.label.replace('!', '').toLowerCase()}`, 5);
      if (wasClutch && trailingBy >= 0 && play.runs > trailingBy) this.addHighlight(`${labelFor(before)}: Go-ahead ${result.play.type === 'homeRun' ? 'home run' : 'hit'} in the clutch`, 7);
    } else if (result.grade === 'perfect' && result.play.type !== 'homeRun') {
      this.addHighlight(`${labelFor(before)}: Perfect contact`, 2);
    }
    const announce = contactAnnouncement({ grade: result.grade, play: result.play.type, distance: result.distance, grandSlam: play.grandSlam, backToBack, walkOff: play.walkOff });
    const kind = play.walkOff || play.grandSlam ? 'legend' : result.play.type === 'homeRun' ? 'epic' : play.hit || play.runs ? 'great' : result.grade === 'foul' ? 'info' : 'bad';
    this.bus.emit('toast', { text: announce || play.label, kind, sub: announce ? `${play.label} · ${result.reason}` : result.reason, duration: result.play.type === 'homeRun' ? 2.6 : 1.9 });
    if (wasNightmare && this.boss === null) void 0;
    this.pitchClock = this.profile.pitchClock;
  }

  private calledStrike(): void {
    const { state, result } = applyPlay(this.baseball, { type: 'strike' });
    this.commitBaseball(state, result, true);
    this.bus.emit('strike', { strikes: state.strikes, reason: 'Pitch clock expired' });
    this.bus.emit('toast', { text: result.label, kind: 'bad', sub: result.outs ? 'Too slow: strikeout looking' : 'Shoot a ramp before the pitch clock runs out', duration: 1.8 });
    if (result.outs) this.onStrikeoutTaken();
  }

  // ------------------------------------------------------------------ defense (opponent batting)

  private addDefense(amount: number): void {
    if (this.offense) return;
    // Protecting a lead in the final inning: the whole park is locked in.
    this.defenseRating = Math.min(1, this.defenseRating + amount * (this.closer ? 1.4 : 1));
  }

  private instantOut(reason: string, play?: Play, dive = false): void {
    if (this.offense || this.baseball.gameOver) return;
    let p: Play = play ?? { type: 'flyOut' };
    if (!play) {
      const dp = !!this.baseball.bases[0] && this.baseball.outs < 2 && this.defenseRating >= 0.5;
      p = dive ? { type: 'lineOut' } : dp ? { type: 'groundOut', doublePlay: true } : this.rng.chance(0.5) ? { type: 'groundOut' } : { type: 'flyOut' };
    }
    const { state, result } = applyPlay(this.baseball, p);
    const direction = this.rng.pick(['left', 'center', 'right'] as const);
    const sprayDeg = (direction === 'left' ? -24 : direction === 'right' ? 24 : 0) + (this.rng.next() - 0.5) * 14;
    const trajectory = p.type === 'flyOut' ? 'fly' : p.type === 'lineOut' ? 'line' : p.type === 'strikeout' ? 'pop' : 'ground';
    const distance = p.type === 'flyOut' ? 0.75 : p.type === 'lineOut' ? 0.62 : 0.35;
    this.bus.emit('defenseResult', {
      result: { play: p, quality: 1, direction, sprayDeg, trajectory, distance, reason, dive },
      play: result,
      state,
      instant: true,
      reason,
    });
    this.commitBaseball(state, result, false);
    this.scoreDefensivePlay(result);
    this.bus.emit('toast', { text: dive ? 'WEB GEM!' : result.label, kind: result.doublePlay || dive ? 'great' : 'good', sub: reason, duration: 1.8 });
    this.defenseClock = this.profile.defenseInterval;
    this.opponentPitchAnnounced = false;
  }

  private resolveOpponentAtBat(instant: boolean, reason: string): void {
    if (this.offense || this.baseball.gameOver) return;
    this.opponentPitchAnnounced = false;
    const res = resolveDefense(
      { defenseRating: this.defenseRating, inning: this.baseball.inning, difficulty: this.profile.batting, runnerOnFirst: !!this.baseball.bases[0], outs: this.baseball.outs },
      this.rng,
    );
    this.defenseRating *= 0.45;
    const before = this.baseball;
    const { state, result } = applyPlay(this.baseball, res.play);
    this.bus.emit('defenseResult', { result: res, play: result, state, instant, reason: res.reason });
    this.commitBaseball(state, result, false);
    this.scoreDefensivePlay(result);
    if (result.play.type === 'homeRun') this.addHighlight(`${labelFor(before)}: Rivals went deep`, 1);
    const kind = result.outs ? (result.doublePlay ? 'great' : 'good') : result.runs ? 'bad' : 'info';
    this.bus.emit('toast', { text: result.label, kind, sub: res.reason, duration: 1.8 });
    void reason;
  }

  private scoreDefensivePlay(result: PlayResult): void {
    if (result.doublePlay) {
      this.stats.doublePlays += 1;
      this.addScore(POINTS.doublePlay, undefined, 'DOUBLE PLAY');
      this.award('double_play');
      this.gainHype(HYPE_GAIN.doublePlay);
      this.addHighlight(`${this.inningLabel}: 6-4-3 double play`, 4);
    } else if (result.outs) {
      this.addScore(POINTS.defenseOut * result.outs, undefined, 'OUT');
      this.gainHype(HYPE_GAIN.out);
    }
  }

  // ------------------------------------------------------------------ baseball bookkeeping

  private commitBaseball(state: BaseballState, result: PlayResult, offense: boolean): void {
    const wasOffense = this.offense;
    this.baseball = state;
    this.bus.emit('playResult', { play: result, state, offense });
    this.bus.emit('baseball', { state });
    if (!wasOffense && this.baseball.inning >= this.baseball.totalInnings && this.cpuRuns > this.playerRuns) this.stats.trailedInFinal = true;
    if (result.walkOff) this.addHighlight(`${labelFor(state)}: WALK-OFF`, 10);
    if (result.halfInningEnded && !state.gameOver) {
      this.onHalfInning();
    } else if (!state.gameOver) {
      this.checkSituation();
    }
    this.refreshLamps();
    if (state.gameOver) this.finishGame('complete');
  }

  /** Bases-loaded, clutch and nightmare announcements. */
  private checkSituation(): void {
    if (this.offense && basesLoaded(this.baseball) && !this.basesLoadedAnnounced) {
      this.basesLoadedAnnounced = true;
      this.award('bases_loaded');
      this.hrLit = true;
      this.bus.emit('toast', { text: 'BASES LOADED!', kind: 'great', sub: 'Grand slam lane lit: shoot the HOME RUN orbit', duration: 2.2 });
    } else if (!basesLoaded(this.baseball)) {
      this.basesLoadedAnnounced = false;
    }
    if (this.clutch && !this.clutchAnnounced) {
      this.clutchAnnounced = true;
      const sub = this.playerRuns < this.cpuRuns ? `Down ${this.cpuRuns - this.playerRuns}: runs score double, contact boosted` : 'Tied: runs score double, contact boosted';
      this.bus.emit('clutch', { active: true, label: 'CLUTCH TIME', sub });
    } else if (!this.clutch && this.clutchAnnounced && this.offense) {
      this.clutchAnnounced = false;
      this.bus.emit('clutch', { active: false, label: '', sub: '' });
    }
    // NINTH-INNING NIGHTMARE: final inning, trailing, two outs, diamond loaded.
    if (this.offense && this.finalInning && this.playerRuns < this.cpuRuns && this.baseball.outs === 2 && basesLoaded(this.baseball) && !this.boss && !this.nightmareArmed) {
      this.nightmareArmed = true;
      this.startBoss('nightmare');
    }
  }

  private onHalfInning(): void {
    this.endAtBat();
    this.clutchAnnounced = false;
    this.basesLoadedAnnounced = false;
    this.opponentPitchAnnounced = false;
    this.pitchClock = this.profile.pitchClock;
    this.defenseClock = this.profile.defenseInterval;
    this.defenseRating = 0.35;
    this.stealCooldown = 0;
    this.bullpenVisits = 0;
    this.addScore(POINTS.inningComplete, undefined, 'INNING');
    if (this.boss && this.boss.id !== 'nightmare') this.endBoss(false);
    if (this.derby.active) this.endDerby();
    // THE ACE takes the mound at the start of the next at-bat half after three strikeouts.
    if (this.offense && this.aceStrikeouts >= 3 && !this.boss && !this.bossesSeen.has('ace') && !this.baseball.gameOver) this.startBoss('ace');
    if (!this.impossibleDone) {
      resetImpossible(this.impossible);
      this.bus.emit('impossible', { stage: 'reset', have: 0, needed: this.impossible.needed, links: [] });
    }
    const offense = this.offense;
    this.bus.emit('halfInning', { state: this.baseball, offense });
    this.bus.emit('modeChange', { offense });
    const inn = `${this.baseball.half === 'top' ? 'TOP' : 'BOTTOM'} ${this.baseball.inning}`;
    if (this.finalInning) {
      // The last inning gets its own stage: louder park, special rules.
      const label = this.offense ? (this.clutch ? 'CLUTCH TIME' : 'FINAL INNING') : this.closer ? 'CLOSE IT OUT' : 'FINAL INNING';
      const sub = this.offense
        ? this.clutch
          ? 'Tied or trailing: runs score double, contact boosted'
          : 'Last licks: pad the lead'
        : this.closer
          ? 'Protect the lead: every shot builds defense faster'
          : 'Hold them here or it is over';
      this.clutchAnnounced = this.clutch;
      this.bus.emit('clutch', { active: true, label, sub });
      this.bus.emit('toast', { text: `${inn}: ${label}`, kind: 'great', sub, duration: 2.8 });
      return;
    }
    this.bus.emit('clutch', { active: false, label: '', sub: '' });
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
    if (this.boss?.id === 'nightmare' && won && reason === 'complete') this.endBoss(true);
    else if (this.boss) this.endBoss(false);
    if (this.derby.active) this.endDerby();
    if (reason === 'complete' && won) {
      this.addScore(POINTS.win, undefined, 'WIN');
      if (this.cpuRuns === 0) this.addScore(POINTS.shutout, undefined, 'SHUTOUT');
      this.award('complete_win');
      if (this.profile.id === 'hard') this.award('hard_win');
      if (this.stats.trailedInFinal) this.award('comeback');
    }
    const stats = this.store.data.stats;
    stats.gamesPlayed += 1;
    stats.totalHomeRuns += this.stats.homeRuns;
    stats.totalRuns += this.playerRuns;
    if (won && reason === 'complete') stats.wins += 1;
    stats.bestCombo = Math.max(stats.bestCombo, this.combo.best);
    stats.bossesBeaten += this.bossesBeaten.length;
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
      difficulty: this.profile.id,
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
      difficulty: this.profile,
      bossesBeaten: this.bossesBeaten.map((b) => BOSSES[b].name),
      impossibleInning: this.impossibleDone,
      reason,
      highlights: this.topHighlights(),
      rallies: this.hype.rallies,
    };
    this.endAllModifiers();
    this.world.reset();
    this.batting = null;
    this.resetAttractions();
    this.setState('gameover');
    this.bus.emit('gameOver', this.summary);
  }

  // ------------------------------------------------------------------ helpers

  /** Adds hype; a full meter starts a RALLY. */
  private gainHype(amount: number): void {
    if (this.state !== 'playing') return;
    if (addHype(this.hype, amount)) {
      if (this.offense) this.hrLit = true;
      this.addHighlight(`${this.inningLabel}: Crowd-fuelled RALLY`, 3);
      this.bus.emit('rally', { active: true });
      this.bus.emit('crowdWave', {});
      this.bus.emit('toast', { text: 'RALLY!', kind: 'epic', sub: 'Double scoring · contact boost · home run lane lit', duration: 2.4 });
      this.refreshLamps();
    }
  }

  private addHighlight(text: string, weight: number): void {
    this.highlights.push({ text, weight, order: this.highlights.length });
    this.bus.emit('highlight', { text, weight });
  }

  /** The five most important moments, in the order they happened. */
  topHighlights(limit = 5): string[] {
    return [...this.highlights]
      .sort((a, b) => b.weight - a.weight || a.order - b.order)
      .slice(0, limit)
      .sort((a, b) => a.order - b.order)
      .map((h) => h.text);
  }

  private addScore(points: number, at?: Vec2, label?: string): void {
    const rocket = hasModifier(this.modifiers, 'rocketBall') ? 2 : 1;
    const gained = applyScore(points * rocket, this.multiplier, this.combo.count, this.profile.scoreScale);
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

  private resetBank(bank: Bank): void {
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
    this.setLamp('lamp_hr', this.offense ? (this.hrLit || this.rally ? 'blink' : 'off') : 'on');
    this.setLamp('lamp_lock', this.lockLit ? 'blink' : this.lockedBalls > 0 ? 'on' : 'off');
    this.setLamp('lamp_leftField', this.leftFieldLit ? 'on' : this.bankDown.leftField.some(Boolean) ? 'blink' : 'off');
    this.setLamp('lamp_rightField', this.rightFieldLit ? 'on' : this.bankDown.rightField.some(Boolean) ? 'blink' : 'off');
    this.setLamp('lamp_kickback', this.kickbackLit ? 'on' : this.ballSaveTimer > 0 ? 'blink' : 'off');
    this.setLamp('lamp_left_ramp', this.offense ? (this.batting ? 'off' : 'blink') : 'on');
    this.setLamp('lamp_right_ramp', this.offense ? (this.batting ? 'off' : 'blink') : 'on');
    for (let i = 1; i <= 3; i++) this.setLamp(`lamp_power${i}`, this.power >= i ? 'on' : 'off');
    this.setLamp('lamp_mound', this.moundCooldown > 0 ? 'on' : 'blink');
    this.setLamp('lamp_plate', this.plateLit > 0 ? 'blink' : 'off');
    this.setLamp('lamp_scoreboard', this.blackHoleLit ? 'blink' : this.scoreboardBoost > 0 ? 'on' : 'off');
    for (const ws of WALL_ORDER) {
      const bossLit = this.boss?.id === 'wall' && this.boss.stage === 0 && this.boss.litSection === ws;
      this.setLamp(`lamp_wall_${ws}`, bossLit ? 'blink' : this.wallSectionsLit.has(ws) ? 'on' : 'off');
    }
    this.refreshBaseLamps();
    this.refreshTopLaneLamps();
    const have = this.city.signals.filter(Boolean).length;
    for (let i = 0; i < 3; i++) this.setLamp(`lamp_city_${i}`, this.city.lit ? 'blink' : i < have ? 'on' : 'off');
    this.setLamp('lamp_reactor', this.reactor.ready ? 'blink' : this.reactor.critical > 0 ? 'on' : 'off');
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
    forceBatting: (lane: ShotLane, quality = 0.9, sweetSpot = 0.8): void => this.startBatting(lane, quality, { sweetSpot }),
    /** Swings with a given offset from perfect timing, in seconds. */
    swingAt: (offsetSeconds: number): void => {
      const b = this.batting;
      if (!b || b.swung) return;
      b.t = b.pitchDelay + offsetSeconds;
      this.swing(offsetSeconds, false);
    },
    addHype: (amount: number): void => this.gainHype(amount),
    defensivePlay: (play?: Play, dive = false): void => this.instantOut(dive ? 'A diving catch ends the at-bat.' : 'The defense makes the play!', play, dive),
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
    modifier: (id: ModifierId): boolean => this.triggerModifier(id),
    multiball: (mode: Exclude<MultiballMode, 'none'>): void => this.startMultiball(mode),
    boss: (id: BossId): void => this.startBoss(id),
    derby: (): void => this.startDerby(),
    link: (link: ImpossibleLink): void => this.linkImpossible(link),
    wallHit: (section: WallSection, speed = 60): void => {
      const ws = this.table.wallSections.find((w) => w.id === section)!;
      this.wallCooldown = 0;
      this.onWallHit(`outer_arc_${ws.from}`, speed, { x: ws.pos.x, y: ws.pos.y - 2 });
    },
    mound: (): void => {
      this.moundCooldown = 0;
      this.onMound(this.table.mound.pos, 30);
    },
    plate: (): void => {
      this.plateCooldown = 0;
      const ball = this.world.balls.find((b) => b.state === 'free') ?? this.debug.placeBall(this.table.diamond.home, { x: 0, y: 10 })!;
      this.onPlate(ball);
    },
    /** Lights the city diverter. */
    lightCity: (): void => {
      this.city.lit = true;
      this.refreshLamps();
    },
    /** Fills the reactor to CORE OPEN. */
    reactorReady: (): void => {
      forceReady(this.reactor);
      this.refreshLamps();
    },
    /** Shoots the left ramp from just below its mouth (lights nothing by itself). */
    shootLeftRamp: (speed = 118): Ball | undefined => this.debug.placeBall({ x: 4.5, y: 21.5 }, { x: 0, y: speed }),
    /** Rolls a ball up the centre lane into the reactor core. */
    shootCore: (): Ball | undefined => this.debug.placeBall({ x: 10.2, y: 29.8 }, { x: 0, y: 30 }),
    bumper: (id: string): void => {
      const b = this.table.bumpers.find((x) => x.id === id)!;
      const ball = this.world.balls.find((x) => x.state === 'free') ?? this.debug.placeBall({ x: 10, y: 20 }, { x: 0, y: 0 })!;
      this.onHit(id, 'bumper', 40, b.pos, ball);
    },
  };
}
