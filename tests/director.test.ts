import { describe, expect, it } from 'vitest';
import { DIVE_BUDGET, DIVE_WINDOW, Director, SHOTS } from '../src/game/director';

const safe = { liveBalls: 0 };
const live = { liveBalls: 1 };

describe('camera director', () => {
  it('starts a dive only when no ball is free on the table', () => {
    const d = new Director();
    expect(d.request('atBat', live)).toBe('rejected');
    expect(d.lastRejection).toBe('unsafe');
    expect(d.request('atBat', safe)).toBe('started');
    expect(d.diving).toBe(true);
  });

  it('aborts a dive the moment a ball becomes free', () => {
    const d = new Director();
    d.request('city', safe);
    d.drain();
    d.update(0.1, live);
    const events = d.drain();
    expect(events).toEqual([expect.objectContaining({ type: 'end', reason: 'unsafe' })]);
    expect(d.active).toBeNull();
  });

  it('non-dive shots (multiball pull-back) run with live balls', () => {
    const d = new Director();
    expect(d.request('multiball', { liveBalls: 3 })).toBe('started');
    d.update(0.5, { liveBalls: 3 });
    expect(d.isActive('multiball')).toBe(true);
  });

  it('higher priority preempts, lower priority is rejected, essential shots queue', () => {
    const d = new Director();
    d.request('atBat', safe);
    expect(d.request('homeRun', safe)).toBe('started');
    expect(d.drain().map((e) => e.type)).toEqual(['start', 'end', 'start']);
    expect(d.request('atBat', safe)).toBe('rejected');
    expect(d.lastRejection).toBe('busy');
    d.end('homeRun');
    d.request('reactor', safe);
    expect(d.request('city', safe)).toBe('queued');
    d.end('reactor');
    d.update(0.01, safe);
    expect(d.isActive('city')).toBe(true);
  });

  it('merges duplicate requests instead of stacking them', () => {
    const d = new Director();
    d.request('city', safe);
    d.update(5, safe);
    expect(d.request('city', safe)).toBe('merged');
    expect(d.active!.t).toBe(0);
    expect(d.drain().filter((e) => e.type === 'start')).toHaveLength(1);
  });

  it('a watchdog ends any shot that overstays, so the camera can never stick', () => {
    const d = new Director();
    d.request('reactor', safe);
    for (let i = 0; i < 20 * 60; i++) d.update(1 / 60, safe);
    expect(d.active).toBeNull();
    expect(d.drain().some((e) => e.type === 'end' && e.reason === 'watchdog')).toBe(true);
  });

  it('cooldowns suppress rapid repeats', () => {
    const d = new Director();
    d.request('jackpot', safe);
    d.end('jackpot');
    expect(d.request('jackpot', safe)).toBe('rejected');
    d.update(SHOTS.jackpot.cooldown + 0.1, safe);
    expect(d.request('jackpot', safe)).toBe('started');
  });

  it('rations optional dives so watching never dominates playing', () => {
    const d = new Director();
    // Sit in at-bat dives until the budget is spent.
    for (let i = 0; i < 200 && d.diveLoad <= DIVE_WINDOW * DIVE_BUDGET; i++) {
      if (!d.active) d.request('atBat', safe);
      d.update(1, safe);
    }
    d.end('atBat');
    expect(d.request('atBat', safe)).toBe('rejected');
    expect(d.lastRejection).toBe('budget');
    // Mini-games are never rationed.
    expect(d.request('city', safe)).toBe('started');
  });

  it('respects the cinematics setting', () => {
    const d = new Director();
    d.mode = 'minimal';
    expect(d.request('atBat', safe)).toBe('rejected');
    expect(d.request('reactor', safe)).toBe('started');
    d.reset();
    d.mode = 'off';
    expect(d.request('reactor', safe)).toBe('rejected');
    expect(d.miniGamesEnabled).toBe(false);
  });

  it('reset clears the active shot, queue and cooldowns', () => {
    const d = new Director();
    d.request('reactor', safe);
    d.request('city', safe);
    d.reset();
    expect(d.active).toBeNull();
    expect(d.queue).toHaveLength(0);
    expect(d.drain().pop()).toEqual(expect.objectContaining({ type: 'end', reason: 'reset' }));
  });
});
