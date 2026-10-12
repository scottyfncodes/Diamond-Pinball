import type { Game } from '../game/Game';

interface Step {
  id: string;
  text: string;
  highlight?: 'left' | 'right' | 'launch';
}

const STEPS: Step[] = [
  { id: 'launch', text: 'Hold LAUNCH and let go to plunge the ball.', highlight: 'launch' },
  { id: 'flip', text: 'Hold the LEFT and RIGHT sides of the screen to flip.', highlight: 'left' },
  { id: 'ramp', text: 'Shoot the LEFT FIELD or RIGHT FIELD ramp to bring your batter up.' },
  { id: 'swing', text: 'When the pitch comes, tap a flipper to swing. Perfect timing = big hits.' },
  { id: 'done', text: 'Runs light the table: lit bases steal, lock balls for MULTIBALL. Play ball!' },
];

/**
 * Short first-run tutorial shown in context during the first ball. Each step
 * completes when the player performs the action, so nothing blocks play.
 */
export class Tutorial {
  readonly root: HTMLElement;
  private text: HTMLElement;
  private index = 0;
  private active = false;
  private unsubscribe: Array<() => void> = [];
  private doneTimer: number | null = null;

  constructor(private game: Game, parent: HTMLElement, private onFinish: () => void, private zones: { left: HTMLElement; right: HTMLElement; launch: HTMLElement }) {
    this.root = document.createElement('div');
    this.root.className = 'tutorial';
    this.text = document.createElement('div');
    this.text.className = 'tutorial-text';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn btn-skip';
    skip.textContent = 'SKIP';
    skip.addEventListener('click', () => this.finish());
    this.root.append(this.text, skip);
    parent.append(this.root);
  }

  start(): void {
    this.active = true;
    this.index = 0;
    this.root.classList.add('is-visible');
    this.render();
    const on = this.game.bus.on.bind(this.game.bus);
    this.unsubscribe.push(
      on('launch', () => this.complete('launch')),
      on('flipper', (e) => {
        if (e.pressed) this.complete('flip');
      }),
      on('battingStart', () => this.complete('ramp')),
      on('battingSwing', () => this.complete('swing')),
      on('stateChange', (e) => {
        if (e.state === 'title' || e.state === 'gameover') this.finish();
      }),
    );
  }

  private complete(id: string): void {
    if (!this.active) return;
    if (STEPS[this.index].id !== id) return;
    this.index += 1;
    if (this.index >= STEPS.length - 1) {
      this.render();
      this.doneTimer = window.setTimeout(() => this.finish(), 5000);
      return;
    }
    this.render();
  }

  private render(): void {
    const step = STEPS[Math.min(this.index, STEPS.length - 1)];
    this.text.textContent = step.text;
    this.zones.left.classList.toggle('is-hint', step.highlight === 'left');
    this.zones.right.classList.toggle('is-hint', step.highlight === 'left');
    this.zones.launch.classList.toggle('is-hint', step.highlight === 'launch');
  }

  finish(): void {
    if (!this.active) return;
    this.active = false;
    if (this.doneTimer) window.clearTimeout(this.doneTimer);
    this.root.classList.remove('is-visible');
    this.zones.left.classList.remove('is-hint');
    this.zones.right.classList.remove('is-hint');
    this.zones.launch.classList.remove('is-hint');
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.onFinish();
  }
}
