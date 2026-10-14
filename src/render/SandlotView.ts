import * as THREE from 'three';
import { DISPLAY } from './textures';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from '../game/Game';
import type { TableDef } from '../table/layout';
import { STUNT_AIRTIME, STUNT_IDEAL, type CityRush, type Landmark } from '../attractions/cityRush';
import { SmoothPose } from './CameraRig';
import { PlayerFigure, createTeamMaterials } from './PlayerFigure';
import type { Quality } from './Playfield';
import { buildTrack } from './rails';
import { toWorld } from './space';

/** Banner slots on the outfield wall, one per robbed home run (the rules call them landmarks). */
const BANNER_X: Record<Landmark, number> = { billboard: -7.4, waterTower: -5.2, neonSign: -3.0 };

/** Wall at the front of the sandlot (table y) and its height above the deck. */
const WALL_Y = 4.6;
const WALL_H = 1.5;
/** Where the fielder meets the ball at the top of the wall. */
const CATCH_Y = 5.05;

/**
 * THE SANDLOT: a practice ballpark on the left wing of the cabinet.
 *
 * Ambient life (kids playing catch, mowers on the edges, fans in the
 * bleachers, light towers), the diverter and skyway that bring the pinball to
 * the batting cage, and the WALL CATCH mini-game itself: an outfielder sprints
 * down the field, the flippers move him between three lanes to catch fly balls
 * and dodge mowers, tarp rollers and ball buckets, then a timed tap sends him
 * up the wall to rob a home run. Every robbed homer hangs a banner on the wall.
 */
export class SandlotView {
  readonly group = new THREE.Group();
  /** Viewport aspect (width / height): narrow portrait screens get a wider chase framing. */
  aspect = 1.6;
  /** Effects hook (sparks, bursts) supplied by the renderer, in table-local space. */
  onFx: ((kind: 'spark' | 'burst' | 'explode' | 'coin', at: THREE.Vector3) => void) | null = null;
  private deckH: number;
  private street: TableDef['attractions']['city']['street'];
  private time = 0;
  private fielder: PlayerFigure;
  private fielderX = 0;
  /** The fielder's table-space x (the race lanes and the leap work in table coordinates). */
  private fielderTX = 0;
  private flyBall: THREE.Mesh;
  private flyFrom = new THREE.Vector3();
  private flyTo = new THREE.Vector3();
  private flyOver = new THREE.Vector3();
  private rush: CityRush | null = null;
  private airFrom = new THREE.Vector3();
  private airSuccess = false;
  private landed = false;
  private bump = 0;
  private obstaclePool: Record<'car' | 'bus' | 'cones', THREE.Object3D[]>;
  private ballPool: THREE.Mesh[] = [];
  private banners = new Map<Landmark, { mesh: THREE.Mesh; grow: number; on: boolean }>();
  private mowers: THREE.InstancedMesh;
  private mowerS = [0, 0.5];
  private catchBalls: THREE.Mesh[] = [];
  private crowd: THREE.InstancedMesh;
  private crowdBase: Float32Array;
  private stands: Array<{ mesh: THREE.Object3D; level: number; grow: number }> = [];
  private lightHeads: THREE.MeshBasicMaterial;
  private cageDoor: THREE.Mesh;
  private diverter: THREE.Group;
  private diverterLamp: THREE.MeshBasicMaterial;
  private party = 0;
  private cheer = 0;
  private cam = new SmoothPose(3);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private m = new THREE.Matrix4();

