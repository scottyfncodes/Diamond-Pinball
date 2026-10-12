import {
  closestPointOnSegment,
  segmentsIntersect,
  sweepCircleCircle,
  sweepCircleSegment,
  type SweepHit,
} from './collision';
import { add, dist, dot, len, normalize, scale, sub, type Vec2 } from './Vec2';
import type {
  Ball,
  CircleCollider,
  Collider,
  Flipper,
  PhysicsEvent,
  RampDef,
  SegmentCollider,
  Sensor,
} from './types';

export interface WorldConfig {
  gravity: number;
  /** Fixed sub-step length in seconds. */
  substep: number;
  maxSpeed: number;
  ballRadius: number;
  /** Constant rolling deceleration (units/s^2). */
  rollingFriction: number;
  /** Proportional air/felt drag per second. */
  linearDrag: number;
  /** Launch position for new balls. */
  launchPos: Vec2;
  /** y below which a ball counts as drained. */
  drainY: number;
  /** World bounds used to recover escaped balls. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  gravity: 52,
  substep: 1 / 240,
  maxSpeed: 240,
  ballRadius: 0.5,
  rollingFriction: 1.2,
  linearDrag: 0.06,
  launchPos: { x: 21.1, y: 2.4 },
  drainY: -1.5,
  bounds: { minX: -2, maxX: 24, minY: -4, maxY: 48 },
};

let nextBallId = 1;

/**
 * Deterministic 2D pinball world. The playfield is modelled on the plane of
 * the table (x across, y up the table). Gravity pulls towards -y, i.e. down
 * the slope. Collision detection is continuous (swept) so the ball never
 * tunnels through thin walls or fast flippers.
 */
export class World {
  readonly config: WorldConfig;
  readonly colliders = new Map<string, Collider>();
  readonly sensors = new Map<string, Sensor>();
  readonly flippers = new Map<string, Flipper>();
  readonly ramps = new Map<string, RampDef>();
  readonly balls: Ball[] = [];
  readonly events: PhysicsEvent[] = [];
  time = 0;
  private accumulator = 0;
  private sensorInside = new Map<string, Set<number>>();
  private colliderList: Collider[] = [];
  private dirty = true;

  constructor(config: Partial<WorldConfig> = {}) {
    this.config = { ...DEFAULT_WORLD_CONFIG, ...config };
  }

  // ---------------------------------------------------------------- setup

  addSegment(
    id: string,
    a: Vec2,
    b: Vec2,
    opts: Partial<Omit<SegmentCollider, 'type' | 'id' | 'a' | 'b'>> = {},
  ): SegmentCollider {
    const seg: SegmentCollider = {
      type: 'segment',
      id,
      a: { ...a },
      b: { ...b },
      kind: opts.kind ?? 'wall',
      restitution: opts.restitution ?? 0.45,
      kick: opts.kick ?? 0,
      enabled: opts.enabled ?? true,
      oneWay: opts.oneWay ?? false,
      minEventSpeed: opts.minEventSpeed ?? 6,
    };
    this.colliders.set(id, seg);
    this.dirty = true;
    return seg;
  }

  /** Adds a chain of wall segments through the given points. */
  addPolyline(idPrefix: string, points: Vec2[], opts: Partial<Omit<SegmentCollider, 'type' | 'id' | 'a' | 'b'>> = {}): void {
    for (let i = 0; i < points.length - 1; i++) {
      this.addSegment(`${idPrefix}_${i}`, points[i], points[i + 1], opts);
    }
  }

  addCircle(
    id: string,
    center: Vec2,
    radius: number,
    opts: Partial<Omit<CircleCollider, 'type' | 'id' | 'center' | 'radius'>> = {},
  ): CircleCollider {
    const c: CircleCollider = {
      type: 'circle',
      id,
      center: { ...center },
      radius,
      kind: opts.kind ?? 'post',
      restitution: opts.restitution ?? 0.7,
      kick: opts.kick ?? 0,
      enabled: opts.enabled ?? true,
      minEventSpeed: opts.minEventSpeed ?? 6,
    };
    this.colliders.set(id, c);
    this.dirty = true;
    return c;
  }

  addSensor(sensor: Omit<Sensor, 'enabled' | 'minSpeed'> & Partial<Pick<Sensor, 'enabled' | 'minSpeed'>>): Sensor {
    const s: Sensor = { enabled: true, minSpeed: 0, ...sensor };
    this.sensors.set(s.id, s);
    this.sensorInside.set(s.id, new Set());
    return s;
  }

