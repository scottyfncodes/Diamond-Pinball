import * as THREE from 'three';
import { TABLE } from '../table/layout';
import { damp } from '../core/math';

export type CameraMode = 'title' | 'play' | 'homeRun' | 'multiball';

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
    const hw = TABLE.width / 2 + 1.4;
    const far = -(TABLE.length / 2) - 1.0;
    const near = TABLE.length / 2 + 1.6;
    const tilt = THREE.MathUtils.degToRad(6.5);
    const lift = (z: number) => -z * Math.sin(tilt);
    return [
      new THREE.Vector3(-hw, lift(near), near),
      new THREE.Vector3(hw, lift(near), near),
      new THREE.Vector3(-hw, lift(far) + 1.5, far),
      new THREE.Vector3(hw, lift(far) + 1.5, far),
      new THREE.Vector3(0, lift(far) + (this.aspect > 1.05 ? 5.5 : 9), far - 4.5), // backbox / stands
    ];
  }

  private computeFraming(): void {
    // Landscape: look up the table at a lower pitch; portrait: more overhead.
    const landscape = this.aspect > 1.05;
    const pitch = THREE.MathUtils.degToRad(landscape ? 46 : 60);
    const lookAt = new THREE.Vector3(0, 0, landscape ? -2.5 : 0.5);
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const pts = this.framingPoints();
    const cam = this.camera.clone();
    cam.aspect = this.aspect;
    let lo = 10;
    let hi = 200;
    const marginX = 0.96 - this.sideReserve * 2;
    const marginTop = 0.98 - this.topReserve * 2;
    const marginBottom = 0.97 - this.bottomReserve * 2;
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

  multiball(): void {
    this.eventTarget.copy(this.baseTarget);
    this.eventPos.copy(this.basePos).multiplyScalar(1.08);
    this.eventTimer = 1.6;
    this.mode = 'multiball';
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
      desiredPos = new THREE.Vector3(Math.sin(a) * r * 0.55 - this.titleShift, this.basePos.y * 0.9 + Math.sin(this.time * 0.3) * 2, Math.cos(a) * r * 0.75 + 6);
      desiredTarget = new THREE.Vector3(-this.titleShift, 1.5, -4);
      lambda = 2;
    } else if (this.eventTimer > 0) {
      this.eventTimer -= dt;
      desiredPos = this.eventPos;
      desiredTarget = this.eventTarget;
      lambda = 3.5;
      if (this.eventTimer <= 0) this.mode = 'play';
    } else {
      desiredPos = this.basePos;
      desiredTarget = this.baseTarget;
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
