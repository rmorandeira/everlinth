// Ciudad procedural a partir de MapGenerator (ver COPYING.LESSER): campo de tensores
// → calles por líneas de corriente (principales, mayores, menores) → manzanas →
// parcelas. Unidad de trabajo = 1 tile (1,5 m).
//
// El mundo se divide en "distritos" de 15×15 salas (720×405 tiles). Cada distrito
// se genera una vez (≈2 s) con una semilla derivada de sus coordenadas, así que es
// determinista, y se cachea en memoria. Los distritos vecinos son independientes:
// las calles terminan en el borde del distrito.
//
// Desde el distrito se extrae, para cada sala: (1) los tiles (calzada, acera,
// edificio, parque, solar) para colisión y (2) la geometría vectorial (segmentos de
// calle y polígonos de edificio) que el cliente dibuja de verdad, de modo que las
// diagonales no salen en escalera.
import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  TileType,
  type CityData,
  type CityRoad,
  type CityBuilding,
  CITY_ROAD_HALF,
  CITY_SIDEWALK_W,
} from "@roi/shared";
import Vector from "./vector.js";
import TensorField from "./tensor_field.js";
import { RK4Integrator } from "./integrator.js";
import StreamlineGenerator, { type StreamlineParams } from "./streamlines.js";
import Graph from "./graph.js";
import PolygonFinder from "./polygon_finder.js";
import PolygonUtil from "./polygon_util.js";

const DISTRICT_ROOMS = 15;
const DISTRICT_W = DISTRICT_ROOMS * SCREEN_WIDTH; // 720
const DISTRICT_H = DISTRICT_ROOMS * SCREEN_HEIGHT; // 405
const ROOM_OFFSET = 7; // la sala (0,0) queda en el centro del distrito (0,0)
const WORLD_SEED = 20240611;

// Semianchura de calzada por tipo de calle (tiles), y anchura de acera.
const ROAD_HALF = CITY_ROAD_HALF;
const SIDEWALK_W = CITY_SIDEWALK_W;
const LOT_INSET = 0.5; // callejón entre edificios y margen respecto a la acera

type Pt = [number, number];
interface Seg {
  id: string;
  kind: 0 | 1 | 2;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  s0: number; // distancia a lo largo de su calle al inicio del segmento (tiles)
}
interface Lot {
  id: string;
  pts: Pt[];
  cx: number;
  cy: number;
  floors: number;
  bbox: [number, number, number, number];
}
interface District {
  ox: number; // origen del distrito en tiles globales
  oy: number;
  segs: Seg[];
  lots: Lot[];
  parks: Pt[][];
  nodes: Pt[];
  bucketsSeg: Map<number, number[]>;
  bucketsLot: Map<number, number[]>;
}

const BUCKET = 24;
function bucketKey(bx: number, by: number): number {
  return (by + 1000) * 4096 + (bx + 1000);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    s += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(s) / 2;
}

