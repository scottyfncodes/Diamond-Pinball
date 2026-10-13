import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/Game';
import type { GameEvents } from '../src/game/events';
import { MemoryStorage, SaveStore } from '../src/game/save';
import { MAX_ACTIVE_MODIFIERS, activateModifier, createModifierState, tickModifiers } from '../src/game/modifiers';
import { addImpossibleLink, bossProgress, createBoss, createImpossible, derbyMultiplier, impossibleCount } from '../src/game/modes';
import { DIFFICULTIES } from '../src/game/difficulty';
import { MAX_TOTAL_MULTIPLIER, allowScore, applyScore, comboTier, contactAnnouncement, createRateLimiter } from '../src/game/scoring';

const makeGame = (difficulty: 'easy' | 'medium' | 'hard' = 'medium', opts: Partial<Parameters<Game['startGame']>[0]> = {}) => {
  const game = new Game(new SaveStore(new MemoryStorage()));
  game.startGame({ innings: 9, difficulty, seed: 11, ...opts });
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

describe('modifier bookkeeping', () => {
  it('stacks up to the limit, refuses group conflicts and refreshes repeats', () => {
    const m = createModifierState();
    expect(activateModifier(m, 'gravityFlip', 4)).toBe('started');
    expect(activateModifier(m, 'magnet', 10)).toBe('refused'); // same physics group
    expect(activateModifier(m, 'rocketBall', 10)).toBe('started');
    expect(activateModifier(m, 'lightning', 10)).toBe('refused'); // over the limit
    expect(m.active.length).toBe(MAX_ACTIVE_MODIFIERS);
    expect(activateModifier(m, 'rocketBall', 20)).toBe('refreshed');
    expect(m.active.find((a) => a.id === 'rocketBall')!.remaining).toBe(20);
    expect(activateModifier(m, 'splitBall')).toBe('started'); // instants never count
    expect(tickModifiers(m, 5)).toEqual(['gravityFlip']);
    expect(m.active.map((a) => a.id)).toEqual(['rocketBall']);
  });
});

describe('table modifiers in play', () => {
  it('gravity flip reverses gravity and restores the baseline when it ends', () => {
    const game = makeGame('easy');
    game.quickLaunch();
    step(game, 0.5);
    expect(game.debug.modifier('gravityFlip')).toBe(true);
    expect(game.world.effectiveGravity).toBeLessThan(0);
    step(game, 4 * DIFFICULTIES.easy.modeTimeScale + 0.2);
    expect(game.world.effectiveGravity).toBe(game.world.config.gravity);
    expect(game.world.baseline.timeScale).toBeCloseTo(0.72, 5);
    expect(game.modifiers.active).toHaveLength(0);
  });

  it('giant ball grows every ball and shrinks them back to the difficulty size', () => {
    const game = makeGame('hard');
    game.quickLaunch();
    const ball = game.world.balls[0];
    expect(game.debug.modifier('giantBall')).toBe(true);
    expect(ball.radius).toBeCloseTo(0.39 * 1.5, 5);
    for (let i = 0; i < 60 * (12 * DIFFICULTIES.hard.modeTimeScale + 0.2); i++) {
      game.debug.placeBall({ x: 10, y: 30 }, { x: 0, y: 0 }); // keep it alive
      game.update(1 / 60);
    }
    expect(game.modifiers.active.some((a) => a.id === 'giantBall')).toBe(false);
    expect(game.world.balls.every((b) => Math.abs(b.radius - 0.39) < 1e-5)).toBe(true);
  });

  it('split ball adds two extra balls that never cost a life', () => {
    const game = makeGame();
    game.quickLaunch();
    step(game, 0.3);
    expect(game.debug.modifier('splitBall')).toBe(true);
    const free = game.world.balls.filter((b) => b.state === 'free');
    expect(free.length).toBe(3);
    expect(free.filter((b) => b.extra).length).toBe(2);
    const balls = game.ballsLeft;
    for (const b of free.filter((x) => x.extra)) game.world.removeBall(b);
    expect(game.ballsLeft).toBe(balls);
  });

  it('wall bounce enables the rebound rails and losing the ball disables them', () => {
    const game = makeGame();
    game.quickLaunch();
    expect(game.world.colliders.get('blocker_center')!.enabled).toBe(false);
    expect(game.debug.modifier('wallBounce')).toBe(true);
    expect(game.world.colliders.get('blocker_center')!.enabled).toBe(true);
    game.debug.setBallSave(0);
    game.debug.drain();
    expect(game.world.colliders.get('blocker_center')!.enabled).toBe(false);
    expect(game.modifiers.active).toHaveLength(0);
    expect(game.world.attractors.size).toBe(0);
  });

  it('magnet adds attractors, rocket ball adds thrust; both clean up on drain', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.modifier('magnet');
    expect(game.world.attractors.size).toBeGreaterThan(0);
    game.debug.modifier('rocketBall');
    expect(game.world.balls[0].thrust).toBeGreaterThan(0);
    game.debug.setBallSave(0);
    game.debug.drain();
    expect(game.world.attractors.size).toBe(0);
    expect(game.world.balls.every((b) => b.thrust === 0)).toBe(true);
  });

  it('lightning round chains a target hit into neighbouring drop targets', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.modifier('lightning');
    const bolts = collect(game, 'lightning');
    game.debug.placeBall({ x: 4.6, y: 17.0 }, { x: -60, y: 0 });
    step(game, 0.4);
    expect(bolts.length).toBeGreaterThan(0);
    expect(game.bankDown.leftField.filter(Boolean).length).toBeGreaterThan(1);
  });

  it('the black hole captures the ball and ejects a burst of extra balls', () => {
    const game = makeGame();
    game.quickLaunch();
    const events = collect(game, 'blackHole');
    game.blackHoleLit = true;
    game.debug.bumper('bumper_c');
    expect(events[0]?.phase).toBe('capture');
    expect(game.world.balls[0].state).toBe('held');
    step(game, 1.5);
    expect(events.some((e) => e.phase === 'eject')).toBe(true);
    expect(game.world.balls.filter((b) => b.state === 'free').length).toBeGreaterThanOrEqual(3);
    expect(game.multiball).toBe(true);
  });

  it('turbo launch fires the next plunge faster and only once', () => {
    const game = makeGame();
    game.debug.modifier('turboLaunch');
    game.quickLaunch();
    const fast = game.world.balls[0].vel.y;
    game.debug.setBallSave(0);
    game.debug.drain();
    game.quickLaunch();
    const normal = game.world.balls[0].vel.y;
    expect(fast).toBeGreaterThan(normal * 1.4);
    expect(game.world.mods.launchScale).toBe(1);
  });

  it('game over restores every baseline physics value', () => {
    const game = makeGame('easy');
    game.quickLaunch();
    game.debug.modifier('giantBall');
    game.debug.modifier('rocketBall');
    game.debug.finish();
    expect(game.world.mods.ballScale).toBe(1);
    expect(game.world.mods.gravityScale).toBe(1);
    expect(game.world.mods.timeScale).toBe(1);
    expect(game.world.attractors.size).toBe(0);
    expect(game.world.balls).toHaveLength(0);
    game.startGame({ innings: 3, difficulty: 'medium', seed: 2 });
    expect(game.launcherBall()!.radius).toBeCloseTo(0.5, 5);
  });
});

