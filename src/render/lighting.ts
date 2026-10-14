import * as THREE from 'three';
import type { Quality } from './Playfield';

/**
 * The look of a night game: a dark sky, banks of cool-white stadium light
 * overhead, warm light spilling off the lamps and a green bounce from the turf.
 *
 * Chrome, rails and the steel ball reflect this environment, so its bright
 * light banks are what read as "stadium lights" in every metal highlight.
 */
export function createStadiumEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  // Night-sky dome: deep navy at the zenith, a hazy glow at the horizon.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 zenith = vec3(0.012, 0.018, 0.05);
          vec3 horizon = vec3(0.10, 0.11, 0.20);
          vec3 turf = vec3(0.02, 0.07, 0.035);
          vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.6)) : mix(horizon * 0.6, turf, min(1.0, -h * 3.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  env.add(dome);
  const panel = (w: number, h: number, color: number, intensity: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  // Four light towers: the crisp rectangular highlights on chrome.
  for (const [x, z] of [[-26, -22], [26, -22], [-28, 18], [28, 18]] as const) panel(9, 4, 0xf2f5ff, 9, [x, 26, z]);
  // Long warm strip (the backbox and lamp glow) and a cool overhead softbox.
  panel(40, 3, 0xffc27a, 2.2, [0, 9, -36]);
  panel(30, 30, 0x9fb6ff, 0.55, [0, 45, 0]);
  // Scoreboard red and lamp gold accents for a little colour in the reflections.
  panel(10, 2.5, 0xff3b45, 1.6, [-34, 6, 6]);
  panel(10, 2.5, 0xffd36a, 1.6, [34, 6, 6]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
  return tex;
}

/** Playfield "general illumination": coloured pools of light that answer to the action. */
interface GiLight {
  light: THREE.PointLight;
  base: number;
  pulse: number;
}

export class StadiumLighting {
  readonly key: THREE.DirectionalLight;
  private gi = new Map<string, GiLight>();

  constructor(scene: THREE.Scene, table: THREE.Group, quality: Quality, toLocal: (x: number, y: number, h: number) => THREE.Vector3) {
    // Low, cool sky: the night is dark; the lights do the work.
    scene.add(new THREE.HemisphereLight(0x8ea4e8, 0x140c1e, 0.42));
    // Key: the stadium light banks behind the outfield, high and to the right. Shadows fall toward the player.
    this.key = new THREE.DirectionalLight(0xf3f6ff, 2.5);
    this.key.position.set(11, 34, -12);
    this.key.target.position.set(0, 0, 2);
    this.key.castShadow = quality !== 'low';
    const sh = this.key.shadow;
    const res = quality === 'high' ? 4096 : 2048;
    sh.mapSize.set(res, res);
    sh.camera.left = -24;
    sh.camera.right = 24;
    sh.camera.top = 30;
    sh.camera.bottom = -30;
    sh.camera.near = 5;
    sh.camera.far = 90;
    sh.bias = -0.0006;
    sh.normalBias = 0.025;
    sh.radius = 2.5;
    scene.add(this.key, this.key.target);
    // Front fill: warm, soft, from the player's side so faces of targets and bumpers never go black.
    const fill = new THREE.DirectionalLight(0xffd9b0, 0.85);
    fill.position.set(-8, 16, 30);
    scene.add(fill);
    // Rim: a cool kicker from behind the backbox that outlines every silhouette.
    const rim = new THREE.DirectionalLight(0x9fc0ff, 0.9);
    rim.position.set(-14, 10, -40);
    scene.add(rim);
    if (quality === 'low') return;
    // Local pools of light on the playfield (table-local, so they tilt with the machine).
    const add = (id: string, color: number, base: number, x: number, y: number, h: number, dist: number) => {
      const light = new THREE.PointLight(color, base, dist, 1.6);
      light.position.copy(toLocal(x, y, h));
      table.add(light);
      this.gi.set(id, { light, base, pulse: 0 });
    };
    add('bumpers', 0xffb25a, 9, 10.1, 31, 3.2, 11);
    add('diamond', 0xdfe8ff, 5, 10.1, 20, 4.5, 12);
    add('apron', 0xffc46a, 6, 10.1, 8.5, 3.0, 9);
  }

  /** A pool flares (bumper hit, jackpot...) and settles back. */
  pulse(id: string, amount = 1): void {
    const g = this.gi.get(id);
    if (g) g.pulse = Math.max(g.pulse, amount);
  }

  pulseAll(amount: number): void {
    for (const g of this.gi.values()) g.pulse = Math.max(g.pulse, amount);
  }

  update(dt: number): void {
    for (const g of this.gi.values()) {
      if (g.pulse > 0) g.pulse = Math.max(0, g.pulse - dt * 2.4);
      g.light.intensity = g.base * (1 + g.pulse * 2.2);
    }
  }
}