  constructor(private game: Game, table: TableDef, private quality: Quality, railMaterial: THREE.Material, envMap: THREE.Texture | null, private toScene: (v: THREE.Vector3) => THREE.Vector3) {
    const lot = table.attractions.city;
    this.deckH = lot.deck.h;
    this.street = lot.street;
    this.buildDeck(lot.deck);
    this.buildWall();
    this.crowd = this.buildBleachers();
    this.crowdBase = (this.crowd.userData.base as Float32Array) ?? new Float32Array(0);
    this.cageDoor = this.buildCage();
    this.lightHeads = this.buildLightTowers();
    this.buildTrees();
    this.buildRisingStands();
    this.mowers = this.buildMowers();
    this.buildKids();
    this.obstaclePool = this.buildObstacles();
    this.buildBalls();
    this.fielder = new PlayerFigure(createTeamMaterials(0x1f3b73, 0xf2f2f2, 0xc81e1e), 'CF', false, true);
    this.fielder.scale.setScalar(1.35);
    this.group.add(this.fielder);
    this.flyBall = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.25 }));
    this.flyBall.visible = false;
    this.group.add(this.flyBall);
    // The skyway: the diverted ramp over the wall into the batting cage, and the ride home.
    const track = buildTrack(lot.track.slice(2), { color: 0x3bff9a, railMaterial, envMap, castShadow: quality === 'high', groundH: this.deckH, samples: 60 });
    const back = buildTrack(lot.returnTrack, { color: 0x3bff9a, railMaterial, envMap, castShadow: quality === 'high', groundH: this.deckH, samples: 90 });
    this.group.add(track, back);
    const div = this.buildDiverter(railMaterial);
    this.diverter = div.group;
    this.diverterLamp = div.lamp;
    this.parkFielder();
  }

  // ------------------------------------------------------------------ construction

  private w(x: number, y: number, h = this.deckH): THREE.Vector3 {
    return toWorld(x, y, h);
  }

  private buildDeck(d: { minX: number; maxX: number; minY: number; maxY: number; h: number }): void {
    const a = this.w(d.minX, d.maxY, 0);
    const b = this.w(d.maxX, d.minY, 0);
    const width = b.x - a.x;
    const depth = b.z - a.z;
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, d.h + 4.5, depth), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.6 }));
    box.position.set(a.x + width / 2, (d.h - 4.5) / 2 - 0.01, a.z + depth / 2);
    box.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.18, depth + 0.3), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.35 }));
    lip.position.set(box.position.x, d.h - 0.12, box.position.z);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: this.groundTexture(d), roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(box.position.x, d.h + 0.01, box.position.z);
    ground.receiveShadow = true;
    this.group.add(box, lip, ground);
  }

  /** Mowed outfield grass, the warning track, chalk lanes, the cage dirt and the plaza behind the wall. */
  private groundTexture(d: { minX: number; maxX: number; minY: number; maxY: number }): THREE.CanvasTexture {
    const S = 40;
    const W = Math.round((d.maxX - d.minX) * S);
    const H = Math.round((d.maxY - d.minY) * S);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const X = (x: number) => (x - d.minX) * S;
    const Y = (y: number) => (d.maxY - y) * S;
    const rect = (x0: number, y0: number, x1: number, y1: number, color: string) => {
      g.fillStyle = color;
      g.fillRect(X(x0), Y(y1), (x1 - x0) * S, (y1 - y0) * S);
    };
    // Mowed stripes across the outfield.
    for (let y = d.minY, i = 0; y < d.maxY; y += 1.2, i++) rect(d.minX, y, d.maxX, y + 1.2, i % 2 ? '#2a7d3a' : '#31903f');
    // Warning track in front of the wall, plaza and bleacher footing behind it.
    rect(d.minX, WALL_Y, d.maxX, 7.7, '#9c5833');
    rect(d.minX, d.minY, d.maxX, WALL_Y, '#262a35');
    // Batting-cage dirt at the back, with the "SANDLOT" lettering.
    rect(-7.2, 25.4, -3.2, 31.4, '#b8683c');
    g.save();
    g.translate(X(-5.2), Y(16.5));
    g.rotate(-Math.PI / 2);
    g.font = `600 ${Math.round(1.1 * S)}px ${DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillText('SANDLOT', 0, 0);
    g.restore();
    // Faint chalk lines between the three running lanes.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (const lx of [-6.775, -5.725, -4.675, -3.625]) for (let y = 7.8; y < 25.2; y += 0.9) g.fillRect(X(lx) - 1, Y(y + 0.5), 2, 0.5 * S);
    // Foul lines running to the wall at both edges.
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(X(d.minX + 0.35) - 1.5, Y(25.4), 3, (25.4 - WALL_Y) * S);
    g.fillRect(X(d.maxX - 0.35) - 1.5, Y(25.4), 3, (25.4 - WALL_Y) * S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** The padded outfield wall: green padding, a yellow home-run line, distance marker and three banner slots. */
  private buildWall(): void {
    const a = this.w(-9.7, WALL_Y, 0);
    const b = this.w(-0.8, WALL_Y, 0);
    const width = b.x - a.x;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(width, WALL_H, 0.32), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.8 }));
    pad.position.set(a.x + width / 2, this.deckH + WALL_H / 2, a.z);
    pad.castShadow = this.quality !== 'low';
    pad.receiveShadow = true;
    const line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.36), new THREE.MeshBasicMaterial({ color: 0xffe14d, toneMapped: false }));
    line.position.set(pad.position.x, this.deckH + WALL_H + 0.03, a.z);
    this.group.add(pad, line);
    for (const id of Object.keys(BANNER_X) as Landmark[]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.9), new THREE.MeshBasicMaterial({ map: labelTexture('ROBBED!', '#ffe14d', '#7a1020'), toneMapped: false, side: THREE.DoubleSide }));
      const p = this.w(BANNER_X[id], WALL_Y + 0.18, this.deckH + WALL_H * 0.55);
      mesh.position.copy(p);
      mesh.rotation.y = Math.PI;
      mesh.scale.set(1, 0.001, 1);
      mesh.visible = false;
      this.group.add(mesh);
      this.banners.set(id, { mesh, grow: 0, on: false });
    }
  }

  /** Bleachers and a crowd behind the wall: the home run ball lands here when it is not robbed. */
  private buildBleachers(): THREE.InstancedMesh {
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2b3b63, roughness: 0.85 });
    for (let i = 0; i < 3; i++) {
      const a = this.w(-9.5, WALL_Y - 0.4 - i * 1.15, 0);
      const b = this.w(-0.9, WALL_Y - 1.5 - i * 1.15, 0);
      const step = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x, 0.5 + i * 0.55, b.z - a.z), seatMat);
      step.position.set((a.x + b.x) / 2, this.deckH + (0.5 + i * 0.55) / 2, (a.z + b.z) / 2);
      step.receiveShadow = true;
      this.group.add(step);
    }
    const n = this.quality === 'low' ? 60 : 110;
    const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.11, 0.16, 2, 5), new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    const base = new Float32Array(n * 3);
    const palette = [0xe8e3d4, 0xd64545, 0x2c7be5, 0xf5c542, 0x8fd0ff, 0xf2a65a, 0x4bc26b, 0x1f3b73];
    const rnd = mulberry(5);
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const row = i % 3;
      const p = this.w(-9.3 + rnd() * 8.2, WALL_Y - 0.95 - row * 1.15, this.deckH + 0.5 + row * 0.55 + 0.2);
      base.set([p.x, p.y, p.z], i * 3);
      this.m.makeTranslation(p.x, p.y, p.z);
      crowd.setMatrixAt(i, this.m);
      crowd.setColorAt(i, color.set(palette[i % palette.length]));
    }
    crowd.userData.base = base;
    this.group.add(crowd);
    // A little scoreboard above the bleachers.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), new THREE.MeshBasicMaterial({ map: labelTexture('SANDLOT 400 FT', '#ffe14d', '#0c1a14'), toneMapped: false }));
    board.position.copy(this.w(-5.2, 0.3, this.deckH + 3.6));
    const posts = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.1, 0.12), new THREE.MeshStandardMaterial({ color: 0x3a3f4b }));
    posts.position.copy(this.w(-5.2, 0.32, this.deckH + 1.55));
    this.group.add(board, posts);
    return crowd;
  }

  /** The batting cage at the back, where the skyway drops the pinball (it stands in for the home run swing). */
  private buildCage(): THREE.Mesh {
    const a = this.w(-6.7, 28.7, 0);
    const b = this.w(-3.7, 26.0, 0);
    const net = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x, 1.6, b.z - a.z), new THREE.MeshStandardMaterial({ color: 0x1b2433, transparent: true, opacity: 0.45, roughness: 0.9, depthWrite: false }));
    net.position.set((a.x + b.x) / 2, this.deckH + 0.8, (a.z + b.z) / 2);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.6, roughness: 0.4 });
    const frame: THREE.BufferGeometry[] = [];
    for (const x of [a.x, b.x]) for (const z of [a.z, b.z]) {
      const g = new THREE.CylinderGeometry(0.05, 0.05, 1.7, 5);
      g.translate(x, this.deckH + 0.85, z);
      frame.push(g);
    }
    this.group.add(net, new THREE.Mesh(mergeGeometries(frame, false)!, frameMat));
    frame.forEach((g) => g.dispose());
    // Pitching machine and a sign.
    const machine = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0xd64545, roughness: 0.5 }));
    machine.position.copy(this.w(-5.2, 28.3, this.deckH + 0.25));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.42), new THREE.MeshBasicMaterial({ map: labelTexture('BATTING CAGE', '#3bff9a', '#0c1a14'), toneMapped: false }));
    sign.position.set(net.position.x, this.deckH + 1.85, b.z + 0.02);
    // The gate opens when the fielder runs out.
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.2), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.7 }));
    door.position.set(net.position.x, this.deckH + 0.6, b.z + 0.015);
    this.group.add(machine, sign, door);
    return door;
  }

  /** Four light towers: the more the sandlot is played, the brighter they burn. */
  private buildLightTowers(): THREE.MeshBasicMaterial {
    const pole = new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.6, roughness: 0.5 });
    const heads = new THREE.MeshBasicMaterial({ color: 0xfff3d6, toneMapped: false });
    for (const [x, y] of [[-9.3, 8.5], [-9.3, 22.5], [-1.2, 8.5], [-1.2, 22.5]]) {
      const p = this.w(x, y, 0);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.6, 6), pole);
      mast.position.set(p.x, this.deckH + 2.3, p.z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.12), heads);
      head.position.set(p.x, this.deckH + 4.7, p.z);
      head.lookAt(this.w(-5.2, 16, this.deckH));
      this.group.add(mast, head);
    }
    return heads;
  }

  private buildTrees(): void {
    const n = this.quality === 'low' ? 8 : 14;
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 0.9, 7), new THREE.MeshStandardMaterial({ color: 0x2f7a3e, roughness: 0.9 }), n);
    const rnd = mulberry(9);
    for (let i = 0; i < n; i++) {
      const p = this.w(-9.55 + rnd() * 0.3, 8 + (i / n) * 22, this.deckH + 0.45);
      this.m.makeScale(1, 0.8 + rnd() * 0.5, 1).setPosition(p.x, p.y, p.z);
      trees.setMatrixAt(i, this.m);
    }
    this.group.add(trees);
  }

  /** Three extra stands along the east edge that fill in as the sandlot levels up. */
  private buildRisingStands(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4f5d75, roughness: 0.7 });
    [10.5, 16.5, 22.5].forEach((y, i) => {
      const g = new THREE.Group();
      const base = this.w(-1.55, y, this.deckH);
      g.position.copy(base);
      for (let r = 0; r < 2; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35 + r * 0.35, 2.6), mat);
        step.position.set(0.28 * r - 0.14, (0.35 + r * 0.35) / 2, 0);
        g.add(step);
      }
      const fans = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.1, 0.14, 2, 4), new THREE.MeshStandardMaterial({ roughness: 0.9 }), 12);
      const color = new THREE.Color();
      for (let k = 0; k < 12; k++) {
        const r = k % 2;
        this.m.makeTranslation(0.28 * r - 0.14, 0.35 + r * 0.35 + 0.18, -1.1 + (k >> 1) * 0.44);
        fans.setMatrixAt(k, this.m);
        fans.setColorAt(k, color.set([0xd64545, 0x2c7be5, 0xf5c542, 0xe8e3d4][k % 4]));
      }
      g.add(fans);
      g.scale.y = 0.001;
      g.visible = false;
      this.group.add(g);
      this.stands.push({ mesh: g, level: i + 1, grow: 0 });
    });
  }

  private mowerGeometry(scale = 1): THREE.BufferGeometry {
    const deck = new THREE.BoxGeometry(0.6 * scale, 0.14 * scale, 0.8 * scale);
    deck.translate(0, 0.12 * scale, 0);
    const body = new THREE.BoxGeometry(0.42 * scale, 0.24 * scale, 0.5 * scale);
    body.translate(0, 0.3 * scale, -0.08 * scale);
    const seat = new THREE.BoxGeometry(0.3 * scale, 0.22 * scale, 0.08 * scale);
    seat.translate(0, 0.5 * scale, -0.3 * scale);
    const g = mergeGeometries([deck, body, seat], false)!;
    [deck, body, seat].forEach((x) => x.dispose());
    return g;
  }

  /** Two ride-on mowers lapping the edges of the field. */
  private buildMowers(): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.mowerGeometry(), new THREE.MeshStandardMaterial({ color: 0x2e8b3e, roughness: 0.5 }), 2);
    this.group.add(mesh);
    return mesh;
  }

  /** Kids playing catch in pairs on the edges, the ball looping between them. */
  private buildKids(): THREE.InstancedMesh {
    const pairs: Array<[number, number, number, number]> = [
      [-8.9, 11, -8.9, 14],
      [-1.9, 26, -1.9, 29],
      [-8.9, 19, -8.9, 22],
    ];
    const mesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.08, 0.18, 2, 5), new THREE.MeshStandardMaterial({ roughness: 0.9 }), pairs.length * 2);
    const color = new THREE.Color();
    pairs.forEach(([x0, y0, x1, y1], i) => {
      for (const [k, x, y] of [[0, x0, y0], [1, x1, y1]] as const) {
        const p = this.w(x, y, this.deckH + 0.17);
        this.m.makeTranslation(p.x, p.y, p.z);
        mesh.setMatrixAt(i * 2 + k, this.m);
        mesh.setColorAt(i * 2 + k, color.set(k ? 0xd64545 : 0x2c7be5));
      }
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ball.userData.a = this.w(x0, y0, this.deckH + 0.32);
      ball.userData.b = this.w(x1, y1, this.deckH + 0.32);
      ball.userData.phase = i * 0.7;
      this.group.add(ball);
      this.catchBalls.push(ball);
    });
    this.group.add(mesh);
    return mesh;
  }

  /** Race obstacles: mowers (one lane), tarp rollers (two lanes) and ball buckets (one lane). */
  private buildObstacles(): Record<'car' | 'bus' | 'cones', THREE.Object3D[]> {
    const pool: Record<'car' | 'bus' | 'cones', THREE.Object3D[]> = { car: [], bus: [], cones: [] };
    const mowerGeo = this.mowerGeometry(1.15);
    const tarpGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.9, 14);
    tarpGeo.rotateZ(Math.PI / 2);
    tarpGeo.translate(0, 0.42, 0);
    const standGeo = mergeGeometries([-0.9, 0.9].map((x) => new THREE.BoxGeometry(0.08, 0.42, 0.3).translate(x, 0.21, 0)), false)!;
    const bucketGeo = mergeGeometries([0, 1, 2].map((i) => new THREE.CylinderGeometry(0.14, 0.11, 0.3, 10).translate((i - 1) * 0.3, 0.15, 0)), false)!;
    const ballTops = mergeGeometries([0, 1, 2].map((i) => new THREE.SphereGeometry(0.13, 8, 6).translate((i - 1) * 0.3, 0.3, 0)), false)!;
    for (let i = 0; i < 12; i++) {
      const mower = new THREE.Mesh(mowerGeo, new THREE.MeshStandardMaterial({ color: [0x2e8b3e, 0xd64545, 0xf5c542][i % 3], roughness: 0.5 }));
      const tarp = new THREE.Group();
      tarp.add(new THREE.Mesh(tarpGeo, new THREE.MeshStandardMaterial({ color: 0x2c7be5, roughness: 0.6 })), new THREE.Mesh(standGeo, new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.5 })));
      const buckets = new THREE.Group();
      buckets.add(new THREE.Mesh(bucketGeo, new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 })), new THREE.Mesh(ballTops, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })));
      for (const o of [mower, tarp, buckets]) {
        o.visible = false;
        o.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) c.castShadow = this.quality !== 'low';
        });
        this.group.add(o);
      }
      pool.car.push(mower);
      pool.bus.push(tarp);
      pool.cones.push(buckets);
    }
    return pool;
  }

  /** Fly balls to catch (the rules call them coins). */
  private buildBalls(): void {
    const geo = new THREE.SphereGeometry(0.16, 12, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, emissive: 0xfff3d6, emissiveIntensity: 0.35 });
    const seam = new THREE.TorusGeometry(0.16, 0.018, 4, 16);
    const seamMat = new THREE.MeshBasicMaterial({ color: 0xd64545 });
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(geo, mat);
      b.add(new THREE.Mesh(seam, seamMat));
      b.visible = false;
      this.group.add(b);
      this.ballPool.push(b);
    }
  }

  private buildDiverter(railMaterial: THREE.Material): { group: THREE.Group; lamp: THREE.MeshBasicMaterial } {
    const g = new THREE.Group();
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 1.3), railMaterial);
    flap.position.set(0.45, 0, 0);
    g.add(flap);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x3bff9a, toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lampMat);
    lamp.position.set(0, 0.25, 0);
    g.add(lamp);
    g.position.copy(this.w(3.6, 31.6, 2.25));
    this.group.add(g);
    return { group: g, lamp: lampMat };
  }

  // ------------------------------------------------------------------ events

  /** WALL CATCH started: lay out the obstacles and fly balls for this run. */
  startRush(rush: CityRush): void {
    this.rush = rush;
    this.landed = false;
    this.bump = 0;
    this.fielderX = this.laneX(rush.lane);
    this.fielder.rotation.set(0, 0, 0);
    this.fielder.face(Math.PI);
    this.fielder.play('run');
    this.flyBall.visible = false;
    for (const list of Object.values(this.obstaclePool)) list.forEach((o) => (o.visible = false));
    this.ballPool.forEach((b) => (b.visible = false));
    const used = { car: 0, bus: 0, cones: 0 };
    for (const o of rush.obstacles) {
      const obj = this.obstaclePool[o.kind][used[o.kind]++];
      if (!obj) continue;
      const x = o.lanes.reduce((s, l) => s + this.laneX(l), 0) / o.lanes.length;
      obj.position.copy(this.w(x, this.progressY(o.at)));
      obj.rotation.set(0, o.kind === 'car' ? Math.PI / 2 : 0, 0);
      obj.visible = true;
      obj.userData.obstacle = o;
      obj.userData.knocked = false;
    }
    rush.coins.forEach((c, i) => {
      const b = this.ballPool[i];
      if (!b) return;
      b.position.copy(this.w(this.laneX(c.lane), this.progressY(c.at), this.deckH + 0.7));
      b.visible = true;
      b.userData.coin = c;
    });
  }

  rushEvent(type: string): void {
    const p = this.fielder.position.clone();
    if (type === 'crash') {
      this.bump = 0.45;
      this.onFx?.('spark', p.setY(p.y + 0.5));
    } else if (type === 'nearMiss') this.onFx?.('spark', p.setY(p.y + 0.4));
    else if (type === 'coin') this.onFx?.('coin', p.setY(p.y + 0.9));
    else if (type === 'stuntReady') this.launchHomeRun();
    else if (type === 'stunt' && this.rush) this.leap(this.rush.stunt === 'jump');
  }

  /** The home run ball leaves the cage as the fielder reaches the warning track. */
  private launchHomeRun(): void {
    this.flyFrom.copy(this.w(this.street.x, 24, this.deckH + 3));
    this.flyTo.copy(this.w(this.street.x, CATCH_Y, this.deckH + WALL_H + 0.75));
    this.flyOver.copy(this.w(this.street.x + 0.6, WALL_Y - 2.3, this.deckH + 2.4));
    this.flyBall.position.copy(this.flyFrom);
    this.flyBall.visible = true;
  }

  private leap(success: boolean): void {
    this.airSuccess = success;
    this.airFrom.copy(this.fielder.position);
    this.fielder.play(success ? 'catch' : 'dive');
  }

  /** The result arrived: a robbed homer hangs a banner on the wall. */
  result(trophy: Landmark | null, trophies: Landmark[]): void {
    for (const [id, b] of this.banners) b.on = trophies.includes(id);
    if (trophy) {
      const b = this.banners.get(trophy)!;
      b.on = true;
      this.onFx?.('burst', b.mesh.position.clone());
      this.cheer = 3;
    }
  }

  /** WALL OF FAME: the three banners flash and come down for the next set. */
  rebuild(): void {
    for (const b of this.banners.values()) {
      this.onFx?.('explode', b.mesh.position.clone());
      b.on = false;
    }
    this.party = Math.max(this.party, 4);
  }

  celebrate(seconds = 3): void {
    this.party = Math.max(this.party, seconds);
    this.cheer = Math.max(this.cheer, seconds);
  }

  reset(): void {
    for (const b of this.banners.values()) {
      b.on = false;
      b.grow = 0;
      b.mesh.visible = false;
    }
    this.rush = null;
    this.flyBall.visible = false;
    this.parkFielder();
    this.cam.reset();
  }

  private parkFielder(): void {
    this.fielder.warpTo(this.w(this.street.x, this.street.start + 0.4));
    this.fielder.rotation.set(0, 0, 0);
    this.fielder.face(Math.PI);
    this.fielder.play('idle');
    this.fielderX = this.street.x;
  }

  private laneX(lane: number): number {
    // Lane 0 is the runner's (and the screen's) left: table +x when heading down the table.
    return this.street.x + (1 - lane) * this.street.laneWidth;
  }

  private progressY(p: number): number {
    return this.street.start + (this.street.end - this.street.start) * p;
  }

  // ------------------------------------------------------------------ camera

  /**
   * Sandlot choreography: ride along behind the pinball on the skyway, then a
   * low chase cam behind the sprinting outfielder, then a side view of the leap.
   */
  readonly cameraPose = (dt: number, pos: THREE.Vector3, target: THREE.Vector3, t: number): void => {
    const a = this.game.attraction;
    const r = this.rush;
    const ball = a ? this.game.world.balls.find((b) => b.id === a.ballId) : undefined;
    let lambda = 3.4;
    if (r && (a?.phase === 'race' || a?.phase === 'finish') && r.phase !== 'done') {
      if (r.phase === 'race') {
        const narrow = THREE.MathUtils.clamp((1.3 - this.aspect) / 0.8, 0, 1);
        const streetX = this.w(this.street.x, 0).x;
        this.tmp.copy(this.fielder.position).add(this.tmp2.set(0, 2.3 + narrow * 3.2, -3.6 - narrow * 3.4));
        this.tmp.x = THREE.MathUtils.lerp(this.tmp.x + (this.fielder.position.x - streetX) * -0.3, streetX, narrow * 0.7);
        this.tmp2.copy(this.fielder.position).add(new THREE.Vector3(0, 0.6, 4.2 - narrow * 1.6));
        this.tmp2.x = THREE.MathUtils.lerp(this.tmp2.x, streetX, narrow * 0.7);
        lambda = 5;
      } else {
        // The leap: the replay angle from above the bleachers, looking back over the wall.
        this.tmp.copy(this.w(-3.2, -2.2, 7.0));
        this.tmp2.copy(this.w(this.street.x, CATCH_Y + 1.4, this.deckH + 1.2));
        lambda = 2.4;
      }
    } else if (ball) {
      toWorld(ball.pos.x, ball.pos.y, ball.height, this.tmp2);
      this.tmp.copy(this.tmp2).add(new THREE.Vector3(4.2, 4.6, 5.2));
    } else {
      this.tmp2.copy(this.w(this.street.x, 16, this.deckH));
      this.tmp.copy(this.tmp2).add(new THREE.Vector3(6, 7, 8));
    }
    this.cam.follow(dt, this.toScene(this.tmp.clone()), this.toScene(this.tmp2.clone()), t < 0.02 ? 1000 : lambda);
    pos.copy(this.cam.pos);
    target.copy(this.cam.target);
  };

  resetCamera(): void {
    this.cam.reset();
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.time += dt;
    if (this.party > 0) this.party -= dt;
    if (this.cheer > 0) this.cheer -= dt;
    const racing = !!this.rush && this.rush.phase !== 'done';
    // Mowers lap the edges (never the running lanes).
    for (let i = 0; i < 2; i++) {
      this.mowerS[i] = (this.mowerS[i] + dt * 0.035) % 1;
      const s = this.mowerS[i];
      const x = i === 0 ? -9.0 : -1.35;
      const y = 8.5 + (s < 0.5 ? s * 2 : 2 - s * 2) * 15.5;
      const p = this.w(x, y);
      this.m.makeRotationY(s < 0.5 ? Math.PI : 0).setPosition(p.x, p.y, p.z);
      this.mowers.setMatrixAt(i, this.m);
    }
    this.mowers.instanceMatrix.needsUpdate = true;
    // Kids playing catch.
    for (const b of this.catchBalls) {
      const k = (Math.sin(this.time * 1.6 + b.userData.phase) + 1) / 2;
      b.position.lerpVectors(b.userData.a, b.userData.b, k);
      b.position.y += Math.sin(k * Math.PI) * 0.9;
    }
    // Bleacher crowd: bounces on a robbed homer, parties during multiball.
    const amp = this.cheer > 0 ? 0.35 : this.party > 0 ? 0.2 : 0.02;
    for (let i = 0; i < this.crowd.count; i++) {
      const y = this.crowdBase[i * 3 + 1] + Math.max(0, Math.sin(this.time * 10 + i * 0.9)) * amp;
      this.m.makeTranslation(this.crowdBase[i * 3], y, this.crowdBase[i * 3 + 2]);
      this.crowd.setMatrixAt(i, this.m);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    // Progress: a new stand fills in per sandlot level; the light towers burn brighter.
    const level = this.game.city.level;
    for (const s of this.stands) {
      s.grow += ((level >= s.level ? 1 : 0) - s.grow) * Math.min(1, dt * 1.5);
      s.mesh.visible = s.grow > 0.01;
      s.mesh.scale.y = Math.max(0.001, s.grow);
    }
    const glow = 0.55 + Math.min(3, level) * 0.15 + (this.party > 0 ? 0.3 * Math.sin(this.time * 12) : 0);
    this.lightHeads.color.setRGB(glow, glow * 0.96, glow * 0.85);
    // Banners unfurl.
    for (const b of this.banners.values()) {
      b.grow += ((b.on ? 1 : 0) - b.grow) * Math.min(1, dt * 3);
      b.mesh.visible = b.grow > 0.01;
      b.mesh.scale.y = Math.max(0.001, b.grow);
    }
    // Diverter flips across the ramp while the sandlot is open.
    const lit = this.game.city.lit;
    this.diverter.rotation.y += ((lit ? -0.9 : 0) - this.diverter.rotation.y) * Math.min(1, dt * 8);
    this.diverterLamp.color.setHex(lit ? (Math.sin(this.time * 10) > 0 ? 0x3bff9a : 0x0c3a22) : 0x0c3a22);
    // The cage gate swings open for the run.
    const open = racing || this.game.attraction?.kind === 'city';
    this.cageDoor.scale.x += ((open ? 0.05 : 1) - this.cageDoor.scale.x) * Math.min(1, dt * 6);
    this.updateFielder(dt);
    for (const b of this.ballPool) {
      if (!b.visible) continue;
      b.rotation.y += dt * 3;
      b.position.y = this.deckH + 0.7 + Math.sin(this.time * 4 + b.position.z) * 0.08;
      if (b.userData.coin?.taken) b.visible = false;
    }
    this.fielder.update(dt, this.time);
  }

  private updateFielder(dt: number): void {
    const r = this.rush;
    if (!r) return;
    if (r.phase === 'race' || (r.phase === 'stunt' && r.stunt === 'none')) {
      const y = r.phase === 'race' ? this.progressY(r.progress) : this.street.end - (this.street.end - (CATCH_Y + 1.0)) * Math.min(1, r.stuntT / STUNT_IDEAL);
      this.fielderX += (this.laneX(r.lane) - this.fielderX) * Math.min(1, dt * 14);
      const x = r.phase === 'race' ? this.fielderX : this.fielderX + (this.street.x - this.fielderX) * Math.min(1, r.stuntT * 3);
      this.fielderTX = x;
      this.fielder.position.copy(this.w(x, y));
      this.fielder.rotation.z = this.bump > 0 ? Math.sin(this.time * 40) * 0.3 : 0;
      if (this.bump > 0) this.bump -= dt;
      // Obstacles the fielder ran into get knocked aside.
      for (const list of Object.values(this.obstaclePool)) {
        for (const o of list) {
          if (o.visible && o.userData.obstacle?.hit && !o.userData.knocked) {
            o.userData.knocked = true;
            o.rotation.z = 0.5;
          }
        }
      }
      if (r.phase === 'stunt') this.updateFlyBall(r.stuntT);
      return;
    }
    // In the air: up the wall for the catch, or into the padding while the ball sails over.
    const t = r.airT;
    this.updateFlyBall(STUNT_IDEAL + t);
    const wall = this.w(this.fielderTX, CATCH_Y + 0.15);
    if (this.airSuccess) {
      const k = Math.min(1, t / 0.55);
      const down = Math.max(0, Math.min(1, (t - 0.7) / 0.45));
      this.fielder.position.lerpVectors(this.airFrom, wall, k);
      this.fielder.position.y = this.deckH + Math.sin(k * Math.PI * 0.5) * 1.35 * (1 - down);
      if (t > 0.55 && !this.landed) {
        this.landed = true;
        this.onFx?.('burst', this.fielder.position.clone().setY(this.deckH + WALL_H + 0.8));
      }
      if (down > 0.95) this.fielder.play('celebrate');
    } else {
      const k = Math.min(1, t / 0.4);
      this.fielder.position.lerpVectors(this.airFrom, wall, k);
      this.fielder.position.y = this.deckH + Math.sin(k * Math.PI) * 0.6;
      if (k >= 1 && !this.landed) {
        this.landed = true;
        this.onFx?.('spark', this.fielder.position.clone().setY(this.deckH + 0.8));
      }
    }
  }

  /** The home run ball: cage → wall top in STUNT_IDEAL + 0.55 s; caught, or over into the seats. */
  private updateFlyBall(t: number): void {
    if (!this.flyBall.visible) return;
    const reach = STUNT_IDEAL + 0.55;
    if (t <= reach) {
      const k = t / reach;
      this.flyBall.position.lerpVectors(this.flyFrom, this.flyTo, k);
      this.flyBall.position.y += Math.sin(k * Math.PI) * 4.5;
    } else if (this.airSuccess) {
      // In the glove.
      this.flyBall.position.copy(this.fielder.position).add(this.tmp.set(0.15, 1.15, 0.2));
    } else {
      const k = Math.min(1, (t - reach) / (STUNT_AIRTIME - 0.6));
      this.flyBall.position.lerpVectors(this.flyTo, this.flyOver, k);
      this.flyBall.position.y += Math.sin(k * Math.PI) * 0.8;
      if (k >= 1) {
        this.flyBall.visible = false;
        this.onFx?.('explode', this.flyOver.clone());
      }
    }
  }
}

// ------------------------------------------------------------------ textures

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function labelTexture(text: string, color: string, bg: string): THREE.CanvasTexture {
  return canvasTex(512, 96, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 96);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(6, 6, 500, 84);
    g.fillStyle = color;
    g.font = 'bold 58px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 50);
  });
}

/** Green outfield padding with distance markers. */
function wallTexture(): THREE.CanvasTexture {
  return canvasTex(1024, 128, (g) => {
    g.fillStyle = '#1f5e33';
    g.fillRect(0, 0, 1024, 128);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 0; x < 1024; x += 64) g.fillRect(x, 0, 3, 128);
    g.fillStyle = '#ffe14d';
    g.font = 'bold 54px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('375', 160, 66);
    g.fillText('400', 512, 66);
    g.fillText('375', 864, 66);
  });
}
