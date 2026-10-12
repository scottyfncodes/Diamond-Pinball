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
export function registerComboShot(c: ComboState): number {
  c.count += 1;
  c.timer = COMBO_WINDOW;
  if (c.count > c.best) c.best = c.count;
  return c.count;
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

export function applyScore(points: number, multiplier: number, combo: number): number {
  return Math.round(points * multiplier * comboMultiplier(combo));
}

export function formatScore(n: number): string {
  return n.toLocaleString('en-US');
}
