# ⚾ DIAMOND PINBALL

A 3D arcade pinball machine with a living miniature baseball stadium inside.
Shoot the ramps to bring your batter to the plate, time the swing with a flipper,
and watch tiny runners round the bases while the steel ball keeps rolling.

**Play it:** https://scottyfncodes.github.io/Diamond-Pinball/

## How it plays

- **Flippers:** hold the left / right halves of the screen (or `←` `→`, `Z` `X`, `A` `D`, Shift keys).
- **Launch:** hold the LAUNCH button (or `Space`) and release. A lit top lane right after launch is the **skill shot**.
- **Bat:** the **LEFT FIELD** and **RIGHT FIELD** ramps start an at-bat. When the pitch arrives, tap a flipper to swing.
  Contact quality is computed from the ramp shot speed, your swing timing, charged **POWER** (the 2B centre lane),
  your shot combo and lit field target banks. Nothing is a hidden dice roll.
- **Steal:** when a runner is on base, that base's target blinks. Hit it to steal.
- **Lock / Multiball:** hit 1B, 2B and 3B to light LOCK, then shoot the dugout saucer. Two locks and the next one
  starts MULTIBALL, where every ramp is a jackpot at-bat.
- **Home run lane:** the far-left orbit. Hit it once to light it, hit it again for a premium at-bat.
- **Defense (opponent batting):** bumpers, slingshots, targets and lanes build your defense rating; ramps strike the
  batter out; the blinking base target makes an instant play; the home run lane picks off a runner.
- **Pitch clock:** on offense, dawdling calls strikes. Three strikes is an out.
- 3 pinballs per game, generous ball save, kickback on the left outlane after completing the top lanes.

Quick games are 3 innings; a full game is 9 innings with extra innings when tied. Progress, high scores,
achievements and unlockable table styles are saved locally in the browser.

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
