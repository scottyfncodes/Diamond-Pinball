import type { BattingResult, ShotLane } from '../baseball/batting';
import type { DefenseResult } from '../baseball/defense';
import type { Pitch } from '../baseball/pitching';
import type { BaseballState, PlayResult } from '../baseball/types';
import type { Ball } from '../physics/types';
import type { Vec2 } from '../physics/Vec2';
import type { DifficultyProfile } from './difficulty';
import type { ModifierId } from './modifiers';
import type { BossId, ImpossibleLink, MultiballMode } from './modes';

export type ToastKind = 'info' | 'good' | 'great' | 'bad' | 'epic' | 'legend';
export type LampState = 'off' | 'on' | 'blink';

export interface BattingStartEvent {
  lane: ShotLane;
  shotQuality: number;
  sweetSpot: number;
  /** Seconds until the perfect swing moment. */
  pitchDelay: number;
  windowSeconds: number;
  half: 'top' | 'bottom';
  power: number;
  pitch: Pitch;
  clutch: boolean;
  rally: boolean;
}

export interface GameEvents extends Record<string, unknown> {
  score: { points: number; total: number; at?: Vec2; label?: string };
  toast: { text: string; kind: ToastKind; sub?: string; duration?: number };
  lamp: { id: string; state: LampState };
  bumper: { id: string; at: Vec2; speed: number };
  slingshot: { id: string; at: Vec2 };
  wallHit: { at: Vec2; speed: number; kind: string };
  flipper: { id: string; pressed: boolean };
  flipperHit: { at: Vec2; speed: number };
  target: { id: string; down: boolean; at: Vec2 };
  bankReset: { bank: string };
  lane: { id: string };
  rampEnter: { id: string; quality: number };
  rampExit: { id: string };
  launch: { power: number; ball: Ball };
  plungerCharge: { charge: number };
  ballServed: { ball: Ball; ballsLeft: number; extra: boolean };
  ballLost: { ballsLeft: number; ball: Ball };
  ballSaved: { ball: Ball };
  drain: { ball: Ball };
  kickback: { ball: Ball };
  saucer: { ball: Ball; locked: boolean; lockedCount: number };
  multiball: { active: boolean; balls: number; mode: MultiballMode };
  /** Difficulty profile chosen for the run (emitted at every game start). */
  difficulty: { profile: DifficultyProfile };
  /** A table modifier started or ended. */
  modifier: { id: ModifierId; active: boolean; duration: number; name: string; at?: Vec2 };
  /** Boss encounter lifecycle and progress. */
  boss: { id: BossId; active: boolean; stage: number; progress: number; goal: number; label: string; sub: string; timer: number; beaten: boolean };
  /** Ball hit the outfield wall hard. */
  wallBounce: { section: 'left' | 'center' | 'right'; at: Vec2; speed: number; lit: boolean };
  /** Ball rattled the pitcher's mound post. */
  mound: { at: Vec2; offense: boolean };
  /** A lit home plate rollover scored the squeeze. */
  squeeze: { runs: number };
  /** LIGHTNING ROUND chained a hit to nearby targets. */
  lightning: { from: Vec2; to: Vec2[] };
  /** The black hole swallowed and ejected balls. */
  blackHole: { at: Vec2; balls: number; phase: 'capture' | 'eject' };
  /** Home run derby state. */
  derby: { active: boolean; homers: number; multiplier: number; remaining: number };
  /** Progress on THE IMPOSSIBLE INNING chain. */
  impossible: { stage: 'link' | 'complete' | 'reset'; link?: ImpossibleLink; have: number; needed: number; links: ImpossibleLink[] };
  /** Scoreboard bumper cycle completed (temporary scoring boost). */
  scoreboardBoost: { active: boolean; seconds: number };
  /** Roving jackpot moved (CHAOS MULTIBALL). */
  rovingJackpot: { targetId: string | null };
  /** Freeze the stadium animation for a beat. */
  hitStop: { seconds: number };
  /** Crowd does the wave. */
  crowdWave: Record<string, never>;
  /** A ball changed its visual skin. */
  ballSkin: { ball: Ball; skin: string };
  /** The ball escaped a drain by a hair (outlane rebound, kickback, blocker). */
  nearMiss: { at: Vec2; points: number };
  skillShot: { points: number };
  combo: { count: number; best: number; broke: boolean };
  power: { level: number };
  battingStart: BattingStartEvent;
  battingSwing: { timing: number; offset: number; auto: boolean };
  battingResult: { result: BattingResult; play: PlayResult; state: BaseballState; lane: ShotLane; cinematic: boolean };
  /** The batter took the pitch without swinging. */
  pitchTaken: { play: PlayResult; state: BaseballState; pitch: Pitch };
  /** The at-bat ball is parked on the ramp return while the pitch plays out. */
  atBatHold: { ball: Ball };
  atBatRelease: { ball: Ball | null };
  cinematic: { kind: 'homeRun'; duration: number; sprayDeg: number; distance: number };
  cinematicEnd: { skipped: boolean };
  rally: { active: boolean };
  opponentPitch: { delay: number };
  clutch: { active: boolean; label: string; sub: string };
  highlight: { text: string; weight: number };
  defensePitch: { secondsToPitch: number };
  defenseResult: { result: DefenseResult & { dive?: boolean }; play: PlayResult; state: BaseballState; instant: boolean; reason: string };
  playResult: { play: PlayResult; state: BaseballState; offense: boolean };
  baseball: { state: BaseballState };
  halfInning: { state: BaseballState; offense: boolean };
  pitchClock: { seconds: number; total: number };
  strike: { strikes: number; reason: string };
  steal: { base: number; play: PlayResult };
  gameOver: GameSummary;
  achievement: { id: string; title: string; description: string; unlock?: string };
  extraBall: Record<string, never>;
  stateChange: { state: GameState; prev: GameState };
  cameraEvent: { kind: 'homeRun' | 'multiball' | 'hit' | 'reset'; direction?: 'left' | 'center' | 'right'; distance?: number };
  stuck: { method: string };
  modeChange: { offense: boolean };
}

export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export interface GameSummary {
  pinballScore: number;
  baseball: BaseballState;
  playerRuns: number;
  cpuRuns: number;
  won: boolean;
  tie: boolean;
  completed: boolean;
  hits: number;
  homeRuns: number;
  bestCombo: number;
  achievements: string[];
  newAchievements: string[];
  highScoreRank: number;
  innings: number;
  difficulty: DifficultyProfile;
  bossesBeaten: string[];
  impossibleInning: boolean;
  reason: 'complete' | 'ballsLost';
  /** The game's best moments, most important first. */
  highlights: string[];
  rallies: number;
}
