import { clamp, clamp01 } from '../core/math';
import type { Random } from '../core/Random';
import type { Play } from './types';

export type ShotLane = 'left' | 'right' | 'center' | 'homeRun';
export type FieldDirection = 'left' | 'center' | 'right';
export type Trajectory = 'ground' | 'line' | 'fly' | 'pop';
export type ContactGrade = 'foul' | 'weak' | 'solid' | 'perfect';
export type TimingLabel = 'EARLY' | 'LATE' | 'GOOD' | 'PERFECT' | 'WAY EARLY' | 'WAY LATE';

export interface BattingInput {
  /** Normalised ramp shot quality from entry speed (0..1). */
  shotQuality: number;
  /** Swing timing accuracy, 1 = dead centre of the window. */
  timing: number;
  /**
   * Signed swing offset in units of the timing window: negative = early,
   * positive = late, 0 = perfect. Decides the launch type.
   */
  timingOffset: number;
  /** How close to the centre of the ramp mouth the ball entered (1 = on the barrel). */
  sweetSpot: number;
  /** -1 = pulled hard to left field, 1 = sprayed to right field (from the ramp and shot angle). */
  spray: number;
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
  /** Final inning, tied or trailing. */
  clutch: boolean;
  /** RALLY (full hype meter) running. */
  rally: boolean;
  /** 0 = easy, 1 = brutal. */
  difficulty: number;
  runnerOnFirst: boolean;
  outs: number;
}

export interface ContactFactors {
  timing: number;
  shot: number;
  barrel: number;
  power: number;
  combo: number;
  /** Sum of situational bonuses (field bank, multiball, lanes, clutch, rally) minus difficulty. */
  bonus: number;
}

export interface BattingResult {
  contact: number;
  grade: ContactGrade;
  play: Play;
  direction: FieldDirection;
  /** Degrees off the centre-field line: negative = left field, positive = right field. */
  sprayDeg: number;
  trajectory: Trajectory;
  /** Normalised distance the ball travels (1 = outfield wall, >1 = over it). */
  distance: number;
  /** Degrees, for the animation. */
  launchAngle: number;
  timingLabel: TimingLabel;
  factors: ContactFactors;
  /** Explanation string shown in the HUD. */
  reason: string;
}

export const WEIGHTS = { timing: 0.34, shot: 0.26, barrel: 0.14, power: 0.14, combo: 0.07 } as const;

export function contactFactors(i: BattingInput): ContactFactors {
  let bonus = 0;
  if (i.fieldBonus) bonus += 0.07;
  if (i.multiball) bonus += 0.05;
  if (i.lane === 'homeRun') bonus += 0.12;
  if (i.hrLit && i.lane === 'homeRun') bonus += 0.06;
  if (i.clutch) bonus += 0.05;
  if (i.rally) bonus += 0.07;
  bonus -= 0.08 * clamp01(i.difficulty);
  return {
    timing: WEIGHTS.timing * clamp01(i.timing),
    shot: WEIGHTS.shot * clamp01(i.shotQuality),
    barrel: WEIGHTS.barrel * clamp01(i.sweetSpot),
    power: WEIGHTS.power * clamp01(i.power / 3),
    combo: WEIGHTS.combo * clamp01(i.combo / 5),
    bonus,
  };
}

/**
 * Deterministic contact score (exit velocity) from the player's pinball
 * performance. Every term is a visible gameplay input: no hidden dice.
 */
export function contactScore(i: BattingInput): number {
  const f = contactFactors(i);
  return clamp01(f.timing + f.shot + f.barrel + f.power + f.combo + f.bonus);
}

export function gradeFor(contact: number, timingOffset = 0): ContactGrade {
  if (contact >= 0.86 && Math.abs(timingOffset) <= 0.25) return 'perfect';
  if (contact >= 0.55) return 'solid';
  return 'weak';
}

export function timingLabelFor(offset: number): TimingLabel {
  const a = Math.abs(offset);
  if (a <= 0.2) return 'PERFECT';
  if (a <= 0.5) return 'GOOD';
  if (a < 1.1) return offset < 0 ? 'EARLY' : 'LATE';
  return offset < 0 ? 'WAY EARLY' : 'WAY LATE';
}

/**
 * Launch type comes straight from swing timing: early swings roll over into
 * grounders, a centred swing barrels the ball into the air, late swings get
 * under it. Charged power or the home run lane widen the barrel window.
 */
export function launchFor(offset: number, loft: boolean): Trajectory {
  const lo = loft ? -0.28 : -0.18;
  const hi = loft ? 0.32 : 0.22;
  if (offset < -0.5) return 'ground';
  if (offset < lo) return 'line';
  if (offset <= hi) return 'fly';
  if (offset <= 0.62) return 'line';
  return offset > 0.85 ? 'pop' : 'fly';
}

/** Combines the lane, the ramp entry angle and swing timing into a spray value. */
export function sprayFor(lane: ShotLane, entryAngle: number, timingOffset: number): number {
  const laneBias = lane === 'left' ? -0.55 : lane === 'right' ? 0.55 : 0;
  // Early swings pull the ball to left field, late swings push it to right.
  return clamp(laneBias + clamp(entryAngle * 1.6, -0.35, 0.35) + clamp(timingOffset, -1, 1) * 0.3, -1, 1);
}

export const directionFor = (spray: number): FieldDirection => (spray < -0.33 ? 'left' : spray > 0.33 ? 'right' : 'center');

