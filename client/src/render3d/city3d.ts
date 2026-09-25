// Ciudad vectorial (bioma "city"): el servidor genera calles y edificios con
// MapGenerator (server/src/citygen) y manda la geometría de cada sala (ver CityData
// en shared). Aquí se dibuja de verdad, sin pasar por la rejilla de tiles, para que
// las calles diagonales y curvas salgan limpias:
// - Calles: cintas (bordillo + asfalto) por segmento, con discos en las uniones.
// - Marcas: línea central discontinua (amarilla en avenidas, blanca en calles de
//   doble sentido), flechas en las de sentido único, carriles en avenidas y pasos
//   de cebra junto a los cruces.
// - Mobiliario: farolas, árboles de acera y coches aparcados a lo largo de las calles.
// - Edificios: polígonos de planta extruidos (buildings3d.buildPolygonBuilding).
// Todo va en coordenadas GLOBALES de tile, así que una sala y sus vecinas encajan
// sin costuras; los segmentos/cruces repetidos entre salas se deduplican por id.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TILE_SIZE, CITY_ROAD_HALF, type CityData, type CityRoad } from "@roi/shared";
import { buildPolygonBuilding } from "./buildings3d.js";

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

const ASPHALT = 0x3a3d42;
const CURB = 0x8a867d;
const PAINT_WHITE = 0xe8e6de;
const PAINT_YELLOW = 0xe0b81a;
const CAR_COLORS = [0x2f6d9a, 0xc0392b, 0xe9e8e3, 0x111216, 0xb2b5b8, 0xf5c518, 0x3a8a4f, 0x571f1f];
const CROWNS = [0x4f8a3a, 0x6aa04a, 0x3f7a4a, 0x86a94a];

// Alturas de las capas del suelo de la calle (el suelo de tiles está en y=0.05).
const Y_CURB = 0.056;
const Y_ASPHALT = 0.062;
const Y_PAINT = 0.068;
const CURB_W = 0.22; // tiles de bordillo a cada lado del asfalto

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return hash2(h % 9973, (h >> 8) % 7919);
}

// ---- Acumulador de geometría fusionada por material ----

class Batch {
  lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry): void {
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(g);
  }
  // Mesh suelto (farola, coche…): su geometría ya transformada, al lote.
  addObject(o: THREE.Object3D): void {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      this.add(mesh.material as THREE.Material, g);
    });
  }
  build(): THREE.Group {
    const out = new THREE.Group();
    for (const [mat, list] of this.lists) {
      const nonIdx = list.map((g) => (g.index ? g.toNonIndexed() : g));
      for (const g of nonIdx) {
        for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
      }
      const merged = mergeGeometries(nonIdx, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      m.userData.ownGeometry = true; // scene3d lo libera al cambiar de pantalla
      out.add(m);
    }
    return out;
  }
}

// Rectángulo plano (en unidades de render) centrado en (x,z), largo `len` en la
// dirección `ang` (radianes, en el plano XZ) y ancho `w`, a altura y.
function flatQuad(b: Batch, mat: THREE.Material, x: number, z: number, len: number, w: number, ang: number, y: number): void {
  const g = new THREE.PlaneGeometry(len, w).rotateX(-Math.PI / 2);
  g.rotateY(-ang);
  g.translate(x, y, z);
  b.add(mat, g);
}
function flatDisc(b: Batch, mat: THREE.Material, x: number, z: number, r: number, y: number): void {
  const g = new THREE.CircleGeometry(r, 14).rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  b.add(mat, g);
}

function car(x: number, z: number, ang: number, color: number): THREE.Object3D {
  const c = new THREE.Group();
  const part = (w: number, h: number, d: number, px: number, py: number, col: number): void => {
    const m = new THREE.Mesh(boxGeo, lambert(col));
    m.scale.set(w, h, d);
    m.position.set(px, py, 0);
    c.add(m);
  };
  part(1.5, 0.3, 0.62, 0, 0.06, color);
  part(0.8, 0.26, 0.56, -0.05, 0.36, color);
  part(0.82, 0.16, 0.58, -0.05, 0.4, 0x26323f);
  part(1.52, 0.09, 0.64, 0, 0.04, 0x1a1a1a);
  c.position.set(x, 0.05, z);
  c.rotation.y = -ang;
  return c;
}

// Farola de ~6 m (2 unidades); el brazo apunta hacia (dx,dz) (unitario).
function streetlight(x: number, z: number, dx: number, dz: number): THREE.Object3D {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(cylGeo, lambert(0x3d4248));
  pole.scale.set(0.09, 2.0, 0.09);
  pole.position.set(x, 0.05, z);
  g.add(pole);
  const arm = new THREE.Mesh(boxGeo, lambert(0x3d4248));
  arm.scale.set(0.6, 0.06, 0.06);
  arm.position.set(x + dx * 0.3, 2.0, z + dz * 0.3);
  arm.rotation.y = -Math.atan2(dz, dx);
  g.add(arm);
  const lamp = new THREE.Mesh(boxGeo, lampMat);
  lamp.scale.set(0.2, 0.06, 0.2);
  lamp.position.set(x + dx * 0.6, 1.96, z + dz * 0.6);
  g.add(lamp);
  return g;
}