  addFlipper(f: Omit<Flipper, 'angle' | 'angularVelocity' | 'active'>): Flipper {
    const flipper: Flipper = { ...f, angle: f.restAngle, angularVelocity: 0, active: false };
    this.flippers.set(f.id, flipper);
    return flipper;
  }

  addRamp(ramp: Omit<RampDef, 'enabled'> & Partial<Pick<RampDef, 'enabled'>>): RampDef {
    const r: RampDef = { enabled: true, ...ramp };
    this.ramps.set(r.id, r);
    return r;
  }

  setColliderEnabled(id: string, enabled: boolean): void {
    const c = this.colliders.get(id);
    if (c) c.enabled = enabled;
  }

  setFlipper(id: string, active: boolean): void {
    const f = this.flippers.get(id);
    if (f) f.active = active;
  }

  // ---------------------------------------------------------------- balls

  createBall(pos: Vec2, vel: Vec2 = { x: 0, y: 0 }, state: Ball['state'] = 'free', extra = false): Ball {
    const ball: Ball = {
      id: nextBallId++,
      pos: { ...pos },
      vel: { ...vel },
      radius: this.config.ballRadius,
      height: 0,
      state,
      age: 0,
      spin: 0,
      guide: null,
      hold: null,
      stuckTimer: 0,
      stuckAnchor: { ...pos },
      stuckChecks: 0,
      stuckNudges: 0,
      stuckOrigin: { ...pos },
      lastFlipperContact: -10,
      lastFlipperBoost: -10,
      extra,
      lastHitId: '',
      lastHitTime: -10,
    };
    this.balls.push(ball);
    return ball;
  }

  /** Places a fresh ball on the plunger. */
  createLauncherBall(extra = false): Ball {
    return this.createBall(this.config.launchPos, { x: 0, y: 0 }, 'launcher', extra);
  }

  launch(ball: Ball, power: number): void {
    if (ball.state !== 'launcher') return;
    const p = Math.max(0.15, Math.min(1, power));
    ball.state = 'free';
    ball.vel = { x: 0, y: 95 + 95 * p };
    ball.stuckTimer = 0;
    ball.stuckAnchor = { ...ball.pos };
    this.events.push({ type: 'launched', ball, power: p });
  }

  removeBall(ball: Ball): void {
    const i = this.balls.indexOf(ball);
    if (i >= 0) this.balls.splice(i, 1);
    for (const set of this.sensorInside.values()) set.delete(ball.id);
  }

  /** Holds a ball in place (saucer / lock) and releases it after `seconds`. */
  holdBall(ball: Ball, at: Vec2, seconds: number, releaseVel: Vec2, releasePos: Vec2 = at): void {
    ball.state = 'held';
    ball.pos = { ...at };
    ball.vel = { x: 0, y: 0 };
    ball.hold = { timer: seconds, releaseVel: { ...releaseVel }, releasePos: { ...releasePos } };
  }

  lockBall(ball: Ball, at: Vec2): void {
    ball.state = 'locked';
    ball.pos = { ...at };
    ball.vel = { x: 0, y: 0 };
    ball.hold = null;
  }

  releaseLocked(ball: Ball, pos: Vec2, vel: Vec2): void {
    if (ball.state !== 'locked') return;
    ball.state = 'free';
    ball.pos = { ...pos };
    ball.vel = { ...vel };
    ball.stuckTimer = 0;
    ball.stuckAnchor = { ...pos };
    this.events.push({ type: 'released', ball, from: 'lock' });
  }

  /** Pulls a ball out of any special state and drops it at the plunger. */
  resetBallToLauncher(ball: Ball): void {
    ball.state = 'launcher';
    ball.pos = { ...this.config.launchPos };
    ball.vel = { x: 0, y: 0 };
    ball.height = 0;
    ball.guide = null;
    ball.hold = null;
    ball.stuckTimer = 0;
    ball.stuckChecks = 0;
    ball.stuckNudges = 0;
    ball.stuckAnchor = { ...ball.pos };
    ball.stuckOrigin = { ...ball.pos };
  }

