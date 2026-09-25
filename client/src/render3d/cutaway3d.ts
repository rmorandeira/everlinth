// Zona de visión despejada: el triángulo en PANTALLA formado por el jugador y las
// dos esquinas inferiores. Todo edificio (o elemento alto) que caiga dentro se vuelve
// translúcido de forma progresiva: casi invisible junto al jugador (y en un pequeño
// halo a su alrededor) y cada vez más opaco hacia el borde inferior de la pantalla.
//
// Se hace en el propio shader de los materiales afectados (inyección con
// onBeforeCompile), con transparencia por tramado (dithering Bayer 4×4 + discard):
// el material sigue siendo opaco (escribe profundidad, sin problemas de orden), y
// las sombras no cambian (el pase de sombras usa su propio material).
import * as THREE from "three";

const uniforms = {
  uCutPlayer: { value: new THREE.Vector2(0, -0.2) }, // jugador en NDC
  uCutRes: { value: new THREE.Vector2(1, 1) }, // tamaño del búfer de dibujo (px)
  uCutMin: { value: 0.1 }, // opacidad mínima (junto al jugador)
};

const DECL = /* glsl */ `
uniform vec2 uCutPlayer;
uniform vec2 uCutRes;
uniform float uCutMin;
`;

const BODY = /* glsl */ `
{
  vec2 ndc = (gl_FragCoord.xy / uCutRes) * 2.0 - 1.0;
  vec2 P = uCutPlayer;
  vec2 v0 = vec2(-1.0, -1.0) - P;
  vec2 v1 = vec2(1.0, -1.0) - P;
  vec2 v2 = ndc - P;
  float d00 = dot(v0, v0);
  float d01 = dot(v0, v1);
  float d11 = dot(v1, v1);
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);
  float den = d00 * d11 - d01 * d01;
  float bA = (d11 * d20 - d01 * d21) / den;
  float bB = (d00 * d21 - d01 * d20) / den;
  float bP = 1.0 - bA - bB;
  // bP: 1 en el jugador, 0 en el borde inferior; fuera del triángulo no se corta.
  float cut = (bA >= 0.0 && bB >= 0.0 && bP >= 0.0) ? bP : 0.0;
  // halo alrededor del jugador (en unidades de altura de pantalla)
  vec2 dp = (ndc - P) * vec2(uCutRes.x / uCutRes.y, 1.0);
  cut = max(cut, 1.0 - smoothstep(0.1, 0.24, length(dp)));
  float keep = mix(1.0, uCutMin, pow(clamp(cut, 0.0, 1.0), 0.65));
  if (keep < 0.999) {
    int bx = int(mod(gl_FragCoord.x, 4.0));
    int by = int(mod(gl_FragCoord.y, 4.0));
    float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    if (keep < (bayer[bx + by * 4] + 0.5) / 16.0) discard;
  }
}
`;

const patched = new WeakSet<THREE.Material>();
function patch(mat: THREE.Material): void {
  if (patched.has(mat)) return;
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

// Aplica el recorte a todos los materiales de un objeto (edificio, farola…).
export function applyCutaway(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach(patch);
    else patch(m);
  });
}

// Cada frame: posición del jugador en pantalla y tamaño del búfer de dibujo.
const tmp = new THREE.Vector3();
export function updateCutaway(camera: THREE.Camera, playerX: number, playerZ: number, bufferW: number, bufferH: number): void {
  tmp.set(playerX, 0.35, playerZ).project(camera);
  uniforms.uCutPlayer.value.set(tmp.x, tmp.y);
  uniforms.uCutRes.value.set(bufferW, bufferH);
}
