// Cámara ortográfica en proyección DIMÉTRICA clásica (no isométrica "de
// manual"): yaw de 45° + pitch de arctan(0.5) ≈ 26.565°, el ángulo que da el
// ratio 2:1 (ancho:alto) de los juegos isométricos de toda la vida — el mismo
// ratio que ya usaba TILE_W/TILE_H (64/32) en el renderer 2D. El ángulo nunca
// cambia; lo único que varía con el tiempo es el tamaño del frustum (zoom).
import * as THREE from "three";

const YAW = Math.PI / 4;
const PITCH = Math.atan(0.5);
const DIST = 50;

const DIR = new THREE.Vector3(Math.cos(PITCH) * Math.cos(YAW), Math.sin(PITCH), Math.cos(PITCH) * Math.sin(YAW));

export interface IsoCamera {
  camera: THREE.OrthographicCamera;
  /** halfHeight: mitad de la altura visible, en unidades de mundo (1 unidad = 1 tile). */
  setViewSize(halfHeight: number, aspect: number): void;
  /** Centra la cámara sobre un punto del suelo (x = columna, z = fila, y = altura opcional). */
  setTarget(x: number, z: number, y?: number): void;
}

export function createIsoCamera(): IsoCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  camera.up.set(0, 1, 0);

  function setViewSize(halfHeight: number, aspect: number): void {
    const halfWidth = halfHeight * aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  const target = new THREE.Vector3();
  function setTarget(x: number, z: number, y = 0): void {
    target.set(x, y, z);
    camera.position.copy(target).addScaledVector(DIR, DIST);
    camera.lookAt(target);
  }

  return { camera, setViewSize, setTarget };
}
