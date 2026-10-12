# ⚾ DIAMOND PINBALL

A 3D arcade pinball machine with a living miniature baseball stadium inside.
Shoot the ramps to bring your batter to the plate, time the swing with a flipper,
and watch tiny runners round the bases while the steel ball keeps rolling.

**Play it:** https://scottyfncodes.github.io/Diamond-Pinball/

## How it plays

- **Flippers:** hold the left / right halves of the screen (or `←` `→`, `Z` `X`, `A` `D`, Shift keys).
- **Launch:** hold the LAUNCH button (or `Space`) and release. The blinking top lane right after launch is the **skill shot**.
- **The ramp is your at-bat.** Make the LEFT FIELD or RIGHT FIELD ramp and the steel ball parks on the ramp return
  while the pitch comes in, so swinging never costs you a live ball. The pitch is announced (fastball, slider,
  curveball, changeup) and a ring closes on home plate.
- **Swing with a flipper as the ring closes.** Timing decides the launch: early swings roll over into grounders,
  on-time swings get airborne, late swings pop up. How hard it's hit comes from ramp speed, how centred the ball went
  up the ramp (the "barrel"), charged **POWER** (2B centre lane), your combo, lit field banks, RALLY and CLUTCH.
  A contact card shows exactly why the swing did what it did. Not swinging gets a call from the umpire.
- **Home runs** freeze the stadium for a heartbeat, the camera tracks the ball into the seats and fireworks go off
  where it lands. Tap a flipper to skip. During multiball the camera never leaves the table.
- **HYPE meter:** every meaningful shot and baseball moment fills it; idling drains it. Fill it to start a **RALLY**:
  double scoring, better contact and a lit HOME RUN orbit for 20 seconds. Losing a ball halves the meter.
- **Situations:** bases loaded lights the grand slam orbit. The final inning is **CLUTCH TIME** when tied or trailing
  (runs score double, contact boosted) or **CLOSE IT OUT** when leading (defense builds faster).
- **Steal:** when a runner is on base, that base's target blinks. Hit it to steal.
- **Lock / Multiball:** hit 1B, 2B and 3B to light LOCK, then shoot the dugout saucer. Two locks and the next one
  starts MULTIBALL, where every ramp is a jackpot at-bat.
- **Defense (opponent batting):** bumpers, slingshots, targets and lanes build your defense rating before each pitch;
  ramps strike the batter out; a completed target bank is a diving web gem; the blinking base target makes an instant
  play; the home run lane picks off a runner. Weak defense can boot a grounder for an error.
- **Pitch clock:** on offense, dawdling calls strikes. Three strikes is an out.
- 3 pinballs per game, generous ball save, kickback on the left outlane after completing the top lanes. The game-over
  screen shows a highlight reel of your best moments.

## Tech

- TypeScript + Vite, Three.js for rendering, HTML/CSS for HUD and menus, Web Audio for fully synthesised sound.
- A custom deterministic 2D swept-collision pinball solver (`src/physics`) tuned for touch play: no tunnelling,
  continuous flipper contact, guided ramps, one-way gates, stuck-ball recovery.
- A pure baseball rules engine (`src/baseball/rules.ts`) and batting / defense models that can be unit tested without a browser.
- Everything is procedural: cabinet, playfield art, stadium, crowd and players are generated at runtime. No network assets.

## Development

```bash
npm install
npm run dev        # local dev server
npm run typecheck  # tsc
npm test           # vitest unit tests
npm run build      # production build to dist/
npm run e2e        # playwright end-to-end (builds must exist: npm run build first)
```

Deployment is automatic: pushes to `main` build and publish to GitHub Pages via `.github/workflows/deploy.yml`.
