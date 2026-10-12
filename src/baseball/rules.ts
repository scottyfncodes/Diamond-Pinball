import type { BaseballState, BaseIndex, Play, PlayResult, Runner, TeamLine, TeamSide } from './types';

const newTeamLine = (): TeamLine => ({ runs: 0, hits: 0, errors: 0, innings: [] });

export function createBaseballState(totalInnings = 3): BaseballState {
  return {
    inning: 1,
    half: 'top',
    outs: 0,
    balls: 0,
    strikes: 0,
    bases: [null, null, null],
    away: newTeamLine(),
    home: newTeamLine(),
    totalInnings,
    gameOver: false,
    winner: null,
    nextRunnerId: 1,
    plateAppearances: 0,
  };
}

export function cloneState(s: BaseballState): BaseballState {
  return {
    ...s,
    bases: [s.bases[0], s.bases[1], s.bases[2]],
    away: { ...s.away, innings: [...s.away.innings] },
    home: { ...s.home, innings: [...s.home.innings] },
  };
}

export const battingTeam = (s: BaseballState): TeamSide => (s.half === 'top' ? 'away' : 'home');
export const fieldingTeam = (s: BaseballState): TeamSide => (s.half === 'top' ? 'home' : 'away');
export const runnersOn = (s: BaseballState): number => s.bases.filter(Boolean).length;
export const basesLoaded = (s: BaseballState): boolean => runnersOn(s) === 3;
export const isFinalInning = (s: BaseballState): boolean => s.inning >= s.totalInnings;

const line = (s: BaseballState, side: TeamSide): TeamLine => (side === 'away' ? s.away : s.home);

function creditRun(s: BaseballState, side: TeamSide, n = 1): void {
  const l = line(s, side);
  l.runs += n;
  while (l.innings.length < s.inning) l.innings.push(0);
  l.innings[s.inning - 1] += n;
}

function ensureInningColumn(s: BaseballState): void {
  const l = line(s, battingTeam(s));
  while (l.innings.length < s.inning) l.innings.push(0);
}

function resetCount(s: BaseballState): void {
  s.balls = 0;
  s.strikes = 0;
}

/**
 * Applies a play to a copy of the state and returns the resulting state and a
 * structured description of what happened. Pure: never mutates the input.
 */
