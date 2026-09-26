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
import type { CarSpec } from "./cars3d.js";
import { nycStreetlight, nycTrafficSignal } from "./streetFurniture3d.js";
import { cloneModel, modelSize, modelsReady, KIT_SCALE, BUILDING_SETS, type Kit } from "./models3d.js";
import { asphaltTexture, oilTexture, skidTexture, stopTexture, arrowStraightTexture, arrowLeftTexture, wornPaintTexture, puddleTexture, tireTrackTexture, wornZoneTexture, crackSealTexture } from "./roadTextures.js";

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
// Charcos: agua oscura muy brillante (brillo especular del sol, farolas y fogonazos).
let puddleMatCache: THREE.MeshPhongMaterial | null = null;
function puddleMaterial(): THREE.MeshPhongMaterial {
  if (!puddleMatCache) {
    puddleMatCache = new THREE.MeshPhongMaterial({
      color: 0x2b333d,
      specular: 0xcfdcff,
      shininess: 110,
      alphaMap: puddleTexture(),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  return puddleMatCache;
}
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
  return nycStreetlight(x, z, dx, dz);
}
// (versión anterior de primitivas, sin uso)
function streetlightBoxes(x: number, z: number, dx: number, dz: number): THREE.Object3D {
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
  /** Coches aparcados (los dibuja y destruye cars3d). */
  cars: CarSpec[];
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
  const carSpecs: CarSpec[] = [];
  const addCar = (px: number, pz: number, ang: number, color: number): void => {
    carSpecs.push({ key: `${(px / T + originGX).toFixed(1)},${(pz / T + originGZ).toFixed(1)}`, x: px, z: pz, ang, color });
  };
  const curbMat = lambert(CURB);
  void ASPHALT;
  const white = paintMaterial(PAINT_WHITE);
  const yellow = paintMaterial(PAINT_YELLOW);
  const lineKeyOf = (sg: CityRoad): string => sg.id.slice(0, sg.id.lastIndexOf(":"));
  const toneOf = (sg: CityRoad): number => ASPHALT_TONES[Math.floor(hashStr(lineKeyOf(sg) + "t") * ASPHALT_TONES.length) % ASPHALT_TONES.length];

  // Juntas internas de cada calle (un punto que comparten dos segmentos seguidos de la
  // misma polilínea): solo ahí se rellena con un disco el hueco del quiebro. En los
  // extremos (p. ej. donde una avenida termina contra otra calle) no: el disco
  // sobresaldría como un bulbo redondo; el cruce lo forma el solape de las calzadas.
  const jointCount = new Map<string, number>();
  const jkey = (sg: CityRoad, x: number, y: number): string => `${sg.id.slice(0, sg.id.lastIndexOf(":"))}@${x.toFixed(2)},${y.toFixed(2)}`;
  for (const sg of segs) {
    for (const [x, y] of [
      [sg.x0, sg.y0],
      [sg.x1, sg.y1],
    ]) {
      const k = jkey(sg, x, y);
      jointCount.set(k, (jointCount.get(k) ?? 0) + 1);
    }
  }
  const tireMat = decalMaterial("tire", tireTrackTexture, 0.7);
  const tireRepeat = (g: THREE.BufferGeometry, lenUnits: number): void => {
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (lenUnits / 1.5));
  };
  const sealMat = decalMaterial("seal", crackSealTexture, 0.8);
  const wornMat = decalMaterial("wornZone", wornZoneTexture, 0.35);

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
      if ((jointCount.get(jkey(s, ex, ey)) ?? 0) < 2) continue;
      flatDisc(b, curbMat, L(ex), Lz(ey), (half + CURB_W) * T, Y_CURB);
      flatDisc(b, asphaltMat, L(ex), Lz(ey), half * T, Y_ASPHALT, ASPHALT_UV);
    }
    // Rodaduras: dos bandas por carril (por donde pisan las ruedas), a lo largo del tramo.
    const nx0 = -uy0;
    const ny0 = ux0;
    const oneWayS = s.kind === 0 && hashStr(s.id.slice(0, s.id.lastIndexOf(":"))) < 0.5;
    const lanes = oneWayS ? [0] : s.kind === 2 ? [-half * 0.75, -half * 0.25, half * 0.25, half * 0.75] : [-half * 0.5, half * 0.5];
    for (const lc of lanes) {
      for (const w of [-0.42, 0.42]) {
        const off = lc + w;
        const g = new THREE.PlaneGeometry(len * T, 0.3 * T).rotateX(-Math.PI / 2);
        tireRepeat(g, len * T);
        g.rotateY(-ang);
        g.translate(L((s.x0 + s.x1) / 2 + nx0 * off), Y_DECAL - 0.001, Lz((s.y0 + s.y1) / 2 + ny0 * off));
        b.add(tireMat, g);
      }
    }
    // Zanjas reparadas (franja que cruza la calzada) y grietas selladas con betún.
    for (let t = 6; t < len - 4; t += 13) {
      const px = s.x0 + ux0 * t;
      const py = s.y0 + uy0 * t;
      const hz = hash2(Math.round(px * 1.7) - 11, Math.round(py * 1.7) + 4);
      if (hz > 0.9) {
        const tone = ASPHALT_TONES[(ASPHALT_TONES.indexOf(toneOf(s)) + 2) % ASPHALT_TONES.length];
        flatQuad(b, asphaltMaterial(tone, true), L(px), Lz(py), (0.9 + hz * 0.6) * T, half * 2 * T * 0.98, ang + Math.PI / 2 + (hz - 0.95) * 0.3, Y_ASPHALT + 0.0015, ASPHALT_UV);
      } else if (hz < 0.22) {
        flatQuad(b, sealMat, L(px + nx0 * (hz - 0.11) * half * 6), Lz(py + ny0 * (hz - 0.11) * half * 6), 2.2 * T, 2.2 * T, ang + hz * 20, Y_DECAL);
      }
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
        if (tr) b.addObject(tr);
        else addCar(L(cx), Lz(cy), ang, CAR_COLORS[Math.floor(h * 131) % CAR_COLORS.length]);
      } else if (hc > 0.55) {
        addCar(L(cx), Lz(cy), ang, CAR_COLORS[Math.floor(h * 131) % CAR_COLORS.length]);
      } else if (hc < 0.14) {
        // hueco de aparcamiento vacío: mancha de aceite donde suele pararse el coche
        mark(oilMat, cx, cy, 1.4, 1.0, ang + h * 2, Y_DECAL);
      }
      const ho = hash2(Math.round(px * 7) + 3, Math.round(py * 7) + 1);
      if (ho > 0.9) {
        const lane = oneWay ? 0 : (ho > 0.95 ? 1 : -1) * half * 0.5;
        mark(oilMat, px + nx * lane, py + ny * lane, 1.1, 0.8, ang + ho * 5, Y_DECAL);
      }
      // Charcos: sobre todo en la cuneta (junto al bordillo, alargados según la calle),
      // alguno en un bache del carril y otros en la acera.
      const hw = hash2(Math.round(px * 4) - 5, Math.round(py * 4) + 9);
      if (hw < 0.16) {
        const sideP = hw < 0.08 ? 1 : -1;
        const gx = px + nx * sideP * (half - 0.4);
        const gy = py + ny * sideP * (half - 0.4);
        mark(puddleMaterial(), gx, gy, 1.6 + hw * 14, 0.8 + hw * 3, ang + (hw - 0.08) * 0.5, Y_DECAL + 0.002);
      } else if (hw > 0.95) {
        mark(puddleMaterial(), px + nx * half * 0.4, py + ny * half * 0.4, 1.3, 1.0, ang + hw * 9, Y_DECAL + 0.002);
      } else if (hw > 0.88) {
        const sideP = hw > 0.915 ? 1 : -1;
        mark(puddleMaterial(), px + nx * sideP * (half + 1.0), py + ny * sideP * (half + 1.0), 1.4, 0.9, ang + hw * 4, 0.056);
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
        if (!higher && !allWayStop) {
          // Semáforo de mástil en la esquina derecha, antes del paso de cebra: el brazo
          // cruza la calzada y lleva una cabeza sobre cada carril que llega.
          const poleOff = half + 0.7;
          const laneCenters = oneWay ? (half >= 3 ? [-half * 0.5, half * 0.5] : [0]) : half >= 3 ? [half * 0.25, half * 0.75] : [half * 0.5];
          const [qx, qy] = at(other + 2.6, poleOff);
          const axis = Math.abs(th.ux * c.through[0].ux + th.uy * c.through[0].uy) > 0.7 ? "A" : "B";
          b.addObject(nycTrafficSignal(L(qx), Lz(qy), hx, hy, laneCenters.map((lc) => (poleOff - lc) * T), axis));
        }

        {
          const [wx, wy] = at(other + 4.5, oneWay ? 0 : half * 0.5);
          mark(wornMat, wx, wy, 5.5, oneWay ? half * 1.8 : half * 1.1, hang, Y_DECAL - 0.0005);
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
  for (const m of group.children) {
    m.receiveShadow = true;
    // Lo que está a ras de suelo (asfalto, bordillo, marcas, manchas, charcos) no
    // proyecta sombra: fuera del pase de sombras (ahorra triángulos en cada fotograma).
    const mat = (m as THREE.Mesh).material as THREE.Material;
    const lam = mat as THREE.MeshLambertMaterial;
    m.userData.flat = mat.transparent || mat.polygonOffset || mat === curbMat || (lam.isMeshLambertMaterial && lam.map !== null);
  }

  const buildings: THREE.Group[] = [];
  for (const bd of buildingDefs.values()) {
    const g = (modelsReady() && kitBuilding(bd, segs, originGX, originGZ)) || buildPolygonBuilding(bd.id, bd.pts, bd.floors, originGX, originGZ);
    buildings.push(g);
    group.add(g);
  }
  return { group, buildings, cars: carSpecs };
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
  obj.scale.set(base, base * stretch, base);
  const g = new THREE.Group();
  g.add(obj);
  g.rotation.y = Math.atan2(fx, fy);
  g.position.set((cx - originGX) * T, 0.05, (cy - originGZ) * T);
  void chosenSet;
  return g;
}

