import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RampPoint } from '../physics/types';
import { toWorld } from './space';

/**
 * Wire-rail track along a guided path: two steel rails, a translucent plastic
 * floor and support posts down to `groundH`. Shared by the playfield ramps and
 * the city skyway so every track in the machine reads as one family.
 */
export function buildTrack(
  path: RampPoint[],
  opts: { color: number; railMaterial: THREE.Material; envMap: THREE.Texture | null; castShadow: boolean; groundH?: number; samples?: number; glow?: boolean },
): THREE.Group {
  const group = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  const pts = path.map((p) => toWorld(p.x, p.y, p.h + 0.02));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
  const n = opts.samples ?? 90;
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  const lipL: THREE.Vector3[] = [];
  const lipR: THREE.Vector3[] = [];
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
    lipL.push(new THREE.Vector3(l.x, l.y - 0.2, l.z));
    lipR.push(new THREE.Vector3(r.x, r.y - 0.2, r.z));
    if (i < n) {
      const k = i * 2;
      ribbonIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  for (const rail of [left, right]) {
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), Math.round(n * 1.3), 0.075, 10, false);
    const mesh = new THREE.Mesh(tube, opts.railMaterial);
    mesh.castShadow = opts.castShadow;
    group.add(mesh);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(ribbon, 3));
  rg.setIndex(ribbonIdx);
  rg.computeVertexNormals();
  // Clear, lightly tinted acrylic: you see the field through it and the light banks glint off it.
  const tint = new THREE.Color(opts.color).lerp(new THREE.Color(0xffffff), 0.55);
  const ribbonMat = new THREE.MeshStandardMaterial({ color: tint, transparent: true, opacity: 0.26, roughness: 0.04, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMap: opts.envMap, envMapIntensity: 1.6 });
  group.add(new THREE.Mesh(rg, ribbonMat));
  // Coloured acrylic flanges along both edges: the ramp's colour, lit by the room rather than glowing.
  if (opts.glow !== false) {
    const lipMat = new THREE.MeshStandardMaterial({ color: opts.color, emissive: opts.color, emissiveIntensity: 0.22, roughness: 0.2, transparent: true, opacity: 0.85, envMap: opts.envMap, envMapIntensity: 1.0 });
    for (const lip of [lipL, lipR]) group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lip), n, 0.05, 6, false), lipMat));
  }
  const ground = opts.groundH ?? 0;
  const supports: THREE.BufferGeometry[] = [];
  for (let i = 6; i < n; i += 9) {
    const p = curve.getPointAt(i / n);
    const hgt = p.y - 0.3 - ground;
    if (hgt < 0.4) continue;
    const g = new THREE.CylinderGeometry(0.06, 0.06, hgt, 6);
    g.translate(p.x, ground + hgt / 2, p.z);
    supports.push(g);
  }
  if (supports.length) {
    group.add(new THREE.Mesh(mergeGeometries(supports, false)!, opts.railMaterial));
    supports.forEach((g) => g.dispose());
  }
  return group;
}
