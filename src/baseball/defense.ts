import { clamp01 } from '../core/math';
import type { Random } from '../core/Random';
import type { Play } from './types';

export interface DefenseInput {
  /** Fielding energy the player has built with pinball shots (0..1). */
  defenseRating: number;
  inning: number;
  difficulty: number;
  runnerOnFirst: boolean;
  outs: number;
}

export interface DefenseResult {
  play: Play;
  quality: number;
  direction: 'left' | 'center' | 'right';
  trajectory: 'ground' | 'line' | 'fly' | 'pop';
  distance: number;
  reason: string;
}

/**
 * Resolves an opponent plate appearance. The player's defensive rating comes
 * from recent pinball activity: keep the ball busy and the fielders make plays.
 */
export function resolveDefense(input: DefenseInput, rng: Random): DefenseResult {
  const jitter = (rng.next() - 0.5) * 0.12;
  const q = clamp01(input.defenseRating * 0.8 + (1 - clamp01(input.difficulty)) * 0.15 - input.inning * 0.008 + jitter);
  const direction = rng.pick(['left', 'center', 'right'] as const);
  const dp = input.runnerOnFirst && input.outs < 2;
  const mk = (play: Play, trajectory: DefenseResult['trajectory'], distance: number, reason: string): DefenseResult => ({
    play,
    quality: q,
    direction,
    trajectory,
    distance,
    reason,
  });
  if (q >= 0.7) {
    const r = rng.next();
    if (dp && q >= 0.82 && r < 0.55) return mk({ type: 'groundOut', doublePlay: true }, 'ground', 0.35, 'Sharp defense turns two!');
    if (r < 0.35) return mk({ type: 'groundOut' }, 'ground', 0.4, 'Fielded and thrown out.');
    if (r < 0.65) return mk({ type: 'flyOut' }, 'fly', 0.8, 'Tracked down in the outfield.');
    if (r < 0.85) return mk({ type: 'popOut' }, 'pop', 0.25, 'Popped up, easy out.');
    return mk({ type: 'strikeout' }, 'pop', 0.05, 'Blown away: strike three.');
  }
  if (q >= 0.45) {
    const r = rng.next();
    if (r < 0.55) return mk(rng.chance(0.5) ? { type: 'groundOut' } : { type: 'flyOut' }, rng.chance(0.5) ? 'ground' : 'fly', 0.6, 'Routine play.');
    return mk({ type: 'single', contact: 0.45 }, 'ground', 0.55, 'Found a hole for a single.');
  }
  if (q >= 0.25) {
    const r = rng.next();
    if (r < 0.5) return mk({ type: 'single', contact: 0.55 }, 'line', 0.6, 'Line drive single.');
    if (r < 0.8) return mk({ type: 'double', contact: 0.6 }, 'line', 0.9, 'Gap shot, the defense was flat-footed.');
    return mk({ type: 'flyOut' }, 'fly', 0.85, 'Caught at the warning track.');
  }
  const r = rng.next();
  if (r < 0.3) return mk({ type: 'single', contact: 0.6 }, 'line', 0.62, 'Lazy defense allows a single.');
  if (r < 0.62) return mk({ type: 'double', contact: 0.7 }, 'line', 0.92, 'Off the wall: double.');
  if (r < 0.72) return mk({ type: 'triple', contact: 0.7 }, 'line', 0.98, 'Into the corner for three.');
  return mk({ type: 'homeRun', contact: 0.9 }, 'fly', 1.15, 'The fielders were asleep: gone.');
}
