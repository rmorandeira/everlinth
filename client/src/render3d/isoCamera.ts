// Cámara ortográfica en proyección DIMÉTRICA clásica (no isométrica "de
// manual"): yaw de 45° + pitch de arctan(0.5) ≈ 26.565°, el ángulo que da el
// ratio 2:1 (ancho:alto) de los juegos isométricos de toda la vida — el mismo
// ratio que ya usaba TILE_W/TILE_H (64/32) en el renderer 2D. El pitch nunca
// cambia; el yaw puede girar en pasos de 90° (setYaw) para mirar tras los edificios.
import * as THREE from "three";

export const BASE_YAW = Math.PI / 4;
// Algo más bajo que el dimétrico clásico (atan(0.5) ≈ 26,6°): vista más rasante,
// se ven más las fachadas y menos las azoteas.
// Depuración: ?cenital=1 en la URL mira desde arriba (para revisar calles y cruces).
const TOP_DOWN = typeof location !== "undefined" && new URLSearchParams(location.search).has("cenital");
const PITCH = THREE.MathUtils.degToRad(TOP_DOWN ? 89 : 21);
export const ISO_PITCH = PITCH;
// Distancia fija cámara↔jugador: exportada porque THREE.Fog mide "cerca/lejos"
// como distancia a la CÁMARA, no al jugador (ver lighting3d.ts) — sin este
// desplazamiento, la niebla se calcularía centrada en 0 en vez de aquí.
export const ISO_CAMERA_DIST = 50;

const DIR = new THREE.Vector3(Math.cos(PITCH) * Math.cos(BASE_YAW), Math.sin(PITCH), Math.cos(PITCH) * Math.sin(BASE_YAW));

// Ejes propios de la imagen de esta cámara (a qué dirección de mundo
// corresponden "derecha" y "arriba" en pantalla): como el ángulo nunca
// cambia, son constantes. Sirven para proyectar un punto de mundo al plano
// de la cámara sin necesitar el propio objeto Camera (ver fitHalfHeightToGrid
// en scene3d.ts, que calcula cuánto hay que alejar la cámara para que quepa
// toda la sala en pantalla — el equivalente 3D de computeLayout() en el
// scene.ts 2D).
const FORWARD = DIR.clone().negate();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
export const CAMERA_RIGHT = new THREE.Vector3().crossVectors(FORWARD, WORLD_UP).normalize();
export const CAMERA_UP = new THREE.Vector3().crossVectors(CAMERA_RIGHT, FORWARD).normalize();

export interface IsoCamera {
  camera: THREE.OrthographicCamera;
  /** halfHeight: mitad de la altura visible, en unidades de mundo (1 unidad = 1 tile). */
  setViewSize(halfHeight: number, aspect: number): void;
  /**
   * Centra la cámara sobre un punto del suelo (x = columna, z = fila, y = altura
   * opcional). screenShiftUp: desplaza el encuadre hacia arriba esa distancia (en
   * unidades de mundo del plano de imagen), así el punto queda por debajo del centro.
   */
  setTarget(x: number, z: number, y?: number, screenShiftUp?: number): void;
  /** Yaw de la cámara (radianes; BASE_YAW = vista por defecto). */
  setYaw(yaw: number): void;
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

  const dir = DIR.clone();
  function setYaw(yaw: number): void {
    dir.set(Math.cos(PITCH) * Math.cos(yaw), Math.sin(PITCH), Math.cos(PITCH) * Math.sin(yaw));
  }

  const target = new THREE.Vector3();
  const localUp = new THREE.Vector3();
  function setTarget(x: number, z: number, y = 0, screenShiftUp = 0): void {
    target.set(x, y, z);
    camera.position.copy(target).addScaledVector(dir, ISO_CAMERA_DIST);
    camera.lookAt(target);
    if (screenShiftUp !== 0) {
      localUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(localUp, screenShiftUp);
    }
  }

  return { camera, setViewSize, setTarget, setYaw };
}
