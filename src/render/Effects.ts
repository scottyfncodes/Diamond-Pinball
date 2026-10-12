import * as THREE from 'three';
import { createParticleTexture } from './textures';

interface Particle {
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  size: number;
}

class ParticleSystem {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private particles: Particle[];
  private cursor = 0;
  private material: THREE.ShaderMaterial;

  constructor(readonly capacity: number, texture: THREE.Texture, additive: boolean) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.particles = Array.from({ length: capacity }, () => ({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, gravity: 0, size: 0 }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 300 } },
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vColor; uniform float scale;
        void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vColor * t.rgb, t.a); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  emit(pos: THREE.Vector3, color: THREE.Color, opts: { count: number; speed: number; up?: number; life?: number; size?: number; gravity?: number; spread?: number }): void {
    for (let i = 0; i < opts.count; i++) {
      const p = this.particles[this.cursor];
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const a = Math.random() * Math.PI * 2;
      const spread = opts.spread ?? 1;
      const s = opts.speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * s * spread;
      p.vz = Math.sin(a) * s * spread;
      p.vy = (opts.up ?? 1) * s * (0.3 + Math.random() * 0.9);
      p.maxLife = (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.gravity = opts.gravity ?? 30;
      p.size = (opts.size ?? 0.35) * (0.6 + Math.random() * 0.8);
      this.positions[idx * 3] = pos.x;
      this.positions[idx * 3 + 1] = pos.y;
      this.positions[idx * 3 + 2] = pos.z;
      const jitter = 0.85 + Math.random() * 0.3;
      this.colors[idx * 3] = color.r * jitter;
      this.colors[idx * 3 + 1] = color.g * jitter;
      this.colors[idx * 3 + 2] = color.b * jitter;
      this.sizes[idx] = p.size;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.life <= 0) {
        if (this.sizes[i] !== 0) this.sizes[i] = 0;
        continue;
      }
      any = true;
      p.life -= dt;
      p.vy -= p.gravity * dt;
      this.positions[i * 3] += p.vx * dt;
      this.positions[i * 3 + 1] += p.vy * dt;
      this.positions[i * 3 + 2] += p.vz * dt;
      if (this.positions[i * 3 + 1] < 0.05) {
        this.positions[i * 3 + 1] = 0.05;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      const k = Math.max(0, p.life / p.maxLife);
      this.sizes[i] = p.size * (0.3 + 0.7 * k);
    }
    this.points.visible = any;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  setScale(pixelScale: number): void {
    this.material.uniforms.scale.value = pixelScale;
  }
}

/**
 * Pooled visual effects: sparks for impacts, confetti for celebrations and a
 * reusable flash light. Never allocates per frame.
 */
export class Effects {
  readonly group = new THREE.Group();
  private sparks: ParticleSystem;
  private confetti: ParticleSystem;
  readonly flash: THREE.PointLight;
  private flashDecay = 0;
  private tmpColor = new THREE.Color();

  constructor(private quality: 'low' | 'medium' | 'high') {
    const tex = createParticleTexture();
    this.sparks = new ParticleSystem(quality === 'low' ? 120 : 320, tex, true);
    this.confetti = new ParticleSystem(quality === 'low' ? 150 : 420, tex, false);
    this.group.add(this.sparks.points, this.confetti.points);
    this.flash = new THREE.PointLight(0xffe2a8, 0, 18, 2);
    this.flash.position.set(0, 3, 0);
    this.group.add(this.flash);
  }

  setViewportHeight(px: number): void {
    const scale = px * 0.55;
    this.sparks.setScale(scale);
    this.confetti.setScale(scale);
  }

  spark(pos: THREE.Vector3, color = 0xffd36a, intensity = 1): void {
    this.tmpColor.set(color);
    this.sparks.emit(pos, this.tmpColor, { count: Math.round(6 * intensity) + 2, speed: 6 * intensity + 2, up: 1.2, life: 0.4, size: 0.28, gravity: 25 });
  }

  burst(pos: THREE.Vector3, color = 0xffffff, size = 1): void {
    this.tmpColor.set(color);
    this.sparks.emit(pos, this.tmpColor, { count: Math.round(22 * size), speed: 9 * size, up: 1.6, life: 0.7, size: 0.5, gravity: 18 });
    this.flashAt(pos, 6 * size, color);
  }

  fireworks(pos: THREE.Vector3): void {
    const colors = [0xff4d6d, 0xffd36a, 0x4fe3ff, 0x7cff5a, 0xffffff, 0xff8a3b];
    for (let i = 0; i < 5; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 3));
      this.tmpColor.set(colors[i % colors.length]);
      this.confetti.emit(p, this.tmpColor, { count: this.quality === 'low' ? 24 : 60, speed: 7, up: 0.6, life: 1.6, size: 0.3, gravity: 9, spread: 1.2 });
      this.sparks.emit(p, this.tmpColor, { count: 18, speed: 10, up: 0.5, life: 0.8, size: 0.4, gravity: 6 });
    }
    this.flashAt(pos, 14, 0xffffff);
  }

  confettiRain(pos: THREE.Vector3): void {
    const colors = [0xff4d6d, 0xffd36a, 0x4fe3ff, 0x7cff5a, 0xffffff];
    for (let i = 0; i < colors.length; i++) {
      this.tmpColor.set(colors[i]);
      this.confetti.emit(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 5, (Math.random() - 0.5) * 2)), this.tmpColor, { count: 18, speed: 3, up: 0.3, life: 2.2, size: 0.26, gravity: 6 });
    }
  }

  flashAt(pos: THREE.Vector3, intensity: number, color = 0xffe2a8): void {
    this.flash.position.copy(pos);
    this.flash.position.y = Math.max(pos.y, 1.5);
    this.flash.color.set(color);
    this.flash.intensity = Math.max(this.flash.intensity, intensity);
    this.flashDecay = intensity * 6;
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.confetti.update(dt);
    if (this.flash.intensity > 0) {
      this.flash.intensity = Math.max(0, this.flash.intensity - this.flashDecay * dt);
    }
  }
}
