import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_ORDER, difficultyFor, normalizeDifficulty } from '../src/game/difficulty';
import { Game } from '../src/game/Game';
import { MemoryStorage, SaveStore } from '../src/game/save';
import { COMBO_WINDOW } from '../src/game/scoring';

const makeGame = (difficulty: 'easy' | 'medium' | 'hard', opts: Partial<Parameters<Game['startGame']>[0]> = {}) => {
  const game = new Game(new SaveStore(new MemoryStorage()));
  game.startGame({ innings: 3, difficulty, seed: 7, ...opts });
  return game;
};

const step = (game: Game, seconds: number) => {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) game.update(1 / 60);
};

describe('difficulty profiles', () => {
  it('defines three ordered profiles with the intended tuning direction', () => {
    expect(DIFFICULTY_ORDER).toEqual(['easy', 'medium', 'hard']);
    const e = DIFFICULTIES.easy;
    const m = DIFFICULTIES.medium;
    const h = DIFFICULTIES.hard;
    expect(m.ballScale).toBe(1);
    expect(m.speedScale).toBe(1);
    expect(e.ballScale).toBeGreaterThan(m.ballScale);
    expect(h.ballScale).toBeLessThan(m.ballScale);
    expect(e.speedScale).toBeLessThan(m.speedScale);
    expect(h.speedScale).toBeGreaterThan(m.speedScale);
    expect(e.comboWindowScale).toBeGreaterThan(h.comboWindowScale);
    expect(e.battingWindowScale).toBeGreaterThan(h.battingWindowScale);
    expect(e.ballSave).toBeGreaterThan(h.ballSave);
    expect(e.scoreScale).toBeLessThan(h.scoreScale);
    expect(h.scoreScale).toBe(1.5);
  });

  it('normalises legacy and unknown values', () => {
    expect(normalizeDifficulty('rookie')).toBe('easy');
    expect(normalizeDifficulty('pro')).toBe('medium');
    expect(normalizeDifficulty('allstar')).toBe('hard');
    expect(normalizeDifficulty('hard')).toBe('hard');
    expect(normalizeDifficulty('nonsense')).toBe('medium');
    expect(normalizeDifficulty(undefined)).toBe('medium');
    expect(difficultyFor('easy').id).toBe('easy');
  });
});

