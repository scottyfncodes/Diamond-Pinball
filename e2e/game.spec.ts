import { expect, test, type Page } from '@playwright/test';

const chromiumArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
test.use({ launchOptions: { args: chromiumArgs } });

type DiamondApi = {
  game: {
    state: string;
    score: number;
    ballsLeft: number;
    offense: boolean;
    batting: unknown;
    baseball: { outs: number; half: string; inning: number; away: { runs: number }; home: { runs: number }; gameOver: boolean };
    world: { balls: Array<{ state: string; pos: { x: number; y: number }; vel: { x: number; y: number } }>; flippers: Map<string, { angle: number; active: boolean }> };
    stats: { hits: number; homeRuns: number };
    debug: {
      placeBall(pos: { x: number; y: number }, vel: { x: number; y: number }): unknown;
      forceBatting(lane: string, quality: number): void;
      forcePlay(play: unknown): void;
      swingAt(offsetSeconds: number): void;
      addHype(amount: number): void;
      drain(): void;
      setBallSave(seconds: number): void;
      finish(): void;
    };
    hrLit: boolean;
    power: number;
    rally: boolean;
    profile: { id: string; title: string; ballScale: number };
    multiball: boolean;
    multiballMode: string;
    boss: { id: string } | null;
    modifiers: { active: Array<{ id: string }> };
    setFlipper(side: 'left' | 'right', pressed: boolean): void;
    quickLaunch(): void;
    launcherBall(): { radius: number } | undefined;
  };
  frames(): number;
};

declare const window: Window & { __diamond: DiamondApi };

const waitFrames = async (page: Page, n: number) => {
  const start = await page.evaluate(() => window.__diamond.frames());
  await page.waitForFunction((target) => window.__diamond.frames() >= target, start + n, { timeout: 30_000 });
};

const startGame = async (page: Page, difficulty: 'easy' | 'medium' | 'hard' = 'medium') => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?quality=low');
  await expect(page.getByTestId('play')).toBeVisible();
  await page.getByTestId('play').click();
  await expect(page.locator('.screen-select')).toBeVisible();
  await page.locator(`.diff-card[data-difficulty="${difficulty}"]`).click();
  await expect(page.locator(`.diff-card[data-difficulty="${difficulty}"]`)).toHaveClass(/is-selected/);
  await page.getByTestId('start').click();
  await page.waitForFunction(() => window.__diamond?.game.state === 'playing');
  return errors;
};

test('title renders the machine and starts a game with a ball on the plunger', async ({ page }) => {
  const errors = await startGame(page);
  await waitFrames(page, 5);
  const info = await page.evaluate(() => ({ balls: window.__diamond.game.ballsLeft, launcher: !!window.__diamond.game.launcherBall(), offense: window.__diamond.game.offense }));
  expect(info.balls).toBe(3);
  expect(info.launcher).toBe(true);
  expect(info.offense).toBe(true);
  await expect(page.locator('.hud-scoreboard')).toBeVisible();
  await expect(page.locator('#launch')).toBeVisible();
  expect(errors).toEqual([]);
});

test('launch button plunges the ball and both flippers respond to touch zones', async ({ page }) => {
  await startGame(page);
  const launch = page.locator('#launch');
  await launch.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true });
  await waitFrames(page, 20);
  await launch.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true });
  await page.waitForFunction(() => window.__diamond.game.world.balls.some((b) => b.state === 'free'));
  await waitFrames(page, 10);
  const ballY = await page.evaluate(() => window.__diamond.game.world.balls[0].pos.y);
  expect(ballY).toBeGreaterThan(5);

  const left = page.locator('#touch-left');
  const right = page.locator('#touch-right');
  await left.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: true });
  await right.dispatchEvent('pointerdown', { pointerId: 3, isPrimary: false });
  await waitFrames(page, 8);
  const active = await page.evaluate(() => ({ l: window.__diamond.game.world.flippers.get('left_flipper')!.active, r: window.__diamond.game.world.flippers.get('right_flipper')!.active }));
  expect(active).toEqual({ l: true, r: true });
  await left.dispatchEvent('pointerup', { pointerId: 2 });
  await right.dispatchEvent('pointercancel', { pointerId: 3 });
  await waitFrames(page, 4);
  const released = await page.evaluate(() => ({ l: window.__diamond.game.world.flippers.get('left_flipper')!.active, r: window.__diamond.game.world.flippers.get('right_flipper')!.active }));
  expect(released).toEqual({ l: false, r: false });
});

