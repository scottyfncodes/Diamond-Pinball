import { describe, expect, it } from 'vitest';
import { Random } from '../src/core/Random';
import { createRush, rushGrade, rushInput, rushScore, STUNT_IDEAL, updateRush, type CityRush } from '../src/attractions/cityRush';
import {
  addCharge,
  completeOverload,
  createReactor,
  overloadJackpot,
  overloadOutcome,
  PULSES,
  pitchPath,
  ringNeed,
  stage,
  startOverload,
  tapOverload,
  updateOverload,
} from '../src/attractions/reactor';

const cfg = { seconds: 7, obstacles: 8, windowScale: 1 };

/** Drives a race with a simple autopilot: always steer into a lane that is free at the next obstacle. */
const autopilot = (r: CityRush, dt = 1 / 60) => {
  const next = r.obstacles.find((o) => !o.passed);
  if (next && next.lanes.includes(r.lane) && next.at - r.progress < 0.05) {
    const free = [0, 1, 2].filter((l) => !next.lanes.includes(l));
    const target = free.sort((a, b) => Math.abs(a - r.lane) - Math.abs(b - r.lane))[0];
    rushInput(r, target < r.lane ? 'left' : 'right');
  }
  return updateRush(r, dt);
};

describe('CITY RUSH', () => {
  it('is deterministic for a seed and every obstacle leaves a free lane', () => {
    const a = createRush(new Random(5), cfg);
    const b = createRush(new Random(5), cfg);
    expect(a.obstacles).toEqual(b.obstacles);
    expect(a.obstacles).toHaveLength(8);
    for (const o of a.obstacles) expect(o.lanes.length).toBeLessThan(3);
    for (let i = 1; i < a.obstacles.length; i++) expect(a.obstacles[i].at).toBeGreaterThan(a.obstacles[i - 1].at);
  });

  it('player input decides the outcome: steering clear beats sitting still', () => {
    for (let seed = 1; seed < 12; seed++) {
      const idle = createRush(new Random(seed), cfg);
      while (idle.phase === 'race') updateRush(idle, 1 / 60);
      const driven = createRush(new Random(seed), cfg);
      while (driven.phase === 'race') autopilot(driven);
      expect(driven.crashes).toBe(0);
      expect(driven.crashes).toBeLessThanOrEqual(idle.crashes);
    }
  });

  it('a late dodge is a near miss; staying in the lane is a crash', () => {
    const r = createRush(new Random(3), cfg);
    const first = r.obstacles[0];
    r.lane = first.lanes[0];
    r.prevLane = r.lane;
    // Run to just before the obstacle, then dodge.
    while (r.progress < first.at - 0.02) updateRush(r, 1 / 120);
    rushInput(r, r.lane === 0 ? 'right' : 'left');
    while (!first.passed) updateRush(r, 1 / 120);
    expect(first.hit).toBe(false);
    expect(r.nearMisses).toBe(1);
  });

  it('the stunt is a timed tap: on time jumps to the roof, otherwise demolition', () => {
    const run = (tapAt: number | null) => {
      const r = createRush(new Random(9), cfg);
      while (r.phase === 'race') autopilot(r);
      const events: string[] = [];
      while (r.phase !== 'done') {
        if (tapAt !== null && r.phase === 'stunt' && r.stuntT >= tapAt) rushInput(r, 'left');
        for (const e of updateRush(r, 1 / 120)) events.push(e.type);
      }
      return { r, events };
    };
    const perfect = run(STUNT_IDEAL);
    expect(perfect.r.stunt).toBe('jump');
    expect(rushGrade(perfect.r)).toBe('legendary');
    const early = run(0.2);
    expect(early.r.stunt).toBe('crash');
    const none = run(null);
    expect(none.r.stunt).toBe('crash');
    expect(none.events).toContain('done');
    expect(rushScore(perfect.r, 0)).toBeGreaterThan(rushScore(none.r, 0));
  });

  it('harder difficulty narrows the stunt window', () => {
    const easy = createRush(new Random(1), { ...cfg, windowScale: 1.5 });
    const hard = createRush(new Random(1), { ...cfg, windowScale: 0.7 });
    expect(hard.stuntWindow).toBeLessThan(easy.stuntWindow);
  });
});