  /** Clears balls, re-enables every collider and resets flippers for a new game. */
  reset(): void {
    this.balls.length = 0;
    for (const set of this.sensorInside.values()) set.clear();
    for (const c of this.colliders.values()) c.enabled = true;
    for (const f of this.flippers.values()) {
      f.active = false;
      f.angle = f.restAngle;
      f.angularVelocity = 0;
    }
    this.accumulator = 0;
    this.events.length = 0;
  }

  get activeBallCount(): number {
    return this.balls.filter((b) => b.state !== 'drained').length;
  }

  // ---------------------------------------------------------------- stepping

  /** Advances the world by `dt` seconds using fixed sub-steps. */
  step(dt: number): PhysicsEvent[] {
    this.events.length = 0;
    if (this.dirty) {
      this.colliderList = Array.from(this.colliders.values());
      this.dirty = false;
    }
    const h = this.config.substep;
    this.accumulator += Math.min(dt, 1 / 20);
    while (this.accumulator >= h) {
      this.accumulator -= h;
      this.substep(h);
      this.time += h;
    }
    return this.events;
  }

  private substep(h: number): void {
    for (const f of this.flippers.values()) this.updateFlipper(f, h);
    for (const ball of this.balls) {
      ball.age += h;
      switch (ball.state) {
        case 'free':
          this.stepFreeBall(ball, h);
          break;
        case 'guided':
          this.stepGuidedBall(ball, h);
          break;
        case 'held':
          this.stepHeldBall(ball, h);
          break;
        default:
          break;
      }
    }
    this.resolveBallBall();
  }

  private updateFlipper(f: Flipper, h: number): void {
    const target = f.active ? f.activeAngle : f.restAngle;
    const omega = f.active ? f.omegaUp : f.omegaDown;
    const delta = target - f.angle;
    if (Math.abs(delta) < 1e-4) {
      f.angularVelocity = 0;
      f.angle = target;
      return;
    }
    const step = Math.sign(delta) * omega * h;
    if (Math.abs(step) >= Math.abs(delta)) {
      f.angularVelocity = delta / h;
      f.angle = target;
    } else {
      f.angularVelocity = Math.sign(delta) * omega;
      f.angle += step;
    }
  }

  flipperTip(f: Flipper): Vec2 {
    return { x: f.pivot.x + Math.cos(f.angle) * f.length, y: f.pivot.y + Math.sin(f.angle) * f.length };
  }

  private stepFreeBall(ball: Ball, h: number): void {
    const cfg = this.config;
    // Gravity + drag.
    ball.vel.y -= cfg.gravity * h;
    const speed = len(ball.vel);
    if (speed > 0) {
      let newSpeed = speed - cfg.rollingFriction * h - speed * cfg.linearDrag * h;
      if (newSpeed < 0) newSpeed = 0;
      if (newSpeed > cfg.maxSpeed) newSpeed = cfg.maxSpeed;
      const k = newSpeed / speed;
      ball.vel.x *= k;
      ball.vel.y *= k;
    }

    // Depenetrate from flippers that may have swung into the ball.
    for (const f of this.flippers.values()) this.depenetrateFlipper(ball, f);

    let remaining = 1; // fraction of the substep left
    const start = { x: ball.pos.x, y: ball.pos.y };
    for (let iter = 0; iter < 8 && remaining > 1e-6; iter++) {
      const d = { x: ball.vel.x * h * remaining, y: ball.vel.y * h * remaining };
      if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) break;
      let best: SweepHit | null = null;
      let bestCollider: Collider | null = null;
      let bestFlipper: Flipper | null = null;

      for (const c of this.colliderList) {
        if (!c.enabled) continue;
        const hit =
          c.type === 'segment'
            ? sweepCircleSegment(ball.pos, d, ball.radius, c.a, c.b, c.oneWay)
            : sweepCircleCircle(ball.pos, d, ball.radius, c.center, c.radius);
        if (hit && (!best || hit.t < best.t)) {
          best = hit;
          bestCollider = c;
          bestFlipper = null;
        }
      }
      for (const f of this.flippers.values()) {
        const tip = this.flipperTip(f);
        const r = (f.baseRadius + f.tipRadius) * 0.5;
        const hit = sweepCircleSegment(ball.pos, d, ball.radius + r, f.pivot, tip, false);
        if (hit && (!best || hit.t < best.t)) {
          best = hit;
          bestCollider = null;
          bestFlipper = f;
        }
      }

      if (!best) {
        ball.pos.x += d.x;
        ball.pos.y += d.y;
        remaining = 0;
        break;
      }

      // Move to the time of impact (slightly short to avoid re-penetration).
      const t = Math.max(0, best.t - 1e-4);
      ball.pos.x += d.x * t;
      ball.pos.y += d.y * t;
      remaining *= 1 - best.t;

      if (bestFlipper) {
        this.respondFlipper(ball, bestFlipper, best);
      } else if (bestCollider) {
        this.respondCollider(ball, bestCollider, best);
      }
    }

