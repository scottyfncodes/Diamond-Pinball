import * as THREE from 'three';
import type { PlayResult, RunnerMove, BaseballState } from '../baseball/types';
import { TABLE, type DiamondDef } from '../table/layout';
import type { Vec2 } from '../physics/Vec2';
import { createTeamMaterials, PlayerFigure, type TeamMaterials } from './PlayerFigure';
import { toWorld } from './space';
import { createCrowdTexture } from './textures';
import type { Quality } from './Playfield';
import type { World } from '../physics/World';

export interface FlightSpec {
  direction: 'left' | 'center' | 'right';
  distance: number;
  trajectory: 'ground' | 'line' | 'fly' | 'pop';
  homeRun: boolean;
  foul: boolean;
}

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  peak: number;
  duration: number;
  t: number;
  bounces: number;
  onLand: (() => void) | null;
}

interface RunnerAnim {
  figure: PlayerFigure;
  runnerId: number;
  path: THREE.Vector3[];
  index: number;
  done: 'stay' | 'score' | 'out';
  delay: number;
}

const FIELDER_ROLES = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'] as const;

/**
 * The living miniature stadium inside the machine: stands, crowd, floodlights,
 * animated fielders, batter, runners and the baseball itself. Everything is
 * driven by game events; it never touches the baseball rules.
 */
export class Stadium {
  readonly group = new THREE.Group();
  private fielders = new Map<string, PlayerFigure>();
  private batter: PlayerFigure;
  private onDeck: PlayerFigure;
  private runnerPool: PlayerFigure[] = [];
  private runners: RunnerAnim[] = [];
  private baseball: THREE.Mesh;
  private flight: Flight | null = null;
  private pitch: Flight | null = null;
  private teams: { player: TeamMaterials; cpu: TeamMaterials };
  private playerBatting = true;
  private crowd: THREE.InstancedMesh | null = null;
  private crowdBase: Float32Array | null = null;
  private crowdExcitement = 0;
  private floodPanels: THREE.MeshStandardMaterial[] = [];
  private floodPulse = 0;
  private time = 0;
  private returnTimer = 0;
  private basePositions: THREE.Vector3[];
  private dugoutLeft: THREE.Vector3;
  private dugoutRight: THREE.Vector3;
  private tmp = new THREE.Vector3();