describe('THE HEATER (reactor rules)', () => {
  it('charges three rings in order, then opens the core exactly once', () => {
    const s = createReactor();
    const need = ringNeed(s, 1);
    const events = addCharge(s, need * 1.5, 1);
    expect(events.filter((e) => e.type === 'ring')).toEqual([{ type: 'ring', ring: 0 }]);
    expect(stage(s)).toBe(1);
    expect(s.charge[1]).toBeCloseTo(0.5);
    const more = addCharge(s, need * 10, 1);
    expect(more.filter((e) => e.type === 'ready')).toHaveLength(1);
    expect(s.ready).toBe(true);
    expect(addCharge(s, 5, 1)).toEqual([]);
  });

  it('difficulty and reactor level raise the charge requirement', () => {
    const s = createReactor();
    expect(ringNeed(s, 1.3)).toBeGreaterThan(ringNeed(s, 0.7));
    const base = ringNeed(s, 1);
    s.level = 2;
    expect(ringNeed(s, 1)).toBeGreaterThan(base);
  });

  it('throws five pitches: one waste pitch among 2-4, a changeup, a curveball and a 100 mph heater to finish', () => {
    for (let seed = 1; seed < 40; seed++) {
      const o = startOverload(createReactor(), 1, seed);
      const kinds = o.pulses.map((p) => p.kind);
      expect(kinds).toHaveLength(PULSES);
      expect(kinds.filter((k) => k === 'ball')).toHaveLength(1);
      expect(kinds.indexOf('ball')).toBeGreaterThanOrEqual(1);
      expect(kinds.indexOf('ball')).toBeLessThanOrEqual(3);
      expect(kinds[0]).toBe('fastball');
      expect(kinds[4]).toBe('heater');
      expect(o.pulses[4].mph).toBe(100);
      expect(o.pulses[4].lap).toBeLessThan(o.pulses[0].lap);
    }
  });

  it('the same seed always throws the same sequence', () => {
    const a = startOverload(createReactor(), 1, 1234).pulses.map((p) => `${p.kind}:${p.side}`);
    const b = startOverload(createReactor(), 1, 1234).pulses.map((p) => `${p.kind}:${p.side}`);
    expect(a).toEqual(b);
  });

  it('a dead-on swing on the right side is a homer, close is a hit, the wrong side whiffs', () => {
    const play = (side: (p: { side: 'left' | 'right' }) => 'left' | 'right', offset: number) => {
      const s = createReactor();
      const o = startOverload(s, 1, 99);
      const p = o.pulses[0];
      o.t = p.at + offset;
      return tapOverload(s, side(p))[0];
    };
    const o = startOverload(createReactor(), 1, 99);
    expect(play((p) => p.side, 0)).toMatchObject({ type: 'pulse', result: 'homer', hit: true });
    expect(play((p) => p.side, o.window * 0.8)).toMatchObject({ result: 'hit', hit: true });
    expect(play((p) => (p.side === 'left' ? 'right' : 'left'), 0)).toMatchObject({ result: 'whiff', hit: false });
    expect(play((p) => p.side, o.window * 1.6)).toMatchObject({ result: 'whiff', hit: false });
  });

  it('taking the waste pitch wins it, chasing it loses; a watched strike is called', () => {
    const s = createReactor();
    const o = startOverload(s, 1, 5);
    const results: string[] = [];
    let done = false;
    while (!done) {
      for (const e of updateOverload(s, 1 / 120)) {
        if (e.type === 'pulse') results.push(e.result);
        if (e.type === 'done') done = true;
      }
    }
    const waste = o.pulses.findIndex((p) => p.kind === 'ball');
    results.forEach((r, i) => expect(r).toBe(i === waste ? 'take' : 'looking'));
    expect(o.syncs).toBe(1);
    const s2 = createReactor();
    const o2 = startOverload(s2, 1, 5);
    const ball = o2.pulses.find((p) => p.kind === 'ball')!;
    o2.t = ball.at;
    expect(tapOverload(s2, ball.side)[0]).toMatchObject({ result: 'chase', hit: false });
  });

  it('a perfect showdown (every pitch won) is a meltdown; thresholds still pick the outcome', () => {
    const s = createReactor();
    const o = startOverload(s, 1, 17);
    let done = false;
    while (!done) {
      const next = o.pulses.find((p) => !p.judged);
      if (next && next.kind !== 'ball' && o.t >= next.at) tapOverload(s, next.side);
      for (const e of updateOverload(s, 1 / 240)) if (e.type === 'done') done = true;
    }
    expect(o.syncs).toBe(PULSES);
    expect(o.homers).toBe(PULSES - 1);
    expect(overloadOutcome(o.syncs, 2)).toBe('meltdown');
    expect(overloadOutcome(3, 2)).toBe('overload');
    expect(overloadOutcome(1, 2)).toBe('fizzle');
  });

  it('curveballs start toward the wrong half and break to their side; waste pitches finish outside the plate', () => {
    const o = startOverload(createReactor(), 1, 3);
    const curve = o.pulses.find((p) => p.kind === 'curveball');
    if (curve) {
      const early = pitchPath(curve, curve.at - curve.lap * 0.5).x;
      const end = pitchPath(curve, curve.at).x;
      expect(Math.sign(early)).toBe(-Math.sign(end));
      expect(Math.sign(end)).toBe(curve.side === 'left' ? -1 : 1);
    }
    const ball = o.pulses.find((p) => p.kind === 'ball')!;
    expect(Math.abs(pitchPath(ball, ball.at).x)).toBeGreaterThan(1);
    const strike = o.pulses.find((p) => p.kind === 'fastball')!;
    expect(Math.abs(pitchPath(strike, strike.at).x)).toBeLessThan(1);
  });

  it('every pitch gets its own flight with a breather before the next one', () => {
    const o = startOverload(createReactor(), 1);
    expect(o.pulses[0].at - o.pulses[0].lap).toBeGreaterThan(0.5);
    for (let i = 1; i < o.pulses.length; i++) {
      const release = o.pulses[i].at - o.pulses[i].lap;
      expect(release - (o.pulses[i - 1].at + o.window)).toBeGreaterThan(0.5);
    }
  });

  it('nervous swings between pitches are ignored', () => {
    const s = createReactor();
    const o = startOverload(s, 1);
    o.t = 0.1;
    expect(tapOverload(s, 'left')).toEqual([]);
    expect(tapOverload(s, 'right')).toEqual([]);
  });

  it('jackpot grows with syncs and level; completing resets and levels up', () => {
    expect(overloadJackpot(5, 0)).toBeGreaterThan(overloadJackpot(2, 0));
    expect(overloadJackpot(2, 1)).toBeGreaterThan(overloadJackpot(2, 0));
    expect(overloadJackpot(3, 0, 2)).toBeGreaterThan(overloadJackpot(3, 0, 0));
    const s = createReactor();
    addCharge(s, 1000, 1);
    startOverload(s, 1);
    completeOverload(s);
    expect(s.ready).toBe(false);
    expect(s.level).toBe(1);
    expect(s.charge).toEqual([0, 0, 0]);
    expect(s.overload).toBeNull();
  });
});
