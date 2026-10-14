import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Game } from '../game/Game';
import type { BattingResult } from '../baseball/batting';
import type { DefenseResult } from '../baseball/defense';
import { BallView } from './BallView';
import { CameraRig, SmoothPose, type PoseFn } from './CameraRig';
import { SandlotView } from './SandlotView';
import { MidwayView, Monorail } from './MidwayView';
import { ReactorView } from './ReactorView';
import type { ShotKind } from '../game/director';
import { Effects } from './Effects';
import { PlayfieldView, type Quality } from './Playfield';
import { TABLE_SLOPE, toWorld } from './space';
import { Stadium, type FlightSpec } from './Stadium';
import { createArcadeBackdrop, createArcadeCarpet, createScoreboard, themeFor, type Scoreboard } from './textures';
import { MODIFIERS } from '../game/modifiers';

export interface RendererOptions {
  quality: 'auto' | 'low' | 'high';
  theme: string;
  /** No screen shake, slow motion tint or flashes. */
  reducedEffects?: boolean;
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
  readonly reactor: ReactorView;
  readonly city: SandlotView;
  readonly midway: MidwayView;
  readonly monorail: Monorail;
  private stadiumCam = new SmoothPose(3);
  private hrCam = new SmoothPose(3.2);
  private hrLast = new THREE.Vector3();
  private hrSide = 0;
  private shotTmp = new THREE.Vector3();
  private shotTmp2 = new THREE.Vector3();
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
  private reducedEffects = false;
  private flashTimer = 0;
  private flashBurst = 0;
  private gravityFlipped = false;

  constructor(readonly canvas: HTMLCanvasElement, readonly game: Game, options: RendererOptions) {
    this.quality = resolveQuality(options.quality);
    document.documentElement.classList.toggle('low-fx', this.quality === 'low');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance', alpha: false });
    this.renderer.setClearColor(0x0b0f2e, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.fog = new THREE.Fog(0x0b0f2e, 80, 180);

    // Lights: bright warm key with shadows, cool fill, soft sky — a showroom-lit machine.
    const hemi = new THREE.HemisphereLight(0xd6e4ff, 0x2a1c3a, 0.95);
    this.scene.add(hemi);
    this.key = new THREE.DirectionalLight(0xfff2dc, 2.4);
    this.key.position.set(14, 34, 16);
    this.key.target.position.set(0, 0, -2);
    this.key.castShadow = this.quality !== 'low';
    const sh = this.key.shadow;
    sh.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    sh.camera.left = -22;
    sh.camera.right = 22;
    sh.camera.top = 30;
    sh.camera.bottom = -26;
    sh.camera.near = 5;
    sh.camera.far = 90;
    sh.bias = -0.0008;
    sh.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0x9fb9ff, 0.7);
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
    this.balls.defaultSkin = game.store.data.settings.ballSkin.replace(/^skin_/, '');
    this.reducedEffects = !!options.reducedEffects;
    this.effects = new Effects(this.quality);
    this.tableGroup.rotation.x = TABLE_SLOPE;
    this.tableGroup.add(this.playfield.group, this.stadium.group, this.balls.group, this.effects.group);
    this.scene.add(this.tableGroup);
    this.tableGroup.updateMatrixWorld(true);
    // The miniature universe around and inside the table.
    const toScene = (v: THREE.Vector3) => v.applyMatrix4(this.tableGroup.matrixWorld);
    this.reactor = new ReactorView(game, game.table, this.quality, toScene);
    this.city = new SandlotView(game, game.table, this.quality, this.playfield.rails, this.envMap, toScene);
    this.midway = new MidwayView(game.table.attractions.midway.deck, this.quality);
    this.monorail = new Monorail(this.quality);
    this.tableGroup.add(this.reactor.group, this.city.group, this.midway.group, this.monorail.group);
    this.city.onFx = (kind, p) => {
      if (kind === 'spark') this.effects.spark(p, 0xffd36a, 1);
      else if (kind === 'coin') this.effects.spark(p, 0xffe14d, 0.8);
      else if (kind === 'burst') this.effects.burst(p, 0x7cff5a, 1.4);
      else {
        this.effects.burst(p, 0xff7a1a, 2);
        this.effects.fireworks(p);
        this.kick(0.5);
      }
    };
    this.scene.add(this.rig.camera);

    // The arcade around the machine: a ring of out-of-focus cabinet lights and a dark floor.
    const backdrop = new THREE.Mesh(new THREE.CylinderGeometry(140, 140, 90, 48, 1, true), new THREE.MeshBasicMaterial({ map: createArcadeBackdrop(), side: THREE.BackSide, fog: false, depthWrite: false }));
    (backdrop.material as THREE.MeshBasicMaterial).map!.repeat.x = 3;
    backdrop.position.y = 18;
    backdrop.renderOrder = -1;
    this.scene.add(backdrop);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ map: createArcadeCarpet(), color: 0x6a6f9a, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -7;
    floor.receiveShadow = false;
    this.scene.add(floor);

    this.wireEvents();
    this.refreshScoreboard();
  }

