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
  /** Degrees off the centre-field line (negative = left field). */
  sprayDeg: number;
  distance: number;
  trajectory: 'ground' | 'line' | 'fly' | 'pop';
  homeRun: boolean;
  foul: boolean;
  dive?: boolean;
}

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  peak: number;
  duration: number;
  t: number;
  bounces: number;
  /** Lateral break (pitches). */
  curve: number;
  onEnd: (() => void) | null;
}

const TRAIL = 7;

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
  /** Queue of ball movements: batted ball, then throws. */
  private legs: Flight[] = [];
  private pitch: Flight | null = null;
  private pitcherWindup = -1;
  private landedHomeRun = false;
  private caught: { role: string; dive: boolean } | null = null;
  private trail: THREE.Mesh[] = [];
  private trailPos: THREE.Vector3[] = [];
  private tmpMatrix = new THREE.Matrix4();
  /** Baseline crowd excitement (rally / clutch). */
  private mood = 0;
  private moodLights = false;
  private teams: { player: TeamMaterials; cpu: TeamMaterials };
  private playerBatting = true;
  private crowd: THREE.InstancedMesh | null = null;
  private crowdBase: Float32Array | null = null;
  private crowdExcitement = 0;
  /** Travelling wave phase across the stands (radians); negative = no wave. */
  private wave = -1;
  private crowdAngles: Float32Array | null = null;
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
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < TRAIL; i++) {
      const m = new THREE.Mesh(this.baseball.geometry, trailMat);
      m.scale.setScalar(0.85 - i * 0.1);
      m.visible = false;
      this.group.add(m);
      this.trail.push(m);
      this.trailPos.push(new THREE.Vector3());
    }
  }

  private resetTrail(): void {
    for (let i = 0; i < TRAIL; i++) {
      this.trail[i].visible = false;
      this.trailPos[i].copy(this.baseball.position);
    }
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
    this.crowdAngles = new Float32Array(count);
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
      this.crowdAngles[i] = a;
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

  /**
   * Pitcher winds up and throws so the ball reaches the plate after `delay`
   * seconds. Breaking pitches visibly curve on the way in.
   */
  startPitch(delay: number, breakX = 0): void {
    const pitcher = this.fielders.get('P')!;
    const from = toWorld(this.diamond.mound.x, this.diamond.mound.y, 1.1);
    const to = toWorld(this.diamond.home.x, this.diamond.home.y + 0.2, 0.7);
    this.legs.length = 0;
    this.batter.visible = true;
    this.batter.play('ready');
    for (const [role, f] of this.fielders) if (role !== 'P' && role !== 'C' && !f.target) f.play('ready');
    const flight = Math.min(0.55, Math.max(0.3, delay * 0.45));
    this.pitch = { from, to, peak: 0.12, duration: flight, t: -Math.max(0, delay - flight), bounces: 0, curve: breakX * 0.9, onEnd: null };
    this.pitcherWindup = Math.max(0, delay - flight - 0.35);
    void pitcher;
    this.baseball.visible = true;
    this.baseball.position.copy(from);
    this.resetTrail();
  }

  swing(): void {
    this.batter.play('swing');
  }

  /** The batter took the pitch: the catcher squeezes it, the batter steps out. */
  takePitch(strike: boolean): void {
    this.snapPitchToPlate();
    this.fielders.get('C')!.play('throw');
    if (strike) this.batter.play('slump');
    this.returnTimer = Math.max(this.returnTimer, 0.9);
  }

  private snapPitchToPlate(): void {
    if (this.pitch) {
      this.baseball.position.copy(this.pitch.to);
      this.pitch = null;
    }
  }

  /** Landing point in table units for a spray angle and a normalised distance (1 = the wall). */
  private landing(sprayDeg: number, distance: number): { point: Vec2; dir: Vec2; wallDist: number } {
    const home = this.diamond.home;
    const angle = THREE.MathUtils.degToRad(90 - sprayDeg);
    const dir: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
    const cx = TABLE.arcCenter.x - home.x;
    const cy = TABLE.arcCenter.y - home.y;
    const b = 2 * (dir.x * -cx + dir.y * -cy);
    const c = cx * cx + cy * cy - TABLE.arcRadius * TABLE.arcRadius;
    const disc = Math.max(0, b * b - 4 * c);
    const wallDist = (-b + Math.sqrt(disc)) / 2;
    const d = wallDist * distance;
    return { point: { x: home.x + dir.x * d, y: home.y + dir.y * d }, dir, wallDist };
  }

  private fielderFor(p: Vec2, infieldOnly: boolean): (typeof FIELDER_ROLES)[number] {
    let best: (typeof FIELDER_ROLES)[number] = 'CF';
    let bestD = Infinity;
    for (const role of FIELDER_ROLES) {
      if (role === 'P' || role === 'C') continue;
      if (infieldOnly && (role === 'LF' || role === 'CF' || role === 'RF')) continue;
      const f = this.diamond.fielders[role];
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = role;
      }
    }
    return best;
  }

  private leg(from: THREE.Vector3, to: THREE.Vector3, peak: number, duration: number, bounces = 0, onEnd: (() => void) | null = null): void {
    this.legs.push({ from: from.clone(), to: to.clone(), peak, duration, t: 0, bounces, curve: 0, onEnd });
  }

  private throwFrom(fielder: PlayerFigure, to: THREE.Vector3, then: (() => void) | null = null): void {
    fielder.play('throw');
    const from = fielder.position.clone().setY(1.0);
    const d = from.distanceTo(to);
    this.leg(from, to.clone().setY(0.8), Math.min(2, d * 0.08), Math.max(0.25, d / 22), 0, then);
  }

  /**
   * Animates a batted ball so the miniature play matches the scoreboard: catches
   * land in a glove, hits land where nobody is, grounders are fielded and thrown.
   */
  resolvePlay(spec: FlightSpec, play: PlayResult): void {
    this.snapPitchToPlate();
    this.legs.length = 0;
    this.resetTrail();
    const type = play.play.type;
    const plate = toWorld(this.diamond.home.x, this.diamond.home.y, 0.9);
    const isOut = play.outs > 0 && !play.hit;

    if (type === 'strikeout') {
      this.fielders.get('C')!.play('throw');
      this.batter.play('slump');
      this.baseball.visible = false;
      this.returnTimer = Math.max(this.returnTimer, 1.4);
      this.crowdExcitement = Math.max(this.crowdExcitement, this.playerBatting ? 0.05 : 0.5);
      return;
    }
    this.batter.play('swing');
    this.baseball.visible = true;
    this.baseball.position.copy(plate);

    if (spec.foul || type === 'foul') {
      const { point } = this.landing(spec.sprayDeg < 0 ? -58 : 58, 0.45);
      this.leg(plate, toWorld(point.x, point.y, 2.6), 5, 1.0, 0, () => (this.baseball.visible = false));
      this.returnTimer = Math.max(this.returnTimer, 1.2);
      return;
    }

    if (type === 'homeRun') {
      const { point, dir, wallDist } = this.landing(spec.sprayDeg, Math.max(1.15, spec.distance));
      const land = toWorld(point.x, point.y, 3.4);
      this.leg(plate, land, 9 + (spec.distance - 1.1) * 6, 1.9, 0, () => {
        this.baseball.visible = false;
        this.crowdExcitement = 1;
        this.floodPulse = 1;
        this.landedHomeRun = true;
      });
      // The nearest outfielder races back to the wall and can only watch.
      const role = this.fielderFor({ x: this.diamond.home.x + dir.x * wallDist * 0.8, y: this.diamond.home.y + dir.y * wallDist * 0.8 }, false);
      const f = this.fielders.get(role)!;
      f.moveTo(toWorld(this.diamond.home.x + dir.x * (wallDist - 1), this.diamond.home.y + dir.y * (wallDist - 1)), 9, () => f.play('idle'));
      this.animateMoves(play.moves, 0.35);
      this.batter.visible = false;
      this.returnTimer = Math.max(this.returnTimer, 4.2);
      this.crowdExcitement = Math.max(this.crowdExcitement, 0.6);
      return;
    }

    const ground = spec.trajectory === 'ground' || type === 'groundOut' || type === 'error';
    let distance = spec.distance;
    if (type === 'single') distance = Math.min(distance, spec.trajectory === 'ground' ? 0.52 : 0.62);
    if (type === 'groundOut' || type === 'error') distance = 0.3;
    if (type === 'popOut') distance = Math.min(distance, 0.28);
    let spray = spec.sprayDeg;
    // Hits find the gaps; outs find a glove.
    if (type === 'double' || type === 'single') spray = spray >= 0 ? Math.max(spray, 14) : Math.min(spray, -14);
    if (type === 'triple') spray = spray >= 0 ? Math.max(spray, 32) : Math.min(spray, -32);
    const { point } = this.landing(spray, distance);
    const infield = ground || type === 'popOut' || (type === 'lineOut' && distance < 0.5);
    const role = this.fielderFor(point, infield);
    const fielder = this.fielders.get(role)!;
    const peak = spec.trajectory === 'fly' ? 6 : spec.trajectory === 'pop' ? 7.5 : spec.trajectory === 'line' ? 1.4 : 0.45;
    const duration = spec.trajectory === 'fly' || spec.trajectory === 'pop' ? 1.45 : spec.trajectory === 'line' ? 0.75 : 0.7;
    const landAt = toWorld(point.x, point.y, isOut && !ground ? 1.1 : 0.2);
    const fielderStart = fielder.position.clone();
    const runDist = Math.hypot(landAt.x - fielderStart.x, landAt.z - fielderStart.z);
    const first = this.basePositions[1];
    const second = this.basePositions[2];
    const third = this.basePositions[3];

    if (isOut && !ground) {
      // Catch: the fielder gets there just in time; long runs end in a dive.
      const dive = spec.dive || (type === 'lineOut' && runDist > 2.2);
      const speed = Math.max(5, runDist / (duration * 0.85));
      fielder.moveTo(landAt.clone().setY(0), speed, () => fielder.play(dive ? 'dive' : 'catch'));
      this.leg(plate, landAt, peak, duration, 0, () => {
        this.baseball.visible = false;
        this.caught = { role, dive };
        // Throw it back in to the cut-off man after the catch.
        setTimeout(() => {
          if (!this.legs.length) {
            this.baseball.visible = true;
            this.throwFrom(fielder, second.clone(), () => (this.baseball.visible = false));
          }
        }, dive ? 650 : 350);
      });
    } else if (ground && (type === 'groundOut' || type === 'error')) {
      const speed = Math.max(5, runDist / (duration * 0.9));
      fielder.moveTo(landAt.clone().setY(0), speed, () => fielder.play('catch'));
      const firstBase = this.fielders.get('1B')!;
      firstBase.moveTo(first.clone().add(new THREE.Vector3(0.35, 0, 0.1)), 7, () => firstBase.play('catch'));
      this.leg(plate, landAt, peak, duration, 2, () => {
        if (type === 'error') {
          // Bobbled: the ball squirts away and the throw is late.
          const away = landAt.clone().add(new THREE.Vector3(0.9, 0, 0.9));
          this.leg(landAt, away, 0.4, 0.45, 1, () => this.throwFrom(fielder, first.clone(), () => (this.baseball.visible = false)));
          return;
        }
        if (play.doublePlay) {
          // 6-4-3: to the bag at second, relay to first.
          const pivotRole = role === 'SS' || role === '3B' ? '2B' : 'SS';
          const pivot = this.fielders.get(pivotRole)!;
          this.throwFrom(fielder, second.clone(), () => {
            pivot.play('throw');
            this.throwFrom(pivot, first.clone(), () => (this.baseball.visible = false));
          });
        } else {
          this.throwFrom(fielder, first.clone(), () => (this.baseball.visible = false));
        }
      });
      if (play.doublePlay) {
        const pivotRole = role === 'SS' || role === '3B' ? '2B' : 'SS';
        this.fielders.get(pivotRole)!.moveTo(second.clone().add(new THREE.Vector3(0.3, 0, 0.3)), 9);
      }
    } else {
      // Base hit: the ball drops in, the fielder chases it down and throws it in.
      const roll = new THREE.Vector3(landAt.x - plate.x, 0, landAt.z - plate.z).normalize().multiplyScalar(type === 'single' ? 1 : 2.4);
      const stop = landAt.clone().add(roll).setY(0.2);
      const relay = type === 'triple' ? third : second;
      fielder.moveTo(stop.clone().setY(0), Math.max(6, runDist / 1.4));
      this.leg(plate, landAt, peak, duration, 0, () => {
        this.leg(landAt, stop, 0.5, 0.6, 1, () => this.throwFrom(fielder, relay.clone(), () => (this.baseball.visible = false)));
      });
    }

    // Runners.
    this.animateMoves(play.moves, 0.15);
    if (play.moves.some((m) => m.from === 0)) this.batter.visible = false;
    this.returnTimer = Math.max(this.returnTimer, 3.4);
    if (isOut) this.crowdExcitement = Math.max(this.crowdExcitement, this.playerBatting ? 0.1 : play.doublePlay ? 0.8 : 0.45);
    else if (play.hit) this.crowdExcitement = Math.max(this.crowdExcitement, this.playerBatting ? 0.55 : 0.15);
    if (play.runs > 0 && this.playerBatting) this.crowdExcitement = 1;
  }

  /** World-space position of the baseball (for the camera). Returns false when it is not in flight. */
  baseballWorld(out: THREE.Vector3): boolean {
    if (!this.baseball.visible) return false;
    this.baseball.getWorldPosition(out);
    return true;
  }

  /** Last world-space position of the baseball, even once it has disappeared into the seats. */
  baseballWorldLast(out: THREE.Vector3): void {
    this.baseball.getWorldPosition(out);
  }

  /** Rally and clutch moods: the crowd stays on its feet and the lights breathe. */
  setAtmosphere(mood: { rally: boolean; clutch: boolean }): void {
    this.mood = mood.rally ? 0.55 : mood.clutch ? 0.25 : 0;
    this.moodLights = mood.rally;
  }

  get flying(): boolean {
    return this.legs.length > 0;
  }

  /** Consumes the "the home run ball just landed" flag. */
  consumeHomeRunLanding(): boolean {
    const v = this.landedHomeRun;
    this.landedHomeRun = false;
    return v;
  }

  /** Consumes the most recent catch (for dust and sound). */
  consumeCatch(): { role: string; dive: boolean; at: THREE.Vector3 } | null {
    const c = this.caught;
    this.caught = null;
    if (!c) return null;
    const f = this.fielders.get(c.role);
    return f ? { role: c.role, dive: c.dive, at: f.position.clone() } : null;
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

  celebrate(): void {
    for (const r of this.runners) r.figure.play('celebrate');
    this.batter.play('celebrate');
    this.crowdExcitement = 1;
    this.floodPulse = 1;
  }

  /** The crowd does the wave: a bump that travels around the stands. */
  startWave(): void {
    this.wave = 0;
  }

  /** Floodlights flare (combos, bosses, jackpots). */
  flareLights(amount = 1): void {
    this.floodPulse = Math.max(this.floodPulse, amount);
  }

  /** Big moments: the stands go crazy. */
  excite(amount: number): void {
    this.crowdExcitement = Math.max(this.crowdExcitement, amount);
  }

  /** A random seat in the stands (world space, table group local) for camera flashes. */
  randomSeat(out: THREE.Vector3): THREE.Vector3 {
    if (!this.crowdBase || !this.crowd) return out.set(0, 3, -20);
    const i = Math.floor(Math.random() * this.crowd.count);
    return out.set(this.crowdBase[i * 3], this.crowdBase[i * 3 + 1] + 0.6, this.crowdBase[i * 3 + 2]);
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
    if (this.pitcherWindup >= 0) {
      this.pitcherWindup -= dt;
      if (this.pitcherWindup < 0) this.fielders.get('P')!.play('pitch');
    }
    if (this.pitch) {
      this.pitch.t += dt;
      if (this.pitch.t >= 0) {
        const k = Math.min(1, this.pitch.t / this.pitch.duration);
        this.baseball.position.lerpVectors(this.pitch.from, this.pitch.to, k);
        this.baseball.position.y += Math.sin(k * Math.PI) * this.pitch.peak;
        this.baseball.position.x += Math.sin(k * Math.PI * 0.5) * k * this.pitch.curve;
        if (k >= 1) {
          this.pitch = null;
          this.fielders.get('C')!.play('catch');
        }
      }
    }
    // Batted ball and throws.
    const leg = this.legs[0];
    if (leg) {
      leg.t += dt;
      const k = Math.min(1, leg.t / leg.duration);
      this.baseball.position.lerpVectors(leg.from, leg.to, k);
      let arc = Math.sin(k * Math.PI) * leg.peak;
      if (leg.bounces > 0) arc = Math.abs(Math.sin(k * Math.PI * (leg.bounces + 1))) * leg.peak * (1 - k * 0.6);
      this.baseball.position.y += arc;
      this.baseball.rotation.x += dt * 20;
      if (k >= 1) {
        this.legs.shift();
        leg.onEnd?.();
      }
    }
    // Comet trail behind fast balls.
    const showTrail = this.baseball.visible && (this.legs.length > 0 || (this.pitch !== null && this.pitch.t >= 0));
    for (let i = TRAIL - 1; i > 0; i--) this.trailPos[i].copy(this.trailPos[i - 1]);
    this.trailPos[0].copy(this.baseball.position);
    for (let i = 0; i < TRAIL; i++) {
      this.trail[i].visible = showTrail && i > 0;
      this.trail[i].position.copy(this.trailPos[i]);
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
        if (!this.legs.length) this.baseball.visible = false;
      }
    }
    // Crowd excitement: the instanced crowd bounces, floodlights flare.
    if (this.crowd && this.crowdBase) {
      const amp = this.crowdExcitement;
      if (this.wave >= 0) this.wave += dt * 2.6;
      if (this.wave > Math.PI + 1.2) this.wave = -1;
      if (amp > 0.01 || this.wave >= 0) {
        const m = this.tmpMatrix;
        const n = this.crowd.count;
        for (let i = 0; i < n; i++) {
          let y = this.crowdBase[i * 3 + 1] + Math.max(0, Math.sin(this.time * 9 + i * 0.7)) * amp * 0.5;
          if (this.wave >= 0 && this.crowdAngles) {
            const d = Math.abs(this.crowdAngles[i] - this.wave);
            if (d < 0.45) y += (1 - d / 0.45) * 0.8;
          }
          m.makeTranslation(this.crowdBase[i * 3], y, this.crowdBase[i * 3 + 2]);
          this.crowd.setMatrixAt(i, m);
        }
        this.crowd.instanceMatrix.needsUpdate = true;
      }
      this.crowdExcitement = Math.max(this.mood, this.crowdExcitement - dt * 0.35);
    }
    if (this.moodLights) this.floodPulse = Math.max(this.floodPulse, 0.35);
    if (this.floodPulse > 0) {
      this.floodPulse = Math.max(0, this.floodPulse - dt * 0.6);
      const k = 1.6 + Math.max(0, Math.sin(this.time * 14)) * this.floodPulse * 3.5;
      for (const m of this.floodPanels) m.emissiveIntensity = k;
    }
  }
}
