import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Game } from '../game/Game';
import type { TableDef } from '../table/layout';
import { LANDMARKS, STUNT_AIRTIME, STUNT_IDEAL, type CityRush, type Landmark } from '../attractions/cityRush';
import { SmoothPose } from './CameraRig';
import type { Quality } from './Playfield';
import { buildTrack } from './rails';
import { toWorld } from './space';

interface Block {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  h: number;
  color: number;
}

interface TrafficCar {
  path: number;
  s: number;
  speed: number;
}

/** Ambient traffic routes on the deck (table coordinates, deck height). */
const ROUTES: Array<{ a: [number, number]; b: [number, number]; main: boolean }> = [
  { a: [-4.15, 28.0], b: [-4.15, 4.8], main: true },
  { a: [-6.25, 4.8], b: [-6.25, 28.0], main: true },
  { a: [-0.9, 11.6], b: [-9.6, 11.6], main: false },
  { a: [-9.6, 12.4], b: [-0.9, 12.4], main: false },
  { a: [-0.9, 19.1], b: [-9.6, 19.1], main: false },
  { a: [-9.6, 19.9], b: [-0.9, 19.9], main: false },
];

const CAR_COLORS = [0xe8e3d4, 0xd64545, 0x2c7be5, 0xf5c542, 0x4bc26b, 0x1d1f25, 0xf2a65a, 0x8fd0ff];

/**
 * DIAMOND CITY: a dense miniature city on the left wing of the cabinet.
 *
 * Ambient life (traffic, pedestrians, street lights, a skyline that grows with
 * every run), the diverter and skyway the pinball rides into town, three
 * destructible landmarks, and the CITY RUSH itself: the getaway car, the
 * traffic it weaves through, the coins and the stunt jump to the tower roof.
 */
export class CityView {
  readonly group = new THREE.Group();
  private deckH: number;
  private street: TableDef['attractions']['city']['street'];
  private stunt: TableDef['attractions']['city']['stunt'];
  private time = 0;
  private traffic: THREE.InstancedMesh;
  private trafficCars: TrafficCar[] = [];
  private walkers: THREE.InstancedMesh;
  private walkerData: Array<{ x: number; y0: number; y1: number; s: number; speed: number }> = [];
  private windowMat: THREE.MeshStandardMaterial;
  private risers: Array<{ mesh: THREE.Mesh; level: number; grow: number }> = [];
  private crane: THREE.Group;
  private garageDoor: THREE.Mesh;
  private diverter: THREE.Group;
  private diverterLamp: THREE.MeshBasicMaterial;
  private landmarks = new Map<Landmark, { group: THREE.Group; target: THREE.Vector3; damaged: boolean; fall: number; mats: THREE.MeshStandardMaterial[] }>();
  private damaged = new Set<Landmark>();
  private car: THREE.Group;
  private carWheels: THREE.Mesh[] = [];
  private carLaneX = 0;
  private rush: CityRush | null = null;
  private crashAt: THREE.Vector3 | null = null;
  private airFrom = new THREE.Vector3();
  private airTo = new THREE.Vector3();
  private airTarget: Landmark | null = null;
  private airSuccess = false;
  private carWreck = 0;
  private obstaclePool: Record<'car' | 'bus' | 'cones', THREE.Mesh[]>;
  private coinPool: THREE.Mesh[] = [];
  private searchlights: THREE.Mesh[] = [];
  private party = 0;
  private cam = new SmoothPose(3);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private m = new THREE.Matrix4();
  /** Viewport aspect (width / height): narrow portrait screens get a wider chase framing. */
  aspect = 1.6;
  /** Effects hook (sparks, bursts) supplied by the renderer, in table-local space. */
  onFx: ((kind: 'spark' | 'burst' | 'explode' | 'coin', at: THREE.Vector3) => void) | null = null;

