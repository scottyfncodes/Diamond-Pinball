import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TableDef } from '../table/layout';
import { labelTexture } from './SandlotView';
import type { Quality } from './Playfield';
import { toWorld } from './space';

type Deck = TableDef['attractions']['midway']['deck'];

/** Wraps a curve parameter into [0, 1). */
const wrap01 = (x: number): number => ((x % 1) + 1) % 1;

const BULB_COLORS = [0xff4d6d, 0xffe14d, 0x4dfff3, 0x7cff5a, 0xc77dff, 0xffb13b];

/**
 * THE MIDWAY: an amusement park on the right wing of the cabinet. A Ferris
 * wheel, a looping roller coaster, a carousel and string lights. It lives on
 * its own and reacts to the table: locks launch the coaster, multiball turns
 * the whole park up to eleven, jackpots light the wheel.
 */
export class MidwayView {
  readonly group = new THREE.Group();
  private h: number;
  private wheel: THREE.Group;
  private gondolas: THREE.Object3D[] = [];
  private bulbs: THREE.InstancedMesh;
  private bulbColor = new THREE.Color();
  private coasterCurve: THREE.CatmullRomCurve3;
  private coasterLen: number;
  private train: THREE.Group[] = [];
  private coasterS = 0;
  private coasterBoost = 0;
  private carousel: THREE.Group;
  private horses: THREE.Object3D[] = [];
  private stringLights: THREE.InstancedMesh;
  private time = 0;
  private party = 0;
  private flash = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private m = new THREE.Matrix4();

  constructor(deck: Deck, private quality: Quality) {
    this.h = deck.h;
    this.buildDeck(deck);
    this.wheel = this.buildWheel();
    this.bulbs = this.buildWheelBulbs();
    const coaster = this.buildCoaster();
    this.coasterCurve = coaster;
    this.coasterLen = coaster.getLength();
    this.carousel = this.buildCarousel();
    this.stringLights = this.buildStringLights();
    this.buildTents();
  }

  private w(x: number, y: number, h = this.h): THREE.Vector3 {
    return toWorld(x, y, h);
  }