    this.checkSensors(ball, start, ball.pos, h);
    this.checkRamps(ball, start, ball.pos);
    this.checkDrainAndBounds(ball);
    this.checkStuck(ball, h);
    ball.spin = len(ball.vel) / ball.radius;
  }

  private respondCollider(ball: Ball, c: Collider, hit: SweepHit): void {
    const n = hit.normal;
    const vn = dot(ball.vel, n);
    const impactSpeed = -vn;
    if (vn < 0) {
      const e = c.restitution;
      // Reflect the normal component, keep (slightly damped) tangential component.
      const tx = ball.vel.x - vn * n.x;
      const ty = ball.vel.y - vn * n.y;
      const tangentDamp = c.kind === 'wall' ? 0.985 : 0.97;
      ball.vel.x = tx * tangentDamp - vn * e * n.x;
      ball.vel.y = ty * tangentDamp - vn * e * n.y;
      if (c.kick > 0) {
        // Active elements (bumpers, slingshots) fire the ball away hard.
        const outSpeed = Math.max(len(ball.vel), c.kick);
        const dir = normalize(add(scale(n, 1), scale(normalize(ball.vel), 0.35)));
        ball.vel.x = dir.x * outSpeed;
        ball.vel.y = dir.y * outSpeed;
      }
    }
    // Nudge off the surface.
    ball.pos.x += n.x * 1e-3;
    ball.pos.y += n.y * 1e-3;
    if (impactSpeed >= c.minEventSpeed) {
      // Debounce repeated hits on the same collider (resting contact).
      if (!(c.id === ball.lastHitId && this.time - ball.lastHitTime < 0.08)) {
        this.events.push({ type: 'hit', ball, colliderId: c.id, kind: c.kind, speed: impactSpeed, normal: n, point: hit.point });
      }
      ball.lastHitId = c.id;
      ball.lastHitTime = this.time;
    }
  }

  private flipperSurfaceVelocity(f: Flipper, point: Vec2): Vec2 {
    const r = sub(point, f.pivot);
    return { x: -r.y * f.angularVelocity, y: r.x * f.angularVelocity };
  }

  private respondFlipper(ball: Ball, f: Flipper, hit: SweepHit): void {
    const n = hit.normal;
    const vs = this.flipperSurfaceVelocity(f, hit.point);
    const rel = sub(ball.vel, vs);
    const vn = dot(rel, n);
    ball.lastFlipperContact = this.time;
    if (vn < 0) {
      const e = f.restitution;
      const j = -(1 + e) * vn;
      ball.vel.x += n.x * j;
      ball.vel.y += n.y * j;
      // Flipper strikes add a little extra energy so shots feel punchy
      // (once per swing, so a ball squeezed between flippers cannot gain energy forever).
      if (Math.abs(f.angularVelocity) > 1 && this.time - ball.lastFlipperBoost > 0.12) {
        ball.lastFlipperBoost = this.time;
        const boost = Math.min(len(vs) * 0.25, 30);
        ball.vel.x += n.x * boost;
        ball.vel.y += n.y * boost;
      }
      const speed = len(ball.vel);
      if (speed > this.config.maxSpeed) {
        const k = this.config.maxSpeed / speed;
        ball.vel.x *= k;
        ball.vel.y *= k;
      }
      if (-vn > 15 || Math.abs(f.angularVelocity) > 1) {
        this.events.push({ type: 'flipperHit', ball, flipperId: f.id, speed: len(ball.vel), point: hit.point });
      }
    }
    ball.pos.x += n.x * 2e-3;
    ball.pos.y += n.y * 2e-3;
  }

