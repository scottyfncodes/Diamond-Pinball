import { describe, expect, it } from 'vitest';
import { HYPE_GRACE, HYPE_MAX, RALLY_SECONDS, addHype, createHype, drainHype, rallyActive, tickHype } from '../src/game/hype';

describe('hype meter', () => {
  it('fills with gains and starts a rally when full', () => {
    const h = createHype();
    expect(addHype(h, 40)).toBe(false);
    expect(h.value).toBe(40);
    expect(addHype(h, 70)).toBe(true);
    expect(rallyActive(h)).toBe(true);
    expect(h.rallies).toBe(1);
    // Gains during a rally do not start another one.
    expect(addHype(h, 100)).toBe(false);
  });

  it('decays only after a grace period without gains', () => {
    const h = createHype();
    addHype(h, 50);
    tickHype(h, HYPE_GRACE - 0.1);
    expect(h.value).toBe(50);
    tickHype(h, 1);
    expect(h.value).toBeLessThan(50);
    addHype(h, 1);
    const v = h.value;
    tickHype(h, 0.5);
    expect(h.value).toBe(v);
  });

  it('rallies run for a fixed time and then reset the meter', () => {
    const h = createHype();
    addHype(h, HYPE_MAX);
    expect(tickHype(h, RALLY_SECONDS / 2)).toBe(false);
    expect(h.value).toBeGreaterThan(0);
    expect(tickHype(h, RALLY_SECONDS / 2 + 0.1)).toBe(true);
    expect(rallyActive(h)).toBe(false);
    expect(h.value).toBe(0);
  });

  it('losing a ball ends the rally and halves the meter', () => {
    const h = createHype();
    addHype(h, 60);
    drainHype(h);
    expect(h.value).toBe(30);
    addHype(h, 100);
    drainHype(h);
    expect(rallyActive(h)).toBe(false);
  });
});
