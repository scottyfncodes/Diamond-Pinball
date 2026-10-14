import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/Game';
import type { GameEvents } from '../src/game/events';
import { MemoryStorage, SaveStore } from '../src/game/save';
import { STUNT_IDEAL } from '../src/attractions/cityRush';

const makeGame = (opts: Partial<Parameters<Game['startGame']>[0]> = {}, cinematics: 'full' | 'minimal' | 'off' = 'full') => {
  const store = new SaveStore(new MemoryStorage());
  store.updateSettings({ cinematics });
  const game = new Game(store);
  game.startGame({ innings: 9, difficulty: 'medium', seed: 11, ...opts });
  return game;
};

const collect = <K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] => {
  const out: GameEvents[K][] = [];
  game.bus.on(name, (p) => out.push(p));
  return out;
};

const tap = (game: Game, side: 'left' | 'right') => {
  game.setFlipper(side, true);
  game.setFlipper(side, false);
};

/** Steps the game, playing the city rush cleanly and nailing the stunt. */
const playCity = (game: Game, perfect = true, maxSeconds = 20) => {
  for (let i = 0; i < maxSeconds * 120; i++) {
    const r = game.rush;
    if (r && r.phase === 'race' && perfect) {
      const next = r.obstacles.find((o) => !o.passed);
      if (next && next.lanes.includes(r.lane) && next.at - r.progress < 0.05) {
        const free = [0, 1, 2].filter((l) => !next.lanes.includes(l)).sort((a, b) => Math.abs(a - r.lane) - Math.abs(b - r.lane))[0];
        tap(game, free < r.lane ? 'left' : 'right');
      }
    }
    if (r && r.phase === 'stunt' && perfect && r.stuntT >= STUNT_IDEAL - 1 / 240) tap(game, 'left');
    game.update(1 / 120);
    if (!game.attraction && !r && i > 10) break;
  }
};

/** Plays the reactor overload, syncing the first `syncs` pulses. */
/** Plays THE HEATER showdown winning exactly `wins` pitches: the first `wins` are hit on the ball's side (or the waste pitch taken), the rest are lost. */
const playOverload = (game: Game, wins: number) => {
  for (let i = 0; i < 20 * 240 && game.attraction?.kind === 'reactor'; i++) {
    const o = game.reactor.overload;
    if (o && !o.done) {
      const next = o.pulses.find((p) => !p.judged);
      if (next && Math.abs(o.t - next.at) <= 1 / 240) {
        const win = o.pulses.indexOf(next) < wins;
        // Win: swing on the side at a strike, leave the waste pitch. Lose: watch the strike, chase the ball.
        if (win === (next.kind !== 'ball')) tap(game, next.side);
      }
    }
    game.update(1 / 240);
  }
};

