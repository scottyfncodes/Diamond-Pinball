import * as THREE from 'three';
import type { World } from '../physics/World';
import { toWorld } from './space';

/**
 * Renders every physics ball with a crisp chrome material, a contact shadow
 * blob and a short motion trail. Meshes are pooled and reused.
 */
export class BallView {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private blobs: THREE.Mesh[] = [];
  private trails: THREE.Mesh[][] = [];
  private geometry: THREE.SphereGeometry;
  private material: THREE.MeshStandardMaterial;
  private blobMaterial: THREE.MeshBasicMaterial;
  private trailMaterial: THREE.MeshBasicMaterial;
  private tmp = new THREE.Vector3();
  private axis = new THREE.Vector3();

  constructor(private world: World, envMap: THREE.Texture | null, private trailLength = 4) {
    this.geometry = new THREE.SphereGeometry(world.config.ballRadius, 28, 20);
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, envMap, envMapIntensity: 1.4 });
    this.blobMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    this.trailMaterial = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.16, depthWrite: false });
  }

  private ensure(n: number): void {
    while (this.meshes.length < n) {
      const m = new THREE.Mesh(this.geometry, this.material);
      m.castShadow = true;
      const blob = new THREE.Mesh(new THREE.CircleGeometry(this.world.config.ballRadius * 1.1, 16), this.blobMaterial);
      blob.rotation.x = -Math.PI / 2;
      const trail: THREE.Mesh[] = [];
      for (let i = 0; i < this.trailLength; i++) {
        const t = new THREE.Mesh(this.geometry, this.trailMaterial);
        t.scale.setScalar(0.9 - i * 0.12);
        t.visible = false;
        trail.push(t);
        this.group.add(t);
      }
      this.group.add(m, blob);
      this.meshes.push(m);
      this.blobs.push(blob);
      this.trails.push(trail);
    }
  }

  update(dt: number): void {
    const balls = this.world.balls.filter((b) => b.state !== 'drained');
    this.ensure(balls.length);
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      const blob = this.blobs[i];
      const trail = this.trails[i];
      const ball = balls[i];
      if (!ball) {
        mesh.visible = false;
        blob.visible = false;
        trail.forEach((t) => (t.visible = false));
        continue;
      }
      mesh.visible = true;
      blob.visible = true;
      const r = ball.radius;
      toWorld(ball.pos.x, ball.pos.y, r + ball.height + (ball.state === 'locked' ? 0.05 : 0), this.tmp);
      // Trail: shift previous positions.
      const speed = Math.hypot(ball.vel.x, ball.vel.y);
      const showTrail = speed > 55 && ball.state === 'free';
      for (let k = trail.length - 1; k > 0; k--) {
        trail[k].position.copy(trail[k - 1].position);
        trail[k].visible = showTrail && trail[k - 1].visible;
      }
      trail[0].position.copy(mesh.position);
      trail[0].visible = showTrail && mesh.position.lengthSq() > 0;
      mesh.position.copy(this.tmp);
      // Rolling rotation around the axis perpendicular to velocity.
      if (speed > 0.01) {
        this.axis.set(-ball.vel.y, 0, -ball.vel.x).normalize();
        mesh.rotateOnWorldAxis(this.axis, (speed * dt) / r);
      }
      blob.position.set(this.tmp.x, 0.02, this.tmp.z);
      const h = ball.height;
      const s = 1 + h * 0.35;
      blob.scale.setScalar(s);
      this.blobMaterial.opacity = 0.35;
      (blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.35 - h * 0.06);
    }
  }
}
