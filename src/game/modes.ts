/**
 * Multiball modes, stadium boss encounters and THE IMPOSSIBLE INNING tracker.
 * Pure data and rules; the Game orchestrates them against the table.
 */
import type { DifficultyProfile } from './difficulty';

// ------------------------------------------------------------------ multiball

export type MultiballMode = 'none' | 'standard' | 'baseball' | 'derby' | 'chaos' | 'reactor';

export interface MultiballDef {
  id: MultiballMode;
  name: string;
  sub: string;
  /** Balls the mode wants in play (including the one that started it). */
  balls: number;
}

export const MULTIBALLS: Record<Exclude<MultiballMode, 'none'>, MultiballDef> = {
  standard: { id: 'standard', name: 'MULTIBALL!', sub: 'Every ramp is a JACKPOT at-bat', balls: 3 },
  baseball: { id: 'baseball', name: 'BASEBALL MULTIBALL!', sub: 'Baseballs flood the table: every lit target is a base hit', balls: 4 },
  derby: { id: 'derby', name: 'HOME RUN DERBY!', sub: 'Chain homers to raise the derby multiplier', balls: 2 },
  chaos: { id: 'chaos', name: 'CHAOS MULTIBALL!', sub: 'Roving jackpot, moving targets, everything escalates', balls: 5 },
  reactor: { id: 'reactor', name: 'HEATER MULTIBALL!', sub: 'Every bumper fires a HEATER JACKPOT · the machine spins up fast', balls: 3 },
};

/** The derby multiplier: each homer adds 1x up to 5x on derby awards. */
export const derbyMultiplier = (homers: number): number => Math.min(5, 1 + homers);

// ------------------------------------------------------------------ bosses

export type BossId = 'ace' | 'wall' | 'commissioner' | 'nightmare';

export interface BossDef {
  id: BossId;
  name: string;
  intro: string;
  /** Base duration in seconds (scaled by the difficulty's modeTimeScale). */
  duration: number;
  /** Objective labels in order; stage index selects the current one. */
  stages: string[];
  /** Progress needed per stage. */
  goals: number[];
  reward: number;
  achievement: string;
}

export const BOSSES: Record<BossId, BossDef> = {
  ace: {
    id: 'ace',
    name: 'THE ACE',
    intro: 'A legendary arm takes the mound. Read the pitches: three hits chase him.',
    duration: 60,
    stages: ['GET 3 HITS OFF THE ACE'],
    goals: [3],
    reward: 200000,
    achievement: 'boss_ace',
  },
  wall: {
    id: 'wall',
    name: 'THE WALL',
    intro: 'The outfield wall grows weak points. Smash the lit section, then clear it.',
    duration: 55,
    stages: ['HIT THE LIT WALL SECTION x3', 'HIT ONE OVER THE WALL'],
    goals: [3, 1],
    reward: 250000,
    achievement: 'boss_wall',
  },
  commissioner: {
    id: 'commissioner',
    name: "COMMISSIONER'S CHALLENGE",
    intro: 'Three objectives, one clock. Pinball accuracy, baseball timing, runner management.',
    duration: 50,
    stages: ['SHOOT THE 2B CENTRE LANE', 'GET A BASE HIT', 'ADVANCE A RUNNER (STEAL OR HIT)'],
    goals: [1, 1, 1],
    reward: 200000,
    achievement: 'boss_commissioner',
  },
  nightmare: {
    id: 'nightmare',
    name: 'NINTH-INNING NIGHTMARE',
    intro: 'Last inning, down late, the diamond is loaded. One swing. Make it a walk-off.',
    duration: 0,
    stages: ['DRIVE IN THE TYING RUN'],
    goals: [1],
    reward: 500000,
    achievement: 'boss_nightmare',
  },
};

export interface BossState {
  id: BossId;
  stage: number;
  progress: number;
  /** Remaining seconds (Infinity when the boss has no clock). */
  timer: number;
  total: number;
  /** For THE WALL: which section is lit. */
  litSection: 'left' | 'center' | 'right';
  /** Hits the player has taken from THE ACE (outs); 3 ends the encounter. */
  outs: number;
}

export function createBoss(id: BossId, difficulty: DifficultyProfile): BossState {
  const def = BOSSES[id];
  const total = def.duration > 0 ? def.duration * difficulty.modeTimeScale : Infinity;
  return { id, stage: 0, progress: 0, timer: total, total, litSection: 'center', outs: 0 };
}

/** Records progress on the current stage; returns 'stage' when a stage completes and 'done' when the boss is beaten. */
export function bossProgress(b: BossState, amount = 1): 'none' | 'stage' | 'done' {
  const def = BOSSES[b.id];
  b.progress += amount;
  if (b.progress < def.goals[b.stage]) return 'none';
  b.stage += 1;
  b.progress = 0;
  return b.stage >= def.stages.length ? 'done' : 'stage';
}

export const bossObjective = (b: BossState): { label: string; progress: number; goal: number } => {
  const def = BOSSES[b.id];
  const stage = Math.min(b.stage, def.stages.length - 1);
  return { label: def.stages[stage], progress: b.progress, goal: def.goals[stage] };
};

// ------------------------------------------------------------------ THE IMPOSSIBLE INNING

export type ImpossibleLink = 'perfect' | 'homer' | 'perfectHomer' | 'multiball' | 'steal' | 'combo5';

export const IMPOSSIBLE_LINK_LABEL: Record<ImpossibleLink, string> = {
  perfect: 'PERFECT CONTACT',
  homer: 'HOME RUN',
  perfectHomer: 'PERFECT HOME RUN',
  multiball: 'MULTIBALL',
  steal: 'STOLEN BASE',
  combo5: 'COMBO x5',
};

export interface ImpossibleState {
  links: Set<ImpossibleLink>;
  /** Links the active difficulty demands. */
  required: ImpossibleLink[];
  needed: number;
  achieved: boolean;
}

export function createImpossible(difficulty: DifficultyProfile): ImpossibleState {
  const required: ImpossibleLink[] = [difficulty.impossiblePerfectHomer ? 'perfectHomer' : 'homer', 'perfect', 'multiball', 'steal', 'combo5'];
  return { links: new Set(), required, needed: Math.min(difficulty.impossibleLinks, required.length), achieved: false };
}

/** Adds a link; returns true when the chain is complete for the first time. */
export function addImpossibleLink(s: ImpossibleState, link: ImpossibleLink): boolean {
  if (s.achieved) return false;
  // A perfect home run satisfies both the plain and the perfect homer requirement.
  if (link === 'perfectHomer') {
    s.links.add('perfectHomer');
    s.links.add('homer');
  } else s.links.add(link);
  const have = s.required.filter((r) => s.links.has(r)).length;
  if (have >= s.needed) {
    s.achieved = true;
    return true;
  }
  return false;
}

export const impossibleCount = (s: ImpossibleState): number => s.required.filter((r) => s.links.has(r)).length;

export function resetImpossible(s: ImpossibleState): void {
  s.links.clear();
  s.achieved = false;
}