describe('DIAMOND CITY', () => {
  it('a lit left ramp diverts the ball into the city, the race is played with the flippers, the ball comes home', () => {
    const game = makeGame();
    const diverts = collect(game, 'cityDivert');
    const results = collect(game, 'cityResult');
    const shots = collect(game, 'shot');
    const batting = collect(game, 'battingStart');
    game.quickLaunch();
    game.debug.lightCity();
    const ball = game.debug.shootLeftRamp()!;
    for (let i = 0; i < 240 && !game.rush; i++) game.update(1 / 120);
    expect(diverts).toHaveLength(1);
    expect(batting).toHaveLength(0);
    expect(game.rush).not.toBeNull();
    expect(ball.state).toBe('held');
    expect(shots[0]).toEqual(expect.objectContaining({ kind: 'city', phase: 'start' }));
    const lane = game.rush!.lane;
    tap(game, 'left');
    expect(game.rush!.lane).toBe(lane - 1);
    const scoreBefore = game.score;
    playCity(game);
    expect(results).toHaveLength(1);
    expect(results[0].grade).toBe('legendary');
    expect(game.score - scoreBefore).toBeGreaterThanOrEqual(results[0].points);
    expect(game.worldMult).toBe(1.5);
    expect(game.attraction).toBeNull();
    expect(shots.filter((s) => s.phase === 'end' && s.kind === 'city')).toHaveLength(1);
    // The ball rides the skyway home and drops into the left inlane, live.
    for (let i = 0; i < 240 && ball.state !== 'free'; i++) game.update(1 / 120);
    expect(ball.state).toBe('free');
    expect(ball.pos.x).toBeLessThan(5);
    expect(ball.pos.y).toBeLessThan(14);
    expect(game.ballSaveTimer).toBeGreaterThan(0);
    expect(game.ballsLeft).toBe(3);
  });

  it('table timers are frozen while the city owns the ball', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.lightCity();
    game.debug.shootLeftRamp();
    for (let i = 0; i < 240 && !game.rush; i++) game.update(1 / 120);
    game.ballSaveTimer = 3;
    const clock = game.pitchClock;
    for (let i = 0; i < 240; i++) game.update(1 / 120);
    expect(game.ballSaveTimer).toBe(3);
    expect(game.pitchClock).toBe(clock);
  });

  it('a robbed home run hangs a banner that stays up; a miss hangs nothing; three banners are the WALL OF FAME', () => {
    const game = makeGame();
    const results = collect(game, 'cityResult');
    const fame = collect(game, 'cityRebuild');
    const run = (perfect: boolean) => {
      // Fresh ball each run: put the old one back on the plunger first.
      const b = game.world.balls[0];
      if (b.state !== 'launcher') game.world.resetBallToLauncher(b);
      game.quickLaunch();
      game.debug.lightCity();
      game.debug.shootLeftRamp();
      playCity(game, perfect);
      for (let i = 0; i < 240 && game.world.balls[0].state !== 'free'; i++) game.update(1 / 120);
    };
    run(false);
    expect(results[0].stunt).toBe('crash');
    expect(results[0].trophy).toBeNull();
    expect(game.city.trophies).toEqual([]);
    run(true);
    run(true);
    expect(results[2].trophies).toEqual(['billboard', 'waterTower']);
    expect(game.city.trophies).toHaveLength(2);
    run(true);
    expect(fame).toHaveLength(1);
    expect(game.city.trophies).toEqual([]);
    expect(game.city.level).toBe(4);
  });

  it('an unlit left ramp is still an at-bat', () => {
    const game = makeGame();
    const batting = collect(game, 'battingStart');
    game.quickLaunch();
    game.debug.shootLeftRamp();
    for (let i = 0; i < 60; i++) game.update(1 / 120);
    expect(batting).toHaveLength(1);
    expect(game.attraction).toBeNull();
  });

  it('inlanes and a completed bank light the traffic signals (EASY needs only two)', () => {
    const game = makeGame({ difficulty: 'easy' });
    const signals = collect(game, 'citySignal');
    game.quickLaunch();
    game.debug.placeBall({ x: 2.7, y: 10 }, { x: 0, y: -20 });
    for (let i = 0; i < 30; i++) game.update(1 / 120);
    expect(signals.at(-1)!.signals[0]).toBe(true);
    game.debug.placeBall({ x: 17.5, y: 10 }, { x: 0, y: -20 });
    for (let i = 0; i < 30; i++) game.update(1 / 120);
    expect(game.city.lit).toBe(true);
  });

  it('with cinematics OFF the city is a sightseeing lap: no capture, instant award, ball returns', () => {
    const game = makeGame({}, 'off');
    const results = collect(game, 'cityResult');
    const shots = collect(game, 'shot');
    game.quickLaunch();
    game.debug.lightCity();
    const ball = game.debug.shootLeftRamp()!;
    for (let i = 0; i < 600 && results.length === 0; i++) game.update(1 / 120);
    for (let i = 0; i < 600 && ball.state !== 'free'; i++) game.update(1 / 120);
    expect(results).toEqual([expect.objectContaining({ grade: 'cruise' })]);
    expect(game.rush).toBeNull();
    expect(shots).toHaveLength(0);
    expect(ball.state).toBe('free');
  });
});

describe('THE HEATER (reactor)', () => {
  it('table activity spins the machine up in stages until it is hot', () => {
    const game = makeGame();
    const events = collect(game, 'reactor');
    game.quickLaunch();
    for (let i = 0; i < 400 && !game.reactor.ready; i++) {
      game.debug.bumper(['bumper_l', 'bumper_r', 'bumper_c'][i % 3]);
      for (let k = 0; k < 30; k++) game.update(1 / 120);
    }
    expect(game.reactor.ready).toBe(true);
    expect(events.filter((e) => e.event.type === 'ring')).toHaveLength(3);
    expect(events.filter((e) => e.event.type === 'ready')).toHaveLength(1);
  });

  it('the hot machine takes the ball, the showdown is played with both flippers, multiball follows', () => {
    const game = makeGame();
    const results = collect(game, 'reactorResult');
    const shots = collect(game, 'shot');
    const multiball = collect(game, 'multiball');
    game.quickLaunch();
    game.debug.reactorReady();
    const ball = game.debug.shootCore()!;
    for (let i = 0; i < 60 && !game.attraction; i++) game.update(1 / 240);
    expect(game.attraction?.kind).toBe('reactor');
    expect(ball.state).toBe('held');
    expect(shots[0]).toEqual(expect.objectContaining({ kind: 'reactor', phase: 'start' }));
    playOverload(game, 4);
    expect(results).toHaveLength(1);
    expect(results[0].syncs).toBe(4);
    expect(results[0].outcome).toBe('overload');
    expect(game.reactor.level).toBe(1);
    expect(game.reactor.ready).toBe(false);
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    expect(multiball.at(-1)).toEqual(expect.objectContaining({ active: true, mode: 'reactor' }));
    expect(game.world.balls.filter((b) => b.state === 'free').length).toBeGreaterThanOrEqual(2);
    expect(ball.state).not.toBe('held');
  });

  it('a perfect showdown (all five pitches won) makes the bumpers pay triple for a while', () => {
    const game = makeGame();
    const results = collect(game, 'reactorResult');
    game.quickLaunch();
    game.debug.reactorReady();
    game.debug.shootCore();
    for (let i = 0; i < 60 && !game.attraction; i++) game.update(1 / 240);
    playOverload(game, 5);
    expect(results[0].outcome).toBe('meltdown');
    expect(game.reactor.critical).toBeGreaterThan(0);
  });

  it('during multiball the hot machine pays a SUPER JACKPOT without taking the ball', () => {
    const game = makeGame();
    const results = collect(game, 'reactorResult');
    game.quickLaunch();
    game.debug.multiball('standard');
    game.debug.reactorReady();
    const ball = game.debug.shootCore()!;
    for (let i = 0; i < 60; i++) game.update(1 / 240);
    expect(game.attraction).toBeNull();
    expect(results).toEqual([expect.objectContaining({ outcome: 'instant' })]);
    expect(ball.state).toBe('free');
  });
});

