// Área del personaje sin obstrucciones, sin dejar de ver los edificios: todo lo que
// se interpone entre la cámara (el punto de vista del jugador) y el suelo alrededor
// del personaje (un radio en metros reales) se vuelve TRANSLÚCIDO, no se borra.
//
// Para cada fragmento de un material afectado se calcula dónde toca el suelo el
// rayo de visión que pasa por él (cámara ortográfica: todos los rayos van en la
// misma dirección). Si ese punto cae dentro del área del personaje, el fragmento
// está tapando esa área → se aclara. Así solo se tocan los trozos de edificio que
// estorban de verdad; lo que está al lado o detrás del personaje queda intacto.
//
// Se inyecta en el shader (onBeforeCompile) con transparencia por tramado (ruido de
// gradiente entrelazado + discard): el material sigue siendo opaco (escribe profundidad, sin problemas
// de orden entre edificios) y las sombras no cambian.
import * as THREE from "three";

const uniforms = {
  uCutChar: { value: new THREE.Vector2(0, 0) }, // personaje en el suelo (x, z) en unidades de render
  uCutRadius: { value: 4 }, // radio del área (unidades de render; 1 = 3 m)
  uCutViewDir: { value: new THREE.Vector3(0, -1, 0) }, // dirección de visión (cámara → escena)
  uCutCamWorld: { value: new THREE.Matrix4() }, // matriz de mundo de la cámara (vista → mundo)
  uCutKeep: { value: 0.3 }, // opacidad que conserva lo que tapa el área
};

const DECL = /* glsl */ `
uniform vec2 uCutChar;
uniform float uCutRadius;
uniform vec3 uCutViewDir;
uniform mat4 uCutCamWorld;
uniform float uCutKeep;
`;

const BODY = /* glsl */ `
{
  vec3 wp = (uCutCamWorld * vec4(-vViewPosition, 1.0)).xyz;
  if (wp.y > 0.12) {
    // punto del suelo que este fragmento tapa (siguiendo el rayo de visión)
    vec2 g = wp.xz - uCutViewDir.xz * (wp.y / uCutViewDir.y);
    float d = length(g - uCutChar);
    float cut = 1.0 - smoothstep(uCutRadius * 0.45, uCutRadius, d);
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

// Cada frame: posición del personaje, radio del área (unidades de render) y cámara.
export function updateCutaway(camera: THREE.Camera, charX: number, charZ: number, radius: number): void {
  uniforms.uCutChar.value.set(charX, charZ);
  uniforms.uCutRadius.value = radius;
  camera.getWorldDirection(uniforms.uCutViewDir.value);
  uniforms.uCutCamWorld.value.copy(camera.matrixWorld);
}