function pointInPolygon(x: number, y: number, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- Generación de un distrito ----

const minorP: StreamlineParams = { dsep: 20, dtest: 15, dstep: 1, dlookahead: 40, dcirclejoin: 5, joinangle: 0.1, pathIterations: 1000, seedTries: 300, simplifyTolerance: 0.5, collideEarly: 0 };
const majorP: StreamlineParams = { ...minorP, dsep: 100, dtest: 30, dlookahead: 200 };
const mainP: StreamlineParams = { ...minorP, dsep: 300, dtest: 150, dlookahead: 400 };

function generateDistrict(dx: number, dy: number): District {
  const origin = new Vector(0, 0);
  const dims = new Vector(DISTRICT_W, DISTRICT_H);
  const seed = Math.floor(hash01(dx * 3.7 + WORLD_SEED, dy * 5.3 - WORLD_SEED) * 4294967296);

  // MapGenerator usa Math.random en todas partes: se sustituye por un generador con
  // semilla solo mientras dura la generación (el resto del servidor no lo nota).
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    const rand = Math.random;
    const rr = (min: number, max?: number): number => (max === undefined ? rand() * min : min + rand() * (max - min));
    // Ruido global de rotación: tuerce las calles poco a poco (sin él, cada zona del
    // campo es una cuadrícula perfecta). Más campos base y más pequeños que en el
    // generador original, para que la orientación cambie cada pocas manzanas.
    const field = new TensorField({ globalNoise: true, noiseSizePark: 20, noiseAnglePark: 90, noiseSizeGlobal: 140, noiseAngleGlobal: 22 });
    const SPAWN = 0.85;
    const size = dims.clone().multiplyScalar(SPAWN);
    const o = dims.clone().multiplyScalar((1 - SPAWN) / 2).add(origin);
    const at = (): Vector => new Vector(rand() * size.x, rand() * size.y).add(o);
    for (let i = 0; i < 7; i++) field.addGrid(at(), rr(DISTRICT_W / 8, DISTRICT_W / 3), rr(10, 40), rr(Math.PI / 2));
    for (let i = 0; i < 2; i++) field.addRadial(at(), rr(DISTRICT_W / 14, DISTRICT_W / 7), rr(10, 40));

    const integrator = new RK4Integrator(field, minorP);
    const roads = (params: StreamlineParams, existing: StreamlineGenerator[]): StreamlineGenerator => {
      const g = new StreamlineGenerator(integrator, origin, dims, { ...params });
      for (const e of existing) g.addExistingStreamlines(e);
      g.createAllStreamlines(false); // la promesa se resuelve desde update()
      while (g.update()) {
        /* una línea de corriente por llamada */
      }
      g.joinDanglingStreamlines();
      return g;
    };

    field.ignoreRiver = true;
    const mainG = roads(mainP, []);
    const majorG = roads(majorP, [mainG]);

    // Parques grandes: dos de las manzanas mayores.
    const g0 = new Graph(majorG.allStreamlinesSimple.concat(mainG.allStreamlinesSimple), minorP.dstep);
    const pf0 = new PolygonFinder(g0.nodes, { maxLength: 20, minArea: 80, shrinkSpacing: 4, chanceNoDivide: 1 }, field);
    pf0.findPolygons();
    const bigBlocks = pf0.polygons;
    const parks: Vector[][] = [];
    for (let i = 0; i < Math.min(2, bigBlocks.length); i++) parks.push(bigBlocks[Math.floor(rand() * bigBlocks.length)]);
    field.parks = parks;

    const minorG = roads(minorP, [mainG, majorG]);

    const all = mainG.allStreamlinesSimple.concat(majorG.allStreamlinesSimple, minorG.allStreamlinesSimple);
    const g = new Graph(all, minorP.dstep, true);
    const pf = new PolygonFinder(g.nodes, { maxLength: 20, minArea: 40, shrinkSpacing: 3.9, chanceNoDivide: 0.05 }, field);
    pf.findPolygons();
    pf.shrink(false);
    pf.divide(false);
    const lotsRaw: Vector[][] = pf.polygons;

    return buildDistrict(dx, dy, [
      { kind: 2, lines: mainG.allStreamlinesSimple },
      { kind: 1, lines: majorG.allStreamlinesSimple },
      { kind: 0, lines: minorG.allStreamlinesSimple },
    ], lotsRaw, parks, g.intersections);
  } finally {
    Math.random = realRandom;
  }
}

