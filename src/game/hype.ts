/**
 * The HYPE meter: every meaningful shot and baseball moment fills it, idling
 * drains it. Filling it starts a RALLY: double scoring, a lit home run lane and
 * better contact for a limited time. Pure data so it can be unit tested.
 */
export const HYPE_MAX = 100;
export const HYPE_GRACE = 2.5;
export const HYPE_DECAY = 4;
export const RALLY_SECONDS = 20;

export const HYPE_GAIN = {
  bumper: 1.5,
  slingshot: 1,
  target: 4,
  bankComplete: 10,
  lane: 4,
  ramp: 12,
  skillShot: 20,
  lock: 12,
  steal: 10,
  single: 10,
  double: 15,
  triple: 22,
  homeRun: 35,
  run: 8,
  out: 8,
  doublePlay: 20,
  strikeout: 10,
  perfect: 12,
} as const;

export interface HypeState {
  value: number;
  /** Seconds since the last gain. */
  idle: number;
  /** Remaining rally seconds; 0 when no rally is running. */
  rally: number;
  rallies: number;
}

export const createHype = (): HypeState => ({ value: 0, idle: 0, rally: 0, rallies: 0 });

/** Adds hype. Returns true when this gain starts a rally. */
export function addHype(h: HypeState, amount: number): boolean {
  if (amount <= 0) return false;
  h.idle = 0;
  if (h.rally > 0) return false;
  h.value = Math.min(HYPE_MAX, h.value + amount);
  if (h.value >= HYPE_MAX) {
    h.rally = RALLY_SECONDS;
    h.rallies += 1;
    return true;
  }
  return false;
}

/** Advances timers. Returns true when a running rally ends this tick. */
export function tickHype(h: HypeState, dt: number): boolean {
  if (h.rally > 0) {
    h.rally -= dt;
    h.value = Math.max(0, (h.rally / RALLY_SECONDS) * HYPE_MAX);
    if (h.rally <= 0) {
      h.rally = 0;
      h.value = 0;
      h.idle = 0;
      return true;
    }
    return false;
  }
  h.idle += dt;
  if (h.idle > HYPE_GRACE) h.value = Math.max(0, h.value - HYPE_DECAY * dt);
  return false;
}

/** Losing a ball takes the wind out of the crowd. Rallies end. */
export function drainHype(h: HypeState): void {
  h.rally = 0;
  h.value = Math.floor(h.value / 2);
  h.idle = 0;
}

export const rallyActive = (h: HypeState): boolean => h.rally > 0;
