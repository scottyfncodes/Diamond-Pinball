import { ACHIEVEMENTS, BALL_SKINS } from '../game/achievements';
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId, type DifficultyProfile } from '../game/difficulty';
import type { GameSummary } from '../game/events';
import type { Game } from '../game/Game';
import type { Settings } from '../game/save';
import { formatScore } from '../game/scoring';
import { THEMES } from '../render/textures';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export interface ScreenCallbacks {
  onPlay(innings: 3 | 9, difficulty: DifficultyId): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onSettingsChanged(patch: Partial<Settings>): void;
  onResetData(): void;
  onUi(): void;
}

/**
 * Animated preview for the difficulty selector: three lanes, one per
 * difficulty, with a ball of the real relative size moving at the real
 * relative speed. Pure canvas 2D so it is cheap on phones.
 */
class DifficultyPreview {
  readonly canvas: HTMLCanvasElement;
  private raf = 0;
  private last = 0;
  private balls: Array<{ x: number; y: number; vx: number; vy: number }> = [];
  selected: DifficultyId = 'medium';

  constructor() {
    this.canvas = el('canvas', 'diff-preview');
    this.canvas.width = 600;
    this.canvas.height = 150;
    this.canvas.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) this.balls.push({ x: 60 + i * 40, y: 70, vx: 90 + i * 15, vy: 60 });
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(dt: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const laneW = W / 3;
    DIFFICULTY_ORDER.forEach((id, i) => {
      const p = DIFFICULTIES[id];
      const x0 = i * laneW;
      const sel = id === this.selected;
      ctx.fillStyle = sel ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(x0 + 6, 6, laneW - 12, H - 12);
      ctx.strokeStyle = sel ? p.color : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = sel ? 3 : 1;
      ctx.strokeRect(x0 + 6, 6, laneW - 12, H - 12);
      // Two tiny bumpers per lane so the ball keeps bouncing.
      ctx.fillStyle = 'rgba(255,77,77,0.6)';
      for (const [bx, by] of [[x0 + laneW * 0.3, 40], [x0 + laneW * 0.7, 110]]) {
        ctx.beginPath();
        ctx.arc(bx, by, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      const b = this.balls[i];
      const r = 11 * p.ballScale;
      const speed = p.speedScale;
      b.x += b.vx * speed * dt;
      b.y += b.vy * speed * dt;
      b.vy += 160 * speed * speed * dt;
      const minX = x0 + 6 + r;
      const maxX = x0 + laneW - 6 - r;
      if (b.x < minX) {
        b.x = minX;
        b.vx = Math.abs(b.vx);
      } else if (b.x > maxX) {
        b.x = maxX;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y > H - 6 - r) {
        b.y = H - 6 - r;
        b.vy = -(180 + Math.random() * 60);
        b.vx += (Math.random() - 0.5) * 60;
      } else if (b.y < 6 + r) {
        b.y = 6 + r;
        b.vy = Math.abs(b.vy);
      }
      for (const [bx, by] of [[x0 + laneW * 0.3, 40], [x0 + laneW * 0.7, 110]]) {
        const dx = b.x - bx;
        const dy = b.y - by;
        const d = Math.hypot(dx, dy);
        if (d < r + 10 && d > 0.01) {
          const nx = dx / d;
          const ny = dy / d;
          b.x = bx + nx * (r + 10);
          b.y = by + ny * (r + 10);
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= 1.8 * vn * nx;
            b.vy -= 1.8 * vn * ny;
          }
        }
      }
      const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.6, '#c9ccd1');
      g.addColorStop(1, '#5a6070');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sel ? p.color : 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 13px "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(p.name, x0 + 14, 22);
      ctx.font = '11px "Arial Narrow", Arial, sans-serif';
      ctx.fillText(`BALL ${Math.round(p.ballScale * 100)}% · SPEED ${Math.round(p.speedScale * 100)}%`, x0 + 14, H - 14);
    });
  }
}

/**
 * Title, difficulty selector, pause, game-over, settings, high-score and
 * how-to screens. Every control is functional; screens are plain DOM so they
 * stay crisp on phones.
 */
