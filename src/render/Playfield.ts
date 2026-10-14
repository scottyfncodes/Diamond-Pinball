import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World } from '../physics/World';
import type { Vec2 } from '../physics/Vec2';
import { TABLE, type TableDef, type WallDef } from '../table/layout';
import type { LampState } from '../game/events';
import { toWorld } from './space';
import { buildTrack } from './rails';
import { CHASER_LAMPS, DISPLAY, createBannerTexture, createBaseballTexture, createInsertTexture, createLacquerTexture, createMetalTexture, createParticleTexture, createPlayfieldTexture, createWoodTexture, type Theme } from './textures';

interface BumperView {
  group: THREE.Group;
  cap: THREE.Mesh;
  ring: THREE.Mesh;
  /** Chrome kicker ring: slams down on a hit, then springs back. */
  kicker: THREE.Mesh;
  skirt: THREE.MeshStandardMaterial;
  pulse: number;
}
interface TargetView {
  mesh: THREE.Object3D;
  face: THREE.MeshStandardMaterial;
  down: boolean;
  t: number;
  baseY: number;
  pulse: number;
}
interface LampView {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  color: THREE.Color;
  state: LampState;
  phase: number;
}

export type Quality = 'low' | 'medium' | 'high';

/** Off lamps still read as tinted glass inserts. */
const LAMP_DIM = 0.3;
const CAP_GLOW = 0.06;
const RUBBER = 0xf2efe6;
const RING_IDLE = 0.12;
const TARGET_IDLE = 0.08;

/** Field-paint palette for the target banks. */
const BANK_COLORS: Record<string, string> = { bases: '#f4c430', leftField: '#2f86ff', rightField: '#ff7a1f' };

/** A target's printed face: bank colour plastic with its label, like a real decal. */
const targetDecal = (label: string, color: string): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 160);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.08, color);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 120, 256, 40);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 228, 132);
  ctx.font = `700 ${label.length > 3 ? 46 : 74}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(10,14,30,0.8)';
  ctx.strokeText(label, 128, 82, 210);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 128, 82, 210);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** Maple bat grain for the flipper tops, with a branded oval at the barrel. */
const batTexture = (): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#f6dcae');
  g.addColorStop(0.5, '#e9c38a');
  g.addColorStop(1, '#c99a5c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * 128 + Math.sin(i) * 3;
    ctx.strokeStyle = `rgba(120,70,25,${0.08 + (i % 3) * 0.05})`;
    ctx.lineWidth = 1 + (i % 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(170, y + 4, 340, y - 4, 512, y + 2);
    ctx.stroke();
  }
  // Grip tape toward the tip.
  ctx.fillStyle = '#1b1f2e';
  ctx.fillRect(400, 0, 112, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 3;
  for (let x = 400; x < 520; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 24, 128);
    ctx.stroke();
  }
  // Burned-in brand oval near the barrel.
  ctx.strokeStyle = 'rgba(90,45,10,0.75)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(150, 64, 62, 30, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(90,45,10,0.8)';
  ctx.font = `700 34px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DP 26', 150, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** Ballpark bunting for the slingshot caps: red, white and navy pleats. */
const buntingTexture = (trim: string): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const bands = ['#0d1a45', '#f3ead3', trim, '#f3ead3', '#0d1a45'];
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, (i * 128) / bands.length, 128, 128 / bands.length + 1);
  });
  for (let x = 0; x < 128; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, 128);
  }
  ctx.fillStyle = '#f3ead3';
  for (const [x, y] of [[32, 13], [64, 13], [96, 13], [32, 115], [64, 115], [96, 115]]) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const r = k % 2 ? 3 : 7;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** A round rubber band along a polyline (reads as rubber, not as a box). */
const rubberTube = (pts: THREE.Vector3[], radius: number, closed = false): THREE.BufferGeometry => {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0);
  return new THREE.TubeGeometry(curve, Math.max(8, pts.length * 10), radius, 8, closed);
};

const cabinetTexture = (theme: Theme): THREE.CanvasTexture => {
  const t = theme.lacquer ? createLacquerTexture(theme.cabinet, theme.cabinetDark) : createWoodTexture(theme.cabinet, theme.cabinetDark);
  t.repeat.set(2, 6);
  return t;
};

const segmentBox = (a: THREE.Vector3, b: THREE.Vector3, height: number, thickness: number, yOffset = 0): THREE.BoxGeometry => {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.BoxGeometry(len + thickness * 0.6, height, thickness);
  const m = new THREE.Matrix4();
  const angle = Math.atan2(-d.z, d.x);
  m.makeRotationY(angle);
  m.setPosition((a.x + b.x) / 2, height / 2 + yOffset, (a.z + b.z) / 2);
  g.applyMatrix4(m);
  return g;
};

