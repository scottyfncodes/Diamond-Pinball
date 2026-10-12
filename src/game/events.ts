import type { BattingResult, ShotLane } from '../baseball/batting';
import type { DefenseResult } from '../baseball/defense';
import type { BaseballState, PlayResult } from '../baseball/types';
import type { Ball } from '../physics/types';
import type { Vec2 } from '../physics/Vec2';

export type ToastKind = 'info' | 'good' | 'great' | 'bad' | 'epic';
export type LampState = 'off' | 'on' | 'blink';

export interface BattingStartEvent {
  lane: ShotLane;
  shotQuality: number;
  /** Seconds until the perfect swing moment. */
  pitchDelay: number;
  windowSeconds: number;
  half: 'top' | 'bottom';
  power: number;
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
  multiball: { active: boolean; balls: number };
  skillShot: { points: number };
  combo: { count: number; best: number; broke: boolean };
  power: { level: number };
  battingStart: BattingStartEvent;
  battingSwing: { timing: number; auto: boolean };
  battingResult: { result: BattingResult; play: PlayResult; state: BaseballState; lane: ShotLane };
  defensePitch: { secondsToPitch: number };
  defenseResult: { result: DefenseResult; play: PlayResult; state: BaseballState; instant: boolean; reason: string };
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
  reason: 'complete' | 'ballsLost';
}
