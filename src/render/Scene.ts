import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Game } from '../game/Game';
import type { BattingResult } from '../baseball/batting';
import type { DefenseResult } from '../baseball/defense';
import { BallView } from './BallView';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import { PlayfieldView, type Quality } from './Playfield';
import { TABLE_SLOPE, toWorld } from './space';
import { Stadium, type FlightSpec } from './Stadium';
import { createScoreboard, themeFor, type Scoreboard } from './textures';

export interface RendererOptions {
  quality: 'auto' | 'low' | 'high';
  theme: string;
}

/** True when WebGL is running on a software rasteriser (SwiftShader, llvmpipe...). */
export function isSoftwareGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer);
  } catch {
    return false;
  }
}

export function resolveQuality(q: 'auto' | 'low' | 'high'): Quality {
  if (new URLSearchParams(location.search).get('quality') === 'low') return 'low';
  if (q === 'low') return 'low';
  if (isSoftwareGL()) return 'low';
  if (q === 'high') return 'high';
  const mobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile) return cores >= 6 ? 'medium' : 'low';
  return 'high';
}

/**
 * Owns the WebGL renderer, lights, camera and every view, and translates game
 * events into motion, light and particles.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly tableGroup = new THREE.Group();
  readonly playfield: PlayfieldView;
  readonly stadium: Stadium;
  readonly balls: BallView;
  readonly effects: Effects;
  readonly scoreboard: Scoreboard;
  readonly quality: Quality;
  private envMap: THREE.Texture;
  private unsubscribe: Array<() => void> = [];
  private scoreboardDirty = true;
  private scoreboardMessage = 'PLAY BALL';
  private scoreboardTimer = 0;
  private runnerSyncTimer = 0;
  private width = 1;
  private height = 1;
  private tmp = new THREE.Vector3();
  private pendingCelebrate = 0;
  private hitStop = 0;
  private clutch = false;
  private key: THREE.DirectionalLight;

  constructor(readonly canvas: HTMLCanvasElement, readonly game: Game, options: RendererOptions) {
    this.quality = resolveQuality(options.quality);
    document.documentElement.classList.toggle('low-fx', this.quality === 'low');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance', alpha: false });
    this.renderer.setClearColor(0x0a0d1c, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.fog = new THREE.Fog(0x0a0d1c, 70, 160);

    // Lights: warm key with shadows, cool fill, soft sky.
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x2a1c10, 0.75);
    this.scene.add(hemi);
    this.key = new THREE.DirectionalLight(0xfff0d8, 2.1);
    this.key.position.set(14, 34, 16);
    this.key.target.position.set(0, 0, -2);
    this.key.castShadow = this.quality !== 'low';
    const sh = this.key.shadow;
    sh.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    sh.camera.left = -16;
    sh.camera.right = 16;
    sh.camera.top = 30;
    sh.camera.bottom = -26;
    sh.camera.near = 5;
    sh.camera.far = 90;
    sh.bias = -0.0008;
    sh.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0x9fb9ff, 0.55);
    fill.position.set(-20, 18, -12);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.35);
    rim.position.set(0, 12, -40);
    this.scene.add(rim);

    const theme = themeFor(options.theme);
    this.scoreboard = createScoreboard(theme);
    this.playfield = new PlayfieldView(game.table, game.world, theme, this.envMap, this.quality, this.scoreboard.texture);
    this.stadium = new Stadium(game.table.diamond, game.world, this.quality);
    this.balls = new BallView(game.world, this.envMap, this.quality === 'low' ? 2 : 4);
    this.effects = new Effects(this.quality);
    this.tableGroup.rotation.x = TABLE_SLOPE;
    this.tableGroup.add(this.playfield.group, this.stadium.group, this.balls.group, this.effects.group);
    this.scene.add(this.tableGroup);
    this.scene.add(this.rig.camera);

    // Arcade floor glow under the machine for a sense of place.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: 0x11162b, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -7;
    floor.receiveShadow = false;
    this.scene.add(floor);

    this.wireEvents();
    this.refreshScoreboard();
  }

  // ------------------------------------------------------------------ events

  private wireEvents(): void {
    const on = this.game.bus.on.bind(this.game.bus);
    const pf = this.playfield;
    const fx = this.effects;
    const at = (p: { x: number; y: number }, h = 0.6) => toWorld(p.x, p.y, h, this.tmp).clone();
    this.unsubscribe.push(
      on('lamp', (e) => pf.setLamp(e.id, e.state)),
      on('bumper', (e) => {
        pf.hitBumper(e.id);
        fx.spark(at(e.at, 1.2), 0xffd36a, 1.2);
        fx.flashAt(at(e.at, 2), 3, 0xffb347);
        this.rig.kick(0.12);
      }),
      on('slingshot', (e) => fx.spark(at(e.at, 0.6), 0xfff1a8, 0.7)),
      on('target', (e) => {
        if (e.down) pf.setTarget(e.id, true);
        else pf.pulseTarget(e.id);
        fx.spark(at(e.at, 0.8), e.id.startsWith('base') ? 0xfff176 : 0x9be7ff, 1);
      }),
      on('bankReset', (e) => {
        for (let i = 0; i < 3; i++) pf.setTarget(`${e.bank}_${i}`, false);
      }),
      on('rampEnter', (e) => {
        const ramp = this.game.table.ramps.find((r) => r.id === e.id);
        if (ramp) fx.burst(at(ramp.entrance.a, 0.8).lerp(at(ramp.entrance.b, 0.8), 0.5), ramp.color, 0.6 + e.quality);
      }),
      on('lane', (e) => {
        const lane = this.game.table.lanes.find((l) => l.id === e.id);
        if (lane) fx.spark(at(lane.a, 0.4).lerp(at(lane.b, 0.4), 0.5), 0xffffff, 0.6);
      }),
      on('flipperHit', (e) => {
        if (e.speed > 110) fx.spark(at(e.at, 0.6), 0xffffff, 0.5);
      }),
      on('plungerCharge', (e) => pf.setPlungerCharge(e.charge)),
      on('launch', (e) => fx.spark(at(e.ball.pos, 0.5), 0xffffff, 0.8)),
      on('kickback', (e) => fx.burst(at(e.ball.pos, 0.6), 0x4fd1ff, 0.8)),
      on('saucer', (e) => fx.burst(at(this.game.table.saucer.pos, 0.6), e.locked ? 0xc77dff : 0xffffff, e.locked ? 1.2 : 0.5)),
      on('skillShot', () => fx.burst(at({ x: 4.5, y: 38 }, 1), 0xffffff, 1.4)),
      on('battingStart', (e) => this.stadium.startPitch(e.pitchDelay, e.pitch.breakX)),
      on('opponentPitch', (e) => this.stadium.startPitch(e.delay, 0)),
      on('pitchTaken', (e) => this.stadium.takePitch(e.play.play.type === 'strike')),
      on('battingSwing', () => this.stadium.swing()),
      on('cinematic', (e) => {
        this.rig.startCinematic((out) => this.stadium.baseballWorld(out), e.duration, e.sprayDeg);
      }),
      on('cinematicEnd', () => this.rig.endCinematic()),
      on('atBatHold', (e) => fx.spark(at(e.ball.pos, 0.6), 0x9be7ff, 0.5)),
      on('rally', (e) => {
        this.stadium.setAtmosphere({ rally: e.active, clutch: this.clutch });
        if (e.active) {
          fx.fireworks(toWorld(11, 40, 4));
          this.rig.kick(0.5);
        }
      }),
      on('clutch', (e) => {
        this.clutch = e.active;
        this.stadium.setAtmosphere({ rally: this.game.rally, clutch: e.active });
      }),
      on('battingResult', (e) => this.onBatted(e.result, e.play.hit || e.play.runs > 0, e.play)),
      on('defenseResult', (e) => this.onDefense(e.result, e.play)),
      on('playResult', (e) => {
        const t = e.play.play.type;
        if (t === 'steal' || t === 'caughtStealing' || t === 'walk' || t === 'ball' || t === 'strike' || t === 'error') {
          this.stadium.animateMoves(e.play.moves);
        }
        this.scoreboardMessage = e.play.label;
        this.scoreboardDirty = true;
        this.runnerSyncTimer = 3.6;
      }),
      on('baseball', () => {
        this.scoreboardDirty = true;
      }),
      on('halfInning', (e) => {
        this.stadium.setOffense(e.offense);
        this.scoreboardMessage = e.offense ? 'YOU ARE UP' : 'DEFENSE';
      }),
      on('modeChange', (e) => this.stadium.setOffense(e.offense)),
      on('multiball', (e) => {
        if (e.active) {
          this.rig.multiball();
          fx.fireworks(at(this.game.table.saucer.pos, 2));
        }
      }),
      on('cameraEvent', (e) => {
        if (e.kind === 'multiball') this.rig.multiball();
        if (e.kind === 'hit') this.rig.kick(0.45);
      }),
      on('stateChange', (e) => {
        this.rig.setMode(e.state === 'title' ? 'title' : 'play');
        if (e.state === 'title' || (e.state === 'playing' && e.prev === 'gameover')) {
          this.clutch = false;
          this.stadium.setAtmosphere({ rally: false, clutch: false });
        }
        if (e.state === 'playing' && e.prev === 'title') {
          this.stadium.setOffense(this.game.offense);
          this.scoreboardMessage = 'PLAY BALL';
          this.scoreboardDirty = true;
        }
      }),
      on('score', (e) => {
        if (e.label) this.scoreboardDirty = true;
      }),
      on('toast', (e) => {
        if (e.kind === 'epic' || e.kind === 'great') {
          this.scoreboardMessage = e.text;
          this.scoreboardDirty = true;
        }
      }),
      on('gameOver', (s) => {
        this.scoreboardMessage = s.won ? 'YOU WIN!' : s.completed ? 'FINAL' : 'GAME OVER';
        this.scoreboardDirty = true;
        if (s.won) {
          fx.fireworks(toWorld(11, 36, 4));
          this.stadium.celebrate();
        }
      }),
      on('achievement', () => fx.confettiRain(toWorld(11, 20, 3))),
      on('extraBall', () => fx.fireworks(toWorld(11, 30, 3))),
    );
  }

  private specFor(result: BattingResult | (DefenseResult & { dive?: boolean })): FlightSpec {
    const homeRun = result.play.type === 'homeRun';
    const foul = result.play.type === 'foul';
    const dirDeg = result.direction === 'left' ? -24 : result.direction === 'right' ? 24 : 0;
    return {
      direction: result.direction,
      sprayDeg: result.sprayDeg ?? dirDeg,
      distance: result.distance,
      trajectory: result.trajectory,
      homeRun,
      foul,
      dive: 'dive' in result ? result.dive : false,
    };
  }

  private onBatted(result: BattingResult, _positive: boolean, play: Parameters<Stadium['resolvePlay']>[1]): void {
    const spec = this.specFor(result);
    this.stadium.resolvePlay(spec, play);
    const home = this.game.table.diamond.home;
    const h = toWorld(home.x, home.y, 1);
    // Hit-stop: the big ones freeze the stadium for a heartbeat at contact.
    if (result.play.type === 'homeRun' || result.grade === 'perfect') {
      this.hitStop = result.play.type === 'homeRun' ? 0.14 : 0.08;
      this.effects.burst(h, 0xffffff, 1.6);
      this.rig.kick(0.6);
    } else if (result.grade === 'solid') this.effects.spark(h, 0xffd36a, 1);
    else if (result.grade !== 'foul') this.effects.spark(h, 0xffffff, 0.4);
    if (result.play.type === 'homeRun') this.pendingCelebrate = 2.0;
  }

  private onDefense(result: DefenseResult & { dive?: boolean }, play: Parameters<Stadium['resolvePlay']>[1]): void {
    const spec = this.specFor(result);
    this.stadium.resolvePlay(spec, play);
    if (play.doublePlay) this.effects.burst(toWorld(this.game.table.diamond.second.x, this.game.table.diamond.second.y, 1), 0x9be7ff, 1);
  }

  // ------------------------------------------------------------------ frame

  resize(width: number, height: number, hud: { side: number; top: number; bottom: number }): void {
    this.width = width;
    this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.75 : 1.25);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.rig.sideReserve = hud.side;
    this.rig.topReserve = hud.top;
    this.rig.bottomReserve = hud.bottom;
    this.rig.titleShift = width > height * 1.05 ? Math.min(16, width / height * 7) : 0;
    this.rig.setViewport(width, height);
    this.effects.setViewportHeight(height * dpr);
  }

  setTheme(id: string): void {
    this.playfield.applyTheme(themeFor(id));
  }

  private refreshScoreboard(): void {
    this.scoreboard.update({
      baseball: this.game.baseball,
      pinballScore: this.game.score,
      message: this.scoreboardMessage,
      ballsLeft: this.game.ballsLeft,
      multiplier: this.game.multiplier,
    });
    this.scoreboardDirty = false;
  }

  frame(dt: number, paused: boolean): void {
    if (!paused) {
      this.playfield.update(dt);
      // Hit-stop freezes only the baseball action; the pinball never pauses.
      const sdt = this.hitStop > 0 ? 0 : dt;
      if (this.hitStop > 0) this.hitStop -= dt;
      this.stadium.update(sdt);
      this.balls.update(dt);
      this.effects.update(dt);
      if (this.stadium.consumeHomeRunLanding()) {
        this.stadium.baseballWorldLast(this.tmp);
        this.tableGroup.worldToLocal(this.tmp);
        this.effects.fireworks(this.tmp.clone());
      }
      const caught = this.stadium.consumeCatch();
      if (caught) {
        if (caught.dive) this.effects.burst(caught.at.clone().setY(0.3), 0xb7733b, 0.7);
        else this.effects.spark(caught.at.clone().setY(1), 0xffffff, 0.3);
      }
      if (this.pendingCelebrate > 0) {
        this.pendingCelebrate -= dt;
        if (this.pendingCelebrate <= 0) this.stadium.celebrate();
      }
      if (this.runnerSyncTimer > 0) {
        this.runnerSyncTimer -= dt;
        if (this.runnerSyncTimer <= 0) this.stadium.syncRunners(this.game.baseball);
      }
    }
    // Follow the ball nearest the flippers (largest world z).
    let followZ: number | null = null;
    for (const b of this.game.world.balls) {
      if (b.state === 'drained' || b.state === 'locked') continue;
      const z = -(b.pos.y - 22);
      if (followZ === null || z > followZ) followZ = z;
    }
    this.rig.setFollow(followZ);
    this.rig.update(paused ? 0 : dt);
    this.scoreboardTimer -= dt;
    if (this.scoreboardDirty && this.scoreboardTimer <= 0) {
      this.scoreboardTimer = 0.25;
      this.refreshScoreboard();
    }
    this.renderer.render(this.scene, this.rig.camera);
  }

  /** Projects a table-space point to CSS pixel coordinates for HUD popups. */
  project(x: number, y: number, h = 0.5): { x: number; y: number; visible: boolean } {
    toWorld(x, y, h, this.tmp);
    this.tmp.applyMatrix4(this.tableGroup.matrixWorld);
    this.tmp.project(this.rig.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * this.width, y: (-this.tmp.y * 0.5 + 0.5) * this.height, visible: this.tmp.z < 1 };
  }

  dispose(): void {
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.renderer.dispose();
  }
}