/**
 * Builds the 3D pinball cabinet and every table element from the layout
 * definition, and animates the dynamic parts (flippers, bumpers, targets,
 * lamps, plunger).
 */
export class PlayfieldView {
  readonly group = new THREE.Group();
  readonly staticGroup = new THREE.Group();
  private flipperGroups = new Map<string, THREE.Group>();
  private bumpers = new Map<string, BumperView>();
  private targets = new Map<string, TargetView>();
  private lamps = new Map<string, LampView>();
  private plungerKnob!: THREE.Group;
  private plungerCharge = 0;
  private playfieldMaterial!: THREE.MeshStandardMaterial;
  private woodMaterial!: THREE.MeshStandardMaterial;
  private plasticMaterial!: THREE.MeshStandardMaterial;
  private railMaterial!: THREE.MeshStandardMaterial;
  private rubberMaterial = new THREE.MeshStandardMaterial({ color: RUBBER, roughness: 0.58, metalness: 0 });
  private glass!: THREE.Mesh;
  private time = 0;
  private blockers = new Map<string, THREE.Mesh>();
  private rovingId: string | null = null;
  private blackHole = 0;
  private flareT = 0;
  /** Additive glow halos: one per game lamp, then one per chaser lamp. */
  private halos!: THREE.InstancedMesh;
  private chasers!: THREE.InstancedMesh;
  private chaserColor = new THREE.Color(0xffd84a);
  private ledMaterial!: THREE.MeshBasicMaterial;
  private slingMaterial!: THREE.MeshStandardMaterial;
  private tmpColor = new THREE.Color();
  readonly backboxFace: THREE.Mesh;

  constructor(
    private def: TableDef,
    private world: World,
    private theme: Theme,
    private envMap: THREE.Texture | null,
    readonly quality: Quality,
    scoreboardTexture: THREE.Texture,
  ) {
    this.group.add(this.staticGroup);
    this.buildMaterials();
    this.buildPlayfield();
    this.buildWalls();
    this.buildPosts();
    this.buildSlingshots();
    this.buildBumpers();
    this.buildTargets();
    this.buildLamps();
    this.buildRamps();
    this.buildFlippers();
    this.buildPlunger();
    this.buildSaucer();
    this.buildBlockers();
    this.backboxFace = this.buildCabinet(scoreboardTexture);
  }

