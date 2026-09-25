// Mobiliario urbano del bioma "city" (1 tile ≈ 1,5 m; 1 unidad de render = 3 m,
// ver TILE_SIZE). El suelo (asfalto / acera / parcela) ya viene en los tiles
// Road/Sidewalk que genera el servidor a partir de cityCell (shared); aquí solo
// se añade lo que va encima: línea central discontinua, pasos de cebra en el
// cruce, farolas, árboles de acera y coches aparcados. Todo se deduce de la
// posición local (col,row): cada sala es exactamente una manzana (ver cityCell),
// así que no hace falta ningún dato extra del servidor. Los hashes usan
// coordenadas GLOBALES para que la sala se vea igual desde cualquier vecina.
// Geometría y materiales compartidos: nada que liberar.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, TILE_SIZE, CITY_STREET_SIZE, CITY_ROAD_MIN, CITY_ROAD_MAX } from "@roi/shared";

const T = TILE_SIZE;
const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0);
const crownGeo = new THREE.IcosahedronGeometry(0.5, 0);

const mats = new Map<number, THREE.MeshLambertMaterial>();
function lambert(color: number): THREE.MeshLambertMaterial {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    mats.set(color, m);
  }
  return m;
}
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });

const PAINT_WHITE = 0xe8e6de;
const PAINT_YELLOW = 0xe0b81a;
const CAR_COLORS = [0x2f6d9a, 0xc0392b, 0xe9e8e3, 0x111216, 0xb2b5b8, 0xf5c518, 0x3a8a4f, 0x571f1f];
const CROWNS = [0x4f8a3a, 0x6aa04a, 0x3f7a4a, 0x86a94a];

const MARK_Y = 0.055; // justo por encima de la cara superior del suelo (y=0.05)

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// Todas las posiciones/tamaños de estas funciones van en TILES (coordenadas de
// sala); se convierten a unidades de render al crear la malla.
function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: number, basic = false): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, basic ? lampMat : lambert(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// Marca de pintura sobre el asfalto (w a lo largo de X, d a lo largo de Z; en tiles).
function paint(g: THREE.Group, w: number, d: number, x: number, z: number, color: number): void {
  box(g, w * T, 0.008, d * T, x * T, MARK_Y, z * T, color);
}

// Coche de ~4.5×1.9 m → 1.5×0.62 unidades. alongX: circula a lo largo de X.
function car(g: THREE.Group, x: number, z: number, alongX: boolean, color: number): void {
  const c = new THREE.Group();
  box(c, 1.5, 0.3, 0.62, 0, 0.06, 0, color);
  box(c, 0.8, 0.26, 0.56, -0.05, 0.36, 0, color);
  box(c, 0.82, 0.16, 0.58, -0.05, 0.4, 0, 0x26323f);
  box(c, 1.52, 0.09, 0.64, 0, 0.04, 0, 0x1a1a1a);
  c.position.set(x * T, 0.05, z * T);
  if (!alongX) c.rotation.y = Math.PI / 2;
  g.add(c);
}

// Farola de ~6 m → 2 unidades de alto; el brazo sale hacia la calzada (dirX/dirZ).
function streetlight(g: THREE.Group, x: number, z: number, dirX: number, dirZ: number): void {
  const px = x * T;
  const pz = z * T;
  const pole = new THREE.Mesh(cylGeo, lambert(0x3d4248));
  pole.scale.set(0.09, 2.0, 0.09);
  pole.position.set(px, 0.05, pz);
  g.add(pole);
  box(g, dirX !== 0 ? 0.6 : 0.06, 0.06, dirZ !== 0 ? 0.6 : 0.06, px + dirX * 0.3, 2.0, pz + dirZ * 0.3, 0x3d4248);
  box(g, 0.2, 0.06, 0.2, px + dirX * 0.6, 1.96, pz + dirZ * 0.6, 0, true);
}

// Árbol de acera: tronco fino y copa de poliedro.
function streetTree(g: THREE.Group, x: number, z: number, color: number): void {
  const px = x * T;
  const pz = z * T;
  const trunk = new THREE.Mesh(cylGeo, lambert(0x5a4030));
  trunk.scale.set(0.1, 0.6, 0.1);
  trunk.position.set(px, 0.05, pz);
  g.add(trunk);
  const crown = new THREE.Mesh(crownGeo, lambert(color));
  crown.scale.set(0.7, 0.75, 0.7);
  crown.position.set(px, 0.95, pz);
  g.add(crown);
}

// Una sala tiene cientos de piezas sueltas (marcas, farolas, coches…): se fusionan por
// material en unas pocas mallas para no gastar un draw call (y otro de sombra) por pieza.
function mergeByMaterial(src: THREE.Group): THREE.Group {
  src.updateMatrixWorld(true);
  const lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    const mat = mesh.material as THREE.Material;
    let l = lists.get(mat);
    if (!l) lists.set(mat, (l = []));
    l.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, list] of lists) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (merged) {
      const m = new THREE.Mesh(merged, mat);
      m.userData.ownGeometry = true; // único de esta sala: scene3d lo libera al cambiar de pantalla
      out.add(m);
    }
  }
  return out;
}