function buildDistrict(
  dx: number,
  dy: number,
  groups: Array<{ kind: 0 | 1 | 2; lines: Vector[][] }>,
  lotsRaw: Vector[][],
  parksRaw: Vector[][],
  intersections: Vector[]
): District {
  const ox = (dx * DISTRICT_ROOMS - ROOM_OFFSET) * SCREEN_WIDTH;
  const oy = (dy * DISTRICT_ROOMS - ROOM_OFFSET) * SCREEN_HEIGHT;
  const key = `${dx},${dy}`;

  const segs: Seg[] = [];
  let li = 0;
  for (const grp of groups) {
    for (const line of grp.lines) {
      let acc = 0;
      for (let i = 0; i + 1 < line.length; i++) {
        segs.push({ id: `${key}:${li}:${i}`, kind: grp.kind, x0: line[i].x + ox, y0: line[i].y + oy, x1: line[i + 1].x + ox, y1: line[i + 1].y + oy, s0: acc });
        acc += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y);
      }
      li++;
    }
  }

  const parks: Pt[][] = parksRaw.map((p) => p.map((v) => [v.x + ox, v.y + oy] as Pt));
  const cxD = ox + DISTRICT_W / 2;
  const cyD = oy + DISTRICT_H / 2;
  const maxR = Math.hypot(DISTRICT_W / 2, DISTRICT_H / 2);

  const lots: Lot[] = [];
  lotsRaw.forEach((raw, idx) => {
    let poly = raw;
    try {
      const inset = PolygonUtil.resizeGeometry(raw, -LOT_INSET, false);
      if (inset && inset.length >= 3) poly = inset;
    } catch {
      /* se queda con el polígono sin recortar */
    }
    const pts: Pt[] = poly.map((v) => [v.x + ox, v.y + oy] as Pt);
    if (pts.length < 3 || polygonArea(pts) < 20) return;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    if (parks.some((pk) => pointInPolygon(cx, cy, pk))) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // Más altos cerca del centro del distrito (downtown) y más bajos en la periferia.
    const centrality = 1 - Math.min(1, Math.hypot(cx - cxD, cy - cyD) / maxR);
    const h = hash01(cx * 0.173 + dx, cy * 0.291 + dy);
    const floors = 3 + Math.floor(Math.pow(h, 1.6) * (6 + 30 * centrality * centrality));
    lots.push({ id: `${key}:b${idx}`, pts, cx, cy, floors, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  });

  const d: District = {
    ox,
    oy,
    segs,
    lots,
    parks,
    nodes: intersections.map((v) => [v.x + ox, v.y + oy] as Pt),
    bucketsSeg: new Map(),
    bucketsLot: new Map(),
  };
  const put = (m: Map<number, number[]>, x0: number, y0: number, x1: number, y1: number, idx: number, pad: number): void => {
    for (let by = Math.floor((y0 - pad) / BUCKET); by <= Math.floor((y1 + pad) / BUCKET); by++) {
      for (let bx = Math.floor((x0 - pad) / BUCKET); bx <= Math.floor((x1 + pad) / BUCKET); bx++) {
        const k = bucketKey(bx, by);
        const l = m.get(k);
        if (l) l.push(idx);
        else m.set(k, [idx]);
      }
    }
  };
  segs.forEach((s, i) => put(d.bucketsSeg, Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.max(s.x0, s.x1), Math.max(s.y0, s.y1), i, ROAD_HALF[2] + SIDEWALK_W + 0.5));
  lots.forEach((l, i) => put(d.bucketsLot, l.bbox[0], l.bbox[1], l.bbox[2], l.bbox[3], i, 0));
  return d;
}

const cache = new Map<string, District>();
function getDistrict(dx: number, dy: number): District {
  const key = `${dx},${dy}`;
  let d = cache.get(key);
  if (!d) {
    const t0 = Date.now();
    d = generateDistrict(dx, dy);
    console.log(`Distrito de ciudad ${key}: ${d.segs.length} segmentos, ${d.lots.length} edificios (${Date.now() - t0} ms)`);
    cache.set(key, d);
  }
  return d;
}

function distToSeg(px: number, py: number, s: Seg): number {
  const vx = s.x1 - s.x0;
  const vy = s.y1 - s.y0;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - s.x0) * vx + (py - s.y0) * vy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x0 + t * vx), py - (s.y0 + t * vy));
}

export interface RasterRoom {
  tiles: TileType[][];
  city: CityData;
}

