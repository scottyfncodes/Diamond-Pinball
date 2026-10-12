import type { Random } from '../core/Random';

export type PitchType = 'fastball' | 'changeup' | 'curveball' | 'slider';

export interface Pitch {
  type: PitchType;
  label: string;
  mph: number;
  /** Seconds from the start of the at-bat until the pitch crosses the plate. */
  delay: number;
  /** Half-width of the swing timing window in seconds. */
  window: number;
  /** Lateral break for the animation (-1 = breaks to the left, 1 = to the right). */
  breakX: number;
}

const BASE: Record<PitchType, Omit<Pitch, 'mph' | 'breakX'> & { mph: [number, number]; breakX: number }> = {
  fastball: { type: 'fastball', label: 'FASTBALL', mph: [93, 99], delay: 0.95, window: 0.22, breakX: 0 },
  slider: { type: 'slider', label: 'SLIDER', mph: [84, 89], delay: 1.12, window: 0.24, breakX: 0.6 },
  curveball: { type: 'curveball', label: 'CURVEBALL', mph: [76, 81], delay: 1.3, window: 0.26, breakX: -0.4 },
  changeup: { type: 'changeup', label: 'CHANGEUP', mph: [80, 85], delay: 1.42, window: 0.27, breakX: 0.2 },
};

/**
 * Picks the next pitch. Harder difficulties and later innings mix in more
 * velocity, which tightens the timing window. The pitch is announced before it
 * is thrown so timing is a readable skill, not a guess.
 */
export function choosePitch(rng: Random, difficulty: number, inning: number): Pitch {
  const late = Math.min(1, (inning - 1) / 8);
  const r = rng.next();
  const fastShare = 0.35 + 0.2 * difficulty + 0.1 * late;
  const type: PitchType = r < fastShare ? 'fastball' : r < fastShare + 0.22 ? 'slider' : r < fastShare + 0.42 ? 'curveball' : 'changeup';
  const b = BASE[type];
  const mph = Math.round(b.mph[0] + (b.mph[1] - b.mph[0]) * rng.next());
  // Faster pitches arrive sooner and give a tighter window.
  const speedFactor = 1 - 0.08 * difficulty;
  return {
    type,
    label: b.label,
    mph,
    delay: b.delay * speedFactor,
    window: b.window * (1 - 0.18 * difficulty),
    breakX: b.breakX,
  };
}
