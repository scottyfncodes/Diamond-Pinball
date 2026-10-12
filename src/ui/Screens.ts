import { ACHIEVEMENTS } from '../game/achievements';
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
  onPlay(innings: 3 | 9): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onSettingsChanged(patch: Partial<Settings>): void;
  onResetData(): void;
  onUi(): void;
}

/**
 * Title, pause, game-over, settings, high-score and how-to screens. Every
 * control is functional; screens are plain DOM so they stay crisp on phones.
 */
export class Screens {
  readonly root: HTMLElement;
  private title!: HTMLElement;
  private pause!: HTMLElement;
  private over!: HTMLElement;
  private settings!: HTMLElement;
  private scores!: HTMLElement;
  private howto!: HTMLElement;
  private pauseButton!: HTMLButtonElement;
  private settingsReturn: 'title' | 'pause' = 'title';
  private inningsChoice: 3 | 9 = 3;

  constructor(private game: Game, parent: HTMLElement, private cb: ScreenCallbacks) {
    this.root = el('div', 'screens');
    this.build();
    parent.appendChild(this.root);
    this.inningsChoice = game.store.data.settings.innings;
    this.syncInningsButtons();
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
    const tag = el('p', 'tagline', 'Shoot the ramps. Swing the bat. Clear the wall.');
    const play = this.button('PLAY', 'btn-primary btn-play', () => this.cb.onPlay(this.inningsChoice));
    play.dataset.testid = 'play';
    const modes = el('div', 'mode-row');
    const quick = this.button('QUICK GAME · 3 INNINGS', 'btn-mode', () => this.setInnings(3));
    quick.dataset.innings = '3';
    const full = this.button('FULL GAME · 9 INNINGS', 'btn-mode', () => this.setInnings(9));
    full.dataset.innings = '9';
    modes.append(quick, full);
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
    panel.append(logo, tag, play, modes, links);
    this.title.append(panel);

    // Pause.
    this.pause = el('section', 'screen screen-pause');
    const pp = el('div', 'panel');
    pp.append(el('h2', 'panel-title', 'PAUSED'));
    const resume = this.button('RESUME', 'btn-primary', () => this.cb.onResume());
    resume.dataset.testid = 'resume';
    pp.append(resume, this.button('RESTART', 'btn-secondary', () => this.cb.onRestart()), this.button('SETTINGS', 'btn-secondary', () => this.openSettings('pause')), this.button('QUIT TO TITLE', 'btn-secondary', () => this.cb.onQuit()));
    this.pause.append(pp);

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
      card('⚾', 'The pinball is the controller', 'Flip with the left and right sides of the screen. Shoot the LEFT FIELD or RIGHT FIELD ramps to bring your batter to the plate.'),
      card('🏏', 'Time the swing', 'When the pitch comes in, tap a flipper. Faster ramp shots, charged POWER (2B lane), combos and lit field targets all make contact better.'),
      card('🏟️', 'Watch it play out', 'Runners round the bases on the miniature diamond. Hit a lit base target to steal. On defense, bumpers and targets make outs and ramps strike batters out.'),
      card('🔒', 'Go big', 'Hit 1B, 2B and 3B to light LOCK, then shoot the dugout. Two locks and the next one starts MULTIBALL. The HOME RUN lane is a premium at-bat.'),
    );
    hp.append(cards, this.button('BACK', 'btn-secondary', () => this.show(this.title)));
    this.howto.append(hp);

    // Pause button (always accessible during play).
    this.pauseButton = this.button('❚❚', 'btn-pause', () => this.cb.onResume());
    this.pauseButton.setAttribute('aria-label', 'Pause');
    this.pauseButton.dataset.testid = 'pause';

    this.root.append(this.title, this.pause, this.over, this.settings, this.scores, this.howto, this.pauseButton);
  }

  get pauseBtn(): HTMLButtonElement {
    return this.pauseButton;
  }

  private setInnings(n: 3 | 9): void {
    this.inningsChoice = n;
    this.cb.onSettingsChanged({ innings: n });
    this.syncInningsButtons();
  }

  private syncInningsButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.btn-mode').forEach((b) => b.classList.toggle('is-selected', Number(b.dataset.innings) === this.inningsChoice));
  }

  // ------------------------------------------------------------------ visibility

  private show(screen: HTMLElement | null): void {
    for (const s of [this.title, this.pause, this.over, this.settings, this.scores, this.howto]) s.classList.toggle('is-visible', s === screen);
  }

  showTitle(): void {
    this.inningsChoice = this.game.store.data.settings.innings;
    this.syncInningsButtons();
    this.show(this.title);
    this.pauseButton.classList.remove('is-visible');
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

  private renderGameOver(s: GameSummary): void {
    this.over.innerHTML = '';
    const p = el('div', 'panel panel-wide');
    const headline = s.completed ? (s.won ? 'YOU WIN!' : s.tie ? 'TIE GAME' : 'TOUGH LOSS') : 'GAME OVER';
    p.append(el('h2', `panel-title ${s.won ? 'is-win' : ''}`, headline));
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
    stats.append(stat('PINBALL SCORE', formatScore(s.pinballScore)), stat('HITS', String(s.hits)), stat('HOME RUNS', String(s.homeRuns)), stat('BEST COMBO', `x${s.bestCombo}`));
    p.append(stats);
    if (s.highScoreRank > 0) {
      const hs = el('div', 'highscore-banner', `NEW HIGH SCORE · #${s.highScoreRank}`);
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
        const entry = this.game.store.data.highScores.find((h) => h.pinballScore === s.pinballScore);
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
    row.append(again, this.button('TITLE', 'btn-secondary', () => this.cb.onQuit()));
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
    p.append(choice('DIFFICULTY', 'difficulty', [['rookie', 'ROOKIE'], ['pro', 'PRO'], ['allstar', 'ALL-STAR']]));
    p.append(choice('GAME LENGTH', 'innings', [[3, '3 INNINGS'], [9, '9 INNINGS']]));
    // Themes (unlockable).
    const themeRow = el('div', 'setting-row');
    themeRow.append(el('span', undefined, 'TABLE STYLE'));
    const group = el('div', 'choice-group');
    for (const t of Object.values(THEMES)) {
      const unlocked = this.game.store.data.unlocks.includes(t.id);
      const b = this.button(unlocked ? t.name.toUpperCase() : `🔒 ${t.name.toUpperCase()}`, 'btn-choice', () => {
        if (!unlocked) return;
        this.cb.onSettingsChanged({ theme: t.id });
        group.querySelectorAll('.btn-choice').forEach((x) => x.classList.toggle('is-selected', x === b));
      });
      if (!unlocked) b.classList.add('is-locked');
      if (st.theme === t.id) b.classList.add('is-selected');
      group.append(b);
    }
    themeRow.append(group);
    p.append(themeRow);
    p.append(el('p', 'setting-note', 'Graphics changes apply on the next game. Unlock table styles with achievements.'));
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
    const list = this.game.store.data.highScores;
    if (!list.length) p.append(el('p', 'panel-sub', 'No games yet. Your scores are saved on this device.'));
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
