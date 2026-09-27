// Bioma "countryside" (campo): trama rural determinista en tiles globales (1 tile = 1,5 m).
// - Carreteras secundarias asfaltadas: una red suelta este-oeste y norte-sur (~0,9 y
//   ~1,2 km entre sí) con curvas suaves, como las de la foto aérea.
// - Parcelas: rejilla de fincas de ~150 × 105 m; cada una es trigo, rastrojo (segado,
//   con las rodadas del tractor), tierra arada o prado, y tiene su dirección de labor.
// - Pistas de tierra por algunos lindes entre fincas.
// - Granjas en algunas fincas: granero (tres modelos), silos, molino y tractor, con
//   su era de tierra. Los graneros y silos ocupan casillas de edificio (colisión).
// Misma salida que los generadores de ciudad: casillas + geometría (CityData rural).
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, type CityData, type CityRoad } from "@roi/shared";

const SP_Y = 600; // entre carreteras este-oeste
const SP_X = 800; // entre carreteras norte-sur
const BASE_Y = 40;
const BASE_X = -6900;
const ROAD_HALF = 2.4; // calzada de ~7 m
const STEP = 8;
const CELL_W = 100; // finca (tiles)
const CELL_H = 70;
const TRACK_HALF = 1.1;

type FieldKind = "wheat" | "stubble" | "plowed" | "pasture";

function hash2(x: number, y: number, salt = 0): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function ewY(k: number, x: number): number {
  return BASE_Y + k * SP_Y + 45 * Math.sin(x / 380 + k * 1.3) + 12 * Math.sin(x / 110 + k);
}
function nsX(m: number, y: number): number {
  return BASE_X + m * SP_X + 50 * Math.sin(y / 420 + m * 2.1) + 14 * Math.sin(y / 130 + m);
}

function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / l2)) : 0;
  return Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
}

interface Seg {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  s0: number;
}

/** Tramos de carretera asfaltada dentro del rectángulo (con margen). */
function roadsIn(x0: number, y0: number, x1: number, y1: number): Seg[] {
  const out: Seg[] = [];
  for (let k = Math.floor((y0 - BASE_Y - 80) / SP_Y); k <= Math.ceil((y1 - BASE_Y + 80) / SP_Y); k++) {
    for (let x = Math.floor(x0 / STEP) * STEP; x < x1; x += STEP) {
      const ya = ewY(k, x);
      const yb = ewY(k, x + STEP);
      if (Math.max(ya, yb) < y0 || Math.min(ya, yb) > y1) continue;
      out.push({ id: `ce${k}:${x}`, x0: x, y0: ya, x1: x + STEP, y1: yb, s0: x });
    }
  }
  for (let m = Math.floor((x0 - BASE_X - 80) / SP_X); m <= Math.ceil((x1 - BASE_X + 80) / SP_X); m++) {
    for (let y = Math.floor(y0 / STEP) * STEP; y < y1; y += STEP) {
      const xa = nsX(m, y);
      const xb = nsX(m, y + STEP);
      if (Math.max(xa, xb) < x0 || Math.min(xa, xb) > x1) continue;
      out.push({ id: `cn${m}:${y}`, x0: xa, y0: y, x1: xb, y1: y + STEP, s0: y });
    }
  }
  return out;
}

interface Field {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: FieldKind;
  ang: number;
  farm: boolean;
}

function field(cx: number, cy: number): Field {
  const h = hash2(cx, cy, 1);
  const farm = hash2(cx, cy, 7) < 0.14;
  const kind: FieldKind = farm ? "pasture" : h < 0.42 ? "wheat" : h < 0.62 ? "stubble" : h < 0.82 ? "plowed" : "pasture";
  return { id: `f${cx}:${cy}`, x0: cx * CELL_W + 1, y0: cy * CELL_H + 1, x1: (cx + 1) * CELL_W - 1, y1: (cy + 1) * CELL_H - 1, kind, ang: hash2(cx, cy, 3) < 0.5 ? 0 : Math.PI / 2, farm };
}