describe('multiball modes', () => {
  it('baseball multiball floods the table and lit targets become base hits', () => {
    const game = makeGame();
    game.quickLaunch();
    step(game, 0.2);
    game.debug.multiball('baseball');
    expect(game.multiballMode).toBe('baseball');
    expect(game.world.balls.filter((b) => b.state === 'free').length).toBeGreaterThanOrEqual(4);
    expect(game.world.balls.some((b) => b.skin === 'baseball')).toBe(true);
    const before = game.baseball.plateAppearances;
    game.debug.placeBall({ x: 12.7, y: 21 }, { x: 0, y: 60 });
    step(game, 0.5);
    expect(game.baseball.plateAppearances).toBe(before + 1);
    expect(game.baseball.bases.some(Boolean)).toBe(true);
  });

  it('chaos multiball moves a roving jackpot and pays when it is hit', () => {
    const game = makeGame();
    game.quickLaunch();
    const roving = collect(game, 'rovingJackpot');
    game.debug.multiball('chaos');
    expect(roving.length).toBeGreaterThan(0);
    expect(game.rovingTarget).not.toBeNull();
    const first = game.rovingTarget;
    step(game, 2.5);
    expect(game.rovingTarget).not.toBe(first);
    game.rovingTarget = 'mound';
    const score = game.score;
    game.debug.mound();
    expect(game.score - score).toBeGreaterThan(50000);
  });

  it('back-to-back homers start the home run derby, which raises its multiplier per homer', () => {
    const game = makeGame();
    const derby = collect(game, 'derby');
    for (let i = 0; i < 2; i++) {
      game.power = 3;
      game.debug.forceBatting('homeRun', 1, 1);
      step(game, 0.1);
      game.debug.swingAt(0);
      step(game, 3.2);
    }
    expect(game.stats.homeRuns).toBe(2);
    expect(game.derby.active).toBe(true);
    expect(derby[0].active).toBe(true);
    game.power = 3;
    game.debug.forceBatting('homeRun', 1, 1);
    step(game, 0.1);
    game.debug.swingAt(0);
    expect(game.derby.homers).toBe(1);
    expect(derbyMultiplier(game.derby.homers)).toBe(2);
    step(game, 60);
    expect(game.derby.active).toBe(false);
  });

  it('multiball during a boss escalates to chaos', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.boss('ace');
    game.lockedBalls = DIFFICULTIES.medium.locksForMultiball;
    game.lockLit = true;
    game.debug.placeBall({ x: 18.7, y: 25 }, { x: 0, y: 50 });
    step(game, 1.5);
    expect(game.multiballMode).toBe('chaos');
  });
});

