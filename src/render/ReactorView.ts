import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { TableDef } from '../table/layout';
import { RING_COUNT, pitchPath, type PitchResult, type Pulse, type Side } from '../attractions/reactor';
import { SmoothPose } from './CameraRig';
import { PlayerFigure, createTeamMaterials } from './PlayerFigure';
import type { Quality } from './Playfield';
import { toWorld } from './space';
import { DISPLAY, createBaseballTexture, createParticleTexture } from './textures';

/** Marquee bulbs per charge row around the mound. */
const BULBS = 18;
const ROWS = [1.42, 1.62, 1.82];
const BULB_OFF = new THREE.Color(0x2a1d14);
const BULB_ON = [new THREE.Color(0xffc46a), new THREE.Color(0xffa23a), new THREE.Color(0xff5a2a)];
const HOT = new THREE.Color(0xffffff);

/** The machine is modelled at 1 unit and shown larger so it holds its own between the bumper caps. */
const MACHINE_SCALE = 1.3;
/** Where the ball leaves the wheels and where the plate is, in the view's local frame (+z toward the player). */
const RELEASE = new THREE.Vector3(0, 1.42 * MACHINE_SCALE, 0.42 * MACHINE_SCALE);
const PLATE_Z = 3.3;
const PLATE_Y = 0.78;
/** Local x of plate-relative lateral units (pitchPath x = ±1 is the plate's edge). */
const LATERAL = 0.34;

const KIND_LABEL: Record<Pulse['kind'], string> = { fastball: 'FASTBALL', changeup: 'CHANGEUP', curveball: 'CURVEBALL', heater: 'THE HEATER', ball: 'FASTBALL' };

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  peak: number;
  t: number;
  dur: number;
}

/**
 * THE HEATER: a two-wheel pitching machine on a clay mound in the middle of
 * the pop bumpers. Marquee bulbs around the mound light row by row as the
 * table spins the wheels up, a radar-gun board reads the speed, and in the
 * showdown a batter steps in at the plate and the machine fires five pitches
 * at him: homers leave over the bumpers, whiffs pop the catcher's mitt.
 */
