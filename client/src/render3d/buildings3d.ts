// Edificios hechos SOLO de planos (quads): cuatro muros y una azotea por bloque,
// con fotos de fachada de assets/buildings como textura (ver tools/textures/build.mjs,
// que las reduce a 512 px y genera public/textures/buildings/manifest.json).
//
// - Base de cada torre: una franja de planta baja (escaparate/persiana/nave).
// - Muros: una textura "tower" (rejilla de ventanas de varias plantas) repetida en
//   vertical tantas veces como plantas tenga el bloque; el manifest dice cuántas
//   plantas enseña cada foto, así una ventana mide siempre ≈ una planta (3 m).
// - Los rascacielos se escalonan en bloques cada vez más estrechos.
// - Naves y casas bajas usan una fachada "lowrise" entera, sin repetir en vertical.
//
// Todos los planos de un edificio se fusionan por material: un edificio son 3-6
// mallas, no cientos. Los materiales (y sus texturas) se comparten entre edificios.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TILE_SIZE } from "@roi/shared";

function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function pick<T>(arr: T[], n: number): T {
  return arr[Math.floor(n * arr.length) % arr.length];
}

// ---- Catálogo de texturas ----

interface TexMeta {
  id: string;
  cat: "tower" | "lowrise" | "ground";
  floors: number; // plantas que enseña la foto (ground: 1)
  w: number; // tamaño original, solo para la proporción
  h: number;
}

const TEX_DIR = "/textures/buildings";
const byCat: Record<TexMeta["cat"], TexMeta[]> = { tower: [], lowrise: [], ground: [] };
let ready = false;
let loading: Promise<void> | null = null;

export function initBuildingTextures(): Promise<void> {
  if (!loading) {
    loading = fetch(`${TEX_DIR}/manifest.json`)
      .then((r) => r.json() as Promise<TexMeta[]>)
      .then((list) => {
        for (const t of list) byCat[t.cat].push(t);
        ready = true;
      })
      .catch((e) => {
        console.warn("No se pudieron cargar las texturas de edificios:", e);
        loading = null;
      });
  }
  return loading;
}

export function buildingTexturesReady(): boolean {
  return ready;
}

