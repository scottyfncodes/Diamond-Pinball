import { describe, expect, it } from 'vitest';
import { computeBatting, contactScore, gradeFor, launchFor, sprayFor, sweetSpotFor, timingLabelFor, timingScore, type BattingInput } from '../src/baseball/batting';
import { resolveDefense } from '../src/baseball/defense';
import { choosePitch } from '../src/baseball/pitching';
import { Random } from '../src/core/Random';

const base: BattingInput = {
  shotQuality: 0.5,
  timing: 0.5,
  timingOffset: 0,
  sweetSpot: 0.5,
  spray: 0,
  power: 0,
  combo: 0,
  lane: 'left',
  fieldBonus: false,
  multiball: false,
  hrLit: false,
  clutch: false,
  rally: false,
  difficulty: 0.5,
  runnerOnFirst: false,
  outs: 0,
};

describe('batting quality', () => {
  it('rewards better timing, shots, barrel, power, combos and situations monotonically', () => {
    const c0 = contactScore(base);
    expect(contactScore({ ...base, timing: 1 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, shotQuality: 1 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, sweetSpot: 1 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, power: 3 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, combo: 5 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, fieldBonus: true })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, lane: 'homeRun' })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, clutch: true })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, rally: true })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, difficulty: 1 })).toBeLessThan(c0);
  });

  it('is bounded to [0,1]', () => {
    expect(contactScore({ ...base, timing: 0, shotQuality: 0, sweetSpot: 0, difficulty: 1 })).toBe(0);
    expect(contactScore({ ...base, timing: 1, shotQuality: 1, sweetSpot: 1, power: 3, combo: 9, fieldBonus: true, multiball: true, lane: 'homeRun', hrLit: true, clutch: true, rally: true, difficulty: 0 })).toBe(1);
  });

  it('grades contact, and perfect requires on-time timing', () => {
    expect(gradeFor(0.1)).toBe('weak');
    expect(gradeFor(0.6)).toBe('solid');
    expect(gradeFor(0.95, 0)).toBe('perfect');
    expect(gradeFor(0.95, 0.6)).toBe('solid');
  });

  it('timing window scores 1 at centre and 0 outside the window', () => {
    expect(timingScore(0)).toBe(1);
    expect(timingScore(0.1)).toBeGreaterThan(0.5);
    expect(timingScore(0.3)).toBe(0);
    expect(timingLabelFor(0.1)).toBe('PERFECT');
    expect(timingLabelFor(-0.7)).toBe('EARLY');
    expect(timingLabelFor(0.7)).toBe('LATE');
  });

  it('launch type follows swing timing: early grounders, barrel flies, late pop-ups', () => {
    expect(launchFor(-0.8, false)).toBe('ground');
    expect(launchFor(-0.35, false)).toBe('line');
    expect(launchFor(0, false)).toBe('fly');
    expect(launchFor(0.4, false)).toBe('line');
    expect(launchFor(0.95, false)).toBe('pop');
    // Charged power widens the barrel window.
    expect(launchFor(-0.25, false)).toBe('line');
    expect(launchFor(-0.25, true)).toBe('fly');
  });

  it('spray comes from the ramp, the entry angle and the swing timing', () => {
    expect(sprayFor('left', 0, 0)).toBeLessThan(-0.33);
    expect(sprayFor('right', 0, 0)).toBeGreaterThan(0.33);
    expect(sprayFor('center', 0, 0)).toBe(0);
    expect(sprayFor('left', 0.3, 0)).toBeGreaterThan(sprayFor('left', -0.3, 0));
    expect(sprayFor('center', 0, -0.8)).toBeLessThan(0);
    expect(sprayFor('center', 0, 0.8)).toBeGreaterThan(0);
  });

  it('sweet spot is highest for centred ramp entries', () => {
    expect(sweetSpotFor(0.5)).toBe(1);
    expect(sweetSpotFor(0.25)).toBeGreaterThan(sweetSpotFor(0.05));
    expect(sweetSpotFor(0)).toBe(0);
  });

  it('weak, early contact never produces extra-base hits; perfect barrels mostly leave the yard', () => {
    const rng = new Random(42);
    for (let i = 0; i < 200; i++) {
      const r = computeBatting({ ...base, timing: 0.2, timingOffset: -0.9, shotQuality: 0.1 }, rng);
      expect(['popOut', 'groundOut', 'single', 'error']).toContain(r.play.type);
      expect(r.trajectory).toBe('ground');
    }
    let hr = 0;
    for (let i = 0; i < 200; i++) {
      const r = computeBatting({ ...base, timing: 1, timingOffset: 0, shotQuality: 1, sweetSpot: 1, power: 3, combo: 5, difficulty: 0 }, rng);
      expect(['homeRun', 'triple', 'double']).toContain(r.play.type);
      if (r.play.type === 'homeRun') hr++;
      expect(r.grade).toBe('perfect');
    }
    expect(hr).toBeGreaterThan(190);
  });

  it('solid but unpowered barrels are doubles off the wall, not home runs', () => {
    const rng = new Random(9);
    for (let i = 0; i < 50; i++) {
      const r = computeBatting({ ...base, timing: 1, timingOffset: 0, shotQuality: 0.7, sweetSpot: 0.7 }, rng);
      expect(r.play.type).toBe('double');
    }
  });

  it('a wildly mistimed swing fouls the ball off', () => {
    const r = computeBatting({ ...base, timingOffset: 1.3, timing: 0 }, new Random(1));
    expect(r.play.type).toBe('foul');
    expect(r.grade).toBe('foul');
    expect(r.reason).toMatch(/late/i);
  });

  it('is deterministic for a given seed and explains its factors', () => {
    const a = computeBatting({ ...base, timing: 0.7, timingOffset: 0.3 }, new Random(7));
    const b = computeBatting({ ...base, timing: 0.7, timingOffset: 0.3 }, new Random(7));
    expect(a).toEqual(b);
    expect(a.factors.timing).toBeCloseTo(0.34 * 0.7, 5);
    expect(a.reason.length).toBeGreaterThan(5);
  });

  it('a lit home run lane turns near-misses into home runs', () => {
    const count = (hrLit: boolean) => {
      const rng = new Random(99);
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const r = computeBatting({ ...base, timing: 0.9, timingOffset: 0.1, shotQuality: 0.5, power: 1, hrLit, lane: 'homeRun' }, rng);
        if (r.play.type === 'homeRun') n++;
      }
      return n;
    };
    expect(count(true)).toBeGreaterThan(count(false) + 50);
  });
});

