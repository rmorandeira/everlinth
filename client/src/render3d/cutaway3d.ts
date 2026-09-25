// Área del personaje sin obstrucciones, sin dejar de ver los edificios: en pantalla,
// la franja que va desde la línea horizontal del personaje hacia abajo y ocupa el 70 %
// del ancho (centrada). Todo lo que está por encima del suelo dentro de esa franja
// (edificios, farolas, árboles…) se vuelve TRANSLÚCIDO, no se borra: se ve la calle
// del personaje y lo que tiene delante, y la ciudad sigue ahí. Bordes suaves.
//
// Se inyecta en el shader (onBeforeCompile) con transparencia por tramado (ruido de
// gradiente entrelazado + discard): el material sigue siendo opaco (escribe
// profundidad, sin problemas de orden entre edificios) y las sombras no cambian.
import * as THREE from "three";

const uniforms = {
  uCutTop: { value: 0 }, // línea horizontal del personaje (px del búfer, origen abajo)
  uCutCenterX: { value: 0 }, // centro horizontal de la franja (px)
  uCutHalfW: { value: 100 }, // semiancho de la franja (px)
  uCutFeather: { value: 30 }, // ancho de la transición en los bordes (px)
  uCutCamWorld: { value: new THREE.Matrix4() }, // vista → mundo (para no tocar el suelo)
  uCutKeep: { value: 0.3 }, // opacidad que conserva lo que tapa la franja
};

const DECL = /* glsl */ `
uniform float uCutTop;
uniform float uCutCenterX;
uniform float uCutHalfW;
uniform float uCutFeather;
uniform mat4 uCutCamWorld;
uniform float uCutKeep;
`;

const BODY = /* glsl */ `
{
  vec3 wp = (uCutCamWorld * vec4(-vViewPosition, 1.0)).xyz;
  if (wp.y > 0.12) {
    float inY = 1.0 - smoothstep(uCutTop - uCutFeather, uCutTop + uCutFeather * 0.5, gl_FragCoord.y);
    float inX = 1.0 - smoothstep(uCutHalfW - uCutFeather, uCutHalfW + uCutFeather, abs(gl_FragCoord.x - uCutCenterX));
    float cut = inY * inX;
    if (cut > 0.001) {
      // Ruido de gradiente entrelazado (Jimenez): tramado fino y uniforme, sin la
      // cuadrícula visible del patrón Bayer.
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float keep = mix(1.0, uCutKeep, cut);
      if (keep < ign) discard;
    }
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

// Aplica el efecto a todos los materiales de un objeto (edificio, farola, árbol…).
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

// Cada frame: la línea del personaje (por encima de su cabeza, para incluirle) y
// el tamaño del búfer de dibujo.
const tmp = new THREE.Vector3();
export function updateCutaway(camera: THREE.Camera, charX: number, charZ: number, bufferW: number, bufferH: number, widthFrac = 0.7): void {
  tmp.set(charX, 0.75, charZ).project(camera);
  uniforms.uCutTop.value = (tmp.y * 0.5 + 0.5) * bufferH;
  uniforms.uCutCenterX.value = bufferW / 2;
  uniforms.uCutHalfW.value = (bufferW * widthFrac) / 2;
  uniforms.uCutFeather.value = bufferH * 0.05;
  uniforms.uCutCamWorld.value.copy(camera.matrixWorld);
}
