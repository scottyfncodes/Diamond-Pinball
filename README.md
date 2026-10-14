# ⚾ DIAMOND PINBALL

A 3D arcade pinball machine built around a living miniature universe: a baseball stadium in the playfield,
a sandlot ballpark on the left wing, a reactor core in the bumper nest, a midway on the right wing and a monorail that
circles the whole machine. Hit the right shots and the camera dives into the world, you play a tiny game
with the flippers, and the pinball is handed back exactly where the rules say it should be.

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
| Mini-game timing windows (stunt, pulses) | 1.5x | 1.0x | 0.7x |
| Reactor charge needed | 0.7x | 1.0x | 1.3x |
| Syncs for reactor multiball | 1 | 2 | 3 |
| Sandlot signals needed | 2 of 3 | 3 | 3 |
| Wall Catch | 8.5 s, 6 obstacles | 7.2 s, 8 obstacles | 6.2 s, 10 obstacles |
| Ball save after an attraction | 8 s | 5 s | 3 s |

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

## The miniature universe

Three signature attractions, each with ambient life, a quick triggered spectacle and a full mini-game:

| Attraction | Where / how you get in | The mini-game | Rewards |
| --- | --- | --- | --- |
| **DIAMOND STADIUM** | The playfield itself. Any ramp in your half-inning is an at-bat. | The camera pushes in to a broadcast angle behind home plate. The pitch is announced; tap a flipper as the ring closes. Timing, ramp speed, barrel and power decide grounder / liner / fly / homer. | Hits, runs, home-run cinematic tracking the ball into the seats, derby, grand slams. |
| **THE SANDLOT** (left wing) | Roll through both inlanes and complete a drop bank to light the three SANDLOT signals (EASY needs two). The left ramp's diverter flips and the ball rides the skyway into the batting cage. | **WALL CATCH**: an outfielder sprints down the field. LEFT / RIGHT flipper moves him a lane. Catch fly balls, dodge mowers, tarp rollers and ball buckets (late dodges are NEAR MISSES), then tap as the ring closes to leap at the wall and rob a home run. | Score scaled by catches, near misses and the leap. A clean run that robs the homer raises the WORLD multiplier. Every robbed homer hangs a ROBBED! banner on the wall for the rest of the game; three banners are the WALL OF FAME bonus. Every run fills in another set of stands. |
| **THE REACTOR CORE** (bumper nest) | Bumpers, slingshots, lanes, targets and ramps charge three rings in order. When all three are full the iris opens: shoot the centre lane into the core. | **OVERLOAD**: the camera shows the core while a timing bar runs five times: a light slides toward a gold zone and you tap anywhere (or a flipper) while it is in the gold. | Jackpot scaled by synced pulses and reactor level. Enough syncs (1 / 2 / 3 by difficulty) start **REACTOR MULTIBALL** (bumpers fire COIL JACKPOTS). All five is a **MELTDOWN**: coils pay triple for 20 s and the WORLD multiplier rises. During multiball the open core pays a SUPER JACKPOT on contact without capturing. |

Around them: **THE MIDWAY** (Ferris wheel, looping roller coaster, carousel, string lights: a lock launches the coaster,
multiball turns the park up) and **THE MONORAIL** (circles the machine past the sandlot, behind the stands, down the
midway and through a tunnel under the playfield; it runs express for extra balls and big moments).

**GRAND TOUR:** a home run, a finished Wall Catch and a reactor overload in one game pay 750,000, raise the WORLD
multiplier, relight the sandlot diverter and the reactor core, and set the whole universe off.

### The camera never costs you the ball

- Every close-up goes through one **camera director** (`src/game/director.ts`): priorities, a queue for mini-game
  shots, duplicate merging, cooldowns, a watchdog on every shot, and a budget that rations optional dives
  (at-bats) so you spend most of the time playing.
- A **dive** only starts while no ball is free on the table (the ball is parked on the ramp return, in the sandlot
  batting cage or in the reactor core) and is aborted the instant one becomes free. During multiball the camera stays on
  the table.
- When a dive ends the camera starts home first and the ball is released a beat later (`CAMERA_EXIT_LEAD`), with a
  short ball save. Table timers (ball save, combo, hype, pitch clock, modes) are frozen while an attraction owns the ball.
- **Settings → CAMERA DIVES**: FULL, MINI-GAMES (only the sandlot and reactor dive) or OFF (pure pinball: the sandlot is a
  sightseeing lap and the reactor overload resolves instantly; the ball is never captured).

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
- Everything is procedural: cabinet, playfield art, stadium, sandlot, reactor, midway, crowd and players are generated
  at runtime with merged and instanced geometry. No network assets.
- Attraction rules are pure modules (`src/attractions/cityRush.ts` (Wall Catch; it keeps its original file name), `src/attractions/reactor.ts`) unit tested
  without a browser; their views (`src/render/SandlotView.ts`, `ReactorView.ts`, `MidwayView.ts`) only read game
  state and events. The camera rig (`src/render/CameraRig.ts`) blends every shot from wherever the camera is,
  with eased entries and exits and its own watchdog.
- New attractions plug into the same pieces: a physical route in `table/layout.ts`, a rules module, a shot kind in
  the director and a view with a `cameraPose`.

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
