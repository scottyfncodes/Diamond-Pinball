import type { Game } from '../game/Game';

export interface InputElements {
  root: HTMLElement;
  leftZone: HTMLElement;
  rightZone: HTMLElement;
  launchButton: HTMLElement;
}

/**
 * Touch + keyboard controls. Pointer events with capture make releasing a
 * finger outside its zone, multi-touch and cancelled touches all reliable.
 */
export class InputController {
  private pointers = new Map<number, 'left' | 'right' | 'launch'>();
  private keys = new Set<string>();
  private cleanup: Array<() => void> = [];
  onAnyInput: (() => void) | null = null;
  onPause: (() => void) | null = null;

  constructor(private game: Game, private els: InputElements) {}

  attach(): void {
    const { leftZone, rightZone, launchButton, root } = this.els;
    const bind = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Document | Window, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    const zone = (el: HTMLElement, which: 'left' | 'right' | 'launch') => {
      bind(el, 'pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        this.onAnyInput?.();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        this.pointers.set(e.pointerId, which);
        this.press(which, true);
      });
      const release = (e: PointerEvent) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.delete(e.pointerId);
        if (![...this.pointers.values()].includes(which)) this.press(which, false);
      };
      bind(el, 'pointerup', release);
      bind(el, 'pointercancel', release);
      bind(el, 'lostpointercapture', release);
    };
    zone(leftZone, 'left');
    zone(rightZone, 'right');
    zone(launchButton, 'launch');

    // Stop the page from scrolling, zooming or selecting while playing.
    // Menus (title, difficulty, settings, pause...) scroll; the playfield never does.
    const inMenu = (e: Event) => e.target instanceof Element && !!e.target.closest('.screen.is-visible');
    bind(root, 'touchmove', (e: TouchEvent) => {
      if (e.touches.length === 1 && inMenu(e)) return;
      e.preventDefault();
    }, { passive: false });
    bind(root, 'touchstart', (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    bind(document, 'gesturestart', (e: Event) => e.preventDefault());
    bind(root, 'contextmenu', (e: Event) => e.preventDefault());
    bind(root, 'dblclick', (e: Event) => e.preventDefault());

    bind(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      const action = this.keyAction(e);
      if (!action) return;
      this.onAnyInput?.();
      if (action === 'pause') {
        this.onPause?.();
        e.preventDefault();
        return;
      }
      this.keys.add(action);
      this.press(action, true);
      e.preventDefault();
    });
    bind(window, 'keyup', (e: KeyboardEvent) => {
      const action = this.keyAction(e);
      if (!action || action === 'pause') return;
      this.keys.delete(action);
      this.press(action, false);
      e.preventDefault();
    });
    bind(window, 'blur', () => this.releaseAll());
  }

  private keyAction(e: KeyboardEvent): 'left' | 'right' | 'launch' | 'pause' | null {
    const code = e.code;
    if (code === 'ArrowLeft' || code === 'KeyZ' || code === 'ShiftLeft' || code === 'KeyA') return 'left';
    if (code === 'ArrowRight' || code === 'KeyX' || code === 'ShiftRight' || code === 'KeyL' || code === 'Slash' || code === 'KeyD') return 'right';
    if (code === 'Space' || code === 'ArrowDown' || code === 'Enter') return 'launch';
    if (code === 'KeyP' || code === 'Escape') return 'pause';
    return null;
  }

  private press(which: 'left' | 'right' | 'launch', down: boolean): void {
    if (which === 'launch') {
      if (down) this.game.plungerDown();
      else this.game.plungerUp();
      this.els.launchButton.classList.toggle('is-active', down);
      return;
    }
    this.game.setFlipper(which, down);
    (which === 'left' ? this.els.leftZone : this.els.rightZone).classList.toggle('is-active', down);
  }

  releaseAll(): void {
    this.pointers.clear();
    this.keys.clear();
    this.press('left', false);
    this.press('right', false);
    if (this.game.plunger.charging) this.game.plungerUp();
    this.els.launchButton.classList.remove('is-active');
  }

  detach(): void {
    this.cleanup.forEach((c) => c());
    this.cleanup = [];
    this.releaseAll();
  }
}
