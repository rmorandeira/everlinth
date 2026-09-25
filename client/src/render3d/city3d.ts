// Mobiliario urbano del bioma "city" (1 tile ≈ 1,5 m; 1 unidad de render = 3 m,
// ver TILE_SIZE). El suelo (asfalto / acera / solar) ya viene en los tiles
// Road/Sidewalk/Path que genera el servidor a partir de cityAt (shared); aquí solo
// se añade lo que va encima, celda a celda según cityAt: línea central de las
// calles de doble sentido, flechas en las de sentido único, pasos de cebra junto a
// los cruces, farolas, árboles de acera, coches aparcados y árboles de parque.
// Todo se deduce de coordenadas GLOBALES de tile, así que una sala se ve igual
// desde cualquier vecina. Las piezas se fusionan por material (unas pocas mallas
// por sala).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, TILE_SIZE, cityAt, type CityCellInfo } from "@roi/shared";

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
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

// Piezas en unidades de render (ya convertidas a partir de tiles).
function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number, basic = false): THREE.Mesh {
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

// Flecha de sentido único: vástago + dos alas, apuntando a +X (horiz) o ±Z.
function arrow(g: THREE.Group, x: number, z: number, horiz: boolean, dir: number): void {
  const a = new THREE.Group();
  a.position.set(x * T, 0, z * T);
  a.rotation.y = horiz ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  box(a, 1.4 * T, 0.008, 0.2 * T, 0, MARK_Y, 0, PAINT_WHITE);
  for (const s of [-1, 1]) {
    const wing = box(a, 0.8 * T, 0.008, 0.18 * T, 0.5 * T, MARK_Y, s * 0.18 * T, PAINT_WHITE);
    wing.rotation.y = s * 0.7;
  }
  g.add(a);
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

function tree(g: THREE.Group, x: number, z: number, color: number, scale: number): void {
  const px = x * T;
  const pz = z * T;
  const trunk = new THREE.Mesh(cylGeo, lambert(0x5a4030));
  trunk.scale.set(0.1 * scale, 0.6 * scale, 0.1 * scale);
  trunk.position.set(px, 0.05, pz);
  g.add(trunk);
  const crown = new THREE.Mesh(crownGeo, lambert(color));
  crown.scale.set(0.7 * scale, 0.75 * scale, 0.7 * scale);
  crown.position.set(px, 0.95 * scale, pz);
  g.add(crown);
}

// Una sala tiene cientos de piezas sueltas: se fusionan por material en unas pocas
// mallas para no gastar un draw call (y otro de sombra) por pieza.
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

const NEIGHBORS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// tiles: rejilla de la sala; (offsetX, offsetZ): origen de la sala en tiles respecto
// a la sala activa; (gx0, gz0): origen de la sala en tiles GLOBALES.
export function buildCityProps(tiles: TileType[][], offsetX: number, offsetZ: number, gx0: number, gz0: number): THREE.Group | null {
  let hasRoad = false;
  for (const row of tiles) if (row.includes(TileType.Road)) hasRoad = true;
  if (!hasRoad) return null;

  const W = SCREEN_WIDTH;
  const H = SCREEN_HEIGHT;
  // Celdas con 2 tiles de borde para consultar vecinos (cruces junto a la sala).
  const B = 2;
  const stride = W + 2 * B;
  const infos: CityCellInfo[] = new Array(stride * (H + 2 * B));
  for (let r = -B; r < H + B; r++) for (let c = -B; c < W + B; c++) infos[(r + B) * stride + c + B] = cityAt(gx0 + c, gz0 + r);
  const at = (c: number, r: number): CityCellInfo => infos[(r + B) * stride + c + B];

  const g = new THREE.Group();
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const c = at(col, row);
      const gx = gx0 + col;
      const gy = gz0 + row;

      if (c.kind === "road" && (c.axis === "h" || c.axis === "v")) {
        const horiz = c.axis === "h";
        const a = horiz ? gx : gy; // coordenada a lo largo de la calle
        const q = horiz ? gy : gx; // coordenada a través
        const dq = q - c.lineCenter;

        if (dq === 0) {
          if (!c.oneWay) {
            if (mod(a, 4) < 2) {
              if (horiz) paint(g, 1, 0.14, col, row, PAINT_YELLOW);
              else paint(g, 0.14, 1, col, row, PAINT_YELLOW);
            }
          } else if (mod(a, 14) === 7) {
            arrow(g, col, row, horiz, c.dir);
          }
        } else if (c.lineHalf >= 4 && Math.abs(dq) === 2 && mod(a, 4) < 2) {
          // separación de carriles en las avenidas anchas
          if (horiz) paint(g, 1, 0.1, col, row, PAINT_WHITE);
          else paint(g, 0.1, 1, col, row, PAINT_WHITE);
        }

        // Paso de cebra en las dos celdas contiguas a un cruce.
        let nearX = false;
        for (const s of [-2, -1, 1, 2]) {
          const n = horiz ? at(col + s, row) : at(col, row + s);
          if (n.axis === "x") nearX = true;
        }
        if (nearX) {
          if (mod(q - (c.lineCenter - c.lineHalf), 2) === 0) {
            if (horiz) paint(g, 1, 0.55, col, row, PAINT_WHITE);
            else paint(g, 0.55, 1, col, row, PAINT_WHITE);
          }
        } else if (Math.abs(dq) === c.lineHalf && mod(a, 7) === 3) {
          // Coche aparcado junto al bordillo (a veces).
          const h = hash2(gx + 0.31, gy + 0.77);
          if (h > 0.55) {
            const inward = -Math.sign(dq) * 0.1;
            car(g, col + (horiz ? 0 : inward), row + (horiz ? inward : 0), horiz, CAR_COLORS[Math.floor(h * 97) % CAR_COLORS.length]);
          }
        }
      } else if (c.kind === "sidewalk") {
        let dirX = 0;
        let dirZ = 0;
        for (const [dx, dz] of NEIGHBORS) {
          if (at(col + dx, row + dz).kind === "road") {
            dirX = dx;
            dirZ = dz;
            break;
          }
        }
        if (dirX !== 0 || dirZ !== 0) {
          if (mod(gx * 3 + gy * 7, 16) === 0) streetlight(g, col, row, dirX, dirZ);
          else if (mod(gx * 5 + gy * 3, 11) === 0 && hash2(gx, gy) > 0.3) tree(g, col, row, CROWNS[Math.floor(hash2(gy, gx) * 97) % CROWNS.length], 1);
        }
      } else if (c.kind === "lot" && c.park) {
        const h = hash2(gx + 5.5, gy + 1.1);
        if (h > 0.9) tree(g, col, row, CROWNS[Math.floor(h * 971) % CROWNS.length], 1.3);
      }
    }
  }

  const merged = mergeByMaterial(g);
  merged.position.set(offsetX * T, 0, offsetZ * T);
  return merged;
}
