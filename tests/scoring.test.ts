import { describe, expect, it } from 'vitest';
import { applyScore, comboMultiplier, createCombo, registerComboShot, resetCombo, scoreMultiplier, tickCombo, COMBO_WINDOW, POINTS } from '../src/game/scoring';

describe('scoring and combos', () => {
  it('combo increments on shots and breaks after the window', () => {
    const c = createCombo();
    expect(registerComboShot(c)).toBe(1);
    expect(registerComboShot(c)).toBe(2);
    expect(c.best).toBe(2);
    expect(tickCombo(c, COMBO_WINDOW - 0.1)).toBe(false);
    expect(c.count).toBe(2);
    expect(tickCombo(c, 0.2)).toBe(true);
    expect(c.count).toBe(0);
    expect(c.best).toBe(2);
  });

  it('combo multiplier scales to 3x', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBe(1.5);
    expect(comboMultiplier(3)).toBe(2);
    expect(comboMultiplier(10)).toBe(3);
  });

  it('score multiplier grows with runs and doubles during multiball', () => {
    expect(scoreMultiplier(0, false, 0)).toBe(1);
    expect(scoreMultiplier(2, false, 0)).toBe(2);
    expect(scoreMultiplier(9, false, 0)).toBe(5);
    expect(scoreMultiplier(2, true, 0)).toBe(4);
    expect(scoreMultiplier(0, false, 1)).toBe(2);
  });

  it('applies both multipliers to points', () => {
    expect(applyScore(POINTS.ramp, 2, 3)).toBe(POINTS.ramp * 2 * 2);
    expect(applyScore(100, 1, 0)).toBe(100);
  });

  it('resetCombo clears the running combo but keeps the best', () => {
    const c = createCombo();
    registerComboShot(c);
    registerComboShot(c);
    resetCombo(c);
    expect(c.count).toBe(0);
    expect(c.best).toBe(2);
  });
});