export class ReactorView {
  readonly group = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private wheelSpin = 0;
  private bulbs: THREE.InstancedMesh;
  private hopperGlow: THREE.MeshStandardMaterial;
  private housing: THREE.MeshStandardMaterial;
  private sign: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string };
  private batter: PlayerFigure;
  private crew = 0;
  private ball: THREE.Mesh;
  private trail: THREE.Sprite[] = [];
  private trailPos: THREE.Vector3[] = [];
  private flight: Flight | null = null;
  private lastJudged = -1;
  private light: THREE.PointLight | null = null;
  private corePos: THREE.Vector3;
  private time = 0;
  private flash = 0;
  private hot = 0;
  private bulbColor = new THREE.Color();
  private dirty = true;
  private cam = new SmoothPose(3.2);
  private outcomeT = -1;
  /** Viewport aspect (width / height): portrait pulls the camera back so the plate and the machine stay in frame. */
  aspect = 1.6;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private game: Game, table: TableDef, private quality: Quality, private toScene: (v: THREE.Vector3) => THREE.Vector3) {
    const c = table.attractions.reactor.core;
    this.corePos = toWorld(c.x, c.y, 0);
    this.group.position.copy(this.corePos);
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dee6, metalness: 1, roughness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171f, metalness: 0.4, roughness: 0.5 });

    // Clay mound with a pitching rubber and a dark chute pit where the ball drops in.
    const clay = new THREE.MeshStandardMaterial({ color: 0xb8683c, roughness: 0.95 });
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.32, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2), clay);
    mound.scale.y = 0.16;
    mound.receiveShadow = true;
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 28), dark);
    pit.position.y = 0.2;
    this.group.add(mound, pit);
    // Marquee bulbs in three rows around the mound: the speed stages.
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), BULBS * RING_COUNT);
    const m = new THREE.Matrix4();
    ROWS.forEach((r, row) => {
      for (let i = 0; i < BULBS; i++) {
        const a = (i / BULBS) * Math.PI * 2 + row * 0.17;
        m.makeTranslation(Math.cos(a) * r, 0.08 + row * 0.02, Math.sin(a) * r);
        this.bulbs.setMatrixAt(row * BULBS + i, m);
        this.bulbs.setColorAt(row * BULBS + i, BULB_OFF);
      }
    });
    this.group.add(this.bulbs);

    // The machine: tripod, a red housing, two upright spinning wheels facing the batter, a hopper of baseballs on top.
    const machine = new THREE.Group();
    machine.scale.setScalar(MACHINE_SCALE);
    this.group.add(machine);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.4, 8), chrome);
      leg.position.set(Math.cos(a) * 0.42, 0.75, Math.sin(a) * 0.42 - 0.05);
      leg.rotation.z = -Math.cos(a) * 0.28;
      leg.rotation.x = Math.sin(a) * 0.28;
      machine.add(leg);
    }
    this.housing = new THREE.MeshStandardMaterial({ color: 0x9e1219, metalness: 0.45, roughness: 0.28, emissive: 0xff3a1a, emissiveIntensity: 0, envMapIntensity: 1.2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.5), this.housing);
    body.position.set(0, 1.9, -0.05);
    body.castShadow = quality !== 'low';
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.54), chrome);
    trim.position.set(0, 2.06, -0.05);
    const axle = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.12), chrome);
    axle.position.set(0, 1.42, -0.12);
    machine.add(body, trim, axle);
    const wheelTex = this.wheelTexture();
    const tire = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.7 });
    const face = new THREE.MeshStandardMaterial({ map: wheelTex, roughness: 0.4, metalness: 0.2 });
    for (const side of [-1, 1]) {
      // Upright, facing the batter: the red-and-cream stripes blur as it spins up.
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 36).rotateX(Math.PI / 2), [tire, face, face]);
      wheel.position.set(side * 0.43, 1.42, 0.05);
      machine.add(wheel);
      this.wheels.push(wheel);
    }
    // Hopper (an open cone) with baseballs and a chrome feed chute.
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.2, 0.55, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c2a52, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide }));
    hopper.position.set(0, 2.38, -0.12);
    machine.add(hopper);
    const ballMat = new THREE.MeshStandardMaterial({ map: createBaseballTexture(), roughness: 0.6 });
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), ballMat);
      const a = i * 2.4;
      const r = i === 0 ? 0 : 0.18 + (i % 3) * 0.08;
      b.position.set(Math.cos(a) * r, 2.53 + (i % 2) * 0.08, -0.12 + Math.sin(a) * r);
      machine.add(b);
    }
    this.hopperGlow = new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: 0xff8a2a, emissiveIntensity: 0, roughness: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 32), this.hopperGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 2.66, -0.12);
    const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), chrome);
    chute.position.set(0, 1.75, 0.08);
    machine.add(ring, chute);

    // Radar-gun board behind the machine: the speed in amber bulbs.
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.sign = { canvas, ctx: canvas.getContext('2d')!, tex, key: '' };
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    board.position.set(0, 4.55, -1.0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.42, 1.27, 0.08), dark);
    frame.position.set(0, 4.55, -1.05);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.9, 8), chrome);
    post.position.set(0, 1.95, -1.1);
    this.group.add(post, frame, board);

    // Home plate and batter's boxes in front of the machine (toward the player).
    const plateShape = new THREE.Shape();
    plateShape.moveTo(-0.3, -0.2);
    plateShape.lineTo(0.3, -0.2);
    plateShape.lineTo(0.3, 0.05);
    plateShape.lineTo(0, 0.32);
    plateShape.lineTo(-0.3, 0.05);
    plateShape.closePath();
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(plateShape), new THREE.MeshStandardMaterial({ color: 0xf6f2e6, roughness: 0.6 }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0, 0.03, PLATE_Z);
    this.group.add(plate);
    for (const side of [-1, 1]) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.55, 1.2).rotateX(-Math.PI / 2)), new THREE.LineBasicMaterial({ color: 0xf6f2e6 }));
      edges.position.set(side * 0.62, 0.03, PLATE_Z);
      this.group.add(edges);
    }
    // The batter steps in only for the showdown, so he never hides the pinball.
    this.batter = new PlayerFigure(createTeamMaterials(0x1f3b73, 0xf2f2f2, 0xc81e1e), 'B', true, false);
    this.batter.warpTo(new THREE.Vector3(0.62, 0, PLATE_Z));
    this.batter.face(-Math.PI / 2);
    this.batter.play('ready');
    this.batter.visible = false;
    this.group.add(this.batter);

    // The pitch: a baseball with a soft comet trail.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ map: createBaseballTexture(), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.25 }));
    this.ball.visible = false;
    this.group.add(this.ball);
    const trailMat = new THREE.SpriteMaterial({ map: createParticleTexture(), color: 0xffd9a0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(trailMat);
      s.visible = false;
      s.scale.setScalar(0.32 - i * 0.04);
      this.trail.push(s);
      this.trailPos.push(new THREE.Vector3());
      this.group.add(s);
    }
    if (quality !== 'low') {
      this.light = new THREE.PointLight(0xffa04a, 0, 12, 2);
      this.light.position.set(0, 2.2, 0.8);
      this.group.add(this.light);
    }
    this.drawSign('THE HEATER', '60', 'MPH', false);
  }

  private wheelTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f3ead3' : '#c8161e';
      g.beginPath();
      g.moveTo(64, 64);
      g.arc(64, 64, 64, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#d9dee6';
    g.beginPath();
    g.arc(64, 64, 14, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Repaints the radar board only when its text changes. */
  private drawSign(top: string, big: string, unit: string, hot: boolean): void {
    const key = `${top}|${big}|${unit}|${hot}`;
    if (key === this.sign.key) return;
    this.sign.key = key;
    const { ctx, tex } = this.sign;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#12382a');
    g.addColorStop(1, '#08201a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#f3ead3';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 240);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f3ead3';
    ctx.font = `600 40px ${DISPLAY}`;
    ctx.fillText(top, 256, 50, 470);
    ctx.fillStyle = '#04100b';
    ctx.fillRect(60, 86, 392, 146);
    ctx.save();
    ctx.shadowColor = hot ? '#ff5a2a' : '#ffb52e';
    ctx.shadowBlur = 22;
    ctx.fillStyle = hot ? '#ff7a3a' : '#ffb52e';
    ctx.font = `700 128px ${DISPLAY}`;
    ctx.textAlign = 'right';
    ctx.fillText(big, 350, 162);
    ctx.font = `600 40px ${DISPLAY}`;
    ctx.textAlign = 'left';
    ctx.fillText(unit, 362, 190);
    ctx.restore();
    tex.needsUpdate = true;
  }

  /** A bumper fired: the wheels get a kick. */
  bumperHit(_id: string): void {
    this.wheelSpin += 6;
    this.flash = Math.max(this.flash, 0.25);
  }

  chargeChanged(): void {
    this.dirty = true;
    this.flash = Math.max(this.flash, 0.35);
  }

  /** Big moment: a speed stage, the machine going hot, a won pitch. */
  pulse(amount = 1): void {
    this.flash = Math.max(this.flash, amount);
    this.dirty = true;
  }

  outcome(): void {
    this.outcomeT = 0;
    this.flash = 1.6;
    this.dirty = true;
  }

  /** The batter swings (called for every judged swing). */
  swing(result: PitchResult): void {
    if (result === 'take' || result === 'looking') return;
    this.batter.play('swing');
  }

  /** Batter's-eye view: up behind the plate and a little to the left, the batter to the right, the machine dead ahead. */
  readonly cameraPose = (dt: number, pos: THREE.Vector3, target: THREE.Vector3, t: number): void => {
    const climax = this.outcomeT >= 0 ? Math.min(1, this.outcomeT / 1.2) : 0;
    const narrow = THREE.MathUtils.clamp((1.3 - this.aspect) / 0.8, 0, 1);
    const sway = Math.sin(this.time * 0.6) * 0.2;
    // Portrait: pull back and tilt down so the machine and the batter sit in the top two-thirds, above the tracker.
    this.tmp.set(-0.8 + sway, 3.7 + narrow * 3.4 + climax * 2.2, PLATE_Z + 4.8 + narrow * 4.4 + climax * 1.5).add(this.corePos);
    this.tmp2.set(0, 1.9 - narrow * 1.5 + climax * 1.4, -0.2 + narrow * 0.6).add(this.corePos);
    this.cam.follow(dt, this.toScene(this.tmp), this.toScene(this.tmp2), t < 0.05 ? 1000 : 3);
    pos.copy(this.cam.pos);
    target.copy(this.cam.target);
  };

  resetCamera(): void {
    this.cam.reset();
    this.outcomeT = -1;
    this.lastJudged = -1;
    this.flight = null;
  }

  /** Local position of a pitch on its way to the plate. */
  private pitchPoint(p: Pulse, t: number, out: THREE.Vector3): number {
    const { k, x } = pitchPath(p, t);
    const kk = Math.max(0, k);
    out.set(x * LATERAL, 0, 0);
    out.x = RELEASE.x + (x * LATERAL - RELEASE.x) * Math.min(1, kk) + (kk > 1 ? x * LATERAL * 0.1 * (kk - 1) : 0);
    out.z = RELEASE.z + (PLATE_Z - RELEASE.z) * kk;
    out.y = RELEASE.y + (PLATE_Y - RELEASE.y) * Math.min(1, kk) + Math.sin(Math.min(1, kk) * Math.PI) * (p.kind === 'changeup' ? 0.45 : p.kind === 'curveball' ? 0.35 : 0.12);
    return k;
  }

  private startFlight(result: PitchResult, side: Side): void {
    const from = this.ball.position.clone();
    const dir = side === 'left' ? -1 : 1;
    // A homer climbs out over the machine and the stands behind it, staying in the shot.
    if (result === 'homer') this.flight = { from, to: new THREE.Vector3(dir * 3 + (Math.random() - 0.5) * 1.5, 3.2, -7), peak: 2.6, t: 0, dur: 1.4 };
    else if (result === 'hit') this.flight = { from, to: new THREE.Vector3(dir * 4.5, 0.4, -4.5), peak: 0.8, t: 0, dur: 0.7 };
    else this.flight = null;
  }

  update(dt: number): void {
    this.time += dt;
    const r = this.game.reactor;
    const o = r.overload;
    const ready = r.ready || !!o;
    const critical = r.critical > 0;
    const charge = (r.charge[0] + r.charge[1] + r.charge[2]) / 3;
    this.hot += ((ready ? 1 : 0) - this.hot) * Math.min(1, dt * 3);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.4);
    if (this.outcomeT >= 0) this.outcomeT += dt;
    // Wheels: idle drift, faster with charge, a blur when hot.
    this.wheelSpin = Math.max(0, this.wheelSpin - dt * 8);
    const rate = 1 + charge * 14 + this.hot * 16 + this.wheelSpin + (critical ? 20 : 0);
    this.wheels[0].rotation.z -= dt * rate;
    this.wheels[1].rotation.z += dt * rate;
    this.housing.emissiveIntensity = this.hot * (0.05 + 0.04 * Math.sin(this.time * 8)) + this.flash * 0.35;
    this.hopperGlow.emissiveIntensity = this.hot * (1.2 + Math.sin(this.time * 6) * 0.6) + this.flash * 2;
    if (this.light) this.light.intensity = (this.hot * 5 + this.flash * 22 + (critical ? 8 : 0)) * (this.quality === 'high' ? 1 : 0.7);
    // Bulbs: each row lights with its stage; hot = a chase; perfect afterglow = strobe.
    if (this.dirty || ready || critical) {
      this.dirty = false;
      for (let row = 0; row < RING_COUNT; row++) {
        const lit = Math.round(r.charge[row] * BULBS);
        for (let i = 0; i < BULBS; i++) {
          if (critical) this.bulbColor.copy(HOT).lerp(BULB_ON[row], 0.5 + 0.5 * Math.sin(this.time * 16 + i));
          else if (ready) this.bulbColor.copy(BULB_ON[row]).multiplyScalar(Math.sin(this.time * 9 - i * 0.7 + row) > 0.3 ? 1.4 : 0.35);
          else if (i < lit) this.bulbColor.copy(BULB_ON[row]).multiplyScalar(1 + this.flash);
          else this.bulbColor.copy(BULB_OFF);
          this.bulbs.setColorAt(row * BULBS + i, this.bulbColor);
        }
      }
      if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    }
    // Radar board.
    if (o) {
      const live = o.pulses.find((p) => !p.judged && o.t >= p.at - p.lap) ?? null;
      const last = [...o.pulses].reverse().find((p) => p.judged) ?? null;
      if (live) this.drawSign(KIND_LABEL[live.kind], String(live.mph), 'MPH', live.kind === 'heater');
      else if (last && last.result === 'homer') this.drawSign('HOME RUN!', String(o.homers), 'HR', true);
      else if (last) this.drawSign(`PITCH ${o.pulses.indexOf(last) + 1} OF 5`, `${o.syncs}`, 'WON', false);
      else this.drawSign('BATTER UP', String(o.pulses[0].mph), 'MPH', false);
    } else if (critical) this.drawSign('PERFECT!', '100', 'MPH', true);
    else if (ready) this.drawSign('THE HEATER IS HOT', '100', 'MPH', Math.sin(this.time * 6) > 0);
    else this.drawSign('THE HEATER', String(Math.round(60 + charge * 38)), 'MPH', false);

    // The crew steps in for the showdown and walks off after.
    const wantCrew = !!o || this.outcomeT >= 0 && this.outcomeT < 2;
    this.crew += ((wantCrew ? 1 : 0) - this.crew) * Math.min(1, dt * 5);
    this.batter.visible = this.crew > 0.05;
    this.batter.scale.setScalar(Math.max(0.01, this.crew));
    this.batter.update(dt, this.time);

    // The pitch in flight, and what happens to it after the swing.
    let showBall = false;
    if (o) {
      // React to every newly judged pitch: the batter swings, a hit ball takes off.
      const judgedNow = o.pulses.reduce((n, p) => n + (p.judged ? 1 : 0), 0);
      while (this.lastJudged + 1 < judgedNow) {
        this.lastJudged += 1;
        const p = o.pulses[this.lastJudged];
        if (!p.result) continue;
        this.swing(p.result);
        this.startFlight(p.result, p.side);
      }
      const current = o.pulses.find((p) => !p.judged && o.t >= p.at - p.lap);
      if (this.flight) {
        const f = this.flight;
        f.t += dt;
        const k = Math.min(1, f.t / f.dur);
        this.ball.position.lerpVectors(f.from, f.to, k);
        this.ball.position.y += Math.sin(k * Math.PI) * f.peak;
        showBall = k < 1;
        if (k >= 1) this.flight = null;
      } else if (current) {
        this.pitchPoint(current, o.t, this.ball.position);
        showBall = true;
      } else {
        // A missed or taken pitch carries on into the catcher's mitt.
        const p = this.lastJudged >= 0 ? o.pulses[this.lastJudged] : null;
        if (p && (p.result === 'whiff' || p.result === 'looking' || p.result === 'chase' || p.result === 'take')) {
          const k = this.pitchPoint(p, o.t, this.ball.position);
          showBall = k < 1.22;
        }
      }
    } else if (this.flight) {
      this.lastJudged = -1;
      const f = this.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      this.ball.position.lerpVectors(f.from, f.to, k);
      this.ball.position.y += Math.sin(k * Math.PI) * f.peak;
      showBall = k < 1;
      if (k >= 1) this.flight = null;
    }
    if (!o && !this.flight) this.lastJudged = -1;
    this.ball.visible = showBall;
    this.ball.rotation.x += dt * 30;
    for (let i = this.trail.length - 1; i > 0; i--) this.trailPos[i].copy(this.trailPos[i - 1]);
    this.trailPos[0].copy(this.ball.position);
    this.trail.forEach((s, i) => {
      s.visible = showBall && i > 0;
      s.position.copy(this.trailPos[i]);
    });
  }

  /** World-space position of the machine (for effects). */
  coreLocal(out: THREE.Vector3, h = 1.5): THREE.Vector3 {
    return out.copy(this.corePos).setY(h);
  }

  /** Where the batter stands (table-local), for hit effects. */
  plateLocal(out: THREE.Vector3, h = 1): THREE.Vector3 {
    return out.copy(this.corePos).add(this.tmp2.set(0, h, PLATE_Z));
  }
}