  private depenetrateFlipper(ball: Ball, f: Flipper): void {
    const tip = this.flipperTip(f);
    const r = (f.baseRadius + f.tipRadius) * 0.5 + ball.radius;
    const { point } = closestPointOnSegment(ball.pos, f.pivot, tip);
    const d = sub(ball.pos, point);
    const l = len(d);
    if (l < r - 1e-4) {
      const n = l > 1e-6 ? scale(d, 1 / l) : { x: 0, y: 1 };
      const push = r - l;
      ball.pos.x += n.x * push;
      ball.pos.y += n.y * push;
      const vs = this.flipperSurfaceVelocity(f, point);
      const rel = sub(ball.vel, vs);
      const vn = dot(rel, n);
      if (vn < 0) {
        ball.vel.x -= n.x * vn * 1.4;
        ball.vel.y -= n.y * vn * 1.4;
        if (Math.abs(f.angularVelocity) > 1 && vn < -5 && this.time - ball.lastFlipperBoost > 0.12) {
          ball.lastFlipperBoost = this.time;
          this.events.push({ type: 'flipperHit', ball, flipperId: f.id, speed: len(ball.vel), point });
        }
      }
      ball.lastFlipperContact = this.time;
    }
  }

  private checkSensors(ball: Ball, from: Vec2, to: Vec2, _h: number): void {
    const speed = len(ball.vel);
    for (const s of this.sensors.values()) {
      if (!s.enabled) continue;
      const inside = this.sensorInside.get(s.id)!;
      let triggered = false;
      if (s.shape.type === 'circle') {
        const within = dist(to, s.shape.center) <= s.shape.radius + ball.radius * 0.25;
        if (within && !inside.has(ball.id)) {
          inside.add(ball.id);
          triggered = true;
        } else if (!within) {
          inside.delete(ball.id);
        }
      } else {
        if (segmentsIntersect(from, to, s.shape.a, s.shape.b)) {
          if (!inside.has(ball.id)) {
            inside.add(ball.id);
            triggered = true;
          }
        } else if (inside.has(ball.id) && dist(to, closestPointOnSegment(to, s.shape.a, s.shape.b).point) > ball.radius * 1.5) {
          inside.delete(ball.id);
        }
      }
      if (!triggered) continue;
      if (speed < s.minSpeed) continue;
      if (s.direction && dot(normalize(ball.vel), s.direction) < 0.25) continue;
      this.events.push({ type: 'sensor', ball, sensorId: s.id, speed });
    }
  }

  private checkRamps(ball: Ball, from: Vec2, to: Vec2): void {
    if (ball.state !== 'free') return;
    for (const ramp of this.ramps.values()) {
      if (!ramp.enabled) continue;
      if (!segmentsIntersect(from, to, ramp.entrance.a, ramp.entrance.b)) continue;
      const speed = len(ball.vel);
      const along = dot(normalize(ball.vel), ramp.direction);
      if (along < 0.3) continue;
      if (speed * along < ramp.minSpeed) continue; // too slow: rolls back out
      const quality = Math.min(1, Math.max(0, (speed * along - ramp.minSpeed) / (ramp.fullSpeed - ramp.minSpeed)));
      ball.state = 'guided';
      ball.guide = { ramp, s: 0, speed: Math.max(30, speed * along * 0.85), entrySpeed: speed };
      ball.pos = { x: ramp.path[0].x, y: ramp.path[0].y };
      ball.height = ramp.path[0].h;
      ball.vel = { x: 0, y: 0 };
      this.events.push({ type: 'rampEnter', ball, rampId: ramp.id, speed, quality });
      return;
    }
  }

  private stepGuidedBall(ball: Ball, h: number): void {
    const g = ball.guide!;
    const path = g.ramp.path;
    // Find current segment by walking cumulative lengths.
    let s = g.s + g.speed * h;
    let acc = 0;
    let segIndex = -1;
    let segStart = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const l = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
      if (s <= acc + l) {
        segIndex = i;
        segStart = acc;
        break;
      }
      acc += l;
    }
    if (segIndex < 0) {
      // Exit the ramp.
      const last = path[path.length - 1];
      ball.state = 'free';
      ball.guide = null;
      ball.pos = { x: last.x, y: last.y };
      ball.height = last.h;
      const dir = normalize(g.ramp.exitDirection);
      const v = Math.max(20, g.speed * g.ramp.exitSpeed);
      ball.vel = { x: dir.x * v, y: dir.y * v };
      ball.stuckTimer = 0;
      ball.stuckAnchor = { ...ball.pos };
      this.events.push({ type: 'rampExit', ball, rampId: g.ramp.id });
      return;
    }
    const a = path[segIndex];
    const b = path[segIndex + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
    const u = (s - segStart) / l;
    ball.pos = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    ball.height = a.h + (b.h - a.h) * u;
    // Ramps convert kinetic energy into height on the way up and back on the way down.
    const slope = (b.h - a.h) / l;
    g.speed = Math.max(28, Math.min(this.config.maxSpeed, g.speed - slope * this.config.gravity * 0.9 * h - g.speed * 0.05 * h));
    g.s = s;
    ball.vel = { x: ((b.x - a.x) / l) * g.speed, y: ((b.y - a.y) / l) * g.speed };
    ball.spin = g.speed / ball.radius;
  }