  private buildDeck(d: Deck): void {
    const a = this.w(d.minX, d.maxY, 0);
    const b = this.w(d.maxX, d.minY, 0);
    const width = b.x - a.x;
    const depth = b.z - a.z;
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, d.h + 4.5, depth), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.6 }));
    box.position.set(a.x + width / 2, (d.h - 4.5) / 2 - 0.01, a.z + depth / 2);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.18, depth + 0.3), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.35 }));
    lip.position.set(box.position.x, d.h - 0.12, box.position.z);
    const c = document.createElement('canvas');
    const S = 32;
    c.width = Math.round(width * S);
    c.height = Math.round(depth * S);
    const g = c.getContext('2d')!;
    // Boardwalk planks under the midway lights, and a winding gold path.
    g.fillStyle = '#3a2a1f';
    g.fillRect(0, 0, c.width, c.height);
    for (let x = 0, i = 0; x < c.width; x += 12, i++) {
      g.fillStyle = i % 3 === 0 ? 'rgba(255,220,170,0.06)' : i % 3 === 1 ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.04)';
      g.fillRect(x, 0, 12, c.height);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, 0, 1, c.height);
      for (let y = (i * 37) % 90; y < c.height; y += 90) g.fillRect(x, y, 12, 1);
    }
    g.strokeStyle = '#c9a25a';
    g.lineWidth = 22;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(c.width * 0.5, c.height);
    g.bezierCurveTo(c.width * 0.1, c.height * 0.7, c.width * 0.9, c.height * 0.4, c.width * 0.45, 0);
    g.stroke();
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(box.position.x, d.h + 0.01, box.position.z);
    ground.receiveShadow = true;
    // Entrance sign.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.6), new THREE.MeshBasicMaterial({ map: labelTexture('THE MIDWAY', '#ff4d6d', '#1a0610'), toneMapped: false, side: THREE.DoubleSide }));
    sign.position.copy(this.w(27.2, 2.2, this.h + 2.0));
    const signMat = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.3 });
    for (const x of [25.5, 28.9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.0, 0.14), signMat);
      post.position.copy(this.w(x, 2.2, this.h + 1.0));
      this.group.add(post);
    }
    this.group.add(box, lip, ground, sign);
  }

  private buildWheel(): THREE.Group {
    const center = this.w(28.4, 21.5, this.h + 4.1);
    const R = 3.0;
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.7, roughness: 0.3 });
    // A-frame legs.
    const legs: THREE.BufferGeometry[] = [];
    for (const dz of [-0.45, 0.45]) {
      for (const dx of [-1.7, 1.7]) {
        const from = new THREE.Vector3(center.x + dx, this.h, center.z + dz);
        const to = new THREE.Vector3(center.x, center.y, center.z + dz);
        const len = from.distanceTo(to);
        const g = new THREE.CylinderGeometry(0.07, 0.09, len, 6);
        g.translate(0, len / 2, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        g.applyQuaternion(q);
        g.translate(from.x, from.y, from.z);
        legs.push(g);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(legs, false)!, steel));
    legs.forEach((g) => g.dispose());
    const wheel = new THREE.Group();
    wheel.position.copy(center);
    for (const dz of [-0.35, 0.35]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 6, 48), steel);
      rim.position.z = dz;
      wheel.add(rim);
    }
    const spokes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const dz of [-0.35, 0.35]) {
        const g = new THREE.CylinderGeometry(0.025, 0.025, R, 4);
        g.translate(0, R / 2, 0);
        g.rotateZ(a);
        g.translate(0, 0, dz);
        spokes.push(g);
      }
    }
    wheel.add(new THREE.Mesh(mergeGeometries(spokes, false)!, steel));
    spokes.forEach((g) => g.dispose());
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), steel);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    const cabColors = [0xff4d6d, 0x4dfff3, 0xffe14d, 0x7cff5a, 0xc77dff, 0xffb13b];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pivot = new THREE.Object3D();
      pivot.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.5), new THREE.MeshStandardMaterial({ color: cabColors[i % cabColors.length], roughness: 0.4 }));
      cab.position.y = -0.3;
      pivot.add(cab);
      wheel.add(pivot);
      this.gondolas.push(pivot);
    }
    this.group.add(wheel);
    return wheel;
  }

  private buildWheelBulbs(): THREE.InstancedMesh {
    const n = 36;
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.m.makeTranslation(Math.cos(a) * 3.08, Math.sin(a) * 3.08, 0.42);
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, this.bulbColor.set(BULB_COLORS[i % BULB_COLORS.length]));
    }
    this.wheel.add(mesh);
    return mesh;
  }

  private buildCoaster(): THREE.CatmullRomCurve3 {
    // Table-space control points: station, chain lift, first drop, a vertical loop, helix home.
    const pts: Array<[number, number, number]> = [
      [24.2, 4.5, 0.7],
      [24.0, 9.0, 0.9],
      [24.0, 13.5, 2.6],
      [24.3, 17.0, 4.6],
      [25.0, 19.0, 5.0],
      [26.0, 20.5, 4.2],
      [26.4, 22.5, 1.0],
    ];
    // Vertical loop in the y-h plane, drifting sideways so the track clears itself.
    const lc = { y: 25.5, h: 2.6, r: 1.7 };
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      pts.push([26.6 + (i / 10) * 1.6, lc.y + Math.cos(a) * lc.r, lc.h + Math.sin(a) * lc.r + 0.2]);
    }
    pts.push([29.0, 28.5, 1.4], [30.9, 27.0, 1.8], [31.0, 20.0, 1.6], [30.9, 12.0, 1.0], [30.2, 6.0, 1.2], [28.0, 3.6, 0.8], [25.5, 3.4, 0.7]);
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, h]) => this.w(x, y, this.h + h)), true, 'catmullrom', 0.4);
    const n = 260;
    const up = new THREE.Vector3(0, 1, 0);
    const railL: THREE.Vector3[] = [];
    const railR: THREE.Vector3[] = [];
    const ties: THREE.BufferGeometry[] = [];
    const supports: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t % 1);
      const tan = curve.getTangentAt(t % 1);
      const lat = new THREE.Vector3().crossVectors(tan, up);
      if (lat.lengthSq() < 1e-3) lat.set(1, 0, 0);
      lat.normalize();
      railL.push(p.clone().addScaledVector(lat, 0.22));
      railR.push(p.clone().addScaledVector(lat, -0.22));
      if (i % 3 === 0) {
        const tie = new THREE.BoxGeometry(0.56, 0.04, 0.08);
        tie.rotateY(Math.atan2(-lat.z, lat.x));
        tie.translate(p.x, p.y - 0.05, p.z);
        ties.push(tie);
      }
      if (i % 10 === 0 && p.y - this.h > 0.6) {
        const g = new THREE.CylinderGeometry(0.05, 0.05, p.y - this.h, 5);
        g.translate(p.x, (p.y + this.h) / 2 - 0.05, p.z);
        supports.push(g);
      }
    }
    const railMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d, metalness: 0.5, roughness: 0.35 });
    for (const rail of [railL, railR]) this.group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail, true), 320, 0.05, 5, true), railMat));
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xe8e3d4, roughness: 0.6 });
    this.group.add(new THREE.Mesh(mergeGeometries(ties, false)!, woodMat));
    this.group.add(new THREE.Mesh(mergeGeometries(supports, false)!, new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 0.6, roughness: 0.4 })));
    ties.forEach((g) => g.dispose());
    supports.forEach((g) => g.dispose());
    // The train: three cars.
    const carGeo = new THREE.BoxGeometry(0.4, 0.26, 0.55);
    const colors = [0xffe14d, 0x4dfff3, 0x7cff5a];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const car = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.4, metalness: 0.2 }));
      car.position.y = 0.12;
      car.castShadow = this.quality === 'high';
      const riders = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.12, 2, 5), new THREE.MeshStandardMaterial({ color: 0xf2a65a }));
      riders.position.y = 0.34;
      g.add(car, riders);
      this.group.add(g);
      this.train.push(g);
    }
    return curve;
  }

  private buildCarousel(): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(this.w(25.6, 27.4));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.6, roughness: 0.4 }));
    base.position.y = 0.1;
    const canopyTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 32;
      const ctx = c.getContext('2d')!;
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 ? '#ff4d6d' : '#fff3e0';
        ctx.fillRect(i * 16, 0, 16, 32);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.75, 0.9, 16, 1, true), new THREE.MeshStandardMaterial({ map: canopyTex, side: THREE.DoubleSide, roughness: 0.6 }));
    canopy.position.y = 2.1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.0, 8), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8 }));
    pole.position.y = 1.0;
    g.add(base, canopy, pole);
    const horseMat = new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.5 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const holder = new THREE.Object3D();
      holder.position.set(Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8 }));
      rod.position.y = 0.95;
      const horse = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.42), horseMat);
      horse.position.y = 0.7;
      horse.rotation.y = -a;
      holder.add(rod, horse);
      g.add(holder);
      this.horses.push(horse);
    }
    this.group.add(g);
    return g;
  }

  private buildStringLights(): THREE.InstancedMesh {
    const lines: Array<[number, number, number, number]> = [
      [23.2, 6, 31.4, 6],
      [23.2, 16, 31.4, 16],
      [23.4, 30.8, 31.2, 30.8],
    ];
    const per = 14;
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 5, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), lines.length * per);
    let k = 0;
    for (const [x0, y0, x1, y1] of lines) {
      for (let i = 0; i < per; i++) {
        const t = i / (per - 1);
        const sag = Math.sin(t * Math.PI) * 0.45;
        const p = this.w(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, this.h + 2.6 - sag);
        this.m.makeTranslation(p.x, p.y, p.z);
        mesh.setMatrixAt(k, this.m);
        mesh.setColorAt(k, this.bulbColor.set(BULB_COLORS[k % BULB_COLORS.length]));
        k++;
      }
      for (const x of [x0, x1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5), new THREE.MeshStandardMaterial({ color: 0x3a3f4b }));
        post.position.copy(this.w(x, y0, this.h + 1.3));
        this.group.add(post);
      }
    }
    this.group.add(mesh);
    return mesh;
  }

  private buildTents(): void {
    const spots: Array<[number, number, number]> = [
      [24.6, 10.2, 0xff4d6d],
      [29.8, 9.8, 0x4dfff3],
      [24.4, 14.6, 0xffe14d],
      [30.4, 31.0, 0x7cff5a],
    ];
    for (const [x, y, color] of spots) {
      const booth = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.7 }));
      booth.position.copy(this.w(x, y, this.h + 0.35));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.6, 4), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      roof.position.copy(this.w(x, y, this.h + 1.0));
      roof.rotation.y = Math.PI / 4;
      this.group.add(booth, roof);
    }
  }

  // ------------------------------------------------------------------ reactions

  /** A ball lock: the coaster is launched off the station. */
  launchCoaster(): void {
    this.coasterBoost = Math.max(this.coasterBoost, 4.5);
    this.flash = 1;
  }

  /** Multiball / Grand Tour: everything at full tilt. */
  celebrate(seconds = 8): void {
    this.party = Math.max(this.party, seconds);
    this.coasterBoost = Math.max(this.coasterBoost, seconds);
  }

  blink(): void {
    this.flash = 1;
  }

  /** A point above the Ferris wheel for fireworks (table-local). */
  skyPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.w(28.4, 21.5, this.h + 8));
  }

  update(dt: number): void {
    this.time += dt;
    if (this.party > 0) this.party -= dt;
    if (this.coasterBoost > 0) this.coasterBoost -= dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.5);
    const fast = this.party > 0 ? 2.4 : 1;
    this.wheel.rotation.z += dt * 0.12 * fast;
    for (const g of this.gondolas) g.rotation.z = -this.wheel.rotation.z;
    this.carousel.rotation.y += dt * 0.6 * fast;
    this.horses.forEach((h, i) => (h.position.y = 0.7 + Math.sin(this.time * 3 + i * 1.3) * 0.12));
    // Bulb chase: brighter and faster during parties.
    const n = this.bulbs.count;
    for (let i = 0; i < n; i++) {
      const on = (Math.floor(this.time * (this.party > 0 ? 14 : 4)) + i) % 3 === 0;
      const k = on ? 1 + this.flash * 2 : 0.25 + this.flash;
      this.bulbs.setColorAt(i, this.bulbColor.set(BULB_COLORS[i % BULB_COLORS.length]).multiplyScalar(k));
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    const sl = this.stringLights.count;
    for (let i = 0; i < sl; i++) {
      const k = 0.55 + 0.45 * Math.sin(this.time * (this.party > 0 ? 9 : 2) + i * 0.8) + this.flash;
      this.stringLights.setColorAt(i, this.bulbColor.set(BULB_COLORS[i % BULB_COLORS.length]).multiplyScalar(k));
    }
    if (this.stringLights.instanceColor) this.stringLights.instanceColor.needsUpdate = true;
    // Coaster: faster downhill, chain-lift slow uphill, boosted by locks and multiball.
    const p = this.coasterCurve.getPointAt(this.coasterS);
    const height = p.y - this.h;
    const speed = (0.9 + Math.max(0, 5 - height) * 0.55) * (this.coasterBoost > 0 ? 2.2 : 1);
    this.coasterS = wrap01(this.coasterS + (speed * Math.max(0, dt)) / this.coasterLen);
    this.train.forEach((car, i) => {
      const s = wrap01(this.coasterS - i * (0.62 / this.coasterLen));
      this.coasterCurve.getPointAt(s, this.tmp);
      this.coasterCurve.getTangentAt(s, this.tmp2);
      car.position.copy(this.tmp);
      car.lookAt(this.tmp.add(this.tmp2));
    });
  }
}

