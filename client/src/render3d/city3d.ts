// Mobiliario urbano del bioma "city" (escala realista: 1 tile ≈ 3 m). El suelo
// (asfalto / acera / parcela) ya viene en los tiles Road/Sidewalk que genera el
// servidor a partir de cityCell (shared); aquí solo se añade lo que va encima:
// línea central discontinua, pasos de cebra en los cruces, farolas y coches
// aparcados. Todo se deduce de la posición local (col,row) porque cada sala es
// exactamente una manzana (ver cityCell), así que no hace falta ningún dato
// extra del servidor. Geometría y materiales compartidos: nada que liberar.
import * as THREE from "three";
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, CITY_STREET_SIZE } from "@roi/shared";

const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0);

const mats = new Map<number, THREE.MeshLambertMaterial>();
function lambert(color: number): THREE.MeshLambertMaterial {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    mats.set(color, m);
  }
  return m;
}
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });

const PAINT_WHITE = 0xe8e6de;
const PAINT_YELLOW = 0xe0b81a;
const CAR_COLORS = [0x2f6d9a, 0xc0392b, 0xe9e8e3, 0x111216, 0xb2b5b8, 0xf5c518, 0x3a8a4f, 0x571f1f];

const MARK_Y = 0.055; // justo por encima de la cara superior del suelo (y=0.05)

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: number, basic = false): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, basic ? lampMat : lambert(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function paint(g: THREE.Group, w: number, d: number, x: number, z: number, color: number): void {
  box(g, w, 0.008, d, x, MARK_Y, z, color);
}

// Coche de ~4.5×1.9 m → 1.5×0.62 tiles. alongX: circula a lo largo de X (calle horizontal).
function car(g: THREE.Group, x: number, z: number, alongX: boolean, color: number): void {
  const c = new THREE.Group();
  box(c, 1.5, 0.3, 0.62, 0, 0.06, 0, color); // carrocería
  box(c, 0.8, 0.26, 0.56, -0.05, 0.36, 0, color); // cabina
  box(c, 0.82, 0.16, 0.58, -0.05, 0.4, 0, 0x26323f); // cristales
  box(c, 1.52, 0.09, 0.64, 0, 0.04, 0, 0x1a1a1a); // bajos/ruedas
  c.position.set(x, 0.05, z);
  if (!alongX) c.rotation.y = Math.PI / 2;
  g.add(c);
}

// Farola de ~6 m → 2 tiles de alto; el brazo sale hacia la calzada (dirX/dirZ).
function streetlight(g: THREE.Group, x: number, z: number, dirX: number, dirZ: number): void {
  const pole = new THREE.Mesh(cylGeo, lambert(0x3d4248));
  pole.scale.set(0.09, 2.0, 0.09);
  pole.position.set(x, 0.05, z);
  g.add(pole);
  box(g, dirX !== 0 ? 0.6 : 0.06, 0.06, dirZ !== 0 ? 0.6 : 0.06, x + dirX * 0.3, 2.0, z + dirZ * 0.3, 0x3d4248);
  box(g, 0.2, 0.06, 0.2, x + dirX * 0.6, 1.96, z + dirZ * 0.6, 0, true);
}

export function buildCityProps(tiles: TileType[][], offsetX: number, offsetZ: number): THREE.Group | null {
  let hasRoad = false;
  for (const row of tiles) if (row.includes(TileType.Road)) hasRoad = true;
  if (!hasRoad) return null;

  const g = new THREE.Group();
  g.position.set(offsetX, 0, offsetZ);
  const S = CITY_STREET_SIZE;
  const roadLo = 0.5; // borde de la calzada, en coordenadas de tile (tiles 1..2 → 0.5..2.5)
  const roadMid = 1.5;

  // Línea central discontinua de cada calle (fuera del cruce y de los pasos de cebra).
  for (let col = S + 1; col <= SCREEN_WIDTH - 2; col++) paint(g, 0.5, 0.07, col, roadMid, PAINT_YELLOW);
  for (let row = S + 1; row <= SCREEN_HEIGHT - 2; row++) paint(g, 0.07, 0.5, roadMid, row, PAINT_YELLOW);

  // Pasos de cebra en los cuatro brazos del cruce.
  for (const col of [S, SCREEN_WIDTH - 1]) {
    for (let i = 0; i < 4; i++) paint(g, 0.6, 0.2, col, roadLo + 0.25 + i * 0.5, PAINT_WHITE);
  }
  for (const row of [S, SCREEN_HEIGHT - 1]) {
    for (let i = 0; i < 4; i++) paint(g, 0.2, 0.6, roadLo + 0.25 + i * 0.5, row, PAINT_WHITE);
  }

  // Farolas en las aceras, con el brazo hacia la calzada.
  streetlight(g, S - 1, S - 1, -1, 0);
  streetlight(g, S + 6, S - 1, 0, -1);
  streetlight(g, S - 1, SCREEN_HEIGHT - 1, -1, 0);

  // Coches aparcados en el carril junto al bordillo de cada calle.
  let lastCol = -9;
  for (let col = S + 2; col <= SCREEN_WIDTH - 3; col++) {
    if (col - lastCol < 3) continue;
    const h = hash2(col + offsetX, offsetZ + 1.3);
    if (h > 0.6) {
      car(g, col, 2, true, CAR_COLORS[Math.floor(h * 97) % CAR_COLORS.length]);
      lastCol = col;
    }
  }
  let lastRow = -9;
  for (let row = S + 1; row <= SCREEN_HEIGHT - 3; row++) {
    if (row - lastRow < 3) continue;
    const h = hash2(offsetX + 2.7, row + offsetZ);
    if (h > 0.55) {
      car(g, 2, row, false, CAR_COLORS[Math.floor(h * 89) % CAR_COLORS.length]);
      lastRow = row;
    }
  }
  return g;
}