  constructor(private game: Game, table: TableDef, private quality: Quality, railMaterial: THREE.Material, envMap: THREE.Texture | null, private toScene: (v: THREE.Vector3) => THREE.Vector3) {
    const city = table.attractions.city;
    this.deckH = city.deck.h;
    this.street = city.street;
    this.stunt = city.stunt;
    this.buildDeck(city.deck);
    this.windowMat = this.buildSkyline();
    this.crane = this.buildCrane();
    this.buildLandmarks();
    this.garageDoor = this.buildGarage();
    this.buildKicker();
    this.buildStreetFurniture();
    this.traffic = this.buildTraffic();
    this.walkers = this.buildWalkers();
    this.car = this.buildCar();
    this.obstaclePool = this.buildObstacles();
    this.buildCoins();
    // The skyway: the diverted ramp over the wall into the garage, and the ride home.
    const track = buildTrack(city.track.slice(2), { color: 0x3bff9a, railMaterial, envMap, castShadow: quality === 'high', groundH: this.deckH, samples: 60 });
    const back = buildTrack(city.returnTrack, { color: 0x3bff9a, railMaterial, envMap, castShadow: quality === 'high', groundH: this.deckH, samples: 90 });
    this.group.add(track, back);
    const div = this.buildDiverter(railMaterial);
    this.diverter = div.group;
    this.diverterLamp = div.lamp;
    this.carLaneX = this.street.x;
    this.parkCar();
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
    // Wing cabinet: the same dark lacquered wood as the machine, with a brass lip.
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, d.h + 4.5, depth), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.6 }));
    box.position.set(a.x + width / 2, (d.h - 4.5) / 2 - 0.01, a.z + depth / 2);
    box.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.18, depth + 0.3), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.35 }));
    lip.position.set(box.position.x, d.h - 0.12, box.position.z);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: this.groundTexture(d), roughness: 0.85 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(box.position.x, d.h + 0.01, box.position.z);
    ground.receiveShadow = true;
    this.group.add(box, lip, ground);
  }

  /** Streets, lanes, crosswalks, plaza and park painted onto the deck. */
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
    rect(d.minX, d.minY, d.maxX, d.maxY, '#33363f');
    // Park at the back of the west side.
    rect(-9.7, 27.0, -7.2, 31.6, '#2f6b3a');
    for (let i = 0; i < 40; i++) {
      g.fillStyle = i % 2 ? '#3d8049' : '#28592f';
      g.beginPath();
      g.arc(X(-9.6 + Math.random() * 2.3), Y(27.2 + Math.random() * 4.2), 3 + Math.random() * 4, 0, Math.PI * 2);
      g.fill();
    }
    // Plaza in front of the Diamond Tower.
    rect(d.minX, d.minY, d.maxX, 4.6, '#4a4f5c');
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    for (let x = d.minX; x < d.maxX; x += 0.5) {
      g.beginPath();
      g.moveTo(X(x), Y(4.6));
      g.lineTo(X(x), Y(d.minY));
      g.stroke();
    }
    // Sidewalks then roads.
    rect(-7.4, 4.6, -3.0, 28.8, '#7a7e88');
    rect(d.minX, 11.0, d.maxX, 13.0, '#7a7e88');
    rect(d.minX, 18.5, d.maxX, 20.5, '#7a7e88');
    const road = '#1c1e24';
    rect(-6.9, 4.6, -3.5, 28.8, road);
    rect(d.minX, 11.2, d.maxX, 12.8, road);
    rect(d.minX, 18.7, d.maxX, 20.3, road);
    // Lane dividers on Main Street, a solid edge line, and the crosswalks.
    g.fillStyle = '#e8e3d4';
    for (const lx of [-5.725, -4.675]) for (let y = 5; y < 28.5; y += 0.9) g.fillRect(X(lx) - 1.2, Y(y + 0.45), 2.4, 0.45 * S);
    g.fillStyle = '#f5c542';
    for (const lx of [-6.82, -3.58]) g.fillRect(X(lx) - 1, Y(28.8), 2, (28.8 - 4.6) * S);
    g.fillStyle = 'rgba(232,227,212,0.85)';
    for (const cy of [11.2, 12.8, 18.7, 20.3]) for (let x = -6.8; x < -3.6; x += 0.3) g.fillRect(X(x), Y(cy + (cy % 2 > 1 ? 0.35 : 0)), 0.16 * S, 0.3 * S);
    // Start line in front of the garage and the finish chevrons before the kicker.
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#111' : '#fff';
      g.fillRect(X(-6.9 + i * 0.283), Y(25.6), 0.283 * S, 0.3 * S);
    }
    g.fillStyle = '#ff4d4d';
    for (let i = 0; i < 4; i++) {
      const y = 8.6 - i * 0.45;
      g.beginPath();
      g.moveTo(X(-6.6), Y(y));
      g.lineTo(X(-5.2), Y(y - 0.3));
      g.lineTo(X(-3.8), Y(y));
      g.lineTo(X(-3.8), Y(y - 0.15));
      g.lineTo(X(-5.2), Y(y - 0.45));
      g.lineTo(X(-6.6), Y(y - 0.15));
      g.fill();
    }
    g.font = `bold ${Math.round(0.42 * S)}px sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.save();
    g.translate(X(-5.2), Y(16));
    g.rotate(-Math.PI / 2);
    g.fillText('MAIN STREET', 0, 0);
    g.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** Facade texture: a window grid, some windows lit (emissive map uses the lit cells). */
  private windowTextures(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
    const size = 64;
    const mk = (glow: boolean) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d')!;
      g.fillStyle = glow ? '#000' : '#d9d4c7';
      g.fillRect(0, 0, size, size);
      const rnd = mulberry(glow ? 7 : 7);
      for (let r = 0; r < 4; r++) {
        for (let q = 0; q < 4; q++) {
          const lit = rnd() < 0.45;
          if (glow) g.fillStyle = lit ? '#ffd889' : '#000';
          else g.fillStyle = lit ? '#ffe7a8' : '#26303f';
          g.fillRect(q * 16 + 4, r * 16 + 4, 8, 9);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return { map: mk(false), glow: mk(true) };
  }

  private boxGeo(b: Block, uvScale = 1.1): THREE.BufferGeometry {
    const a = this.w(b.x0, b.y1, 0);
    const c = this.w(b.x1, b.y0, 0);
    const wx = c.x - a.x;
    const wz = c.z - a.z;
    const g = new THREE.BoxGeometry(wx, b.h, wz);
    // Scale facade UVs to the building size so windows keep their scale; the roof samples a blank wall pixel.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let face = 0; face < 6; face++) {
      for (let v = 0; v < 4; v++) {
        const i = face * 4 + v;
        if (face === 2 || face === 3) {
          uv.setXY(i, 0.02, 0.02);
          continue;
        }
        const along = face < 2 ? wz : wx;
        uv.setXY(i, uv.getX(i) * along * uvScale, uv.getY(i) * b.h * uvScale);
      }
    }
    g.translate(a.x + wx / 2, this.deckH + b.h / 2, a.z + wz / 2);
    const color = new THREE.Color(b.color);
    const cols = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < cols.length; i += 3) {
      cols[i] = color.r;
      cols[i + 1] = color.g;
      cols[i + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  }

  /** Static skyline (merged into one draw call) plus three towers that rise as the city levels up. */
  private buildSkyline(): THREE.MeshStandardMaterial {
    const { map, glow } = this.windowTextures();
    const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.7, emissive: 0xffd889, emissiveMap: glow, emissiveIntensity: 0.35 });
    const palette = [0x8a6f5a, 0x6f7f96, 0xb8a58a, 0x5d6b7d, 0x9a5b4a, 0x7d8a6a, 0xc2b8a3, 0x4f5d75];
    const rnd = mulberry(42);
    const blocks: Block[] = [];
    // West row (under the skyway: kept low), east row (tall, against the cabinet).
    const rows: Array<{ x0: number; x1: number; maxH: number; minH: number }> = [
      { x0: -9.5, x1: -7.6, minH: 0.9, maxH: 2.4 },
      { x0: -2.9, x1: -0.9, minH: 1.4, maxH: 4.6 },
    ];
    const spans: Array<[number, number]> = [
      [5.8, 10.8],
      [13.2, 18.3],
      [20.7, 25.6],
    ];
    for (const row of rows) {
      for (const [y0, y1] of spans) {
        let y = y0;
        while (y < y1 - 0.4) {
          const len = Math.min(y1 - y, 1.1 + rnd() * 1.3);
          const inset = rnd() * 0.25;
          blocks.push({ x0: row.x0 + inset, x1: row.x1 - rnd() * 0.25, y0: y + 0.05, y1: y + len - 0.05, h: row.minH + rnd() * (row.maxH - row.minH), color: palette[Math.floor(rnd() * palette.length)] });
          y += len;
        }
      }
    }
    // Landmark bases and the plaza buildings either side of the tower.
    blocks.push({ x0: -3.0, x1: -1.0, y0: 3.4, y1: 5.6, h: 1.8, color: 0x7d8a6a });
    blocks.push({ x0: -9.4, x1: -7.4, y0: 3.4, y1: 5.6, h: 2.2, color: 0x6f7f96 });
    blocks.push({ x0: -9.5, x1: -7.8, y0: 0.2, y1: 2.8, h: 1.4, color: 0xb8a58a });
    blocks.push({ x0: -2.6, x1: -1.0, y0: 0.2, y1: 2.8, h: 1.6, color: 0x9a5b4a });
    const geos = blocks.map((b) => this.boxGeo(b));
    const mesh = new THREE.Mesh(mergeGeometries(geos, false)!, mat);
    mesh.castShadow = this.quality !== 'low';
    mesh.receiveShadow = true;
    this.group.add(mesh);
    geos.forEach((g) => g.dispose());
    // Rooftop details: water tanks, AC units and antennas (merged).
    const details: THREE.BufferGeometry[] = [];
    for (const b of blocks) {
      if (rnd() < 0.5) continue;
      const cx = (b.x0 + b.x1) / 2 + (rnd() - 0.5) * 0.6;
      const cy = (b.y0 + b.y1) / 2 + (rnd() - 0.5) * 0.6;
      const p = this.w(cx, cy, this.deckH + b.h);
      const g = rnd() < 0.5 ? new THREE.BoxGeometry(0.4, 0.25, 0.3) : new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4);
      g.translate(p.x, p.y + (g.type === 'BoxGeometry' ? 0.12 : 0.45), p.z);
      details.push(g);
    }
    if (details.length) {
      this.group.add(new THREE.Mesh(mergeGeometries(details, false)!, new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.5 })));
      details.forEach((g) => g.dispose());
    }
    // New towers rise one per city level: the skyline is the scoreboard.
    const riseMat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.4, metalness: 0.3, emissive: 0x9ffcff, emissiveMap: glow, emissiveIntensity: 0.6 });
    const towers: Block[] = [
      { x0: -2.8, x1: -1.2, y0: 14.0, y1: 15.6, h: 6.2, color: 0x9fb9d6 },
      { x0: -2.8, x1: -1.2, y0: 22.0, y1: 23.6, h: 7.0, color: 0xa7c4c2 },
      { x0: -2.8, x1: -1.2, y0: 7.0, y1: 8.6, h: 7.6, color: 0xc2b8e6 },
    ];
    towers.forEach((t, i) => {
      const g = this.boxGeo(t, 1.4);
      // Pivot at the base so the tower can grow out of the ground.
      const base = this.w((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, this.deckH);
      g.translate(-base.x, -base.y, -base.z);
      const mesh = new THREE.Mesh(g, riseMat);
      mesh.position.copy(base);
      mesh.scale.y = 0.001;
      mesh.visible = false;
      mesh.castShadow = this.quality !== 'low';
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0xdfe8f2, metalness: 0.8, roughness: 0.2 }));
      spire.position.y = t.h + 0.6;
      mesh.add(spire);
      this.group.add(mesh);
      this.risers.push({ mesh, level: i + 1, grow: 0 });
    });
    return mat;
  }

  private buildCrane(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.5, metalness: 0.3 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.18, 7.5, 0.18), mat);
    mast.position.y = 3.75;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 0.16), mat);
    jib.position.set(-1.1, 7.5, 0);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x4a4f5c }));
    counter.position.set(0.8, 7.3, 0);
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    hook.position.set(-2.6, 6.3, 0);
    g.add(mast, jib, counter, hook);
    g.position.copy(this.w(-0.95, 17.3));
    this.group.add(g);
    return g;
  }

  private buildLandmarks(): void {
    // DIAMOND TOWER: the stunt target, helipad on the roof.
    const tower = new THREE.Group();
    const roofH = this.stunt.roofH;
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x3b4a66, metalness: 0.5, roughness: 0.3, emissive: 0x4dfff3, emissiveIntensity: 0.05 });
    const a = this.w(-6.5, 3.8, 0);
    const b = this.w(-3.9, 1.0, 0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x, roofH - this.deckH, b.z - a.z), towerMat);
    body.position.set((a.x + b.x) / 2, (roofH + this.deckH) / 2, (a.z + b.z) / 2);
    body.castShadow = this.quality !== 'low';
    // Glass bands.
    for (let i = 0; i < 5; i++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x + 0.04, 0.12, b.z - a.z + 0.04), new THREE.MeshBasicMaterial({ color: 0x9ffcff, toneMapped: false, transparent: true, opacity: 0.55 }));
      band.position.set(body.position.x, this.deckH + 0.5 + i * 0.55, body.position.z);
      tower.add(band);
    }
    const roof = this.w(this.stunt.roof.x, this.stunt.roof.y, roofH + 0.02);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.95, 28), new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.6 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.copy(roof);
    const padLights = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: 0x7cff5a, toneMapped: false }));
    padLights.rotation.x = -Math.PI / 2;
    padLights.position.copy(roof).setY(roofH + 0.05);
    tower.add(body, pad, padLights);
    // Searchlights on the roof corners: they sweep during big moments.
    for (const sx of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.35, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.geometry.translate(0, -4.5, 0);
      beam.position.copy(roof).add(new THREE.Vector3(sx * 1.1, 0.1, 0));
      tower.add(beam);
      this.searchlights.push(beam);
    }
    this.group.add(tower);

    // Landmark 1: billboard on the tower's street face.
    const bill = new THREE.Group();
    const billMat = new THREE.MeshStandardMaterial({ map: billboardTexture(), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.25, emissiveMap: billboardTexture() });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), billMat);
    panel.rotation.y = Math.PI;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.45, 1.3, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.6, roughness: 0.4 }));
    frame.position.z = 0.05;
    bill.add(frame, panel);
    bill.position.copy(this.w(-5.2, 3.86, 2.95));
    bill.rotation.y = Math.PI;
    this.group.add(bill);
    this.landmarks.set('billboard', { group: bill, target: this.w(-5.2, 3.9, 2.9), damaged: false, fall: 0, mats: [billMat] });

    // Landmark 2: water tower on the east plaza building.
    const wt = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 16), wood);
    tank.position.y = 1.15;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.8 }));
    cone.position.y = 1.82;
    wt.add(tank, cone);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 4), new THREE.MeshStandardMaterial({ color: 0x3a3f4b }));
      leg.position.set(Math.cos(i * Math.PI / 2 + 0.78) * 0.4, 0.37, Math.sin(i * Math.PI / 2 + 0.78) * 0.4);
      wt.add(leg);
    }
    wt.position.copy(this.w(-2.0, 4.5, this.deckH + 1.8));
    this.group.add(wt);
    this.landmarks.set('waterTower', { group: wt, target: this.w(-2.0, 4.5, this.deckH + 2.9), damaged: false, fall: 0, mats: [wood] });

    // Landmark 3: the neon HOTEL blade sign on the west plaza building.
    const neon = new THREE.Group();
    const neonMat = new THREE.MeshStandardMaterial({ map: neonTexture(), emissive: 0xffffff, emissiveMap: neonTexture(), emissiveIntensity: 1.4, roughness: 0.4 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.7), [new THREE.MeshStandardMaterial({ color: 0x222 }), new THREE.MeshStandardMaterial({ color: 0x222 }), new THREE.MeshStandardMaterial({ color: 0x222 }), new THREE.MeshStandardMaterial({ color: 0x222 }), neonMat, neonMat]);
    blade.rotation.y = Math.PI / 2;
    blade.position.y = 1.0;
    neon.add(blade);
    neon.position.copy(this.w(-7.3, 4.5, this.deckH + 1.4));
    this.group.add(neon);
    this.landmarks.set('neonSign', { group: neon, target: this.w(-7.3, 4.5, this.deckH + 2.4), damaged: false, fall: 0, mats: [neonMat] });
  }

  private buildGarage(): THREE.Mesh {
    const a = this.w(-6.7, 28.7, 0);
    const b = this.w(-3.7, 26.0, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4f5d75, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x, 1.45, b.z - a.z), mat);
    body.position.set((a.x + b.x) / 2, this.deckH + 0.72, (a.z + b.z) / 2);
    body.castShadow = this.quality !== 'low';
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.42), new THREE.MeshBasicMaterial({ map: labelTexture('GETAWAY GARAGE', '#3bff9a', '#0c1a14'), toneMapped: false }));
    sign.position.set(body.position.x, this.deckH + 1.62, b.z + 0.02);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshStandardMaterial({ color: 0xc9cdd4, metalness: 0.5, roughness: 0.4 }));
    door.position.set(body.position.x, this.deckH + 0.55, b.z + 0.015);
    this.group.add(body, sign, door);
    return door;
  }

  private buildKicker(): void {
    const k = this.stunt.ramp;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1.4, 0);
    shape.lineTo(1.4, 0.55);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 3.3, bevelEnabled: false });
    geo.translate(0, 0, -1.65);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.5 }));
    // Rises toward the tower (table -y = world +z).
    mesh.rotation.y = -Math.PI / 2;
    mesh.position.copy(this.w(k.x, k.y + 0.7));
    mesh.castShadow = this.quality !== 'low';
    this.group.add(mesh);
  }

  private buildStreetFurniture(): void {
    const poles: THREE.BufferGeometry[] = [];
    const heads: THREE.BufferGeometry[] = [];
    for (let y = 6; y <= 27; y += 3) {
      for (const x of [-7.15, -3.25]) {
        const p = this.w(x, y);
        const pole = new THREE.CylinderGeometry(0.03, 0.04, 0.9, 5);
        pole.translate(p.x, p.y + 0.45, p.z);
        poles.push(pole);
        const head = new THREE.SphereGeometry(0.08, 6, 4);
        head.translate(p.x, p.y + 0.92, p.z);
        heads.push(head);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(poles, false)!, new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.6 })));
    this.group.add(new THREE.Mesh(mergeGeometries(heads, false)!, new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false })));
    poles.forEach((g) => g.dispose());
    heads.forEach((g) => g.dispose());
    // Trees in the park and along the west sidewalk.
    const n = this.quality === 'low' ? 10 : 22;
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 0.9, 7), new THREE.MeshStandardMaterial({ color: 0x2f7a3e, roughness: 0.9 }), n);
    const rnd = mulberry(9);
    for (let i = 0; i < n; i++) {
      const park = i < n * 0.6;
      const x = park ? -9.5 + rnd() * 2.1 : -7.3;
      const y = park ? 27.3 + rnd() * 4.0 : 6 + (i - n * 0.6) * 2.6;
      const p = this.w(x, y, this.deckH + 0.5);
      this.m.makeScale(1, 0.8 + rnd() * 0.5, 1).setPosition(p.x, p.y, p.z);
      trees.setMatrixAt(i, this.m);
    }
    trees.castShadow = this.quality === 'high';
    this.group.add(trees);
    // Tunnel portal for the monorail, a bus shelter and a "DIAMOND CITY" welcome arch over Main Street.
    const arch = new THREE.Group();
    const archMat = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.3 });
    for (const x of [-7.05, -3.35]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), archMat);
      leg.position.copy(this.w(x, 22.4, this.deckH + 1.1));
      arch.add(leg);
    }
    // Two faces so the sign reads from the table camera and from the race chase cam.
    const signMat = new THREE.MeshBasicMaterial({ map: labelTexture('DIAMOND CITY', '#ffe14d', '#1a1206'), toneMapped: false });
    for (const flip of [0, Math.PI]) {
      const top = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 0.5), signMat);
      top.position.copy(this.w(-5.2, 22.4, this.deckH + 2.3));
      top.position.z += flip ? -0.02 : 0.02;
      top.rotation.y = flip;
      arch.add(top);
    }
    this.group.add(arch);
  }

  private carGeometry(scale = 1): THREE.BufferGeometry {
    const body = new THREE.BoxGeometry(0.5 * scale, 0.22 * scale, 0.95 * scale);
    body.translate(0, 0.17 * scale, 0);
    const cabin = new THREE.BoxGeometry(0.42 * scale, 0.2 * scale, 0.48 * scale);
    cabin.translate(0, 0.37 * scale, -0.05 * scale);
    const g = mergeGeometries([body, cabin], false)!;
    body.dispose();
    cabin.dispose();
    return g;
  }

  private buildTraffic(): THREE.InstancedMesh {
    const n = this.quality === 'low' ? 8 : 14;
    const mesh = new THREE.InstancedMesh(this.carGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), n);
    const rnd = mulberry(3);
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.trafficCars.push({ path: i % ROUTES.length, s: rnd(), speed: 0.06 + rnd() * 0.05 });
      color.set(CAR_COLORS[i % CAR_COLORS.length]);
      mesh.setColorAt(i, color);
    }
    mesh.castShadow = this.quality === 'high';
    this.group.add(mesh);
    return mesh;
  }

  private buildWalkers(): THREE.InstancedMesh {
    const n = this.quality === 'low' ? 16 : 36;
    const mesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.07, 0.16, 2, 5), new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    const rnd = mulberry(77);
    const color = new THREE.Color();
    const palette = [0xe8e3d4, 0xd64545, 0x2c7be5, 0xf5c542, 0x8fd0ff, 0xf2a65a, 0x4bc26b];
    for (let i = 0; i < n; i++) {
      const x = rnd() < 0.5 ? -7.15 + (rnd() - 0.5) * 0.2 : -3.25 + (rnd() - 0.5) * 0.2;
      const y0 = 5 + rnd() * 20;
      this.walkerData.push({ x, y0, y1: y0 + 1.5 + rnd() * 3, s: rnd(), speed: 0.08 + rnd() * 0.1 });
      color.set(palette[i % palette.length]);
      mesh.setColorAt(i, color);
    }
    this.group.add(mesh);
    return mesh;
  }

  private buildCar(): THREE.Group {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0xe0242a, metalness: 0.6, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 1.15), paint);
    body.position.y = 0.2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.55), new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.8, roughness: 0.1 }));
    cabin.position.set(0, 0.4, -0.08);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 1.16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    stripe.position.set(0, 0.315, 0);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.14), paint);
    spoiler.position.set(0, 0.42, -0.55);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false }));
    tail.position.set(0, 0.24, -0.58);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false }));
    head.position.set(0, 0.24, 0.58);
    car.add(body, cabin, stripe, spoiler, tail, head);
    const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    for (const [x, z] of [[-0.33, 0.36], [0.33, 0.36], [-0.33, -0.36], [0.33, -0.36]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.12, z);
      car.add(w);
      this.carWheels.push(w);
    }
    car.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = this.quality !== 'low';
    });
    this.group.add(car);
    return car;
  }

  private buildObstacles(): Record<'car' | 'bus' | 'cones', THREE.Mesh[]> {
    const pool: Record<'car' | 'bus' | 'cones', THREE.Mesh[]> = { car: [], bus: [], cones: [] };
    const carGeo = this.carGeometry(1.05);
    // City bus: body, a window band and a roof, merged.
    const busBody = new THREE.BoxGeometry(1.75, 0.5, 1.3);
    busBody.translate(0, 0.33, 0);
    const busRoof = new THREE.BoxGeometry(1.6, 0.06, 1.2);
    busRoof.translate(0, 0.79, 0);
    const busWin = new THREE.BoxGeometry(1.78, 0.18, 1.0);
    busWin.translate(0, 0.65, 0);
    const busGeo = mergeGeometries([busBody, busRoof, busWin], true)!;
    const coneGeo = mergeGeometries([0, 1, 2].map((i) => new THREE.ConeGeometry(0.12, 0.36, 8).translate((i - 1) * 0.32, 0.18, 0)), false)!;
    for (let i = 0; i < 12; i++) {
      const car = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ color: CAR_COLORS[(i + 2) % CAR_COLORS.length], roughness: 0.4, metalness: 0.3 }));
      const busPaint = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.5 });
      const bus = new THREE.Mesh(busGeo, [busPaint, busPaint, new THREE.MeshStandardMaterial({ color: 0x1b2433, metalness: 0.6, roughness: 0.15, emissive: 0x6fb6ff, emissiveIntensity: 0.15 })]);
      const cones = new THREE.Mesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }));
      for (const m of [car, bus, cones]) {
        m.visible = false;
        m.castShadow = this.quality !== 'low';
        this.group.add(m);
      }
      pool.car.push(car);
      pool.bus.push(bus);
      pool.cones.push(cones);
    }
    return pool;
  }

  private buildCoins(): void {
    const geo = new THREE.TorusGeometry(0.16, 0.05, 6, 14);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.9, roughness: 0.2, emissive: 0xffb000, emissiveIntensity: 0.6 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Mesh(geo, mat);
      c.visible = false;
      this.group.add(c);
      this.coinPool.push(c);
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

  /** CITY RUSH started: lay out the traffic and coins for this run. */
  startRush(rush: CityRush): void {
    this.rush = rush;
    this.crashAt = null;
    this.carWreck = 0;
    this.airTarget = null;
    this.carLaneX = this.laneX(rush.lane);
    this.car.rotation.set(0, 0, 0);
    for (const list of Object.values(this.obstaclePool)) list.forEach((m) => (m.visible = false));
    this.coinPool.forEach((c) => (c.visible = false));
    const used = { car: 0, bus: 0, cones: 0 };
    for (const o of rush.obstacles) {
      const mesh = this.obstaclePool[o.kind][used[o.kind]++];
      if (!mesh) continue;
      const x = o.lanes.reduce((s, l) => s + this.laneX(l), 0) / o.lanes.length;
      mesh.position.copy(this.w(x, this.progressY(o.at)));
      mesh.rotation.set(0, o.kind === 'car' ? (o.lanes[0] === 2 ? Math.PI : 0) : 0, 0);
      mesh.visible = true;
      mesh.userData.obstacle = o;
    }
    rush.coins.forEach((c, i) => {
      const coin = this.coinPool[i];
      if (!coin) return;
      coin.position.copy(this.w(this.laneX(c.lane), this.progressY(c.at), this.deckH + 0.45));
      coin.visible = true;
      coin.userData.coin = c;
    });
  }

  /** A race event happened (crash, coin, stunt...). */
  rushEvent(type: string): void {
    const p = this.car.position.clone();
    if (type === 'crash') {
      this.carWreck = 0.5;
      this.onFx?.('spark', p.setY(p.y + 0.4));
    } else if (type === 'nearMiss') this.onFx?.('spark', p.setY(p.y + 0.3));
    else if (type === 'coin') this.onFx?.('coin', p.setY(p.y + 0.5));
    else if (type === 'stunt' && this.rush) this.launch(this.rush.stunt === 'jump');
  }

  private launch(success: boolean): void {
    this.airSuccess = success;
    this.airFrom.copy(this.car.position);
    if (success) this.airTo.copy(this.w(this.stunt.roof.x, this.stunt.roof.y, this.stunt.roofH + 0.02));
    else {
      this.airTarget = LANDMARKS.find((l) => !this.damaged.has(l)) ?? 'billboard';
      this.airTo.copy(this.landmarks.get(this.airTarget)!.target);
    }
    this.crashAt = null;
  }

  /** The result arrived: wreck the demolished landmark and remember it. */
  result(demolished: Landmark | null, damaged: Landmark[]): void {
    this.damaged = new Set(damaged);
    if (demolished) {
      const lm = this.landmarks.get(demolished)!;
      lm.damaged = true;
      this.onFx?.('explode', lm.target.clone());
    }
  }

  rebuild(): void {
    this.damaged.clear();
    for (const lm of this.landmarks.values()) {
      lm.damaged = false;
      lm.fall = 0;
      this.onFx?.('burst', lm.target.clone());
    }
  }

  /** Multiball / jackpots: searchlights and windows go wild. */
  celebrate(seconds = 3): void {
    this.party = Math.max(this.party, seconds);
  }

  reset(): void {
    this.damaged.clear();
    for (const lm of this.landmarks.values()) {
      lm.damaged = false;
      lm.fall = 0;
    }
    this.rush = null;
    this.parkCar();
    this.cam.reset();
  }

  private parkCar(): void {
    this.car.position.copy(this.w(this.street.x, this.street.start + 0.4));
    this.car.rotation.set(0, 0, 0);
    this.carLaneX = this.street.x;
  }

  private laneX(lane: number): number {
    // Lane 0 is the driver's (and the screen's) left: table +x on a car heading down the table.
    return this.street.x + (1 - lane) * this.street.laneWidth;
  }

  private progressY(p: number): number {
    return this.street.start + (this.street.end - this.street.start) * p;
  }

  // ------------------------------------------------------------------ camera

  /**
   * City choreography: ride along behind the pinball on the skyway, then a
   * low chase cam behind the getaway car, then a side-on view of the stunt.
   */
  readonly cameraPose = (dt: number, pos: THREE.Vector3, target: THREE.Vector3, t: number): void => {
    const a = this.game.attraction;
    const r = this.rush;
    const ball = a ? this.game.world.balls.find((b) => b.id === a.ballId) : undefined;
    let lambda = 3.4;
    if (r && (a?.phase === 'race' || a?.phase === 'finish') && r.phase !== 'done' && (r.phase === 'race' || r.t > 0)) {
      if (r.phase === 'race') {
        // Chase cam: behind and above the car, looking down Main Street. Portrait pulls back
        // and looks down more so all three lanes and the car stay in the narrow frame.
        const narrow = THREE.MathUtils.clamp((1.3 - this.aspect) / 0.8, 0, 1);
        const streetX = this.w(this.street.x, 0).x;
        this.tmp.copy(this.car.position).add(new THREE.Vector3(0, 2.1 + narrow * 3.2, -3.4 - narrow * 3.4));
        this.tmp.x = THREE.MathUtils.lerp(this.tmp.x + (this.car.position.x - streetX) * -0.3, streetX, narrow * 0.7);
        this.tmp2.copy(this.car.position).add(new THREE.Vector3(0, 0.3, 4.2 - narrow * 1.6));
        this.tmp2.x = THREE.MathUtils.lerp(this.tmp2.x, streetX, narrow * 0.7);
        lambda = 5;
      } else {
        // Stunt: swing out high over the west side of the city, with a clear view of the kicker, the arc and the roof.
        this.tmp.copy(this.w(-13.2, 9.8, 6.8));
        this.tmp2.copy(this.w(this.stunt.ramp.x, (this.stunt.ramp.y + this.stunt.roof.y) / 2 - 0.4, this.stunt.roofH - 0.8));
        lambda = 2.4;
      }
    } else if (ball) {
      // Ride-along: the ball on the skyway into town.
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
    const racing = !!this.rush && this.rush.phase !== 'done';
    // Ambient traffic: Main Street is closed while the race is on.
    const n = this.traffic.count;
    for (let i = 0; i < n; i++) {
      const c = this.trafficCars[i];
      const route = ROUTES[c.path];
      c.s = (c.s + dt * c.speed * (this.party > 0 ? 2 : 1)) % 1;
      const x = route.a[0] + (route.b[0] - route.a[0]) * c.s;
      const y = route.a[1] + (route.b[1] - route.a[1]) * c.s;
      const hide = route.main && racing;
      const p = this.w(x, y);
      const heading = Math.atan2(route.b[0] - route.a[0], -(route.b[1] - route.a[1]));
      this.m.makeRotationY(heading);
      if (hide) this.m.scale(new THREE.Vector3(0, 0, 0));
      this.m.setPosition(p.x, p.y, p.z);
      this.traffic.setMatrixAt(i, this.m);
    }
    this.traffic.instanceMatrix.needsUpdate = true;
    // Pedestrians stroll up and down the sidewalks.
    for (let i = 0; i < this.walkers.count; i++) {
      const wd = this.walkerData[i];
      wd.s += dt * wd.speed;
      const k = 0.5 - 0.5 * Math.cos(wd.s * Math.PI);
      const p = this.w(wd.x, wd.y0 + (wd.y1 - wd.y0) * k, this.deckH + 0.15 + Math.abs(Math.sin(this.time * 9 + i)) * 0.03);
      this.m.makeTranslation(p.x, p.y, p.z);
      this.walkers.setMatrixAt(i, this.m);
    }
    this.walkers.instanceMatrix.needsUpdate = true;
    // Skyline: a new tower rises for every city level; windows glow brighter as the city grows.
    const level = this.game.city.level;
    for (const r of this.risers) {
      const want = level >= r.level ? 1 : 0;
      r.grow += (want - r.grow) * Math.min(1, dt * 1.2);
      r.mesh.visible = r.grow > 0.01;
      r.mesh.scale.y = Math.max(0.001, r.grow);
    }
    this.crane.rotation.y = Math.sin(this.time * 0.25) * 0.8;
    this.windowMat.emissiveIntensity = 0.35 + Math.min(3, level) * 0.15 + (this.party > 0 ? 0.6 + 0.6 * Math.sin(this.time * 12) : 0);
    // Searchlights sweep during celebrations.
    this.searchlights.forEach((s, i) => {
      const mat = s.material as THREE.MeshBasicMaterial;
      mat.opacity += ((this.party > 0 ? 0.08 : 0) - mat.opacity) * Math.min(1, dt * 3);
      s.visible = mat.opacity > 0.004;
      s.rotation.z = Math.sin(this.time * 0.9 + i * 2) * 0.6;
      s.rotation.x = Math.cos(this.time * 0.7 + i) * 0.4 + Math.PI;
    });
    // Diverter: flips across the ramp while the city is lit.
    const lit = this.game.city.lit;
    this.diverter.rotation.y += ((lit ? -0.9 : 0) - this.diverter.rotation.y) * Math.min(1, dt * 8);
    this.diverterLamp.color.setHex(lit ? (Math.sin(this.time * 10) > 0 ? 0x3bff9a : 0x0c3a22) : 0x0c3a22);
    // Garage door rolls up for the race.
    const doorUp = racing || this.game.attraction?.kind === 'city';
    this.garageDoor.scale.y += ((doorUp ? 0.08 : 1) - this.garageDoor.scale.y) * Math.min(1, dt * 6);
    this.garageDoor.position.y = this.deckH + 0.55 + (1 - this.garageDoor.scale.y) * 0.46;
    // Landmarks: wrecked ones topple and go dark; rebuilt ones stand back up.
    for (const [id, lm] of this.landmarks) {
      lm.fall += ((lm.damaged ? 1 : 0) - lm.fall) * Math.min(1, dt * 2.5);
      if (id === 'billboard') lm.group.rotation.x = -lm.fall * 1.1;
      else if (id === 'waterTower') {
        lm.group.rotation.z = lm.fall * 1.35;
        lm.group.position.y = this.deckH + 1.8 - lm.fall * 0.5;
      } else lm.group.rotation.z = -lm.fall * 0.5;
      for (const m of lm.mats) m.emissiveIntensity = id === 'neonSign' ? (lm.damaged ? (Math.random() < 0.08 ? 0.8 : 0.05) : 1.4) : id === 'billboard' ? (lm.damaged ? 0.02 : 0.25) : 0;
    }
    this.updateCar(dt);
    // Coins spin.
    for (const c of this.coinPool) {
      if (!c.visible) continue;
      c.rotation.y += dt * 5;
      if (c.userData.coin?.taken) c.visible = false;
    }
  }

  private updateCar(dt: number): void {
    const r = this.rush;
    if (!r) return;
    const spin = (r.phase === 'race' ? 1 : 0.5) * dt * 30;
    for (const w of this.carWheels) w.rotation.x += spin;
    if (r.phase === 'race' || (r.phase === 'stunt' && r.stunt === 'none')) {
      const y = r.phase === 'race' ? this.progressY(r.progress) : this.street.end - (this.street.end - this.stunt.ramp.y) * Math.min(1, r.stuntT / STUNT_IDEAL);
      this.carLaneX += (this.laneX(r.lane) - this.carLaneX) * Math.min(1, dt * 14);
      const onKicker = r.phase === 'stunt' && r.stuntT > STUNT_IDEAL * 0.55 ? (r.stuntT / STUNT_IDEAL - 0.55) * 1.2 : 0;
      this.car.position.copy(this.w(r.phase === 'race' ? this.carLaneX : this.carLaneX + (this.street.x - this.carLaneX) * Math.min(1, r.stuntT * 3), y, this.deckH + onKicker));
      const steer = (this.laneX(r.lane) - this.carLaneX) * 0.6;
      this.car.rotation.set(-onKicker * 0.5, steer, this.carWreck > 0 ? Math.sin(this.time * 40) * 0.25 : 0);
      if (this.carWreck > 0) this.carWreck -= dt;
      // Pass-by: obstacles the car hit get knocked aside.
      for (const list of Object.values(this.obstaclePool)) {
        for (const m of list) {
          const o = m.userData.obstacle;
          if (m.visible && o?.hit && !m.userData.knocked) {
            m.userData.knocked = true;
            m.rotation.z = 0.6;
            m.position.y += 0.15;
          }
        }
      }
      return;
    }
    // Airtime: a parabola onto the roof, or into the landmark.
    const k = Math.min(1, r.airT / (this.airSuccess ? STUNT_AIRTIME * 0.78 : STUNT_AIRTIME * 0.55));
    if (this.airSuccess) {
      this.car.position.lerpVectors(this.airFrom, this.airTo, k);
      this.car.position.y += Math.sin(k * Math.PI) * 2.2;
      this.car.rotation.x = -k * Math.PI * 2;
      if (k >= 1 && !this.crashAt) {
        this.crashAt = this.car.position.clone();
        this.car.rotation.set(0, Math.PI * 0.15, 0);
        this.onFx?.('burst', this.car.position.clone().setY(this.car.position.y + 0.3));
      }
    } else {
      if (k < 1) {
        this.car.position.lerpVectors(this.airFrom, this.airTo, k);
        this.car.position.y += Math.sin(k * Math.PI) * 1.4;
        this.car.rotation.x = -k * 2;
        this.car.rotation.z = k * 1.2;
      } else {
        if (!this.crashAt) {
          this.crashAt = this.car.position.clone();
          this.onFx?.('explode', this.crashAt.clone());
        }
        // Tumble down to the plaza next to the landmark.
        const fall = Math.min(1, (r.airT - STUNT_AIRTIME * 0.55) / 0.5);
        this.car.position.copy(this.crashAt);
        this.car.position.y = this.crashAt.y + (this.deckH + 0.1 - this.crashAt.y) * fall;
        this.car.rotation.z = 1.2 + fall * 1.9;
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

function billboardTexture(): THREE.CanvasTexture {
  return canvasTex(512, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 512, 256);
    grad.addColorStop(0, '#ff3b6b');
    grad.addColorStop(1, '#ffb13b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#fff';
    g.font = 'bold 92px sans-serif';
    g.textAlign = 'center';
    g.fillText('BIG FLY', 256, 118);
    g.font = 'bold 54px sans-serif';
    g.fillText('COLA · ICE COLD', 256, 196);
  });
}

function neonTexture(): THREE.CanvasTexture {
  return canvasTex(128, 384, (g) => {
    g.fillStyle = '#12051a';
    g.fillRect(0, 0, 128, 384);
    g.fillStyle = '#ff4df0';
    g.font = 'bold 76px sans-serif';
    g.textAlign = 'center';
    'HOTEL'.split('').forEach((ch, i) => g.fillText(ch, 64, 70 + i * 72));
  });
}

function helipadTexture(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#2a2f3a';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#f5c542';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(128, 128, 100, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 140px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('H', 128, 136);
  });
}

function stripeTexture(): THREE.CanvasTexture {
  const t = canvasTex(128, 128, (g) => {
    g.fillStyle = '#111';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f5c542';
    for (let i = -128; i < 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 16, 0);
      g.lineTo(i + 16 + 128, 128);
      g.lineTo(i + 128, 128);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}
