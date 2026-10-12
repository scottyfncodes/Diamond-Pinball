import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/Game';
import { MemoryStorage, SaveStore } from '../src/game/save';
import type { GameEvents } from '../src/game/events';

const makeGame = (opts: Partial<Parameters<Game['startGame']>[0]> = {}) => {
  const game = new Game(new SaveStore(new MemoryStorage()));
  game.startGame({ innings: 3, difficulty: 'pro', seed: 7, ...opts });
  return game;
};

const collect = <K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] => {
  const out: GameEvents[K][] = [];
  game.bus.on(name, (p) => out.push(p));
  return out;
};

const step = (game: Game, seconds: number) => {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) game.update(1 / 60);
};

describe('game flow', () => {
  it('starts with a ball on the plunger, three balls and the player batting first', () => {
    const game = makeGame();
    expect(game.state).toBe('playing');
    expect(game.ballsLeft).toBe(3);
    expect(game.launcherBall()).toBeDefined();
    expect(game.offense).toBe(true);
    expect(game.baseball.half).toBe('top');
  });

  it('pause halts simulation and resume continues without corrupting state', () => {
    const game = makeGame();
    game.plungerDown();
    step(game, 0.5);
    game.plungerUp();
    step(game, 0.3);
    const ball = game.world.balls[0];
    const pos = { ...ball.pos };
    game.pause();
    expect(game.state).toBe('paused');
    step(game, 2);
    expect(ball.pos).toEqual(pos);
    game.resume();
    expect(game.state).toBe('playing');
    step(game, 0.2);
    expect(ball.pos).not.toEqual(pos);
  });

  it('flippers only respond while playing and pausing releases them', () => {
    const game = makeGame();
    game.setFlipper('left', true);
    expect(game.world.flippers.get('left_flipper')!.active).toBe(true);
    game.pause();
    expect(game.world.flippers.get('left_flipper')!.active).toBe(false);
    game.setFlipper('right', true);
    expect(game.world.flippers.get('right_flipper')!.active).toBe(false);
  });

  it('a ramp shot starts a batting event that resolves into a baseball play', () => {
    const game = makeGame();
    const starts = collect(game, 'battingStart');
    const results = collect(game, 'battingResult');
    game.debug.placeBall({ x: 4.5, y: 21.5 }, { x: 0, y: 115 });
    step(game, 0.4);
    expect(starts).toHaveLength(1);
    expect(starts[0].lane).toBe('left');
    expect(starts[0].shotQuality).toBeGreaterThan(0.3);
    // Swing with a flipper press at the perfect moment.
    step(game, starts[0].pitchDelay - 0.4 + 0.01);
    game.setFlipper('right', true);
    expect(results).toHaveLength(1);
    expect(results[0].play.label.length).toBeGreaterThan(0);
    expect(game.baseball.plateAppearances + game.baseball.strikes).toBeGreaterThan(0);
  });

  it('auto-swings when the player never presses during the window', () => {
    const game = makeGame();
    const swings = collect(game, 'battingSwing');
    game.debug.forceBatting('right', 0.8);
    step(game, 2.6);
    expect(swings).toHaveLength(1);
    expect(swings[0].auto).toBe(true);
    expect(game.batting).toBeNull();
  });

  it('scores pinball points with multipliers and emits score events', () => {
    const game = makeGame();
    const scores = collect(game, 'score');
    game.debug.placeBall({ x: 10.3, y: 32.5 }, { x: 0, y: 60 });
    step(game, 1);
    expect(game.score).toBeGreaterThan(0);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores[scores.length - 1].total).toBe(game.score);
  });

  it('ball save returns the ball after an early drain; later drains cost a ball', () => {
    const game = makeGame();
    const saved = collect(game, 'ballSaved');
    const lost = collect(game, 'ballLost');
    game.quickLaunch();
    game.debug.drain();
    expect(saved).toHaveLength(1);
    expect(game.ballsLeft).toBe(3);
    step(game, 1.2); // auto launch
    game.debug.setBallSave(0);
    game.debug.drain();
    expect(lost).toHaveLength(1);
    expect(game.ballsLeft).toBe(2);
    expect(game.launcherBall()).toBeDefined();
  });

  it('losing every ball ends the game with a summary and a high score entry', () => {
    const game = makeGame();
    const over = collect(game, 'gameOver');
    for (let i = 0; i < 3; i++) {
      game.quickLaunch();
      game.debug.setBallSave(0);
      game.debug.drain();
    }
    expect(game.state).toBe('gameover');
    expect(over).toHaveLength(1);
    expect(over[0].reason).toBe('ballsLost');
    expect(over[0].completed).toBe(false);
    expect(game.store.data.highScores.length).toBe(1);
    expect(game.store.data.stats.gamesPlayed).toBe(1);
  });

  it('switches to defense after three outs and resolves opponent at-bats on the clock', () => {
    const game = makeGame();
    const modes = collect(game, 'modeChange');
    for (let i = 0; i < 3; i++) game.debug.forcePlay({ type: 'strikeout' });
    expect(game.offense).toBe(false);
    expect(modes[modes.length - 1].offense).toBe(false);
    const defense = collect(game, 'defenseResult');
    game.quickLaunch();
    step(game, game.difficulty.defenseInterval + 1.5);
    expect(defense.length).toBeGreaterThanOrEqual(1);
    expect(defense[0].state.half === 'bottom' || defense[0].play.halfInningEnded).toBe(true);
  });

  it('ramps during defense strike the batter out', () => {
    const game = makeGame();
    for (let i = 0; i < 3; i++) game.debug.forcePlay({ type: 'strikeout' });
    const outsBefore = game.baseball.outs;
    const defense = collect(game, 'defenseResult');
    game.debug.placeBall({ x: 15.7, y: 21.5 }, { x: 0, y: 115 });
    step(game, 0.5);
    expect(defense).toHaveLength(1);
    expect(defense[0].play.play.type).toBe('strikeout');
    expect(game.baseball.outs).toBe(outsBefore + 1);
  });

  it('pitch clock expiry calls strikes and eventually strikes out', () => {
    const game = makeGame({ difficulty: 'allstar' });
    const strikes = collect(game, 'strike');
    game.quickLaunch();
    // Keep the ball alive by re-placing it every half second so it never drains.
    const total = 3 * (game.difficulty.pitchClock + 0.5);
    for (let t = 0; t < total; t += 0.5) {
      game.debug.placeBall({ x: 10, y: 30 }, { x: 0, y: 0 });
      step(game, 0.5);
    }
    expect(strikes.length).toBeGreaterThanOrEqual(3);
    expect(game.baseball.outs + (game.baseball.half === 'bottom' ? 3 : 0)).toBeGreaterThanOrEqual(1);
  });

  it('steals a base by hitting the lit base target with a runner on', () => {
    const game = makeGame();
    game.debug.forcePlay({ type: 'single', contact: 0.3 });
    expect(game.baseball.bases[0]).not.toBeNull();
    const steals = collect(game, 'steal');
    game.debug.placeBall({ x: 12.7, y: 21 }, { x: 0, y: 60 });
    step(game, 0.6);
    expect(steals).toHaveLength(1);
    expect(game.baseball.bases[1]).not.toBeNull();
    expect(game.baseball.bases[0]).toBeNull();
  });

  it('completing a game produces a winner and awards the complete game achievement', () => {
    const game = makeGame({ innings: 1 });
    const over = collect(game, 'gameOver');
    game.debug.forcePlay({ type: 'homeRun' });
    for (let i = 0; i < 3; i++) game.debug.forcePlay({ type: 'strikeout' });
    for (let i = 0; i < 3; i++) game.debug.forcePlay({ type: 'strikeout' });
    expect(game.state).toBe('gameover');
    expect(over[0].completed).toBe(true);
    expect(over[0].won).toBe(true);
    expect(over[0].newAchievements).toContain('complete_win');
  });

  it('a home run from a batting event awards the first home run achievement and its unlock', () => {
    const game = makeGame({ innings: 9 });
    const achievements = collect(game, 'achievement');
    for (let i = 0; i < 25 && game.stats.homeRuns === 0; i++) {
      game.debug.forceBatting('homeRun', 1);
      game.hrLit = true;
      step(game, 1.06);
      game.setFlipper('left', true);
      game.setFlipper('left', false);
      step(game, 1.2);
    }
    expect(game.stats.homeRuns).toBeGreaterThan(0);
    expect(achievements.map((a) => a.id)).toContain('first_hr');
    expect(game.store.data.unlocks).toContain('gold');
  });

  it('locks balls and starts multiball after two locks', () => {
    const game = makeGame();
    const saucer = collect(game, 'saucer');
    const multi = collect(game, 'multiball');
    const lockRound = () => {
      game.baseTargetsHit.add('base_1b');
      game.baseTargetsHit.add('base_3b');
      game.baseTargetsHit.add('center_lane');
      game.lockLit = true;
      game.debug.placeBall({ x: 18.7, y: 25 }, { x: 0, y: 50 });
      step(game, 1.2);
    };
    lockRound();
    expect(saucer[0].locked).toBe(true);
    expect(game.lockedBalls).toBe(1);
    step(game, 1.5); // auto launch of the replacement ball
    lockRound();
    expect(game.lockedBalls).toBe(2);
    step(game, 1.5);
    lockRound();
    expect(multi[0]?.active).toBe(true);
    expect(game.multiball).toBe(true);
    step(game, 3);
    expect(game.world.balls.filter((b) => b.state === 'free').length).toBeGreaterThanOrEqual(2);
  });

  it('restart and quit reset the table', () => {
    const game = makeGame();
    game.quickLaunch();
    step(game, 1);
    game.restart();
    expect(game.score).toBe(0);
    expect(game.ballsLeft).toBe(3);
    expect(game.world.balls.length).toBe(1);
    game.quitToTitle();
    expect(game.state).toBe('title');
    expect(game.world.balls.length).toBe(0);
  });
});
