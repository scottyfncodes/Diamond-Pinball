/**
 * WALL CATCH (the sandlot attraction; the module keeps its original name).
 *
 * The pinball drops into the sandlot batting cage and an outfielder sprints
 * down the field. The flippers move him: LEFT one lane left, RIGHT one lane
 * right. Dodge mowers, tarp rollers and ball buckets (a late dodge is a NEAR
 * MISS), catch fly balls (the "coins"), then time a flipper tap to leap at the
 * wall: on time he robs the home run; early or late it sails over. Every
 * robbed homer hangs a banner on the wall (the "landmarks"); three of them
 * make the WALL OF FAME.
 *
 * Pure rules: deterministic from the supplied random source.
 */
import type { Random } from '../core/Random';

export const LANES = 3;
/** Seconds after a lane change during which passing the obstacle you left counts as a near miss. */
export const NEAR_MISS_WINDOW = 0.32;
/** Moment (s into the stunt phase) the car hits the kicker. */
export const STUNT_IDEAL = 0.8;
export const STUNT_AIRTIME = 1.35;

export type ObstacleKind = 'car' | 'bus' | 'cones';

export interface Obstacle {
  /** Race progress (0..1) at which the car reaches it. */
  at: number;
  /** Lanes it blocks. */
  lanes: number[];
  kind: ObstacleKind;
  passed: boolean;
  hit: boolean;
}

export interface Coin {
  at: number;
  lane: number;
  taken: boolean;
}

export type Landmark = 'billboard' | 'waterTower' | 'neonSign';
export const LANDMARKS: Landmark[] = ['billboard', 'waterTower', 'neonSign'];

export interface CityRush {
  t: number;
  progress: number;
  seconds: number;
  lane: number;
  prevLane: number;
  laneChangedAt: number;
  obstacles: Obstacle[];
  coins: Coin[];
  crashes: number;
  nearMisses: number;
  passes: number;
  coinsTaken: number;
  slow: number;
  phase: 'race' | 'stunt' | 'air' | 'done';
  stuntT: number;
  stuntWindow: number;
  stunt: 'none' | 'jump' | 'crash';
  stuntError: number;
  airT: number;
}

export type RushEvent =
  | { type: 'steer'; lane: number }
  | { type: 'pass'; index: number }
  | { type: 'nearMiss'; index: number }
  | { type: 'crash'; index: number }
  | { type: 'coin'; index: number }
  | { type: 'stuntReady' }
  | { type: 'stunt'; success: boolean; error: number }
  | { type: 'done' };

export type RushGrade = 'legendary' | 'great' | 'rough';

export interface RushConfig {
  seconds: number;
  obstacles: number;
  windowScale: number;
}

export function createRush(rng: Random, cfg: RushConfig): CityRush {
  const obstacles: Obstacle[] = [];
  const n = Math.max(1, cfg.obstacles);
  const start = 0.12;
  const end = 0.86;
  const gap = (end - start) / n;
  let lastLanes: number[] = [];
  for (let i = 0; i < n; i++) {
    const at = start + gap * i + gap * 0.25 * rng.next();
    // Wide buses only once the player is warmed up; never two buses in a row.
    const bus = i >= 2 && lastLanes.length === 1 && rng.chance(0.3);
    let lanes: number[];
    if (bus) {
      const left = rng.chance(0.5) ? 0 : 1;
      lanes = [left, left + 1];
    } else {
      // Bias toward the lane the last obstacle left open, so the run keeps weaving.
      let lane = rng.int(0, LANES - 1);
      if (lastLanes.length === 1 && lane === lastLanes[0] && rng.chance(0.6)) lane = (lane + 1 + rng.int(0, 1)) % LANES;
      lanes = [lane];
    }
    obstacles.push({ at, lanes, kind: bus ? 'bus' : rng.chance(0.25) ? 'cones' : 'car', passed: false, hit: false });
    lastLanes = lanes;
  }
  const coins: Coin[] = [];
  for (let i = 0; i < n; i++) {
    const o = obstacles[i];
    const next = obstacles[i + 1]?.at ?? end + 0.06;
    const at = (o.at + next) / 2;
    const free = [0, 1, 2].filter((l) => !o.lanes.includes(l));
    coins.push({ at, lane: rng.pick(free), taken: false });
  }
  return {
    t: 0,
    progress: 0,
    seconds: cfg.seconds,
    lane: 1,
    prevLane: 1,
    laneChangedAt: -10,
    obstacles,
    coins,
    crashes: 0,
    nearMisses: 0,
    passes: 0,
    coinsTaken: 0,
    slow: 0,
    phase: 'race',
    stuntT: 0,
    stuntWindow: 0.15 * cfg.windowScale,
    stunt: 'none',
    stuntError: 0,
    airT: 0,
  };
}