// Tiles + geometría vectorial de la sala (sx, sy).
export function rasterRoom(sx: number, sy: number): RasterRoom {
  const dx = Math.floor((sx + ROOM_OFFSET) / DISTRICT_ROOMS);
  const dy = Math.floor((sy + ROOM_OFFSET) / DISTRICT_ROOMS);
  const d = getDistrict(dx, dy);
  const gx0 = sx * SCREEN_WIDTH;
  const gy0 = sy * SCREEN_HEIGHT;

  const tiles: TileType[][] = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const gpx = gx0 + x + 0.5;
      const gpy = gy0 + y + 0.5;
      const bk = bucketKey(Math.floor(gpx / BUCKET), Math.floor(gpy / BUCKET));
      // Todo lo que no es calzada, edificio ni parque es pavimento (acera/plaza).
      let type: TileType = TileType.Sidewalk;
      let onRoad = false;
      let onSide = false;
      const segIdx = d.bucketsSeg.get(bk);
      if (segIdx) {
        for (const i of segIdx) {
          const s = d.segs[i];
          const dist = distToSeg(gpx, gpy, s);
          const half = ROAD_HALF[s.kind];
          if (dist <= half) {
            onRoad = true;
            break;
          }
          if (dist <= half + SIDEWALK_W) onSide = true;
        }
      }
      if (onRoad) type = TileType.Road;
      else if (onSide) type = TileType.Sidewalk;
      else if (d.parks.some((pk) => pointInPolygon(gpx, gpy, pk))) type = TileType.Grass;
      else {
        const lotIdx = d.bucketsLot.get(bk);
        if (lotIdx) {
          for (const i of lotIdx) {
            const l = d.lots[i];
            if (gpx < l.bbox[0] || gpx > l.bbox[2] || gpy < l.bbox[1] || gpy > l.bbox[3]) continue;
            if (pointInPolygon(gpx, gpy, l.pts)) {
              type = TileType.Building;
              break;
            }
          }
        }
      }
      row.push(type);
    }
    tiles.push(row);
  }

  // Geometría vectorial de la sala: segmentos que la tocan (con margen) y edificios
  // cuyo centro cae dentro (cada edificio lo dibuja una sola sala).
  const pad = ROAD_HALF[2] + SIDEWALK_W + 1;
  const roads: CityRoad[] = [];
  const seen = new Set<number>();
  for (let by = Math.floor((gy0 - pad) / BUCKET); by <= Math.floor((gy0 + SCREEN_HEIGHT + pad) / BUCKET); by++) {
    for (let bx = Math.floor((gx0 - pad) / BUCKET); bx <= Math.floor((gx0 + SCREEN_WIDTH + pad) / BUCKET); bx++) {
      for (const i of d.bucketsSeg.get(bucketKey(bx, by)) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const s = d.segs[i];
        if (Math.max(s.x0, s.x1) < gx0 - pad || Math.min(s.x0, s.x1) > gx0 + SCREEN_WIDTH + pad) continue;
        if (Math.max(s.y0, s.y1) < gy0 - pad || Math.min(s.y0, s.y1) > gy0 + SCREEN_HEIGHT + pad) continue;
        roads.push({ id: s.id, kind: s.kind, x0: round2(s.x0), y0: round2(s.y0), x1: round2(s.x1), y1: round2(s.y1), s0: round2(s.s0) });
      }
    }
  }
  const buildings: CityBuilding[] = [];
  for (const l of d.lots) {
    if (l.cx >= gx0 && l.cx < gx0 + SCREEN_WIDTH && l.cy >= gy0 && l.cy < gy0 + SCREEN_HEIGHT) {
      buildings.push({ id: l.id, floors: l.floors, pts: l.pts.map(([x, y]) => [round2(x), round2(y)] as [number, number]) });
    }
  }
  const nodes = d.nodes.filter(([x, y]) => x >= gx0 - pad && x < gx0 + SCREEN_WIDTH + pad && y >= gy0 - pad && y < gy0 + SCREEN_HEIGHT + pad).map(([x, y]) => [round2(x), round2(y)] as [number, number]);
  return { tiles, city: { roads, buildings, nodes } };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Punto de la calzada más cercano a un punto (para colocar a un jugador nuevo).
export function nearestRoadPoint(gx: number, gy: number): { x: number; y: number } | null {
  const dx = Math.floor((Math.floor(gx / SCREEN_WIDTH) + ROOM_OFFSET) / DISTRICT_ROOMS);
  const dy = Math.floor((Math.floor(gy / SCREEN_HEIGHT) + ROOM_OFFSET) / DISTRICT_ROOMS);
  const d = getDistrict(dx, dy);
  let best: Seg | null = null;
  let bd = Infinity;
  for (const s of d.segs) {
    const dist = distToSeg(gx, gy, s);
    if (dist < bd) {
      bd = dist;
      best = s;
    }
  }
  if (!best) return null;
  return { x: (best.x0 + best.x1) / 2, y: (best.y0 + best.y1) / 2 };
}
