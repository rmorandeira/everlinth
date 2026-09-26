// Ciudad real a partir de OpenStreetMap (datos compactos de tools/osm/build-city.mjs;
// © colaboradores de OpenStreetMap, ODbL). Sustituye al generador procedural cuando
// existe server/data/osm/<ciudad>.json.gz: calles reales (tipo, sentido único, puentes
// con su nivel), edificios con su planta y sus plantas, costa (mar), playas, parques,
// agua y espigones. Misma salida que el generador: casillas para colisión + geometría.
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, CITY_ROAD_HALF, CITY_SIDEWALK_W, type CityData, type CityRoad, type CityBuilding, type CityHighway } from "@roi/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.OSM_CITY ?? path.join(__dirname, "..", "..", "data", "osm", "acoruna.json.gz");
const BUCKET = 24;
const BRIDGE_Z = 2.2; // unidades de render por nivel de puente (~6,6 m)

type Pt = [number, number];
interface Seg {
  id: string;
  kind: 0 | 1 | 2;
  ow: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  s0: number;
  bridge: number; // nivel (0 = a ras de suelo)
  z0: number;
  z1: number;
}
interface Bld {
  id: string;
  floors: number;
  t: string;
  name?: string;
  pts: Pt[];
  bbox: [number, number, number, number];
}
interface Poly {
  pts: Pt[];
  bbox: [number, number, number, number];
}
interface Coast {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

let loaded = false;
let ok = false;
const segs: Seg[] = [];
const blds: Bld[] = [];
const green: Poly[] = [];
const sand: Poly[] = [];
const water: Poly[] = [];
const piers: Seg[] = [];
const coast: Coast[] = [];
const nodes: Pt[] = [];
interface Landmark { kind: string; name: string; x: number; y: number; len: number; wid: number; ang: number }
const landmarks: Landmark[] = [];
/** ¿Dentro del rectángulo orientado del hito? (con margen) */
function inLandmark(l: Landmark, px: number, py: number, m = 0): boolean {
  // ang: desde el norte (-y) hacia el este (+x)
  const ax = Math.sin(l.ang);
  const ay = -Math.cos(l.ang);
  const dx = px - l.x;
  const dy = py - l.y;
  const a = dx * ax + dy * ay;
  const b = dx * -ay + dy * ax;
  return Math.abs(a) <= l.len / 2 + m && Math.abs(b) <= l.wid / 2 + m;
}
const bSeg = new Map<number, number[]>();
const bBld = new Map<number, number[]>();
const bCoast = new Map<number, number[]>();
const bPoly = new Map<number, Array<[Poly, "g" | "s" | "w"]>>();
const bPier = new Map<number, number[]>();
const bNode = new Map<number, number[]>();

const bk = (bx: number, by: number): number => (by + 4000) * 8192 + (bx + 4000);
function put<T>(m: Map<number, T[]>, x0: number, y0: number, x1: number, y1: number, v: T, pad = 0): void {
  for (let by = Math.floor((Math.min(y0, y1) - pad) / BUCKET); by <= Math.floor((Math.max(y0, y1) + pad) / BUCKET); by++) {
    for (let bx = Math.floor((Math.min(x0, x1) - pad) / BUCKET); bx <= Math.floor((Math.max(x0, x1) + pad) / BUCKET); bx++) {
      const k = bk(bx, by);
      const l = m.get(k);
      if (l) l.push(v);
      else m.set(k, [v]);
    }
  }
}
function toPts(f: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push([f[i], f[i + 1]]);
  return out;
}
function bboxOf(p: Pt[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of p) {
    a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y);
  }
  return [a, b, c, d];
}

