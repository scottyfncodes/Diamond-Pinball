/**
 * THE HEATER: a two-wheel pitching machine in the middle of the pop-bumper nest.
 * (Internally it keeps its original "reactor" names: the charge rings, the
 * "overload" showdown and its outcomes.)
 *
 * Charge: table activity spins the wheels up through three speed stages (the
 * bumpers are its motors). At full speed the machine is HOT: shooting the ball
 * into its chute starts the SHOWDOWN. The machine throws five pitches at the
 * batter, each crossing the LEFT or RIGHT half of the plate. Swing with the
 * flipper on the ball's side as it crosses: dead on is a HOME RUN, close is a
 * BASE HIT, the wrong side or bad timing is a WHIFF. One pitch is a waste pitch
 * out of the zone: TAKE it ("GOOD EYE"); swinging at it is a CHASE. Curveballs
 * start toward one side and break late to the other; the changeup floats in
 * slow; the last pitch is the 100 MPH heater.
 *
 * Won pitches (hits, homers and good takes) scale the jackpot; enough of them
 * start multiball; all five is a PERFECT showdown. Every homer adds a bonus.
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

export type PitchKind = 'fastball' | 'changeup' | 'curveball' | 'heater' | 'ball';
export type Side = 'left' | 'right';
/** homer/hit/take win the pitch; whiff (wrong side or timing), chase (swung at a ball) and looking (watched a strike) lose it. */
export type PitchResult = 'homer' | 'hit' | 'take' | 'whiff' | 'chase' | 'looking';

/** One pitch of the showdown (the field names come from the original energy-pulse design). */
export interface Pulse {
  /** Showdown time (s) at which the pitch crosses the plate. */
  at: number;
  /** Flight time (s) from the machine to the plate. */
  lap: number;
  kind: PitchKind;
  /** The half of the plate it crosses (for a waste pitch: the side it misses on). */
  side: Side;
  /** Curveballs: fraction of the flight at which the ball breaks to its real side. */
  breakAt: number;
  mph: number;
  judged: boolean;
  /** True when the batter won the pitch. */
  hit: boolean;
  result: PitchResult | null;
  /** Signed timing error of the swing (s); 0 without a swing. */
  error: number;
}