describe('bosses', () => {
  it('boss progress advances through stages', () => {
    const b = createBoss('wall', DIFFICULTIES.medium);
    expect(bossProgress(b)).toBe('none');
    expect(bossProgress(b)).toBe('none');
    expect(bossProgress(b)).toBe('stage');
    expect(b.stage).toBe(1);
    expect(bossProgress(b)).toBe('done');
    const easy = createBoss('ace', DIFFICULTIES.easy);
    const hard = createBoss('ace', DIFFICULTIES.hard);
    expect(easy.total).toBeGreaterThan(hard.total);
  });

  it('THE ACE appears after three strikeouts and is beaten by three hits', () => {
    const game = makeGame();
    const bosses = collect(game, 'boss');
    // Take pitches until the umpire has rung the batter up three times.
    for (let i = 0; i < 80 && !game.boss; i++) {
      if (game.baseball.outs === 2) {
        // End the half and play through the rivals' half so the player bats again.
        game.debug.forcePlay({ type: 'strikeout' });
        for (let j = 0; j < 3; j++) game.debug.forcePlay({ type: 'strikeout' });
        continue;
      }
      game.debug.forceBatting('left', 0.8);
      step(game, 4); // no swing: called strike or ball
    }
    expect(game.aceStrikeouts).toBeGreaterThanOrEqual(3);
    expect(game.boss?.id).toBe('ace');
    expect(bosses[0].label).toBe('THE ACE');
    for (let i = 0; i < 3; i++) game.debug.forcePlay({ type: 'single', contact: 0.5 });
    // forcePlay bypasses batting; hits through the batting model count.
    expect(game.boss?.id).toBe('ace');
    let guard = 0;
    while (game.boss && guard++ < 40) {
      game.power = 3;
      game.debug.forceBatting('homeRun', 1, 1);
      step(game, 0.1);
      game.debug.swingAt(0);
      step(game, 3.2);
    }
    expect(game.bossesBeaten).toContain('ace');
    expect(game.store.data.achievements).toContain('boss_ace');
  });

  it('THE WALL lights sections, and clearing it then homering beats it', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.wallHit('left');
    game.debug.wallHit('center');
    game.debug.wallHit('right');
    expect(game.store.data.achievements).toContain('wall_bounce');
    expect(game.boss?.id).toBe('wall');
    for (let i = 0; i < 3; i++) game.debug.wallHit(game.boss!.litSection);
    expect(game.boss!.stage).toBe(1);
    expect(game.hrLit).toBe(true);
    game.power = 3;
    game.debug.forceBatting('homeRun', 1, 1);
    step(game, 0.1);
    game.debug.swingAt(0);
    expect(game.bossesBeaten).toContain('wall');
  });

  it('on hard the wall sections must be lit in order', () => {
    const game = makeGame('hard');
    game.quickLaunch();
    game.debug.wallHit('center');
    expect(game.wallSectionsLit.size).toBe(0);
    game.debug.wallHit('left');
    expect(game.wallSectionsLit.size).toBe(1);
  });

  it('the commissioner challenge runs three objectives and times out when ignored', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.boss('commissioner');
    expect(game.boss?.stage).toBe(0);
    game.debug.placeBall({ x: 10.1, y: 20 }, { x: 0, y: 60 });
    step(game, 0.4);
    expect(game.boss?.stage).toBe(1);
    game.debug.forceBatting('left', 0.9, 0.9);
    step(game, 0.1);
    game.power = 3;
    game.debug.swingAt(0);
    step(game, 1);
    expect(game.boss === null || game.boss.stage >= 2).toBe(true);
    const g2 = makeGame();
    g2.quickLaunch();
    g2.debug.boss('commissioner');
    for (let i = 0; i < 60; i++) {
      g2.debug.placeBall({ x: 10, y: 30 }, { x: 0, y: 0 });
      step(g2, 1);
    }
    expect(g2.boss).toBeNull();
    expect(g2.bossesBeaten).toHaveLength(0);
  });

  it('the ninth-inning nightmare arms in the final inning, trailing, two outs, bases loaded', () => {
    const game = makeGame('medium', { innings: 1 });
    // Give the rivals a lead first: top 1 ends, bottom 1 they score, back to... single-inning games end, so use 2 innings.
    const g = makeGame('medium', { innings: 2 });
    void game;
    for (let i = 0; i < 3; i++) g.debug.forcePlay({ type: 'strikeout' });
    g.debug.forcePlay({ type: 'homeRun' });
    for (let i = 0; i < 3; i++) g.debug.forcePlay({ type: 'strikeout' });
    expect(g.baseball.inning).toBe(2);
    expect(g.offense).toBe(true);
    g.debug.forcePlay({ type: 'strikeout' });
    g.debug.forcePlay({ type: 'strikeout' });
    for (let i = 0; i < 3; i++) g.debug.forcePlay({ type: 'walk' });
    expect(g.boss?.id).toBe('nightmare');
    g.power = 3;
    g.debug.forceBatting('homeRun', 1, 1);
    step(g, 0.1);
    g.debug.swingAt(0);
    expect(g.stats.homeRuns).toBe(1);
    expect(g.bossesBeaten).toContain('nightmare');
  });
});

