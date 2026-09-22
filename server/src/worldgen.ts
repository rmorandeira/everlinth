import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  TileType,
  TILE_DEFS,
  BLOCKING_TILES,
  type ScreenData,
  type MonsterState,
  type ItemState,
  type PlacedTree,
  type ExoticTier,
} from "@roi/shared";
import { makeRng, seedFromCoords } from "./rng.js";
import { MONSTER_KINDS, ITEM_KINDS, pickWeighted } from "./content.js";
import { classifyBiome } from "./biome.js";
import { listTreeDefsForBiome } from "./db.js";

// Huella alfanumérica del contenido real de la estancia (qué tiles hay y qué
// monstruos/objetos contiene), no solo de sus coordenadas — dos estancias con el
// mismo contenido comparten código. FNV-1a de 32 bits en base36.
function hashContent(tiles: TileType[][], monsters: MonsterState[], items: ItemState[]): string {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const row of tiles) for (const t of row) mix(t);
  for (const m of monsters) for (let i = 0; i < m.kind.length; i++) mix(m.kind.charCodeAt(i));
  for (const it of items) for (let i = 0; i < it.kind.length; i++) mix(it.kind.charCodeAt(i));
  return (h >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

// El perímetro entero queda siempre libre de obstáculos: el jugador sale de la
// estancia cruzando en línea recta por cualquier punto del borde, así que ningún
// obstáculo puede taparlo justo en el punto de cruce.
const PERIMETER_CELLS = new Set<string>();
for (let x = 0; x < SCREEN_WIDTH; x++) {
  PERIMETER_CELLS.add(`${x},0`);
  PERIMETER_CELLS.add(`${x},${SCREEN_HEIGHT - 1}`);
}
for (let y = 0; y < SCREEN_HEIGHT; y++) {
  PERIMETER_CELLS.add(`0,${y}`);
  PERIMETER_CELLS.add(`${SCREEN_WIDTH - 1},${y}`);
}

function isOnCross(x: number, y: number): boolean {
  return PERIMETER_CELLS.has(`${x},${y}`);
}

// Analiza la estancia ya generada: si algún obstáculo (o un grupo agrupado de ellos)
// deja una zona incomunicada del resto, traza el camino más corto para reconectarla.
// Así los caminos salen de los obstáculos reales de cada pantalla, no de una forma fija.
function floodFillReachable(tiles: TileType[][]): boolean[][] {
  const visited: boolean[][] = Array.from({ length: SCREEN_HEIGHT }, () => new Array(SCREEN_WIDTH).fill(false));
  const startX = Math.floor(SCREEN_WIDTH / 2);
  const startY = Math.floor(SCREEN_HEIGHT / 2);
  if (BLOCKING_TILES.has(tiles[startY][startX])) tiles[startY][startX] = TileType.Grass;
  const stack = [{ x: startX, y: startY }];
  visited[startY][startX] = true;
  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= SCREEN_WIDTH || ny < 0 || ny >= SCREEN_HEIGHT) continue;
      if (visited[ny][nx] || BLOCKING_TILES.has(tiles[ny][nx])) continue;
      visited[ny][nx] = true;
      stack.push({ x: nx, y: ny });
    }
  }
  return visited;
}

function ensureConnectivity(tiles: TileType[][]): void {
  const borders: Array<Array<{ x: number; y: number }>> = [
    Array.from({ length: SCREEN_WIDTH }, (_, x) => ({ x, y: 0 })),
    Array.from({ length: SCREEN_WIDTH }, (_, x) => ({ x, y: SCREEN_HEIGHT - 1 })),
    Array.from({ length: SCREEN_HEIGHT }, (_, y) => ({ x: 0, y })),
    Array.from({ length: SCREEN_HEIGHT }, (_, y) => ({ x: SCREEN_WIDTH - 1, y })),
  ];

  for (const border of borders) {
    let reachable = floodFillReachable(tiles);
    if (border.some((p) => reachable[p.y][p.x])) continue;

    let best: { target: { x: number; y: number }; source: { x: number; y: number }; dist: number } | null = null;
    for (const target of border) {
      for (let y = 0; y < SCREEN_HEIGHT; y++) {
        for (let x = 0; x < SCREEN_WIDTH; x++) {
          if (!reachable[y][x]) continue;
          const d = Math.hypot(target.x - x, target.y - y);
          if (!best || d < best.dist) best = { target, source: { x, y }, dist: d };
        }
      }
    }
    if (!best) continue;
    for (const p of bresenhamLine(best.source.x, best.source.y, best.target.x, best.target.y)) {
      tiles[p.y][p.x] = TileType.Path;
    }
    reachable = floodFillReachable(tiles);
  }
}