function tree(x: number, z: number, color: number): THREE.Object3D {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(cylGeo, lambert(0x5a4030));
  trunk.scale.set(0.1, 0.6, 0.1);
  trunk.position.set(x, 0.05, z);
  g.add(trunk);
  const crown = new THREE.Mesh(crownGeo, lambert(color));
  crown.scale.set(0.7, 0.75, 0.7);
  crown.position.set(x, 0.95, z);
  g.add(crown);
  return g;
}

export interface CityLayer {
  group: THREE.Group;
  buildings: THREE.Group[];
}

// datas: CityData de la sala actual y sus vecinas. originGX/originGZ: tile global que
// corresponde al origen de la escena (esquina de la sala actual).
export function buildCityLayer(datas: CityData[], originGX: number, originGZ: number): CityLayer | null {
  const roads = new Map<string, CityRoad>();
  const nodes = new Map<string, [number, number]>();
  const buildingDefs = new Map<string, CityData["buildings"][number]>();
  for (const d of datas) {
    for (const r of d.roads) roads.set(r.id, r);
    for (const n of d.nodes) nodes.set(`${Math.round(n[0] * 4)},${Math.round(n[1] * 4)}`, n);
    for (const b of d.buildings) buildingDefs.set(b.id, b);
  }
  if (roads.size === 0 && buildingDefs.size === 0) return null;

  const L = (gx: number): number => (gx - originGX) * T;
  const Lz = (gz: number): number => (gz - originGZ) * T;
  const nodeList = [...nodes.values()];
  const segs = [...roads.values()];

  // Cruces: para cada nodo, las calles que pasan por él y el semiancho mayor.
  interface Cross {
    x: number;
    y: number;
    through: Array<{ seg: CityRoad; ux: number; uy: number }>;
    maxHalf: number;
  }
  const crosses: Cross[] = nodeList.map(([x, y]) => ({ x, y, through: [], maxHalf: 0 }));
  const segDist = (s: CityRoad, px: number, py: number): number => {
    const vx = s.x1 - s.x0;
    const vy = s.y1 - s.y0;
    const l2 = vx * vx + vy * vy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - s.x0) * vx + (py - s.y0) * vy) / l2)) : 0;
    return Math.hypot(px - (s.x0 + t * vx), py - (s.y0 + t * vy));
  };
  for (const c of crosses) {
    for (const s of segs) {
      if (segDist(s, c.x, c.y) > CITY_ROAD_HALF[s.kind] * 0.5 + 0.3) continue;
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) || 1;
      c.through.push({ seg: s, ux: (s.x1 - s.x0) / len, uy: (s.y1 - s.y0) / len });
      c.maxHalf = Math.max(c.maxHalf, CITY_ROAD_HALF[s.kind]);
    }
  }
  // ¿Está el punto (tiles globales) dentro de algún cruce? (para no pintar ahí marcas ni aparcar)
  const nearCross = (px: number, py: number, extra: number): boolean => {
    for (const c of crosses) if (Math.hypot(px - c.x, py - c.y) < c.maxHalf + extra) return true;
    return false;
  };

  const b = new Batch();
  const curbMat = lambert(CURB);
  const asphaltMat = lambert(ASPHALT);
  const white = lambert(PAINT_WHITE);
  const yellow = lambert(PAINT_YELLOW);

  // ---- Calzada ----
  for (const s of segs) {
    const half = CITY_ROAD_HALF[s.kind];
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const ang = Math.atan2(dy, dx);
    const mx = L((s.x0 + s.x1) / 2);
    const mz = Lz((s.y0 + s.y1) / 2);
    flatQuad(b, curbMat, mx, mz, len * T, (half + CURB_W) * 2 * T, ang, Y_CURB);
    flatQuad(b, asphaltMat, mx, mz, len * T, half * 2 * T, ang, Y_ASPHALT);
    for (const [ex, ey] of [
      [s.x0, s.y0],
      [s.x1, s.y1],
    ]) {
      flatDisc(b, curbMat, L(ex), Lz(ey), (half + CURB_W) * T, Y_CURB);
      flatDisc(b, asphaltMat, L(ex), Lz(ey), half * T, Y_ASPHALT);
    }
  }

  // ---- Marcas y mobiliario a lo largo de cada segmento ----
  for (const s of segs) {
    const half = CITY_ROAD_HALF[s.kind];
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy; // normal a la izquierda
    const ny = ux;
    const ang = Math.atan2(dy, dx);
    const lineKey = s.id.slice(0, s.id.lastIndexOf(":"));
    const oneWay = s.kind === 0 && hashStr(lineKey) < 0.5;
    const dir = hashStr(lineKey + "d") < 0.5 ? 1 : -1;

    // Posiciones a lo largo en coordenada "a" global (proyección sobre la dirección),
    // para que los discontinuos casen entre segmentos consecutivos.
    const a0 = s.x0 * ux + s.y0 * uy;
    const DASH = 2.5;
    const start = Math.ceil(a0 / DASH) * DASH - a0;
    for (let t = start; t < len; t += DASH) {
      const px = s.x0 + ux * t;
      const py = s.y0 + uy * t;
      if (nearCross(px, py, 1.2)) continue;
      if (!oneWay) {
        flatQuad(b, s.kind === 0 ? white : yellow, L(px), Lz(py), 1.2 * T, 0.14 * T, ang, Y_PAINT);
      }
      if (s.kind === 2) {
        for (const side of [-1, 1]) {
          const qx = px + nx * side * half * 0.5;
          const qy = py + ny * side * half * 0.5;
          flatQuad(b, white, L(qx), Lz(qy), 1.0 * T, 0.1 * T, ang, Y_PAINT);
        }
      }
    }
    if (oneWay) {
      for (let t = 7; t < len - 3; t += 14) {
        const px = s.x0 + ux * t;
        const py = s.y0 + uy * t;
        if (nearCross(px, py, 2)) continue;
        const aang = dir > 0 ? ang : ang + Math.PI;
        const fx = Math.cos(aang);
        const fy = Math.sin(aang);
        flatQuad(b, white, L(px), Lz(py), 1.4 * T, 0.2 * T, aang, Y_PAINT);
        for (const w of [-1, 1]) {
          const wa = aang + w * 2.5;
          flatQuad(b, white, L(px + fx * 0.55 + Math.cos(wa) * 0.3), Lz(py + fy * 0.55 + Math.sin(wa) * 0.3), 0.7 * T, 0.18 * T, wa, Y_PAINT);
        }
      }
    }

    // Farolas y árboles en la acera, alternando lados; coches junto al bordillo.
    for (let t = 5; t < len - 2; t += 6) {
      const px = s.x0 + ux * t;
      const py = s.y0 + uy * t;
      if (nearCross(px, py, 2.5)) continue;
      const k = Math.round((px * ux + py * uy) / 6);
      const side = k % 2 === 0 ? 1 : -1;
      const h = hash2(Math.round(px * 3), Math.round(py * 3));
      const sx = px + nx * side * (half + 0.8);
      const sy = py + ny * side * (half + 0.8);
      if (k % 3 === 0) b.addObject(streetlight(L(sx), Lz(sy), -nx * side, -ny * side));
      else if (h > 0.45) b.addObject(tree(L(sx), Lz(sy), CROWNS[Math.floor(h * 97) % CROWNS.length]));
      if (hash2(Math.round(px * 5) + 1, Math.round(py * 5)) > 0.55) {
        const cside = -side;
        const cx = px + nx * cside * (half - 0.65);
        const cy = py + ny * cside * (half - 0.65);
        b.addObject(car(L(cx), Lz(cy), ang, CAR_COLORS[Math.floor(h * 131) % CAR_COLORS.length]));
      }
    }
  }

  // ---- Pasos de cebra en cada brazo de cada cruce ----
  for (const c of crosses) {
    if (c.through.length < 2) continue;
    for (const th of c.through) {
      const half = CITY_ROAD_HALF[th.seg.kind];
      let other = 0;
      for (const o of c.through) if (Math.abs(o.ux * th.ux + o.uy * th.uy) < 0.9) other = Math.max(other, CITY_ROAD_HALF[o.seg.kind]);
      if (other === 0) continue;
      const nx = -th.uy;
      const ny = th.ux;
      const ang = Math.atan2(th.uy, th.ux);
      for (const sgn of [-1, 1]) {
        const cx = c.x + th.ux * sgn * (other + 1.3);
        const cy = c.y + th.uy * sgn * (other + 1.3);
        if (segDist(th.seg, cx, cy) > 0.5) continue; // el brazo no sigue por ese lado
        for (let w = -half + 0.4; w <= half - 0.3; w += 0.75) {
          flatQuad(b, white, L(cx + nx * w), Lz(cy + ny * w), 1.1 * T, 0.38 * T, ang, Y_PAINT);
        }
      }
    }
  }

  const group = b.build();
  for (const m of group.children) m.receiveShadow = true;

  const buildings: THREE.Group[] = [];
  for (const bd of buildingDefs.values()) {
    const g = buildPolygonBuilding(bd.id, bd.pts, bd.floors, originGX, originGZ);
    buildings.push(g);
    group.add(g);
  }
  return { group, buildings };
}