export class Screens {
  readonly root: HTMLElement;
  private title!: HTMLElement;
  private select!: HTMLElement;
  private pause!: HTMLElement;
  private over!: HTMLElement;
  private settings!: HTMLElement;
  private scores!: HTMLElement;
  private howto!: HTMLElement;
  private confirm!: HTMLElement;
  private pauseButton!: HTMLButtonElement;
  private settingsReturn: 'title' | 'pause' = 'title';
  private inningsChoice: 3 | 9 = 3;
  private difficultyChoice: DifficultyId = 'medium';
  private preview = new DifficultyPreview();
  private scoresTab: DifficultyId = 'medium';
  private pendingDifficulty: DifficultyId | null = null;

  constructor(private game: Game, parent: HTMLElement, private cb: ScreenCallbacks) {
    this.root = el('div', 'screens');
    this.inningsChoice = game.store.data.settings.innings;
    this.difficultyChoice = game.store.data.settings.difficulty;
    this.scoresTab = this.difficultyChoice;
    this.build();
    parent.appendChild(this.root);
    this.syncInningsButtons();
    this.syncDifficultyCards();
  }

  // ------------------------------------------------------------------ build

  private button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      this.cb.onUi();
      onClick();
    });
    return b;
  }

  private build(): void {
    // Title.
    this.title = el('section', 'screen screen-title is-visible');
    const logo = el('div', 'logo');
    logo.append(el('div', 'logo-top', 'DIAMOND'), el('div', 'logo-bottom', 'PINBALL'));
    const tag = el('p', 'tagline', 'A baseball stadium that became a pinball machine and is losing its mind.');
    const play = this.button('PLAY', 'btn-primary btn-play', () => this.openSelect());
    play.dataset.testid = 'play';
    const links = el('div', 'link-row');
    links.append(
      this.button('HOW IT WORKS', 'btn-link', () => this.show(this.howto)),
      this.button('HIGH SCORES', 'btn-link', () => {
        this.renderScores();
        this.show(this.scores);
      }),
      this.button('SETTINGS', 'btn-link', () => this.openSettings('title')),
    );
    const panel = el('div', 'title-panel');
    panel.append(logo, tag, play, links);
    this.title.append(panel);

    // Difficulty selector.
    this.select = el('section', 'screen screen-select');
    this.buildSelect();

    // Pause.
    this.pause = el('section', 'screen screen-pause');
    const pp = el('div', 'panel');
    pp.append(el('h2', 'panel-title', 'PAUSED'));
    const resume = this.button('RESUME', 'btn-primary', () => this.cb.onResume());
    resume.dataset.testid = 'resume';
    const change = this.button('CHANGE DIFFICULTY', 'btn-secondary', () => this.openConfirm());
    change.dataset.testid = 'change-difficulty';
    pp.append(resume, this.button('RESTART', 'btn-secondary', () => this.cb.onRestart()), change, this.button('SETTINGS', 'btn-secondary', () => this.openSettings('pause')), this.button('QUIT TO TITLE', 'btn-secondary', () => this.cb.onQuit()));
    this.pause.append(pp);

    // Confirm (difficulty change mid-run).
    this.confirm = el('section', 'screen screen-confirm');

    // Game over.
    this.over = el('section', 'screen screen-over');

    // Settings.
    this.settings = el('section', 'screen screen-settings');

    // High scores.
    this.scores = el('section', 'screen screen-scores');

    // How to play.
    this.howto = el('section', 'screen screen-howto');
    const hp = el('div', 'panel panel-wide');
    hp.append(el('h2', 'panel-title', 'HOW IT WORKS'));
    const cards = el('div', 'cards');
    const card = (icon: string, title: string, body: string) => {
      const c = el('div', 'card');
      c.append(el('div', 'card-icon', icon), el('h3', undefined, title), el('p', undefined, body));
      return c;
    };
    cards.append(
      card('⚾', 'The ramp is your at-bat', 'Shoot the LEFT FIELD or RIGHT FIELD ramp. The ball parks on the return while the pitch comes in. Tap a flipper as the ring closes: early = grounder, on time = airborne, late = pop-up.'),
      card('🏟️', 'Every target is baseball', 'The mound post rattles the pitcher and lights HOME PLATE for a squeeze. Hard shots off the outfield wall light distance markers. Base targets steal, the dugout is the BULLPEN, three bumpers in a row light the SCOREBOARD.'),
      card('⚡', 'Break the laws of pinball', 'Skill shots launch ROCKET BALL. Lanes grow a GIANT BASEBALL or WALL BOUNCE rails. Bumper cycles start LIGHTNING ROUND and light the BLACK HOLE. Both banks in a combo turn the infield MAGNETIC. Homers fire a TURBO LAUNCH.'),
      card('🔥', 'Escalate', 'Lock balls for MULTIBALL, visit the bullpen twice for BASEBALL MULTIBALL, go back-to-back for the HOME RUN DERBY. Bosses appear from play: THE ACE, THE WALL, the COMMISSIONER, the NINTH-INNING NIGHTMARE. Link everything for THE IMPOSSIBLE INNING.'),
    );
    hp.append(cards, this.button('BACK', 'btn-secondary', () => this.show(this.title)));
    this.howto.append(hp);

    // Pause button (always accessible during play).
    this.pauseButton = this.button('❚❚', 'btn-pause', () => this.cb.onResume());
    this.pauseButton.setAttribute('aria-label', 'Pause');
    this.pauseButton.dataset.testid = 'pause';

    this.root.append(this.title, this.select, this.pause, this.confirm, this.over, this.settings, this.scores, this.howto, this.pauseButton);
  }

  private buildSelect(): void {
    const p = el('div', 'panel panel-wide select-panel');
    p.append(el('h2', 'panel-title', 'CHOOSE YOUR GAME'));
    p.append(el('p', 'panel-sub', 'Ball size and speed are real physics. Pick how much the machine tolerates you.'));
    const cards = el('div', 'diff-cards');
    for (const id of DIFFICULTY_ORDER) {
      const d = DIFFICULTIES[id];
      const c = el('button', `diff-card diff-${id}`);
      c.type = 'button';
      c.dataset.difficulty = id;
      c.style.setProperty('--diff', d.color);
      c.setAttribute('aria-pressed', 'false');
      c.innerHTML =
        `<span class="diff-name">${d.name}</span>` +
        `<span class="diff-title">${d.title}</span>` +
        `<span class="diff-tag">${d.tagline}</span>` +
        `<span class="diff-stats">` +
        `<i><b>${Math.round(d.ballScale * 100)}%</b>BALL</i>` +
        `<i><b>${Math.round(d.speedScale * 100)}%</b>SPEED</i>` +
        `<i><b>${d.battingWindowScale.toFixed(2).replace(/0$/, '')}x</b>SWING</i>` +
        `<i><b>${d.scoreScale.toFixed(2).replace(/0$/, '')}x</b>SCORE</i>` +
        `</span>` +
        `<span class="diff-desc">${d.description}</span>`;
      c.addEventListener('click', () => {
        this.cb.onUi();
        this.setDifficulty(id);
      });
      cards.append(c);
    }
    p.append(cards, this.preview.canvas);
    const bottom = el('div', 'select-bottom');
    const modes = el('div', 'mode-row');
    const quick = this.button('QUICK GAME · 3 INNINGS', 'btn-mode', () => this.setInnings(3));
    quick.dataset.innings = '3';
    const full = this.button('FULL GAME · 9 INNINGS', 'btn-mode', () => this.setInnings(9));
    full.dataset.innings = '9';
    modes.append(quick, full);
    const row = el('div', 'btn-row');
    const start = this.button('START', 'btn-primary btn-start', () => this.cb.onPlay(this.inningsChoice, this.difficultyChoice));
    start.dataset.testid = 'start';
    row.append(start, this.button('BACK', 'btn-secondary', () => this.show(this.title)));
    bottom.append(modes, row);
    p.append(bottom);
    this.select.append(p);
  }

  get pauseBtn(): HTMLButtonElement {
    return this.pauseButton;
  }

  private setInnings(n: 3 | 9): void {
    this.inningsChoice = n;
    this.cb.onSettingsChanged({ innings: n });
    this.syncInningsButtons();
  }

  private setDifficulty(id: DifficultyId): void {
    this.difficultyChoice = id;
    this.preview.selected = id;
    this.cb.onSettingsChanged({ difficulty: id });
    this.syncDifficultyCards();
  }

  private syncInningsButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.btn-mode').forEach((b) => b.classList.toggle('is-selected', Number(b.dataset.innings) === this.inningsChoice));
  }

  private syncDifficultyCards(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.diff-card').forEach((b) => {
      const on = b.dataset.difficulty === this.difficultyChoice;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const start = this.root.querySelector<HTMLButtonElement>('.btn-start');
    if (start) {
      const d = DIFFICULTIES[this.difficultyChoice];
      start.textContent = `START · ${d.title}`;
      start.style.setProperty('--diff', d.color);
    }
  }

  // ------------------------------------------------------------------ visibility

  private show(screen: HTMLElement | null): void {
    for (const s of [this.title, this.select, this.pause, this.confirm, this.over, this.settings, this.scores, this.howto]) s.classList.toggle('is-visible', s === screen);
    if (screen === this.select) this.preview.start();
    else this.preview.stop();
  }

  showTitle(): void {
    this.inningsChoice = this.game.store.data.settings.innings;
    this.difficultyChoice = this.game.store.data.settings.difficulty;
    this.preview.selected = this.difficultyChoice;
    this.syncInningsButtons();
    this.syncDifficultyCards();
    if (this.pendingDifficulty) {
      // Returning from a "change difficulty" request: open the selector directly.
      this.pendingDifficulty = null;
      this.openSelect();
    } else this.show(this.title);
    this.pauseButton.classList.remove('is-visible');
  }

  openSelect(): void {
    this.inningsChoice = this.game.store.data.settings.innings;
    this.difficultyChoice = this.game.store.data.settings.difficulty;
    this.preview.selected = this.difficultyChoice;
    this.syncInningsButtons();
    this.syncDifficultyCards();
    this.show(this.select);
  }

  showPlaying(): void {
    this.show(null);
    this.pauseButton.classList.add('is-visible');
  }

  showPause(): void {
    this.show(this.pause);
  }

  showGameOver(summary: GameSummary): void {
    this.renderGameOver(summary);
    this.show(this.over);
    this.pauseButton.classList.remove('is-visible');
  }

  // ------------------------------------------------------------------ dynamic panels

  /** Changing difficulty never happens inside a run: confirm, then start a new one. */
  private openConfirm(): void {
    this.confirm.innerHTML = '';
    const p = el('div', 'panel');
    p.append(el('h2', 'panel-title', 'NEW RUN?'));
    p.append(el('p', 'panel-sub', `You are playing ${this.game.profile.title}. Difficulty only changes between runs: this ends the current game and opens the selector.`));
    const row = el('div', 'btn-row');
    const yes = this.button('END RUN & CHOOSE', 'btn-primary', () => {
      this.pendingDifficulty = this.game.profile.id;
      this.cb.onQuit();
    });
    yes.dataset.testid = 'confirm-change';
    row.append(yes, this.button('KEEP PLAYING', 'btn-secondary', () => this.show(this.pause)));
    p.append(row);
    this.confirm.append(p);
    this.show(this.confirm);
  }

  private renderGameOver(s: GameSummary): void {
    this.over.innerHTML = '';
    const p = el('div', 'panel panel-wide');
    const headline = s.completed ? (s.won ? 'YOU WIN!' : s.tie ? 'TIE GAME' : 'TOUGH LOSS') : 'GAME OVER';
    p.append(el('h2', `panel-title ${s.won ? 'is-win' : ''}`, headline));
    const diff = el('div', 'diff-chip');
    diff.style.setProperty('--diff', s.difficulty.color);
    diff.textContent = `${s.difficulty.title} · SCORE x${s.difficulty.scoreScale}`;
    p.append(diff);
    p.append(el('p', 'panel-sub', s.completed ? `Final after ${s.baseball.inning} inning${s.baseball.inning === 1 ? '' : 's'}` : 'Out of pinballs before the final out'));
    const score = el('div', 'final-score');
    score.append(el('div', 'final-team', `<span>YOU</span><strong>${s.playerRuns}</strong>`), el('div', 'final-vs', '–'), el('div', 'final-team', `<span>RIVALS</span><strong>${s.cpuRuns}</strong>`));
    p.append(score);
    const stats = el('div', 'stat-grid');
    const stat = (label: string, value: string) => {
      const c = el('div', 'stat');
      c.append(el('span', 'stat-value', value), el('span', 'stat-label', label));
      return c;
    };
    stats.append(stat('PINBALL SCORE', formatScore(s.pinballScore)), stat('HITS', String(s.hits)), stat('HOME RUNS', String(s.homeRuns)), stat('BEST COMBO', s.bestCombo >= 2 ? `x${s.bestCombo}` : '—'), stat('BOSSES', String(s.bossesBeaten.length)));
    p.append(stats);
    if (s.impossibleInning) p.append(el('div', 'highscore-banner is-legend', 'THE IMPOSSIBLE INNING · ABSOLUTE LEGEND'));
    if (s.highlights.length) {
      const hl = el('div', 'highlight-reel');
      hl.append(el('h3', undefined, 'HIGHLIGHT REEL'));
      const list = el('ol');
      for (const h of s.highlights) list.append(el('li', undefined, h));
      hl.append(list);
      p.append(hl);
    }
    if (s.highScoreRank > 0) {
      const hs = el('div', 'highscore-banner', `NEW ${s.difficulty.name} HIGH SCORE · #${s.highScoreRank}`);
      p.append(hs);
      const nameRow = el('div', 'name-row');
      const input = el('input', 'name-input');
      input.maxLength = 12;
      input.value = this.game.store.data.settings.playerName;
      input.placeholder = 'YOUR NAME';
      input.setAttribute('aria-label', 'Name for the high score table');
      input.addEventListener('change', () => {
        const name = input.value.trim().toUpperCase().slice(0, 12) || 'YOU';
        this.cb.onSettingsChanged({ playerName: name });
        const entry = this.game.store.data.highScores.find((h) => h.pinballScore === s.pinballScore && h.difficulty === s.difficulty.id);
        if (entry) {
          entry.name = name;
          this.game.store.save();
        }
      });
      nameRow.append(el('label', 'name-label', 'NAME'), input);
      p.append(nameRow);
    }
    if (s.newAchievements.length) {
      const ach = el('div', 'ach-list');
      ach.append(el('h3', undefined, 'ACHIEVEMENTS UNLOCKED'));
      for (const id of s.newAchievements) {
        const def = ACHIEVEMENTS.find((a) => a.id === id);
        if (def) ach.append(el('div', 'ach', `<strong>${def.title}</strong><span>${def.description}${def.unlock ? ` · Unlocked ${def.unlock.title}` : ''}</span>`));
      }
      p.append(ach);
    }
    const row = el('div', 'btn-row');
    const again = this.button('PLAY AGAIN', 'btn-primary', () => this.cb.onRestart());
    again.dataset.testid = 'play-again';
    const change = this.button('CHANGE DIFFICULTY', 'btn-secondary', () => {
      this.pendingDifficulty = s.difficulty.id;
      this.cb.onQuit();
    });
    change.dataset.testid = 'over-change-difficulty';
    row.append(again, change, this.button('TITLE', 'btn-secondary', () => this.cb.onQuit()));
    p.append(row);
    this.over.append(p);
  }

  private openSettings(from: 'title' | 'pause'): void {
    this.settingsReturn = from;
    this.renderSettings();
    this.show(this.settings);
  }

  private renderSettings(): void {
    const st = this.game.store.data.settings;
    this.settings.innerHTML = '';
    const p = el('div', 'panel panel-wide');
    p.append(el('h2', 'panel-title', 'SETTINGS'));
    const slider = (label: string, key: 'masterVolume' | 'sfxVolume' | 'ambienceVolume') => {
      const row = el('label', 'setting-row');
      row.append(el('span', undefined, label));
      const input = el('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.05';
      input.value = String(st[key]);
      input.addEventListener('input', () => this.cb.onSettingsChanged({ [key]: Number(input.value) }));
      row.append(input);
      return row;
    };
    const choice = <K extends keyof Settings>(label: string, key: K, options: Array<[Settings[K], string]>) => {
      const row = el('div', 'setting-row');
      row.append(el('span', undefined, label));
      const group = el('div', 'choice-group');
      for (const [value, text] of options) {
        const b = this.button(text, 'btn-choice', () => {
          this.cb.onSettingsChanged({ [key]: value } as Partial<Settings>);
          group.querySelectorAll('.btn-choice').forEach((x) => x.classList.toggle('is-selected', x === b));
        });
        if (this.game.store.data.settings[key] === value) b.classList.add('is-selected');
        group.append(b);
      }
      row.append(group);
      return row;
    };
    p.append(slider('MASTER VOLUME', 'masterVolume'), slider('EFFECTS', 'sfxVolume'), slider('STADIUM AMBIENCE', 'ambienceVolume'));
    p.append(choice('GRAPHICS', 'quality', [['auto', 'AUTO'], ['low', 'LOW'], ['high', 'HIGH']]));
    p.append(choice('SCREEN EFFECTS', 'reducedEffects', [[false, 'FULL'], [true, 'REDUCED']]));
    p.append(choice('GAME LENGTH', 'innings', [[3, '3 INNINGS'], [9, '9 INNINGS']]));
    // Unlockable content: table styles and ball skins.
    const unlockRow = (label: string, items: Array<{ id: string; name: string }>, current: string, apply: (id: string) => void) => {
      const row = el('div', 'setting-row');
      row.append(el('span', undefined, label));
      const group = el('div', 'choice-group');
      for (const t of items) {
        const unlocked = this.game.store.data.unlocks.includes(t.id);
        const b = this.button(unlocked ? t.name.toUpperCase() : `🔒 ${t.name.toUpperCase()}`, 'btn-choice', () => {
          if (!unlocked) return;
          apply(t.id);
          group.querySelectorAll('.btn-choice').forEach((x) => x.classList.toggle('is-selected', x === b));
        });
        if (!unlocked) b.classList.add('is-locked');
        if (current === t.id) b.classList.add('is-selected');
        group.append(b);
      }
      row.append(group);
      return row;
    };
    p.append(unlockRow('TABLE STYLE', Object.values(THEMES), st.theme, (id) => this.cb.onSettingsChanged({ theme: id })));
    p.append(unlockRow('PINBALL', BALL_SKINS, st.ballSkin, (id) => this.cb.onSettingsChanged({ ballSkin: id })));
    p.append(el('p', 'setting-note', 'Difficulty is chosen when a run starts. Graphics changes apply on the next game. Unlock styles and balls with achievements.'));
    const row = el('div', 'btn-row');
    row.append(
      this.button('BACK', 'btn-primary', () => (this.settingsReturn === 'pause' ? this.show(this.pause) : this.show(this.title))),
      this.button('RESET SAVE DATA', 'btn-danger', () => {
        if (window.confirm('Erase high scores, achievements and unlocks?')) {
          this.cb.onResetData();
          this.renderSettings();
        }
      }),
    );
    p.append(row);
    this.settings.append(p);
  }

  private renderScores(): void {
    this.scores.innerHTML = '';
    const p = el('div', 'panel panel-wide');
    p.append(el('h2', 'panel-title', 'HIGH SCORES'));
    const tabs = el('div', 'choice-group score-tabs');
    for (const id of DIFFICULTY_ORDER) {
      const d: DifficultyProfile = DIFFICULTIES[id];
      const b = this.button(d.title, 'btn-choice', () => {
        this.scoresTab = id;
        this.renderScores();
      });
      b.dataset.scoretab = id;
      b.style.setProperty('--diff', d.color);
      if (id === this.scoresTab) b.classList.add('is-selected');
      tabs.append(b);
    }
    p.append(tabs);
    const list = this.game.store.highScoresFor(this.scoresTab);
    if (!list.length) p.append(el('p', 'panel-sub', `No ${DIFFICULTIES[this.scoresTab].title} games yet. Scores are saved on this device, per difficulty.`));
    else {
      const table = el('table', 'score-table');
      table.innerHTML = '<thead><tr><th>#</th><th>NAME</th><th>SCORE</th><th>GAME</th><th>HR</th></tr></thead>';
      const body = el('tbody');
      list.forEach((h, i) => {
        const tr = el('tr');
        tr.innerHTML = `<td>${i + 1}</td><td>${h.name}</td><td>${formatScore(h.pinballScore)}</td><td>${h.runsFor}-${h.runsAgainst} ${h.won ? 'W' : ''}</td><td>${h.homeRuns}</td>`;
        body.append(tr);
      });
      table.append(body);
      p.append(table);
    }
    const ach = el('div', 'ach-grid');
    for (const a of ACHIEVEMENTS) {
      const got = this.game.store.data.achievements.includes(a.id);
      ach.append(el('div', `ach ${got ? 'is-got' : ''}`, `<strong>${got ? '✓ ' : ''}${a.title}</strong><span>${a.description}</span>`));
    }
    p.append(el('h3', 'ach-title', 'ACHIEVEMENTS'), ach, this.button('BACK', 'btn-secondary', () => this.show(this.title)));
    this.scores.append(p);
  }
}
