import { describe, expect, it } from 'vitest';
import { computeBatting, contactScore, gradeFor, timingScore, type BattingInput } from '../src/baseball/batting';
import { resolveDefense } from '../src/baseball/defense';
import { Random } from '../src/core/Random';

const base: BattingInput = {
  shotQuality: 0.5,
  timing: 0.5,
  power: 0,
  combo: 0,
  lane: 'left',
  fieldBonus: false,
  multiball: false,
  hrLit: false,
  difficulty: 0.5,
  runnerOnFirst: false,
  outs: 0,
};

describe('batting quality', () => {
  it('rewards better timing, shots, power and combos monotonically', () => {
    const c0 = contactScore(base);
    expect(contactScore({ ...base, timing: 1 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, shotQuality: 1 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, power: 3 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, combo: 5 })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, fieldBonus: true })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, lane: 'homeRun' })).toBeGreaterThan(c0);
    expect(contactScore({ ...base, difficulty: 1 })).toBeLessThan(c0);
  });

  it('is bounded to [0,1]', () => {
    expect(contactScore({ ...base, timing: 0, shotQuality: 0, difficulty: 1 })).toBe(0);
    expect(contactScore({ ...base, timing: 1, shotQuality: 1, power: 3, combo: 9, fieldBonus: true, multiball: true, lane: 'homeRun', hrLit: true, difficulty: 0 })).toBeLessThanOrEqual(1);
  });

  it('grades contact', () => {
    expect(gradeFor(0.1)).toBe('weak');
    expect(gradeFor(0.6)).toBe('solid');
    expect(gradeFor(0.95)).toBe('perfect');
  });

  it('timing window scores 1 at centre and 0 outside the window', () => {
    expect(timingScore(0)).toBe(1);
    expect(timingScore(0.1)).toBeGreaterThan(0.5);
    expect(timingScore(0.3)).toBe(0);
  });

  it('weak shots never produce extra-base hits; perfect shots mostly leave the yard', () => {
    const rng = new Random(42);
    let weakHits = 0;
    for (let i = 0; i < 200; i++) {
      const r = computeBatting({ ...base, timing: 0.2, shotQuality: 0.1 }, rng);
      expect(['popOut', 'groundOut', 'single']).toContain(r.play.type);
      if (r.play.type === 'single') weakHits++;
    }
    expect(weakHits).toBeLessThan(80);
    let hr = 0;
    for (let i = 0; i < 200; i++) {
      const r = computeBatting({ ...base, timing: 1, shotQuality: 1, power: 3, combo: 5, difficulty: 0 }, rng);
      expect(['homeRun', 'triple', 'double']).toContain(r.play.type);
      if (r.play.type === 'homeRun') hr++;
    }
    expect(hr).toBeGreaterThan(120);
  });

  it('terrible timing fouls the ball off', () => {
    const r = computeBatting({ ...base, timing: 0.05 }, new Random(1));
    expect(r.play.type).toBe('foul');
    expect(r.grade).toBe('foul');
  });

  it('is deterministic for a given seed', () => {
    const a = computeBatting({ ...base, timing: 0.7 }, new Random(7));
    const b = computeBatting({ ...base, timing: 0.7 }, new Random(7));
    expect(a).toEqual(b);
  });

  it('lit home run lane raises the home run rate for great contact', () => {
    const count = (hrLit: boolean) => {
      const rng = new Random(99);
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const r = computeBatting({ ...base, timing: 0.9, shotQuality: 0.8, power: 2, hrLit, lane: 'homeRun', difficulty: 0.5 }, rng);
        if (r.play.type === 'homeRun') n++;
      }
      return n;
    };
    expect(count(true)).toBeGreaterThan(count(false));
  });
});

describe('defense resolution', () => {
  it('strong defense makes outs, weak defense gives up hits', () => {
    const rng = new Random(3);
    let outs = 0;
    for (let i = 0; i < 100; i++) {
      const r = resolveDefense({ defenseRating: 1, inning: 1, difficulty: 0.3, runnerOnFirst: false, outs: 0 }, rng);
      if (['groundOut', 'flyOut', 'popOut', 'strikeout'].includes(r.play.type)) outs++;
    }
    expect(outs).toBeGreaterThan(85);
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      const r = resolveDefense({ defenseRating: 0, inning: 1, difficulty: 1, runnerOnFirst: false, outs: 0 }, rng);
      if (['single', 'double', 'triple', 'homeRun'].includes(r.play.type)) hits++;
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