function load(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(FILE)) return;
  const data = JSON.parse(gunzipSync(readFileSync(FILE)).toString("utf8"));
  const nodeCount = new Map<string, { n: number; x: number; y: number; ways: Set<number> }>();
  for (const [wid, kind, ow, bridge, flat] of data.roads as Array<[number, 0 | 1 | 2, number, number, number[]]>) {
    const pts = toPts(flat);
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const l = Math.hypot(x1 - x0, y1 - y0);
      // puentes: suben en el primer y último 20 % (o 25 tiles) de su longitud
      const zAt = (d: number): number => {
        if (!bridge) return 0;
        const ramp = Math.min(25, total * 0.2);
        const k = Math.min(1, Math.min(d, total - d) / Math.max(1, ramp));
        return bridge * BRIDGE_Z * (k * k * (3 - 2 * k));
      };
      const s: Seg = { id: `o${wid}:${i}`, kind, ow, x0, y0, x1, y1, s0: acc, bridge, z0: zAt(acc), z1: zAt(acc + l) };
      segs.push(s);
      put(bSeg, x0, y0, x1, y1, segs.length - 1, CITY_ROAD_HALF[2] + CITY_SIDEWALK_W + 1);
      acc += l;
    }
    if (!bridge) {
      for (const [x, y] of pts) {
        const k = `${x},${y}`;
        const e = nodeCount.get(k) ?? { n: 0, x, y, ways: new Set<number>() };
        e.ways.add(wid);
        nodeCount.set(k, e);
      }
    }
  }
  for (const e of nodeCount.values()) {
    if (e.ways.size >= 2) {
      nodes.push([e.x, e.y]);
      put(bNode, e.x, e.y, e.x, e.y, nodes.length - 1);
    }
  }
  for (const l of (data.landmarks ?? []) as Landmark[]) landmarks.push(l);
  for (const [id, floors, t, flat, name] of data.buildings as Array<[number, number, string, number[], string?]>) {
    const pts = toPts(flat);
    if (landmarks.some((l) => inLandmark(l, pts[0][0], pts[0][1], 2))) continue; // lo ocupa un hito
    const b: Bld = { id: `w${id}`, floors, t, name, pts, bbox: bboxOf(pts) };
    blds.push(b);
    put(bBld, b.bbox[0], b.bbox[1], b.bbox[2], b.bbox[3], blds.length - 1);
  }
  for (const [list, key] of [[data.green, "g"], [data.sand, "s"], [data.water, "w"]] as Array<[number[][], "g" | "s" | "w"]>) {
    for (const flat of list) {
      const pts = toPts(flat);
      if (pts.length < 3) continue;
      const p: Poly = { pts, bbox: bboxOf(pts) };
      if (key === "g") green.push(p);
      else if (key === "s") sand.push(p);
      else water.push(p);
      put(bPoly, p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3], [p, key] as [Poly, "g" | "s" | "w"]);
    }
  }
  for (const flat of data.coast as number[][]) {
    const pts = toPts(flat);
    for (let i = 0; i + 1 < pts.length; i++) {
      coast.push({ x0: pts[i][0], y0: pts[i][1], x1: pts[i + 1][0], y1: pts[i + 1][1] });
      put(bCoast, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], coast.length - 1);
    }
  }
  for (const flat of data.piers as number[][]) {
    const pts = toPts(flat);
    for (let i = 0; i + 1 < pts.length; i++) {
      piers.push({ id: "p", kind: 0, ow: 0, x0: pts[i][0], y0: pts[i][1], x1: pts[i + 1][0], y1: pts[i + 1][1], s0: 0, bridge: 0, z0: 0, z1: 0 });
      put(bPier, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], piers.length - 1, 3);
    }
  }
  ok = true;
  console.log(`Ciudad real (OSM): ${segs.length} tramos de calle, ${blds.length} edificios, ${coast.length} tramos de costa`);
}

export function osmAvailable(): boolean {
  load();
  return ok;
}