describe('THE IMPOSSIBLE INNING', () => {
  it('requires the configured number of links and a perfect homer on hard', () => {
    const med = createImpossible(DIFFICULTIES.medium);
    expect(med.needed).toBe(5);
    expect(addImpossibleLink(med, 'perfect')).toBe(false);
    expect(addImpossibleLink(med, 'homer')).toBe(false);
    expect(addImpossibleLink(med, 'multiball')).toBe(false);
    expect(addImpossibleLink(med, 'steal')).toBe(false);
    expect(addImpossibleLink(med, 'combo5')).toBe(true);
    const hard = createImpossible(DIFFICULTIES.hard);
    for (const l of ['perfect', 'homer', 'multiball', 'steal', 'combo5'] as const) addImpossibleLink(hard, l);
    expect(hard.achieved).toBe(false);
    expect(impossibleCount(hard)).toBe(4);
    expect(addImpossibleLink(hard, 'perfectHomer')).toBe(true);
    const easy = createImpossible(DIFFICULTIES.easy);
    expect(easy.needed).toBe(4);
  });

  it('completing the chain in a run pays the signature event and chaos multiball', () => {
    const game = makeGame('easy');
    game.quickLaunch();
    const events = collect(game, 'impossible');
    game.debug.link('perfect');
    game.debug.link('homer');
    game.debug.link('steal');
    const before = game.score;
    game.debug.link('multiball');
    expect(events[events.length - 1].stage).toBe('complete');
    expect(game.impossibleDone).toBe(true);
    expect(game.score - before).toBeGreaterThan(500000);
    expect(game.multiballMode).toBe('chaos');
    expect(game.store.data.achievements).toContain('impossible_easy');
    expect(game.ballsLeft).toBe(4);
  });

  it('the chain resets every half-inning', () => {
    const game = makeGame();
    game.debug.link('perfect');
    expect(impossibleCount(game.impossible)).toBe(1);
    for (let i = 0; i < 3; i++) game.debug.forcePlay({ type: 'strikeout' });
    expect(impossibleCount(game.impossible)).toBe(0);
  });
});