/**
 * The monorail: a train that circles the whole machine, gliding along the
 * city wing, over the backbox, down the midway and through a tunnel under the
 * playfield. It ties the miniature world together and carries big news.
 */
export class Monorail {
  readonly group = new THREE.Group();
  private curve: THREE.CatmullRomCurve3;
  private len: number;
  private cars: THREE.Group[] = [];
  private s = 0;
  private boost = 0;
  private lightMat: THREE.MeshBasicMaterial;
  private time = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(quality: Quality) {
    // A rounded rectangle hugging the wings and passing behind the stands, with a tunnel under the playfield.
    const pts: Array<[number, number, number]> = [
      [-10.7, 4.0, 4.4],
      [-10.7, 16.0, 4.8],
      [-10.7, 30.0, 5.4],
      [-10.2, 44.0, 6.2],
      [-7.0, 50.5, 6.6],
      [11.0, 51.5, 7.0],
      [29.0, 50.5, 6.6],
      [32.2, 44.0, 6.2],
      [32.7, 30.0, 5.4],
      [32.7, 16.0, 4.8],
      [32.7, 4.0, 4.4],
      [31.0, 0.6, 2.6],
      [28.6, -0.6, 0.6],
      [24.0, 1.5, -3.2],
      [11.0, 2.5, -3.6],
      [-2.0, 1.5, -3.2],
      [-6.6, -0.6, 0.6],
      [-9.0, 0.6, 2.6],
    ];
    this.curve = new THREE.CatmullRomCurve3(pts.map(([x, y, h]) => toWorld(x, y, h)), true, 'catmullrom', 0.5);
    this.len = this.curve.getLength();
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x5d6778, metalness: 0.7, roughness: 0.35 });
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(this.curve, 400, 0.12, 6, true), beamMat));
    // Pylons where the beam is in the open (decks and behind the backbox).
    const pylons: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 28; i++) {
      const p = this.curve.getPointAt(i / 28);
      if (p.y < 2) continue;
      const ground = p.z < -24 ? -7 : 1.2;
      const g = new THREE.CylinderGeometry(0.08, 0.1, p.y - ground, 6);
      g.translate(p.x, (p.y + ground) / 2, p.z);
      pylons.push(g);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(pylons, false)!, beamMat));
    pylons.forEach((g) => g.dispose());
    this.lightMat = new THREE.MeshBasicMaterial({ color: 0x9ffcff, toneMapped: false });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 0.4, roughness: 0.25 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x2c7be5, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.1, 4, 10), bodyMat);
      body.rotation.x = Math.PI / 2;
      body.position.y = 0.4;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.1, 1.2), stripeMat);
      stripe.position.y = 0.36;
      const windows = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 1.0), this.lightMat);
      windows.position.y = 0.52;
      g.add(body, stripe, windows);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = quality === 'high';
      });
      this.group.add(g);
      this.cars.push(g);
    }
  }

  /** Big news: the train speeds round with its lights flashing. */
  express(seconds = 6): void {
    this.boost = Math.max(this.boost, seconds);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.boost > 0) this.boost -= dt;
    const speed = this.boost > 0 ? 16 : 4.2;
    this.s = wrap01(this.s + (speed * Math.max(0, dt)) / this.len);
    this.lightMat.color.setHex(this.boost > 0 && Math.sin(this.time * 16) > 0 ? 0xffe14d : 0x9ffcff);
    this.cars.forEach((car, i) => {
      const s = wrap01(this.s - i * (1.75 / this.len));
      this.curve.getPointAt(s, this.tmp);
      this.curve.getTangentAt(s, this.tmp2);
      car.position.copy(this.tmp);
      car.visible = this.tmp.y > 0.4;
      car.lookAt(this.tmp.add(this.tmp2));
    });
  }
}