  /** WALL BOUNCE rails: glowing bars that close the outlanes and the drain while the modifier runs. */
  private buildBlockers(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7cff5a, emissive: 0x7cff5a, emissiveIntensity: 0.9, roughness: 0.3, transparent: true, opacity: 0.9 });
    for (const b of this.def.blockers) {
      const a = toWorld(b.a.x, b.a.y);
      const c = toWorld(b.b.x, b.b.y);
      const mesh = new THREE.Mesh(segmentBox(a, c, 0.9, 0.28), mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.blockers.set(b.id, mesh);
    }
  }

  /** The chaos roving jackpot highlights one target lamp (null clears it). */
  setRoving(id: string | null): void {
    this.rovingId = id;
  }

  /** The centre bumper swallows a ball: it pulses dark for a moment. */
  pulseBlackHole(): void {
    this.blackHole = 1.2;
  }

  /** Big moments light every chaser lamp at once for a beat. */
  flare(amount: number): void {
    this.flareT = Math.max(this.flareT, Math.min(1.5, amount));
  }

  // ------------------------------------------------------------------ materials

  private buildMaterials(): void {
    this.woodMaterial = new THREE.MeshStandardMaterial({ map: cabinetTexture(this.theme), roughness: this.theme.lacquer ? 0.22 : 0.5, metalness: this.theme.lacquer ? 0.35 : 0.05, envMap: this.envMap, envMapIntensity: this.theme.lacquer ? 1.0 : 0.45 });
    const metal = createMetalTexture();
    metal.repeat.set(4, 1);
    // Polished steel: low roughness so the stadium light banks streak across every rail.
    this.railMaterial = new THREE.MeshStandardMaterial({ color: this.theme.rail, map: metal, metalness: this.theme.railMetalness, roughness: 0.16, envMap: this.envMap, envMapIntensity: 1.25 });
    this.plasticMaterial = new THREE.MeshStandardMaterial({ color: this.theme.accent2, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.72, envMap: this.envMap, envMapIntensity: 0.9 });
    // A clear-coated playfield: the art stays bright and the lights glint off it.
    const map = createPlayfieldTexture(this.def, this.theme, this.artWidth);
    this.playfieldMaterial =
      this.quality === 'low'
        ? new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0, envMap: this.envMap, envMapIntensity: 0.35 })
        : new THREE.MeshPhysicalMaterial({ map, roughness: 0.62, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.07, envMap: this.envMap, envMapIntensity: 0.4 });
    const trim = this.theme.trim ?? this.theme.accent;
    this.slingMaterial = new THREE.MeshStandardMaterial({ color: trim, emissive: trim, emissiveIntensity: 0.08, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.9, envMap: this.envMap, envMapIntensity: 0.9 });
    this.ledMaterial = new THREE.MeshBasicMaterial({ color: this.theme.glow, toneMapped: false });
  }

  get currentTheme(): Theme {
    return this.theme;
  }

  /** Playfield art resolution: the table fills most of the screen, so it scales with quality. */
  private get artWidth(): number {
    return this.quality === 'high' ? 2048 : this.quality === 'medium' ? 1536 : 1024;
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    this.woodMaterial.map?.dispose();
    this.woodMaterial.map = cabinetTexture(theme);
    this.woodMaterial.roughness = theme.lacquer ? 0.28 : 0.55;
    this.woodMaterial.metalness = theme.lacquer ? 0.3 : 0.05;
    this.woodMaterial.envMapIntensity = theme.lacquer ? 0.9 : 0.4;
    this.woodMaterial.needsUpdate = true;
    const trim = theme.trim ?? theme.accent;
    this.slingMaterial.color.set(trim);
    this.slingMaterial.emissive.set(trim);
    this.ledMaterial.color.set(theme.glow);
    this.railMaterial.color.set(theme.rail);
    this.railMaterial.metalness = theme.railMetalness;
    this.plasticMaterial.color.set(theme.accent2);
    this.playfieldMaterial.map?.dispose();
    this.playfieldMaterial.map = createPlayfieldTexture(this.def, theme, this.artWidth);
    this.playfieldMaterial.needsUpdate = true;
  }

  // ------------------------------------------------------------------ static geometry

  private buildPlayfield(): void {
    const g = new THREE.PlaneGeometry(TABLE.width, TABLE.length);
    const mesh = new THREE.Mesh(g, this.playfieldMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.staticGroup.add(mesh);
  }

  private buildWalls(): void {
    const byStyle: Record<WallDef['style'], THREE.BufferGeometry[]> = { wood: [], metal: [], rubber: [], plastic: [], fence: [] };
    for (const wall of this.def.walls) {
      if (wall.id === 'outer_arc') continue; // the arc is a continuous padded wall
      const thickness = wall.style === 'wood' ? 0.5 : wall.style === 'metal' ? 0.2 : 0.3;
      for (let i = 0; i < wall.points.length - 1; i++) {
        const a = toWorld(wall.points[i].x, wall.points[i].y);
        const b = toWorld(wall.points[i + 1].x, wall.points[i + 1].y);
        byStyle[wall.style].push(segmentBox(a, b, wall.height, thickness));
      }
    }
    const add = (geos: THREE.BufferGeometry[], material: THREE.Material, castShadow = true) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow && this.quality !== 'low';
      mesh.receiveShadow = true;
      this.staticGroup.add(mesh);
    };
    add(byStyle.wood, this.woodMaterial);
    add(byStyle.metal, this.railMaterial);
    add(byStyle.plastic, this.plasticMaterial, false);
    add(byStyle.rubber, this.rubberMaterial);
    add(byStyle.fence, this.plasticMaterial);

    // Outfield wall: padded green fence with ad banners and a yellow top line.
    const c = toWorld(TABLE.arcCenter.x, TABLE.arcCenter.y);
    const fenceGeo = new THREE.CylinderGeometry(TABLE.arcRadius + 0.05, TABLE.arcRadius + 0.05, 1.5, 64, 1, true, Math.PI / 2, Math.PI);
    const bannerTex = createBannerTexture(this.theme);
    // The banners are seen from inside the cylinder, so flip the texture horizontally.
    bannerTex.repeat.x = -1;
    bannerTex.offset.x = 1;
    const fenceMat = new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, roughness: 0.7 });
    const fence = new THREE.Mesh(fenceGeo, fenceMat);
    fence.position.set(c.x, 0.75, c.z);
    fence.castShadow = this.quality !== 'low';
    this.staticGroup.add(fence);
    const padGeo = new THREE.CylinderGeometry(TABLE.arcRadius + 0.5, TABLE.arcRadius + 0.5, 1.5, 64, 1, true, Math.PI / 2, Math.PI);
    const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: 0x1f5a2e, roughness: 0.9, side: THREE.DoubleSide }));
    pad.position.copy(fence.position);
    this.staticGroup.add(pad);
    const topGeo = new THREE.TorusGeometry(TABLE.arcRadius + 0.28, 0.12, 6, 64, Math.PI);
    const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.5 }));
    top.rotation.x = -Math.PI / 2;
    top.rotation.z = Math.PI;
    top.position.set(c.x, 1.5, c.z);
    this.staticGroup.add(top);
    // Foul poles.
    for (const x of [0.35, 21.65]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8), new THREE.MeshStandardMaterial({ color: 0xffe14d, roughness: 0.4 }));
      const p = toWorld(x, 33.2, 2);
      pole.position.copy(p);
      this.staticGroup.add(pole);
    }
  }

  private buildPosts(): void {
    const bases: THREE.BufferGeometry[] = [];
    const caps: THREE.BufferGeometry[] = [];
    const rings: THREE.BufferGeometry[] = [];
    for (const post of this.def.posts) {
      const p = toWorld(post.pos.x, post.pos.y);
      const base = new THREE.CylinderGeometry(post.radius * 0.62, post.radius * 0.7, 1.0, 16);
      base.translate(p.x, 0.5, p.z);
      bases.push(base);
      // Domed star-post cap.
      const cap = new THREE.SphereGeometry(post.radius * 0.66, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.55, 1);
      cap.translate(p.x, 1.0, p.z);
      caps.push(cap);
      const ring = new THREE.TorusGeometry(post.radius * 0.74, post.radius * 0.3, 10, 20);
      ring.rotateX(Math.PI / 2);
      ring.translate(p.x, 0.55, p.z);
      rings.push(ring);
    }
    const baseMesh = new THREE.Mesh(mergeGeometries([...bases, ...caps], false)!, this.railMaterial);
    baseMesh.castShadow = this.quality === 'high';
    const ringMesh = new THREE.Mesh(mergeGeometries(rings, false)!, this.rubberMaterial);
    ringMesh.castShadow = this.quality === 'high';
    this.staticGroup.add(baseMesh, ringMesh);
    [...bases, ...caps, ...rings].forEach((g) => g.dispose());
  }

  private buildSlingshots(): void {
    const mat = this.slingMaterial;
    const capMat = new THREE.MeshStandardMaterial({ map: buntingTexture(this.theme.trim ?? '#d2232a'), roughness: 0.3, envMap: this.envMap, envMapIntensity: 0.5 });
    capMat.map!.repeat.set(0.55, 0.55);
    for (const s of this.def.slingshots) {
      const shape = new THREE.Shape();
      const pts = s.points.map((p) => toWorld(p.x, p.y));
      shape.moveTo(pts[0].x, -pts[0].z);
      shape.lineTo(pts[1].x, -pts[1].z);
      shape.lineTo(pts[2].x, -pts[2].z);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = this.quality !== 'low';
      this.staticGroup.add(mesh);
      // Printed plastic cap on top: ballpark bunting.
      const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
      const cz = (pts[0].z + pts[1].z + pts[2].z) / 3;
      const inset = new THREE.Shape(pts.map((p) => new THREE.Vector2(cx + (p.x - cx) * 0.86, -(cz + (p.z - cz) * 0.86))));
      const cap = new THREE.Mesh(new THREE.ShapeGeometry(inset), capMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.y = 1.0;
      this.staticGroup.add(cap);
      // Rubber band around the posts and chrome posts at every corner.
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const a = pts[i];
        ring.push(new THREE.Vector3(a.x + (a.x - cx) * 0.06, 0.55, a.z + (a.z - cz) * 0.06));
        const postMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 1.15, 14), this.railMaterial);
        postMesh.position.set(a.x, 0.58, a.z);
        this.staticGroup.add(postMesh);
      }
      const band = new THREE.Mesh(rubberTube([...ring, ring[0]], 0.13), this.rubberMaterial);
      band.castShadow = this.quality === 'high';
      this.staticGroup.add(band);
    }
  }

  private buildSaucer(): void {
    const p = toWorld(this.def.saucer.pos.x, this.def.saucer.pos.y);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(this.def.saucer.radius, this.def.saucer.radius, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 1 }));
    hole.position.set(p.x, 0.02, p.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(this.def.saucer.radius, 0.08, 6, 32), this.railMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.06, p.z);
    this.staticGroup.add(hole, ring);
  }

  private buildRamps(): void {
    for (const ramp of this.def.ramps) {
      this.staticGroup.add(buildTrack(ramp.path, { color: ramp.color, railMaterial: this.railMaterial, envMap: this.envMap, castShadow: this.quality === 'high' }));
    }
  }

  /** The shared steel rail material (city skyway, attraction hardware). */
  get rails(): THREE.MeshStandardMaterial {
    return this.railMaterial;
  }

  // ------------------------------------------------------------------ dynamic elements

  private buildBumpers(): void {
    const ballTex = createBaseballTexture();
    for (const b of this.def.bumpers) {
      const group = new THREE.Group();
      const p = toWorld(b.pos.x, b.pos.y);
      group.position.set(p.x, 0, p.z);
      // Chrome base plate.
      const base = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 1.02, b.radius * 1.08, 0.22, 32), this.railMaterial);
      base.position.y = 0.11;
      // Translucent red body lit from inside.
      const skirt = new THREE.MeshStandardMaterial({ color: 0xc0141c, emissive: 0xff2a14, emissiveIntensity: 0.18, roughness: 0.16, transparent: true, opacity: 0.86, envMap: this.envMap, envMapIntensity: 1.0 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 0.58, b.radius * 0.72, 1.0, 28), skirt);
      body.position.y = 0.72;
      body.castShadow = this.quality !== 'low';
      // Kicker ring: the steel ring that snaps down when the ball hits.
      const kicker = new THREE.Mesh(new THREE.TorusGeometry(b.radius * 0.86, 0.07, 10, 40), this.railMaterial);
      kicker.rotation.x = Math.PI / 2;
      kicker.position.y = 0.95;
      // The cap is a giant baseball dome in a gold bezel; it flashes when struck.
      const capMat = new THREE.MeshStandardMaterial({ map: ballTex, color: 0xffffff, emissive: 0xffe6a8, emissiveIntensity: CAP_GLOW, roughness: 0.28, envMap: this.envMap, envMapIntensity: 0.7 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(b.radius * 0.96, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
      cap.scale.y = 0.45;
      cap.position.y = 1.3;
      cap.castShadow = this.quality !== 'low';
      const ringMat = new THREE.MeshStandardMaterial({ color: 0xf4c25a, metalness: 0.9, roughness: 0.22, emissive: 0xffc23f, emissiveIntensity: RING_IDLE, envMap: this.envMap, envMapIntensity: 1.1 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(b.radius * 0.98, 0.1, 10, 40), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.3;
      group.add(base, body, kicker, cap, ring);
      this.group.add(group);
      this.bumpers.set(b.id, { group, cap, ring, kicker, skirt, pulse: 0 });
    }
  }

  private buildTargets(): void {
    const housing = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.4, metalness: 0.2, envMap: this.envMap, envMapIntensity: 0.6 });
    const decals = new Map<string, THREE.CanvasTexture>();
    for (const t of this.def.targets) {
      const a = toWorld(t.a.x, t.a.y);
      const b = toWorld(t.b.x, t.b.y);
      const len = a.distanceTo(b);
      const color = BANK_COLORS[t.bank] ?? '#f4c430';
      const key = `${t.label}|${color}`;
      if (!decals.has(key)) decals.set(key, targetDecal(t.label, color));
      const tint = new THREE.Color(color);
      const face = new THREE.MeshStandardMaterial({ map: decals.get(key)!, emissive: tint, emissiveIntensity: TARGET_IDLE, roughness: 0.22, envMap: this.envMap, envMapIntensity: 0.7 });
      const h = t.kind === 'drop' ? 1.0 : 1.1;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(len * 0.9, h, 0.16), [housing, housing, housing, housing, face, face]);
      // Black backing frame and a chrome bracket give the target a body.
      const back = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, h * 0.86, 0.12), housing);
      back.position.set(0, -h * 0.05, -0.14);
      const holder = new THREE.Group();
      holder.add(plate, back);
      const d = new THREE.Vector3().subVectors(b, a);
      holder.rotation.y = Math.atan2(-d.z, d.x);
      const baseY = t.kind === 'drop' ? 0.5 : 0.55;
      holder.position.set((a.x + b.x) / 2, baseY, (a.z + b.z) / 2);
      plate.castShadow = this.quality === 'high';
      this.group.add(holder);
      this.targets.set(t.id, { mesh: holder, face, down: false, t: 0, baseY, pulse: 0 });
    }
  }

  private buildLamps(): void {
    const insertTex = createInsertTexture();
    for (const lamp of this.def.lamps) {
      const color = new THREE.Color(lamp.color);
      const material = new THREE.MeshBasicMaterial({ map: insertTex, color: color.clone().multiplyScalar(LAMP_DIM), toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24), material);
      mesh.rotation.x = -Math.PI / 2;
      const p = toWorld(lamp.pos.x, lamp.pos.y, 0.035);
      mesh.position.copy(p);
      this.group.add(mesh);
      this.lamps.set(lamp.id, { mesh, material, color, state: 'off', phase: Math.random() * 6 });
    }
    // Chaser lamps: purely decorative rows that run an attract pattern.
    const m = new THREE.Matrix4();
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const one = new THREE.Vector3(1, 1, 1);
    this.chasers = new THREE.InstancedMesh(new THREE.CircleGeometry(0.26, 20), new THREE.MeshBasicMaterial({ map: insertTex, toneMapped: false }), CHASER_LAMPS.length);
    CHASER_LAMPS.forEach((c, i) => {
      this.chasers.setMatrixAt(i, m.compose(toWorld(c.x, c.y, 0.035), flat, one));
      this.chasers.setColorAt(i, this.chaserColor);
    });
    this.group.add(this.chasers);
    // Soft additive halos make lit inserts bloom off the clear-coat.
    const n = this.def.lamps.length + CHASER_LAMPS.length;
    const haloMat = new THREE.MeshBasicMaterial({ map: createParticleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMat, n);
    this.halos.renderOrder = 5;
    const sc = new THREE.Vector3();
    this.def.lamps.forEach((l, i) => {
      this.halos.setMatrixAt(i, m.compose(toWorld(l.pos.x, l.pos.y, 0.07), flat, sc.set(2.1, 2.1, 1)));
      this.halos.setColorAt(i, this.tmpColor.set(0));
    });
    CHASER_LAMPS.forEach((c, i) => {
      this.halos.setMatrixAt(this.def.lamps.length + i, m.compose(toWorld(c.x, c.y, 0.07), flat, sc.set(1.5, 1.5, 1)));
      this.halos.setColorAt(this.def.lamps.length + i, this.tmpColor.set(0));
    });
    this.group.add(this.halos);
  }

  private buildFlippers(): void {
    const sides = new THREE.MeshStandardMaterial({ color: 0xe2bb82, roughness: 0.35, envMap: this.envMap, envMapIntensity: 0.5 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0xc8161e, roughness: 0.55 });
    const pivotMat = this.railMaterial;
    const outline = (rb: number, rt: number, L: number) => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, rb, Math.PI / 2, (3 * Math.PI) / 2, false);
      shape.lineTo(L, -rt);
      shape.absarc(L, 0, rt, -Math.PI / 2, Math.PI / 2, false);
      shape.closePath();
      return shape;
    };
    for (const f of this.def.flippers) {
      const group = new THREE.Group();
      const p = toWorld(f.pivot.x, f.pivot.y);
      group.position.set(p.x, 0, p.z);
      const rb = f.baseRadius;
      const rt = f.tipRadius;
      const L = f.length;
      // Maple-bat flipper: the top face carries the grain, grip tape and the brand.
      const tex = batTexture();
      const span = L + rb + rt;
      tex.repeat.set(1 / span, 1 / (2 * rb));
      tex.offset.set(rb / span, 0.5);
      if (f.side === 'right') {
        tex.repeat.y *= -1;
      }
      const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, envMap: this.envMap, envMapIntensity: 0.6 });
      const geo = new THREE.ExtrudeGeometry(outline(rb, rt, L), { depth: 0.8, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 3 });
      const mesh = new THREE.Mesh(geo, [top, sides]);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = this.quality !== 'low';
      group.add(mesh);
      // Classic red rubber ring around the bat.
      const band = new THREE.Mesh(new THREE.ExtrudeGeometry(outline(rb + 0.07, rt + 0.07, L), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }), rubber);
      band.rotation.x = -Math.PI / 2;
      band.position.y = 0.2;
      group.add(band);
      // Chrome pivot cap.
      const pivot = new THREE.Mesh(new THREE.CylinderGeometry(rb * 0.42, rb * 0.48, 0.14, 20), pivotMat);
      pivot.position.y = 0.9;
      group.add(pivot);
      this.group.add(group);
      this.flipperGroups.set(f.id, group);
    }
  }

  private buildPlunger(): void {
    const p = toWorld(this.def.launch.x, 0.6);
    this.plungerKnob = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 10), this.railMaterial);
    rod.rotation.x = Math.PI / 2;
    rod.position.z = 1.2;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd84343, roughness: 0.5 }));
    knob.position.z = 2.5;
    this.plungerKnob.add(rod, knob);
    this.plungerKnob.position.set(p.x, 0.5, p.z);
    this.group.add(this.plungerKnob);
  }

  private buildCabinet(scoreboardTexture: THREE.Texture): THREE.Mesh {
    const hw = TABLE.width / 2;
    const hl = TABLE.length / 2;
    const wallH = 2.4;
    const depth = 4.5;
    const parts: THREE.BufferGeometry[] = [];
    const side = (x: number) => {
      const g = new THREE.BoxGeometry(0.7, wallH + depth, TABLE.length + 1.4);
      g.translate(x, (wallH - depth) / 2, 0);
      parts.push(g);
    };
    side(-hw - 0.35);
    side(hw + 0.35);
    const front = new THREE.BoxGeometry(TABLE.width + 1.4, wallH + depth, 0.7);
    front.translate(0, (wallH - depth) / 2, hl + 0.35);
    parts.push(front);
    const back = new THREE.BoxGeometry(TABLE.width + 1.4, wallH + depth, 0.7);
    back.translate(0, (wallH - depth) / 2, -hl - 0.35);
    parts.push(back);
    const floor = new THREE.BoxGeometry(TABLE.width, 0.3, TABLE.length);
    floor.translate(0, -0.18, 0);
    parts.push(floor);
    const cabinet = new THREE.Mesh(mergeGeometries(parts, false)!, this.woodMaterial);
    cabinet.receiveShadow = true;
    this.staticGroup.add(cabinet);
    parts.forEach((g) => g.dispose());

    // Side rails and lockdown bar.
    const railParts: THREE.BufferGeometry[] = [];
    for (const x of [-hw - 0.35, hw + 0.35]) {
      const g = new THREE.BoxGeometry(0.8, 0.25, TABLE.length + 1.5);
      g.translate(x, wallH + 0.12, 0);
      railParts.push(g);
    }
    const bar = new THREE.BoxGeometry(TABLE.width + 1.5, 0.4, 1.0);
    bar.translate(0, wallH + 0.1, hl + 0.3);
    railParts.push(bar);
    const rails = new THREE.Mesh(mergeGeometries(railParts, false)!, this.railMaterial);
    this.staticGroup.add(rails);
    railParts.forEach((g) => g.dispose());

    // LED strips along the inside of the cabinet walls.
    const ledParts: THREE.BufferGeometry[] = [];
    for (const x of [-hw + 0.06, hw - 0.06]) {
      const g = new THREE.BoxGeometry(0.1, 0.1, TABLE.length);
      g.translate(x, wallH - 0.3, 0);
      ledParts.push(g);
    }
    this.staticGroup.add(new THREE.Mesh(mergeGeometries(ledParts, false)!, this.ledMaterial));
    ledParts.forEach((g) => g.dispose());

    // Glass.
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0, envMap: this.envMap, envMapIntensity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.width + 0.6, TABLE.length + 0.6), glassMat);
    this.glass.rotation.x = -Math.PI / 2;
    this.glass.position.y = wallH;
    this.glass.renderOrder = 10;
    this.staticGroup.add(this.glass);

    // Backbox with the scoreboard backglass.
    const backbox = new THREE.Group();
    const boxGeo = new THREE.BoxGeometry(TABLE.width + 1.4, 12.5, 2.6);
    const box = new THREE.Mesh(boxGeo, this.woodMaterial);
    box.position.set(0, 6.0, -hl - 1.65);
    backbox.add(box);
    const faceMat = new THREE.MeshBasicMaterial({ map: scoreboardTexture, toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.width - 0.2, 11), faceMat);
    face.position.set(0, 6.3, -hl - 0.33);
    backbox.add(face);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(TABLE.width + 1.6, 0.4, 2.8), this.railMaterial);
    trim.position.set(0, 12.4, -hl - 1.65);
    backbox.add(trim);
    this.staticGroup.add(backbox);
    return face;
  }

  // ------------------------------------------------------------------ runtime

  setLamp(id: string, state: LampState): void {
    const lamp = this.lamps.get(id);
    if (!lamp) return;
    lamp.state = state;
  }

  hitBumper(id: string): void {
    const b = this.bumpers.get(id);
    if (b) b.pulse = 1;
  }

  setTarget(id: string, down: boolean): void {
    const t = this.targets.get(id);
    if (!t) return;
    t.down = down;
    t.pulse = 1;
  }

  pulseTarget(id: string): void {
    const t = this.targets.get(id);
    if (t) t.pulse = 1;
  }

  setPlungerCharge(c: number): void {
    this.plungerCharge = c;
  }

  private lampForTarget(id: string): string {
    switch (id) {
      case 'base_1b': return 'lamp_1b';
      case 'base_3b': return 'lamp_3b';
      case 'center_lane': return 'lamp_2b';
      case 'hr_lane': return 'lamp_hr';
      case 'mound': return 'lamp_mound';
      case 'left_ramp': return 'lamp_left_ramp';
      case 'right_ramp': return 'lamp_right_ramp';
      default: return id.startsWith('leftField') ? 'lamp_leftField' : id.startsWith('rightField') ? 'lamp_rightField' : id;
    }
  }

  worldPoint(p: Vec2, h = 0.5): THREE.Vector3 {
    return toWorld(p.x, p.y, h);
  }

  update(dt: number): void {
    this.time += dt;
    for (const [id, group] of this.flipperGroups) {
      const f = this.world.flippers.get(id);
      if (f) {
        group.rotation.y = f.angle;
        // Visual thickness follows the difficulty's flipper capsule.
        const k = f.tipRadius0 > 0 ? f.tipRadius / f.tipRadius0 : 1;
        group.scale.set(1, 1, k);
      }
    }
    for (const [id, mesh] of this.blockers) {
      const c = this.world.colliders.get(id);
      const on = !!c?.enabled;
      mesh.visible = on;
      if (on) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.sin(this.time * 9) * 0.4;
    }
    if (this.blackHole > 0) {
      this.blackHole = Math.max(0, this.blackHole - dt);
      const b = this.bumpers.get('bumper_c');
      if (b) {
        const k = this.blackHole / 1.2;
        (b.cap.material as THREE.MeshStandardMaterial).emissiveIntensity = CAP_GLOW + k * 3;
        b.cap.scale.set(1 - k * 0.3, 1, 1 - k * 0.3);
        (b.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = RING_IDLE + Math.max(0, Math.sin(this.time * 30)) * k * 3;
      }
    }
    for (const b of this.bumpers.values()) {
      if (b.pulse > 0) {
        // Impact: the kicker ring slams down and the lamp flashes; recovery springs it back with a little overshoot.
        b.pulse = Math.max(0, b.pulse - dt * 3.2);
        const t = 1 - b.pulse;
        const slam = t < 0.12 ? t / 0.12 : Math.max(0, Math.cos((t - 0.12) * 9) * Math.exp(-(t - 0.12) * 7));
        b.kicker.position.y = 0.95 - slam * 0.55;
        const s = 1 + slam * 0.08;
        b.cap.scale.set(s, 0.45 * (1 - slam * 0.12), s);
        const flash = b.pulse * b.pulse;
        (b.cap.material as THREE.MeshStandardMaterial).emissiveIntensity = CAP_GLOW + flash * 1.8;
        (b.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = RING_IDLE + flash * 3;
        b.skirt.emissiveIntensity = 0.18 + flash * 2.4;
      }
    }
    for (const t of this.targets.values()) {
      const targetY = t.down ? t.baseY - 1.05 : t.baseY;
      t.mesh.position.y += (targetY - t.mesh.position.y) * Math.min(1, dt * 14);
      if (t.pulse > 0) {
        // A hit target recoils, flashes, and settles.
        t.pulse = Math.max(0, t.pulse - dt * 4);
        t.face.emissiveIntensity = TARGET_IDLE + t.pulse * t.pulse * 1.8;
        t.mesh.rotation.z = Math.sin(t.pulse * Math.PI * 3) * t.pulse * 0.06;
      }
    }
    const rovingLamp = this.rovingId ? this.lampForTarget(this.rovingId) : null;
    let li = 0;
    for (const [id, lamp] of this.lamps) {
      let k = LAMP_DIM;
      if (lamp.state === 'on') k = 1;
      else if (lamp.state === 'blink') k = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(this.time * 7 + lamp.phase));
      if (rovingLamp === id) k = 0.6 + 0.9 * (0.5 + 0.5 * Math.sin(this.time * 22));
      lamp.material.color.copy(lamp.color).multiplyScalar(k);
      const glow = Math.max(0, k - LAMP_DIM) / (1 - LAMP_DIM);
      this.halos.setColorAt(li++, this.tmpColor.copy(lamp.color).multiplyScalar(glow * 0.6));
    }
    // Chasers: a wave runs up each row; a flare lights them all.
    this.flareT = Math.max(0, this.flareT - dt);
    const flare = Math.min(1, this.flareT);
    CHASER_LAMPS.forEach((c, i) => {
      const wave = Math.pow(Math.max(0, Math.sin(this.time * 5 - (c.group === 2 ? i * 0.55 : c.y * 0.9))), 6);
      const k = Math.max(0.34 + wave * 0.66, flare * (0.6 + 0.4 * Math.sin(this.time * 24 + i)));
      this.chasers.setColorAt(i, this.tmpColor.copy(this.chaserColor).multiplyScalar(k));
      this.halos.setColorAt(li + i, this.tmpColor.copy(this.chaserColor).multiplyScalar(Math.max(0, k - 0.34) * 0.9));
    });
    this.chasers.instanceColor!.needsUpdate = true;
    this.halos.instanceColor!.needsUpdate = true;
    this.plungerKnob.position.z += ((this.plungerCharge * 1.8 + toWorld(0, 0.6).z) - this.plungerKnob.position.z) * Math.min(1, dt * 16);
  }
}
