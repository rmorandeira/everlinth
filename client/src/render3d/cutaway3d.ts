// Círculo de visión: en pantalla, un círculo centrado en el jugador dentro del cual
// desaparecen SOLO las partes de edificios y elementos altos que están entre la
// cámara y el jugador (más cerca de la cámara que él). Lo que queda detrás del
// jugador, y el suelo, nunca se tocan. Borde suave (tramado).
//
// Se inyecta en el shader de los materiales afectados (onBeforeCompile) y usa
// transparencia por tramado (Bayer 4×4 + discard): el material sigue siendo opaco
// (escribe profundidad, sin problemas de orden) y las sombras no cambian.
import * as THREE from "three";

const uniforms = {
  uCutCenter: { value: new THREE.Vector2(0, 0) }, // jugador en píxeles del búfer
  uCutRadius: { value: 100 }, // radio en píxeles
  uCutDepth: { value: 50 }, // distancia del jugador a la cámara (vista)
};

const DECL = /* glsl */ `
uniform vec2 uCutCenter;
uniform float uCutRadius;
uniform float uCutDepth;
`;

const BODY = /* glsl */ `
{
  float dist = length(gl_FragCoord.xy - uCutCenter);
  // 0 fuera del círculo, 1 dentro (borde suave del 30 %)
  float inside = 1.0 - smoothstep(uCutRadius * 0.7, uCutRadius, dist);
  // solo lo que está delante del jugador (más cerca de la cámara), con transición
  float front = smoothstep(0.15, 0.9, uCutDepth - vViewPosition.z);
  float cut = inside * front;
  if (cut > 0.001) {
    int bx = int(mod(gl_FragCoord.x, 4.0));
    int by = int(mod(gl_FragCoord.y, 4.0));
    float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    float keep = 1.0 - cut * 0.97;
    if (keep < (bayer[bx + by * 4] + 0.5) / 16.0) discard;
  }
}
`;

const patched = new WeakSet<THREE.Material>();
function patch(mat: THREE.Material): void {
  if (patched.has(mat)) return;
  // Necesita vViewPosition (materiales con iluminación: Lambert, Phong, Standard).
  const lit = (mat as THREE.MeshLambertMaterial).isMeshLambertMaterial || (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || (mat as THREE.MeshPhongMaterial).isMeshPhongMaterial;
  if (!lit) return;
  patched.add(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = DECL + shader.fragmentShader.replace("void main() {", "void main() {\n" + BODY);
  };
  // Programa propio: si no, three.js podría reutilizar el de otro material del mismo
  // tipo sin el recorte (o al revés).
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + "|cutaway";
  mat.needsUpdate = true;
}

// Aplica el recorte a todos los materiales de un objeto (edificio, farola, árbol…).
export function applyCutaway(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach(patch);
    else patch(m);
  });
}

export function applyCutawayToMaterial(m: THREE.Material): void {
  patch(m);
}

// Cada frame: jugador en pantalla (píxeles del búfer), su profundidad y el radio
// (fracción de la altura del búfer).
const tmp = new THREE.Vector3();
export function updateCutaway(camera: THREE.Camera, playerX: number, playerZ: number, bufferW: number, bufferH: number, radiusFrac: number): void {
  tmp.set(playerX, 0.35, playerZ).applyMatrix4(camera.matrixWorldInverse);
  uniforms.uCutDepth.value = -tmp.z;
  tmp.set(playerX, 0.35, playerZ).project(camera);
  uniforms.uCutCenter.value.set((tmp.x * 0.5 + 0.5) * bufferW, (tmp.y * 0.5 + 0.5) * bufferH);
  uniforms.uCutRadius.value = radiusFrac * bufferH;
}
