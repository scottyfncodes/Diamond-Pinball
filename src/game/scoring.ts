/**
 * Pinball scoring, combos and multipliers. Pure data so it can be unit tested.
 */
export const POINTS = {
  bumper: 450,
  slingshot: 250,
  post: 50,
  dropTarget: 1500,
  bankComplete: 12000,
  standupTarget: 1200,
  centerLane: 3000,
  topLane: 2500,
  topLanesComplete: 15000,
  skillShot: 30000,
  ramp: 6000,
  rampQualityBonus: 9000,
  hrLane: 8000,
  inlane: 400,
  kickback: 5000,
  lock: 20000,
  multiballStart: 50000,
  jackpot: 75000,
  defenseOut: 12000,
  doublePlay: 45000,
  strikeoutPitch: 20000,
  perBase: 8000,
  single: 10000,
  double: 22000,
  triple: 40000,
  homeRun: 100000,
  grandSlam: 300000,
  run: 25000,
  perfectContact: 35000,
  stolenBase: 15000,
  inningComplete: 10000,
  win: 250000,
  shutout: 150000,
  wallBounce: 4000,
  wallCleared: 40000,
  mound: 2500,
  squeeze: 30000,
  scoreboardCycle: 25000,
  bullpen: 6000,
  modifier: 15000,
  blackHole: 20000,
  lightning: 3000,
  derbyHomer: 60000,
  bossClear: 200000,
  nightmareWalkOff: 500000,
  impossibleInning: 1000000,
  nearMiss: 2000,
  citySignal: 5000,
  cityLit: 15000,
  cityDivert: 10000,
  cityRebuild: 250000,
  reactorRing: 15000,
  reactorReady: 30000,
  reactorFeed: 4000,
  reactorSync: 20000,
  superJackpot: 200000,
  coilJackpot: 6000,
  grandTour: 750000,
} as const;

export interface ComboState {
  count: number;
  best: number;
  timer: number;
}

export const COMBO_WINDOW = 4.5;

export function createCombo(): ComboState {
  return { count: 0, best: 0, timer: 0 };
}

/** Registers a major shot (ramp, lane, bank completion). Returns the new combo count. */
export function registerComboShot(c: ComboState, window = COMBO_WINDOW): number {
  c.count += 1;
  c.timer = window;
  if (c.count > c.best) c.best = c.count;
  return c.count;
}

/** Combo tiers drive the announcement ladder and the HUD colour. */
export type ComboTier = 'none' | 'warm' | 'hot' | 'blazing' | 'legend';

export function comboTier(count: number): ComboTier {
  if (count >= 10) return 'legend';
  if (count >= 7) return 'blazing';
  if (count >= 4) return 'hot';
  if (count >= 2) return 'warm';
  return 'none';
}

export const COMBO_TIER_LABEL: Record<ComboTier, string> = {
  none: '',
  warm: 'COMBO',
  hot: 'HOT STREAK',
  blazing: 'BLAZING',
  legend: 'ABSOLUTE LEGEND',
};

/**
 * Escalating contact announcements. Each is tied to a concrete outcome so the
 * player always knows why the stadium is shouting at them.
 */
export function contactAnnouncement(input: { grade: 'foul' | 'weak' | 'solid' | 'perfect'; play: string; distance: number; grandSlam: boolean; backToBack: boolean; walkOff: boolean }): string {
  if (input.walkOff) return 'WALK-OFF!';
  if (input.grandSlam) return 'GRAND SLAM!';
  if (input.play === 'homeRun') return input.backToBack ? 'BACK-TO-BACK!' : 'GONE!';
  if (input.play === 'triple') return 'DEEP DRIVE';
  if (input.distance >= 0.95) return 'WARNING TRACK';
  if (input.grade === 'perfect') return 'BARRELED UP';
  if (input.grade === 'solid') return 'NICE CONTACT';
  return '';
}

/** Hard cap on the total multiplier so stacked modes can never run away. */
export const MAX_TOTAL_MULTIPLIER = 24;

/**
 * Rate limiter for repeated low-value hits (bumper storms, resting-contact
 * chatter). Each source may score at most `max` awards per `window` seconds;
 * returns false when an award should be suppressed.
 */
export interface RateLimiter {
  window: number;
  max: number;
  stamps: Map<string, number[]>;
}

export const createRateLimiter = (window: number, max: number): RateLimiter => ({ window, max, stamps: new Map() });

export function allowScore(r: RateLimiter, source: string, now: number): boolean {
  let list = r.stamps.get(source);
  if (!list) {
    list = [];
    r.stamps.set(source, list);
  }
  while (list.length && now - list[0] > r.window) list.shift();
  if (list.length >= r.max) return false;
  list.push(now);
  return true;
}

/** Ticks the combo timer; the combo breaks when the window elapses. Returns true if it broke. */
export function tickCombo(c: ComboState, dt: number): boolean {
  if (c.count === 0) return false;
  c.timer -= dt;
  if (c.timer <= 0) {
    c.count = 0;
    c.timer = 0;
    return true;
  }
  return false;
}

export function resetCombo(c: ComboState): void {
  c.count = 0;
  c.timer = 0;
}

/** Combo multiplier: 1x up to 3x. */
export function comboMultiplier(count: number): number {
  if (count <= 1) return 1;
  return Math.min(3, 1 + (count - 1) * 0.5);
}

/**
 * Score multiplier earned by baseball success: every two runs add 1x, capped.
 * Multiball doubles everything on top.
 */
export function scoreMultiplier(runs: number, multiball: boolean, bonusLevel: number): number {
  const base = 1 + Math.min(4, Math.floor(runs / 2)) + Math.min(2, bonusLevel);
  return multiball ? base * 2 : base;
}

export function applyScore(points: number, multiplier: number, combo: number, difficultyScale = 1): number {
  const total = Math.min(MAX_TOTAL_MULTIPLIER, multiplier * comboMultiplier(combo));
  return Math.round(points * total * difficultyScale);
}

export function formatScore(n: number): string {
  return n.toLocaleString('en-US');
}
