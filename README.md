# ⚾ DIAMOND PINBALL

A 3D arcade pinball machine with a living miniature baseball stadium inside.
Shoot the ramps to bring your batter to the plate, time the swing with a flipper,
and watch tiny runners round the bases while the steel ball keeps rolling.

**Play it:** https://scottyfncodes.github.io/Diamond-Pinball/

## Pick your game: EASY · MEDIUM · HARD

Every run starts on the difficulty selector. The three profiles are one centralised config (`src/game/difficulty.ts`) and
the differences are physically real: the ball's collision radius and the rate its dynamics advance change, not just a sprite.

| | EASY · SLUGGER | MEDIUM · ALL-STAR | HARD · HALL OF FAME |
| --- | --- | --- | --- |
| Ball size | 130% | 100% | 78% |
| Ball speed | 72% | 100% | 128% |
| Combo window | 1.5x | 1.0x | 0.75x |
| Swing window | 1.5x | 1.0x | 0.7x |
| Flippers | snappier, punchier | standard | thinner tips |
| Ball save | 18 s + kickback every ball | 12 s | 7 s |
| Score | x0.85 | x1.0 | x1.5 |
| Multiball lock | 1 lock | 2 locks | 2 locks |
| Wall markers | any order | any order | left → right |

The selector shows a live preview of each ball's relative size and speed, remembers the last choice, and difficulty only
changes between runs (the pause menu's CHANGE DIFFICULTY confirms, ends the run and reopens the selector). High scores
and the Impossible Inning achievements are tracked per difficulty.

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

### Every target is baseball

- **Mound:** roll over the pitcher's mound fast to rattle the pitcher and light **HOME PLATE** (a strike on defense).
- **Home plate:** lit, it scores the runner from third (**SQUEEZE PLAY**) or charges batting power.
- **Outfield wall:** hard hits bounce off for a bonus and light the 330 / 410 / 330 distance markers. All three lit =
  **WALL CLEARED** (home run lane lit) and the first time summons **THE WALL**.
- **Scoreboard:** all three bumpers inside two seconds doubles scoring for ten seconds, starts **LIGHTNING ROUND** and,
  every second cycle, lights the **BLACK HOLE** on the centre bumper.
- **Bullpen:** the dugout saucer (when lock is not lit) queues a special pitch for the next at-bat: an **EEPHUS**, a
  **103 MPH HEATER** or a **KNUCKLEBALL**. Two visits in one ball start **BASEBALL MULTIBALL**.

### Break the laws of pinball

Table modifiers are real physics, layered on the difficulty baseline and always cleaned up (ball lost, game over, timer):
ROCKET BALL (skill shot), GIANT BASEBALL and WALL BOUNCE (top lanes), LIGHTNING ROUND and the PINBALL BLACK HOLE (bumper
cycles), MAGNETIC INFIELD (both banks in one combo), TURBO LAUNCH (after a homer), GRAVITY FLIP / SPLIT BALL (boss
prizes) and SLOW-MOTION CLUTCH (a ball diving at the drain during a clutch or boss moment). At most two run together.

### Multiball, bosses and THE IMPOSSIBLE INNING

- **MULTIBALL** (locks), **BASEBALL MULTIBALL** (every lit target is a base hit), **HOME RUN DERBY** (back-to-back
  homers: chain them to raise the derby multiplier), **CHAOS MULTIBALL** (five balls, a roving jackpot, x1.5 scoring).
- Bosses emerge from play: **THE ACE** (three strikeouts against you; three hits chase him), **THE WALL** (clear the
  markers, hit the lit section three times, then hit one over it), the **COMMISSIONER'S CHALLENGE** (a x5 combo; three
  objectives on one clock) and the **NINTH-INNING NIGHTMARE** (final inning, trailing, two outs, bases loaded; a
  walk-off pays 500,000).
- **THE IMPOSSIBLE INNING:** link PERFECT CONTACT, HOME RUN, MULTIBALL, STOLEN BASE and a x5 COMBO in one at-bat half
  (4 of 5 on EASY; HARD demands a perfect-contact homer). One million points, an extra ball, chaos multiball, and the
  whole stadium loses its mind.
- Announcements escalate with the outcome: NICE CONTACT, BARRELED UP, DEEP DRIVE, WARNING TRACK, GONE!, BACK-TO-BACK!,
  GRAND SLAM!, WALK-OFF!, ABSOLUTE LEGEND. Scoring is capped (x24 total multiplier) and rate-limited so nothing runs away.
- Unlock table styles (Rooftop Arena, Lunar Park, Cosmic Championship...) and pinball skins (baseball, gold, fireball,
  cosmic) with achievements. A REDUCED screen-effects option removes shake, slow motion and flashes.

## Tech

- TypeScript + Vite, Three.js for rendering, HTML/CSS for HUD and menus, Web Audio for fully synthesised sound.
- A custom deterministic 2D swept-collision pinball solver (`src/physics`) tuned for touch play: no tunnelling,
  continuous flipper contact, guided ramps, one-way gates, stuck-ball recovery. Ball dynamics advance at the
  difficulty's time scale while flippers stay in real time; a `PhysicsBaseline` plus temporary modifiers (gravity,
  ball scale, attractors, thrust, time scale) means a power-up can never overwrite the difficulty settings.
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
