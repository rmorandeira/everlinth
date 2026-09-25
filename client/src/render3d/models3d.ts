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
      std.userData.cutaway = true; // se recorta en el círculo de visión (ver cutaway3d)
    }
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