function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / l2)) : 0;
  return Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
}
function inPoly(x: number, y: number, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** ¿Es mar? Lado del tramo de costa más cercano (en OSM la tierra queda a la
 * izquierda; con la y hacia el sur, a la derecha: mar si el producto cruzado > 0). */
function seaSide(px: number, py: number, cands: number[]): boolean | null {
  let bd = Infinity;
  let line = 0;
  let sea: boolean | null = null;
  for (const i of cands) {
    const c = coast[i];
    const d = distSeg(px, py, c.x0, c.y0, c.x1, c.y1);
    const len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
    if (len < 1e-6) continue;
    const cross = (c.x1 - c.x0) * (py - c.y0) - (c.y1 - c.y0) * (px - c.x0);
    const ld = Math.abs(cross) / len;
    // empate en un vértice compartido: manda el tramo con más distancia a su recta
    // (el otro puede quedar "por detrás" del vértice y dar el lado contrario)
    if (d < bd - 1e-4 || (d < bd + 1e-4 && ld > line)) {
      bd = d;
      line = ld;
      sea = cross > 0;
    }
  }
  return sea;
}

export function rasterRoomOSM(sx: number, sy: number): { tiles: TileType[][]; city: CityData } {
  load();
  const gx0 = sx * SCREEN_WIDTH;
  const gy0 = sy * SCREEN_HEIGHT;
  const pad = 40;
  // costa cercana (y, si no hay, el lado de la sala entera respecto a la costa)
  const nearCoast = new Set<number>();
  for (let by = Math.floor((gy0 - pad) / BUCKET); by <= Math.floor((gy0 + SCREEN_HEIGHT + pad) / BUCKET); by++) {
    for (let bx = Math.floor((gx0 - pad) / BUCKET); bx <= Math.floor((gx0 + SCREEN_WIDTH + pad) / BUCKET); bx++) {
      for (const i of bCoast.get(bk(bx, by)) ?? []) nearCoast.add(i);
    }
  }
  let roomSea: boolean | null = null;
  if (nearCoast.size === 0) {
    const all: number[] = [];
    for (let i = 0; i < coast.length; i++) all.push(i);
    roomSea = seaSide(gx0 + SCREEN_WIDTH / 2, gy0 + SCREEN_HEIGHT / 2, all);
  }
  const coastList = [...nearCoast];

  const tiles: TileType[][] = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const px = gx0 + x + 0.5;
      const py = gy0 + y + 0.5;
      const key = bk(Math.floor(px / BUCKET), Math.floor(py / BUCKET));
      let type: TileType = TileType.Sidewalk;
      let road = false;
      let side = false;
      for (const i of bSeg.get(key) ?? []) {
        const s = segs[i];
        if (s.bridge) continue; // bajo un puente no hay calzada (sí, a ras de suelo, lo que cruce)
        const d = distSeg(px, py, s.x0, s.y0, s.x1, s.y1);
        const half = CITY_ROAD_HALF[s.kind];
        if (d <= half) {
          road = true;
          break;
        }
        if (d <= half + CITY_SIDEWALK_W) side = true;
      }
      let pier = false;
      for (const i of bPier.get(key) ?? []) {
        const p = piers[i];
        if (distSeg(px, py, p.x0, p.y0, p.x1, p.y1) < 2.2) pier = true;
      }
      const sea = roomSea !== null ? roomSea : coastList.length ? seaSide(px, py, coastList) : false;
      // las playas suelen estar cartografiadas del lado del mar de la línea de costa
      let beach = false;
      for (const [p, k] of bPoly.get(key) ?? []) {
        if (k === "s" && px >= p.bbox[0] && px <= p.bbox[2] && py >= p.bbox[1] && py <= p.bbox[3] && inPoly(px, py, p.pts)) beach = true;
      }
      if (landmarks.some((l) => inLandmark(l, px, py))) type = TileType.Building; // hito (estadio)
      else if (road) type = TileType.Road;
      else if (side) type = TileType.Sidewalk;
      else if (beach) type = TileType.Path;
      else if (sea && !pier) type = TileType.Water;
      else {
        let found: TileType | null = null;
        for (const i of bBld.get(key) ?? []) {
          const b = blds[i];
          if (px < b.bbox[0] || px > b.bbox[2] || py < b.bbox[1] || py > b.bbox[3]) continue;
          if (inPoly(px, py, b.pts)) {
            found = TileType.Building;
            break;
          }
        }
        if (!found) {
          for (const [p, k] of bPoly.get(key) ?? []) {
            if (px < p.bbox[0] || px > p.bbox[2] || py < p.bbox[1] || py > p.bbox[3]) continue;
            if (!inPoly(px, py, p.pts)) continue;
            if (k === "w") found = TileType.Water;
            else if (k === "s") found = TileType.Path; // arena de playa (transitable)
            else if (found === null) found = TileType.Grass;
          }
        }
        if (found !== null) type = found;
      }
      row.push(type);
    }
    tiles.push(row);
  }

  // geometría de la sala
  const gpad = CITY_ROAD_HALF[2] + CITY_SIDEWALK_W + 1;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const roads: CityRoad[] = [];
  const highways: CityHighway[] = [];
  const pillars: Array<[number, number, number, number, number]> = [];
  const seen = new Set<number>();
  for (let by = Math.floor((gy0 - gpad) / BUCKET); by <= Math.floor((gy0 + SCREEN_HEIGHT + gpad) / BUCKET); by++) {
    for (let bx = Math.floor((gx0 - gpad) / BUCKET); bx <= Math.floor((gx0 + SCREEN_WIDTH + gpad) / BUCKET); bx++) {
      for (const i of bSeg.get(bk(bx, by)) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const s = segs[i];
        if (Math.max(s.x0, s.x1) < gx0 - gpad || Math.min(s.x0, s.x1) > gx0 + SCREEN_WIDTH + gpad) continue;
        if (Math.max(s.y0, s.y1) < gy0 - gpad || Math.min(s.y0, s.y1) > gy0 + SCREEN_HEIGHT + gpad) continue;
        if (s.bridge && Math.max(s.z0, s.z1) > 0.5) {
          highways.push({ id: s.id, kind: s.kind === 2 ? 0 : 1, x0: r2(s.x0), y0: r2(s.y0), z0: r2(s.z0), x1: r2(s.x1), y1: r2(s.y1), z1: r2(s.z1), half: CITY_ROAD_HALF[s.kind] + 0.4, s0: r2(s.s0) });
          const mx = (s.x0 + s.x1) / 2;
          const my = (s.y0 + s.y1) / 2;
          const z = (s.z0 + s.z1) / 2;
          if (z > 0.8) pillars.push([r2(mx), r2(my), r2(z), r2(CITY_ROAD_HALF[s.kind] * 1.6), r2(Math.atan2(s.y1 - s.y0, s.x1 - s.x0))]);
        } else {
          const road: CityRoad = { id: s.id, kind: s.kind, x0: r2(s.x0), y0: r2(s.y0), x1: r2(s.x1), y1: r2(s.y1), s0: r2(s.s0) };
          if (s.ow) road.ow = s.ow as 1 | -1;
          roads.push(road);
        }
      }
    }
  }
  const buildings: CityBuilding[] = [];
  const bseen = new Set<number>();
  for (let by = Math.floor(gy0 / BUCKET); by <= Math.floor((gy0 + SCREEN_HEIGHT) / BUCKET); by++) {
    for (let bx = Math.floor(gx0 / BUCKET); bx <= Math.floor((gx0 + SCREEN_WIDTH) / BUCKET); bx++) {
      for (const i of bBld.get(bk(bx, by)) ?? []) {
        if (bseen.has(i)) continue;
        bseen.add(i);
        const b = blds[i];
        // cada edificio lo manda la sala que contiene su primer vértice
        const [fx, fy] = b.pts[0];
        if (fx < gx0 || fx >= gx0 + SCREEN_WIDTH || fy < gy0 || fy >= gy0 + SCREEN_HEIGHT) continue;
        const cb: CityBuilding = { id: b.id, floors: b.floors, pts: b.pts.map(([x, y]) => [r2(x), r2(y)] as [number, number]), t: b.t };
        if (b.name) cb.name = b.name;
        buildings.push(cb);
      }
    }
  }
  const nodeList: Array<[number, number]> = [];
  for (let by = Math.floor((gy0 - gpad) / BUCKET); by <= Math.floor((gy0 + SCREEN_HEIGHT + gpad) / BUCKET); by++) {
    for (let bx = Math.floor((gx0 - gpad) / BUCKET); bx <= Math.floor((gx0 + SCREEN_WIDTH + gpad) / BUCKET); bx++) {
      for (const i of bNode.get(bk(bx, by)) ?? []) nodeList.push([r2(nodes[i][0]), r2(nodes[i][1])]);
    }
  }
  // costa y playas cercanas (muros del paseo marítimo, arena, oleaje)
  const coastOut: Array<[number, number, number, number]> = coastList.map((i) => [r2(coast[i].x0), r2(coast[i].y0), r2(coast[i].x1), r2(coast[i].y1)]);
  const sandOut: Array<Array<[number, number]>> = [];
  const sseen = new Set<Poly>();
  for (let by = Math.floor((gy0 - 10) / BUCKET); by <= Math.floor((gy0 + SCREEN_HEIGHT + 10) / BUCKET); by++) {
    for (let bx = Math.floor((gx0 - 10) / BUCKET); bx <= Math.floor((gx0 + SCREEN_WIDTH + 10) / BUCKET); bx++) {
      for (const [p, k] of bPoly.get(bk(bx, by)) ?? []) {
        if (k !== "s" || sseen.has(p)) continue;
        sseen.add(p);
        sandOut.push(p.pts.map(([x, y]) => [r2(x), r2(y)] as [number, number]));
      }
    }
  }
  const pierOut: Array<[number, number, number, number]> = [];
  const pseen = new Set<number>();
  for (let by = Math.floor((gy0 - pad) / BUCKET); by <= Math.floor((gy0 + SCREEN_HEIGHT + pad) / BUCKET); by++) {
    for (let bx = Math.floor((gx0 - pad) / BUCKET); bx <= Math.floor((gx0 + SCREEN_WIDTH + pad) / BUCKET); bx++) {
      for (const i of bPier.get(bk(bx, by)) ?? []) {
        if (pseen.has(i)) continue;
        pseen.add(i);
        const p = piers[i];
        pierOut.push([r2(p.x0), r2(p.y0), r2(p.x1), r2(p.y1)]);
      }
    }
  }
  const lms = landmarks.filter((l) => l.x + l.len > gx0 - 60 && l.x - l.len < gx0 + SCREEN_WIDTH + 60 && l.y + l.len > gy0 - 60 && l.y - l.len < gy0 + SCREEN_HEIGHT + 60);
  return { tiles, city: { roads, buildings, nodes: nodeList, highways, pillars, osm: true, coast: coastOut, sand: sandOut, piers: pierOut, landmarks: lms } };
}

/** Punto de calle más cercano (para colocar a un jugador). */
export function nearestRoadOSM(gx: number, gy: number): { x: number; y: number } | null {
  load();
  let best: Seg | null = null;
  let bd = Infinity;
  for (let r = 0; r < 6 && !best; r++) {
    for (let by = Math.floor(gy / BUCKET) - r; by <= Math.floor(gy / BUCKET) + r; by++) {
      for (let bx = Math.floor(gx / BUCKET) - r; bx <= Math.floor(gx / BUCKET) + r; bx++) {
        for (const i of bSeg.get(bk(bx, by)) ?? []) {
          const s = segs[i];
          if (s.bridge) continue;
          const d = distSeg(gx, gy, s.x0, s.y0, s.x1, s.y1);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
      }
    }
  }
  return best ? { x: (best.x0 + best.x1) / 2, y: (best.y0 + best.y1) / 2 } : null;
}