// tiles: rejilla de la sala; (offsetX, offsetZ): origen de la sala en tiles respecto
// a la sala activa; (gx0, gz0): origen de la sala en tiles GLOBALES (para los hashes).
export function buildCityProps(tiles: TileType[][], offsetX: number, offsetZ: number, gx0: number, gz0: number): THREE.Group | null {
  let hasRoad = false;
  for (const row of tiles) if (row.includes(TileType.Road)) hasRoad = true;
  if (!hasRoad) return null;

  const g = new THREE.Group();
  const S = CITY_STREET_SIZE;
  const W = SCREEN_WIDTH;
  const H = SCREEN_HEIGHT;
  const roadLo = CITY_ROAD_MIN - 0.5; // borde de la calzada en coordenadas de tile
  const roadHi = CITY_ROAD_MAX + 0.5;
  const mid = (roadLo + roadHi) / 2;
  const roadW = roadHi - roadLo;

  // Línea central discontinua de cada calle, salvo dentro del cruce.
  for (let x = roadHi + 1; x < W; x += 2.5) paint(g, 1.2, 0.14, x, mid, PAINT_YELLOW);
  for (let z = roadHi + 1; z < H; z += 2.5) paint(g, 0.14, 1.2, mid, z, PAINT_YELLOW);
  for (let x = 0.5; x < roadLo - 0.5; x += 2.5) paint(g, 1.2, 0.14, x, mid, PAINT_YELLOW);
  for (let z = 0.5; z < roadLo - 0.5; z += 2.5) paint(g, 0.14, 1.2, mid, z, PAINT_YELLOW);

  // Pasos de cebra en los cuatro brazos del cruce.
  const stripes = Math.floor(roadW / 0.75);
  for (const cx of [1, 8]) {
    for (let i = 0; i < stripes; i++) paint(g, 1.2, 0.38, cx, roadLo + 0.375 + i * 0.75, PAINT_WHITE);
  }
  for (const cz of [1, 8]) {
    for (let i = 0; i < stripes; i++) paint(g, 0.38, 1.2, roadLo + 0.375 + i * 0.75, cz, PAINT_WHITE);
  }

  // Farolas alternadas a ambos lados de cada calle, con el brazo hacia la calzada.
  for (let x = S + 4; x < W - 3; x += 12) streetlight(g, x, 8.6, 0, -1); // acera sur de la calle E-O
  for (let x = S + 10; x < W - 3; x += 12) streetlight(g, x, 0.4, 0, 1); // acera norte
  for (let z = S + 4; z < H - 2; z += 10) streetlight(g, 8.6, z, -1, 0); // acera este de la calle N-S
  for (let z = S + 9; z < H - 2; z += 10) streetlight(g, 0.4, z, 1, 0); // acera oeste
  streetlight(g, 8.6, 8.6, -1, 0);
  streetlight(g, 0.4, 0.4, 1, 0);

  // Árboles de acera intercalados con las farolas.
  for (let x = S + 1; x < W - 1; x += 6) {
    const h = hash2(gx0 + x, gz0 + 1.7);
    if (h > 0.25) streetTree(g, x, 9.1, CROWNS[Math.floor(h * 97) % CROWNS.length]);
  }
  for (let z = S + 1; z < H - 1; z += 6) {
    const h = hash2(gx0 + 2.3, gz0 + z);
    if (h > 0.25) streetTree(g, 9.1, z, CROWNS[Math.floor(h * 89) % CROWNS.length]);
  }

  // Coches aparcados junto a los bordillos de las dos calles.
  let lastX = -99;
  for (let x = S + 2; x < W - 3; x += 1) {
    if (x - lastX < 5) continue;
    const h = hash2(gx0 + x, gz0 + 1.3);
    if (h > 0.5) {
      car(g, x, roadHi - 1.2, true, CAR_COLORS[Math.floor(h * 97) % CAR_COLORS.length]);
      lastX = x;
    }
  }
  lastX = -99;
  for (let x = S + 2; x < W - 3; x += 1) {
    if (x - lastX < 6) continue;
    const h = hash2(gx0 + x, gz0 + 8.9);
    if (h > 0.6) {
      car(g, x, roadLo + 1.2, true, CAR_COLORS[Math.floor(h * 71) % CAR_COLORS.length]);
      lastX = x;
    }
  }
  let lastZ = -99;
  for (let z = S + 2; z < H - 2; z += 1) {
    if (z - lastZ < 5) continue;
    const h = hash2(gx0 + 2.7, gz0 + z);
    if (h > 0.5) {
      car(g, roadHi - 1.2, z, false, CAR_COLORS[Math.floor(h * 89) % CAR_COLORS.length]);
      lastZ = z;
    }
  }
  const merged = mergeByMaterial(g);
  merged.position.set(offsetX * T, 0, offsetZ * T);
  return merged;
}