export function applyPlay(input: BaseballState, play: Play): { state: BaseballState; result: PlayResult } {
  const s = cloneState(input);
  const result: PlayResult = {
    play,
    label: '',
    description: '',
    runs: 0,
    outs: 0,
    hit: false,
    moves: [],
    halfInningEnded: false,
    inningEnded: false,
    gameOver: false,
    strikeoutLooking: false,
    walkOff: false,
    doublePlay: false,
    sacFly: false,
    grandSlam: false,
  };
  if (s.gameOver) {
    result.label = 'GAME OVER';
    result.description = 'The game is already over.';
    result.gameOver = true;
    return { state: s, result };
  }
  ensureInningColumn(s);
  const side = battingTeam(s);
  const outsBefore = s.outs;
  const loadedBefore = basesLoaded(s);

  const move = (runner: Runner, from: BaseIndex, to: BaseIndex | 'out'): void => {
    const scored = to === 4;
    result.moves.push({ runner, from, to, scored });
    if (scored) {
      result.runs += 1;
      creditRun(s, side);
    }
  };
  const batterRunner = (): Runner => ({ id: s.nextRunnerId++ });
  const recordOut = (): void => {
    s.outs += 1;
    result.outs += 1;
  };
  const endPlateAppearance = (): void => {
    resetCount(s);
    s.plateAppearances += 1;
  };

  // Advance every runner by `n` bases, from third down to first, so nobody collides.
  const advanceAll = (n: number, minBase = 0): void => {
    for (let i = 2; i >= minBase; i--) {
      const r = s.bases[i];
      if (!r) continue;
      const target = i + 1 + n;
      s.bases[i] = null;
      if (target >= 4) move(r, (i + 1) as BaseIndex, 4);
      else {
        s.bases[target - 1] = r;
        move(r, (i + 1) as BaseIndex, target as BaseIndex);
      }
    }
  };
  // Advance only runners who are forced by a runner behind them (walk / error at first).
  const advanceForced = (): void => {
    const forced = (base: number): boolean => (base === 0 ? true : !!s.bases[base - 1] && forced(base - 1));
    for (let i = 2; i >= 0; i--) {
      const r = s.bases[i];
      if (!r || !forced(i)) continue;
      s.bases[i] = null;
      const target = i + 2;
      if (target >= 4) move(r, (i + 1) as BaseIndex, 4);
      else {
        s.bases[target - 1] = r;
        move(r, (i + 1) as BaseIndex, target as BaseIndex);
      }
    }
  };

  switch (play.type) {
    case 'single': {
      const contact = play.contact ?? 0.5;
      // Third always scores; second scores on hard contact; first takes two on very hard contact.
      const r3 = s.bases[2];
      const r2 = s.bases[1];
      const r1 = s.bases[0];
      s.bases = [null, null, null];
      if (r3) move(r3, 3, 4);
      if (r2) {
        if (contact >= 0.6) move(r2, 2, 4);
        else {
          s.bases[2] = r2;
          move(r2, 2, 3);
        }
      }
      if (r1) {
        if (contact >= 0.8 && !s.bases[2]) {
          s.bases[2] = r1;
          move(r1, 1, 3);
        } else {
          s.bases[1] = r1;
          move(r1, 1, 2);
        }
      }
      const b = batterRunner();
      s.bases[0] = b;
      move(b, 0, 1);
      line(s, side).hits += 1;
      result.hit = true;
      result.label = 'SINGLE!';
      result.description = 'Base hit.';
      endPlateAppearance();
      break;
    }
    case 'double': {
      const contact = play.contact ?? 0.6;
      const r3 = s.bases[2];
      const r2 = s.bases[1];
      const r1 = s.bases[0];
      s.bases = [null, null, null];
      if (r3) move(r3, 3, 4);
      if (r2) move(r2, 2, 4);
      if (r1) {
        if (contact >= 0.85) move(r1, 1, 4);
        else {
          s.bases[2] = r1;
          move(r1, 1, 3);
        }
      }
      const b = batterRunner();
      s.bases[1] = b;
      move(b, 0, 2);
      line(s, side).hits += 1;
      result.hit = true;
      result.label = 'DOUBLE!';
      result.description = 'Into the gap for two bases.';
      endPlateAppearance();
      break;
    }
    case 'triple': {
      advanceAll(3);
      const b = batterRunner();
      s.bases[2] = b;
      move(b, 0, 3);
      line(s, side).hits += 1;
      result.hit = true;
      result.label = 'TRIPLE!';
      result.description = 'All the way to third!';
      endPlateAppearance();
      break;
    }
    case 'homeRun': {
      advanceAll(3);
      const b = batterRunner();
      move(b, 0, 4);
      line(s, side).hits += 1;
      result.hit = true;
      result.grandSlam = loadedBefore;
      result.label = result.grandSlam ? 'GRAND SLAM!' : 'HOME RUN!';
      result.description = result.grandSlam ? 'Bases loaded... and it is gone!' : 'Over the wall!';
      endPlateAppearance();
      break;
    }
    case 'groundOut': {
      const batter = batterRunner();
      const r1 = s.bases[0];
      const canDouble = !!play.doublePlay && !!r1 && outsBefore < 2;
      if (canDouble) {
        // 6-4-3: runner on first forced at second, batter thrown out at first.
        s.bases[0] = null;
        move(r1!, 1, 'out');
        recordOut();
        move(batter, 0, 'out');
        recordOut();
        result.doublePlay = true;
        // Other runners advance one base if the inning is still alive.
        if (s.outs < 3) {
          const r3 = s.bases[2];
          const r2 = s.bases[1];
          s.bases[2] = null;
          s.bases[1] = null;
          if (r3) move(r3, 3, 4);
          if (r2) {
            s.bases[2] = r2;
            move(r2, 2, 3);
          }
        }
        result.label = 'DOUBLE PLAY!';
        result.description = 'Ground ball, two thrown out.';
      } else {
        move(batter, 0, 'out');
        recordOut();
        if (s.outs < 3) {
          // Productive out: runners move up a base.
          advanceAll(1);
        }
        result.label = 'GROUND OUT';
        result.description = 'Fielded cleanly and thrown to first.';
      }
      endPlateAppearance();
      break;
    }
    case 'flyOut': {
      const batter = batterRunner();
      move(batter, 0, 'out');
      recordOut();
      if (s.outs < 3 && s.bases[2]) {
        const r3 = s.bases[2];
        s.bases[2] = null;
        move(r3, 3, 4);
        result.sacFly = true;
        result.label = 'SAC FLY!';
        result.description = 'Caught in the outfield, runner tags and scores.';
      } else {
        result.label = 'FLY OUT';
        result.description = 'Caught in the outfield.';
      }
      endPlateAppearance();
      break;
    }
    case 'popOut':
    case 'lineOut':
    case 'strikeout': {
      const batter = batterRunner();
      move(batter, 0, 'out');
      recordOut();
      result.label = play.type === 'popOut' ? 'POP OUT' : play.type === 'lineOut' ? 'LINE OUT' : 'STRIKEOUT';
      result.description =
        play.type === 'popOut' ? 'Popped up to the infield.' : play.type === 'lineOut' ? 'Lined right at a fielder.' : 'Swing and a miss, strike three.';
      endPlateAppearance();
      break;
    }
    case 'walk': {
      advanceForced();
      const b = batterRunner();
      s.bases[0] = b;
      move(b, 0, 1);
      result.label = 'WALK';
      result.description = 'Four balls, take your base.';
      endPlateAppearance();
      break;
    }
    case 'error': {
      advanceAll(1);
      const b = batterRunner();
      s.bases[0] = b;
      move(b, 0, 1);
      line(s, fieldingTeam(s)).errors += 1;
      result.label = 'ERROR!';
      result.description = 'Bobbled in the field, everybody is safe.';
      endPlateAppearance();
      break;
    }
    case 'foul': {
      if (s.strikes < 2) s.strikes += 1;
      result.label = 'FOUL BALL';
      result.description = s.strikes >= 2 ? 'Foul ball, the count stays at two strikes.' : 'Foul ball, strike.';
      break;
    }
    case 'strike': {
      s.strikes += 1;
      if (s.strikes >= 3) {
        const batter = batterRunner();
        move(batter, 0, 'out');
        recordOut();
        result.strikeoutLooking = true;
        result.label = 'STRIKEOUT';
        result.description = 'Strike three, called.';
        endPlateAppearance();
      } else {
        result.label = `STRIKE ${s.strikes}`;
        result.description = 'Strike.';
      }
      break;
    }
    case 'ball': {
      s.balls += 1;
      if (s.balls >= 4) {
        advanceForced();
        const b = batterRunner();
        s.bases[0] = b;
        move(b, 0, 1);
        result.label = 'WALK';
        result.description = 'Ball four.';
        endPlateAppearance();
      } else {
        result.label = `BALL ${s.balls}`;
        result.description = 'Ball.';
      }
      break;
    }
    case 'steal': {
      const i = play.base - 1;
      const r = s.bases[i];
      if (!r) {
        result.label = 'NO RUNNER';
        result.description = 'Nobody on that base.';
        break;
      }
      const target = play.base + 1;
      if (target <= 3 && s.bases[target - 1]) {
        result.label = 'BASE OCCUPIED';
        result.description = 'The runner ahead has not moved.';
        break;
      }
      s.bases[i] = null;
      if (target >= 4) {
        move(r, play.base, 4);
        result.label = 'STOLE HOME!';
        result.description = 'Steal of home plate!';
      } else {
        s.bases[target - 1] = r;
        move(r, play.base, target as BaseIndex);
        result.label = `STOLEN BASE`;
        result.description = `Runner swipes ${target === 2 ? 'second' : 'third'}.`;
      }
      break;
    }
    case 'caughtStealing': {
      const i = play.base - 1;
      const r = s.bases[i];
      if (!r) {
        result.label = 'NO RUNNER';
        result.description = 'Nobody on that base.';
        break;
      }
      s.bases[i] = null;
      move(r, play.base, 'out');
      recordOut();
      result.label = 'CAUGHT STEALING';
      result.description = 'Thrown out trying to steal.';
      break;
    }
  }

  // ------------------------------------------------------------ inning / game bookkeeping
  const homeLeads = s.home.runs > s.away.runs;
  // Walk-off: home team takes the lead in the bottom of the final inning (or later).
  if (s.half === 'bottom' && s.inning >= s.totalInnings && homeLeads && !s.gameOver) {
    s.gameOver = true;
    s.winner = 'home';
    result.walkOff = true;
    result.gameOver = true;
    result.halfInningEnded = true;
    result.inningEnded = true;
    s.bases = [null, null, null];
    return { state: s, result };
  }

  if (s.outs >= 3) {
    result.halfInningEnded = true;
    s.outs = 0;
    s.bases = [null, null, null];
    resetCount(s);
    if (s.half === 'top') {
      // Home team does not need to bat if already ahead in the final inning.
      if (s.inning >= s.totalInnings && homeLeads) {
        s.gameOver = true;
        s.winner = 'home';
        result.gameOver = true;
        result.inningEnded = true;
      } else {
        s.half = 'bottom';
        ensureInningColumn(s);
      }
    } else {
      result.inningEnded = true;
      if (s.inning >= s.totalInnings && s.home.runs !== s.away.runs) {
        s.gameOver = true;
        s.winner = s.home.runs > s.away.runs ? 'home' : 'away';
        result.gameOver = true;
      } else {
        s.inning += 1;
        s.half = 'top';
        ensureInningColumn(s);
      }
    }
  }
  return { state: s, result };
}

/** Human readable inning text, e.g. "TOP 3" / "BOT 9". */
export function inningLabel(s: BaseballState): string {
  return `${s.half === 'top' ? 'TOP' : 'BOT'} ${s.inning}`;
}

export function scoreSummary(s: BaseballState): string {
  return `AWAY ${s.away.runs} - HOME ${s.home.runs}`;
}