export interface Overload {
  t: number;
  pulses: Pulse[];
  /** Swing window (s): within it the swing makes contact. */
  window: number;
  /** Won pitches. */
  syncs: number;
  homers: number;
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
  | { type: 'release'; index: number; kind: PitchKind; mph: number }
  | { type: 'pulse'; index: number; hit: boolean; error: number; result: PitchResult; kind: PitchKind; side: Side }
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

/** Share of the swing window that is dead-on: a home run. */
export const HOMER_SHARE = 0.45;
/** Seconds after the last pitch before the showdown resolves (the last ball is still in flight). */
const RESOLVE_DELAY = 0.9;

/** The five-pitch script before randomising sides and the waste pitch. */
const SCRIPT: Array<{ kind: PitchKind; mph: number; lap: number }> = [
  { kind: 'fastball', mph: 82, lap: 1.05 },
  { kind: 'fastball', mph: 89, lap: 0.94 },
  { kind: 'changeup', mph: 71, lap: 1.45 },
  { kind: 'curveball', mph: 78, lap: 1.2 },
  { kind: 'heater', mph: 100, lap: 0.78 },
];

/** Small deterministic PRNG so a seed always throws the same sequence (tests, replays). */
const prng = (seed: number) => () => {
  seed = (seed * 16807 + 11) % 2147483647;
  return seed / 2147483647;
};

/**
 * Starts the showdown. The machine throws the script with random sides; one of
 * pitches 2-4 is a waste pitch out of the zone. Each level throws a little
 * faster. The swing window scales with difficulty.
 */
export function startOverload(state: ReactorState, windowScale: number, seed = 7 + state.level * 31): Overload {
  const rnd = prng(Math.max(1, Math.floor(seed)) % 2147483646 || 1);
  const speed = 1 - 0.06 * Math.min(state.level, 3);
  const waste = 1 + Math.floor(rnd() * 3);
  const pulses: Pulse[] = [];
  // A breather after each result so every pitch reads as its own at-bat.
  let at = 1.6;
  SCRIPT.forEach((s, i) => {
    const lap = s.lap * speed;
    if (i > 0) at += 0.75 + lap;
    else at += lap;
    const kind: PitchKind = i === waste ? 'ball' : s.kind;
    pulses.push({
      at,
      lap,
      kind,
      side: rnd() < 0.5 ? 'left' : 'right',
      breakAt: kind === 'curveball' ? 0.62 : 1,
      mph: Math.round(s.mph + state.level * 2),
      judged: false,
      hit: false,
      result: null,
      error: 0,
    });
  });
  state.overload = { t: 0, pulses, window: 0.12 * windowScale, syncs: 0, homers: 0, done: false, finishedAt: null };
  return state.overload;
}

/**
 * Where a pitch is: progress `k` from the machine (0) to the plate (1) and the
 * lateral position `x` (-1 left edge .. +1 right edge of the plate; a waste pitch
 * finishes outside it). Shared by the 3D view and the HUD tracker so they agree.
 */
export function pitchPath(p: Pulse, t: number): { k: number; x: number } {
  const k = (t - (p.at - p.lap)) / p.lap;
  const dir = p.side === 'left' ? -1 : 1;
  const end = p.kind === 'ball' ? dir * 1.45 : dir * 0.5;
  const kk = Math.max(0, k);
  let x: number;
  if (p.kind === 'curveball') {
    // It starts toward the wrong half, then breaks hard to its real side.
    const fake = -dir * 0.45;
    x = kk < p.breakAt ? fake * (kk / p.breakAt) : fake + (end - fake) * Math.min(1, (kk - p.breakAt) / (1 - p.breakAt)) ** 0.8;
  } else x = end * Math.min(1, kk);
  // Past the plate it keeps drifting the same way toward the catcher.
  if (kk > 1) x = end * (1 + 0.2 * (kk - 1));
  return { k, x };
}

const judge = (o: Overload, p: Pulse, result: PitchResult, error: number): ReactorEvent => {
  p.judged = true;
  p.result = result;
  p.error = error;
  p.hit = result === 'homer' || result === 'hit' || result === 'take';
  if (p.hit) o.syncs += 1;
  if (result === 'homer') o.homers += 1;
  return { type: 'pulse', index: o.pulses.indexOf(p), hit: p.hit, error, result, kind: p.kind, side: p.side };
};

/** A swing with one flipper: judges the pitch nearest the plate. */
export function tapOverload(state: ReactorState, side: Side): ReactorEvent[] {
  const o = state.overload;
  if (!o || o.done) return [];
  // Only a swing reasonably close to a pitch counts: nervous taps between pitches are ignored.
  const reach = Math.max(0.3, o.window * 2.2);
  let best: Pulse | null = null;
  let bestErr = Infinity;
  for (const p of o.pulses) {
    if (p.judged) continue;
    const err = o.t - p.at;
    if (Math.abs(err) < Math.abs(bestErr) && Math.abs(err) <= reach) {
      best = p;
      bestErr = err;
    }
  }
  if (!best) return [];
  const p = best as Pulse;
  if (p.kind === 'ball') return [judge(o, p, 'chase', bestErr)];
  if (side !== p.side || Math.abs(bestErr) > o.window) return [judge(o, p, 'whiff', bestErr)];
  return [judge(o, p, Math.abs(bestErr) <= o.window * HOMER_SHARE ? 'homer' : 'hit', bestErr)];
}

export function updateOverload(state: ReactorState, dt: number): ReactorEvent[] {
  const o = state.overload;
  const events: ReactorEvent[] = [];
  if (!o || o.done) return events;
  const before = o.t;
  o.t += dt;
  o.pulses.forEach((p, index) => {
    const release = p.at - p.lap;
    if (before < release && o.t >= release) events.push({ type: 'release', index, kind: p.kind, mph: p.mph });
  });
  for (const p of o.pulses) {
    // Past the plate untouched: a taken ball is a win, a watched strike is a loss.
    if (!p.judged && o.t > p.at + o.window) events.push(judge(o, p, p.kind === 'ball' ? 'take' : 'looking', 0));
  }
  if (o.pulses.every((p) => p.judged)) {
    if (o.finishedAt === null) o.finishedAt = o.t;
    if (o.t >= o.finishedAt + RESOLVE_DELAY) {
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

/** Showdown jackpot: grows with won pitches and machine level; every home run adds a bonus. */
export function overloadJackpot(syncs: number, level: number, homers = 0): number {
  return Math.round((1 + 0.5 * level) * (100000 * (1 + 0.6 * syncs) + 50000 * homers));
}

/** Resets the rings after an overload and raises the reactor level. */
export function completeOverload(state: ReactorState): void {
  state.overload = null;
  state.ready = false;
  state.charge = [0, 0, 0];
  state.level += 1;
}
