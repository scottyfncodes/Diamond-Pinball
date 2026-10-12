export type Half = 'top' | 'bottom';
export type TeamSide = 'away' | 'home';

export interface Runner {
  id: number;
}

export interface TeamLine {
  runs: number;
  hits: number;
  errors: number;
  /** Runs per inning (index 0 = 1st inning). */
  innings: number[];
}

export interface BaseballState {
  inning: number;
  half: Half;
  outs: number;
  balls: number;
  strikes: number;
  /** Runners on first, second and third. */
  bases: [Runner | null, Runner | null, Runner | null];
  away: TeamLine;
  home: TeamLine;
  /** Regulation length (3 for arcade, 9 for a full game). */
  totalInnings: number;
  gameOver: boolean;
  winner: TeamSide | null;
  nextRunnerId: number;
  /** Count of completed plate appearances, used as a deterministic seed component. */
  plateAppearances: number;
}

export type HitType = 'single' | 'double' | 'triple' | 'homeRun';
export type OutType = 'groundOut' | 'flyOut' | 'popOut' | 'lineOut' | 'strikeout';

export type Play =
  | { type: HitType; contact?: number }
  | { type: 'groundOut'; doublePlay?: boolean }
  | { type: 'flyOut' | 'popOut' | 'lineOut' | 'strikeout' }
  | { type: 'walk' }
  | { type: 'foul' }
  | { type: 'strike' }
  | { type: 'ball' }
  | { type: 'error' }
  | { type: 'steal'; base: 1 | 2 | 3 }
  | { type: 'caughtStealing'; base: 1 | 2 | 3 };

export type BaseIndex = 0 | 1 | 2 | 3 | 4; // 0 = home plate (batter), 4 = scored

export interface RunnerMove {
  runner: Runner;
  from: BaseIndex;
  to: BaseIndex | 'out';
  /** Set when a runner reaches home. */
  scored: boolean;
}

export interface PlayResult {
  play: Play;
  /** Short caption for the HUD, e.g. "DOUBLE!" */
  label: string;
  /** Longer explanation of what happened and why. */
  description: string;
  runs: number;
  outs: number;
  hit: boolean;
  moves: RunnerMove[];
  halfInningEnded: boolean;
  inningEnded: boolean;
  gameOver: boolean;
  /** Set when a strikeout was produced by the count rather than a swing. */
  strikeoutLooking: boolean;
  walkOff: boolean;
  doublePlay: boolean;
  sacFly: boolean;
  grandSlam: boolean;
}
