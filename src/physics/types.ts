import type { Vec2 } from './Vec2';

export type ColliderKind = 'wall' | 'post' | 'bumper' | 'slingshot' | 'target' | 'gate' | 'rubber';

export interface ColliderBase {
  id: string;
  kind: ColliderKind;
  /** Coefficient of restitution applied on impact (0..1). */
  restitution: number;
  /** Extra outward speed injected along the contact normal (bumpers, slingshots). */
  kick: number;
  /** Disabled colliders are ignored by the solver (dropped drop-targets, open gates). */
  enabled: boolean;
  /** Minimum impact speed required before a `hit` event is emitted for this collider. */
  minEventSpeed: number;
}

export interface SegmentCollider extends ColliderBase {
  type: 'segment';
  a: Vec2;
  b: Vec2;
  /**
   * One-way segments collide only with balls approaching from the side the
   * left-hand normal of (a -> b) points to. Used for gates and ramp lips.
   */
  oneWay: boolean;
}

export interface CircleCollider extends ColliderBase {
  type: 'circle';
  center: Vec2;
  radius: number;
}

export type Collider = SegmentCollider | CircleCollider;

export interface SensorShapeCircle {
  type: 'circle';
  center: Vec2;
  radius: number;
}
export interface SensorShapeSegment {
  type: 'segment';
  a: Vec2;
  b: Vec2;
}

export interface Sensor {
  id: string;
  shape: SensorShapeCircle | SensorShapeSegment;
  /** If present, the ball must be travelling roughly along this direction to trigger. */
  direction?: Vec2;
  minSpeed: number;
  enabled: boolean;
}

export interface RampPoint {
  x: number;
  y: number;
  /** Height above the playfield (visual + used to modulate guided speed). */
  h: number;
}

export interface RampDef {
  id: string;
  /** Entrance segment; the ball must cross it travelling along `direction`. */
  entrance: { a: Vec2; b: Vec2 };
  direction: Vec2;
  /** Minimum speed to climb the ramp. Slower balls roll back out. */
  minSpeed: number;
  /** Speed used to normalise shot quality to 1.0. */
  fullSpeed: number;
  path: RampPoint[];
  /** Exit velocity multiplier applied to the guided speed when the ball drops out. */
  exitSpeed: number;
  exitDirection: Vec2;
  enabled: boolean;
}

export interface Flipper {
  id: string;
  side: 'left' | 'right';
  pivot: Vec2;
  length: number;
  /** Capsule radius at the base and the tip. */
  baseRadius: number;
  tipRadius: number;
  restAngle: number;
  activeAngle: number;
  angle: number;
  angularVelocity: number;
  active: boolean;
  omegaUp: number;
  omegaDown: number;
  restitution: number;
}

export type BallState = 'launcher' | 'free' | 'guided' | 'held' | 'locked' | 'drained';

export interface Ball {
  id: number;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  /** Visual height above the playfield (ramps / saucer kick). */
  height: number;
  state: BallState;
  age: number;
  spin: number;
  guide: { ramp: RampDef; s: number; speed: number; entrySpeed: number } | null;
  hold: { timer: number; releaseVel: Vec2; releasePos: Vec2 } | null;
  /** Stuck detection bookkeeping. */
  stuckTimer: number;
  stuckAnchor: Vec2;
  stuckChecks: number;
  stuckNudges: number;
  stuckOrigin: Vec2;
  lastFlipperContact: number;
  lastFlipperBoost: number;
  /** Set when a ball was created during multiball; drains without costing a life. */
  extra: boolean;
  lastHitId: string;
  lastHitTime: number;
}

export type PhysicsEvent =
  | {
      type: 'hit';
      ball: Ball;
      colliderId: string;
      kind: ColliderKind;
      speed: number;
      normal: Vec2;
      point: Vec2;
    }
  | { type: 'flipperHit'; ball: Ball; flipperId: string; speed: number; point: Vec2 }
  | { type: 'sensor'; ball: Ball; sensorId: string; speed: number }
  | {
      type: 'rampEnter';
      ball: Ball;
      rampId: string;
      speed: number;
      quality: number;
      /** Where the ball crossed the ramp mouth: 0 = left edge, 0.5 = dead centre, 1 = right edge. */
      offset: number;
      /** Signed angle (radians) between the ball's path and the ramp axis; positive = heading right. */
      angle: number;
    }
  | { type: 'rampExit'; ball: Ball; rampId: string }
  | { type: 'drain'; ball: Ball }
  | { type: 'ballBall'; a: Ball; b: Ball; speed: number }
  | { type: 'stuckRecovered'; ball: Ball; method: 'nudge' | 'relaunch' }
  | { type: 'launched'; ball: Ball; power: number }
  | { type: 'released'; ball: Ball; from: 'hold' | 'lock' };
