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

const MID_X = Math.floor(SCREEN_WIDTH / 2);
const MID_Y = Math.floor(SCREEN_HEIGHT / 2);

function isOnCross(x: number, y: number): boolean {
  return x === MID_X || y === MID_Y;
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

  // Garantiza conectividad entre las 4 salidas: fila y columna centrales siempre transitables.
  for (let x = 0; x < SCREEN_WIDTH; x++) tiles[MID_Y][x] = TileType.Path;
  for (let y = 0; y < SCREEN_HEIGHT; y++) tiles[y][MID_X] = TileType.Path;

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

  const walkableSpots: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const isExit =
        (x === MID_X && (y === 0 || y === SCREEN_HEIGHT - 1)) ||
        (y === MID_Y && (x === 0 || x === SCREEN_WIDTH - 1));
      if (isExit) continue;
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
