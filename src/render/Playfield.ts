import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World } from '../physics/World';
import type { Vec2 } from '../physics/Vec2';
import { TABLE, type TableDef, type WallDef } from '../table/layout';
import type { LampState } from '../game/events';
import { toWorld } from './space';
import { createBannerTexture, createMetalTexture, createPlayfieldTexture, createWoodTexture, type Theme } from './textures';

interface BumperView {
  group: THREE.Group;
  cap: THREE.Mesh;
  ring: THREE.Mesh;
  pulse: number;
}
interface TargetView {
  mesh: THREE.Mesh;
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
  private glass!: THREE.Mesh;
  private time = 0;
  readonly backboxFace: THREE.Mesh;

  constructor(
    private def: TableDef,
    private world: World,
    private theme: Theme,
    private envMap: THREE.Texture | null,
    private quality: Quality,
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
    this.backboxFace = this.buildCabinet(scoreboardTexture);
  }

  // ------------------------------------------------------------------ materials

  private buildMaterials(): void {
    const wood = createWoodTexture(this.theme.cabinet, this.theme.cabinetDark);
    wood.repeat.set(2, 6);
    this.woodMaterial = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.05, envMap: this.envMap, envMapIntensity: 0.4 });
    const metal = createMetalTexture();
    metal.repeat.set(4, 1);
    this.railMaterial = new THREE.MeshStandardMaterial({ color: this.theme.rail, map: metal, metalness: this.theme.railMetalness, roughness: 0.3, envMap: this.envMap, envMapIntensity: 1.1 });
    this.plasticMaterial = new THREE.MeshStandardMaterial({ color: this.theme.accent2, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.85, envMap: this.envMap, envMapIntensity: 0.5 });
    this.playfieldMaterial = new THREE.MeshStandardMaterial({ map: createPlayfieldTexture(this.def, this.theme), roughness: 0.6, metalness: 0.05, envMap: this.envMap, envMapIntensity: 0.25 });
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    const wood = createWoodTexture(theme.cabinet, theme.cabinetDark);
    wood.repeat.set(2, 6);
    this.woodMaterial.map?.dispose();
    this.woodMaterial.map = wood;
    this.woodMaterial.needsUpdate = true;
    this.railMaterial.color.set(theme.rail);
    this.railMaterial.metalness = theme.railMetalness;
    this.plasticMaterial.color.set(theme.accent2);
    this.playfieldMaterial.map?.dispose();
    this.playfieldMaterial.map = createPlayfieldTexture(this.def, theme);
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
    add(byStyle.rubber, new THREE.MeshStandardMaterial({ color: 0xd84343, roughness: 0.9 }));
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
    const rings: THREE.BufferGeometry[] = [];
    for (const post of this.def.posts) {
      const p = toWorld(post.pos.x, post.pos.y);
      const base = new THREE.CylinderGeometry(post.radius * 0.7, post.radius * 0.7, 1.0, 10);
      base.translate(p.x, 0.5, p.z);
      bases.push(base);
      const ring = new THREE.TorusGeometry(post.radius * 0.72, post.radius * 0.32, 6, 12);
      ring.rotateX(Math.PI / 2);
      ring.translate(p.x, 0.55, p.z);
      rings.push(ring);
    }
    const baseMesh = new THREE.Mesh(mergeGeometries(bases, false)!, this.railMaterial);
    baseMesh.castShadow = this.quality === 'high';
    const ringMesh = new THREE.Mesh(mergeGeometries(rings, false)!, new THREE.MeshStandardMaterial({ color: 0xd84343, roughness: 0.85 }));
    this.staticGroup.add(baseMesh, ringMesh);
    bases.forEach((g) => g.dispose());
    rings.forEach((g) => g.dispose());
  }

  private buildSlingshots(): void {
    const mat = new THREE.MeshStandardMaterial({ color: this.theme.accent, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.9 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0xd84343, roughness: 0.9 });
    for (const s of this.def.slingshots) {
      const shape = new THREE.Shape();
      const pts = s.points.map((p) => toWorld(p.x, p.y));
      shape.moveTo(pts[0].x, -pts[0].z);
      shape.lineTo(pts[1].x, -pts[1].z);
      shape.lineTo(pts[2].x, -pts[2].z);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = this.quality !== 'low';
      this.staticGroup.add(mesh);
      // Rubber band around the edges.
      for (let i = 0; i < 3; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 3];
        const band = new THREE.Mesh(segmentBox(a, b, 0.3, 0.22, 0.45), rubber);
        this.staticGroup.add(band);
      }
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
    const up = new THREE.Vector3(0, 1, 0);
    for (const ramp of this.def.ramps) {
      const pts = ramp.path.map((p) => toWorld(p.x, p.y, p.h + 0.02));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
      const n = 90;
      const left: THREE.Vector3[] = [];
      const right: THREE.Vector3[] = [];
      const ribbon: number[] = [];
      const ribbonIdx: number[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        const lateral = new THREE.Vector3().crossVectors(tan, up).normalize();
        if (lateral.lengthSq() < 1e-4) lateral.set(1, 0, 0);
        left.push(p.clone().addScaledVector(lateral, -0.42));
        right.push(p.clone().addScaledVector(lateral, 0.42));
        const l = p.clone().addScaledVector(lateral, -0.62);
        const r = p.clone().addScaledVector(lateral, 0.62);
        ribbon.push(l.x, l.y - 0.3, l.z, r.x, r.y - 0.3, r.z);
        if (i < n) {
          const k = i * 2;
          ribbonIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const railMat = this.railMaterial;
      for (const rail of [left, right]) {
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 120, 0.075, 6, false);
        const mesh = new THREE.Mesh(tube, railMat);
        mesh.castShadow = this.quality === 'high';
        this.staticGroup.add(mesh);
      }
      // Translucent plastic ramp floor (keeps the ball visibly "on" the ramp).
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(ribbon, 3));
      rg.setIndex(ribbonIdx);
      rg.computeVertexNormals();
      const ribbonMat = new THREE.MeshStandardMaterial({ color: ramp.color, transparent: true, opacity: 0.28, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false, envMap: this.envMap, envMapIntensity: 0.6 });
      const ribbonMesh = new THREE.Mesh(rg, ribbonMat);
      this.staticGroup.add(ribbonMesh);
      // Supports every few samples where the ramp is elevated.
      const supports: THREE.BufferGeometry[] = [];
      for (let i = 6; i < n; i += 9) {
        const p = curve.getPointAt(i / n);
        if (p.y < 0.6) continue;
        const g = new THREE.CylinderGeometry(0.06, 0.06, p.y - 0.3, 6);
        g.translate(p.x, (p.y - 0.3) / 2, p.z);
        supports.push(g);
      }
      if (supports.length) {
        const sm = new THREE.Mesh(mergeGeometries(supports, false)!, railMat);
        this.staticGroup.add(sm);
        supports.forEach((g) => g.dispose());
      }
    }
  }

  // ------------------------------------------------------------------ dynamic elements

  private buildBumpers(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b2a5a, roughness: 0.5 });
    for (const b of this.def.bumpers) {
      const group = new THREE.Group();
      const p = toWorld(b.pos.x, b.pos.y);
      group.position.set(p.x, 0, p.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(b.radius, b.radius * 1.05, 0.25, 24), bodyMat);
      base.position.y = 0.125;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 0.55, b.radius * 0.7, 1.1, 20), bodyMat);
      body.position.y = 0.8;
      const capMat = new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0xff2222, emissiveIntensity: 0.25, roughness: 0.3, envMap: this.envMap, envMapIntensity: 0.6 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.radius * 1.02, b.radius * 0.9, 0.35, 24), capMat);
      cap.position.y = 1.45;
      cap.castShadow = this.quality !== 'low';
      const ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1a8, emissiveIntensity: 0.6, roughness: 0.3 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(b.radius * 0.8, 0.12, 8, 32), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.25;
      // Baseball-stitch decal on the cap: a flat white disc with red arcs.
      const disc = new THREE.Mesh(new THREE.CircleGeometry(b.radius * 0.75, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 1.63;
      group.add(base, body, cap, ring, disc);
      this.group.add(group);
      this.bumpers.set(b.id, { group, cap, ring, pulse: 0 });
    }
  }

  private buildTargets(): void {
    for (const t of this.def.targets) {
      const a = toWorld(t.a.x, t.a.y);
      const b = toWorld(t.b.x, t.b.y);
      const len = a.distanceTo(b);
      const color = t.bank === 'bases' ? 0xfff176 : t.bank === 'leftField' ? 0x4fe3ff : 0xff8a3b;
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 });
      const geo = new THREE.BoxGeometry(len * 0.92, t.kind === 'drop' ? 1.0 : 1.1, 0.22);
      const mesh = new THREE.Mesh(geo, mat);
      const d = new THREE.Vector3().subVectors(b, a);
      mesh.rotation.y = Math.atan2(-d.z, d.x);
      const baseY = t.kind === 'drop' ? 0.5 : 0.55;
      mesh.position.set((a.x + b.x) / 2, baseY, (a.z + b.z) / 2);
      mesh.castShadow = this.quality === 'high';
      this.group.add(mesh);
      this.targets.set(t.id, { mesh, down: false, t: 0, baseY, pulse: 0 });
    }
  }

  private buildLamps(): void {
    for (const lamp of this.def.lamps) {
      const color = new THREE.Color(lamp.color);
      const material = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.12), toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.36, 18), material);
      mesh.rotation.x = -Math.PI / 2;
      const p = toWorld(lamp.pos.x, lamp.pos.y, 0.035);
      mesh.position.copy(p);
      this.group.add(mesh);
      this.lamps.set(lamp.id, { mesh, material, color, state: 'off', phase: Math.random() * 6 });
    }
  }

  private buildFlippers(): void {
    const rubber = new THREE.MeshStandardMaterial({ color: 0xe03a3a, roughness: 0.6, metalness: 0.05 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xfff0b3, roughness: 0.5 });
    for (const f of this.def.flippers) {
      const group = new THREE.Group();
      const p = toWorld(f.pivot.x, f.pivot.y);
      group.position.set(p.x, 0, p.z);
      const shape = new THREE.Shape();
      const rb = f.baseRadius;
      const rt = f.tipRadius;
      const L = f.length;
      shape.absarc(0, 0, rb, Math.PI / 2, (3 * Math.PI) / 2, false);
      shape.lineTo(L, -rt);
      shape.absarc(L, 0, rt, -Math.PI / 2, Math.PI / 2, false);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
      const mesh = new THREE.Mesh(geo, rubber);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = this.quality !== 'low';
      group.add(mesh);
      const top = new THREE.Mesh(new THREE.BoxGeometry(L * 0.8, 0.06, 0.22), stripe);
      top.position.set(L * 0.45, 0.88, 0);
      group.add(top);
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

  worldPoint(p: Vec2, h = 0.5): THREE.Vector3 {
    return toWorld(p.x, p.y, h);
  }

  update(dt: number): void {
    this.time += dt;
    for (const [id, group] of this.flipperGroups) {
      const f = this.world.flippers.get(id);
      if (f) group.rotation.y = f.angle;
    }
    for (const b of this.bumpers.values()) {
      if (b.pulse > 0) {
        b.pulse = Math.max(0, b.pulse - dt * 4);
        const s = 1 + Math.sin(b.pulse * Math.PI) * 0.18;
        b.cap.scale.set(s, 1, s);
        (b.cap.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + b.pulse * 2.2;
        (b.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + b.pulse * 3;
      }
    }
    for (const t of this.targets.values()) {
      const targetY = t.down ? t.baseY - 1.05 : t.baseY;
      t.mesh.position.y += (targetY - t.mesh.position.y) * Math.min(1, dt * 14);
      if (t.pulse > 0) {
        t.pulse = Math.max(0, t.pulse - dt * 5);
        (t.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + t.pulse * 1.6;
      }
    }
    for (const lamp of this.lamps.values()) {
      let k = 0.12;
      if (lamp.state === 'on') k = 1;
      else if (lamp.state === 'blink') k = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(this.time * 7 + lamp.phase));
      lamp.material.color.copy(lamp.color).multiplyScalar(k);
    }
    this.plungerKnob.position.z += ((this.plungerCharge * 1.8 + toWorld(0, 0.6).z) - this.plungerKnob.position.z) * Math.min(1, dt * 16);
  }
}
