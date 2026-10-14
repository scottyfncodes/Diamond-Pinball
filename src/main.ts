import '@fontsource/oswald/latin-400.css';
import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-600.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/yellowtail/latin-400.css';
import './style.css';
import { GameAudio } from './audio/Audio';
import { Game } from './game/Game';
import { SaveStore, type Settings } from './game/save';
import { InputController } from './input/Input';
import { GameRenderer } from './render/Scene';
import { Hud } from './ui/Hud';
import { Screens } from './ui/Screens';
import { Tutorial } from './ui/Tutorial';

const app = document.getElementById('app')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const leftZone = document.getElementById('touch-left')!;
const rightZone = document.getElementById('touch-right')!;
const launchButton = document.getElementById('launch')!;

const store = new SaveStore();
const game = new Game(store);
const audio = new GameAudio();
audio.attach(game);
audio.setVolumes({ master: store.data.settings.masterVolume, sfx: store.data.settings.sfxVolume, ambience: store.data.settings.ambienceVolume });

let renderer: GameRenderer | null = null;
const createRenderer = () => {
  renderer?.dispose();
  renderer = new GameRenderer(canvas, game, { quality: store.data.settings.quality, theme: store.data.settings.theme, reducedEffects: store.data.settings.reducedEffects });
  hud.setProjector((x, y, h) => renderer!.project(x, y, h));
  resize();
};

const hud = new Hud(game, app);

const applySettings = (patch: Partial<Settings>) => {
  const prevQuality = store.data.settings.quality;
  const prevTheme = store.data.settings.theme;
  const s = store.updateSettings(patch);
  audio.setVolumes({ master: s.masterVolume, sfx: s.sfxVolume, ambience: s.ambienceVolume });
  if (patch.theme && patch.theme !== prevTheme) renderer?.setTheme(patch.theme);
  if (patch.reducedEffects !== undefined) renderer?.setReducedEffects(patch.reducedEffects);
  if (patch.ballSkin !== undefined) renderer?.setDefaultSkin(patch.ballSkin);
  if (patch.cinematics) game.director.mode = patch.cinematics;
  if (patch.quality && patch.quality !== prevQuality && game.state === 'title') createRenderer();
};

let tutorial: Tutorial | null = null;

const screens = new Screens(game, app, {
  onPlay: (innings, difficulty) => {
    audio.unlock();
    // The last-used difficulty is remembered for the next run.
    store.updateSettings({ innings, difficulty });
    game.startGame({ innings, difficulty });
    if (!store.data.settings.tutorialDone) {
      tutorial = new Tutorial(game, app, () => store.updateSettings({ tutorialDone: true }), { left: leftZone, right: rightZone, launch: launchButton });
      tutorial.start();
    }
  },
  onResume: () => {
    audio.unlock();
    if (game.state === 'paused') game.resume();
    else if (game.state === 'playing') game.pause();
  },
  onRestart: () => {
    audio.unlock();
    game.restart();
  },
  onQuit: () => game.quitToTitle(),
  onSettingsChanged: applySettings,
  onResetData: () => {
    store.reset();
    audio.setVolumes({ master: store.data.settings.masterVolume, sfx: store.data.settings.sfxVolume, ambience: store.data.settings.ambienceVolume });
  },
  onUi: () => {
    audio.unlock();
    audio.ui();
  },
});

const input = new InputController(game, { root: app, leftZone, rightZone, launchButton });
input.onAnyInput = () => audio.unlock();
input.onPause = () => {
  if (game.state === 'playing') game.pause();
  else if (game.state === 'paused') game.resume();
};
input.attach();

game.bus.on('stateChange', (e) => {
  app.dataset.state = e.state;
  if (e.state === 'title') screens.showTitle();
  else if (e.state === 'playing') screens.showPlaying();
  else if (e.state === 'paused') screens.showPause();
  else if (e.state === 'gameover' && game.summary) screens.showGameOver(game.summary);
  if (e.state !== 'playing') input.releaseAll();
});
game.bus.on('ballServed', () => launchButton.classList.add('is-ready'));
game.bus.on('launch', () => launchButton.classList.remove('is-ready'));
game.bus.on('stuck', (e) => {
  if (e.method === 'relaunch') launchButton.classList.add('is-ready');
});

// ------------------------------------------------------------------ layout

function resize(): void {
  const width = app.clientWidth;
  const height = app.clientHeight;
  const landscape = width > height * 1.05;
  app.classList.toggle('is-landscape', landscape);
  app.classList.toggle('is-portrait', !landscape);
  renderer?.resize(width, height, landscape ? { side: 0.06, top: 0.0, bottom: 0.0 } : { side: 0.0, top: 0.08, bottom: 0.04 });
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game.state === 'playing') game.pause();
    audio.suspend();
  } else audio.resume();
});

// ------------------------------------------------------------------ loop

createRenderer();
// The table art and scoreboard are painted with the self-hosted faces: repaint once they arrive.
if (document.fonts) {
  Promise.all(['600 20px Oswald', '700 20px Oswald', '20px Yellowtail'].map((f) => document.fonts.load(f)))
    .then(() => renderer?.repaintArt())
    .catch(() => undefined);
}
app.dataset.state = 'title';
screens.showTitle();
let last = performance.now();
let frameCount = 0;
function loop(now: number): void {
  // rAF timestamps can precede the performance.now() taken at start-up: never step backwards.
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  game.update(dt);
  hud.update(dt);
  renderer?.frame(dt, game.state === 'paused');
  frameCount += 1;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Expose a small API for automated end-to-end tests.
declare global {
  interface Window {
    __diamond?: { game: Game; frames: () => number; renderer: () => GameRenderer | null };
  }
}
window.__diamond = { game, frames: () => frameCount, renderer: () => renderer };
