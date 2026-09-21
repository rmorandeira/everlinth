import {
  BIOME_CATALOG,
  BIOME_IDS,
  minTransitionScreens,
  type BiomeId,
  type BiomeSource,
  type BiomeBlend,
} from "@roi/shared";
import { makeRng, seedFromCoords } from "./rng.js";
import { getPaintRange } from "./db.js";

// Tamaño de la región de ruido: cuántas estancias abarca cada "celda" del campo
// continuo antes de interpolar. Cuanto mayor, más extensas las zonas naturales
// de un mismo bioma procedural (sin pintar).
const NOISE_REGION = 24;

function latticeValue(gx: number, gy: number, salt: number): number {
  return makeRng(seedFromCoords(gx * 2 + salt, gy * 2 + salt))() * 2 - 1; // -1..1
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

// Ruido de valor suavizado (interpolación entre esquinas de una rejilla mucho
// más gruesa que las estancias): a diferencia de seedFromCoords/makeRng, que da
// un valor independiente por celda, esto varía poco a poco, para que un bioma
// procedural ocupe una región y no una estancia suelta al azar.
function smoothNoise(sx: number, sy: number, salt: number): number {
  const gx = sx / NOISE_REGION;
  const gy = sy / NOISE_REGION;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = fade(gx - x0);
  const ty = fade(gy - y0);
  const v00 = latticeValue(x0, y0, salt);
  const v10 = latticeValue(x0 + 1, y0, salt);
  const v01 = latticeValue(x0, y0 + 1, salt);
  const v11 = latticeValue(x0 + 1, y0 + 1, salt);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

// Bioma "natural" de una estancia si nadie la ha pintado: dos ejes de ruido
// (temperatura, artificialidad) y el bioma del catálogo más cercano a ese punto.
export function proceduralBiome(sx: number, sy: number): BiomeId {
  const temp = smoothNoise(sx, sy, 1);
  const tech = smoothNoise(sx, sy, 2);
  let best: BiomeId = BIOME_IDS[0];
  let bestDist = Infinity;
  for (const id of BIOME_IDS) {
    const def = BIOME_CATALOG[id];
    const d = Math.hypot(def.temp - temp, def.tech - tech);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

export interface ResolvedBiome {
  biome: BiomeId;
  source: BiomeSource;
}

// Prioridad: lo pintado por el super admin manda; si no hay nada pintado, se usa
// el cálculo procedural.
export function resolveBiome(sx: number, sy: number, painted?: Map<string, BiomeId>): ResolvedBiome {
  const key = `${sx},${sy}`;
  const paintedBiome = painted ? painted.get(key) : undefined;
  if (paintedBiome) return { biome: paintedBiome, source: "paint" };
  return { biome: proceduralBiome(sx, sy), source: "procedural" };
}

// Radio máximo de aviso: la mayor distancia mínima de transición que existe
// entre cualquier pareja del catálogo. Se recalcula solo si cambia el catálogo.
const MAX_MARGIN = Math.max(
  1,
  ...BIOME_IDS.flatMap((a) => BIOME_IDS.map((b) => minTransitionScreens(a, b)))
);

export interface BiomeClassification {
  biome: BiomeId;
  biomeSource: BiomeSource;
  biomeBlend: BiomeBlend | null;
}

interface Candidate {
  biome: BiomeId;
  factor: number;
  forced: boolean;
}

// Decide si una estancia es de continuidad (bioma puro) o de transición, y hacia
// qué bioma vecino se mezcla y a qué intensidad. Terreno pintado es autoritativo:
// si el borde con una zona decretada cae dentro de su radio de aviso, la
// transición es obligatoria. Entre dos zonas puramente procedurales que resultan
// vecinas por azar, la transición es solo probable (una tirada determinista).
export function classifyBiome(sx: number, sy: number): BiomeClassification {
  // Una sola consulta a la BD para todo el radio de aviso, en vez de una por
  // celda: es la misma lección del autosave, aplicada aquí antes de que sea un problema.
  const painted = getPaintRange(sx - MAX_MARGIN, sx + MAX_MARGIN, sy - MAX_MARGIN, sy + MAX_MARGIN);
  const self = resolveBiome(sx, sy, painted);

  const candidates: Candidate[] = [];
  for (let dy = -MAX_MARGIN; dy <= MAX_MARGIN; dy++) {
    for (let dx = -MAX_MARGIN; dx <= MAX_MARGIN; dx++) {
      if (dx === 0 && dy === 0) continue;
      const other = resolveBiome(sx + dx, sy + dy, painted);
      if (other.biome === self.biome) continue;

      const required = minTransitionScreens(self.biome, other.biome);
      const dist = Math.hypot(dx, dy);
      if (dist > required) continue;

      const forced = self.source === "paint" || other.source === "paint";
      if (!forced) {
        // Frontera puramente procedural: la tirada decide si de verdad transiciona
        // aquí o si esta vez el corte es limpio. Determinista por pareja de celdas.
        const roll = makeRng(seedFromCoords(sx * 3 + other.biome.length, sy * 3 + dx + dy))();
        if (roll >= 0.5) continue;
      }

      const factor = Math.max(0.05, 1 - dist / required);
      candidates.push({ biome: other.biome, factor, forced });
    }
  }

  if (candidates.length === 0) {
    return { biome: self.biome, biomeSource: self.source, biomeBlend: null };
  }

  candidates.sort((a, b) => {
    if (a.forced !== b.forced) return a.forced ? -1 : 1;
    return b.factor - a.factor;
  });
  const winner = candidates[0];
  return {
    biome: self.biome,
    biomeSource: self.source,
    biomeBlend: { from: winner.biome, factor: winner.factor },
  };
}
