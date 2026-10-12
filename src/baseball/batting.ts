import { clamp01 } from '../core/math';
import type { Random } from '../core/Random';
import type { Play } from './types';

export type ShotLane = 'left' | 'right' | 'center' | 'homeRun';
export type FieldDirection = 'left' | 'center' | 'right';
export type Trajectory = 'ground' | 'line' | 'fly' | 'pop';
export type ContactGrade = 'foul' | 'weak' | 'solid' | 'perfect';

export interface BattingInput {
  /** Normalised ramp shot quality from entry speed (0..1). */
  shotQuality: number;
  /** Swing timing accuracy, 1 = dead centre of the window. */
  timing: number;
  /** Batting power charged by centre-lane shots (0..3). */
  power: number;
  /** Current shot combo. */
  combo: number;
  lane: ShotLane;
  /** Completed field target bank matching the lane. */
  fieldBonus: boolean;
  multiball: boolean;
  /** HOME RUN lane lit: premium opportunity. */
  hrLit: boolean;
  /** 0 = easy, 1 = brutal. */
  difficulty: number;
  runnerOnFirst: boolean;
  outs: number;
}

export interface BattingResult {
  contact: number;
  grade: ContactGrade;
  play: Play;
  direction: FieldDirection;
  trajectory: Trajectory;
  /** Normalised distance the ball travels (1 = outfield wall, >1 = over it). */
  distance: number;
  /** Degrees, for the animation. */
  launchAngle: number;
  /** Explanation string shown in the HUD. */
  reason: string;
}

/**
 * Deterministic contact score from the player's pinball performance. Every
 * term is a visible gameplay input: no hidden dice decide the quality.
 */
export function contactScore(i: BattingInput): number {
  let c = 0.36 * clamp01(i.timing) + 0.32 * clamp01(i.shotQuality) + 0.16 * clamp01(i.power / 3);
  c += 0.08 * clamp01(i.combo / 5);
  if (i.fieldBonus) c += 0.07;
  if (i.multiball) c += 0.05;
  if (i.lane === 'homeRun') c += 0.12;
  if (i.hrLit && i.lane === 'homeRun') c += 0.06;
  c -= 0.1 * clamp01(i.difficulty);
  return clamp01(c);
}

export function gradeFor(contact: number): ContactGrade {
  if (contact >= 0.88) return 'perfect';
  if (contact >= 0.55) return 'solid';
  return 'weak';
}

function directionFor(lane: ShotLane, rng: Random): FieldDirection {
  if (lane === 'left') return rng.chance(0.75) ? 'left' : 'center';
  if (lane === 'right') return rng.chance(0.75) ? 'right' : 'center';
  if (lane === 'homeRun') return rng.pick(['left', 'center', 'right'] as const);
  return rng.chance(0.6) ? 'center' : rng.chance(0.5) ? 'left' : 'right';
}

/**
 * Converts pinball performance into a baseball play. The contact score is
 * deterministic; the seeded RNG only picks between outcomes of similar value
 * (e.g. which fielder makes the play), so a great shot is always rewarded.
 */
export function computeBatting(input: BattingInput, rng: Random): BattingResult {
  const base = contactScore(input);
  const jitter = (rng.next() - 0.5) * 0.06;
  const contact = clamp01(base + jitter);
  const direction = directionFor(input.lane, rng);
  const dpChance = input.runnerOnFirst && input.outs < 2;

  // Terrible timing with an otherwise fine shot: foul it off.
  if (input.timing < 0.12 && input.shotQuality < 0.9) {
    return {
      contact,
      grade: 'foul',
      play: { type: 'foul' },
      direction: rng.chance(0.5) ? 'left' : 'right',
      trajectory: 'pop',
      distance: 0.25,
      launchAngle: 55,
      reason: 'Swung late: fouled it off.',
    };
  }

  const mk = (play: Play, trajectory: Trajectory, distance: number, launchAngle: number, reason: string): BattingResult => ({
    contact,
    grade: gradeFor(contact),
    play,
    direction,
    trajectory,
    distance,
    launchAngle,
    reason,
  });

  if (contact < 0.22) {
    if (rng.chance(0.42)) return mk({ type: 'popOut' }, 'pop', 0.2 + contact * 0.4, 65, 'Weak contact: popped up.');
    const dp = dpChance && rng.chance(0.55);
    return mk({ type: 'groundOut', doublePlay: dp }, 'ground', 0.3, 5, dp ? 'Rolled over on it: double play.' : 'Weak grounder, thrown out.');
  }
  if (contact < 0.4) {
    const p = 0.12 + ((contact - 0.22) / 0.18) * 0.7;
    if (rng.chance(p)) return mk({ type: 'single', contact }, 'ground', 0.5, 8, 'Ground ball finds a hole.');
    const dp = dpChance && rng.chance(0.35);
    return mk({ type: 'groundOut', doublePlay: dp }, 'ground', 0.4, 6, dp ? 'Grounder, turned for two.' : 'Grounder, fielded cleanly.');
  }
  if (contact < 0.58) {
    const r = rng.next();
    if (r < 0.5) return mk({ type: 'single', contact }, 'line', 0.6, 14, 'Line drive single.');
    if (r < 0.75) return mk({ type: 'flyOut' }, 'fly', 0.78, 38, 'Fly ball, run down in the outfield.');
    if (r < 0.87) return mk({ type: 'lineOut' }, 'line', 0.45, 12, 'Lined right at the fielder.');
    return mk({ type: 'double', contact }, 'line', 0.85, 18, 'Hard line drive into the gap.');
  }
  if (contact < 0.76) {
    const r = rng.next();
    if (r < 0.3) return mk({ type: 'single', contact }, 'line', 0.62, 15, 'Solid single.');
    if (r < 0.8) return mk({ type: 'double', contact }, 'line', 0.9, 20, 'Solid contact, off the wall.');
    if (r < 0.9) return mk({ type: 'flyOut' }, 'fly', 0.95, 40, 'Deep fly, caught at the track.');
    return mk({ type: 'triple', contact }, 'line', 0.97, 17, 'Rattling around the corner: triple.');
  }
  if (contact < 0.88) {
    const r = rng.next();
    const hrP = input.hrLit ? 0.5 : 0.22;
    if (r < hrP) return mk({ type: 'homeRun', contact }, 'fly', 1.12, 30, 'Crushed over the wall!');
    if (r < hrP + 0.25) return mk({ type: 'triple', contact }, 'line', 0.98, 18, 'Into the corner: triple.');
    if (r < hrP + 0.65) return mk({ type: 'double', contact }, 'line', 0.92, 22, 'Off the wall: double.');
    return mk({ type: 'flyOut' }, 'fly', 0.99, 42, 'Robbed at the wall!');
  }
  const r = rng.next();
  const hrP = input.hrLit ? 0.96 : 0.78;
  if (r < hrP) return mk({ type: 'homeRun', contact }, 'fly', 1.25, 32, 'PERFECT contact: no doubt about it!');
  if (r < hrP + 0.14) return mk({ type: 'triple', contact }, 'line', 0.99, 16, 'Scorched to the wall: triple.');
  return mk({ type: 'double', contact }, 'line', 0.93, 20, 'Scorched into the gap: double.');
}

/** Converts a swing time offset (seconds from perfect) into a timing score. */
export function timingScore(offsetSeconds: number, windowSeconds = 0.22): number {
  const x = Math.abs(offsetSeconds) / windowSeconds;
  if (x >= 1) return 0;
  return 1 - x * x;
}