function isCorner(x: number, y: number): boolean {
  return (
    (x === 0 && y === 0) ||
    (x === SCREEN_WIDTH - 1 && y === 0) ||
    (x === 0 && y === SCREEN_HEIGHT - 1) ||
    (x === SCREEN_WIDTH - 1 && y === SCREEN_HEIGHT - 1)
  );
}

export interface GeneratedScreen {
  screen: ScreenData;
  discoveryXp: number;
}

export function generateScreen(sx: number, sy: number): GeneratedScreen {
  const rng = makeRng(seedFromCoords(sx, sy));

  const tiles: TileType[][] = Array.from({ length: SCREEN_HEIGHT }, () =>
    Array.from({ length: SCREEN_WIDTH }, () => TileType.Grass)
  );

  // Presencia de cada tile "raro" en la pantalla, para el bono de XP de descubrimiento.
  const present = new Set<TileType>();

  // --- "blob": manchas orgánicas (agua) ---
  for (const [key, def] of Object.entries(TILE_DEFS)) {
    if (def.placement !== "blob") continue;
    const t = Number(key) as TileType;
    const seeds = rng() < (def.chance ?? 0) ? 1 : rng() < (def.chance ?? 0) * 0.4 ? 2 : 0;
    for (let i = 0; i < seeds; i++) {
      const cx = 1 + Math.floor(rng() * (SCREEN_WIDTH - 2));
      const cy = 1 + Math.floor(rng() * (SCREEN_HEIGHT - 2));
      const radius = 1 + Math.floor(rng() * 2);
      for (let y = Math.max(0, cy - radius); y <= Math.min(SCREEN_HEIGHT - 1, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(SCREEN_WIDTH - 1, cx + radius); x++) {
          if (isOnCross(x, y)) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d <= radius && rng() < 0.8) {
            tiles[y][x] = t;
            present.add(t);
          }
        }
      }
    }
  }

  // --- "rare": como mucho una unidad por pantalla (p.ej. un edificio) ---
  for (const [key, def] of Object.entries(TILE_DEFS)) {
    if (def.placement !== "rare") continue;
    const t = Number(key) as TileType;
    if (rng() >= (def.chance ?? 0)) continue;
    const bx = 1 + Math.floor(rng() * (SCREEN_WIDTH - 2));
    const by = 1 + Math.floor(rng() * (SCREEN_HEIGHT - 2));
    if (!isOnCross(bx, by) && tiles[by][bx] === TileType.Grass) {
      tiles[by][bx] = t;
      present.add(t);
    }
  }

  // --- "scatter": disperso por celda, con agrupamiento ("cluster") entre vecinos ---
  // Colocar un tile sube la probabilidad de que sus celdas vecinas sean del mismo tipo,
  // así los árboles/rocas aparecen en manchas/bosquecillos en vez de puntos sueltos.
  const scatterDefs = Object.entries(TILE_DEFS).filter(([, def]) => def.placement === "scatter") as Array<
    [string, (typeof TILE_DEFS)[TileType]]
  >;
  const influence = new Map<TileType, number[][]>();
  for (const [key] of scatterDefs) {
    influence.set(
      Number(key) as TileType,
      Array.from({ length: SCREEN_HEIGHT }, () => new Array(SCREEN_WIDTH).fill(0))
    );
  }
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (isOnCross(x, y)) continue;
      if (tiles[y][x] !== TileType.Grass) continue;
      const roll = rng();
      let cumulative = 0;
      for (const [key, def] of scatterDefs) {
        const t = Number(key) as TileType;
        const boost = influence.get(t)![y][x];
        cumulative += Math.min(0.9, (def.weight ?? 0) + boost);
        if (roll < cumulative) {
          tiles[y][x] = t;
          present.add(t);
          const cluster = def.cluster ?? 0;
          if (cluster > 0) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= SCREEN_WIDTH || ny < 0 || ny >= SCREEN_HEIGHT) continue;
                influence.get(t)![ny][nx] += cluster;
              }
            }
          }
          break;
        }
      }
    }
  }

  // --- "segment": un tramo corto en línea (p.ej. una valla), nunca sobre el camino garantizado ---
  for (const [key, def] of Object.entries(TILE_DEFS)) {
    if (def.placement !== "segment") continue;
    const t = Number(key) as TileType;
    if (rng() >= (def.chance ?? 0)) continue;
    const horizontal = rng() < 0.5;
    const length = 2 + Math.floor(rng() * 3);
    const startX = 1 + Math.floor(rng() * Math.max(1, SCREEN_WIDTH - 2 - length));
    const startY = 1 + Math.floor(rng() * (SCREEN_HEIGHT - 2));
    for (let i = 0; i < length; i++) {
      const x = horizontal ? startX + i : startX;
      const y = horizontal ? startY : startY + i;
      if (x >= SCREEN_WIDTH - 1 || y >= SCREEN_HEIGHT - 1) continue;
      if (isOnCross(x, y)) continue;
      if (tiles[y][x] === TileType.Grass) {
        tiles[y][x] = t;
        present.add(t);
      }
    }
  }

  // Analiza la sala ya generada y reconecta cualquier borde que haya quedado
  // encerrado por los obstáculos, trazando el camino más corto posible.
  ensureConnectivity(tiles);

  const walkableSpots: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (isCorner(x, y)) continue;
      const t = tiles[y][x];
      if (t === TileType.Grass || t === TileType.Path) walkableSpots.push({ x, y });
    }
  }

  function takeRandomSpot(): { x: number; y: number } | null {
    if (walkableSpots.length === 0) return null;
    const idx = Math.floor(rng() * walkableSpots.length);
    return walkableSpots.splice(idx, 1)[0];
  }

  const monsters: MonsterState[] = [];
  const monsterRoll = rng();
  const monsterCount = monsterRoll < 0.4 ? 0 : monsterRoll < 0.85 ? 1 : 2;
  let rareMonsterBonus = 0;
  for (let i = 0; i < monsterCount; i++) {
    const spot = takeRandomSpot();
    if (!spot) break;
    const kind = pickWeighted(MONSTER_KINDS, rng);
    if (kind.rarity <= 4) rareMonsterBonus += 11 - kind.rarity;
    monsters.push({
      id: crypto.randomUUID(),
      kind: kind.kind,
      x: spot.x,
      y: spot.y,
      hp: kind.hp,
      maxHp: kind.hp,
      alive: true,
    });
  }

  const items: ItemState[] = [];
  let itemBonus = 0;
  if (rng() < 0.5) {
    const spot = takeRandomSpot();
    if (spot) {
      const kind = pickWeighted(ITEM_KINDS, rng);
      itemBonus = Math.round((11 - kind.rarity) * 1.5);
      items.push({ id: crypto.randomUUID(), kind: kind.kind, x: spot.x, y: spot.y, takenBy: null });
    }
  }

  let presenceBonus = 0;
  for (const t of present) presenceBonus += TILE_DEFS[t].exoticBonus ?? 0;

  const score = 5 + presenceBonus + monsters.length * 3 + rareMonsterBonus + itemBonus + rng() * 5;

  let exoticTier: ExoticTier;
  if (score < 10) exoticTier = "common";
  else if (score < 20) exoticTier = "uncommon";
  else if (score < 35) exoticTier = "rare";
  else exoticTier = "epic";

  const { biome, biomeSource, biomeBlend } = classifyBiome(sx, sy);

  // Árboles generados (ver TreeDef/admin/trees): puramente decorativos, no
  // bloquean movimiento. Solo se plantan si hay alguno guardado compatible con
  // este bioma — si el admin no ha creado ninguno todavía, no aparece nada.
  const placedTrees: PlacedTree[] = [];
  const eligibleTrees = listTreeDefsForBiome(biome);
  if (eligibleTrees.length > 0) {
    const treeRoll = rng();
    const treeCount = treeRoll < 0.5 ? 0 : treeRoll < 0.85 ? 1 : 2;
    for (let i = 0; i < treeCount; i++) {
      const spot = takeRandomSpot();
      if (!spot) break;
      const def = eligibleTrees[Math.floor(rng() * eligibleTrees.length)];
      placedTrees.push({ treeDefId: def.id, x: spot.x, y: spot.y });
    }
  }

  const code = hashContent(tiles, monsters, items);
  const screen: ScreenData = { sx, sy, tiles, monsters, items, placedTrees, exoticTier, biome, biomeSource, biomeBlend, code };
  return { screen, discoveryXp: Math.round(score) };
}