/** Pistas de tierra por los lindes (con algo de ondulación, que casa entre salas). */
function tracksIn(x0: number, y0: number, x1: number, y1: number): Array<[number, number, number, number, number]> {
  const out: Array<[number, number, number, number, number]> = [];
  const cx0 = Math.floor(x0 / CELL_W) - 1;
  const cx1 = Math.floor(x1 / CELL_W) + 1;
  const cy0 = Math.floor(y0 / CELL_H) - 1;
  const cy1 = Math.floor(y1 / CELL_H) + 1;
  const wob = (a: number, b: number, t: number): number => Math.sin(t * Math.PI) * (hash2(a, b, 9) - 0.5) * 5;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      // linde vertical a la izquierda de la finca (cx, cy); las granjas siempre tienen la suya
      if (hash2(cx, cy, 4) < 0.4 || field(cx, cy).farm || field(cx - 1, cy).farm) {
        const x = cx * CELL_W;
        for (let i = 0; i < 4; i++) {
          const ta = i / 4;
          const tb = (i + 1) / 4;
          out.push([x + wob(cx, cy, ta), cy * CELL_H + ta * CELL_H, x + wob(cx, cy, tb), cy * CELL_H + tb * CELL_H, TRACK_HALF]);
        }
      }
      if (hash2(cx, cy, 5) < 0.3) {
        const y = cy * CELL_H;
        for (let i = 0; i < 4; i++) {
          const ta = i / 4;
          const tb = (i + 1) / 4;
          out.push([cx * CELL_W + ta * CELL_W, y + wob(cy, cx, ta), cx * CELL_W + tb * CELL_W, y + wob(cy, cx, tb), TRACK_HALF]);
        }
      }
    }
  }
  return out.filter((t) => Math.max(t[0], t[2]) >= x0 && Math.min(t[0], t[2]) <= x1 && Math.max(t[1], t[3]) >= y0 && Math.min(t[1], t[3]) <= y1);
}

interface Prop {
  id: string;
  m: string;
  x: number;
  y: number;
  a: number;
  // huella (tiles): rectángulo largo × ancho a lo largo de a, o radio
  len?: number;
  wid?: number;
  r?: number;
}

/** Granja de la finca (si la tiene): granero, silos, molino y tractor, y su era. */
function farmOf(cx: number, cy: number): { props: Prop[]; yard: [number, number, number, number] } | null {
  const f = field(cx, cy);
  if (!f.farm) return null;
  const v = Math.floor(hash2(cx, cy, 11) * 3);
  const barn = ["countryside/barn-a", "countryside/barn-b", "countryside/barn-c"][v];
  const bl = [20.5, 15, 10][v]; // largo en tiles (con alero)
  const bw = [8.5, 7.2, 5.9][v];
  const rot = hash2(cx, cy, 12) < 0.5 ? 0 : Math.PI / 2;
  const cx0 = cx * CELL_W + CELL_W * (0.35 + hash2(cx, cy, 13) * 0.2);
  const cy0 = cy * CELL_H + CELL_H * (0.35 + hash2(cx, cy, 14) * 0.2);
  const ax = Math.cos(rot);
  const ay = Math.sin(rot);
  const props: Prop[] = [{ id: `b${cx}:${cy}`, m: barn, x: cx0, y: cy0, a: rot, len: bl, wid: bw }];
  // silos en fila junto a un costado del granero
  const nsil = 1 + Math.floor(hash2(cx, cy, 15) * 3);
  for (let i = 0; i < nsil; i++) {
    const t = (i - (nsil - 1) / 2) * 5;
    props.push({ id: `s${cx}:${cy}:${i}`, m: "countryside/silo", x: cx0 + ax * t - ay * (bw / 2 + 4.5), y: cy0 + ay * t + ax * (bw / 2 + 4.5), a: 0, r: 2.2 });
  }
  // molino en una esquina de la era y tractor delante de la puerta
  props.push({ id: `w${cx}:${cy}`, m: "countryside/windmill", x: cx0 - ax * (bl / 2 + 7) + ay * 6, y: cy0 - ay * (bl / 2 + 7) - ax * 6, a: hash2(cx, cy, 16) * Math.PI * 2, r: 1.2 });
  const tractor = hash2(cx, cy, 17) < 0.5 ? "countryside/tractor-red" : "countryside/tractor-green";
  props.push({ id: `t${cx}:${cy}`, m: tractor, x: cx0 + ax * (bl / 2 + 4) + ay * 2, y: cy0 + ay * (bl / 2 + 4) - ax * 2, a: rot + (hash2(cx, cy, 18) - 0.5) * 1.2 });
  // era de tierra alrededor
  const ex = Math.abs(ax) * (bl / 2 + 10) + Math.abs(ay) * (bw / 2 + 9);
  const ey = Math.abs(ay) * (bl / 2 + 10) + Math.abs(ax) * (bw / 2 + 9);
  return { props, yard: [cx0 - ex, cy0 - ey, cx0 + ex, cy0 + ey] };
}

