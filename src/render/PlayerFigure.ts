import * as THREE from 'three';

export interface TeamMaterials {
  shirt: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  cap: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
}

export type FigureAnim = 'idle' | 'run' | 'swing' | 'throw' | 'celebrate' | 'ready' | 'pitch' | 'catch' | 'dive' | 'slump';

let sharedGeo: {
  leg: THREE.CylinderGeometry;
  torso: THREE.CapsuleGeometry;
  arm: THREE.CapsuleGeometry;
  head: THREE.SphereGeometry;
  cap: THREE.CylinderGeometry;
  brim: THREE.BoxGeometry;
  bat: THREE.CylinderGeometry;
  glove: THREE.SphereGeometry;
} | null = null;

const geo = () => {
  if (!sharedGeo) {
    sharedGeo = {
      leg: new THREE.CylinderGeometry(0.085, 0.07, 0.62, 8),
      torso: new THREE.CapsuleGeometry(0.2, 0.34, 4, 10),
      arm: new THREE.CapsuleGeometry(0.06, 0.4, 3, 8),
      head: new THREE.SphereGeometry(0.17, 12, 10),
      cap: new THREE.CylinderGeometry(0.185, 0.17, 0.12, 12),
      brim: new THREE.BoxGeometry(0.22, 0.03, 0.16),
      bat: new THREE.CylinderGeometry(0.045, 0.03, 0.85, 8),
      glove: new THREE.SphereGeometry(0.1, 8, 6),
    };
    sharedGeo.leg.translate(0, -0.31, 0);
    sharedGeo.arm.translate(0, -0.2, 0);
    sharedGeo.bat.translate(0, 0.38, 0);
  }
  return sharedGeo;
};

export function createTeamMaterials(shirt: number, pants: number, cap: number): TeamMaterials {
  return {
    shirt: new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.7 }),
    pants: new THREE.MeshStandardMaterial({ color: pants, roughness: 0.75 }),
    cap: new THREE.MeshStandardMaterial({ color: cap, roughness: 0.6 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9a37a, roughness: 0.8 }),
  };
}

const batMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.5 });
const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0x6b3f1d, roughness: 0.9 });

/**
 * Procedural toy-scale baseball player. All animation is procedural and cheap:
 * running swings the legs/arms, swings rotate the torso, throws raise an arm.
 */
export class PlayerFigure extends THREE.Group {
  readonly root = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private torso: THREE.Mesh;
  private upper = new THREE.Group();
  private bat: THREE.Mesh | null = null;
  private glove: THREE.Mesh | null = null;
  anim: FigureAnim = 'idle';
  private animT = 0;
  private phase = Math.random() * 10;
  hop = 0;
  /** Movement target in world space (y ignored) and speed. */
  target: THREE.Vector3 | null = null;
  speed = 7;
  facing = 0;
  private moving = false;
  private onArrive: (() => void) | null = null;

  constructor(mats: TeamMaterials, public readonly role: string, withBat = false, withGlove = true) {
    super();
    const g = geo();
    this.legL = new THREE.Mesh(g.leg, mats.pants);
    this.legR = new THREE.Mesh(g.leg, mats.pants);
    this.legL.position.set(-0.1, 0.62, 0);
    this.legR.position.set(0.1, 0.62, 0);
    this.root.add(this.legL, this.legR);
    this.torso = new THREE.Mesh(g.torso, mats.shirt);
    this.torso.position.set(0, 0.92, 0);
    this.upper.position.set(0, 0, 0);
    this.upper.add(this.torso);
    this.armL = new THREE.Mesh(g.arm, mats.shirt);
    this.armR = new THREE.Mesh(g.arm, mats.shirt);
    this.armL.position.set(-0.27, 1.12, 0);
    this.armR.position.set(0.27, 1.12, 0);
    this.upper.add(this.armL, this.armR);
    const head = new THREE.Mesh(g.head, mats.skin);
    head.position.set(0, 1.36, 0);
    const cap = new THREE.Mesh(g.cap, mats.cap);
    cap.position.set(0, 1.47, 0);
    const brim = new THREE.Mesh(g.brim, mats.cap);
    brim.position.set(0, 1.44, 0.15);
    this.upper.add(head, cap, brim);
    if (withBat) {
      this.bat = new THREE.Mesh(g.bat, batMaterial);
      this.bat.position.set(0.3, 0.72, 0);
      this.bat.rotation.z = -0.5;
      this.bat.rotation.x = 0.4;
      this.armR.add(this.bat);
      this.bat.position.set(0, -0.4, 0);
    } else if (withGlove) {
      this.glove = new THREE.Mesh(g.glove, gloveMaterial);
      this.glove.position.set(0, -0.42, 0);
      this.armL.add(this.glove);
    }
    this.root.add(this.upper);
    this.add(this.root);
    for (const m of [this.legL, this.legR, this.torso, this.armL, this.armR, head, cap]) {
      m.castShadow = true;
    }
  }

