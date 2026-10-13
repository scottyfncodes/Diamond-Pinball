# Diamond Pinball: build plan

## Goal
One flagship 3D pinball table whose shots drive a real baseball game played by tiny animated players inside the machine.

## Architecture (all in `src/`)
| Layer | Module | Notes |
| --- | --- | --- |
| Physics | `physics/World.ts`, `physics/collision.ts` | 2D swept circle vs segment/circle solver, fixed 1/240 s sub-steps, flippers as moving capsules, guided ramps, sensors, gates, stuck recovery. Pure TS, unit tested. |
| Table | `table/layout.ts` | Geometry + element metadata for the table (walls, posts, bumpers, targets, lamps, ramps, saucer, lanes, diamond). |
| Baseball | `baseball/rules.ts`, `batting.ts`, `defense.ts` | Pure rules engine (innings, outs, runners, force/double plays, sac flies, walk-offs, extras) and skill-driven outcome models. |
| Difficulty | `game/difficulty.ts` | The single difficulty config (EASY / MEDIUM / HARD): ball scale, speed scale, combo and swing windows, flipper forgiveness, ball save, score scale, lock count, mode timers, Impossible Inning requirements. |
| Modes | `game/modifiers.ts`, `game/modes.ts` | Pure state for table modifiers (stacking, timers), multiball modes, bosses and the Impossible Inning chain. |
| Game | `game/Game.ts`, `scoring.ts`, `save.ts`, `achievements.ts` | Orchestrates modes (offense / defense), batting events, multiball modes, bosses, modifiers, ball save, scoring (capped + rate limited), achievements, per-difficulty persistence. Emits typed events on an `EventBus`. |
| Render | `render/*` | Three.js cabinet, playfield, stadium, players, ball, effects, camera rig. Observes game events only. |
| UI | `ui/*`, `input/*`, `audio/*` | DOM HUD/menus/tutorial, pointer + keyboard input, Web Audio synth. |

## Pinball ↔ baseball interface
- Ramp entry (`rampEnter` with shot quality) → `Game.startBatting(lane, quality)` → swing timing from the next flipper press →
  `computeBatting()` → `applyPlay()` → runner moves / runs / outs → lamps, multiplier and modes update.
- Opponent half-innings: pinball activity builds a defense rating; `resolveDefense()` resolves each opponent at-bat on a clock;
  ramps, lit targets and the HR lane produce instant outs.

## Difficulty → physics
- `Game.applyBaseline()` sets `World.baseline` (ball radius, time scale, flipper capsule / power) and ramp thresholds.
- `World.substep` advances ball dynamics by `h * timeScale` and flippers by real `h`; flipper surface velocity is converted
  into ball-time units so a slowed table keeps full-strength shots.
- Modifiers write `World.mods` (gravityScale, timeScale, ballScale, launchScale), attractors and per-ball thrust;
  `endAllModifiers()` restores the baseline exactly on ball loss and game over.

## Verification
- `npm test`: physics (tunnelling, pockets per ball size, time scale, ramps, flippers, stuck recovery, modifier cleanup),
  baseball rules, batting, scoring caps, saves (per-difficulty tables, v1 migration), difficulty initialisation, modifiers,
  multiball modes, bosses, the Impossible Inning, new targets, game flow.
- `npm run e2e`: Playwright on desktop and an iPhone-sized landscape viewport: launch, flippers, batting event, scoring a run,
  pause/resume/restart, game completion, high score persistence, settings, layout overflow.
- `npm run typecheck` and `npm run build`.