function inProp(p: Prop, px: number, py: number): boolean {
  if (p.r !== undefined) return Math.hypot(px - p.x, py - p.y) <= p.r;
  if (p.len === undefined || p.wid === undefined) return false;
  const dx = px - p.x;
  const dy = py - p.y;
  const a = dx * Math.cos(p.a) + dy * Math.sin(p.a);
  const b = -dx * Math.sin(p.a) + dy * Math.cos(p.a);
  return Math.abs(a) <= p.len / 2 && Math.abs(b) <= p.wid / 2;
}

export function rasterRoomCountryside(sx: number, sy: number): { tiles: TileType[][]; city: CityData } {
  const gx0 = sx * SCREEN_WIDTH;
  const gy0 = sy * SCREEN_HEIGHT;
  const pad = 6;
  const roads = roadsIn(gx0 - pad, gy0 - pad, gx0 + SCREEN_WIDTH + pad, gy0 + SCREEN_HEIGHT + pad);
  const tracks = tracksIn(gx0 - pad, gy0 - pad, gx0 + SCREEN_WIDTH + pad, gy0 + SCREEN_HEIGHT + pad);
  // fincas y granjas que tocan la sala
  const fields: Field[] = [];
  const props: Prop[] = [];
  const yards: Array<[number, number, number, number]> = [];
  for (let cy = Math.floor((gy0 - 30) / CELL_H); cy <= Math.floor((gy0 + SCREEN_HEIGHT + 30) / CELL_H); cy++) {
    for (let cx = Math.floor((gx0 - 30) / CELL_W); cx <= Math.floor((gx0 + SCREEN_WIDTH + 30) / CELL_W); cx++) {
      const f = field(cx, cy);
      if (f.x1 >= gx0 - 2 && f.x0 <= gx0 + SCREEN_WIDTH + 2 && f.y1 >= gy0 - 2 && f.y0 <= gy0 + SCREEN_HEIGHT + 2) fields.push(f);
      const farm = farmOf(cx, cy);
      if (farm) {
        props.push(...farm.props);
        yards.push(farm.yard);
      }
    }
  }
  const tiles: TileType[][] = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const px = gx0 + x + 0.5;
      const py = gy0 + y + 0.5;
      let t: TileType = TileType.Grass;
      if (roads.some((s) => distSeg(px, py, s.x0, s.y0, s.x1, s.y1) <= ROAD_HALF)) t = TileType.Road;
      else if (props.some((p) => (p.len !== undefined || p.r !== undefined) && !p.m.includes("tractor") && inProp(p, px, py))) t = TileType.Building;
      else if (tracks.some((k) => distSeg(px, py, k[0], k[1], k[2], k[3]) <= k[4]) || yards.some((yd) => px >= yd[0] && px <= yd[2] && py >= yd[1] && py <= yd[3])) t = TileType.Path;
      row.push(t);
    }
    tiles.push(row);
  }
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const cityRoads: CityRoad[] = roads.map((s) => ({ id: s.id, kind: 1, x0: r2(s.x0), y0: r2(s.y0), x1: r2(s.x1), y1: r2(s.y1), s0: r2(s.s0) }));
  const inRoom = (x: number, y: number): boolean => x >= gx0 && x < gx0 + SCREEN_WIDTH && y >= gy0 && y < gy0 + SCREEN_HEIGHT;
  return {
    tiles,
    city: {
      roads: cityRoads,
      buildings: [],
      nodes: [],
      rural: true,
      tracks: tracks.map((k) => k.map(r2) as [number, number, number, number, number]),
      fields: fields.map((f) => ({ id: f.id, x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, kind: f.kind, ang: r2(f.ang) })),
      // cada objeto lo manda la sala que contiene su centro (sin repetirse entre salas)
      props: props.filter((p) => inRoom(p.x, p.y)).map((p) => ({ id: p.id, m: p.m, x: r2(p.x), y: r2(p.y), a: r2(p.a) })),
    },
  };
}

/** Punto de carretera o pista más cercano (para colocar al personaje). */
export function nearestRoadCountryside(gx: number, gy: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const s of roadsIn(gx - 700, gy - 700, gx + 700, gy + 700)) {
    const d = distSeg(gx, gy, s.x0, s.y0, s.x1, s.y1);
    if (d < bd) {
      bd = d;
      best = { x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 };
    }
  }
  return best;
}
