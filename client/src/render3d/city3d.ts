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
import { buildPolygonBuilding, facadeFor } from "./buildings3d.js";
import { cloneModel, modelSize, modelsReady, KIT_SCALE, BUILDING_SETS, type Kit } from "./models3d.js";
import { asphaltTexture, oilTexture, skidTexture, stopTexture, arrowStraightTexture, arrowLeftTexture, wornPaintTexture } from "./roadTextures.js";

// Asfalto texturizado (UV en coordenadas de mundo: se repite sin costuras entre
// segmentos) y materiales de calcomanía para manchas, frenadas y rotulado.
// Tonos de asfalto (multiplican la textura): calle reasfaltada hace poco (oscura),
// normal y vieja/descolorida (clara). Cada calle entera tiene su tono.
const ASPHALT_TONES = [0x8f9195, 0xb3b5b8, 0xd4d3cf];
const asphaltMats = new Map<number, THREE.MeshLambertMaterial>();
function asphaltMaterial(tone: number, patch = false): THREE.MeshLambertMaterial {
  const key = tone * 2 + (patch ? 1 : 0);
  let m = asphaltMats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: asphaltTexture(), color: tone });
    if (patch) {
      // parche de reasfaltado: por encima del asfalto de la calle sin pelearse en profundidad
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -1;
    }
    asphaltMats.set(key, m);
  }
  return m;
}
// Pintura vial con desgaste (textura de alfa con desconchones, UV de mundo).
const paintMats = new Map<number, THREE.MeshLambertMaterial>();
function paintMaterial(color: number): THREE.MeshLambertMaterial {
  let m = paintMats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, map: wornPaintTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    paintMats.set(color, m);
  }
  return m;
}
const PAINT_UV = 1.6; // unidades de render por repetición del desgaste
const decalCache = new Map<string, THREE.MeshLambertMaterial>();
function decalMaterial(key: string, tex: () => THREE.Texture, opacity = 1): THREE.MeshLambertMaterial {
  let m = decalCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: tex(), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    decalCache.set(key, m);
  }
  return m;
}
const ASPHALT_UV = 4; // unidades de render por repetición de la textura de asfalto

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
const Y_DECAL = 0.065; // manchas y frenadas: sobre el asfalto, bajo la pintura
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
  loose: THREE.Object3D[] = [];
  addObject(o: THREE.Object3D): void {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material) || !mesh.geometry.getAttribute("uv") || !mesh.geometry.getAttribute("normal")) {
        const copy = new THREE.Mesh(mesh.geometry, mesh.material);
        copy.applyMatrix4(mesh.matrixWorld);
        this.loose.push(copy);
        return;
      }
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      this.add(mesh.material as THREE.Material, g);
    });
  }
  build(): THREE.Group {
    const out = new THREE.Group();
    for (const o of this.loose) out.add(o);
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
// uvWorld: si se da, las UV salen de la posición en el mundo (texturas que se repiten).
function worldUV(g: THREE.BufferGeometry, scale: number): void {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale);
}
function flatQuad(b: Batch, mat: THREE.Material, x: number, z: number, len: number, w: number, ang: number, y: number, uvWorld?: number): void {
  const g = new THREE.PlaneGeometry(len, w).rotateX(-Math.PI / 2);
  g.rotateY(-ang);
  g.translate(x, y, z);
  if (uvWorld) worldUV(g, uvWorld);
  b.add(mat, g);
}
function flatDisc(b: Batch, mat: THREE.Material, x: number, z: number, r: number, y: number, uvWorld?: number): void {
  const g = new THREE.CircleGeometry(r, 14).rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  if (uvWorld) worldUV(g, uvWorld);
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
// Coloca un modelo del kit: escala del kit × k, frente (+Z) hacia (fx, fz).
function kitProp(kit: Kit, name: string, x: number, z: number, fx: number, fz: number, k = 1): THREE.Object3D | null {
  const m = cloneModel(`${kit}/${name}`);
  if (!m) return null;
  m.scale.setScalar(KIT_SCALE[kit] * k);
  m.rotation.y = Math.atan2(fx, fz);
  m.position.set(x, 0.05, z);
  return m;
}

function streetlight(x: number, z: number, dx: number, dz: number): THREE.Object3D {
  const k = kitProp("retro", "detail-light-single", x, z, dx, dz);
  if (k) return k;
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
  const kt = kitProp("suburban", color % 2 === 0 ? "tree-large" : "tree-small", x, z, 0, 1, 0.9 + (color % 7) * 0.05);
  if (kt) return kt;
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
  void ASPHALT;
  const white = paintMaterial(PAINT_WHITE);
  const yellow = paintMaterial(PAINT_YELLOW);
  const lineKeyOf = (sg: CityRoad): string => sg.id.slice(0, sg.id.lastIndexOf(":"));
  const toneOf = (sg: CityRoad): number => ASPHALT_TONES[Math.floor(hashStr(lineKeyOf(sg) + "t") * ASPHALT_TONES.length) % ASPHALT_TONES.length];

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
    const asphaltMat = asphaltMaterial(toneOf(s));
    flatQuad(b, curbMat, mx, mz, len * T, (half + CURB_W) * 2 * T, ang, Y_CURB);
    flatQuad(b, asphaltMat, mx, mz, len * T, half * 2 * T, ang, Y_ASPHALT, ASPHALT_UV);
    // Parches de reasfaltado (otro tono, rectangulares, en un carril) y tapas de
    // alcantarilla/registro en mitad del carril.
    const ux0 = dx / len;
    const uy0 = dy / len;
    for (let t = 3; t < len - 3; t += 9) {
      const px = s.x0 + ux0 * t;
      const py = s.y0 + uy0 * t;
      const hp = hash2(Math.round(px * 2.3) + 7, Math.round(py * 2.3) - 3);
      if (hp > 0.8) {
        const side = hp > 0.9 ? 1 : -1;
        const w = half * (0.6 + (hp % 0.1) * 5);
        const off = side * (half - w / 2) * 0.9;
        const tone = ASPHALT_TONES[(ASPHALT_TONES.indexOf(toneOf(s)) + 1 + (hp > 0.87 ? 1 : 0)) % ASPHALT_TONES.length];
        flatQuad(b, asphaltMaterial(tone, true), L(px - uy0 * off), Lz(py + ux0 * off), (1.6 + hp * 3) * T, w * T, ang + (hp - 0.85) * 0.1, Y_ASPHALT + 0.001, ASPHALT_UV);
      } else if (hp < 0.07) {
        const off = (hp < 0.035 ? 1 : -1) * half * 0.45;
        flatDisc(b, lambert(0x3f4145), L(px - uy0 * off), Lz(py + ux0 * off), 0.42 * T, Y_ASPHALT + 0.003);
        flatDisc(b, lambert(0x2c2e31), L(px - uy0 * off), Lz(py + ux0 * off), 0.32 * T, Y_ASPHALT + 0.004);
      }
    }
    for (const [ex, ey] of [
      [s.x0, s.y0],
      [s.x1, s.y1],
    ]) {
      flatDisc(b, curbMat, L(ex), Lz(ey), (half + CURB_W) * T, Y_CURB);
      flatDisc(b, asphaltMat, L(ex), Lz(ey), half * T, Y_ASPHALT, ASPHALT_UV);
    }
  }

  const oilMat = decalMaterial("oil", oilTexture, 0.85);
  const skidMat = decalMaterial("skid", skidTexture, 0.8);
  const stopMat = decalMaterial("stop", stopTexture);
  const arrowStraightMat = decalMaterial("arrowS", arrowStraightTexture);
  const arrowLeftMat = decalMaterial("arrowL", arrowLeftTexture);
  // Calcomanía / pintura en coordenadas de tile: len a lo largo de ang, w a través.
  // (Las texturas de rotulado tienen "arriba" hacia la izquierda de ang: con
  // ang = sentido + 90°, se leen de frente desde el coche que llega.)
  const mark = (mat: THREE.Material, gx: number, gy: number, len: number, w: number, ang: number, y = Y_PAINT): void =>
    flatQuad(b, mat, L(gx), Lz(gy), len * T, w * T, ang, y, mat === white || mat === yellow ? PAINT_UV : undefined);
  const lineInfo = (sg: CityRoad): { oneWay: boolean; dir: number } => {
    const key = sg.id.slice(0, sg.id.lastIndexOf(":"));
    return { oneWay: sg.kind === 0 && hashStr(key) < 0.5, dir: hashStr(key + "d") < 0.5 ? 1 : -1 };
  };

  // ---- Marcas y mobiliario a lo largo de cada segmento ----
  // Convenciones (circulación por la derecha): doble sentido → línea central
  // amarilla (discontinua; doble continua en avenidas); avenidas con dos carriles
  // por sentido separados por discontinua blanca; sentido único → sin línea
  // central, con flechas de sentido. Cerca de los cruces las líneas pasan a ser
  // continuas (no se cambia de carril) — ver los brazos de cruce más abajo.
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
    const { oneWay, dir } = lineInfo(s);

    // Marcas por longitud de arco a lo largo de la calle (s0 viene del servidor):
    // un patrón [trazo, hueco] se recorta a este segmento, así los discontinuos
    // continúan en las curvas y no cambian al pasar de una sala a otra.
    const pieces = (period: number, dashLen: number, fn: (px: number, py: number, l: number) => void): void => {
      const a = s.s0;
      const bEnd = s.s0 + len;
      for (let k = Math.floor(a / period); k * period < bEnd; k++) {
        const d0 = Math.max(a, k * period);
        const d1 = Math.min(bEnd, k * period + dashLen);
        if (d1 - d0 < 0.15) continue;
        const tm = (d0 + d1) / 2 - a;
        fn(s.x0 + ux * tm, s.y0 + uy * tm, d1 - d0);
      }
    };
    if (!oneWay) {
      if (s.kind === 2) {
        // doble línea continua amarilla (troceada solo para poder cortarla en los cruces)
        pieces(2, 2, (px, py, l) => {
          if (nearCross(px, py, 0.6)) return;
          for (const side of [-1, 1]) mark(yellow, px + nx * side * 0.15, py + ny * side * 0.15, l + 0.02, 0.12, ang);
        });
      } else {
        pieces(6, 2, (px, py, l) => {
          if (!nearCross(px, py, 0.8)) mark(yellow, px, py, l, 0.13, ang);
        });
      }
    }
    if (s.kind === 2) {
      pieces(6, 2, (px, py, l) => {
        if (nearCross(px, py, 9)) return;
        for (const side of [-1, 1]) mark(white, px + nx * side * half * 0.5, py + ny * side * half * 0.5, l, 0.11, ang);
      });
    }
    if (oneWay) {
      for (let t = 7; t < len - 3; t += 14) {
        const px = s.x0 + ux * t;
        const py = s.y0 + uy * t;
        if (nearCross(px, py, 5)) continue;
        const heading = dir > 0 ? ang : ang + Math.PI;
        mark(arrowStraightMat, px, py, 0.8, 2.2, heading + Math.PI / 2);
      }
    }

    // Farolas y árboles en la acera, alternando lados; coches junto al bordillo; alguna
    // mancha de aceite en mitad del carril (donde gotean los coches al pasar).
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
      else if (h < 0.12) {
        // banco mirando a la calle, algo más adentro de la acera
        const bx = px + nx * side * (half + 1.3);
        const by = py + ny * side * (half + 1.3);
        const bench = kitProp("retro", "detail-bench", L(bx), Lz(by), -nx * side, -ny * side, 0.5);
        if (bench) b.addObject(bench);
      } else if (h < 0.17) {
        const dx2 = px + nx * side * (half + 1.4);
        const dy2 = py + ny * side * (half + 1.4);
        const dump = kitProp("retro", h < 0.145 ? "detail-dumpster-closed" : "detail-dumpster-open", L(dx2), Lz(dy2), ux, uy, 0.55);
        if (dump) b.addObject(dump);
      }
      const hc = hash2(Math.round(px * 5) + 1, Math.round(py * 5));
      const cside = -side;
      const cx = px + nx * cside * (half - 0.65);
      const cy = py + ny * cside * (half - 0.65);
      if (hc > 0.95) {
        const tr = kitProp("retro", ["truck-grey", "truck-green", "truck-flat"][Math.floor(h * 3) % 3], L(cx), Lz(cy), ux, uy, 0.62);
        b.addObject(tr ?? car(L(cx), Lz(cy), ang, CAR_COLORS[Math.floor(h * 131) % CAR_COLORS.length]));
      } else if (hc > 0.55) {
        b.addObject(car(L(cx), Lz(cy), ang, CAR_COLORS[Math.floor(h * 131) % CAR_COLORS.length]));
      } else if (hc < 0.14) {
        // hueco de aparcamiento vacío: mancha de aceite donde suele pararse el coche
        mark(oilMat, cx, cy, 1.4, 1.0, ang + h * 2, Y_DECAL);
      }
      const ho = hash2(Math.round(px * 7) + 3, Math.round(py * 7) + 1);
      if (ho > 0.9) {
        const lane = oneWay ? 0 : (ho > 0.95 ? 1 : -1) * half * 0.5;
        mark(oilMat, px + nx * lane, py + ny * lane, 1.1, 0.8, ang + ho * 5, Y_DECAL);
      }
    }
  }

  // ---- Brazos de cada cruce ----
  // Paso de cebra en todos. Si la calle desemboca en otra de rango mayor (o en
  // algunos cruces de calles menores: "stop en todas las direcciones"): línea de
  // detención sobre el carril que llega, "STOP" pintado y manchas de aceite donde
  // esperan los coches. Avenidas: flechas de giro por carril y líneas continuas
  // antes del cruce. En algunos brazos, frenadas que acaban en el paso de cebra.
  for (const c of crosses) {
    if (c.through.length < 2) continue;
    const ckey = `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
    const allMinor = c.through.every((o) => o.seg.kind === 0);
    const allWayStop = allMinor && hashStr(ckey) < 0.45;
    for (const th of c.through) {
      const half = CITY_ROAD_HALF[th.seg.kind];
      let other = 0;
      let higher = false;
      for (const o of c.through) {
        if (Math.abs(o.ux * th.ux + o.uy * th.uy) >= 0.9) continue;
        other = Math.max(other, CITY_ROAD_HALF[o.seg.kind]);
        if (o.seg.kind > th.seg.kind) higher = true;
      }
      if (other === 0) continue;
      const nx = -th.uy;
      const ny = th.ux;
      const ang = Math.atan2(th.uy, th.ux);
      const { oneWay, dir } = lineInfo(th.seg);
      for (const sgn of [-1, 1]) {
        const cwx = c.x + th.ux * sgn * (other + 1.3);
        const cwy = c.y + th.uy * sgn * (other + 1.3);
        if (segDist(th.seg, cwx, cwy) > 0.5) continue; // el brazo no sigue por ese lado
        for (let w = -half + 0.4; w <= half - 0.3; w += 0.75) mark(white, cwx + nx * w, cwy + ny * w, 1.1, 0.38, ang);

        // Sentido de llegada al cruce (h) y su derecha (r).
        const hx = -th.ux * sgn;
        const hy = -th.uy * sgn;
        const rx = -hy;
        const ry = hx;
        const hang = Math.atan2(hy, hx);
        const approaching = !oneWay || dir * sgn < 0;
        if (!approaching) continue;
        // Franja de carriles que llegan: la mitad derecha (doble sentido) o toda la calzada.
        const lo = oneWay ? -half : 0.15;
        const hi = half;
        const mid = (lo + hi) / 2;
        const bandW = hi - lo;
        const at = (dist: number, off: number): [number, number] => [c.x - hx * dist + rx * off, c.y - hy * dist + ry * off];
        const rnd = hashStr(ckey + sgn + th.seg.id);
        if (c.maxHalf >= CITY_ROAD_HALF[1] && !higher) {
          // semáforo en la acera derecha, antes del paso de cebra, con el brazo sobre la calzada
          const [qx, qy] = at(other + 2.6, half + 0.7);
          const tl = kitProp("retro", "detail-light-traffic", L(qx), Lz(qy), -rx, -ry, 0.75);
          if (tl) b.addObject(tl);
        }

        if (higher || allWayStop) {
          const D = other + 2.35;
          const [sx, sy] = at(D, mid);
          mark(white, sx, sy, bandW - 0.1, 0.4, hang + Math.PI / 2);
          const [tx, ty] = at(D + 2.3, mid);
          mark(stopMat, tx, ty, Math.min(bandW * 0.92, 2.4), 3.4, hang + Math.PI / 2);
          if (!oneWay) {
            // línea central continua antes del stop: prohibido adelantar
            const [lx, ly] = at(D + 3.5, 0);
            mark(yellow, lx, ly, 7, 0.13, ang);
          }
          if (rnd < 0.7) {
            const [ox, oy] = at(D + 1.9, mid + (rnd - 0.35) * 0.8);
            mark(oilMat, ox, oy, 1.5, 1.1, hang + rnd * 3, Y_DECAL);
          }
        }
        if (th.seg.kind === 2) {
          const D = other + 2.0;
          // líneas de carril continuas en los últimos metros (a ambos lados de la avenida)
          for (const off of [half * 0.5, -half * 0.5]) {
            const [lx, ly] = at(D + 4.5, off);
            mark(white, lx, ly, 9, 0.12, ang);
          }
          const [ix, iy] = at(D + 4, half * 0.25);
          mark(arrowLeftMat, ix, iy, 0.95, 2.4, hang + Math.PI / 2);
          const [ox2, oy2] = at(D + 4, half * 0.75);
          mark(arrowStraightMat, ox2, oy2, 0.95, 2.4, hang + Math.PI / 2);
        }
        if (rnd > 0.72) {
          // frenada: acaba justo antes del paso de cebra
          const L2 = 3 + (rnd - 0.72) * 14;
          const lane = oneWay ? (rnd - 0.86) * half : half * 0.5;
          const [kx, ky] = at(other + 2.2 + L2 / 2, lane);
          mark(skidMat, kx, ky, L2, 1.1, hang + (rnd - 0.86) * 0.25, Y_DECAL);
        }
      }
    }
  }

  const group = b.build();
  for (const m of group.children) m.receiveShadow = true;

  const buildings: THREE.Group[] = [];
  for (const bd of buildingDefs.values()) {
    const g = (modelsReady() && kitBuilding(bd, segs, originGX, originGZ)) || buildPolygonBuilding(bd.id, bd.pts, bd.floors, originGX, originGZ);
    buildings.push(g);
    group.add(g);
  }
  return { group, buildings };
}

// ---- Edificios de Kenney ajustados a una parcela poligonal ----
// Rectángulo orientado de la parcela (según su arista más larga); el frente del
// modelo mira a la calle más cercana. El modelo se elige por altura (plantas) entre
// los que mejor encajan en la parcela, se escala para caber (dentro de un margen de
// la escala natural del kit) y se estira un poco en vertical hacia las plantas pedidas.
function kitBuilding(bd: CityData["buildings"][number], segs: CityRoad[], originGX: number, originGZ: number): THREE.Group | null {
  const pts = bd.pts;
  if (pts.length < 3) return null;
  let best = 0;
  let theta = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    const l = Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]);
    if (l > best) {
      best = l;
      theta = Math.atan2(q[1] - pts[i][1], q[0] - pts[i][0]);
    }
  }
  const ax = Math.cos(theta);
  const ay = Math.sin(theta);
  const bx = -ay;
  const by = ax;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const [x, y] of pts) {
    const pa = x * ax + y * ay;
    const pb = x * bx + y * by;
    minA = Math.min(minA, pa); maxA = Math.max(maxA, pa);
    minB = Math.min(minB, pb); maxB = Math.max(maxB, pb);
  }
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  const cx = ax * ca + bx * cb;
  const cy = ay * ca + by * cb;
  const extA = maxA - minA;
  const extB = maxB - minB;

  // Calle más cercana → hacia dónde mira el frente.
  let nd = Infinity;
  let vx = 0;
  let vy = 1;
  for (const sg of segs) {
    const ex = sg.x1 - sg.x0;
    const ey = sg.y1 - sg.y0;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((cx - sg.x0) * ex + (cy - sg.y0) * ey) / l2)) : 0;
    const px = sg.x0 + t * ex - cx;
    const py = sg.y0 + t * ey - cy;
    const d = Math.hypot(px, py);
    if (d < nd && d > 0.01) {
      nd = d;
      vx = px / d;
      vy = py / d;
    }
  }
  const alongA = Math.abs(vx * ax + vy * ay) > Math.abs(vx * bx + vy * by);
  const sgnF = alongA ? Math.sign(vx * ax + vy * ay) || 1 : Math.sign(vx * bx + vy * by) || 1;
  const fx = (alongA ? ax : bx) * sgnF;
  const fy = (alongA ? ay : by) * sgnF;
  const frontage = (alongA ? extB : extA) * T; // ancho de fachada (unidades de render)
  const depth = (alongA ? extA : extB) * T;

  let h = 0;
  for (let i = 0; i < bd.id.length; i++) h = (h * 31 + bd.id.charCodeAt(i)) | 0;
  const r1 = hash2((h % 10007) * 0.013, 1.7);
  const r2 = hash2((h % 10009) * 0.017, 5.3);
  const floors = bd.floors;
  const set = floors <= 4 && r1 < 0.35 ? BUILDING_SETS.house : floors >= 14 ? BUILDING_SETS.tall : floors >= 7 ? BUILDING_SETS.mid : BUILDING_SETS.low;
  const kit: Kit = set === BUILDING_SETS.house ? "suburban" : "commercial";

  const fit = (key: string): number => {
    const sz = modelSize(key);
    if (!sz) return 0;
    return Math.min((frontage * 0.94) / (sz.x * KIT_SCALE[kit]), (depth * 0.94) / (sz.z * KIT_SCALE[kit]));
  };
  // Candidatos que caben sin encogerse demasiado; si ninguno, el que mejor cabe.
  let options = set.filter((k) => fit(k) >= 0.75);
  let chosenSet = set;
  if (options.length === 0) {
    options = BUILDING_SETS.tiny.filter((k) => fit(k) >= 0.6);
    chosenSet = BUILDING_SETS.tiny;
  }
  if (options.length === 0) return null;
  const key = options[Math.floor(r2 * options.length) % options.length];
  const sz = modelSize(key)!;
  const m = Math.min(1.45, fit(key));
  const base = KIT_SCALE[kit] * m;
  const obj = cloneModel(key);
  if (!obj) return null;
  const naturalH = sz.y * base;
  const stretch = kit === "suburban" ? 1 : Math.min(1.6, Math.max(0.85, (floors * 1.0) / naturalH));
  if (kit === "commercial") {
    const facade = facadeFor(set === BUILDING_SETS.low ? (r1 < 0.5 ? "lowrise" : "tower") : "tower", floors, r1);
    if (facade) applyFacade(obj, facade, base, base * stretch);
  }
  obj.scale.set(base, base * stretch, base);
  const g = new THREE.Group();
  g.add(obj);
  g.rotation.y = Math.atan2(fx, fy);
  g.position.set((cx - originGX) * T, 0.05, (cy - originGZ) * T);
  void chosenSet;
  return g;
}

// Reviste un modelo de Kenney con una foto de fachada: los triángulos de las paredes
// (normal casi horizontal) pasan al material de la foto con UV proyectadas por cara
// (u a lo largo del muro, v en altura, en metros reales tras escalar: sx en planta,
// sy en altura); tejados, cornisas y salientes conservan el material original.
// La geometría se copia (no se toca la del modelo compartido).
function applyFacade(obj: THREE.Object3D, facade: { mat: THREE.Material; tileW: number; tileH: number }, sx: number, sy: number): void {
  obj.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const pos = src.getAttribute("position") as THREE.BufferAttribute;
    const nor = src.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const uv = src.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (!uv || !nor) return;
    const m = mesh.matrixWorld; // espacio del modelo normalizado
    const tri = pos.count / 3;
    const wall: number[] = [];
    const rest: number[] = [];
    for (let t = 0; t < tri; t++) {
      a.fromBufferAttribute(pos, t * 3).applyMatrix4(m);
      b.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(m);
      n.subVectors(b, a).cross(p.subVectors(c, a));
      const len = n.length();
      if (len < 1e-9) {
        rest.push(t);
        continue;
      }
      n.divideScalar(len);
      (Math.abs(n.y) < 0.3 ? wall : rest).push(t);
    }
    if (wall.length === 0) return;
    const order = [...wall, ...rest];
    const out = new THREE.BufferGeometry();
    const P = new Float32Array(pos.count * 3);
    const N = new Float32Array(pos.count * 3);
    const U = new Float32Array(pos.count * 2);
    order.forEach((t, k) => {
      a.fromBufferAttribute(pos, t * 3).applyMatrix4(m);
      b.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(m);
      n.subVectors(b, a).cross(p.subVectors(c, a)).normalize();
      const isWall = k < wall.length;
      // tangente horizontal del muro (perpendicular a la normal en planta)
      const tx = -n.z;
      const tz = n.x;
      for (let v = 0; v < 3; v++) {
        const i = t * 3 + v;
        const dst = k * 3 + v;
        P[dst * 3] = pos.getX(i);
        P[dst * 3 + 1] = pos.getY(i);
        P[dst * 3 + 2] = pos.getZ(i);
        N[dst * 3] = nor.getX(i);
        N[dst * 3 + 1] = nor.getY(i);
        N[dst * 3 + 2] = nor.getZ(i);
        if (isWall) {
          p.fromBufferAttribute(pos, i).applyMatrix4(m);
          U[dst * 2] = ((p.x * tx + p.z * tz) * sx) / facade.tileW;
          U[dst * 2 + 1] = (p.y * sy) / facade.tileH;
        } else {
          U[dst * 2] = uv.getX(i);
          U[dst * 2 + 1] = uv.getY(i);
        }
      }
    });
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    out.addGroup(0, wall.length * 3, 0);
    out.addGroup(wall.length * 3, rest.length * 3, 1);
    src.dispose();
    mesh.geometry = out;
    mesh.material = [facade.mat, mesh.material];
    mesh.userData.ownGeometry = true;
  });
}