describe('difficulty in a run', () => {
  it('initialises the physics baseline from the profile and the ball is physically larger / smaller', () => {
    const easy = makeGame('easy');
    expect(easy.world.baseline.ballRadius).toBeCloseTo(0.65, 5);
    expect(easy.world.baseline.timeScale).toBeCloseTo(0.72, 5);
    expect(easy.launcherBall()!.radius).toBeCloseTo(0.65, 5);
    expect(easy.world.flippers.get('left_flipper')!.omegaUp).toBeGreaterThan(32);
    expect(easy.world.flippers.get('left_flipper')!.restitution).toBeGreaterThan(0.55);
    const hard = makeGame('hard');
    expect(hard.world.baseline.ballRadius).toBeCloseTo(0.39, 5);
    expect(hard.launcherBall()!.radius).toBeCloseTo(0.39, 5);
    expect(hard.world.baseline.timeScale).toBeCloseTo(1.28, 5);
    expect(hard.world.ramps.get('left_ramp')!.minSpeed).toBeGreaterThan(makeGame('medium').world.ramps.get('left_ramp')!.minSpeed);
  });

  it('the launched ball really travels slower on easy and faster on hard', () => {
    const travel = (d: 'easy' | 'medium' | 'hard') => {
      const g = makeGame(d);
      g.quickLaunch();
      const ball = g.world.balls[0];
      let dist = 0;
      let last = { ...ball.pos };
      for (let i = 0; i < 8; i++) {
        g.update(1 / 60);
        dist += Math.hypot(ball.pos.x - last.x, ball.pos.y - last.y);
        last = { ...ball.pos };
      }
      return dist;
    };
    const e = travel('easy');
    const m = travel('medium');
    const h = travel('hard');
    expect(e).toBeLessThan(m * 0.8);
    expect(h).toBeGreaterThan(m * 1.2);
  });

  it('changing difficulty between runs re-initialises the baseline and persists the last choice', () => {
    const store = new SaveStore(new MemoryStorage());
    const game = new Game(store);
    game.startGame({ innings: 3, difficulty: 'easy', seed: 1 });
    expect(game.profile.id).toBe('easy');
    game.quitToTitle();
    store.updateSettings({ difficulty: 'hard' });
    game.startGame({ innings: 3, seed: 1 });
    expect(game.profile.id).toBe('hard');
    expect(game.world.baseline.ballRadius).toBeCloseTo(0.39, 5);
    expect(game.world.balls.every((b) => Math.abs(b.radius - 0.39) < 1e-5)).toBe(true);
    // A restart keeps the run's difficulty, never silently switching.
    store.updateSettings({ difficulty: 'easy' });
    game.restart();
    expect(game.profile.id).toBe('hard');
  });

  it('scales the combo window, batting window, ball save and score multiplier', () => {
    const easy = makeGame('easy');
    const hard = makeGame('hard');
    expect(easy.comboWindow).toBeCloseTo(COMBO_WINDOW * 1.5, 5);
    expect(hard.comboWindow).toBeCloseTo(COMBO_WINDOW * 0.75, 5);
    easy.debug.forceBatting('left', 0.8);
    hard.debug.forceBatting('left', 0.8);
    expect(easy.batting!.windowSeconds).toBeGreaterThan(hard.batting!.windowSeconds * 1.6);
    easy.quickLaunch();
    expect(easy.ballSaveTimer).toBe(DIFFICULTIES.easy.ballSave);
    hard.quickLaunch();
    expect(hard.ballSaveTimer).toBe(DIFFICULTIES.hard.ballSave);
    // Same award, scaled by the profile.
    const e2 = makeGame('easy');
    const h2 = makeGame('hard');
    e2.debug.mound();
    h2.debug.mound();
    expect(h2.score).toBeCloseTo((e2.score / 0.85) * 1.5, 0);
  });

  it('easy lights the kickback on every ball; hard does not', () => {
    const easy = makeGame('easy');
    expect(easy.kickbackLit).toBe(true);
    const hard = makeGame('hard');
    expect(hard.kickbackLit).toBe(false);
    easy.quickLaunch();
    easy.kickbackLit = false;
    easy.debug.setBallSave(0);
    easy.debug.drain();
    expect(easy.kickbackLit).toBe(true);
  });

  it('easy starts multiball after a single lock', () => {
    const game = makeGame('easy');
    const lockRound = () => {
      game.baseTargetsHit.add('base_1b');
      game.baseTargetsHit.add('base_3b');
      game.baseTargetsHit.add('center_lane');
      game.lockLit = true;
      game.debug.placeBall({ x: 18.7, y: 25 }, { x: 0, y: 50 });
      step(game, 1.2);
    };
    lockRound();
    expect(game.lockedBalls).toBe(1);
    step(game, 1.5);
    lockRound();
    expect(game.multiball).toBe(true);
    expect(game.multiballMode).toBe('standard');
    step(game, 2);
    expect(game.world.balls.filter((b) => b.state === 'free').length).toBeGreaterThanOrEqual(3);
  });

  it('records the high score against the run difficulty', () => {
    const game = makeGame('hard');
    game.debug.mound();
    game.debug.finish();
    expect(game.store.highScoresFor('hard')).toHaveLength(1);
    expect(game.store.highScoresFor('medium')).toHaveLength(0);
    expect(game.summary!.difficulty.id).toBe('hard');
  });

  it('the easy ball is big enough to need a wider gap yet still drains through the flippers', () => {
    const game = makeGame('easy');
    game.quickLaunch();
    let drained = false;
    for (let i = 0; i < 60 * 40 && !drained; i++) {
      game.update(1 / 60);
      if (game.ballsLeft < 3 || game.world.balls.some((b) => b.state === 'launcher' && b.age < 0.1)) drained = true;
    }
    expect(drained).toBe(true);
  });
});