/**
 * Converts pinball performance into a baseball play. The launch type comes
 * from timing and the exit velocity from the contact score; the seeded RNG
 * only nudges contact by a few hundredths and decides rare fielding errors.
 */
export function computeBatting(input: BattingInput, rng: Random): BattingResult {
  const factors = contactFactors(input);
  const base = contactScore(input);
  const contact = clamp01(base + (rng.next() - 0.5) * 0.06);
  const e = input.timingOffset;
  const spray = input.spray;
  const direction = directionFor(spray);
  const sprayDeg = spray * 38;
  const timingLabel = timingLabelFor(e);
  const dpChance = input.runnerOnFirst && input.outs < 2;
  const corner = Math.abs(spray) > 0.55;

  if (Math.abs(e) >= 1.1) {
    return {
      contact,
      grade: 'foul',
      play: { type: 'foul' },
      direction: e < 0 ? 'left' : 'right',
      sprayDeg: e < 0 ? -55 : 55,
      trajectory: 'pop',
      distance: 0.3,
      launchAngle: 55,
      timingLabel,
      factors,
      reason: e < 0 ? 'Way out in front: foul ball.' : 'Way late: fouled it off.',
    };
  }

  const loft = input.power >= 2 || input.lane === 'homeRun';
  const launch = launchFor(e, loft);
  const hrLine = 0.74 - (input.hrLit ? 0.06 : 0) - (input.rally ? 0.03 : 0);
  const mk = (play: Play, distance: number, launchAngle: number, reason: string, trajectory: Trajectory = launch): BattingResult => ({
    contact,
    grade: gradeFor(contact, e),
    play,
    direction,
    sprayDeg,
    trajectory,
    distance,
    launchAngle,
    timingLabel,
    factors,
    reason,
  });

  switch (launch) {
    case 'ground': {
      if (contact < 0.3) {
        const dp = dpChance && contact < 0.24;
        return mk({ type: 'groundOut', doublePlay: dp }, 0.3, 4, dp ? 'Early swing, rolled over: tailor-made double play.' : 'Early swing, rolled over: easy grounder.');
      }
      if (contact < 0.45) {
        if (rng.next() < 0.1) return mk({ type: 'error' }, 0.38, 5, 'Grounder... bobbled! Safe on the error.');
        return mk({ type: 'groundOut', doublePlay: dpChance && contact < 0.36 }, 0.36, 5, 'Early swing: grounder, fielded cleanly.');
      }
      if (contact < 0.62) return mk({ type: 'single', contact }, 0.5, 6, 'Hard grounder finds a hole.');
      if (corner) return mk({ type: 'double', contact }, 0.85, 7, 'Smoked down the line for two!');
      return mk({ type: 'single', contact }, 0.6, 7, 'Scorched grounder up the middle.');
    }
    case 'line': {
      if (contact < 0.25) return mk({ type: 'lineOut' }, 0.45, 12, 'Lined right at a fielder.');
      if (contact < 0.5) return mk({ type: 'single', contact }, 0.6, 13, 'Line drive single.');
      if (contact < 0.72) return mk({ type: 'double', contact }, 0.88, 16, 'Line drive into the gap!');
      if (contact < 0.86) {
        if (corner) return mk({ type: 'triple', contact }, 0.97, 16, 'Rattling around the corner: triple!');
        return mk({ type: 'double', contact }, 0.93, 17, 'Rocket off the wall!');
      }
      return mk({ type: 'homeRun', contact }, 1.12, 20, 'Screaming liner... over the wall!');
    }
    case 'fly': {
      if (contact < 0.35) return mk({ type: 'flyOut' }, 0.62, 45, 'Got under it: lazy fly ball.');
      if (contact < 0.55) return mk({ type: 'flyOut' }, 0.82, 36, 'Fly ball, tracked down in the outfield.');
      if (contact < 0.68) return mk({ type: 'double', contact }, 0.95, 30, 'Deep drive off the wall!');
      if (contact < hrLine) {
        if (corner) return mk({ type: 'triple', contact }, 0.99, 28, 'Off the top of the wall and into the corner!');
        return mk({ type: 'double', contact }, 0.98, 28, 'Inches short! Off the top of the wall.');
      }
      return mk({ type: 'homeRun', contact }, 1.15 + (contact - hrLine) * 0.8, 30, contact >= 0.86 ? 'PERFECT contact: no doubt about it!' : 'Barreled up... GONE!');
    }
    case 'pop':
    default: {
      if (contact < 0.6) return mk({ type: 'popOut' }, 0.22, 70, 'Late swing: popped it up.', 'pop');
      if (contact < 0.75) return mk({ type: 'flyOut' }, 0.9, 40, 'Late but strong: caught on the warning track.', 'fly');
      return mk({ type: 'double', contact }, 0.9, 25, 'Late but crushed: opposite-field double!', 'line');
    }
  }
}

/** Converts a swing time offset (seconds from perfect) into a timing score. */
export function timingScore(offsetSeconds: number, windowSeconds = 0.22): number {
  const x = Math.abs(offsetSeconds) / windowSeconds;
  if (x >= 1) return 0;
  return 1 - x * x;
}

/** How centred a ramp entry was: 1 = dead centre of the ramp mouth, 0 = clipped the edge. */
export function sweetSpotFor(offset: number): number {
  const d = Math.min(1, Math.abs(offset - 0.5) * 2);
  return clamp01(1 - d * d);
}
