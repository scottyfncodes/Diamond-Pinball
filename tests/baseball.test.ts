import { describe, expect, it } from 'vitest';
import { applyPlay, basesLoaded, createBaseballState } from '../src/baseball/rules';
import type { BaseballState, Play } from '../src/baseball/types';

const run = (state: BaseballState, plays: Play[]) => {
  let s = state;
  const results = [];
  for (const p of plays) {
    const r = applyPlay(s, p);
    s = r.state;
    results.push(r.result);
  }
  return { state: s, results };
};

describe('baseball rules', () => {
  it('starts at the top of the first with nobody on', () => {
    const s = createBaseballState(9);
    expect(s.inning).toBe(1);
    expect(s.half).toBe('top');
    expect(s.outs).toBe(0);
    expect(s.bases).toEqual([null, null, null]);
    expect(s.totalInnings).toBe(9);
  });

  it('single puts the batter on first and advances runners', () => {
    const { state, results } = run(createBaseballState(), [{ type: 'single', contact: 0.4 }, { type: 'single', contact: 0.4 }]);
    expect(state.bases[0]).not.toBeNull();
    expect(state.bases[1]).not.toBeNull();
    expect(state.bases[2]).toBeNull();
    expect(state.away.hits).toBe(2);
    expect(results[1].runs).toBe(0);
  });

  it('runner on third scores on a single', () => {
    const { state, results } = run(createBaseballState(), [{ type: 'triple' }, { type: 'single', contact: 0.3 }]);
    expect(results[1].runs).toBe(1);
    expect(state.away.runs).toBe(1);
    expect(state.bases[2]).toBeNull();
    expect(state.bases[0]).not.toBeNull();
  });

  it('hard single scores the runner from second', () => {
    const { results } = run(createBaseballState(), [{ type: 'double' }, { type: 'single', contact: 0.7 }]);
    expect(results[1].runs).toBe(1);
    const soft = run(createBaseballState(), [{ type: 'double' }, { type: 'single', contact: 0.3 }]);
    expect(soft.results[1].runs).toBe(0);
    expect(soft.state.bases[2]).not.toBeNull();
  });

  it('double advances runners two bases', () => {
    const { state, results } = run(createBaseballState(), [{ type: 'single', contact: 0.4 }, { type: 'double', contact: 0.6 }]);
    expect(results[1].runs).toBe(0);
    expect(state.bases).toEqual([null, expect.any(Object), expect.any(Object)]);
  });

  it('home run scores everyone and a grand slam is flagged', () => {
    const loaded = run(createBaseballState(), [{ type: 'walk' }, { type: 'walk' }, { type: 'walk' }]);
    expect(basesLoaded(loaded.state)).toBe(true);
    const { state, results } = run(loaded.state, [{ type: 'homeRun' }]);
    expect(results[0].runs).toBe(4);
    expect(results[0].grandSlam).toBe(true);
    expect(results[0].label).toBe('GRAND SLAM!');
    expect(state.bases).toEqual([null, null, null]);
    expect(state.away.runs).toBe(4);
    expect(state.away.hits).toBe(1);
    // runs never double count
    expect(state.away.innings[0]).toBe(4);
  });

  it('walk only advances forced runners', () => {
    const { state } = run(createBaseballState(), [{ type: 'double' }, { type: 'walk' }]);
    expect(state.bases[0]).not.toBeNull();
    expect(state.bases[1]).not.toBeNull();
    expect(state.bases[2]).toBeNull();
    const loaded = run(createBaseballState(), [{ type: 'walk' }, { type: 'walk' }, { type: 'walk' }, { type: 'walk' }]);
    expect(loaded.results[3].runs).toBe(1);
    expect(basesLoaded(loaded.state)).toBe(true);
  });

  it('ground out double play records two outs and removes the runner on first', () => {
    const { state, results } = run(createBaseballState(), [{ type: 'single' }, { type: 'groundOut', doublePlay: true }]);
    expect(results[1].doublePlay).toBe(true);
    expect(results[1].outs).toBe(2);
    expect(state.outs).toBe(2);
    expect(state.bases).toEqual([null, null, null]);
  });

  it('double play is impossible with two outs: it ends the inning with one out', () => {
    const { state, results } = run(createBaseballState(), [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'single' }, { type: 'groundOut', doublePlay: true }]);
    expect(results[3].doublePlay).toBe(false);
    expect(results[3].halfInningEnded).toBe(true);
    expect(state.half).toBe('bottom');
    expect(state.outs).toBe(0);
  });

  it('ground out with fewer than two outs moves runners up; the third out does not score a run', () => {
    const a = run(createBaseballState(), [{ type: 'triple' }, { type: 'groundOut' }]);
    expect(a.results[1].runs).toBe(1);
    const b = run(createBaseballState(), [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'triple' }, { type: 'groundOut' }]);
    expect(b.results[3].runs).toBe(0);
    expect(b.state.away.runs).toBe(0);
  });

  it('sacrifice fly scores the runner from third only with fewer than two outs', () => {
    const a = run(createBaseballState(), [{ type: 'triple' }, { type: 'flyOut' }]);
    expect(a.results[1].sacFly).toBe(true);
    expect(a.results[1].runs).toBe(1);
    const b = run(createBaseballState(), [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'triple' }, { type: 'flyOut' }]);
    expect(b.results[3].sacFly).toBe(false);
    expect(b.results[3].runs).toBe(0);
  });

  it('three outs end the half inning and clear the bases', () => {
    const { state, results } = run(createBaseballState(), [{ type: 'single' }, { type: 'popOut' }, { type: 'lineOut' }, { type: 'strikeout' }]);
    expect(results[3].halfInningEnded).toBe(true);
    expect(state.half).toBe('bottom');
    expect(state.inning).toBe(1);
    expect(state.outs).toBe(0);
    expect(state.bases).toEqual([null, null, null]);
    expect(state.balls).toBe(0);
    expect(state.strikes).toBe(0);
  });

  it('bottom half ending moves to the next inning', () => {
    const outs: Play[] = [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'strikeout' }];
    const { state, results } = run(createBaseballState(), [...outs, ...outs]);
    expect(results[5].inningEnded).toBe(true);
    expect(state.inning).toBe(2);
    expect(state.half).toBe('top');
  });

  it('strikes and fouls build to a strikeout; fouls never strike out', () => {
    const a = run(createBaseballState(), [{ type: 'foul' }, { type: 'foul' }, { type: 'foul' }]);
    expect(a.state.strikes).toBe(2);
    expect(a.state.outs).toBe(0);
    const b = run(a.state, [{ type: 'strike' }]);
    expect(b.results[0].label).toBe('STRIKEOUT');
    expect(b.state.outs).toBe(1);
    expect(b.state.strikes).toBe(0);
  });

  it('four balls is a walk', () => {
    const { state, results } = run(createBaseballState(), [{ type: 'ball' }, { type: 'ball' }, { type: 'ball' }, { type: 'ball' }]);
    expect(results[3].label).toBe('WALK');
    expect(state.bases[0]).not.toBeNull();
    expect(state.balls).toBe(0);
  });

  it('steals move a runner only when the next base is open', () => {
    const a = run(createBaseballState(), [{ type: 'single' }, { type: 'steal', base: 1 }]);
    expect(a.state.bases[0]).toBeNull();
    expect(a.state.bases[1]).not.toBeNull();
    const blocked = run(createBaseballState(), [{ type: 'single' }, { type: 'single', contact: 0.3 }, { type: 'steal', base: 1 }]);
    expect(blocked.results[2].label).toBe('BASE OCCUPIED');
    expect(blocked.state.bases[0]).not.toBeNull();
    const home = run(createBaseballState(), [{ type: 'triple' }, { type: 'steal', base: 3 }]);
    expect(home.results[1].runs).toBe(1);
    expect(home.state.bases[2]).toBeNull();
    const none = run(createBaseballState(), [{ type: 'steal', base: 2 }]);
    expect(none.results[0].label).toBe('NO RUNNER');
  });

  it('caught stealing records an out', () => {
    const { state } = run(createBaseballState(), [{ type: 'single' }, { type: 'caughtStealing', base: 1 }]);
    expect(state.outs).toBe(1);
    expect(state.bases[0]).toBeNull();
  });

  it('errors charge the fielding team', () => {
    const { state } = run(createBaseballState(), [{ type: 'error' }]);
    expect(state.home.errors).toBe(1);
    expect(state.bases[0]).not.toBeNull();
  });

  it('never produces negative outs or runners moving backwards', () => {
    let s = createBaseballState(3);
    const plays: Play[] = [
      { type: 'single' }, { type: 'double', contact: 0.9 }, { type: 'groundOut', doublePlay: true }, { type: 'flyOut' }, { type: 'walk' },
      { type: 'homeRun' }, { type: 'triple' }, { type: 'steal', base: 3 }, { type: 'strike' }, { type: 'strike' }, { type: 'strike' },
    ];
    for (let i = 0; i < 200 && !s.gameOver; i++) {
      const p = plays[i % plays.length];
      const r = applyPlay(s, p);
      for (const m of r.result.moves) {
        if (m.to !== 'out') expect(m.to).toBeGreaterThan(m.from);
      }
      expect(r.state.outs).toBeGreaterThanOrEqual(0);
      expect(r.state.outs).toBeLessThan(3);
      s = r.state;
    }
  });

  it('completes a three inning game and declares a winner', () => {
    let s = createBaseballState(3);
    const outs: Play[] = [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'strikeout' }];
    // Away scores 1 in the first, everything else is outs.
    s = run(s, [{ type: 'homeRun' }, ...outs]).state;
    for (let i = 0; i < 5; i++) s = run(s, outs).state;
    expect(s.gameOver).toBe(true);
    expect(s.winner).toBe('away');
    expect(s.away.runs).toBe(1);
  });

  it('home team does not bat in the final inning when leading', () => {
    let s = createBaseballState(1);
    const outs: Play[] = [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'strikeout' }];
    s = run(s, outs).state; // top 1
    s = run(s, [{ type: 'homeRun' }, ...outs]).state; // bottom 1: home scores, 3 outs
    expect(s.gameOver).toBe(true);
    expect(s.winner).toBe('home');
    const t = createBaseballState(1);
    const afterTop = run(t, outs).state;
    expect(afterTop.gameOver).toBe(false); // tied 0-0 so home must bat
  });

  it('walk-off home run ends the game immediately', () => {
    let s = createBaseballState(1);
    const outs: Play[] = [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'strikeout' }];
    s = run(s, [{ type: 'homeRun' }, ...outs]).state; // away leads 1-0
    s = run(s, [{ type: 'single' }]).state;
    const r = applyPlay(s, { type: 'homeRun' });
    expect(r.result.walkOff).toBe(true);
    expect(r.state.gameOver).toBe(true);
    expect(r.state.winner).toBe('home');
    expect(r.state.home.runs).toBe(2);
  });

  it('tied game goes to extra innings', () => {
    let s = createBaseballState(1);
    const outs: Play[] = [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'strikeout' }];
    s = run(s, outs).state;
    s = run(s, outs).state;
    expect(s.gameOver).toBe(false);
    expect(s.inning).toBe(2);
    expect(s.half).toBe('top');
  });

  it('does nothing once the game is over', () => {
    let s = createBaseballState(1);
    const outs: Play[] = [{ type: 'strikeout' }, { type: 'strikeout' }, { type: 'strikeout' }];
    s = run(s, [{ type: 'homeRun' }, ...outs, ...outs]).state;
    expect(s.gameOver).toBe(true);
    const r = applyPlay(s, { type: 'homeRun' });
    expect(r.state.away.runs).toBe(1);
    expect(r.result.gameOver).toBe(true);
  });
});