describe('baseball consequences of the new targets', () => {
  it('the mound lights home plate and the plate squeezes a runner home', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.forcePlay({ type: 'triple' });
    expect(game.baseball.bases[2]).not.toBeNull();
    const squeezes = collect(game, 'squeeze');
    game.debug.mound();
    expect(game.plateLit).toBeGreaterThan(0);
    game.debug.plate();
    expect(squeezes).toHaveLength(1);
    expect(game.playerRuns).toBe(1);
    expect(game.baseball.bases[2]).toBeNull();
  });

  it('without a runner the lit plate charges power, and an unlit plate does nothing', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.plate();
    expect(game.power).toBe(0);
    game.debug.mound();
    game.debug.plate();
    expect(game.power).toBe(1);
  });

  it('on defense a hard mound shot is a strike', () => {
    const game = makeGame();
    for (let i = 0; i < 3; i++) game.debug.forcePlay({ type: 'strikeout' });
    expect(game.offense).toBe(false);
    game.debug.mound();
    expect(game.baseball.strikes).toBe(1);
  });

  it('a scoreboard bumper cycle doubles scoring for a while and lights lightning or the black hole', () => {
    const game = makeGame();
    game.quickLaunch();
    const m = game.multiplier;
    game.debug.bumper('bumper_l');
    game.debug.bumper('bumper_r');
    game.debug.bumper('bumper_c');
    expect(game.scoreboardBoost).toBeGreaterThan(0);
    expect(game.multiplier).toBe(m * 2);
    expect(game.modifiers.active.some((a) => a.id === 'lightning')).toBe(true);
    step(game, 11);
    expect(game.scoreboardBoost).toBe(0);
    game.debug.bumper('bumper_l');
    game.debug.bumper('bumper_r');
    game.debug.bumper('bumper_c');
    expect(game.blackHoleLit).toBe(true);
  });

  it('the bullpen queues a special pitch for the next at-bat and two visits start baseball multiball', () => {
    const game = makeGame();
    game.quickLaunch();
    game.debug.placeBall({ x: 18.7, y: 25 }, { x: 0, y: 50 });
    step(game, 1.2);
    expect(game.queuedPitch).not.toBeNull();
    game.debug.forceBatting('left', 0.8);
    expect(game.batting!.pitch.special).toBe(true);
    step(game, 4);
    game.debug.placeBall({ x: 18.7, y: 25 }, { x: 0, y: 50 });
    step(game, 1.2);
    expect(game.multiballMode).toBe('baseball');
  });
});

describe('scoring safety', () => {
  it('caps the total multiplier and rate-limits repeated hits', () => {
    expect(applyScore(1000, 100, 10)).toBe(1000 * MAX_TOTAL_MULTIPLIER);
    const r = createRateLimiter(1, 3);
    expect(allowScore(r, 'bumper', 0)).toBe(true);
    expect(allowScore(r, 'bumper', 0.1)).toBe(true);
    expect(allowScore(r, 'bumper', 0.2)).toBe(true);
    expect(allowScore(r, 'bumper', 0.3)).toBe(false);
    expect(allowScore(r, 'other', 0.3)).toBe(true);
    expect(allowScore(r, 'bumper', 1.5)).toBe(true);
  });

  it('a bumper storm cannot run away', () => {
    const game = makeGame();
    game.quickLaunch();
    for (let i = 0; i < 200; i++) game.debug.bumper('bumper_l');
    expect(game.score).toBeLessThan(450 * 30);
  });

  it('combo tiers and announcements are deterministic', () => {
    expect(comboTier(1)).toBe('none');
    expect(comboTier(2)).toBe('warm');
    expect(comboTier(4)).toBe('hot');
    expect(comboTier(7)).toBe('blazing');
    expect(comboTier(10)).toBe('legend');
    expect(contactAnnouncement({ grade: 'perfect', play: 'homeRun', distance: 1.2, grandSlam: true, backToBack: false, walkOff: false })).toBe('GRAND SLAM!');
    expect(contactAnnouncement({ grade: 'perfect', play: 'homeRun', distance: 1.2, grandSlam: false, backToBack: true, walkOff: false })).toBe('BACK-TO-BACK!');
    expect(contactAnnouncement({ grade: 'solid', play: 'homeRun', distance: 1.2, grandSlam: false, backToBack: false, walkOff: true })).toBe('WALK-OFF!');
    expect(contactAnnouncement({ grade: 'solid', play: 'double', distance: 0.98, grandSlam: false, backToBack: false, walkOff: false })).toBe('WARNING TRACK');
    expect(contactAnnouncement({ grade: 'solid', play: 'single', distance: 0.5, grandSlam: false, backToBack: false, walkOff: false })).toBe('NICE CONTACT');
    expect(contactAnnouncement({ grade: 'weak', play: 'groundOut', distance: 0.3, grandSlam: false, backToBack: false, walkOff: false })).toBe('');
  });

  it('combo windows expire and reset the streak', () => {
    const game = makeGame('hard');
    game.quickLaunch();
    game.debug.placeBall({ x: 10.1, y: 20 }, { x: 0, y: 60 });
    step(game, 0.4);
    expect(game.combo.count).toBe(1);
    step(game, game.comboWindow + 0.2);
    expect(game.combo.count).toBe(0);
  });
});
