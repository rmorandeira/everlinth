// Autovías elevadas (estilo FDR / BQE de Nueva York): una red global, determinista,
// de autovías sobre pilares que cruzan la ciudad por encima de las calles.
// - Autovías este-oeste y norte-sur cada pocos kilómetros, con trazado de curvas suaves.
// - Tablero a ~7 m (nivel 1); donde se cruzan dos autovías, la norte-sur sube a un
//   segundo nivel (~13 m) y se unen con un trébol de cuatro ramales curvos.
// - Rampas de salida/entrada que bajan a la calle cada cierto tramo.
// - Pilares cada ~15 m (nunca en mitad de una calle: el tablero salva la calle).
// - Los edificios del corredor se quitan; las calles siguen por debajo.
// Todo en tiles globales (1 tile = 1,5 m); alturas en unidades de render (1 = 3 m).

export interface HwSeg {
  id: string;
  kind: 0 | 1; // 0 autovía, 1 rampa/ramal
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  half: number; // semiancho del tablero (tiles)
  s0: number; // distancia a lo largo de su vía (tiles)
}
export interface HwPillar {
  x: number;
  y: number;
  z: number; // altura bajo el tablero (unidades de render)
  w: number; // anchura del cabezal (tiles)
  ang: number; // dirección de la vía (radianes)
}

export const HW_HALF = 6; // 4 carriles + arcenes ≈ 18 m
export const RAMP_HALF = 2.4;
export const HW_Z1 = 2.35; // ~7 m
export const HW_Z2 = 4.35; // ~13 m (segundo nivel en los enlaces)
const SPACING_Y = 1400; // entre autovías este-oeste (tiles)
const SPACING_X = 1800; // entre autovías norte-sur
const BASE_Y = 70; // la primera pasa a ~2 salas al sur del punto de salida
const BASE_X = -160;
const STEP = 8; // muestreo del trazado (tiles)
const PILLAR_EVERY = 10;
const RAMP_EVERY = 520;
const LIFT = 150; // tramo en que la norte-sur sube al segundo nivel antes/después del cruce
const CLOVER_R = 26;

function ewY(k: number, x: number): number {
  return BASE_Y + k * SPACING_Y + 55 * Math.sin(x / 470 + k * 1.7) + 22 * Math.sin(x / 163 + k * 3.1);
}
function nsX(m: number, y: number): number {
  return BASE_X + m * SPACING_X + 60 * Math.sin(y / 510 + m * 2.3) + 20 * Math.sin(y / 181 + m * 0.9);
}

