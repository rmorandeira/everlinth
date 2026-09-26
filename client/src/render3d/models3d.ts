// Modelos low-poly de Kenney (CC0, ver public/models/*/License.txt): edificios del
// City Kit Commercial, casas del City Kit Suburban y mobiliario urbano del Retro
// Urban Kit. Se cargan una vez (GLB) y cada uso es un clon que comparte geometría y
// materiales. Todos se normalizan: base en y=0, centrados en X/Z, frente hacia +Z.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const BASE = "/models";

// Escala de cada kit a unidades de render (1 unidad = 3 m), medida a ojo con las
// plantas de los edificios (≈3 m) y el tamaño de farolas/bancos.
export const KIT_SCALE = { commercial: 2.9, suburban: 2.7, retro: 2.1 } as const;
export type Kit = keyof typeof KIT_SCALE;

interface ModelEntry {
  object: THREE.Object3D; // normalizado
  size: THREE.Vector3; // tamaño en unidades del kit
}

const models = new Map<string, ModelEntry>();
let loadingPromise: Promise<void> | null = null;
let ready = false;

const COMMERCIAL_LOW = ["building-a", "building-b", "building-c", "building-d", "building-e", "building-h", "building-k"];
const COMMERCIAL_MID = ["building-f", "building-g", "building-i", "building-j", "building-l", "building-m", "building-n"];
const SKYSCRAPERS = ["building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-d", "building-skyscraper-e"];
const LOW_DETAIL = "abcdefghijklm".split("").map((c) => `low-detail-building-${c}`);
const HOUSES = "abcdefghijklmnopqrstu".split("").map((c) => `building-type-${c}`);
const PROPS_RETRO = ["detail-light-single", "detail-light-double", "detail-light-traffic", "detail-bench", "detail-dumpster-closed", "detail-dumpster-open", "truck-grey", "truck-green", "truck-flat", "tree-park-large", "tree-park-pine-large"];
const PROPS_SUBURBAN = ["tree-large", "tree-small", "planter"];

export const BUILDING_SETS = {
  low: COMMERCIAL_LOW.map((n) => `commercial/${n}`),
  mid: COMMERCIAL_MID.map((n) => `commercial/${n}`),
  tall: SKYSCRAPERS.map((n) => `commercial/${n}`),
  tiny: LOW_DETAIL.map((n) => `commercial/${n}`),
  house: HOUSES.map((n) => `suburban/${n}`),
};

// ---- Ventanas iluminadas ----
// Cada ventana REAL del modelo se enciende entera o nada: al cargar el modelo se
// buscan los triángulos cuyo color en la textura es el azul de los cristales de
// Kenney y se agrupan en paneles (triángulos del mismo plano que comparten arista).
// Cada panel recibe un número aleatorio en un atributo de vértice (aWin; 0 = no es
// ventana). En el shader, ese número más un desplazamiento propio de cada edificio
// (según su posición en el mundo) decide si el panel está encendido y de qué tono,
// así dos edificios iguales no tienen las mismas ventanas encendidas.
export const windowUniforms = {
  uWinGlow: { value: 0 }, // 0 de día → ~0,45 de noche
  uWinLit: { value: 0.3 }, // fracción de ventanas encendidas
};