describe('pitching', () => {
  it('announces a pitch with a speed, a delay and a window', () => {
    const rng = new Random(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = choosePitch(rng, 0.5, 1);
      seen.add(p.type);
      expect(p.delay).toBeGreaterThan(0.7);
      expect(p.delay).toBeLessThan(1.6);
      expect(p.window).toBeGreaterThan(0.1);
      expect(p.mph).toBeGreaterThan(70);
    }
    expect(seen.size).toBe(4);
  });

  it('fastballs arrive sooner than changeups and harder difficulty tightens the window', () => {
    const fast = [...Array(200)].map((_, i) => choosePitch(new Random(i + 1), 0.5, 1)).filter((p) => p.type === 'fastball')[0];
    const change = [...Array(200)].map((_, i) => choosePitch(new Random(i + 1), 0.5, 1)).filter((p) => p.type === 'changeup')[0];
    expect(fast.delay).toBeLessThan(change.delay);
    const easy = choosePitch(new Random(5), 0, 1);
    const hard = choosePitch(new Random(5), 1, 1);
    if (easy.type === hard.type) expect(hard.window).toBeLessThan(easy.window);
  });
});

describe('defense resolution', () => {
  it('strong defense makes outs, weak defense gives up hits', () => {
    const rng = new Random(3);
    let outs = 0;
    for (let i = 0; i < 100; i++) {
      const r = resolveDefense({ defenseRating: 1, inning: 1, difficulty: 0.3, runnerOnFirst: false, outs: 0 }, rng);
      if (['groundOut', 'flyOut', 'popOut', 'strikeout'].includes(r.play.type)) outs++;
      expect(typeof r.sprayDeg).toBe('number');
    }
    expect(outs).toBeGreaterThan(85);
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      const r = resolveDefense({ defenseRating: 0, inning: 1, difficulty: 1, runnerOnFirst: false, outs: 0 }, rng);
      if (['single', 'double', 'triple', 'homeRun', 'error'].includes(r.play.type)) hits++;
    }
    expect(hits).toBeGreaterThan(70);
  });

  it('can turn a double play with a runner on first', () => {
    const rng = new Random(5);
    let dp = 0;
    for (let i = 0; i < 100; i++) {
      const r = resolveDefense({ defenseRating: 1, inning: 1, difficulty: 0, runnerOnFirst: true, outs: 0 }, rng);
      if (r.play.type === 'groundOut' && r.play.doublePlay) dp++;
    }
    expect(dp).toBeGreaterThan(20);
  });
});
