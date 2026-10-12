import * as THREE from 'three';
import { TABLE } from '../table/layout';
import { damp } from '../core/math';

export type CameraMode = 'title' | 'play' | 'homeRun' | 'multiball' | 'cinematic';

/**
 * Three-quarter overhead camera that frames the full playfield for any aspect
 * ratio, with short cinematic excursions for big baseball moments.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'title';
  private basePos = new THREE.Vector3();
  private baseTarget = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private eventPos = new THREE.Vector3();
  private eventTarget = new THREE.Vector3();
  private eventTimer = 0;
  private shake = 0;
  private shakeVec = new THREE.Vector3();
  private time = 0;
  private aspect = 1;
  /** Fraction of the viewport reserved for HUD on each side in landscape. */
  sideReserve = 0.0;
  bottomReserve = 0.0;
  topReserve = 0.0;
  /** Horizontal shift of the machine on the title screen (landscape puts it beside the logo). */
  titleShift = 0;
  /** Gameplay zoom: the view magnifies and gently follows the ball down the table. */
  zoom = 1;
  private followZ = 0;
  private followTarget = 0;
  private cine: { get: (out: THREE.Vector3) => boolean; timer: number; last: THREE.Vector3; side: number } | null = null;
  private sPos = new THREE.Vector3();
  private sTarget = new THREE.Vector3();
  private sTmp = new THREE.Vector3();
  /** How far the zoomed view may pan toward the flippers / the outfield before an edge leaves the screen. */
  private panNear = 0;
  private panFar = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 400);
    this.camera.position.set(0, 60, 60);
    this.pos.copy(this.camera.position);
  }

  setViewport(width: number, height: number): void {
    this.aspect = width / height;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.computeFraming();
  }

  /** Points on the table that must stay in view (table-space corners in world units). */
  private framingPoints(): THREE.Vector3[] {
    const landscape = this.aspect > 1.05;
    // Frame the playfield tightly: the cabinet edge, stands and backbox may
    // run off-screen, the flippers and the whole field never do.
    const hw = TABLE.width / 2 + (landscape ? 0.4 : 0.9);
    const far = -(TABLE.length / 2) + (landscape ? 0.6 : -0.3);
    const near = TABLE.length / 2 + 0.9;
    const tilt = THREE.MathUtils.degToRad(6.5);
    const lift = (z: number) => -z * Math.sin(tilt);
    const pts = [
      new THREE.Vector3(-hw, lift(near), near),
      new THREE.Vector3(hw, lift(near), near),
      new THREE.Vector3(-hw, lift(far) + 1.2, far),
      new THREE.Vector3(hw, lift(far) + 1.2, far),
    ];
    if (!landscape) pts.push(new THREE.Vector3(0, lift(far) + 6, far - 3)); // keep the scoreboard in portrait
    return pts;
  }

  private computeFraming(): void {
    // Landscape: look up the table at a lower pitch; portrait: more overhead.
    const landscape = this.aspect > 1.05;
    const pitch = THREE.MathUtils.degToRad(landscape ? 44 : 58);
    const lookAt = new THREE.Vector3(0, 0, landscape ? -1.0 : 0.5);
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const pts = this.framingPoints();
    const cam = this.camera.clone();
    cam.aspect = this.aspect;
    let lo = 10;
    let hi = 200;
    const marginX = 0.99 - this.sideReserve * 2;
    const marginTop = 0.995 - this.topReserve * 2;
    const marginBottom = 0.985 - this.bottomReserve * 2;
    for (let i = 0; i < 22; i++) {
      const d = (lo + hi) / 2;
      cam.position.copy(lookAt).addScaledVector(dir, d);
      cam.lookAt(lookAt);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      let fits = true;
      for (const p of pts) {
        const v = p.clone().project(cam);
        if (Math.abs(v.x) > marginX || v.y > marginTop || v.y < -marginBottom) {
          fits = false;
          break;
        }
      }
      if (fits) hi = d;
      else lo = d;
    }
    this.basePos.copy(lookAt).addScaledVector(dir, hi);
    this.baseTarget.copy(lookAt);
    this.zoom = landscape ? 1.32 : 1.12;
    // Pan limits for the zoomed view: the farthest the target may slide toward
    // the player (near) or the outfield (far) while that end of the table stays in view.
    const fits = (tz: number, which: 'near' | 'far'): boolean => {
      const t = lookAt.clone();
      t.z += tz;
      cam.position.copy(t).addScaledVector(dir, hi / this.zoom);
      cam.lookAt(t);
      cam.updateMatrixWorld();
      const check = which === 'near' ? pts.slice(0, 2) : pts.slice(2, 4);
      for (const p of check) {
        const v = p.clone().project(cam);
        if (Math.abs(v.x) > marginX || v.y > marginTop || v.y < -marginBottom) return false;
      }
      return true;
    };
    // Smallest pan that brings that end of the table fully into the zoomed view.
    const search = (which: 'near' | 'far'): number => {
      if (fits(0, which)) return 0;
      let lo2 = 0; // does not fit
      let hi2 = 30; // fits
      for (let i = 0; i < 18; i++) {
        const mid = (lo2 + hi2) / 2;
        if (fits(which === 'near' ? mid : -mid, which)) hi2 = mid;
        else lo2 = mid;
      }
      return hi2;
    };
    this.panNear = search('near');
    this.panFar = search('far');
    if (this.mode === 'play') {
      this.pos.copy(this.basePos);
      this.target.copy(this.baseTarget);
    }
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    if (mode === 'play') this.eventTimer = 0;
  }

  /** Cinematic push toward the outfield when a ball leaves the yard. */
  homeRun(direction: 'left' | 'center' | 'right' = 'center'): void {
    const dx = direction === 'left' ? -7 : direction === 'right' ? 7 : 0;
    this.eventTarget.set(dx * 0.6, 2.5, -20);
    this.eventPos.set(dx * 0.3, 20, 16);
    this.eventTimer = 2.0;
    this.mode = 'homeRun';
  }

  /**
   * Home-run cinematic: the camera rises behind the plate and tracks the ball
   * into the seats. `get` returns false once the ball has landed.
   */
  startCinematic(get: (out: THREE.Vector3) => boolean, duration: number, sprayDeg = 0): void {
    this.cine = { get, timer: duration, last: this.baseTarget.clone(), side: Math.sign(sprayDeg) * Math.min(1, Math.abs(sprayDeg) / 30) };
    this.mode = 'cinematic';
  }

  endCinematic(): void {
    this.cine = null;
    if (this.mode === 'cinematic') this.mode = 'play';
  }

  multiball(): void {
    this.eventTarget.copy(this.baseTarget);
    this.eventPos.copy(this.basePos).multiplyScalar(1.08);
    this.eventTimer = 1.6;
    this.mode = 'multiball';
  }

  /** World z of the ball the camera should keep in view (closest to the flippers). */
  setFollow(z: number | null): void {
    if (z === null) return;
    this.followTarget = z;
  }

  kick(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  update(dt: number): void {
    this.time += dt;
    let desiredPos: THREE.Vector3;
    let desiredTarget: THREE.Vector3;
    let lambda = 5;
    if (this.mode === 'title') {
      const a = this.time * 0.18;
      const r = this.basePos.length() * 0.95;
      desiredPos = this.sPos.set(Math.sin(a) * r * 0.55 - this.titleShift, this.basePos.y * 0.9 + Math.sin(this.time * 0.3) * 2, Math.cos(a) * r * 0.75 + 6);
      desiredTarget = this.sTarget.set(-this.titleShift, 1.5, -4);
      lambda = 2;
    } else if (this.cine) {
      const c = this.cine;
      c.timer -= dt;
      if (c.get(this.sTmp)) c.last.copy(this.sTmp);
      // Broadcast shot: rise behind home plate and turn to watch the ball sail out.
      desiredTarget = this.sTarget.copy(c.last);
      desiredTarget.y = Math.max(1.5, c.last.y * 0.75);
      desiredPos = this.sPos.set(-c.side * 3 + c.last.x * 0.15, 15 + Math.min(4, c.last.y * 0.3), 25 + Math.min(0, c.last.z) * 0.12);
      lambda = 3.2;
      if (c.timer <= 0) this.endCinematic();
    } else if (this.eventTimer > 0) {
      this.eventTimer -= dt;
      desiredPos = this.eventPos;
      desiredTarget = this.eventTarget;
      lambda = 3.5;
      if (this.eventTimer <= 0) this.mode = 'play';
    } else {
      // Zoomed-in framing that pans along the table with the ball. The pan
      // range is limited so the flippers stay in view whenever the ball is low.
      const half = TABLE.length / 2;
      const want = this.followTarget >= 0 ? (this.followTarget / half) * this.panNear : (this.followTarget / half) * this.panFar;
      this.followZ = damp(this.followZ, THREE.MathUtils.clamp(want, -this.panFar, this.panNear), 3, dt);
      desiredTarget = this.sTarget.copy(this.baseTarget);
      desiredTarget.z += this.followZ;
      desiredPos = this.sPos.copy(this.basePos).sub(this.baseTarget).multiplyScalar(1 / this.zoom).add(desiredTarget);
      lambda = 4;
    }
    this.pos.x = damp(this.pos.x, desiredPos.x, lambda, dt);
    this.pos.y = damp(this.pos.y, desiredPos.y, lambda, dt);
    this.pos.z = damp(this.pos.z, desiredPos.z, lambda, dt);
    this.target.x = damp(this.target.x, desiredTarget.x, lambda, dt);
    this.target.y = damp(this.target.y, desiredTarget.y, lambda, dt);
    this.target.z = damp(this.target.z, desiredTarget.z, lambda, dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.5);
      this.shakeVec.set((Math.random() - 0.5) * this.shake * 0.35, (Math.random() - 0.5) * this.shake * 0.25, 0);
    } else this.shakeVec.set(0, 0, 0);
    this.camera.position.copy(this.pos).add(this.shakeVec);
    this.camera.lookAt(this.target);
  }
}
