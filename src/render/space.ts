import * as THREE from 'three';
import { TABLE } from '../table/layout';

/**
 * Table space -> world space. Table x runs across (0..22), table y runs up the
 * playfield (0 at the drain, 44 at the top). World: x centred, +y up, -z away
 * from the player.
 */
export const toWorld = (x: number, y: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 =>
  out.set(x - TABLE.width / 2, h, -(y - TABLE.length / 2));

export const TABLE_SLOPE = THREE.MathUtils.degToRad(6.5);

export const disposeObject = (obj: THREE.Object3D): void => {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
};
