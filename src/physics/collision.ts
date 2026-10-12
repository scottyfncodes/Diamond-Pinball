import { dot, len2, sub, type Vec2 } from './Vec2';

export interface SweepHit {
  /** Time of impact in [0, 1] as a fraction of the sweep. */
  t: number;
  normal: Vec2;
  point: Vec2;
}

const EPS = 1e-7;

/** Ray (p + d*t, t in [0,1]) against a circle of radius R around c. Returns earliest t or -1. */
export function rayCircle(p: Vec2, d: Vec2, c: Vec2, R: number): number {
  const m = sub(p, c);
  const a = len2(d);
  const b = 2 * dot(m, d);
  const cc = len2(m) - R * R;
  if (cc <= 0) {
    // Already overlapping: collide now only if moving towards the center.
    return b < 0 ? 0 : -1;
  }
  if (a < EPS) return -1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return -1;
  return t;
}

/**
 * Sweep a circle (center p, radius r) moving by displacement d against a static
 * circle (center c, radius R).
 */
export function sweepCircleCircle(p: Vec2, d: Vec2, r: number, c: Vec2, R: number): SweepHit | null {
  const t = rayCircle(p, d, c, r + R);
  if (t < 0) return null;
  const hitPos = { x: p.x + d.x * t, y: p.y + d.y * t };
  const nx = hitPos.x - c.x;
  const ny = hitPos.y - c.y;
  const l = Math.hypot(nx, ny) || 1;
  const normal = { x: nx / l, y: ny / l };
  return { t, normal, point: { x: c.x + normal.x * R, y: c.y + normal.y * R } };
}

/**
 * Sweep a circle (center p, radius r, displacement d) against segment a-b.
 * `oneWay` restricts collisions to balls approaching from the side the
 * left-hand normal of (a -> b) points to.
 */
export function sweepCircleSegment(
  p: Vec2,
  d: Vec2,
  r: number,
  a: Vec2,
  b: Vec2,
  oneWay = false,
): SweepHit | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const el2 = ex * ex + ey * ey;
  if (el2 < EPS) return sweepCircleCircle(p, d, r, a, 0);
  const el = Math.sqrt(el2);
  // Left-hand normal of a -> b.
  const nx = -ey / el;
  const ny = ex / el;
  const s0 = (p.x - a.x) * nx + (p.y - a.y) * ny; // signed distance from the line
  const vn = d.x * nx + d.y * ny; // displacement along the normal

  let best: SweepHit | null = null;

  if (oneWay && s0 < -EPS) {
    // Behind a one-way segment: passes freely.
    return null;
  }

  // Flat face test.
  if (Math.abs(vn) > EPS) {
    const side = s0 >= 0 ? 1 : -1;
    let t: number;
    if (Math.abs(s0) < r) {
      // Already within the slab: resolve now if moving into the surface.
      t = vn * side < 0 ? 0 : -1;
    } else {
      t = (side * r - s0) / vn; // reach distance side*r along the normal
      if (vn * side >= 0) t = -1; // moving away from the line
    }
    if (t >= 0 && t <= 1) {
      const qx = p.x + d.x * t;
      const qy = p.y + d.y * t;
      const u = ((qx - a.x) * ex + (qy - a.y) * ey) / el2;
      if (u >= 0 && u <= 1) {
        best = {
          t,
          normal: { x: nx * side, y: ny * side },
          point: { x: a.x + ex * u, y: a.y + ey * u },
        };
      }
    }
  }

  // Endpoint tests (rounded ends).
  const ha = sweepCircleCircle(p, d, r, a, 0);
  if (ha && (!best || ha.t < best.t)) {
    if (!oneWay || ha.normal.x * nx + ha.normal.y * ny > -0.2) best = ha;
  }
  const hb = sweepCircleCircle(p, d, r, b, 0);
  if (hb && (!best || hb.t < best.t)) {
    if (!oneWay || hb.normal.x * nx + hb.normal.y * ny > -0.2) best = hb;
  }
  return best;
}

/** Closest point on segment a-b to point p. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; u: number } {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const el2 = ex * ex + ey * ey;
  if (el2 < EPS) return { point: { x: a.x, y: a.y }, u: 0 };
  let u = ((p.x - a.x) * ex + (p.y - a.y) * ey) / el2;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return { point: { x: a.x + ex * u, y: a.y + ey * u }, u };
}

/** True when segment p1-p2 crosses segment a-b (proper or touching). */
export function segmentsIntersect(p1: Vec2, p2: Vec2, a: Vec2, b: Vec2): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = b.x - a.x;
  const d2y = b.y - a.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return false;
  const t = ((a.x - p1.x) * d2y - (a.y - p1.y) * d2x) / denom;
  const u = ((a.x - p1.x) * d1y - (a.y - p1.y) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Where segment p1-p2 crosses segment a-b, as a parameter along a-b (0 at a,
 * 1 at b). Returns -1 when they do not cross.
 */
export function segmentCrossParam(p1: Vec2, p2: Vec2, a: Vec2, b: Vec2): number {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = b.x - a.x;
  const d2y = b.y - a.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return -1;
  const t = ((a.x - p1.x) * d2y - (a.y - p1.y) * d2x) / denom;
  const u = ((a.x - p1.x) * d1y - (a.y - p1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return -1;
  return u;
}
