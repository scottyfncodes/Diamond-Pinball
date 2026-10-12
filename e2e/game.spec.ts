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
      drain(): void;
      setBallSave(seconds: number): void;
      finish(): void;
    };
    hrLit: boolean;
    quickLaunch(): void;
    launcherBall(): unknown;
  };
  frames(): number;
};

declare const window: Window & { __diamond: DiamondApi };

const waitFrames = async (page: Page, n: number) => {
  const start = await page.evaluate(() => window.__diamond.frames());
  await page.waitForFunction((target) => window.__diamond.frames() >= target, start + n, { timeout: 30_000 });
};

const startGame = async (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?quality=low');
  await expect(page.getByTestId('play')).toBeVisible();
  await page.getByTestId('play').click();
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
  await page.locator('.btn-choice', { hasText: 'ROOKIE' }).click();
  await page.locator('.btn-choice', { hasText: '9 INNINGS' }).click();
  await page.locator('.btn-primary', { hasText: 'BACK' }).click();
  await page.reload();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('diamond-pinball/save/v1') || '{}').settings);
  expect(settings.difficulty).toBe('rookie');
  expect(settings.innings).toBe(9);
  await expect(page.locator('.btn-mode[data-innings="9"]')).toHaveClass(/is-selected/);
});

test('mobile layout has no horizontal overflow and keeps controls on screen', async ({ page }) => {
  await startGame(page);
  const vw = page.viewportSize()!;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  for (const sel of ['#launch', '.hud-scoreboard', '.hud-pinball', '[data-testid="pause"]']) {
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
