/**
 * The camera director: arbitrates every camera-worthy table event.
 *
 * Game logic asks for a "shot" when something deserves a close-up; the
 * director decides whether it may run (cinematics setting, ball safety,
 * priority, cooldowns, how much of the last minute was spent watching instead
 * of playing) and the renderer only ever follows the director's decisions.
 *
 * The core safety rule: a DIVE (a camera move that takes the playfield out of
 * view) only starts while no ball is free on the table, and it is aborted the
 * moment one becomes free. Live gameplay is never hidden.
 */

export type ShotKind = 'atBat' | 'homeRun' | 'city' | 'reactor' | 'jackpot' | 'multiball';
export type CinematicsMode = 'full' | 'minimal' | 'off';

export interface ShotDef {
  kind: ShotKind;
  /** Higher wins. A higher-priority request preempts a running lower one. */
  priority: number;
  /** Dives take the table out of view and require every ball to be safely captured. */
  dive: boolean;
  /** Mini-game shots: the attraction cannot be played without them. */
  essential: boolean;
  /** Watchdog: the shot always ends after this many seconds. */
  maxDuration: number;
  /** Seconds before the same kind may start again. */
  cooldown: number;
}

export const SHOTS: Record<ShotKind, ShotDef> = {
  multiball: { kind: 'multiball', priority: 1, dive: false, essential: false, maxDuration: 1.6, cooldown: 3 },
  atBat: { kind: 'atBat', priority: 2, dive: true, essential: false, maxDuration: 8, cooldown: 0 },
  homeRun: { kind: 'homeRun', priority: 3, dive: true, essential: false, maxDuration: 5, cooldown: 0 },
  city: { kind: 'city', priority: 4, dive: true, essential: true, maxDuration: 22, cooldown: 0 },
  reactor: { kind: 'reactor', priority: 5, dive: true, essential: true, maxDuration: 14, cooldown: 0 },
  jackpot: { kind: 'jackpot', priority: 6, dive: false, essential: false, maxDuration: 1.8, cooldown: 2 },
};

/** Seconds the camera needs to get back to the table; balls are released this long after a dive ends. */
export const CAMERA_EXIT_LEAD = 0.45;
/** Rolling window (seconds) and budget for optional dives. */
export const DIVE_WINDOW = 45;
export const DIVE_BUDGET = 0.4;
/** Queued requests expire after this long. */
export const QUEUE_TTL = 1.5;

export interface Shot {
  id: number;
  kind: ShotKind;
  def: ShotDef;
  t: number;
}

export type EndReason = 'done' | 'preempted' | 'unsafe' | 'watchdog' | 'reset';

export type DirectorEvent = { type: 'start'; shot: Shot } | { type: 'end'; shot: Shot; reason: EndReason };

export type RequestResult = 'started' | 'merged' | 'queued' | 'rejected';

export interface DirectorContext {
  /** Balls currently free on the playfield (not parked, guided or locked). */
  liveBalls: number;
}

export class Director {
  mode: CinematicsMode = 'full';
  active: Shot | null = null;
  readonly queue: Array<{ kind: ShotKind; ttl: number }> = [];
  readonly events: DirectorEvent[] = [];
  /** Seconds spent in optional dives, decaying over {@link DIVE_WINDOW}. */
  diveLoad = 0;
  lastRejection = '';
  private cooldowns = new Map<ShotKind, number>();
  private nextId = 1;

  /** Whether the setting allows this kind of shot at all. */
  allows(kind: ShotKind): boolean {
    if (this.mode === 'off') return false;
    if (this.mode === 'minimal') return SHOTS[kind].essential;
    return true;
  }

  /** Attraction mini-games capture the ball only when their camera can run. */
  get miniGamesEnabled(): boolean {
    return this.mode !== 'off';
  }

  /** True while a dive is on screen (the renderer has taken the camera off the table). */
  get diving(): boolean {
    return !!this.active && this.active.def.dive;
  }

  isActive(kind: ShotKind): boolean {
    return this.active?.kind === kind;
  }

  request(kind: ShotKind, ctx: DirectorContext): RequestResult {
    const def = SHOTS[kind];
    const reject = (why: string): RequestResult => {
      this.lastRejection = why;
      return 'rejected';
    };
    if (!this.allows(kind)) return reject('setting');
    if (def.dive && ctx.liveBalls > 0) return reject('unsafe');
    if ((this.cooldowns.get(kind) ?? 0) > 0) return reject('cooldown');
    // Optional dives are rationed so the player spends most of the time playing.
    if (def.dive && !def.essential && this.diveLoad > DIVE_WINDOW * DIVE_BUDGET) return reject('budget');
    const cur = this.active;
    if (cur) {
      if (cur.kind === kind) {
        cur.t = 0; // merge: extend the running shot
        return 'merged';
      }
      // A glance never interrupts a dive in progress (the dive owns a captured ball).
      if (def.priority > cur.def.priority && !(cur.def.dive && !def.dive)) {
        this.finish('preempted');
        this.begin(kind);
        return 'started';
      }
      if (def.essential) {
        // Mini-game shots wait for the current shot instead of being lost.
        if (!this.queue.some((q) => q.kind === kind)) this.queue.push({ kind, ttl: QUEUE_TTL });
        while (this.queue.length > 2) this.queue.shift();
        return 'queued';
      }
      return reject('busy');
    }
    this.begin(kind);
    return 'started';
  }

  /** Ends the running shot if it is of this kind. Returns true when something ended. */
  end(kind: ShotKind, reason: EndReason = 'done'): boolean {
    const q = this.queue.findIndex((x) => x.kind === kind);
    if (q >= 0) this.queue.splice(q, 1);
    if (this.active?.kind !== kind) return false;
    this.finish(reason);
    return true;
  }

  update(dt: number, ctx: DirectorContext): void {
    for (const [k, v] of this.cooldowns) {
      const next = v - dt;
      if (next <= 0) this.cooldowns.delete(k);
      else this.cooldowns.set(k, next);
    }
    this.diveLoad *= Math.exp(-dt / DIVE_WINDOW);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.queue[i].ttl -= dt;
      if (this.queue[i].ttl <= 0) this.queue.splice(i, 1);
    }
    const a = this.active;
    if (a) {
      a.t += dt;
      if (a.def.dive && !a.def.essential) this.diveLoad += dt;
      if (a.def.dive && ctx.liveBalls > 0) this.finish('unsafe');
      else if (a.t >= a.def.maxDuration) this.finish('watchdog');
    }
    if (!this.active && this.queue.length) {
      const next = this.queue.shift()!;
      this.request(next.kind, ctx);
    }
  }

  /** Clears everything (new game, game over, quit). */
  reset(): void {
    if (this.active) this.finish('reset');
    this.queue.length = 0;
    this.cooldowns.clear();
    this.diveLoad = 0;
  }

  /** Removes and returns the pending events. */
  drain(): DirectorEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private begin(kind: ShotKind): void {
    const shot: Shot = { id: this.nextId++, kind, def: SHOTS[kind], t: 0 };
    this.active = shot;
    this.events.push({ type: 'start', shot });
  }

  private finish(reason: EndReason): void {
    const shot = this.active;
    if (!shot) return;
    this.active = null;
    if (shot.def.cooldown > 0) this.cooldowns.set(shot.kind, shot.def.cooldown);
    this.events.push({ type: 'end', shot, reason });
  }
}
