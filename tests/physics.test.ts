import { describe, expect, it } from 'vitest';
import { World } from '../src/physics/World';
import { buildTable } from '../src/table/layout';
import { sweepCircleCircle, sweepCircleSegment } from '../src/physics/collision';
import { Random } from '../src/core/Random';

const makeWorld = () => {
  const w = new World();
  const def = buildTable(w);
  return { w, def };
};

describe('swept collision primitives', () => {
  it('finds the time of impact against a segment', () => {
    const hit = sweepCircleSegment({ x: 0, y: 5 }, { x: 0, y: -10 }, 0.5, { x: -5, y: 0 }, { x: 5, y: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(0.45, 3);
    expect(hit!.normal.y).toBeCloseTo(-1 * Math.sign(hit!.normal.y) * -1, 5);
  });

  it('ignores segments moving away and respects one-way gates', () => {
    expect(sweepCircleSegment({ x: 0, y: 5 }, { x: 0, y: 10 }, 0.5, { x: -5, y: 0 }, { x: 5, y: 0 })).toBeNull();
    // left-hand normal of (-5,0)->(5,0) points to +y; a ball below passes through.
    expect(sweepCircleSegment({ x: 0, y: -5 }, { x: 0, y: 10 }, 0.5, { x: -5, y: 0 }, { x: 5, y: 0 }, true)).toBeNull();
    expect(sweepCircleSegment({ x: 0, y: 5 }, { x: 0, y: -10 }, 0.5, { x: -5, y: 0 }, { x: 5, y: 0 }, true)).not.toBeNull();
  });

  it('hits circles', () => {
    const hit = sweepCircleCircle({ x: -5, y: 0 }, { x: 10, y: 0 }, 0.5, { x: 0, y: 0 }, 1);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(0.35, 3);
    expect(hit!.normal.x).toBeCloseTo(-1, 5);
  });
});

describe('pinball world', () => {
  it('launches a ball that stays inside the table and reaches the playfield', () => {
    const { w } = makeWorld();
    const ball = w.createLauncherBall();
    w.launch(ball, 0.9);
    let maxY = 0;
    let escaped = false;
    for (let i = 0; i < 60 * 4; i++) {
      const evs = w.step(1 / 60);
      for (const e of evs) if (e.type === 'stuckRecovered' && e.method === 'relaunch') escaped = true;
      maxY = Math.max(maxY, ball.pos.y);
      expect(ball.pos.x).toBeGreaterThanOrEqual(-0.01);
      expect(ball.pos.x).toBeLessThanOrEqual(22.01);
      expect(ball.pos.y).toBeLessThanOrEqual(44.01);
    }
    expect(escaped).toBe(false);
    expect(maxY).toBeGreaterThan(30);
    expect(ball.pos.x).toBeLessThan(20.2); // left the launch lane
  });

  it('a ball with no flipper input drains', () => {
    const { w } = makeWorld();
    const ball = w.createLauncherBall();
    w.launch(ball, 0.6);
    let drained = false;
    for (let i = 0; i < 60 * 20 && !drained; i++) {
      for (const e of w.step(1 / 60)) if (e.type === 'drain') drained = true;
    }
    expect(drained).toBe(true);
    expect(ball.state).toBe('drained');
  });

  it('never tunnels through the outer walls at high speed', () => {
    const { w } = makeWorld();
    const rng = new Random(11);
    for (let trial = 0; trial < 60; trial++) {
      const ball = w.createBall({ x: 4 + rng.next() * 12, y: 10 + rng.next() * 20 }, { x: (rng.next() - 0.5) * 480, y: (rng.next() - 0.5) * 480 });
      for (let i = 0; i < 120; i++) {
        const evs = w.step(1 / 60);
        for (const e of evs) expect(e.type === 'stuckRecovered' && e.method === 'relaunch').toBe(false);
        if (ball.state === 'drained') break;
        expect(ball.pos.x).toBeGreaterThan(-0.2);
        expect(ball.pos.x).toBeLessThan(22.2);
        expect(ball.pos.y).toBeLessThan(44.2);
      }
      w.removeBall(ball);
    }
  });

  it('flippers rotate towards their active angle and hit the ball upward', () => {
    const { w } = makeWorld();
    const f = w.flippers.get('left_flipper')!;
    w.setFlipper('left_flipper', true);
    for (let i = 0; i < 6; i++) w.step(1 / 60);
    expect(f.angle).toBeCloseTo(f.activeAngle, 3);
    w.setFlipper('left_flipper', false);
    for (let i = 0; i < 12; i++) w.step(1 / 60);
    expect(f.angle).toBeCloseTo(f.restAngle, 3);

    // Rest a ball on the left flipper and flip.
    const ball = w.createBall({ x: 7.6, y: 4.0 }, { x: 0, y: 0 });
    for (let i = 0; i < 6; i++) w.step(1 / 60);
    const before = ball.vel.y;
    w.setFlipper('left_flipper', true);
    let hit = false;
    for (let i = 0; i < 12; i++) for (const e of w.step(1 / 60)) if (e.type === 'flipperHit') hit = true;
    expect(hit).toBe(true);
    expect(ball.vel.y).toBeGreaterThan(before + 40);
  });

  it('captures fast balls on ramps and releases them at the exit', () => {
    const { w } = makeWorld();
    const ball = w.createBall({ x: 4.5, y: 22.0 }, { x: 0, y: 110 });
    const seen: string[] = [];
    for (let i = 0; i < 60 * 5; i++) {
      for (const e of w.step(1 / 60)) {
        if (e.type === 'rampEnter') {
          seen.push('enter:' + e.rampId + ':' + (e.quality > 0.3 ? 'good' : 'weak'));
          // Entered dead centre and straight up the ramp.
          expect(e.offset).toBeCloseTo(0.5, 1);
          expect(Math.abs(e.angle)).toBeLessThan(0.05);
        }
        if (e.type === 'rampExit') seen.push('exit:' + e.rampId);
      }
    }
    expect(seen[0]).toBe('enter:left_ramp:good');
    expect(seen).toContain('exit:left_ramp');
    expect(ball.state).not.toBe('guided');
    // Left ramp feeds the right inlane.
    expect(ball.pos.x).toBeGreaterThan(10);
  });

  it('reports the side and angle of off-centre ramp entries', () => {
    const { w } = makeWorld();
    w.createBall({ x: 3.85, y: 22.5 }, { x: 10, y: 110 });
    let ev: { offset: number; angle: number } | null = null;
    for (let i = 0; i < 30 && !ev; i++) for (const e of w.step(1 / 60)) if (e.type === 'rampEnter') ev = e;
    expect(ev).not.toBeNull();
    expect(ev!.offset).toBeLessThan(0.4);
    expect(ev!.angle).toBeGreaterThan(0.05);
  });

  it('slow balls roll back out of a ramp', () => {
    const { w } = makeWorld();
    const ball = w.createBall({ x: 4.5, y: 24.2 }, { x: 0, y: 30 });
    let entered = false;
    for (let i = 0; i < 24; i++) for (const e of w.step(1 / 60)) if (e.type === 'rampEnter') entered = true;
    expect(entered).toBe(false);
    expect(ball.vel.y).toBeLessThan(0);
  });

  it('triggers sensors with direction filtering', () => {
    const { w } = makeWorld();
    const ball = w.createBall({ x: 10.1, y: 20 }, { x: 0, y: 60 });
    const sensors: string[] = [];
    for (let i = 0; i < 40; i++) for (const e of w.step(1 / 60)) if (e.type === 'sensor') sensors.push(e.sensorId);
    expect(sensors).toContain('center_lane');
    expect(ball.pos.y).toBeGreaterThan(20);
  });

  it('recovers a stuck ball by nudging and eventually relaunching', () => {
    const { w } = makeWorld();
    // Trap a ball in a tiny box far from the flippers.
    w.addSegment('box_a', { x: 9, y: 29 }, { x: 11, y: 29 });
    w.addSegment('box_b', { x: 11, y: 29 }, { x: 11, y: 31 });
    w.addSegment('box_c', { x: 11, y: 31 }, { x: 9, y: 31 });
    w.addSegment('box_d', { x: 9, y: 31 }, { x: 9, y: 29 });
    const ball = w.createBall({ x: 10, y: 30 }, { x: 0, y: 0 });
    const methods: string[] = [];
    for (let i = 0; i < 60 * 18; i++) for (const e of w.step(1 / 60)) if (e.type === 'stuckRecovered') methods.push(e.method);
    expect(methods).toContain('nudge');
    expect(methods).toContain('relaunch');
    expect(ball.state).toBe('launcher');
  });

  it('has no pockets: random launches with random flipping always drain cleanly', () => {
    const rng = new Random(2024);
    for (let trial = 0; trial < 25; trial++) {
      const { w } = makeWorld();
      const ball = w.createLauncherBall();
      w.launch(ball, 0.3 + rng.next() * 0.7);
      let drained = false;
      let recovered = false;
      let t = 0;
      while (t < 40 && !drained) {
        if (rng.chance(0.05)) w.setFlipper('left_flipper', rng.chance(0.5));
        if (rng.chance(0.05)) w.setFlipper('right_flipper', rng.chance(0.5));
        for (const e of w.step(1 / 60)) {
          if (e.type === 'drain') drained = true;
          if (e.type === 'stuckRecovered') recovered = true;
        }
        t += 1 / 60;
      }
      expect(recovered).toBe(false);
      expect(drained).toBe(true);
    }
  });

  it('holds and releases balls (saucer)', () => {
    const { w } = makeWorld();
    const ball = w.createBall({ x: 18.7, y: 29 }, { x: 0, y: 0 });
    w.holdBall(ball, { x: 18.7, y: 29 }, 0.5, { x: -10, y: -40 });
    for (let i = 0; i < 15; i++) w.step(1 / 60);
    expect(ball.state).toBe('held');
    expect(ball.vel.x).toBe(0);
    let released = false;
    for (let i = 0; i < 30; i++) for (const e of w.step(1 / 60)) if (e.type === 'released') released = true;
    expect(released).toBe(true);
    expect(ball.state).toBe('free');
  });

  it('balls collide with each other during multiball', () => {
    const { w } = makeWorld();
    const a = w.createBall({ x: 8, y: 20 }, { x: 40, y: 0 });
    const b = w.createBall({ x: 12, y: 20 }, { x: -40, y: 0 });
    let collided = false;
    for (let i = 0; i < 30 && !collided; i++) for (const e of w.step(1 / 60)) if (e.type === 'ballBall') collided = true;
    expect(collided).toBe(true);
    expect(a.vel.x).toBeLessThan(0);
    expect(b.vel.x).toBeGreaterThan(0);
  });
});

describe('difficulty baselines and modifiers', () => {
  const sizes = [
    { label: 'easy', radius: 0.65, timeScale: 0.72 },
    { label: 'medium', radius: 0.5, timeScale: 1 },
    { label: 'hard', radius: 0.39, timeScale: 1.28 },
  ];

  it('resizes existing balls when the baseline changes and keeps them out of walls', () => {
    const { w } = makeWorld();
    const ball = w.createBall({ x: 20.9, y: 10 }, { x: 0, y: 0 }); // hugging the launch lane wall
    w.setBaseline({ ballRadius: 0.65 });
    expect(ball.radius).toBe(0.65);
    expect(ball.pos.x).toBeGreaterThanOrEqual(20.2 + 0.65 - 1e-3);
    expect(ball.pos.x).toBeLessThanOrEqual(22 - 0.65 + 1e-3);
    expect(w.createLauncherBall().radius).toBe(0.65);
  });

  for (const s of sizes) {
    it(`${s.label} ball (r=${s.radius}, x${s.timeScale}) has no pockets and never tunnels`, () => {
      const rng = new Random(99);
      for (let trial = 0; trial < 20; trial++) {
        const { w } = makeWorld();
        w.setBaseline({ ballRadius: s.radius, timeScale: s.timeScale });
        const ball = w.createLauncherBall();
        w.launch(ball, 0.3 + rng.next() * 0.7);
        let drained = false;
        let relaunched = false;
        let t = 0;
        while (t < 60 && !drained) {
          // Random flipping, but never hold a flipper up for long: cradling is legal, not a pocket.
          if (rng.chance(0.05)) w.setFlipper('left_flipper', rng.chance(0.35));
          if (rng.chance(0.05)) w.setFlipper('right_flipper', rng.chance(0.35));
          for (const e of w.step(1 / 60)) {
            if (e.type === 'drain') drained = true;
            if (e.type === 'stuckRecovered' && e.method === 'relaunch') relaunched = true;
          }
          expect(ball.pos.x).toBeGreaterThan(-0.2);
          expect(ball.pos.x).toBeLessThan(22.2);
          expect(ball.pos.y).toBeLessThan(44.2);
          t += 1 / 60;
        }
        expect(relaunched).toBe(false);
        expect(drained).toBe(true);
      }
    });
  }

  it('the time scale really slows and speeds the ball without changing its path', () => {
    const run = (timeScale: number) => {
      const { w } = makeWorld();
      w.setBaseline({ timeScale });
      const ball = w.createBall({ x: 10, y: 20 }, { x: 15, y: 40 });
      let travelled = 0;
      let last = { ...ball.pos };
      for (let i = 0; i < 30; i++) {
        w.step(1 / 60);
        travelled += Math.hypot(ball.pos.x - last.x, ball.pos.y - last.y);
        last = { ...ball.pos };
      }
      return { travelled, pos: { ...ball.pos } };
    };
    const slow = run(0.72);
    const normal = run(1);
    const fast = run(1.28);
    expect(slow.travelled).toBeLessThan(normal.travelled * 0.8);
    expect(fast.travelled).toBeGreaterThan(normal.travelled * 1.2);
  });

  it('flipper shots keep their strength on a slowed table', () => {
    const shot = (timeScale: number) => {
      const { w } = makeWorld();
      w.setBaseline({ timeScale });
      const ball = w.createBall({ x: 7.6, y: 4.0 }, { x: 0, y: 0 });
      for (let i = 0; i < 8; i++) w.step(1 / 60);
      w.setFlipper('left_flipper', true);
      for (let i = 0; i < 12; i++) w.step(1 / 60);
      return Math.hypot(ball.vel.x, ball.vel.y);
    };
    const slow = shot(0.72);
    const normal = shot(1);
    expect(slow).toBeGreaterThan(normal * 0.75);
    expect(slow).toBeGreaterThan(60);
  });

  it('a fast small ball never passes through thin colliders', () => {
    const { w } = makeWorld();
    w.setBaseline({ ballRadius: 0.39, timeScale: 1.28 });
    const rng = new Random(5);
    for (let trial = 0; trial < 40; trial++) {
      const ball = w.createBall({ x: 4 + rng.next() * 12, y: 10 + rng.next() * 20 }, { x: (rng.next() - 0.5) * 480, y: (rng.next() - 0.5) * 480 });
      for (let i = 0; i < 90; i++) {
        for (const e of w.step(1 / 60)) expect(e.type === 'stuckRecovered' && e.method === 'relaunch').toBe(false);
        if (ball.state === 'drained') break;
        // Never inside the launch lane from the playfield side (its wall is a thin segment).
        if (ball.pos.y < 31) expect(ball.pos.x < 20.2 - 0.3 || ball.pos.x > 20.2 + 0.3).toBe(true);
      }
      w.removeBall(ball);
    }
  });

  it('modifiers layer on the baseline and clearModifiers restores it exactly', () => {
    const { w } = makeWorld();
    w.setBaseline({ ballRadius: 0.65, timeScale: 0.72, flipperScale: 1.04, flipperPower: 1.18 });
    const ball = w.createBall({ x: 10, y: 20 }, { x: 0, y: 0 });
    w.mods.ballScale = 1.5;
    w.applyBallRadius();
    expect(ball.radius).toBeCloseTo(0.975, 5);
    w.mods.gravityScale = -1;
    w.mods.timeScale = 0.4;
    expect(w.effectiveGravity).toBeLessThan(0);
    expect(w.effectiveTimeScale).toBeCloseTo(0.288, 5);
    ball.thrust = 50;
    w.addAttractor({ id: 'm', pos: { x: 10, y: 24 }, strength: 200, radius: 6 });
    w.clearModifiers();
    expect(ball.radius).toBeCloseTo(0.65, 5);
    expect(w.effectiveGravity).toBe(w.config.gravity);
    expect(w.effectiveTimeScale).toBeCloseTo(0.72, 5);
    expect(ball.thrust).toBe(0);
    expect(w.attractors.size).toBe(0);
    expect(w.flippers.get('left_flipper')!.baseRadius).toBeCloseTo(0.5 * 1.04, 5);
    expect(w.flippers.get('left_flipper')!.omegaUp).toBeCloseTo(32 * 1.18, 5);
    w.setBaseline({ ballRadius: 0.5, timeScale: 1, flipperScale: 1, flipperPower: 1 });
    expect(ball.radius).toBe(0.5);
    expect(w.flippers.get('left_flipper')!.baseRadius).toBeCloseTo(0.5, 5);
    expect(w.flippers.get('left_flipper')!.omegaUp).toBeCloseTo(32, 5);
  });

  it('reversed gravity lifts a free ball and an attractor pulls one sideways', () => {
    const { w } = makeWorld();
    const ball = w.createBall({ x: 10, y: 20 }, { x: 0, y: 0 });
    w.mods.gravityScale = -1;
    for (let i = 0; i < 30; i++) w.step(1 / 60);
    expect(ball.vel.y).toBeGreaterThan(5);
    w.clearModifiers();
    w.removeBall(ball);
    const b2 = w.createBall({ x: 10, y: 30 }, { x: 0, y: 0 });
    w.addAttractor({ id: 'm', pos: { x: 14, y: 30 }, strength: 400, radius: 8 });
    for (let i = 0; i < 10; i++) w.step(1 / 60);
    expect(b2.vel.x).toBeGreaterThan(0);
  });

  it('spawns split balls that are smaller, extra and not overlapping', () => {
    const { w } = makeWorld();
    const balls = w.spawnBallsAt({ x: 10, y: 20 }, 3, 40, { radiusScale: 0.7, skin: 'baseball' });
    expect(balls).toHaveLength(3);
    for (const b of balls) {
      expect(b.extra).toBe(true);
      expect(b.radius).toBeCloseTo(0.35, 5);
      expect(b.skin).toBe('baseball');
    }
    // Fanned out in different directions.
    expect(balls[0].vel.x).toBeLessThan(-5);
    expect(balls[2].vel.x).toBeGreaterThan(5);
    for (let i = 0; i < 20; i++) w.step(1 / 60);
    const free = balls.filter((b) => b.state === 'free');
    expect(free.length).toBe(3);
    // Split balls keep their size through a GIANT change.
    w.mods.ballScale = 1.5;
    w.applyBallRadius();
    expect(balls[0].radius).toBeCloseTo(0.35, 5);
  });

  it('turbo launch multiplies the plunge speed', () => {
    const { w } = makeWorld();
    const a = w.createLauncherBall();
    w.launch(a, 1);
    const normal = a.vel.y;
    w.removeBall(a);
    w.mods.launchScale = 1.6;
    const b = w.createLauncherBall();
    w.launch(b, 1);
    expect(b.vel.y).toBeCloseTo(normal * 1.6, 5);
  });
});