const loader = new THREE.TextureLoader();
const materialCache = new Map<string, THREE.MeshLambertMaterial>();
function texMaterial(id: string): THREE.MeshLambertMaterial {
  let m = materialCache.get(id);
  if (!m) {
    const map = loader.load(`${TEX_DIR}/${id}.jpg`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;
    m = new THREE.MeshLambertMaterial({ map });
    m.shadowSide = THREE.DoubleSide; // muros de un solo lado: la sombra debe cerrar el volumen
    materialCache.set(id, m);
  }
  return m;
}

const ROOF_COLORS = [0x5d6168, 0x6b6f73, 0x54585f, 0x746c64];
function roofMaterial(color: number): THREE.MeshLambertMaterial {
  const key = `roof${color}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    m.shadowSide = THREE.DoubleSide;
    materialCache.set(key, m);
  }
  return m;
}

// ---- Constructor de planos ----

const FLOOR_H = 1.0; // una planta ≈ 3 m ≈ 1 unidad de render
const GROUND_H = 1.3; // planta baja algo más alta

const activeGeometries: THREE.BufferGeometry[] = [];

class PlaneBatch {
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();

  private add(mat: THREE.Material, g: THREE.BufferGeometry): void {
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(g);
  }

  // Muro vertical de alto h, con la textura repetida (nx × ny) veces.
  // face: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X. hw/hd: semianchura/semifondo del bloque;
  // y0: base del muro.
  wall(mat: THREE.Material, face: number, hw: number, hd: number, y0: number, h: number, nx: number, ny: number): void {
    const w = face % 2 === 0 ? hw * 2 : hd * 2;
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * nx, uv.getY(i) * ny);
    const m = new THREE.Matrix4();
    m.makeRotationY([0, Math.PI / 2, Math.PI, -Math.PI / 2][face]);
    m.setPosition([0, hw, 0, -hw][face], y0 + h / 2, [hd, 0, -hd, 0][face]);
    g.applyMatrix4(m);
    this.add(mat, g);
  }

  roof(mat: THREE.Material, hw: number, hd: number, y: number): void {
    const g = new THREE.PlaneGeometry(hw * 2, hd * 2);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    this.add(mat, g);
  }

  build(group: THREE.Group): void {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      activeGeometries.push(merged);
      group.add(new THREE.Mesh(merged, mat));
    }
    this.lists.clear();
  }
}

// Repeticiones de una textura sobre un muro de ancho W: si cabe más de 1,5 veces se
// redondea (un pelín de estiramiento, sin cortes de ventana); si no, se recorta.
function repeatsAcross(W: number, tileW: number): number {
  const r = W / tileW;
  return r >= 1.5 ? Math.round(r) : r;
}

function wallWidth(face: number, hw: number, hd: number): number {
  return face % 2 === 0 ? hw * 2 : hd * 2;
}

// Franja de planta baja: GROUND_H de alto con una foto de escaparate/nave.
function groundWall(b: PlaneBatch, tex: TexMeta, face: number, hw: number, hd: number): void {
  const tileW = GROUND_H * (tex.w / tex.h);
  b.wall(texMaterial(tex.id), face, hw, hd, 0, GROUND_H, repeatsAcross(wallWidth(face, hw, hd), tileW), 1);
}

// Muro alto con una textura "tower": `floors` plantas de alto a partir de y0.
function towerWall(b: PlaneBatch, tex: TexMeta, face: number, hw: number, hd: number, y0: number, floors: number): void {
  const tileH = tex.floors * FLOOR_H;
  const tileW = tileH * (tex.w / tex.h);
  b.wall(texMaterial(tex.id), face, hw, hd, y0, floors * FLOOR_H, repeatsAcross(wallWidth(face, hw, hd), tileW), floors / tex.floors);
}

// Fachada completa (naves, casas): la foto entera, sin repetir en vertical.
function lowriseWall(b: PlaneBatch, tex: TexMeta, face: number, hw: number, hd: number): void {
  const tileH = tex.floors * FLOOR_H;
  const tileW = tileH * (tex.w / tex.h);
  b.wall(texMaterial(tex.id), face, hw, hd, 0, tileH, repeatsAcross(wallWidth(face, hw, hd), tileW), 1);
}

// Textura "tower" adecuada a un bloque de `floors` plantas: prefiere las que enseñan
// como mucho esas plantas (para no recortar la foto por arriba).
function chooseTower(floors: number, n: number): TexMeta {
  const fit = byCat.tower.filter((t) => t.floors <= floors + 1);
  return pick(fit.length > 0 ? fit : byCat.tower, n);
}

// globalX/globalZ: esquina superior-izquierda del edificio en tiles GLOBALES del
// mundo (así el mismo edificio sale idéntico visto desde su sala o desde una
// vecina). wTiles×dTiles: huella en tiles. urban: sala de ciudad (edificios altos
// alineados con las calles). Devuelve un Group centrado en el origen, base en y=0.
export function buildBuilding(globalX: number, globalZ: number, wTiles: number, dTiles: number, urban: boolean): THREE.Group {
  const group = new THREE.Group();
  if (!ready) return group;
  const n = hash2(globalX + 0.33, globalZ + 0.77);
  const n2 = hash2(globalX + 9.1, globalZ + 4.7);
  const n3 = hash2(globalX + 3.9, globalZ + 7.3);
  const batch = new PlaneBatch();

  const W = wTiles * TILE_SIZE * 0.96;
  const D = dTiles * TILE_SIZE * 0.96;
  const area = wTiles * dTiles;
  const roof = roofMaterial(pick(ROOF_COLORS, n3));

  // Nave / casa baja: una sola fachada entera en los cuatro lados.
  if (!urban || n2 < 0.12) {
    const size = Math.min(W, D);
    const hw = (urban ? W : size) / 2;
    const hd = (urban ? D : size) / 2;
    const tex = pick(byCat.lowrise, n);
    for (let face = 0; face < 4; face++) lowriseWall(batch, tex, face, hw, hd);
    batch.roof(roof, hw, hd, tex.floors * FLOOR_H);
    batch.build(group);
    return group;
  }

  // Torre: bloques escalonados. Los muy anchos suben más.
  const floors = area >= 110 ? 8 + Math.floor(Math.pow(n2, 1.5) * 18) : 4 + Math.floor(n2 * 7);
  const tiers: Array<{ k: number; floors: number }> = [];
  if (floors < 12) {
    tiers.push({ k: 1, floors });
  } else {
    const f0 = Math.round(floors * 0.55);
    const f1 = Math.round(floors * 0.3);
    tiers.push({ k: 1, floors: f0 }, { k: 0.72, floors: f1 }, { k: 0.46, floors: Math.max(2, floors - f0 - f1) });
  }
  const tex = chooseTower(Math.min(...tiers.map((t) => t.floors)), n);

  let y = 0;
  tiers.forEach((t, i) => {
    const hw = (W * t.k) / 2;
    const hd = (D * t.k) / 2;
    if (i === 0) {
      for (let face = 0; face < 4; face++) {
        groundWall(batch, pick(byCat.ground, hash2(globalX + face * 1.7, globalZ + 0.5)), face, hw, hd);
        towerWall(batch, tex, face, hw, hd, GROUND_H, t.floors - 1);
      }
      y = GROUND_H + (t.floors - 1) * FLOOR_H;
    } else {
      for (let face = 0; face < 4; face++) towerWall(batch, tex, face, hw, hd, y, t.floors);
      y += t.floors * FLOOR_H;
    }
    batch.roof(roof, hw, hd, y);
  });
  batch.build(group);
  return group;
}

export function disposeBuildings(): void {
  for (const g of activeGeometries) g.dispose();
  activeGeometries.length = 0;
}