test('a ramp shot triggers a batting event, a swing, and the baseball state updates', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const g = window.__diamond.game;
    g.quickLaunch();
    g.debug.placeBall({ x: 4.5, y: 21.5 }, { x: 0, y: 118 });
  });
  await page.waitForFunction(() => window.__diamond.game.batting !== null, undefined, { timeout: 15_000 });
  await expect(page.locator('.hud-swing')).toHaveClass(/is-visible/);
  // Wait (in game time) until the batter is allowed to swing, then swing with the keyboard flipper.
  await page.waitForFunction(() => {
    const b = window.__diamond.game.batting as { t: number; pitchDelay: number } | null;
    return !b || b.t >= b.pitchDelay - 0.5;
  }, undefined, { timeout: 30_000 });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__diamond.game.batting === null || (window.__diamond.game.batting as { swung: boolean }).swung, undefined, { timeout: 30_000 });
  const stateText = await page.locator('.hud-toasts').textContent();
  expect(stateText?.length).toBeGreaterThan(0);
  const score = await page.evaluate(() => window.__diamond.game.score);
  expect(score).toBeGreaterThan(5000);
});

test('the ramp parks the ball for the at-bat; a home run cinematic is skippable with a flipper', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const g = window.__diamond.game;
    g.quickLaunch();
    g.power = 3;
    g.debug.placeBall({ x: 4.5, y: 21.5 }, { x: 0, y: 118 });
  });
  await page.waitForFunction(() => window.__diamond.game.batting !== null, undefined, { timeout: 30_000 });
  await expect(page.locator('.swing-pitch')).not.toHaveText('');
  // Freeze game time while we line up a perfect swing (headless rendering is slow).
  await page.evaluate(() => {
    const g = window.__diamond.game as unknown as { update: (dt: number) => void; __u?: (dt: number) => void };
    g.__u = g.update;
    g.update = () => {};
  });
  await page.evaluate(() => window.__diamond.game.debug.swingAt(0));
  const hr = await page.evaluate(() => window.__diamond.game.stats.homeRuns);
  expect(hr).toBe(1);
  await expect(page.locator('.skip-hint')).toHaveClass(/is-visible/);
  await expect(page.locator('.contact-card')).toHaveClass(/is-visible/);
  await expect(page.locator('.contact-card')).toContainText('PERFECT');
  await page.evaluate(() => {
    const g = window.__diamond.game as unknown as { update: (dt: number) => void; __u?: (dt: number) => void; setFlipper: (s: 'left', p: boolean) => void; batting: unknown };
    g.update = g.__u!;
    g.setFlipper('left', true);
    g.setFlipper('left', false);
  });
  await expect(page.locator('.skip-hint')).not.toHaveClass(/is-visible/);
  const batting = await page.evaluate(() => window.__diamond.game.batting);
  expect(batting).toBeNull();
  await expect(page.locator('.sb-you .sb-runs')).toHaveText('1');
});

test('filling the hype meter starts a rally shown in the HUD', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => window.__diamond.game.debug.addHype(100));
  await expect(page.locator('.hud')).toHaveClass(/is-rally/);
  await expect(page.locator('.ps-hype-label')).toContainText('RALLY');
  await expect(page.locator('.ps-mult')).toHaveText('x2');
});

test('runs score, pause/resume works, restart resets, and the game can be completed', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const g = window.__diamond.game;
    g.debug.forcePlay({ type: 'triple' });
    g.debug.forcePlay({ type: 'single', contact: 0.4 });
  });
  await expect(page.locator('.sb-you .sb-runs')).toHaveText('1');
  await expect(page.locator('.sb-base-1')).toHaveClass(/is-on/);

  await page.getByTestId('pause').click();
  await expect(page.locator('.screen-pause')).toBeVisible();
  const paused = await page.evaluate(() => window.__diamond.game.state);
  expect(paused).toBe('paused');
  await page.getByTestId('resume').click();
  await page.waitForFunction(() => window.__diamond.game.state === 'playing');

  await page.keyboard.press('KeyP');
  await expect(page.locator('.screen-pause')).toBeVisible();
  await page.locator('.screen-pause button', { hasText: 'RESTART' }).click();
  await page.waitForFunction(() => window.__diamond.game.state === 'playing' && window.__diamond.game.baseball.away.runs === 0);

  // Finish a whole quick game: 3 innings of outs with one home run for the player.
  await page.evaluate(() => {
    const g = window.__diamond.game;
    g.debug.forcePlay({ type: 'homeRun' });
    for (let i = 0; i < 18 && !g.baseball.gameOver; i++) g.debug.forcePlay({ type: 'strikeout' });
  });
  await expect(page.locator('.screen-over')).toBeVisible();
  await expect(page.locator('.screen-over .panel-title')).toHaveText('YOU WIN!');
  await expect(page.locator('.screen-over')).toContainText('HOME RUNS');
  await page.getByTestId('play-again').click();
  await page.waitForFunction(() => window.__diamond.game.state === 'playing');
});