  constructor(private diamond: DiamondDef, private world: World, private quality: Quality) {
    this.teams = {
      player: createTeamMaterials(0x1f3b73, 0xf2f2f2, 0xc81e1e),
      cpu: createTeamMaterials(0xb8322f, 0xd9d9d9, 0x202020),
    };
    this.basePositions = [diamond.home, diamond.first, diamond.second, diamond.third].map((p) => toWorld(p.x, p.y));
    this.dugoutLeft = toWorld(1.2, 11.2);
    this.dugoutRight = toWorld(19.0, 11.2);
    this.buildField();
    this.buildStands();
    this.buildFloodlights();
    for (const role of FIELDER_ROLES) {
      const f = new PlayerFigure(this.teams.cpu, role, false, role !== 'C');
      const p = diamond.fielders[role];
      f.warpTo(toWorld(p.x, p.y));
      f.face(Math.PI);
      f.play(role === 'C' ? 'ready' : 'idle');
      this.group.add(f);
      this.fielders.set(role, f);
    }
    this.batter = new PlayerFigure(this.teams.player, 'B', true, false);
    this.batter.warpTo(toWorld(diamond.batter.x, diamond.batter.y));
    this.batter.face(-Math.PI / 2);
    this.batter.play('ready');
    this.group.add(this.batter);
    this.onDeck = new PlayerFigure(this.teams.player, 'OD', true, false);
    this.onDeck.warpTo(toWorld(diamond.onDeck.x, diamond.onDeck.y));
    this.onDeck.face(Math.PI);
    this.group.add(this.onDeck);
    for (let i = 0; i < 4; i++) {
      const r = new PlayerFigure(this.teams.player, 'R', false, false);
      r.visible = false;
      this.group.add(r);
      this.runnerPool.push(r);
    }
    this.baseball = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }));
    this.baseball.castShadow = quality !== 'low';
    this.baseball.visible = false;
    this.group.add(this.baseball);
  }

  // ------------------------------------------------------------------ static scenery

  private buildField(): void {
    const d = this.diamond;
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    for (const b of [d.first, d.second, d.third]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.55), baseMat);
      const p = toWorld(b.x, b.y, 0.05);
      m.position.copy(p);
      m.rotation.y = Math.PI / 4;
      this.group.add(m);
    }
    const plate = new THREE.Shape();
    plate.moveTo(-0.3, 0.2);
    plate.lineTo(0.3, 0.2);
    plate.lineTo(0.3, -0.05);
    plate.lineTo(0, -0.32);
    plate.lineTo(-0.3, -0.05);
    plate.closePath();
    const plateMesh = new THREE.Mesh(new THREE.ShapeGeometry(plate), baseMat);
    plateMesh.rotation.x = -Math.PI / 2;
    const hp = toWorld(d.home.x, d.home.y, 0.03);
    plateMesh.position.copy(hp);
    this.group.add(plateMesh);
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb7733b, roughness: 1 }));
    mound.scale.set(1, 0.18, 1);
    const mp = toWorld(d.mound.x, d.mound.y);
    mound.position.copy(mp);
    this.group.add(mound);
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.14), baseMat);
    rubber.position.set(mp.x, 0.2, mp.z);
    this.group.add(rubber);
    // Dugouts on both side rails.
    const dugMat = new THREE.MeshStandardMaterial({ color: 0x24324f, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a4a6b, roughness: 0.6 });
    for (const x of [-TABLE.width / 2 - 0.35, TABLE.width / 2 + 0.35]) {
      const dug = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 6), dugMat);
      dug.position.set(x, 2.9, 4);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 6.4), roofMat);
      roof.position.set(x, 3.45, 4);
      this.group.add(dug, roof);
    }
  }

  private buildStands(): void {
    const c = toWorld(TABLE.arcCenter.x, TABLE.arcCenter.y);
    const tiers = 3;
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2b3b63, roughness: 0.85 });
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x1b2744, roughness: 0.9 });
    const crowdTex = createCrowdTexture();
    const crowdMat = new THREE.MeshBasicMaterial({ map: crowdTex, side: THREE.DoubleSide, toneMapped: false });
    const r0 = TABLE.arcRadius + 0.9;
    const step = 1.25;
    const tierH = 1.0;
    for (let i = 0; i < tiers; i++) {
      const inner = r0 + i * step;
      const outer = inner + step;
      const y = 1.4 + i * tierH;
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48, 1, 0, Math.PI), seatMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c.x, y, c.z);
      ring.receiveShadow = true;
      this.group.add(ring);
      const riser = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, tierH + (i === 0 ? 1.4 : 0), 48, 1, true, Math.PI / 2, Math.PI), riserMat);
      riser.position.set(c.x, y - (tierH + (i === 0 ? 1.4 : 0)) / 2, c.z);
      this.group.add(riser);
      // Crowd silhouettes band along each tier.
      const band = new THREE.Mesh(new THREE.CylinderGeometry(inner + step * 0.55, inner + step * 0.55, 0.9, 48, 1, true, Math.PI / 2, Math.PI), crowdMat);
      band.position.set(c.x, y + 0.45, c.z);
      this.group.add(band);
    }
    // Instanced 3D crowd on the front tier for depth.
    const count = this.quality === 'low' ? 120 : this.quality === 'medium' ? 240 : 380;
    const geo = new THREE.CapsuleGeometry(0.16, 0.22, 2, 6);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.crowd = new THREE.InstancedMesh(geo, mat, count);
    this.crowdBase = new Float32Array(count * 3);
    const palette = [0xe8e3d4, 0xd64545, 0x2c7be5, 0xf5c542, 0x8fd0ff, 0xf2a65a, 0xffffff, 0x4bc26b, 0x1f3b73];
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const tier = i % tiers;
      const a = 0.06 * Math.PI + Math.random() * 0.88 * Math.PI;
      const r = r0 + tier * step + 0.35 + Math.random() * 0.6;
      const x = c.x + Math.cos(a) * r;
      const z = c.z - Math.sin(a) * r;
      const y = 1.4 + tier * tierH + 0.3;
      this.crowdBase[i * 3] = x;
      this.crowdBase[i * 3 + 1] = y;
      this.crowdBase[i * 3 + 2] = z;
      m.makeTranslation(x, y, z);
      this.crowd.setMatrixAt(i, m);
      color.set(palette[Math.floor(Math.random() * palette.length)]);
      this.crowd.setColorAt(i, color);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    if (this.crowd.instanceColor) this.crowd.instanceColor.needsUpdate = true;
    this.group.add(this.crowd);
    // Back wall of the stands with a pennant row.
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r0 + tiers * step + 0.1, r0 + tiers * step + 0.1, 4.6, 48, 1, true, Math.PI / 2, Math.PI), riserMat);
    wall.position.set(c.x, 2.9, c.z);
    this.group.add(wall);
  }

  private buildFloodlights(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a94a6, roughness: 0.5, metalness: 0.6 });
    const positions = [
      [-11.2, -23.5],
      [11.2, -23.5],
      [-11.9, -6],
      [11.9, -6],
    ];
    for (const [x, z] of positions) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 8), poleMat);
      pole.position.set(x, 4.5, z);
      const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 1.6, roughness: 0.4 });
      this.floodPanels.push(panelMat);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 0.2), panelMat);
      panel.position.set(x, 9.3, z);
      panel.lookAt(0, 0, -4);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 0.1), poleMat);
      frame.position.copy(panel.position);
      frame.quaternion.copy(panel.quaternion);
      frame.translateZ(-0.1);
      this.group.add(pole, panel, frame);
    }
  }

  // ------------------------------------------------------------------ team / situation

  setOffense(playerBatting: boolean): void {
    this.playerBatting = playerBatting;
    const batting = playerBatting ? this.teams.player : this.teams.cpu;
    const fielding = playerBatting ? this.teams.cpu : this.teams.player;
    this.batter.setMaterials(batting);
    this.onDeck.setMaterials(batting);
    for (const r of this.runnerPool) r.setMaterials(batting);
    for (const f of this.fielders.values()) f.setMaterials(fielding);
    this.clearRunners();
    this.resetFielders();
    this.batter.warpTo(toWorld(this.diamond.batter.x, this.diamond.batter.y));
    this.batter.visible = true;
    this.batter.play('ready');
  }

  /** Places runner figures to match the authoritative baseball state. */
  syncRunners(state: BaseballState): void {
    if (this.runners.some((r) => r.index < r.path.length)) return; // animations in flight
    const wanted = new Map<number, number>();
    state.bases.forEach((r, i) => {
      if (r) wanted.set(r.id, i + 1);
    });
    for (const r of [...this.runners]) {
      const base = wanted.get(r.runnerId);
      if (base === undefined) this.releaseRunner(r);
      else {
        wanted.delete(r.runnerId);
        r.figure.warpTo(this.basePositions[base].clone());
        r.figure.face(this.faceTowardsNext(base));
      }
    }
    for (const [id, base] of wanted) {
      const figure = this.acquireRunner();
      if (!figure) continue;
      figure.warpTo(this.basePositions[base].clone());
      figure.face(this.faceTowardsNext(base));
      figure.play('idle');
      this.runners.push({ figure, runnerId: id, path: [], index: 0, done: 'stay', delay: 0 });
    }
  }

  private faceTowardsNext(base: number): number {
    const from = this.basePositions[base];
    const to = this.basePositions[(base + 1) % 4];
    return Math.atan2(to.x - from.x, to.z - from.z);
  }

  private acquireRunner(): PlayerFigure | null {
    const free = this.runnerPool.find((r) => !r.visible);
    if (!free) return null;
    free.visible = true;
    free.hop = 0;
    return free;
  }

  private releaseRunner(r: RunnerAnim): void {
    r.figure.visible = false;
    r.figure.target = null;
    const i = this.runners.indexOf(r);
    if (i >= 0) this.runners.splice(i, 1);
  }

  private clearRunners(): void {
    for (const r of [...this.runners]) this.releaseRunner(r);
  }

  private resetFielders(): void {
    for (const [role, f] of this.fielders) {
      const p = this.diamond.fielders[role];
      f.moveTo(toWorld(p.x, p.y), 6, () => {
        f.face(Math.PI);
        f.play(role === 'C' ? 'ready' : 'idle');
      });
    }
  }

  // ------------------------------------------------------------------ plays

  /** Pitcher winds up and throws so the ball reaches the plate after `delay` seconds. */
  startPitch(delay: number): void {
    const pitcher = this.fielders.get('P')!;
    const from = toWorld(this.diamond.mound.x, this.diamond.mound.y, 1.1);
    const to = toWorld(this.diamond.home.x, this.diamond.home.y + 0.2, 0.7);
    this.batter.play('ready');
    this.pitch = { from, to, peak: 0.1, duration: Math.max(0.3, delay), t: -Math.max(0, delay - 0.45), bounces: 0, onLand: null };
    setTimeout(() => pitcher.play('pitch'), 0);
    this.baseball.visible = true;
    this.baseball.position.copy(from);
  }

  swing(): void {
    this.batter.play('swing');
  }

  /** Launches the baseball and moves fielders/runners according to the play. */
  resolvePlay(spec: FlightSpec, play: PlayResult, cameraFollow?: (p: THREE.Vector3) => void): void {
    void cameraFollow;
    this.pitch = null;
    const home = this.diamond.home;
    const baseAngle = spec.direction === 'left' ? 125 : spec.direction === 'right' ? 55 : 90;
    const angle = THREE.MathUtils.degToRad(baseAngle + (Math.random() - 0.5) * (spec.foul ? 70 : 22));
    const dir: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
    // Distance from home plate to the outfield wall along this direction.
    const cx = TABLE.arcCenter.x - home.x;
    const cy = TABLE.arcCenter.y - home.y;
    const b = 2 * (dir.x * -cx + dir.y * -cy);
    const c = cx * cx + cy * cy - TABLE.arcRadius * TABLE.arcRadius;
    const disc = Math.max(0, b * b - 4 * c);
    const wallDist = (-b + Math.sqrt(disc)) / 2;
    const landDist = spec.foul ? 6 : Math.min(spec.homeRun ? wallDist * 1.25 : wallDist * spec.distance, wallDist * 1.35);
    const land: Vec2 = { x: home.x + dir.x * landDist, y: home.y + dir.y * landDist };
    const from = toWorld(home.x, home.y, 0.9);
    const to = toWorld(land.x, land.y, spec.homeRun ? 3.2 : 0.2);
    const peak = spec.homeRun ? 9 : spec.trajectory === 'fly' ? 6.5 : spec.trajectory === 'pop' ? 7.5 : spec.trajectory === 'line' ? 1.6 : 0.5;
    const duration = spec.homeRun ? 1.9 : spec.trajectory === 'fly' || spec.trajectory === 'pop' ? 1.6 : spec.trajectory === 'line' ? 0.9 : 0.8;
    this.baseball.visible = true;
    this.baseball.position.copy(from);
    const fielderRole = this.nearestFielder(land);
    const fielder = this.fielders.get(fielderRole)!;
    const isOut = play.outs > 0 && !play.hit;
    this.flight = {
      from,
      to,
      peak,
      duration,
      t: 0,
      bounces: spec.trajectory === 'ground' ? 2 : 0,
      onLand: () => {
        if (spec.homeRun) {
          this.crowdExcitement = 1;
          this.floodPulse = 1;
          this.baseball.visible = false;
          for (const f of this.fielders.values()) f.play('idle');
          return;
        }
        if (spec.foul) {
          this.baseball.visible = false;
          return;
        }
        // Fielder throws to a base: first for outs, the infield otherwise.
        const throwTo = isOut ? this.basePositions[1] : this.basePositions[2];
        fielder.play('throw');
        const start = this.baseball.position.clone();
        this.flight = { from: start, to: throwTo.clone().setY(0.6), peak: 1.2, duration: 0.55, t: 0, bounces: 0, onLand: () => (this.baseball.visible = false) };
      },
    };
    // Fielder runs to the landing spot (or the wall for home runs).
    const chase = spec.homeRun ? { x: home.x + dir.x * (wallDist - 1.2), y: home.y + dir.y * (wallDist - 1.2) } : land;
    fielder.moveTo(toWorld(chase.x, chase.y), 8);
    if (play.doublePlay) {
      const ss = this.fielders.get(fielderRole === 'SS' ? '2B' : 'SS')!;
      ss.moveTo(this.basePositions[2].clone().add(new THREE.Vector3(0.6, 0, 0.6)), 8, () => ss.play('throw'));
    }
    // Runners.
    this.animateMoves(play.moves, spec.homeRun ? 0.35 : 0.1);
    // Batter becomes a runner (handled by moves from base 0) and the on-deck hitter steps in.
    const batterMoves = play.moves.some((m) => m.from === 0);
    if (batterMoves) {
      this.batter.visible = false;
      this.returnTimer = Math.max(this.returnTimer, 1.6);
    }
    this.returnTimer = Math.max(this.returnTimer, 3.2);
    if (isOut) this.crowdExcitement = Math.max(this.crowdExcitement, this.playerBatting ? 0.1 : 0.45);
    else if (play.hit) this.crowdExcitement = Math.max(this.crowdExcitement, this.playerBatting ? 0.55 : 0.15);
    if (play.runs > 0 && this.playerBatting) this.crowdExcitement = 1;
  }

  /** Runner movement without a batted ball (steals, walks). */
  animateMoves(moves: RunnerMove[], delay = 0): void {
    for (const m of moves) {
      let anim = this.runners.find((r) => r.runnerId === m.runner.id);
      if (!anim) {
        const figure = this.acquireRunner();
        if (!figure) continue;
        figure.warpTo(this.basePositions[m.from].clone());
        anim = { figure, runnerId: m.runner.id, path: [], index: 0, done: 'stay', delay };
        this.runners.push(anim);
      }
      const path: THREE.Vector3[] = [];
      if (m.to === 'out') {
        // Jog toward the next base then off to the dugout.
        const next = Math.min(3, m.from + 1);
        path.push(this.basePositions[next].clone());
        path.push((this.playerBatting ? this.dugoutLeft : this.dugoutRight).clone());
        anim.done = 'out';
      } else {
        for (let b = m.from + 1; b <= m.to; b++) path.push(this.basePositions[b % 4].clone());
        anim.done = m.to === 4 ? 'score' : 'stay';
        if (m.to === 4) path.push((this.playerBatting ? this.dugoutLeft : this.dugoutRight).clone());
      }
      anim.path = path;
      anim.index = 0;
      anim.delay = delay;
      anim.figure.play('run');
    }
  }

  private nearestFielder(p: Vec2): (typeof FIELDER_ROLES)[number] {
    let best: (typeof FIELDER_ROLES)[number] = 'CF';
    let bestD = Infinity;
    for (const role of FIELDER_ROLES) {
      if (role === 'P' || role === 'C') continue;
      const f = this.diamond.fielders[role];
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = role;
      }
    }
    return best;
  }

  celebrate(): void {
    for (const r of this.runners) r.figure.play('celebrate');
    this.batter.play('celebrate');
    this.crowdExcitement = 1;
    this.floodPulse = 1;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.time += dt;
    // Pinball proximity: tiny players hop out of the way of the steel ball.
    for (const ball of this.world.balls) {
      if (ball.state !== 'free') continue;
      toWorld(ball.pos.x, ball.pos.y, 0, this.tmp);
      for (const f of this.fielders.values()) if (f.hop <= 0 && f.position.distanceToSquared(this.tmp) < 1.8) f.hop = 1;
      if (this.batter.visible && this.batter.hop <= 0 && this.batter.position.distanceToSquared(this.tmp) < 1.8) this.batter.hop = 1;
      for (const r of this.runners) if (r.figure.hop <= 0 && r.figure.position.distanceToSquared(this.tmp) < 1.8) r.figure.hop = 1;
    }
    for (const f of this.fielders.values()) f.update(dt, this.time);
    this.batter.update(dt, this.time);
    this.onDeck.update(dt, this.time);
    // Runners.
    for (const r of [...this.runners]) {
      if (r.delay > 0) {
        r.delay -= dt;
      } else if (r.index < r.path.length && !r.figure.target) {
        const next = r.path[r.index];
        r.figure.moveTo(next, 9, () => {
          r.index += 1;
          if (r.index >= r.path.length) {
            if (r.done === 'stay') {
              r.figure.play('idle');
              const baseIdx = this.basePositions.findIndex((b) => b.distanceToSquared(r.figure.position) < 0.3);
              if (baseIdx >= 0) r.figure.face(this.faceTowardsNext(baseIdx));
            } else this.releaseRunner(r);
          }
        });
      }
      r.figure.update(dt, this.time);
    }
    // Pitch.
    if (this.pitch) {
      this.pitch.t += dt;
      if (this.pitch.t >= 0) {
        const k = Math.min(1, this.pitch.t / this.pitch.duration);
        this.baseball.position.lerpVectors(this.pitch.from, this.pitch.to, k);
        this.baseball.position.y += Math.sin(k * Math.PI) * this.pitch.peak;
        if (k >= 1) {
          this.pitch = null;
          this.fielders.get('C')!.play('throw');
        }
      }
    }
    // Batted ball flight.
    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.duration);
      this.baseball.position.lerpVectors(f.from, f.to, k);
      let arc = Math.sin(k * Math.PI) * f.peak;
      if (f.bounces > 0) arc = Math.abs(Math.sin(k * Math.PI * (f.bounces + 1))) * f.peak * (1 - k * 0.6);
      this.baseball.position.y += arc;
      this.baseball.rotation.x += dt * 20;
      if (k >= 1) {
        const cb = f.onLand;
        this.flight = null;
        cb?.();
      }
    }
    // Fielders return and a new batter steps in after the play.
    if (this.returnTimer > 0) {
      this.returnTimer -= dt;
      if (this.returnTimer <= 0) {
        this.resetFielders();
        this.batter.visible = true;
        this.batter.warpTo(toWorld(this.diamond.batter.x, this.diamond.batter.y));
        this.batter.face(-Math.PI / 2);
        this.batter.play('ready');
        this.baseball.visible = false;
      }
    }
    // Crowd excitement: the instanced crowd bounces, floodlights flare.
    if (this.crowd && this.crowdBase) {
      const amp = this.crowdExcitement;
      if (amp > 0.01) {
        const m = new THREE.Matrix4();
        const n = this.crowd.count;
        for (let i = 0; i < n; i++) {
          const y = this.crowdBase[i * 3 + 1] + Math.max(0, Math.sin(this.time * 9 + i * 0.7)) * amp * 0.5;
          m.makeTranslation(this.crowdBase[i * 3], y, this.crowdBase[i * 3 + 2]);
          this.crowd.setMatrixAt(i, m);
        }
        this.crowd.instanceMatrix.needsUpdate = true;
      }
      this.crowdExcitement = Math.max(0, this.crowdExcitement - dt * 0.35);
    }
    if (this.floodPulse > 0) {
      this.floodPulse = Math.max(0, this.floodPulse - dt * 0.6);
      const k = 1.6 + Math.max(0, Math.sin(this.time * 14)) * this.floodPulse * 3.5;
      for (const m of this.floodPanels) m.emissiveIntensity = k;
    }
  }
}