  private stepHeldBall(ball: Ball, h: number): void {
    const hold = ball.hold!;
    hold.timer -= h;
    ball.height = Math.max(0, ball.height - 4 * h);
    if (hold.timer <= 0) {
      ball.state = 'free';
      ball.pos = { ...hold.releasePos };
      ball.vel = { ...hold.releaseVel };
      ball.hold = null;
      ball.stuckTimer = 0;
      ball.stuckAnchor = { ...ball.pos };
      for (const set of this.sensorInside.values()) set.delete(ball.id);
      this.events.push({ type: 'released', ball, from: 'hold' });
    }
  }

  private checkDrainAndBounds(ball: Ball): void {
    const { bounds, drainY } = this.config;
    if (ball.pos.y < drainY) {
      ball.state = 'drained';
      this.events.push({ type: 'drain', ball });
      return;
    }
    if (ball.pos.x < bounds.minX || ball.pos.x > bounds.maxX || ball.pos.y > bounds.maxY || ball.pos.y < bounds.minY) {
      // Escaped the table somehow: recover instead of losing the ball.
      this.resetBallToLauncher(ball);
      this.events.push({ type: 'stuckRecovered', ball, method: 'relaunch' });
    }
  }

  private checkStuck(ball: Ball, h: number): void {
    ball.stuckTimer += h;
    if (ball.stuckTimer < 0.75) return;
    ball.stuckTimer = 0;
    const moved = dist(ball.pos, ball.stuckAnchor);
    ball.stuckAnchor = { ...ball.pos };
    const nearFlipper = this.time - ball.lastFlipperContact < 1.0;
    if (moved < 0.35 && !nearFlipper && ball.pos.y > 1) {
      ball.stuckChecks++;
      if (ball.stuckChecks >= 4) {
        // ~3 s without progress: kick the ball free. After repeated failures relaunch it.
        ball.stuckChecks = 0;
        if (ball.stuckNudges === 0) ball.stuckOrigin = { ...ball.pos };
        ball.stuckNudges++;
        if (ball.stuckNudges > 3) {
          this.resetBallToLauncher(ball);
          ball.stuckNudges = 0;
          this.events.push({ type: 'stuckRecovered', ball, method: 'relaunch' });
        } else {
          const angle = ((ball.stuckNudges * 2.399) % (Math.PI * 2)) - Math.PI;
          ball.vel.x += Math.cos(angle) * 22;
          ball.vel.y += Math.abs(Math.sin(angle)) * 26 + 10;
          this.events.push({ type: 'stuckRecovered', ball, method: 'nudge' });
        }
      }
    } else {
      ball.stuckChecks = 0;
      // Real progress (or a flipper touch) clears the escalation.
      if (nearFlipper || dist(ball.pos, ball.stuckOrigin) > 4) ball.stuckNudges = 0;
    }
  }

  private resolveBallBall(): void {
    const free = this.balls.filter((b) => b.state === 'free');
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i];
        const b = free[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        const minD = a.radius + b.radius;
        if (d >= minD || d < 1e-6) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (minD - d) / 2;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
        const rvx = b.vel.x - a.vel.x;
        const rvy = b.vel.y - a.vel.y;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const e = 0.85;
          const jn = (-(1 + e) * vn) / 2;
          a.vel.x -= nx * jn;
          a.vel.y -= ny * jn;
          b.vel.x += nx * jn;
          b.vel.y += ny * jn;
          if (-vn > 8) this.events.push({ type: 'ballBall', a, b, speed: -vn });
        }
      }
    }
  }
}
