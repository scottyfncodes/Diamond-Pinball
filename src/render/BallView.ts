import * as THREE from 'three';
import type { World } from '../physics/World';
import type { Ball } from '../physics/types';
import { createBaseballTexture, createParticleTexture } from './textures';
import { toWorld } from './space';

interface SkinDef {
  material: THREE.Material;
  trail: number;
  trailOpacity: number;
  /** Extra emissive pulse for powered skins. */
  pulse?: number;
}

/** Soft-edged contact shadow: dark under the ball, fading out to nothing. */
function contactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.3, '#c8c8c8');
  g.addColorStop(0.6, '#404040');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Renders every physics ball with a crisp chrome material, a contact shadow
 * blob and a short motion trail. Meshes are pooled and reused, every ball is
 * scaled to its own physical radius (difficulty, GIANT BASEBALL, split balls)
 * and skinned by its power state (rocket, baseball, cosmic...).
 */
export class BallView {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private blobs: THREE.Mesh[] = [];
  private trails: THREE.Sprite[][] = [];
  private trailMats: THREE.SpriteMaterial[] = [];
  private trailTex = createParticleTexture();
  private geometry: THREE.SphereGeometry;
  private blobMaterial: THREE.MeshBasicMaterial;
  private skins = new Map<string, SkinDef>();
  private tmp = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private time = 0;
  /** Skin used for balls that carry the plain steel skin (player preference). */
  defaultSkin = 'steel';

  constructor(private world: World, envMap: THREE.Texture | null, private trailLength = 4) {
    // Unit sphere; each mesh is scaled to the ball's radius every frame.
    this.geometry = new THREE.SphereGeometry(1, 48, 32);
    this.blobMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactShadowTexture(), transparent: true, opacity: 0.55, depthWrite: false });
    const chrome = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.12, envMap, envMapIntensity: 1.4, ...extra });
    this.skins.set('steel', { material: chrome(0xffffff), trail: 0xdfe8ff, trailOpacity: 0.16 });
    this.skins.set('gold', { material: chrome(0xffd36a, { roughness: 0.18 }), trail: 0xffe08a, trailOpacity: 0.22 });
    this.skins.set('cosmic', { material: chrome(0xb49cff, { roughness: 0.08, emissive: 0x2a1a66, emissiveIntensity: 0.6 }), trail: 0xc77dff, trailOpacity: 0.3, pulse: 0.5 });
    this.skins.set('fire', { material: chrome(0xffb070, { roughness: 0.2, emissive: 0xff4d1a, emissiveIntensity: 0.5 }), trail: 0xff6a2a, trailOpacity: 0.45, pulse: 0.4 });
    this.skins.set('rocket', { material: chrome(0xffffff, { emissive: 0xff2244, emissiveIntensity: 0.9 }), trail: 0xff4d6d, trailOpacity: 0.55, pulse: 0.8 });
    this.skins.set('giant', { material: chrome(0xffffff, { emissive: 0x334466, emissiveIntensity: 0.35 }), trail: 0xffffff, trailOpacity: 0.2 });
    const baseball = new THREE.MeshStandardMaterial({ map: createBaseballTexture(), roughness: 0.6, metalness: 0.05, envMap, envMapIntensity: 0.4 });
    this.skins.set('baseball', { material: baseball, trail: 0xffffff, trailOpacity: 0.18 });
  }

  private skinFor(ball: Ball): SkinDef {
    const id = ball.skin === 'steel' ? this.defaultSkin : ball.skin;
    return this.skins.get(id) ?? this.skins.get('steel')!;
  }

  private ensure(n: number): void {
    while (this.meshes.length < n) {
      const m = new THREE.Mesh(this.geometry, this.skins.get('steel')!.material);
      m.castShadow = true;
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), this.blobMaterial);
      blob.rotation.x = -Math.PI / 2;
      // Motion streak: soft additive glows that trail the ball and shrink away.
      const trailMat = new THREE.SpriteMaterial({ map: this.trailTex, color: 0xdfe8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
      const trail: THREE.Sprite[] = [];
      for (let i = 0; i < this.trailLength; i++) {
        const t = new THREE.Sprite(trailMat);
        t.visible = false;
        trail.push(t);
        this.group.add(t);
      }
      this.group.add(m, blob);
      this.meshes.push(m);
      this.blobs.push(blob);
      this.trails.push(trail);
      this.trailMats.push(trailMat);
    }
  }

  update(dt: number): void {
    this.time += dt;
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
      const skin = this.skinFor(ball);
      if (mesh.material !== skin.material) mesh.material = skin.material;
      const tm = this.trailMats[i];
      tm.color.set(skin.trail);
      tm.opacity = Math.min(0.9, skin.trailOpacity * 2.2);
      mesh.scale.setScalar(r);
      toWorld(ball.pos.x, ball.pos.y, r + ball.height + (ball.state === 'locked' ? 0.05 : 0), this.tmp);
      // Trail: shift previous positions. Powered balls always trail.
      const speed = Math.hypot(ball.vel.x, ball.vel.y);
      const showTrail = (speed > 55 || (skin.pulse !== undefined && speed > 12)) && ball.state === 'free';
      for (let k = trail.length - 1; k > 0; k--) {
        trail[k].position.copy(trail[k - 1].position);
        trail[k].visible = showTrail && trail[k - 1].visible;
        trail[k].scale.setScalar(r * 2.2 * (1 - k * 0.16));
      }
      trail[0].position.copy(mesh.position);
      trail[0].visible = showTrail && mesh.position.lengthSq() > 0;
      trail[0].scale.setScalar(r * 2.2);
      mesh.position.copy(this.tmp);
      // Rolling rotation around the axis perpendicular to velocity.
      if (speed > 0.01) {
        this.axis.set(-ball.vel.y, 0, -ball.vel.x).normalize();
        mesh.rotateOnWorldAxis(this.axis, (speed * dt) / r);
      }
      blob.position.set(this.tmp.x, 0.02, this.tmp.z);
      const h = ball.height;
      blob.scale.setScalar(r * (1 + h * 0.35));
      (blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.55 - h * 0.09);
      if (skin.pulse !== undefined) {
        const m = skin.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 0.5 + Math.sin(this.time * 12) * skin.pulse * 0.5 + skin.pulse * 0.5;
      }
    }
  }
}