test('losing all balls ends the game and the high score persists across reloads', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const g = window.__diamond.game;
    g.debug.placeBall({ x: 10.3, y: 33 }, { x: 0, y: 40 });
  });
  await waitFrames(page, 30);
  await page.evaluate(() => {
    const g = window.__diamond.game;
    for (let i = 0; i < 3; i++) {
      g.quickLaunch();
      g.debug.setBallSave(0);
      g.debug.drain();
    }
  });
  await expect(page.locator('.screen-over')).toBeVisible();
  await expect(page.locator('.screen-over .panel-title')).toHaveText('GAME OVER');
  const score = await page.evaluate(() => window.__diamond.game.score);
  expect(score).toBeGreaterThan(0);
  await page.reload();
  await page.locator('.btn-link', { hasText: 'HIGH SCORES' }).click();
  await expect(page.locator('.score-table')).toContainText(score.toLocaleString('en-US'));
});

test('settings controls are functional and persist', async ({ page }) => {
  await page.goto('./?quality=low');
  await page.locator('.btn-link', { hasText: 'SETTINGS' }).click();
  await page.locator('.btn-choice', { hasText: 'REDUCED' }).click();
  await page.locator('.btn-choice', { hasText: '9 INNINGS' }).click();
  await page.locator('.btn-primary', { hasText: 'BACK' }).click();
  await page.reload();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('diamond-pinball/save/v1') || '{}').settings);
  expect(settings.reducedEffects).toBe(true);
  expect(settings.innings).toBe(9);
  await page.getByTestId('play').click();
  await expect(page.locator('.btn-mode[data-innings="9"]')).toHaveClass(/is-selected/);
});

test('the difficulty selector remembers the last choice and changes the real ball size and speed', async ({ page }) => {
  await startGame(page, 'easy');
  const easy = await page.evaluate(() => ({ id: window.__diamond.game.profile.id, r: window.__diamond.game.launcherBall()!.radius }));
  expect(easy.id).toBe('easy');
  expect(easy.r).toBeCloseTo(0.65, 3);
  await expect(page.locator('.ps-diff')).toContainText('SLUGGER');
  await page.reload();
  await page.getByTestId('play').click();
  await expect(page.locator('.diff-card[data-difficulty="easy"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.diff-preview')).toBeVisible();
  await page.locator('.diff-card[data-difficulty="hard"]').click();
  await expect(page.getByTestId('start')).toContainText('HALL OF FAME');
  await page.getByTestId('start').click();
  await page.waitForFunction(() => window.__diamond?.game.state === 'playing');
  const hard = await page.evaluate(() => ({ id: window.__diamond.game.profile.id, r: window.__diamond.game.launcherBall()!.radius }));
  expect(hard.id).toBe('hard');
  expect(hard.r).toBeCloseTo(0.39, 3);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('diamond-pinball/save/v1') || '{}').settings.difficulty);
  expect(saved).toBe('hard');
});

test('changing difficulty mid-run asks for confirmation and starts a fresh run', async ({ page }) => {
  await startGame(page, 'medium');
  await page.getByTestId('pause').click();
  await page.getByTestId('change-difficulty').click();
  await expect(page.locator('.screen-confirm')).toBeVisible();
  await page.locator('.screen-confirm button', { hasText: 'KEEP PLAYING' }).click();
  await expect(page.locator('.screen-pause')).toBeVisible();
  const still = await page.evaluate(() => window.__diamond.game.profile.id);
  expect(still).toBe('medium');
  await page.getByTestId('change-difficulty').click();
  await page.getByTestId('confirm-change').click();
  await expect(page.locator('.screen-select')).toBeVisible();
  await page.locator('.diff-card[data-difficulty="easy"]').click();
  await page.getByTestId('start').click();
  await page.waitForFunction(() => window.__diamond?.game.state === 'playing' && window.__diamond.game.profile.id === 'easy');
});

