/**
 * Table-changing events ("BREAK THE LAWS OF PINBALL"). This module is the pure
 * bookkeeping: which modifiers run, for how long, and which may stack. The
 * Game applies them to the physics world and always restores the difficulty
 * baseline when they end.
 */
export type ModifierId =
  | 'gravityFlip'
  | 'turboLaunch'
  | 'giantBall'
  | 'splitBall'
  | 'magnet'
  | 'lightning'
  | 'wallBounce'
  | 'slowMo'
  | 'blackHole'
  | 'rocketBall';

export interface ModifierDef {
  id: ModifierId;
  name: string;
  sub: string;
  /** Base duration in seconds (0 = instantaneous). */
  duration: number;
  color: number;
  /** Modifiers in the same group never run together. */
  group: 'physics' | 'ball' | 'table' | 'instant';
  /** Points awarded when the modifier starts. */
  bonus: number;
}

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  gravityFlip: { id: 'gravityFlip', name: 'GRAVITY FLIP', sub: 'The ball falls UP. Hold on.', duration: 4, color: 0xc77dff, group: 'physics', bonus: 15000 },
  turboLaunch: { id: 'turboLaunch', name: 'TURBO LAUNCH', sub: 'Next plunge fires at ridiculous speed', duration: 0, color: 0xff8a3b, group: 'instant', bonus: 5000 },
  giantBall: { id: 'giantBall', name: 'GIANT BASEBALL', sub: 'The ball grows: nothing gets past it', duration: 12, color: 0xffffff, group: 'ball', bonus: 15000 },
  splitBall: { id: 'splitBall', name: 'SPLIT BALL', sub: 'One ball becomes three', duration: 0, color: 0x9be7ff, group: 'instant', bonus: 20000 },
  magnet: { id: 'magnet', name: 'MAGNETIC INFIELD', sub: 'Lit targets pull the ball in', duration: 12, color: 0x4fe3ff, group: 'physics', bonus: 15000 },
  lightning: { id: 'lightning', name: 'LIGHTNING ROUND', sub: 'Every target hit chains to its neighbours', duration: 15, color: 0xfff176, group: 'table', bonus: 15000 },
  wallBounce: { id: 'wallBounce', name: 'WALL BOUNCE', sub: 'Outlanes and the drain grow rebound rails', duration: 14, color: 0x7cff5a, group: 'table', bonus: 15000 },
  slowMo: { id: 'slowMo', name: 'SLOW-MOTION CLUTCH', sub: 'Time slows for the critical save', duration: 0.7, color: 0xffffff, group: 'physics', bonus: 0 },
  blackHole: { id: 'blackHole', name: 'PINBALL BLACK HOLE', sub: 'Captured... and spat back out in a burst', duration: 0, color: 0x1b1b3a, group: 'instant', bonus: 20000 },
  rocketBall: { id: 'rocketBall', name: 'ROCKET BALL', sub: 'Self-propelled, double points on every hit', duration: 10, color: 0xff4d6d, group: 'ball', bonus: 10000 },
};

export interface ActiveModifier {
  id: ModifierId;
  remaining: number;
  total: number;
}

export const MAX_ACTIVE_MODIFIERS = 2;

export interface ModifierState {
  active: ActiveModifier[];
}

export const createModifierState = (): ModifierState => ({ active: [] });

export const hasModifier = (m: ModifierState, id: ModifierId): boolean => m.active.some((a) => a.id === id);

export const modifierRemaining = (m: ModifierState, id: ModifierId): number => m.active.find((a) => a.id === id)?.remaining ?? 0;

/**
 * Attempts to start a timed modifier. Instant modifiers always succeed (they
 * have no running state). Timed ones are refused when their group is busy or
 * too many run already; re-activating a running modifier refreshes it.
 */
export function activateModifier(m: ModifierState, id: ModifierId, duration = MODIFIERS[id].duration): 'started' | 'refreshed' | 'refused' {
  const def = MODIFIERS[id];
  if (def.group === 'instant' || duration <= 0) return 'started';
  const existing = m.active.find((a) => a.id === id);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, duration);
    existing.total = Math.max(existing.total, duration);
    return 'refreshed';
  }
  if (m.active.some((a) => MODIFIERS[a.id].group === def.group)) return 'refused';
  // Slow motion is a brief reflex aid and never counts against the limit.
  const counted = m.active.filter((a) => a.id !== 'slowMo').length;
  if (id !== 'slowMo' && counted >= MAX_ACTIVE_MODIFIERS) return 'refused';
  m.active.push({ id, remaining: duration, total: duration });
  return 'started';
}

/** Advances timers; returns the ids that expired this tick. */
export function tickModifiers(m: ModifierState, dt: number): ModifierId[] {
  const expired: ModifierId[] = [];
  for (const a of m.active) {
    a.remaining -= dt;
    if (a.remaining <= 0) expired.push(a.id);
  }
  m.active = m.active.filter((a) => a.remaining > 0);
  return expired;
}

/** Ends every running modifier; returns the ids that were running. */
export function clearModifiers(m: ModifierState): ModifierId[] {
  const ids = m.active.map((a) => a.id);
  m.active = [];
  return ids;
}

export function endModifier(m: ModifierState, id: ModifierId): boolean {
  const before = m.active.length;
  m.active = m.active.filter((a) => a.id !== id);
  return m.active.length !== before;
}