function addWindowLights(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, windowUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float aWin;\nvarying float vWin;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
  {
#ifdef USE_INSTANCING
    vec3 o = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
    vec3 o = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
#endif
    float shift = fract(sin(dot(floor(o.xz * 4.0), vec2(12.9898, 78.233))) * 43758.5453);
    vWin = aWin > 0.0 ? fract(aWin + shift) + 0.0001 : 0.0;
  }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uWinGlow;\nuniform float uWinLit;\nvarying float vWin;\nvoid main() {")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  if (vWin > 0.0 && uWinGlow > 0.001) {
    float on = step(1.0 - uWinLit, vWin);
    vec3 tone = mix(vec3(1.0, 0.74, 0.4), vec3(0.75, 0.85, 1.0), step(0.9, fract(vWin * 7.31)));
    totalEmissiveRadiance += tone * on * uWinGlow * (0.75 + 0.25 * fract(vWin * 3.7));
  }`
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + "|winlights";
}

// Píxeles de la textura (una vez por imagen) para saber el color bajo cada UV.
const pixelCache = new WeakMap<object, { data: Uint8ClampedArray; w: number; h: number } | null>();
function texturePixels(tex: THREE.Texture): { data: Uint8ClampedArray; w: number; h: number } | null {
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return null;
  if (pixelCache.has(img)) return pixelCache.get(img)!;
  let out: { data: Uint8ClampedArray; w: number; h: number } | null = null;
  try {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    out = { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  } catch {
    out = null;
  }
  pixelCache.set(img, out);
  return out;
}

// Etiqueta los paneles de ventana de una malla (atributo aWin por vértice).
function tagWindows(mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial): void {
  if (!mat.map) return;
  const px = texturePixels(mat.map);
  if (!px) return;
  const geo0 = mesh.geometry;
  if (!geo0.getAttribute("uv")) return;
  const geo = geo0.index ? geo0.toNonIndexed() : geo0;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const tri = pos.count / 3;
  const isWin = new Uint8Array(tri);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  const normals: THREE.Vector3[] = [];
  for (let t = 0; t < tri; t++) {
    const u = (uv.getX(t * 3) + uv.getX(t * 3 + 1) + uv.getX(t * 3 + 2)) / 3;
    const v = (uv.getY(t * 3) + uv.getY(t * 3 + 1) + uv.getY(t * 3 + 2)) / 3;
    // glTF: origen de las UV arriba a la izquierda (sin volteo)
    const x = Math.min(px.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * px.w)));
    const y = Math.min(px.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * px.h)));
    const i = (y * px.w + x) * 4;
    const r = px.data[i], bl = px.data[i + 2];
    // solo el azul claro de los cristales (≈125-135, 165-175, 225-230), no los marcos gris azulados
    isWin[t] = bl - r > 70 && bl > 190 ? 1 : 0;
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
    normals.push(n.clone());
  }
  // Unión de triángulos de ventana que comparten arista y plano → un panel.
  const parent = new Int32Array(tri).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const key = (i: number): string => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < tri; t++) {
    if (!isWin[t]) continue;
    for (let k = 0; k < 3; k++) {
      const k1 = key(t * 3 + k);
      const k2 = key(t * 3 + ((k + 1) % 3));
      const ek = k1 < k2 ? k1 + "|" + k2 : k2 + "|" + k1;
      const other = edges.get(ek);
      if (other === undefined) edges.set(ek, t);
      else if (normals[other].dot(normals[t]) > 0.98) parent[find(t)] = find(other);
    }
  }
  const seeds = new Float32Array(pos.count);
  let any = false;
  for (let t = 0; t < tri; t++) {
    if (!isWin[t]) continue;
    const root = find(t);
    const sd = (Math.sin(root * 12.9898 + 78.233) * 43758.5453) % 1;
    const val = Math.abs(sd) * 0.999 + 0.0005;
    seeds[t * 3] = seeds[t * 3 + 1] = seeds[t * 3 + 2] = val;
    any = true;
  }
  if (!any) return;
  geo.setAttribute("aWin", new THREE.BufferAttribute(seeds, 1));
  mesh.geometry = geo;
}

function normalize(root: THREE.Object3D): ModelEntry {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const g = new THREE.Group();
  root.position.set(-center.x, -box.min.y, -center.z);
  g.add(root);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.map) std.map.anisotropy = 4;
      std.shadowSide = THREE.DoubleSide;
      std.userData.cutaway = true; // se aclara si tapa el área del personaje (ver cutaway3d)
      if (std.isMeshStandardMaterial && !std.userData.winLights) {
        std.userData.winLights = true;
        addWindowLights(std);
      }
    }
    if (!Array.isArray(m.material) && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) tagWindows(m, m.material as THREE.MeshStandardMaterial);
  });
  return { object: g, size };
}

export function initModels(): Promise<void> {
  if (loadingPromise) return loadingPromise;
  const loader = new GLTFLoader();
  const list: string[] = [
    ...BUILDING_SETS.low,
    ...BUILDING_SETS.mid,
    ...BUILDING_SETS.tall,
    ...BUILDING_SETS.tiny,
    ...BUILDING_SETS.house,
    ...PROPS_RETRO.map((n) => `retro/${n}`),
    ...PROPS_SUBURBAN.map((n) => `suburban/${n}`),
  ];
  loadingPromise = Promise.all(
    list.map((key) =>
      loader
        .loadAsync(`${BASE}/${key}.glb`)
        .then((gltf) => {
          models.set(key, normalize(gltf.scene));
        })
        .catch((e) => console.warn("Modelo no cargado:", key, e))
    )
  ).then(() => {
    ready = true;
  });
  return loadingPromise;
}

export function modelsReady(): boolean {
  return ready;
}

export function modelSize(key: string): THREE.Vector3 | null {
  return models.get(key)?.size ?? null;
}

// Clon del modelo (comparte geometría y materiales) o null si no está cargado.
export function cloneModel(key: string): THREE.Object3D | null {
  const e = models.get(key);
  return e ? e.object.clone(true) : null;
}
