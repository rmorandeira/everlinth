import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  TileType,
  type ScreenData,
  type MonsterState,
  type ItemState,
  type ExoticTier,
} from "@roi/shared";
import { makeRng, seedFromCoords } from "./rng.js";
import { MONSTER_KINDS, ITEM_KINDS, pickWeighted } from "./content.js";

// Con cámara isométrica + controles relativos a pantalla, las 4 salidas están en las
// 4 ESQUINAS del mundo (no en la mitad de cada borde). El camino garantizado conecta
// las esquinas mediante las dos diagonales de la sala.
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

const DIAGONAL_CELLS = new Set<string>();
for (const p of bresenhamLine(0, 0, SCREEN_WIDTH - 1, SCREEN_HEIGHT - 1)) DIAGONAL_CELLS.add(`${p.x},${p.y}`);
for (const p of bresenhamLine(0, SCREEN_HEIGHT - 1, SCREEN_WIDTH - 1, 0)) DIAGONAL_CELLS.add(`${p.x},${p.y}`);

// El perímetro entero también queda siempre libre: el jugador puede tener que
// deslizarse por un borde hasta alcanzar la esquina (salida), así que ningún
// obstáculo puede bloquear ese recorrido.
const PROTECTED_CELLS = new Set(DIAGONAL_CELLS);
for (let x = 0; x < SCREEN_WIDTH; x++) {
  PROTECTED_CELLS.add(`${x},0`);
  PROTECTED_CELLS.add(`${x},${SCREEN_HEIGHT - 1}`);
}
for (let y = 0; y < SCREEN_HEIGHT; y++) {
  PROTECTED_CELLS.add(`0,${y}`);
  PROTECTED_CELLS.add(`${SCREEN_WIDTH - 1},${y}`);
}

function isOnCross(x: number, y: number): boolean {
  return PROTECTED_CELLS.has(`${x},${y}`);
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

  // Garantiza conectividad entre las 4 esquinas (salidas): las dos diagonales transitables.
  for (const key of DIAGONAL_CELLS) {
    const [x, y] = key.split(",").map(Number);
    tiles[y][x] = TileType.Path;
  }

  let hasWater = false;
  let hasBuilding = false;

  // Uno o dos charcos de agua (exterior: ríos/lagunas), como blobs pequeños.
  const waterSeeds = rng() < 0.5 ? 1 : rng() < 0.2 ? 2 : 0;
  for (let i = 0; i < waterSeeds; i++) {
    const cx = 1 + Math.floor(rng() * (SCREEN_WIDTH - 2));
    const cy = 1 + Math.floor(rng() * (SCREEN_HEIGHT - 2));
    const radius = 1 + Math.floor(rng() * 2);
    for (let y = Math.max(0, cy - radius); y <= Math.min(SCREEN_HEIGHT - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(SCREEN_WIDTH - 1, cx + radius); x++) {
        if (isOnCross(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d <= radius && rng() < 0.8) {
          tiles[y][x] = TileType.Water;
          hasWater = true;
        }
      }
    }
  }

  // Landmark raro: un edificio.
  if (rng() < 0.12) {
    const bx = 1 + Math.floor(rng() * (SCREEN_WIDTH - 2));
    const by = 1 + Math.floor(rng() * (SCREEN_HEIGHT - 2));
    if (!isOnCross(bx, by) && tiles[by][bx] === TileType.Grass) {
      tiles[by][bx] = TileType.Building;
      hasBuilding = true;
    }
  }

  // Árboles y rocas dispersos.
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      if (isOnCross(x, y)) continue;
      if (tiles[y][x] !== TileType.Grass) continue;
      const roll = rng();
      if (roll < 0.05) tiles[y][x] = TileType.Tree;
      else if (roll < 0.08) tiles[y][x] = TileType.Rock;
    }
  }

  // Tramo corto de valla, como elemento de escenario (nunca cruza el pasillo central).
  let hasFence = false;
  if (rng() < 0.3) {
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
        tiles[y][x] = TileType.Fence;
        hasFence = true;
      }
    }
  }

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

  const score =
    5 +
    (hasWater ? 5 : 0) +
    (hasBuilding ? 15 : 0) +
    (hasFence ? 3 : 0) +
    monsters.length * 3 +
    rareMonsterBonus +
    itemBonus +
    rng() * 5;

  let exoticTier: ExoticTier;
  if (score < 10) exoticTier = "common";
  else if (score < 20) exoticTier = "uncommon";
  else if (score < 35) exoticTier = "rare";
  else exoticTier = "epic";

  const screen: ScreenData = { sx, sy, tiles, monsters, items, exoticTier };
  return { screen, discoveryXp: Math.round(score) };
}
