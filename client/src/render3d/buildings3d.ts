// Edificios hechos SOLO de planos (quads): muros verticales y azoteas planas, con
// fotos de fachada de assets/buildings como textura (ver tools/textures/build.mjs,
// que las reduce a 512 px y genera public/textures/buildings/manifest.json).
//
// Cada edificio es uno o varios prismas extruidos de un polígono de planta, así que
// admite chaflanes (esquinas cortadas a 45°), octógonos, plantas en L, podios con
// una o dos torres y rascacielos escalonados:
// - Base: una franja de planta baja (escaparate/persiana/nave) distinta por lado.
// - Muros: una textura "tower" (rejilla de ventanas de varias plantas) repetida en
//   vertical tantas veces como plantas tenga el bloque; el manifest dice cuántas
//   plantas enseña cada foto, así una ventana mide siempre ≈ una planta (3 m).
// - Azoteas: planos de color con detalles (depósitos de agua, casetas, climatizadores).
// - Naves y casas bajas usan una fachada "lowrise" entera, sin repetir en vertical.
//
// Todos los planos de un edificio se fusionan por material: un edificio son unas
// pocas mallas, no cientos. Los materiales (y sus texturas) se comparten.
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
    // Gris liso hasta que llega la foto (un mapa sin cargar se pintaría negro).
    m = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });
    const mat = m;
    loader.load(`${TEX_DIR}/${id}.jpg`, (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 4;
      mat.map = map;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    });
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

type P = [number, number]; // (x, z)

class PlaneBatch {
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();

  private add(mat: THREE.Material, g: THREE.BufferGeometry): void {
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(g);
  }

  // Muro vertical sobre la arista p→q (la normal saliente es (ez, -ex): los
  // polígonos van en el sentido en que esa normal apunta hacia fuera), de alto h,
  // con la textura repetida (nx × ny) veces.
  wall(mat: THREE.Material, p: P, q: P, y0: number, h: number, nx: number, ny: number): void {
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const len = Math.hypot(ex, ez);
    if (len < 1e-4) return;
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * nx, uv.getY(i) * ny);
    const m = new THREE.Matrix4();
    m.makeRotationY(Math.atan2(ez / len, -ex / len));
    m.setPosition((p[0] + q[0]) / 2, y0 + h / 2, (p[1] + q[1]) / 2);
    g.applyMatrix4(m);
    this.add(mat, g);
  }

  // Azotea plana: el polígono relleno a altura y (mira hacia arriba).
  roof(mat: THREE.Material, pts: P[], y: number): void {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
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

// ---- Polígonos de planta ----

// Rectángulo (semiancho hw, semifondo hd, centro cx,cz) con esquinas achaflanadas.
// Esquinas en orden NO, NE, SE, SO; c[i] = longitud del chaflán (0 = esquina viva).
function rectPoly(hw: number, hd: number, cx: number, cz: number, c: number[]): P[] {
  const corners: P[] = [
    [cx - hw, cz - hd],
    [cx + hw, cz - hd],
    [cx + hw, cz + hd],
    [cx - hw, cz + hd],
  ];
  const out: P[] = [];
  for (let i = 0; i < 4; i++) {
    const cur = corners[i];
    if (c[i] <= 0) {
      out.push(cur);
      continue;
    }
    const prev = corners[(i + 3) % 4];
    const next = corners[(i + 1) % 4];
    const dp = Math.hypot(prev[0] - cur[0], prev[1] - cur[1]);
    const dn = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    out.push([cur[0] + ((prev[0] - cur[0]) / dp) * c[i], cur[1] + ((prev[1] - cur[1]) / dp) * c[i]]);
    out.push([cur[0] + ((next[0] - cur[0]) / dn) * c[i], cur[1] + ((next[1] - cur[1]) / dn) * c[i]]);
  }
  return out;
}

// Polígono regular (elíptico) de n lados, en el mismo sentido que rectPoly.
function ngonPoly(n: number, rx: number, rz: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
    out.push([Math.cos(a) * rx, Math.sin(a) * rz]);
  }
  return out;
}

function scalePoly(pts: P[], k: number): P[] {
  return pts.map(([x, z]) => [x * k, z * k] as P);
}

function shiftPoly(pts: P[], dx: number, dz: number): P[] {
  return pts.map(([x, z]) => [x + dx, z + dz] as P);
}

// ---- Muros según el tipo de textura ----

// Repeticiones de una textura sobre un muro de ancho W: si cabe más de 1,5 veces se
// redondea (un pelín de estiramiento, sin cortes de ventana); si no, se recorta.
function repeatsAcross(W: number, tileW: number): number {
  const r = W / tileW;
  return r >= 1.5 ? Math.round(r) : r;
}

function edgeLen(p: P, q: P): number {
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
}