test('table modifiers, bosses and multiball modes run and show in the HUD', async ({ page }) => {
  await startGame(page, 'medium');
  await page.evaluate(() => {
    const g = window.__diamond.game as unknown as { quickLaunch(): void; debug: { modifier(id: string): boolean; boss(id: string): void; multiball(mode: string): void } };
    g.quickLaunch();
    g.debug.modifier('rocketBall');
    g.debug.boss('wall');
    g.debug.multiball('chaos');
  });
  await expect(page.locator('.mod-row.mod-rocketBall')).toBeVisible();
  await expect(page.locator('.hud-boss')).toHaveClass(/is-visible/);
  await expect(page.locator('.hud-boss')).toContainText('THE WALL');
  await expect(page.locator('.hud')).toHaveAttribute('data-multiball', 'chaos');
  const info = await page.evaluate(() => ({ balls: window.__diamond.game.world.balls.filter((b) => b.state === 'free').length, boss: window.__diamond.game.boss?.id, mods: window.__diamond.game.modifiers.active.map((a) => a.id) }));
  expect(info.balls).toBeGreaterThanOrEqual(4);
  expect(info.boss).toBe('wall');
  expect(info.mods).toContain('rocketBall');
  await waitFrames(page, 30);
  const errors = await page.evaluate(() => window.__diamond.game.state);
  expect(errors).toBe('playing');
});

test('high scores are kept per difficulty', async ({ page }) => {
  await startGame(page, 'hard');
  await page.evaluate(() => {
    const g = window.__diamond.game;
    g.debug.placeBall({ x: 10.3, y: 33 }, { x: 0, y: 40 });
  });
  await waitFrames(page, 20);
  await page.evaluate(() => window.__diamond.game.debug.finish());
  await expect(page.locator('.screen-over')).toBeVisible();
  await expect(page.locator('.screen-over .diff-chip')).toContainText('HALL OF FAME');
  await page.locator('.screen-over button', { hasText: 'TITLE' }).click();
  await page.locator('.btn-link', { hasText: 'HIGH SCORES' }).click();
  await page.locator('[data-scoretab="hard"]').click();
  await expect(page.locator('.score-table')).toBeVisible();
  await page.locator('[data-scoretab="easy"]').click();
  await expect(page.locator('.screen-scores')).toContainText('No SLUGGER games yet');
});

test('mobile layout has no horizontal overflow and keeps controls on screen', async ({ page }) => {
  await startGame(page);
  const vw = page.viewportSize()!;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  for (const sel of ['#launch', '.hud-scoreboard', '.hud-pinball', '[data-testid="pause"]', '.ps-diff']) {
    const box = await page.locator(sel).boundingBox();
    expect(box, sel).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vw.height + 1);
  }
  const launchBox = (await page.locator('#launch').boundingBox())!;
  expect(launchBox.height).toBeGreaterThanOrEqual(44);
});