/** Flipper input. Steering during the race; any flipper is the jump during the stunt. */
export function rushInput(r: CityRush, side: 'left' | 'right'): RushEvent[] {
  if (r.phase === 'race') {
    const lane = Math.max(0, Math.min(LANES - 1, r.lane + (side === 'left' ? -1 : 1)));
    if (lane === r.lane) return [];
    r.prevLane = r.lane;
    r.lane = lane;
    r.laneChangedAt = r.t;
    return [{ type: 'steer', lane }];
  }
  if (r.phase === 'stunt' && r.stunt === 'none') return judgeStunt(r, r.stuntT - STUNT_IDEAL);
  return [];
}

function judgeStunt(r: CityRush, error: number): RushEvent[] {
  const success = Math.abs(error) <= r.stuntWindow;
  r.stunt = success ? 'jump' : 'crash';
  r.stuntError = error;
  r.phase = 'air';
  r.airT = 0;
  return [{ type: 'stunt', success, error }];
}

export function updateRush(r: CityRush, dt: number): RushEvent[] {
  const events: RushEvent[] = [];
  if (r.phase === 'done') return events;
  r.t += dt;
  if (r.phase === 'race') {
    const speed = r.slow > 0 ? 0.55 : 1;
    if (r.slow > 0) r.slow -= dt;
    const before = r.progress;
    r.progress = Math.min(1, r.progress + (dt / r.seconds) * speed);
    r.obstacles.forEach((o, index) => {
      if (o.passed || o.at > r.progress || o.at < before - 1e-9) return;
      o.passed = true;
      if (o.lanes.includes(r.lane)) {
        o.hit = true;
        r.crashes += 1;
        r.slow = 0.55;
        events.push({ type: 'crash', index });
        return;
      }
      r.passes += 1;
      events.push({ type: 'pass', index });
      if (o.lanes.includes(r.prevLane) && r.t - r.laneChangedAt <= NEAR_MISS_WINDOW) {
        r.nearMisses += 1;
        events.push({ type: 'nearMiss', index });
      }
    });
    r.coins.forEach((c, index) => {
      if (c.taken || c.at > r.progress || c.at < before - 1e-9) return;
      if (c.lane === r.lane) {
        c.taken = true;
        r.coinsTaken += 1;
        events.push({ type: 'coin', index });
      }
    });
    if (r.progress >= 1) {
      r.phase = 'stunt';
      r.stuntT = 0;
      events.push({ type: 'stuntReady' });
    }
    return events;
  }
  if (r.phase === 'stunt') {
    r.stuntT += dt;
    if (r.stunt === 'none' && r.stuntT > STUNT_IDEAL + r.stuntWindow) events.push(...judgeStunt(r, r.stuntT - STUNT_IDEAL));
    return events;
  }
  // Airtime: the landing (or the demolition) plays out, then the run ends.
  r.airT += dt;
  if (r.airT >= STUNT_AIRTIME) {
    r.phase = 'done';
    events.push({ type: 'done' });
  }
  return events;
}

export function rushGrade(r: CityRush): RushGrade {
  if (r.crashes === 0 && r.stunt === 'jump') return 'legendary';
  if (r.crashes <= 1 && (r.stunt === 'jump' || r.crashes === 0)) return 'great';
  return 'rough';
}

/** Points for a finished run (before the table multiplier). */
export function rushScore(r: CityRush, cityLevel: number): number {
  const base = 50000 + r.passes * 8000 + r.nearMisses * 15000 + r.coinsTaken * 6000;
  const stunt = r.stunt === 'jump' ? 150000 : 60000;
  const grade = rushGrade(r);
  const k = grade === 'legendary' ? 2 : grade === 'great' ? 1.4 : 1;
  return Math.round((base + stunt) * k * (1 + 0.25 * cityLevel));
}

/** Points for the no-capture city cruise (cinematics OFF). */
export const CITY_CRUISE_POINTS = 90000;
