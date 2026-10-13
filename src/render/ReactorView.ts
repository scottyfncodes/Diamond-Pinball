import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { TableDef } from '../table/layout';
import { RING_COUNT } from '../attractions/reactor';
import { SmoothPose } from './CameraRig';
import type { Quality } from './Playfield';
import { toWorld } from './space';

const SEGMENTS = 16;
const RINGS = [
  { r: 1.25, h: 2.35, speed: 0.6 },
  { r: 1.7, h: 2.95, speed: -0.45 },
  { r: 2.15, h: 3.55, speed: 0.32 },
];
const COLD = new THREE.Color(0x1d3346);
const CHARGED = [new THREE.Color(0x4dfff3), new THREE.Color(0x7cb8ff), new THREE.Color(0xc77dff)];
const HOT = new THREE.Color(0xffffff);

/**
 * THE REACTOR CORE: a gyroscopic energy chamber in the middle of the pop
 * bumpers. Three containment rings light segment by segment as the table
 * charges them, conduits flash from every bumper, the iris opens when the core
 * is ready and the overload pulses race around the outer ring to the sync gate.
 */
export class ReactorView {
  readonly group = new THREE.Group();
  private rings: THREE.Group[] = [];
  private segments: THREE.InstancedMesh;
  private core: THREE.Mesh;
  private coreMat: THREE.MeshStandardMaterial;
  private iris: THREE.Mesh[] = [];
  private conduits: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; spark: THREE.Mesh; t: number; from: THREE.Vector3; to: THREE.Vector3 }> = [];
  private gate: THREE.Mesh;
  private gateMat: THREE.MeshBasicMaterial;
  private pulseOrbs: THREE.Mesh[] = [];
  private light: THREE.PointLight | null = null;
  private corePos: THREE.Vector3;
  private time = 0;
  private open = 0;
  private flash = 0;
  private spin = 1;
  private segColor = new THREE.Color();
  private dirty = true;
  private cam = new SmoothPose(3.2);
  private camAngle = 0;
  private outcomeT = -1;
  private gateAngle = Math.PI / 2;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private game: Game, table: TableDef, private quality: Quality, private toScene: (v: THREE.Vector3) => THREE.Vector3) {
    const c = table.attractions.reactor.core;
    this.corePos = toWorld(c.x, c.y, 0);
    this.group.position.copy(this.corePos);
    const metal = new THREE.MeshStandardMaterial({ color: 0x8794a8, metalness: 0.85, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1018, metalness: 0.4, roughness: 0.6 });

    // Pit, collar and iris blades.
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.05, 32), dark);
    pit.position.y = 0.02;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.1, 8, 40), metal);
    collar.rotation.x = -Math.PI / 2;
    collar.position.y = 0.08;
    this.group.add(pit, collar);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3a4658, metalness: 0.8, roughness: 0.35 });
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(new THREE.CircleGeometry(0.62, 3, 0, Math.PI / 3 + 0.12), bladeMat);
      blade.rotation.x = -Math.PI / 2;
      blade.rotation.z = (i / 6) * Math.PI * 2;
      blade.position.y = 0.07;
      this.group.add(blade);
      this.iris.push(blade);
    }
    // The core: hidden in the pit until it is charged, then it rises and burns.
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x9ffcff, emissive: 0x4dfff3, emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.92 });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), this.coreMat);
    this.core.position.y = -0.3;
    this.group.add(this.core);
    // Central mast with pylons holding the rings.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.9, 8), metal);
    mast.position.y = 1.95 + 0.3;
    this.group.add(mast);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 10), metal);
    cap.position.y = 4.45;
    this.group.add(cap);
    // Containment rings (frame) + lit segments (one instanced mesh for all three).
    const segGeo = new THREE.BoxGeometry(0.34, 0.12, 0.12);
    this.segments = new THREE.InstancedMesh(segGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), SEGMENTS * RING_COUNT);
    const m = new THREE.Matrix4();
    for (let r = 0; r < RING_COUNT; r++) {
      const ring = new THREE.Group();
      ring.position.y = RINGS[r].h;
      const frame = new THREE.Mesh(new THREE.TorusGeometry(RINGS[r].r, 0.045, 6, 48), metal);
      frame.rotation.x = Math.PI / 2;
      ring.add(frame);
      // Spokes to the mast.
      for (let k = 0; k < 3; k++) {
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, RINGS[r].r, 5), metal);
        spoke.rotation.z = Math.PI / 2;
        spoke.rotation.y = (k / 3) * Math.PI * 2 + r;
        spoke.position.set(Math.cos(-spoke.rotation.y) * RINGS[r].r * 0.5, 0, Math.sin(-spoke.rotation.y) * RINGS[r].r * 0.5);
        ring.add(spoke);
      }
      this.group.add(ring);
      this.rings.push(ring);
      for (let i = 0; i < SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        m.makeRotationY(-a + Math.PI / 2);
        m.setPosition(Math.cos(a) * RINGS[r].r, RINGS[r].h, Math.sin(a) * RINGS[r].r);
        this.segments.setMatrixAt(r * SEGMENTS + i, m);
        this.segments.setColorAt(r * SEGMENTS + i, COLD);
      }
    }
    this.segments.instanceMatrix.needsUpdate = true;
    this.group.add(this.segments);
    // The sync gate: a bright bracket on the outer ring, facing the player.
    this.gateMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, toneMapped: false, transparent: true, opacity: 0.25 });
    this.gate = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 6, 20), this.gateMat);
    const outer = RINGS[RING_COUNT - 1];
    this.gate.position.set(Math.cos(this.gateAngle) * outer.r, outer.h, Math.sin(this.gateAngle) * outer.r);
    this.group.add(this.gate);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    for (let i = 0; i < 5; i++) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), orbMat.clone());
      orb.visible = false;
      this.group.add(orb);
      this.pulseOrbs.push(orb);
    }
    // Conduits: bumper -> core strips that flash on every bumper hit.
    for (const b of table.bumpers) {
      const from = toWorld(b.pos.x, b.pos.y, 0).sub(this.corePos);
      const to = new THREE.Vector3(0, 0, 0);
      const dir = to.clone().sub(from);
      const len = dir.length() - 2.1;
      const mat = new THREE.MeshBasicMaterial({ color: 0x1f6f78, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, len), mat);
      const mid = from.clone().addScaledVector(dir.clone().normalize(), 1.25 + len / 2);
      mesh.position.set(mid.x, 0.03, mid.z);
      mesh.rotation.y = Math.atan2(dir.x, dir.z);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xbffcff, toneMapped: false }));
      spark.visible = false;
      this.group.add(mesh, spark);
      this.conduits.push({ mesh, mat, spark, t: -1, from: from.clone().addScaledVector(dir.clone().normalize(), 1.25).setY(0.12), to: new THREE.Vector3(0, 0.12, 0) });
    }
    if (quality !== 'low') {
      this.light = new THREE.PointLight(0x4dfff3, 0, 14, 2);
      this.light.position.y = 1.8;
      this.group.add(this.light);
    }
  }

  /** A bumper fired: energy runs down its conduit into the core. */
  bumperHit(id: string): void {
    const i = this.game.table.bumpers.findIndex((b) => b.id === id);
    const c = this.conduits[i];
    if (c) c.t = 0;
  }

  chargeChanged(): void {
    this.dirty = true;
    this.flash = Math.max(this.flash, 0.35);
  }

  /** Big moment: ring complete, core open, synced pulse. */
  pulse(amount = 1): void {
    this.flash = Math.max(this.flash, amount);
    this.dirty = true;
  }

  outcome(): void {
    this.outcomeT = 0;
    this.flash = 1.6;
    this.dirty = true;
  }

  /** Overload camera: a slow orbit that tightens and speeds up with every pulse, then pulls up for the climax. */
  readonly cameraPose = (dt: number, pos: THREE.Vector3, target: THREE.Vector3, t: number): void => {
    const o = this.game.reactor.overload;
    const progress = o ? o.pulses.filter((p) => p.judged).length / o.pulses.length : 1;
    this.camAngle += dt * (0.35 + progress * 0.9);
    const climax = this.outcomeT >= 0 ? Math.min(1, this.outcomeT / 1.2) : 0;
    const r = 7.2 - progress * 1.6 + climax * 3;
    const h = 4.6 + climax * 4;
    // Orbit the front half only, so the sync gate is always in sight.
    const a = Math.PI / 2 + Math.sin(this.camAngle) * 0.85;
    this.tmp.set(Math.cos(a) * r, h, Math.sin(a) * r).add(this.corePos);
    this.tmp2.set(0, 2.3 + climax * 0.6, 0).add(this.corePos);
    this.cam.follow(dt, this.toScene(this.tmp), this.toScene(this.tmp2), t < 0.05 ? 1000 : 3.5);
    pos.copy(this.cam.pos);
    target.copy(this.cam.target);
  };

  resetCamera(): void {
    this.cam.reset();
    this.camAngle = 0;
    this.outcomeT = -1;
  }

  update(dt: number): void {
    this.time += dt;
    const r = this.game.reactor;
    const ready = r.ready || !!r.overload;
    const critical = r.critical > 0;
    this.open += ((ready ? 1 : 0) - this.open) * Math.min(1, dt * 3);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.4);
    if (this.outcomeT >= 0) this.outcomeT += dt;
    // Ring spin accelerates with charge; a running overload makes them gyroscope.
    const charge = (r.charge[0] + r.charge[1] + r.charge[2]) / 3;
    const target = 0.4 + charge * 2.2 + (r.overload ? 3 : 0) + (critical ? 4 : 0);
    this.spin += (target - this.spin) * Math.min(1, dt * 1.5);
    this.rings.forEach((ring, i) => {
      ring.rotation.y += dt * RINGS[i].speed * this.spin;
      const wobble = r.overload || critical ? 0.35 : ready ? 0.15 : 0;
      ring.rotation.x = Math.sin(this.time * (1.3 + i * 0.4) + i) * wobble;
      ring.rotation.z = Math.cos(this.time * (1.1 + i * 0.3)) * wobble;
    });
    // Iris blades slide back, the core rises and burns brighter as the overload runs.
    this.iris.forEach((b, i) => {
      const base = (i / 6) * Math.PI * 2;
      b.rotation.z = base + this.open * 0.9;
      b.scale.setScalar(1 - this.open * 0.55);
    });
    const overloadHeat = r.overload ? r.overload.syncs / 5 : 0;
    this.core.position.y = -0.3 + this.open * 1.45 + Math.sin(this.time * 3) * 0.06 * this.open;
    this.core.rotation.y += dt * (1 + this.spin);
    this.core.rotation.x += dt * 0.7;
    const s = 0.7 + this.open * 0.4 + overloadHeat * 0.5 + this.flash * 0.25 + (critical ? 0.3 : 0);
    this.core.scale.setScalar(s);
    this.coreMat.emissiveIntensity = 0.4 + this.open * 1.4 + this.flash * 3 + overloadHeat * 2 + (critical ? 2 + Math.sin(this.time * 18) : 0);
    this.coreMat.emissive.copy(critical || overloadHeat > 0.75 ? HOT : CHARGED[0]);
    if (this.light) this.light.intensity = (this.open * 6 + this.flash * 30 + (critical ? 10 : 0)) * (this.quality === 'high' ? 1 : 0.7);
    // Segments: charge fill per ring; everything strobes while critical.
    if (this.dirty || critical || ready) {
      this.dirty = false;
      for (let ri = 0; ri < RING_COUNT; ri++) {
        const lit = Math.round(r.charge[ri] * SEGMENTS);
        for (let i = 0; i < SEGMENTS; i++) {
          const on = i < lit;
          if (critical) this.segColor.copy(HOT).lerp(CHARGED[ri], 0.5 + 0.5 * Math.sin(this.time * 14 + i));
          else if (on) this.segColor.copy(CHARGED[ri]).multiplyScalar(ready ? 0.8 + 0.4 * Math.sin(this.time * 6 + i * 0.4) : 1 + this.flash);
          else this.segColor.copy(COLD);
          this.segments.setColorAt(ri * SEGMENTS + i, this.segColor);
        }
      }
      if (this.segments.instanceColor) this.segments.instanceColor.needsUpdate = true;
    }
    // Conduits.
    for (const c of this.conduits) {
      if (c.t >= 0) {
        c.t += dt * 3.2;
        c.spark.visible = c.t < 1;
        c.spark.position.lerpVectors(c.from, c.to, Math.min(1, c.t));
        c.mat.color.setHex(0x1f6f78).lerp(CHARGED[0], Math.max(0, 1 - c.t));
        if (c.t >= 1) c.t = -1;
      } else if (critical) c.mat.color.copy(HOT).multiplyScalar(0.5 + 0.5 * Math.sin(this.time * 12));
      else c.mat.color.setHex(ready ? 0x2fbfc8 : 0x1f6f78);
    }
    // Overload pulses: each orb races once around the outer ring to arrive at the gate on its beat.
    const o = r.overload;
    const outer = RINGS[RING_COUNT - 1];
    this.gateMat.opacity = o ? 0.6 + 0.4 * Math.sin(this.time * 10) : ready ? 0.45 : 0.15;
    this.pulseOrbs.forEach((orb, i) => {
      const p = o?.pulses[i];
      if (!o || !p || (p.judged && o.t > p.at + 0.25) || o.t < p.at - p.lap) {
        orb.visible = false;
        return;
      }
      orb.visible = true;
      const k = (p.at - o.t) / p.lap; // 1 = just launched, 0 = at the gate
      const a = this.gateAngle - k * Math.PI * 2;
      // Outer ring rotates; orbs are placed in the reactor frame, so undo nothing: ride the frame.
      orb.position.set(Math.cos(a) * outer.r, outer.h, Math.sin(a) * outer.r);
      const mat = orb.material as THREE.MeshBasicMaterial;
      if (p.judged) mat.color.setHex(p.hit ? 0x7cff5a : 0xff4d4d);
      else mat.color.setHex(Math.abs(o.t - p.at) <= o.window ? 0xffe14d : 0xffffff);
      orb.scale.setScalar(p.judged ? 1.6 : 1 + Math.max(0, 0.6 - Math.abs(k) * 2));
    });
  }

  /** World-space position of the core (for effects). */
  coreLocal(out: THREE.Vector3, h = 1.5): THREE.Vector3 {
    return out.copy(this.corePos).setY(h);
  }
}
