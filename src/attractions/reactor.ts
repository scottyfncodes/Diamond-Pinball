/**
 * THE REACTOR CORE: an energy chamber in the middle of the pop-bumper nest.
 *
 * Stage 1-3: table activity charges three concentric rings in order (the
 * bumpers are its coils). When all three are full the core opens. Shooting a
 * ball into the open core starts the OVERLOAD: five energy pulses race around
 * the containment ring and the player syncs each one with a flipper tap as it
 * crosses the sync gate. Synced pulses scale the jackpot; enough of them start
 * REACTOR MULTIBALL; all five are a MELTDOWN.
 *
 * Pure rules: no rendering, no timers outside `update`.
 */

export const RING_COUNT = 3;
export const PULSES = 5;

/** Charge sources (units of charge). */
export const CHARGE = {
  bumper: 1,
  slingshot: 0.35,
  topLane: 2,
  centerLane: 3,
  coreRollover: 2,
  target: 1,
  ramp: 1.5,
} as const;

/** Base charge each ring needs at medium (scaled by difficulty and reactor level). */
export const RING_BASE = 9;

export interface Pulse {
  /** Overload time (s) at which the pulse crosses the sync gate. */
  at: number;
  /** Seconds the pulse takes to travel once around the ring (for the visual). */
  lap: number;
  judged: boolean;
  hit: boolean;
  /** Signed timing error of the tap (s); 0 when missed. */
  error: number;
}

export interface Overload {
  t: number;
  pulses: Pulse[];
  window: number;
  syncs: number;
  done: boolean;
  finishedAt: number | null;
}

export interface ReactorState {
  /** Completed overloads this game (raises charge needs and jackpot). */
  level: number;
  charge: number[];
  ready: boolean;
  overload: Overload | null;
  /** MELTDOWN afterglow: bumpers pay triple for this many seconds. */
  critical: number;
}

export type ReactorEvent =
  | { type: 'charge'; ring: number; fill: number }
  | { type: 'ring'; ring: number }
  | { type: 'ready' }
  | { type: 'pulse'; index: number; hit: boolean; error: number }
  | { type: 'done'; syncs: number };

export type OverloadOutcome = 'fizzle' | 'overload' | 'meltdown';

export function createReactor(): ReactorState {
  return { level: 0, charge: [0, 0, 0], ready: false, overload: null, critical: 0 };
}

export function ringNeed(state: ReactorState, chargeScale: number): number {
  return RING_BASE * chargeScale * (1 + 0.3 * state.level);
}

/** 0..1 overall charge across the three rings. */
export function totalCharge(state: ReactorState): number {
  return state.charge.reduce((a, b) => a + b, 0) / RING_COUNT;
}

/** Index of the ring currently charging (3 once ready). */
export function stage(state: ReactorState): number {
  const i = state.charge.findIndex((c) => c < 1);
  return i < 0 ? RING_COUNT : i;
}

/** Adds charge to the ring currently filling; spills over into the next ring. */
export function addCharge(state: ReactorState, amount: number, chargeScale: number): ReactorEvent[] {
  const events: ReactorEvent[] = [];
  if (state.ready || state.overload || amount <= 0) return events;
  let left = amount / ringNeed(state, chargeScale);
  while (left > 1e-9) {
    const ring = stage(state);
    if (ring >= RING_COUNT) break;
    const room = 1 - state.charge[ring];
    const add = Math.min(room, left);
    state.charge[ring] += add;
    left -= add;
    if (state.charge[ring] >= 1 - 1e-9) {
      state.charge[ring] = 1;
      events.push({ type: 'ring', ring });
    } else events.push({ type: 'charge', ring, fill: state.charge[ring] });
  }
  if (stage(state) >= RING_COUNT) {
    state.ready = true;
    events.push({ type: 'ready' });
  }
  return events;
}

/** Fills the reactor straight to CORE READY (Grand Tour reward, tests). */
export function forceReady(state: ReactorState): void {
  state.charge = [1, 1, 1];
  state.ready = true;
}

/**
 * Starts the overload. Pulses speed up as the reaction runs away; the sync
 * window scales with difficulty.
 */
export function startOverload(state: ReactorState, windowScale: number): Overload {
  const pulses: Pulse[] = [];
  // A short breather before each sweep so every pulse reads as its own attempt.
  let at = 1.8;
  const laps = [1.1, 1.0, 0.9, 0.8, 0.7];
  for (let i = 0; i < PULSES; i++) {
    pulses.push({ at, lap: laps[i], judged: false, hit: false, error: 0 });
    at += (laps[i + 1] ?? 0) + 0.45;
  }
  state.overload = { t: 0, pulses, window: 0.12 * windowScale, syncs: 0, done: false, finishedAt: null };
  return state.overload;
}

/** A flipper tap during the overload: judges the pulse nearest the gate. */
export function tapOverload(state: ReactorState): ReactorEvent[] {
  const o = state.overload;
  if (!o || o.done) return [];
  // Only a tap reasonably close to a pending pulse counts: nervous taps between pulses are ignored.
  const reach = Math.max(0.3, o.window * 2.2);
  let best: Pulse | null = null;
  let bestErr = Infinity;
  o.pulses.forEach((p) => {
    if (p.judged) return;
    const err = o.t - p.at;
    if (Math.abs(err) < Math.abs(bestErr) && Math.abs(err) <= reach) {
      best = p;
      bestErr = err;
    }
  });
  if (!best) return [];
  const p = best as Pulse;
  p.judged = true;
  p.error = bestErr;
  p.hit = Math.abs(bestErr) <= o.window;
  if (p.hit) o.syncs += 1;
  return [{ type: 'pulse', index: o.pulses.indexOf(p), hit: p.hit, error: bestErr }];
}

export function updateOverload(state: ReactorState, dt: number): ReactorEvent[] {
  const o = state.overload;
  const events: ReactorEvent[] = [];
  if (!o || o.done) return events;
  o.t += dt;
  o.pulses.forEach((p, index) => {
    if (!p.judged && o.t > p.at + o.window) {
      p.judged = true;
      p.hit = false;
      events.push({ type: 'pulse', index, hit: false, error: 0 });
    }
  });
  if (o.pulses.every((p) => p.judged)) {
    if (o.finishedAt === null) o.finishedAt = o.t;
    if (o.t >= o.finishedAt + 0.5) {
      o.done = true;
      events.push({ type: 'done', syncs: o.syncs });
    }
  }
  return events;
}

export function overloadOutcome(syncs: number, syncsForMultiball: number): OverloadOutcome {
  if (syncs >= PULSES) return 'meltdown';
  if (syncs >= syncsForMultiball) return 'overload';
  return 'fizzle';
}

/** Jackpot for an overload: grows with synced pulses and reactor level. */
export function overloadJackpot(syncs: number, level: number): number {
  return Math.round(100000 * (1 + 0.5 * level) * (1 + 0.6 * syncs));
}

/** Resets the rings after an overload and raises the reactor level. */
export function completeOverload(state: ReactorState): void {
  state.overload = null;
  state.ready = false;
  state.charge = [0, 0, 0];
  state.level += 1;
}
