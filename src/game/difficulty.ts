/**
 * The single source of truth for difficulty. Every system that behaves
 * differently between EASY, MEDIUM and HARD reads from the active profile; no
 * other module hard-codes a difficulty check.
 *
 * Ball size and speed are physically real: the profile changes the collision
 * radius of every pinball and the rate at which ball dynamics advance, so a
 * slower ball is genuinely slower on every surface, not just a visual trick.
 */
export type DifficultyId = 'easy' | 'medium' | 'hard';

export interface DifficultyProfile {
  id: DifficultyId;
  name: string;
  title: string;
  tagline: string;
  description: string;
  /** Short colour accent for the selector / HUD chip. */
  color: string;
  /** Collision radius multiplier for every pinball (1 = the 0.5-unit steel ball). */
  ballScale: number;
  /** Multiplier on the rate ball dynamics advance (gravity, speed, everything). */
  speedScale: number;
  /** Multiplier on the combo window. */
  comboWindowScale: number;
  /** Multiplier on the swing timing window. */
  battingWindowScale: number;
  /** Flipper collision capsule radius multiplier (thinner tips on hard demand precision). */
  flipperScale: number;
  /** Flipper snap speed and bounce multiplier (snappier, punchier flippers forgive late presses). */
  flipperPower: number;
  /** Multiplier on every pinball point award. */
  scoreScale: number;
  /** Seconds of ball save after a launch. */
  ballSave: number;
  /** Kickback is lit automatically on every new ball. */
  kickbackPerBall: boolean;
  /** Pitch clock in seconds (offense). */
  pitchClock: number;
  /** Seconds between opponent at-bats (defense). */
  defenseInterval: number;
  /** 0 = easy, 1 = brutal: feeds the batting and defense models. */
  batting: number;
  /** Locks needed to start the standard multiball. */
  locksForMultiball: number;
  /** Multiplier on the duration of timed modes (bosses, derby, modifiers). */
  modeTimeScale: number;
  /** Number of chain links THE IMPOSSIBLE INNING needs (out of 5). */
  impossibleLinks: number;
  /** The Impossible Inning also demands a perfect-contact home run. */
  impossiblePerfectHomer: boolean;
  /** Balls per game. */
  balls: number;
  /** Seconds the home plate stays lit after rattling the mound. */
  plateLit: number;
  /** Outfield wall sections must be lit in order (left, centre, right). */
  orderedWall: boolean;
  /** The skill-shot lane rotates on its own (harder to line up). */
  skillShotRotates: boolean;
  /** Multiplier on the ramp entry speed requirement. */
  rampMinSpeedScale: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  easy: {
    id: 'easy',
    name: 'EASY',
    title: 'SLUGGER',
    tagline: 'Big ball. Slow action. Huge satisfaction.',
    description: 'A huge, slow steel ball, long combo windows, a generous swing window and a kickback on every ball. Spectacular events are easy to reach.',
    color: '#7cff5a',
    ballScale: 1.3,
    speedScale: 0.72,
    comboWindowScale: 1.5,
    battingWindowScale: 1.5,
    flipperScale: 1.04,
    flipperPower: 1.18,
    scoreScale: 0.85,
    ballSave: 18,
    kickbackPerBall: true,
    pitchClock: 30,
    defenseInterval: 11,
    batting: 0.15,
    locksForMultiball: 1,
    modeTimeScale: 1.4,
    impossibleLinks: 4,
    impossiblePerfectHomer: false,
    balls: 3,
    plateLit: 8,
    orderedWall: false,
    skillShotRotates: false,
    rampMinSpeedScale: 0.85,
  },
  medium: {
    id: 'medium',
    name: 'MEDIUM',
    title: 'ALL-STAR',
    tagline: 'Responsive physics. Fair fights. Escalating spectacle.',
    description: 'The intended baseline: a regulation steel ball, balanced timing windows and a standard ball save. Skill, luck and spectacle in equal measure.',
    color: '#4fe3ff',
    ballScale: 1,
    speedScale: 1,
    comboWindowScale: 1,
    battingWindowScale: 1,
    flipperScale: 1,
    flipperPower: 1,
    scoreScale: 1,
    ballSave: 12,
    kickbackPerBall: false,
    pitchClock: 20,
    defenseInterval: 9,
    batting: 0.45,
    locksForMultiball: 2,
    modeTimeScale: 1,
    impossibleLinks: 5,
    impossiblePerfectHomer: false,
    balls: 3,
    plateLit: 5,
    orderedWall: false,
    skillShotRotates: false,
    rampMinSpeedScale: 1,
  },
  hard: {
    id: 'hard',
    name: 'HARD',
    title: 'HALL OF FAME',
    tagline: 'Small ball. High speed. Barely tolerated.',
    description: 'A small, fast ball, short combo windows, a demanding swing window and only a brief ball save. Every point is worth 1.5x and the mastery achievements live here.',
    color: '#ff4d6d',
    ballScale: 0.78,
    speedScale: 1.28,
    comboWindowScale: 0.75,
    battingWindowScale: 0.7,
    flipperScale: 0.94,
    flipperPower: 0.96,
    scoreScale: 1.5,
    ballSave: 7,
    kickbackPerBall: false,
    pitchClock: 14,
    defenseInterval: 7.5,
    batting: 0.8,
    locksForMultiball: 2,
    modeTimeScale: 0.75,
    impossibleLinks: 5,
    impossiblePerfectHomer: true,
    balls: 3,
    plateLit: 3.5,
    orderedWall: true,
    skillShotRotates: true,
    rampMinSpeedScale: 1.1,
  },
};

export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'medium', 'hard'];
export const DEFAULT_DIFFICULTY: DifficultyId = 'medium';

/** Accepts the current ids plus the legacy settings values (rookie / pro / allstar). */
export function normalizeDifficulty(value: unknown): DifficultyId {
  switch (value) {
    case 'easy':
    case 'rookie':
      return 'easy';
    case 'hard':
    case 'allstar':
      return 'hard';
    case 'medium':
    case 'pro':
      return 'medium';
    default:
      return DEFAULT_DIFFICULTY;
  }
}

export const difficultyFor = (id: unknown): DifficultyProfile => DIFFICULTIES[normalizeDifficulty(id)];