// Extruye un polígono con textura "tower": ground = con franja de planta baja
// (foto de escaparate distinta por arista); si no, arranca en y0 sin ella.
// Devuelve la altura de la azotea (que también rellena).
function extrudeTower(b: PlaneBatch, pts: P[], y0: number, floors: number, tex: TexMeta, ground: boolean, seed: number, roof: THREE.Material): number {
  const tileH = tex.floors * FLOOR_H;
  const tileW = tileH * (tex.w / tex.h);
  const upperFloors = ground ? floors - 1 : floors;
  const upperY = ground ? y0 + GROUND_H : y0;
  const mat = texMaterial(tex.id);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const len = edgeLen(p, q);
    if (ground) {
      const gt = pick(byCat.ground, hash2(seed + i * 1.7, seed * 0.3 + 0.5));
      const gw = GROUND_H * (gt.w / gt.h);
      b.wall(texMaterial(gt.id), p, q, y0, GROUND_H, repeatsAcross(len, gw), 1);
    }
    if (upperFloors > 0) b.wall(mat, p, q, upperY, upperFloors * FLOOR_H, repeatsAcross(len, tileW), upperFloors / tex.floors);
  }
  const top = upperY + Math.max(0, upperFloors) * FLOOR_H;
  b.roof(roof, pts, top);
  return top;
}

// Fachada completa (naves, casas): la foto entera, sin repetir en vertical.
function extrudeLowrise(b: PlaneBatch, pts: P[], tex: TexMeta, roof: THREE.Material): number {
  const tileH = tex.floors * FLOOR_H;
  const tileW = tileH * (tex.w / tex.h);
  const mat = texMaterial(tex.id);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    b.wall(mat, p, q, 0, tileH, repeatsAcross(edgeLen(p, q), tileW), 1);
  }
  b.roof(roof, pts, tileH);
  return tileH;
}

// ---- Detalles de azotea (depósitos, climatizadores, casetas) ----

const DECOR_COLORS = [0x8a8f96, 0x6d7278, 0x9a7a5a, 0x5f6468, 0xa8a49a];
const flatMats = new Map<number, THREE.MeshLambertMaterial>();
function flatMat(color: number): THREE.MeshLambertMaterial {
  let m = flatMats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    m.shadowSide = THREE.DoubleSide;
    flatMats.set(color, m);
  }
  return m;
}

function flatPrism(b: PlaneBatch, pts: P[], y0: number, h: number, wallColor: number, topColor: number): void {
  const wm = flatMat(wallColor);
  for (let i = 0; i < pts.length; i++) b.wall(wm, pts[i], pts[(i + 1) % pts.length], y0, h, 1, 1);
  b.roof(flatMat(topColor), pts, y0 + h);
}

function roofDecor(b: PlaneBatch, top: number, hx: number, hz: number, seed: number): void {
  const count = Math.floor(hash2(seed, 1.3) * 4); // 0-3
  for (let i = 0; i < count; i++) {
    const r1 = hash2(seed + i, 2.7);
    const r2 = hash2(seed + i, 5.1);
    const r3 = hash2(seed + i, 8.9);
    const cx = (r1 * 2 - 1) * Math.max(0, hx - 0.45);
    const cz = (r2 * 2 - 1) * Math.max(0, hz - 0.45);
    if (r3 < 0.3) {
      // depósito de agua: prisma octogonal marrón
      flatPrism(b, shiftPoly(ngonPoly(8, 0.2, 0.2), cx, cz), top, 0.55, 0x7a5a44, 0x55402f);
    } else if (r3 < 0.65) {
      // caseta de escalera / máquinas
      flatPrism(b, rectPoly(0.32 + r1 * 0.2, 0.28 + r2 * 0.2, cx, cz, [0, 0, 0, 0]), top, 0.32, pick(DECOR_COLORS, r3 * 7.3), 0x585d63);
    } else {
      // climatizador
      flatPrism(b, rectPoly(0.22, 0.14, cx, cz, [0, 0, 0, 0]), top, 0.16, 0x9aa0a6, 0x7d838a);
    }
  }
}

// Textura "tower" adecuada a un bloque de `floors` plantas: prefiere las que enseñan
// como mucho esas plantas (para no recortar la foto por arriba).
function chooseTower(floors: number, n: number): TexMeta {
  const fit = byCat.tower.filter((t) => t.floors <= floors + 1);
  return pick(fit.length > 0 ? fit : byCat.tower, n);
}