  setMaterials(mats: TeamMaterials): void {
    this.legL.material = mats.pants;
    this.legR.material = mats.pants;
    this.torso.material = mats.shirt;
    this.armL.material = mats.shirt;
    this.armR.material = mats.shirt;
    this.upper.children.forEach((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.geometry === geo().cap || mesh.geometry === geo().brim) mesh.material = mats.cap;
      if (mesh.geometry === geo().head) mesh.material = mats.skin;
    });
  }

  play(anim: FigureAnim): void {
    this.anim = anim;
    this.animT = 0;
  }

  moveTo(target: THREE.Vector3, speed = 7, onArrive?: () => void): void {
    this.target = target.clone();
    this.speed = speed;
    this.onArrive = onArrive ?? null;
  }

  warpTo(pos: THREE.Vector3): void {
    this.position.copy(pos);
    this.target = null;
    this.onArrive = null;
  }

  face(angle: number): void {
    this.facing = angle;
  }

  update(dt: number, time: number): void {
    this.animT += dt;
    // Movement.
    this.moving = false;
    if (this.target) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.08) {
        this.position.x = this.target.x;
        this.position.z = this.target.z;
        this.target = null;
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      } else {
        const step = Math.min(dist, this.speed * dt);
        this.position.x += (dx / dist) * step;
        this.position.z += (dz / dist) * step;
        this.facing = Math.atan2(dx, dz);
        this.moving = true;
      }
    }
    this.rotation.y = THREE.MathUtils.lerp(this.rotation.y, this.facing, 1 - Math.exp(-12 * dt));

    const t = time + this.phase;
    let legSwing = 0;
    let armSwing = 0;
    let bob = 0;
    let torsoYaw = 0;
    let torsoPitch = 0;
    let armRaise = 0;
    if (this.moving || this.anim === 'run') {
      legSwing = Math.sin(t * 16) * 0.75;
      armSwing = -legSwing * 0.8;
      bob = Math.abs(Math.sin(t * 16)) * 0.06;
    } else if (this.anim === 'idle' || this.anim === 'ready') {
      bob = Math.sin(t * 2.2) * 0.015;
      torsoPitch = this.anim === 'ready' ? 0.35 : 0.05;
      if (this.anim === 'ready') {
        legSwing = 0.25;
      }
    }
    if (this.anim === 'swing') {
      const p = Math.min(1, this.animT / 0.32);
      // Wind up (-0.9) then whip through (+1.9).
      torsoYaw = p < 0.25 ? -0.9 * (p / 0.25) : -0.9 + 2.8 * ((p - 0.25) / 0.75);
      torsoPitch = 0.2;
      armRaise = 1.1;
      if (this.animT > 0.9) this.anim = 'idle';
    } else if (this.anim === 'throw' || this.anim === 'pitch') {
      const p = Math.min(1, this.animT / 0.5);
      armRaise = p < 0.5 ? 2.6 * (p / 0.5) : 2.6 - 3.4 * ((p - 0.5) / 0.5);
      torsoPitch = p < 0.5 ? -0.25 : 0.35;
      if (this.anim === 'pitch') legSwing = p < 0.5 ? 0.8 * p : 0.4;
      if (this.animT > 0.8) this.anim = 'idle';
    } else if (this.anim === 'catch') {
      // Glove up to squeeze the ball.
      const p = Math.min(1, this.animT / 0.25);
      armRaise = 1.9 * p;
      torsoPitch = 0.1;
      if (this.animT > 0.7) this.anim = 'idle';
    } else if (this.anim === 'dive') {
      // Full-extension lunge, a beat on the turf, then pop back up.
      const p = this.animT;
      const down = p < 0.25 ? p / 0.25 : p < 0.85 ? 1 : Math.max(0, 1 - (p - 0.85) / 0.35);
      torsoPitch = 1.35 * down;
      armRaise = 2.6 * down;
      bob = -0.55 * down + Math.sin(Math.min(1, p / 0.25) * Math.PI) * 0.25;
      legSwing = -0.6 * down;
      if (p > 1.25) this.anim = 'idle';
    } else if (this.anim === 'slump') {
      // Strike three: shoulders drop, bat hangs.
      const p = Math.min(1, this.animT / 0.3);
      torsoPitch = 0.5 * p;
      armSwing = 0;
      bob = -0.04 * p;
      if (this.animT > 1.3) this.anim = 'idle';
    } else if (this.anim === 'celebrate') {
      bob = Math.abs(Math.sin(t * 9)) * 0.28;
      armRaise = 2.9;
      armSwing = Math.sin(t * 9) * 0.3;
      if (this.animT > 2.2) this.anim = 'idle';
    }
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt * 2.2);
      bob += Math.sin(Math.min(1, this.hop) * Math.PI) * 0.55;
      legSwing = 0.5;
    }

    this.legL.rotation.x = legSwing;
    this.legR.rotation.x = -legSwing;
    this.armL.rotation.x = -armSwing;
    this.armR.rotation.x = armSwing;
    if (armRaise) {
      this.armR.rotation.x = -armRaise;
      this.armL.rotation.x = this.anim === 'celebrate' ? -armRaise : -armRaise * 0.4;
    }
    if (this.bat) {
      this.bat.rotation.z = this.anim === 'swing' ? -1.5 : -0.5;
      this.bat.rotation.x = this.anim === 'swing' ? 0.2 : this.anim === 'ready' ? -0.9 : 0.4;
    }
    this.upper.rotation.y = torsoYaw;
    this.upper.rotation.x = torsoPitch;
    this.root.position.y = bob;
  }
}