function smooth(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** Cruce (aprox.) de la autovía este-oeste k con la norte-sur m. */
function crossing(k: number, m: number): { x: number; y: number } {
  let x = BASE_X + m * SPACING_X;
  let y = ewY(k, x);
  for (let i = 0; i < 6; i++) {
    x = nsX(m, y);
    y = ewY(k, x);
  }
  return { x, y };
}

/** Altura del tablero de la norte-sur m en y (sube al segundo nivel en los cruces). */
function nsZ(m: number, y: number): number {
  const k = Math.round((y - BASE_Y) / SPACING_Y);
  const c = crossing(k, m);
  const d = Math.abs(y - c.y);
  return HW_Z1 + (HW_Z2 - HW_Z1) * smooth(1 - (d - 40) / LIFT);
}

/** Tramos de autovía, rampas y pilares dentro del rectángulo (tiles globales). */
export function highwaysIn(x0: number, y0: number, x1: number, y1: number): { segs: HwSeg[]; pillars: HwPillar[]; greens: Array<[number, number, number]> } {
  const greens: Array<[number, number, number]> = [];
  const segs: HwSeg[] = [];
  const pillars: HwPillar[] = [];
  const pad = CLOVER_R * 2 + 90;
  const ax0 = x0 - pad;
  const ax1 = x1 + pad;
  const ay0 = y0 - pad;
  const ay1 = y1 + pad;
  // este-oeste
  for (let k = Math.floor((ay0 - BASE_Y - 120) / SPACING_Y); k <= Math.ceil((ay1 - BASE_Y + 120) / SPACING_Y); k++) {
    const xs = Math.floor(ax0 / STEP) * STEP;
    for (let x = xs; x < ax1; x += STEP) {
      const ya = ewY(k, x);
      const yb = ewY(k, x + STEP);
      if (Math.max(ya, yb) < ay0 || Math.min(ya, yb) > ay1) continue;
      segs.push({ id: `hwE${k}:${x}`, kind: 0, x0: x, y0: ya, z0: HW_Z1, x1: x + STEP, y1: yb, z1: HW_Z1, half: HW_HALF, s0: x });
    }
    // pilares
    for (let x = Math.floor(ax0 / PILLAR_EVERY) * PILLAR_EVERY; x < ax1; x += PILLAR_EVERY) {
      const y = ewY(k, x);
      if (y < ay0 || y > ay1) continue;
      const ang = Math.atan2(ewY(k, x + 1) - y, 1);
      pillars.push({ x, y, z: HW_Z1, w: HW_HALF * 1.6, ang });
    }
    // rampas de salida (lado derecho de cada sentido), cada RAMP_EVERY tiles
    for (let x = Math.floor(ax0 / RAMP_EVERY) * RAMP_EVERY; x < ax1; x += RAMP_EVERY) {
      if (Math.abs((x - BASE_X) % SPACING_X) < 260) continue; // lejos de los enlaces
      for (const side of [1, -1]) {
        const len = 80;
        let acc = 0;
        let px = x;
        let py = ewY(k, x) + side * (HW_HALF + RAMP_HALF);
        let pz = HW_Z1;
        for (let i = 1; i <= 10; i++) {
          const t = i / 10;
          const nx = x + side * t * len; // sentido de la marcha: +x por la derecha (side 1)
          const off = HW_HALF + RAMP_HALF + 1.5 + t * t * 9;
          const ny = ewY(k, nx) + side * off;
          const nz = HW_Z1 * (1 - smooth(t * 1.1));
          if (Math.max(py, ny) >= ay0 && Math.min(py, ny) <= ay1) {
            segs.push({ id: `rpE${k}:${x}:${side}:${i}`, kind: 1, x0: px, y0: py, z0: pz, x1: nx, y1: ny, z1: nz, half: RAMP_HALF, s0: acc });
          }
          acc += Math.hypot(nx - px, ny - py);
          if (i % 2 === 0 && nz > 0.4) pillars.push({ x: nx, y: ny, z: nz, w: RAMP_HALF * 1.8, ang: 0 });
          px = nx;
          py = ny;
          pz = nz;
        }
      }
    }
  }
  // norte-sur
  for (let m = Math.floor((ax0 - BASE_X - 120) / SPACING_X); m <= Math.ceil((ax1 - BASE_X + 120) / SPACING_X); m++) {
    const ys = Math.floor(ay0 / STEP) * STEP;
    for (let y = ys; y < ay1; y += STEP) {
      const xa = nsX(m, y);
      const xb = nsX(m, y + STEP);
      if (Math.max(xa, xb) < ax0 || Math.min(xa, xb) > ax1) continue;
      segs.push({ id: `hwN${m}:${y}`, kind: 0, x0: xa, y0: y, z0: nsZ(m, y), x1: xb, y1: y + STEP, z1: nsZ(m, y + STEP), half: HW_HALF, s0: y });
    }
    for (let y = Math.floor(ay0 / PILLAR_EVERY) * PILLAR_EVERY; y < ay1; y += PILLAR_EVERY) {
      const x = nsX(m, y);
      if (x < ax0 || x > ax1) continue;
      const ang = Math.atan2(1, nsX(m, y + 1) - x);
      pillars.push({ x, y, z: nsZ(m, y), w: HW_HALF * 1.6, ang });
    }
    // enlaces en trébol con cada este-oeste: cuatro ramales curvos entre niveles
    for (let k = Math.floor((ay0 - BASE_Y - 200) / SPACING_Y); k <= Math.ceil((ay1 - BASE_Y + 200) / SPACING_Y); k++) {
      const c = crossing(k, m);
      if (c.x < ax0 - 60 || c.x > ax1 + 60 || c.y < ay0 - 60 || c.y > ay1 + 60) continue;
      const off = HW_HALF + CLOVER_R + 2;
      for (const [qx, qy] of [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ]) {
        const cx = c.x + qx * off;
        const cy = c.y + qy * off;
        greens.push([cx, cy, CLOVER_R - RAMP_HALF - 2]); // césped dentro del bucle
        const a0 = Math.atan2(-qy, 0); // desde el lado de la este-oeste
        let acc = 0;
        let px = 0;
        let py = 0;
        let pz = 0;
        const n = 14;
        for (let i = 0; i <= n; i++) {
          // tres cuartos de vuelta (bucle del trébol)
          const t = i / n;
          const a = a0 + qx * qy * t * Math.PI * 1.5;
          const x = cx + Math.cos(a) * CLOVER_R;
          const y = cy + Math.sin(a) * CLOVER_R;
          const z = HW_Z1 + (HW_Z2 - HW_Z1) * smooth(t);
          if (i > 0) {
            segs.push({ id: `cl${k}:${m}:${qx}:${qy}:${i}`, kind: 1, x0: px, y0: py, z0: pz, x1: x, y1: y, z1: z, half: RAMP_HALF, s0: acc });
            acc += Math.hypot(x - px, y - py);
            if (i % 2 === 0) pillars.push({ x, y, z, w: RAMP_HALF * 1.8, ang: a + Math.PI / 2 });
          }
          px = x;
          py = y;
          pz = z;
        }
      }
    }
  }
  return {
    segs: segs.filter((s) => Math.max(s.x0, s.x1) >= x0 - 20 && Math.min(s.x0, s.x1) <= x1 + 20 && Math.max(s.y0, s.y1) >= y0 - 20 && Math.min(s.y0, s.y1) <= y1 + 20),
    pillars: pillars.filter((p) => p.x >= x0 - 4 && p.x <= x1 + 4 && p.y >= y0 - 4 && p.y <= y1 + 4),
    greens: greens.filter((g) => g[0] + g[2] >= x0 && g[0] - g[2] <= x1 && g[1] + g[2] >= y0 && g[1] - g[2] <= y1),
  };
}

export function distToHw(px: number, py: number, s: HwSeg): number {
  const vx = s.x1 - s.x0;
  const vy = s.y1 - s.y0;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - s.x0) * vx + (py - s.y0) * vy) / l2)) : 0;
  return Math.hypot(px - (s.x0 + t * vx), py - (s.y0 + t * vy));
}