// globalX/globalZ: esquina superior-izquierda del edificio en tiles GLOBALES del
// mundo (así el mismo edificio sale idéntico visto desde su sala o desde una
// vecina). wTiles×dTiles: huella en tiles. urban: sala de ciudad. Devuelve un
// Group centrado en el origen, base en y=0.
export function buildBuilding(globalX: number, globalZ: number, wTiles: number, dTiles: number, urban: boolean): THREE.Group {
  const group = new THREE.Group();
  if (!ready) return group;
  const n = hash2(globalX + 0.33, globalZ + 0.77);
  const n2 = hash2(globalX + 9.1, globalZ + 4.7);
  const n3 = hash2(globalX + 3.9, globalZ + 7.3);
  const n4 = hash2(globalX + 6.2, globalZ + 1.9);
  const seed = globalX * 0.37 + globalZ * 0.91;
  const batch = new PlaneBatch();

  const hw = (wTiles * TILE_SIZE * 0.98) / 2;
  const hd = (dTiles * TILE_SIZE * 0.98) / 2;
  const roof = roofMaterial(pick(ROOF_COLORS, n3));

  // Chaflanes: cada esquina se corta a 45° con probabilidad 1/2.
  const cut = Math.min(hw, hd) * 0.32;
  const chamfers = [0, 1, 2, 3].map((i) => (hash2(globalX + i * 1.3, globalZ - i * 0.7 + 2) > 0.5 ? cut : 0));

  // Nave / casa baja: una sola fachada entera en los cuatro lados.
  if (!urban || n2 < 0.1) {
    const pts = urban ? rectPoly(hw, hd, 0, 0, chamfers) : rectPoly(Math.min(hw, hd), Math.min(hw, hd), 0, 0, [0, 0, 0, 0]);
    extrudeLowrise(batch, pts, pick(byCat.lowrise, n), roof);
    batch.build(group);
    return group;
  }

  // Altura: mayoría de medianos y algunos rascacielos; los muy anchos suben más.
  const area = wTiles * dTiles;
  const floors = 5 + Math.floor(Math.pow(n2, 1.8) * (area >= 110 ? 24 : 14));
  const tex = chooseTower(Math.max(3, Math.min(floors, 8)), n);
  const sxs = n4 < 0.5 ? 1 : -1; // espejo de las formas asimétricas
  const szs = n3 < 0.5 ? 1 : -1;
  const shape = n < 0.34 ? "tiers" : n < 0.5 ? "octagon" : n < 0.66 ? "ell" : n < 0.82 ? "podium" : "slab";

  let topY = 0;
  let decorHx = hw * 0.6;
  let decorHz = hd * 0.6;

  if (shape === "octagon" && Math.min(hw, hd) > 1.4) {
    const base = ngonPoly(8, hw, hd);
    const f0 = Math.max(3, Math.round(floors * 0.65));
    topY = extrudeTower(batch, base, 0, f0, tex, true, seed, roof);
    if (floors - f0 >= 2) {
      topY = extrudeTower(batch, scalePoly(base, 0.62), topY, floors - f0, tex, false, seed, roof);
      decorHx = hw * 0.35;
      decorHz = hd * 0.35;
    }
  } else if (shape === "ell") {
    // Ala principal alta + ala más baja formando una L (espejo aleatorio).
    const main = rectPoly(hw, hd * 0.55, 0, -hd * 0.45 * szs, chamfers.map((c) => c * 0.8));
    const wing = rectPoly(hw * 0.5, hd, -hw * 0.5 * sxs, 0, [0, 0, 0, 0]);
    extrudeTower(batch, wing, 0, Math.max(3, Math.round(floors * 0.55)), tex, true, seed + 3, roof);
    topY = extrudeTower(batch, main, 0, floors, tex, true, seed, roof);
    decorHx = hw * 0.8;
    decorHz = hd * 0.3;
  } else if (shape === "podium") {
    const podF = 3;
    extrudeTower(batch, rectPoly(hw, hd, 0, 0, chamfers), 0, podF, tex, true, seed, roof);
    const two = area >= 110 && n4 > 0.4;
    const tw = two ? hw * 0.42 : hw * 0.62;
    const y = GROUND_H + (podF - 1) * FLOOR_H;
    const towerFloors = Math.max(2, floors - podF);
    topY = extrudeTower(batch, rectPoly(tw, hd * 0.62, two ? -hw * 0.5 : 0, 0, [cut * 0.5, 0, cut * 0.5, 0]), y, towerFloors, tex, false, seed + 1, roof);
    if (two) {
      extrudeTower(batch, rectPoly(tw, hd * 0.62, hw * 0.5, 0, [0, cut * 0.5, 0, cut * 0.5]), y, Math.max(2, Math.round(towerFloors * 0.7)), tex, false, seed + 2, roof);
    }
    decorHx = tw * 0.9;
    decorHz = hd * 0.5;
  } else if (shape === "tiers" && floors >= 10) {
    const f0 = Math.round(floors * 0.55);
    const f1 = Math.round(floors * 0.3);
    const base = rectPoly(hw, hd, 0, 0, chamfers);
    topY = extrudeTower(batch, base, 0, f0, tex, true, seed, roof);
    topY = extrudeTower(batch, scalePoly(base, 0.72), topY, f1, tex, false, seed + 1, roof);
    topY = extrudeTower(batch, scalePoly(base, 0.46), topY, Math.max(2, floors - f0 - f1), tex, false, seed + 2, roof);
    decorHx = hw * 0.35;
    decorHz = hd * 0.35;
  } else {
    topY = extrudeTower(batch, rectPoly(hw, hd, 0, 0, chamfers), 0, floors, tex, true, seed, roof);
  }
  roofDecor(batch, topY, decorHx, decorHz, seed);
  batch.build(group);
  return group;
}

export function disposeBuildings(): void {
  for (const g of activeGeometries) g.dispose();
  activeGeometries.length = 0;
}