test('the difficulty selector fits a phone screen with large touch targets', async ({ page }) => {
  await page.goto('./?quality=low');
  await page.getByTestId('play').click();
  await expect(page.locator('.screen-select')).toBeVisible();
  const vw = page.viewportSize()!;
  for (const id of ['easy', 'medium', 'hard']) {
    const box = (await page.locator(`.diff-card[data-difficulty="${id}"]`).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(90);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw.width + 1);
  }
  const start = (await page.getByTestId('start').boundingBox())!;
  expect(start.height).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

// ------------------------------------------------------------------ the miniature universe

type UniverseApi = {
  game: {
    quickLaunch(): void;
    update(dt: number): void;
    setFlipper(side: 'left' | 'right', pressed: boolean): void;
    attraction: { kind: string; phase: string } | null;
    rush: { lane: number; phase: string; progress: number; stuntT: number; obstacles: Array<{ at: number; lanes: number[]; passed: boolean }> } | null;
    reactor: { ready: boolean; level: number; overload: { t: number; pulses: Array<{ at: number; judged: boolean }> } | null };
    city: { level: number; lit: boolean };
    multiballMode: string;
    world: { balls: Array<{ state: string }> };
    director: { mode: string; active: { kind: string } | null };
    debug: { lightCity(): void; reactorReady(): void; shootLeftRamp(): unknown; shootCore(): unknown };
  };
  renderer: () => { rig: { inShot: boolean } } | null;
};

test('DIAMOND CITY: the lit left ramp dives into the city, the flippers steer, the ball comes home', async ({ page }) => {
  const errors = await startGame(page);
  await page.evaluate(() => {
    const w = window as unknown as { __diamond: UniverseApi };
    const g = w.__diamond.game;
    g.quickLaunch();
    g.debug.lightCity();
    g.debug.shootLeftRamp();
  });
  await page.waitForFunction(() => (window as unknown as { __diamond: UniverseApi }).__diamond.game.rush !== null, undefined, { timeout: 30_000 });
  await expect(page.locator('.hud-attraction')).toHaveClass(/is-visible/);
  await expect(page.locator('.attr-title')).toHaveText('CITY RUSH');
  const camIn = await page.evaluate(() => (window as unknown as { __diamond: UniverseApi }).__diamond.renderer()!.rig.inShot);
  expect(camIn).toBe(true);
  // The flipper touch zones steer the car.
  const before = await page.evaluate(() => (window as unknown as { __diamond: UniverseApi }).__diamond.game.rush!.lane);
  const zone = page.locator('#touch-left');
  await zone.dispatchEvent('pointerdown', { pointerId: 7, isPrimary: true });
  await zone.dispatchEvent('pointerup', { pointerId: 7, isPrimary: true });
  const after = await page.evaluate(() => (window as unknown as { __diamond: UniverseApi }).__diamond.game.rush!.lane);
  expect(after).toBe(Math.max(0, before - 1));
  // Drive the rest of the run quickly (headless rendering is slow) and nail the jump.
  await page.evaluate(() => {
    const g = (window as unknown as { __diamond: UniverseApi }).__diamond.game;
    const tap = (s: 'left' | 'right') => {
      g.setFlipper(s, true);
      g.setFlipper(s, false);
    };
    for (let i = 0; i < 4000 && g.rush; i++) {
      const r = g.rush;
      if (r.phase === 'race') {
        const n = r.obstacles.find((o) => !o.passed);
        if (n && n.lanes.includes(r.lane) && n.at - r.progress < 0.05) {
          const free = [0, 1, 2].filter((l) => !n.lanes.includes(l)).sort((a, b) => Math.abs(a - r.lane) - Math.abs(b - r.lane))[0];
          tap(free < r.lane ? 'left' : 'right');
        }
      }
      if (r.phase === 'stunt' && r.stuntT >= 0.8 - 1 / 240) tap('left');
      g.update(1 / 120);
    }
  });
  await expect(page.locator('.hud-toasts')).toContainText(/ROOFTOP|DEMOLITION/);
  await page.waitForFunction(() => {
    const d = (window as unknown as { __diamond: UniverseApi }).__diamond;
    return d.game.attraction === null && d.game.world.balls.some((b) => b.state === 'free') && !d.renderer()!.rig.inShot;
  }, undefined, { timeout: 30_000 });
  const level = await page.evaluate(() => (window as unknown as { __diamond: UniverseApi }).__diamond.game.city.level);
  expect(level).toBe(1);
  await expect(page.locator('.hud-attraction')).not.toHaveClass(/is-visible/);
  expect(errors).toEqual([]);
});

test('REACTOR CORE: the open core captures the ball, synced pulses pay out, multiball follows', async ({ page }) => {
  const errors = await startGame(page);
  await page.evaluate(() => {
    const g = (window as unknown as { __diamond: UniverseApi }).__diamond.game;
    g.quickLaunch();
    g.debug.reactorReady();
    g.debug.shootCore();
  });
  await page.waitForFunction(() => (window as unknown as { __diamond: UniverseApi }).__diamond.game.attraction?.kind === 'reactor', undefined, { timeout: 30_000 });
  await expect(page.locator('.attr-title')).toHaveText('REACTOR OVERLOAD');
  await expect(page.locator('.attr-pip')).toHaveCount(5);
  await page.evaluate(() => {
    const g = (window as unknown as { __diamond: UniverseApi }).__diamond.game;
    for (let i = 0; i < 5000 && g.attraction?.kind === 'reactor'; i++) {
      const o = g.reactor.overload;
      const next = o?.pulses.find((p) => !p.judged);
      if (o && next && o.t >= next.at) {
        g.setFlipper('right', true);
        g.setFlipper('right', false);
      }
      g.update(1 / 240);
    }
  });
  await expect(page.locator('.attr-pip.is-hit')).toHaveCount(5);
  await page.waitForFunction(() => (window as unknown as { __diamond: UniverseApi }).__diamond.game.multiballMode === 'reactor', undefined, { timeout: 30_000 });
  const info = await page.evaluate(() => {
    const g = (window as unknown as { __diamond: UniverseApi }).__diamond.game;
    return { level: g.reactor.level, free: g.world.balls.filter((b) => b.state === 'free').length };
  });
  expect(info.level).toBe(1);
  expect(info.free).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('CAMERA DIVES set to OFF keeps the camera on the table: attractions pay out without capturing the ball', async ({ page }) => {
  await page.goto('./?quality=low');
  await page.locator('.btn-link', { hasText: 'SETTINGS' }).click();
  await page.locator('.setting-row', { hasText: 'CAMERA DIVES' }).locator('.btn-choice', { hasText: 'OFF' }).click();
  await page.locator('.btn-primary', { hasText: 'BACK' }).click();
  await page.getByTestId('play').click();
  await page.getByTestId('start').click();
  await page.waitForFunction(() => window.__diamond?.game.state === 'playing');
  const mode = await page.evaluate(() => (window as unknown as { __diamond: UniverseApi }).__diamond.game.director.mode);
  expect(mode).toBe('off');
  await page.evaluate(() => {
    const g = (window as unknown as { __diamond: UniverseApi }).__diamond.game;
    g.quickLaunch();
    g.debug.reactorReady();
    g.debug.shootCore();
    for (let i = 0; i < 60; i++) g.update(1 / 240);
  });
  const state = await page.evaluate(() => {
    const d = (window as unknown as { __diamond: UniverseApi }).__diamond;
    return { attraction: d.game.attraction, level: d.game.reactor.level, shot: d.game.director.active, inShot: d.renderer()!.rig.inShot };
  });
  expect(state.attraction).toBeNull();
  expect(state.level).toBe(1);
  expect(state.shot).toBeNull();
  expect(state.inShot).toBe(false);
});

test.describe('portrait phone menus', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });

  test('menus scroll on touch, the playfield does not, and START is reachable', async ({ page }) => {
    await page.goto('./?quality=low');
    await page.getByTestId('play').click();
    await expect(page.locator('.screen-select')).toBeVisible();
    // A one-finger swipe inside the menu is not blocked; on the playfield it is.
    const blocked = await page.evaluate(() => {
      const fire = (el: Element) => {
        const t = new Touch({ identifier: 1, target: el, clientX: 100, clientY: 300 });
        const ev = new TouchEvent('touchmove', { touches: [t], targetTouches: [t], bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        return ev.defaultPrevented;
      };
      return { menu: fire(document.querySelector('.screen-select .diff-card')!), table: fire(document.getElementById('scene')!) };
    });
    expect(blocked.menu).toBe(false);
    expect(blocked.table).toBe(true);
    // The panel is taller than this screen, so it must actually scroll to the START button.
    const scroll = await page.evaluate(() => {
      const scroller = [document.querySelector('.screen-select .panel'), document.querySelector('.screen-select')].find((el) => el && el.scrollHeight > el.clientHeight + 1) as HTMLElement | undefined;
      if (!scroller) return { overflow: false, scrolled: 0, touchAction: '' };
      scroller.scrollTop = 10_000;
      return { overflow: true, scrolled: scroller.scrollTop, touchAction: getComputedStyle(scroller).touchAction };
    });
    expect(scroll.overflow).toBe(true);
    expect(scroll.scrolled).toBeGreaterThan(0);
    expect(scroll.touchAction).toContain('pan-y');
    const start = page.getByTestId('start');
    await start.scrollIntoViewIfNeeded();
    const box = (await start.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(664 + 1);
    await start.tap();
    await page.waitForFunction(() => window.__diamond?.game.state === 'playing');
  });
});