  // ------------------------------------------------------------------ events

  /** Controlled camera shake; disabled in reduced-effects mode. */
  private kick(amount: number): void {
    if (!this.reducedEffects) this.rig.kick(amount);
  }

  /** Camera flashes pop in the stands for a while (big moments). */
  private cameraFlashes(seconds: number): void {
    if (this.reducedEffects) return;
    this.flashBurst = Math.max(this.flashBurst, seconds);
  }

  private wireEvents(): void {
    const on = this.game.bus.on.bind(this.game.bus);
    const pf = this.playfield;
    const fx = this.effects;
    const at = (p: { x: number; y: number }, h = 0.6) => toWorld(p.x, p.y, h, this.tmp).clone();
    this.unsubscribe.push(
      on('lamp', (e) => pf.setLamp(e.id, e.state)),
      on('bumper', (e) => {
        pf.hitBumper(e.id);
        this.reactor.bumperHit(e.id);
        fx.spark(at(e.at, 1.2), 0xffd36a, 1.2);
        fx.flashAt(at(e.at, 2), 3, 0xffb347);
        this.kick(0.12);
      }),
      on('modifier', (e) => {
        if (e.id === 'gravityFlip') this.gravityFlipped = e.active;
        if (!e.active) return;
        const where = e.at ? at(e.at, 1) : toWorld(11, 22, 1);
        fx.burst(where, MODIFIERS[e.id].color, e.id === 'slowMo' ? 0.4 : 1.4);
        if (e.id === 'blackHole') pf.pulseBlackHole();
        if (e.id !== 'slowMo') {
          this.stadium.flareLights(0.8);
          this.playfield.flare(0.8);
          this.kick(0.3);
        }
      }),
      on('blackHole', (e) => {
        if (e.phase === 'capture') fx.burst(at(e.at, 1.5), 0x8a6bff, 1.2);
        else {
          fx.fireworks(at(e.at, 2));
          this.kick(0.5);
        }
      }),
      on('lightning', (e) => fx.lightning(at(e.from, 0.4), e.to.map((t) => at(t, 0.4)))),
      on('wallBounce', (e) => {
        fx.spark(at(e.at, 1), e.lit ? 0xffe14d : 0xffffff, e.lit ? 1.6 : 0.8);
        if (e.lit) {
          fx.flashAt(at(e.at, 2.5), 6, 0xffe14d);
          this.stadium.flareLights(0.5);
          this.playfield.flare(0.5);
        }
      }),
      on('mound', (e) => fx.spark(at(e.at, 0.8), 0xffffff, 0.9)),
      on('squeeze', () => {
        fx.burst(toWorld(this.game.table.diamond.home.x, this.game.table.diamond.home.y, 1), 0xff8a3b, 1.4);
        this.stadium.excite(1);
      }),
      on('nearMiss', (e) => fx.spark(at(e.at, 0.6), 0x7cff5a, 0.9)),
      on('hitStop', (e) => {
        if (!this.reducedEffects) this.hitStop = Math.max(this.hitStop, e.seconds);
      }),
      on('crowdWave', () => this.stadium.startWave()),
      on('rovingJackpot', (e) => pf.setRoving(e.targetId)),
      on('scoreboardBoost', (e) => {
        if (e.active) {
          this.stadium.flareLights(1);
          this.playfield.flare(1);
          fx.burst(toWorld(10.3, 35.4, 2.5), 0xc77dff, 1.2);
        }
      }),
      on('boss', (e) => {
        if (e.active && e.progress === 0 && e.stage === 0) {
          this.stadium.flareLights(1);
          this.playfield.flare(1);
          this.stadium.excite(0.8);
          this.cameraFlashes(2);
          this.kick(0.4);
        }
        if (!e.active && e.beaten) {
          fx.cascadeFireworks(toWorld(11, 32, 4), 8, 14);
          this.stadium.celebrate();
          this.cameraFlashes(4);
        }
      }),
      on('derby', (e) => {
        if (e.active && e.homers === 0 && e.remaining >= e.remaining) void 0;
      }),
      on('impossible', (e) => {
        if (e.stage === 'complete') {
          fx.cascadeFireworks(toWorld(11, 28, 5), 16, 18);
          this.stadium.celebrate();
          this.stadium.startWave();
          this.stadium.flareLights(1.5);
          this.playfield.flare(1.5);
          this.cameraFlashes(8);
          this.kick(1);
        } else if (e.stage === 'link') fx.spark(toWorld(11, 44, 3), 0xffe08a, 1.2);
      }),
      on('combo', (e) => {
        if (!e.broke && e.count >= 4) {
          this.stadium.flareLights(Math.min(1, 0.3 + e.count * 0.08));
          this.playfield.flare(Math.min(1, 0.3 + e.count * 0.08));
          if (e.count === 4 || e.count === 7 || e.count === 10) this.stadium.startWave();
        }
      }),
      on('slingshot', (e) => fx.spark(at(e.at, 0.6), 0xfff1a8, 0.7)),
      on('target', (e) => {
        if (e.id === 'mound') return;
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
      on('saucer', (e) => {
        fx.burst(at(this.game.table.saucer.pos, 0.6), e.locked ? 0xc77dff : 0xffffff, e.locked ? 1.2 : 0.5);
        if (e.locked) this.midway.launchCoaster();
        else this.midway.blink();
      }),
      on('skillShot', () => fx.burst(at({ x: 4.5, y: 38 }, 1), 0xffffff, 1.4)),
      on('battingStart', (e) => this.stadium.startPitch(e.pitchDelay, e.pitch.breakX)),
      on('opponentPitch', (e) => this.stadium.startPitch(e.delay, 0)),
      on('pitchTaken', (e) => this.stadium.takePitch(e.play.play.type === 'strike')),
      on('battingSwing', () => this.stadium.swing()),
      on('cinematic', (e) => {
        this.hrSide = Math.sign(e.sprayDeg) * Math.min(1, Math.abs(e.sprayDeg) / 30);
      }),
      on('shot', (e) => this.onShot(e.kind, e.phase)),
      on('reactor', (e) => {
        const core = this.reactor.coreLocal(this.tmp, 1.6).clone();
        switch (e.event.type) {
          case 'charge':
            this.reactor.chargeChanged();
            break;
          case 'ring':
            this.reactor.pulse(1);
            fx.burst(core, 0x4dfff3, 1.2);
            this.kick(0.15);
            break;
          case 'ready':
            this.reactor.pulse(1.5);
            fx.burst(core, 0x9ffcff, 2);
            fx.flashAt(core, 8, 0x4dfff3);
            this.kick(0.35);
            break;
          case 'capture':
            fx.burst(core.setY(0.6), 0x4dfff3, 1.4);
            break;
          case 'pulse':
            this.reactor.pulse(e.event.hit ? 0.8 : 0.2);
            fx.spark(this.reactor.coreLocal(this.tmp, 3.6).clone().add(new THREE.Vector3(0, 0, 2.1)), e.event.hit ? 0x7cff5a : 0xff4d4d, e.event.hit ? 1.4 : 0.6);
            if (e.event.hit) this.kick(0.12);
            break;
          case 'super':
            this.reactor.outcome();
            fx.fireworks(core.setY(3));
            this.kick(0.5);
            break;
        }
      }),
      on('reactorResult', (e) => {
        this.reactor.outcome();
        const core = this.reactor.coreLocal(this.tmp, 3).clone();
        fx.burst(core, e.outcome === 'meltdown' ? 0xffffff : 0x4dfff3, e.outcome === 'fizzle' ? 1 : 2.4);
        if (e.outcome !== 'fizzle') {
          fx.cascadeFireworks(core.setY(4), e.outcome === 'meltdown' ? 10 : 5, 10);
          this.cameraFlashes(e.outcome === 'meltdown' ? 5 : 2.5);
          this.stadium.flareLights(1.2);
          this.playfield.flare(1.2);
          this.kick(e.outcome === 'meltdown' ? 0.9 : 0.55);
          if (!this.reducedEffects) this.hitStop = Math.max(this.hitStop, 0.2);
        }
      }),
      on('cityRush', (e) => {
        if (e.event.type === 'start') this.city.startRush(e.rush);
        else this.city.rushEvent(e.event.type);
        if (e.event.type === 'crash') this.kick(0.25);
      }),
      on('cityResult', (e) => {
        this.city.result(e.trophy, e.trophies);
        if (e.grade === 'legendary' || e.stunt === 'jump') {
          this.city.celebrate(4);
          fx.cascadeFireworks(toWorld(-5.2, 4, 6), 6, 6);
        }
      }),
      on('cityRebuild', () => {
        this.city.rebuild();
        this.city.celebrate(5);
        this.monorail.express(6);
      }),
      on('cityDivert', () => fx.spark(toWorld(3.6, 31.6, 2.4), 0x3bff9a, 1.2)),
      on('tour', (e) => {
        if (!e.complete) return;
        this.city.celebrate(8);
        this.midway.celebrate(10);
        this.monorail.express(10);
        fx.cascadeFireworks(toWorld(11, 30, 6), 14, 30);
        this.cameraFlashes(6);
      }),
      on('worldMult', (e) => {
        if (e.value > 1) this.monorail.express(4);
      }),
      on('atBatHold', (e) => fx.spark(at(e.ball.pos, 0.6), 0x9be7ff, 0.5)),
      on('rally', (e) => {
        this.stadium.setAtmosphere({ rally: e.active, clutch: this.clutch });
        if (e.active) {
          fx.fireworks(toWorld(11, 40, 4));
          this.kick(0.5);
          this.cameraFlashes(3);
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
          this.midway.celebrate(8);
          this.city.celebrate(6);
          this.monorail.express(8);
          fx.fireworks(this.midway.skyPoint(this.tmp).clone());
          if (this.game.director.mode !== 'off' && !this.rig.inShot) this.rig.multiball();
          fx.fireworks(at(this.game.table.saucer.pos, 2));
          if (e.mode === 'chaos') {
            fx.cascadeFireworks(toWorld(11, 30, 4), 6, 14);
            this.cameraFlashes(5);
          }
        }
      }),
      on('cameraEvent', (e) => {
        if (e.kind === 'multiball' && this.game.director.mode !== 'off' && !this.rig.inShot) this.rig.multiball();
        if (e.kind === 'hit') this.kick(0.45);
      }),
      on('stateChange', (e) => {
        this.rig.setMode(e.state === 'title' ? 'title' : 'play');
        if (e.state === 'title' || (e.state === 'playing' && e.prev !== 'paused')) {
          this.city.reset();
          this.rig.cancelShots();
        }
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
        this.gravityFlipped = false;
        if (s.won) {
          fx.cascadeFireworks(toWorld(11, 36, 4), 8, 16);
          this.stadium.celebrate();
          this.cameraFlashes(5);
        }
      }),
      on('achievement', () => fx.confettiRain(toWorld(11, 20, 3))),
      on('extraBall', () => {
        fx.fireworks(toWorld(11, 30, 3));
        this.monorail.express(6);
      }),
    );
  }

  /** Follows the director: every dive starts and ends here. */
  private onShot(kind: ShotKind, phase: 'start' | 'end'): void {
    if (phase === 'end') {
      if (kind === 'jackpot' || kind === 'multiball') return;
      this.rig.endShot(kind === 'city' ? 0.8 : 0.5);
      return;
    }
    let pose: PoseFn | null = null;
    let enter = 0.7;
    switch (kind) {
      case 'atBat':
        this.stadiumCam.reset();
        pose = this.stadiumPose;
        enter = 0.55;
        break;
      case 'homeRun':
        this.hrCam.reset();
        this.stadium.baseballWorldLast(this.hrLast);
        pose = this.homeRunPose;
        enter = 0.45;
        break;
      case 'city':
        this.city.resetCamera();
        pose = this.city.cameraPose;
        enter = 0.9;
        break;
      case 'reactor':
        this.reactor.resetCamera();
        pose = this.reactor.cameraPose;
        enter = 0.75;
        break;
      case 'jackpot':
      case 'multiball':
        // Glances keep the whole table in view.
        if (!this.rig.inShot) this.rig.multiball();
        this.cameraFlashes(1.5);
        return;
    }
    if (pose) this.rig.startShot(pose, enter);
  }

  /** DIAMOND STADIUM: a low broadcast angle from behind home plate, looking out at the pitcher and the outfield. */
  private readonly stadiumPose: PoseFn = (dt, pos, target, t) => {
    const d = this.game.table.diamond;
    toWorld(d.home.x + Math.sin(t * 0.35) * 0.7, d.home.y - 8.2, 6.6, this.shotTmp);
    toWorld(d.mound.x, d.mound.y + 1.8, 0.6, this.shotTmp2);
    this.stadiumCam.follow(dt, this.toScene(this.shotTmp), this.toScene(this.shotTmp2), t < 0.02 ? 1000 : 3);
    pos.copy(this.stadiumCam.pos);
    target.copy(this.stadiumCam.target);
  };

  /** Home run: rise behind the plate and track the ball into the seats. */
  private readonly homeRunPose: PoseFn = (dt, pos, target, t) => {
    if (this.stadium.baseballWorld(this.shotTmp)) this.hrLast.copy(this.shotTmp);
    const last = this.hrLast;
    this.shotTmp2.copy(last);
    this.shotTmp2.y = Math.max(1.5, last.y * 0.75);
    this.shotTmp.set(-this.hrSide * 3 + last.x * 0.15, 15 + Math.min(4, last.y * 0.3), 25 + Math.min(0, last.z) * 0.12);
    this.hrCam.follow(dt, this.shotTmp, this.shotTmp2, t < 0.02 ? 1000 : 3.2);
    pos.copy(this.hrCam.pos);
    target.copy(this.hrCam.target);
  };

  private toScene(v: THREE.Vector3): THREE.Vector3 {
    return v.applyMatrix4(this.tableGroup.matrixWorld);
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
      if (!this.reducedEffects) this.hitStop = play.grandSlam ? 0.3 : result.play.type === 'homeRun' ? 0.14 : 0.08;
      this.effects.burst(h, 0xffffff, play.grandSlam ? 2.4 : 1.6);
      this.kick(play.grandSlam ? 0.9 : 0.6);
      if (result.play.type === 'homeRun') this.cameraFlashes(play.grandSlam ? 5 : 2.5);
      if (play.grandSlam) {
        this.effects.cascadeFireworks(toWorld(11, 34, 4), 10, 16);
        this.stadium.startWave();
      }
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
    this.city.aspect = width / Math.max(1, height);
    this.reactor.aspect = this.city.aspect;
    this.effects.setViewportHeight(height * dpr);
  }

  setTheme(id: string): void {
    this.playfield.applyTheme(themeFor(id));
  }

  setReducedEffects(on: boolean): void {
    this.reducedEffects = on;
  }

  setDefaultSkin(id: string): void {
    this.balls.defaultSkin = id.replace(/^skin_/, '');
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
      this.reactor.update(dt);
      this.city.update(dt);
      this.midway.update(dt);
      this.monorail.update(dt);
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
      // Camera flashes in the stands.
      if (this.flashBurst > 0) {
        this.flashBurst -= dt;
        this.flashTimer -= dt;
        if (this.flashTimer <= 0) {
          this.flashTimer = 0.06 + Math.random() * 0.12;
          this.effects.spark(this.stadium.randomSeat(this.tmp).clone(), 0xffffff, 0.35);
        }
      }
      // Gravity flip: the key light swings so the whole table reads upside-down for a moment.
      const keyTargetY = this.gravityFlipped ? 10 : 34;
      this.key.position.y += (keyTargetY - this.key.position.y) * Math.min(1, dt * 4);
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