describe('camera safety and ball preservation', () => {
  it('the at-bat push-in runs only while the ball is parked and ends before release', () => {
    const game = makeGame();
    const shots = collect(game, 'shot');
    const releases = collect(game, 'atBatRelease');
    game.quickLaunch();
    const ball = game.debug.shootLeftRamp()!;
    for (let i = 0; i < 600 && releases.length === 0; i++) {
      game.update(1 / 120);
      // Whenever a dive is on screen, no ball is free.
      if (game.director.diving) expect(game.liveBalls()).toBe(0);
    }
    expect(shots.map((s) => `${s.kind}:${s.phase}`)).toEqual(['atBat:start', 'atBat:end']);
    for (let i = 0; i < 120 && ball.state === 'held'; i++) game.update(1 / 120);
    expect(ball.state).not.toBe('held');
  });

  it('a dive is aborted the moment a second ball goes live', () => {
    const game = makeGame();
    const shots = collect(game, 'shot');
    game.quickLaunch();
    game.debug.shootLeftRamp();
    for (let i = 0; i < 60; i++) game.update(1 / 120);
    expect(game.director.isActive('atBat')).toBe(true);
    game.world.createBall({ x: 10, y: 30 }, { x: 0, y: 0 }, 'free', true);
    game.update(1 / 120);
    expect(game.director.active).toBeNull();
    expect(shots.at(-1)).toEqual(expect.objectContaining({ kind: 'atBat', phase: 'end', reason: 'unsafe' }));
  });

  it('MINIMAL keeps the table camera for at-bats but still dives for the mini-games', () => {
    const game = makeGame({}, 'minimal');
    const shots = collect(game, 'shot');
    game.quickLaunch();
    game.debug.shootLeftRamp();
    for (let i = 0; i < 120; i++) game.update(1 / 120);
    expect(shots).toHaveLength(0);
    expect(game.batting).not.toBeNull();
  });

  it('repeated attractions leave nothing behind and the Grand Tour pays once', () => {
    const game = makeGame();
    const tours = collect(game, 'tour');
    game.quickLaunch();
    // Stadium: a home run.
    game.power = 3;
    game.debug.forceBatting('homeRun', 1, 1);
    game.update(0.1);
    game.debug.swingAt(0);
    for (let i = 0; i < 600 && game.batting; i++) game.update(1 / 120);
    for (let run = 0; run < 2; run++) {
      const b = game.world.balls.find((x) => x.state !== 'drained')!;
      game.world.resetBallToLauncher(b);
      game.quickLaunch();
      game.debug.lightCity();
      game.debug.shootLeftRamp();
      playCity(game);
      for (let i = 0; i < 240 && game.attraction; i++) game.update(1 / 120);
    }
    const free = game.world.balls.find((x) => x.state !== 'drained')!;
    game.world.resetBallToLauncher(free);
    game.quickLaunch();
    game.debug.reactorReady();
    game.debug.shootCore();
    for (let i = 0; i < 60 && !game.attraction; i++) game.update(1 / 240);
    playOverload(game, 0);
    for (let i = 0; i < 240; i++) game.update(1 / 120);
    // The Grand Tour relit the core, but the ejected ball is never swallowed straight back.
    expect(game.reactor.ready).toBe(true);
    expect(tours.filter((t) => t.complete)).toHaveLength(1);
    expect(game.attraction).toBeNull();
    expect(game.rush).toBeNull();
    expect(game.director.active === null || !game.director.diving).toBe(true);
    expect(game.city.level).toBe(2);
    expect(game.reactor.level).toBe(1);
  });

  it('game over and restart clear every attraction and shot', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.reactorReady();
    game.debug.shootCore();
    for (let i = 0; i < 60 && !game.attraction; i++) game.update(1 / 240);
    expect(game.attraction).not.toBeNull();
    game.restart();
    expect(game.attraction).toBeNull();
    expect(game.director.active).toBeNull();
    expect(game.reactor.ready).toBe(false);
    expect(game.launcherBall()).toBeDefined();
  });
});
