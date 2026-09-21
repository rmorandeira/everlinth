import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenData, PlayerPrivateState, Direction, BiomeId } from "@roi/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// En producción (Railway) esto apunta a un volumen persistente, para que el
// mundo no se borre en cada despliegue.
const dbPath = process.env.DB_PATH ?? path.join(__dirname, "..", "world.db");
export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS screens (
    sx INTEGER NOT NULL,
    sy INTEGER NOT NULL,
    tiles TEXT NOT NULL,
    monsters TEXT NOT NULL,
    items TEXT NOT NULL,
    exotic_tier TEXT NOT NULL,
    biome TEXT NOT NULL DEFAULT 'badlands',
    biome_source TEXT NOT NULL DEFAULT 'procedural',
    biome_blend TEXT,
    code TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (sx, sy)
  );

  CREATE TABLE IF NOT EXISTS players (
    username TEXT PRIMARY KEY,
    sx INTEGER NOT NULL,
    sy INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    hp INTEGER NOT NULL,
    max_hp INTEGER NOT NULL,
    level INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    facing TEXT NOT NULL,
    inventory TEXT NOT NULL
  );

  -- Terreno decretado por el super admin desde el backoffice (spraybrush). Es
  -- autoritativo: si una celda tiene fila aquí, manda sobre el cálculo procedural
  -- del bioma, y obliga transición en su borde (ver server/src/biome.ts). Solo
  -- guarda las celdas que se han pintado explícitamente (sparse), no el mundo entero.
  CREATE TABLE IF NOT EXISTS world_paint (
    sx INTEGER NOT NULL,
    sy INTEGER NOT NULL,
    biome TEXT NOT NULL,
    PRIMARY KEY (sx, sy)
  );
`);

// Migra bases de datos ya existentes (p.ej. en el volumen de producción) que se
// crearon antes de añadir estas columnas.
function ensureColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn("screens", "biome", "TEXT NOT NULL DEFAULT 'badlands'");
ensureColumn("screens", "biome_source", "TEXT NOT NULL DEFAULT 'procedural'");
ensureColumn("screens", "biome_blend", "TEXT");
ensureColumn("screens", "code", "TEXT NOT NULL DEFAULT ''");

const getScreenStmt = db.prepare("SELECT * FROM screens WHERE sx = ? AND sy = ?");
const insertScreenStmt = db.prepare(`
  INSERT OR REPLACE INTO screens (sx, sy, tiles, monsters, items, exotic_tier, biome, biome_source, biome_blend, code)
  VALUES (@sx, @sy, @tiles, @monsters, @items, @exoticTier, @biome, @biomeSource, @biomeBlend, @code)
`);
const listScreenCoordsStmt = db.prepare("SELECT sx, sy, biome, code FROM screens");

export function getScreen(sx: number, sy: number): ScreenData | undefined {
  const row = getScreenStmt.get(sx, sy) as
    | {
        sx: number;
        sy: number;
        tiles: string;
        monsters: string;
        items: string;
        exotic_tier: string;
        biome: BiomeId;
        biome_source: ScreenData["biomeSource"];
        biome_blend: string | null;
        code: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    sx: row.sx,
    sy: row.sy,
    tiles: JSON.parse(row.tiles),
    monsters: JSON.parse(row.monsters),
    items: JSON.parse(row.items),
    exoticTier: row.exotic_tier as ScreenData["exoticTier"],
    biome: row.biome,
    biomeSource: row.biome_source,
    biomeBlend: row.biome_blend ? JSON.parse(row.biome_blend) : null,
    code: row.code,
  };
}

export function saveScreen(screen: ScreenData): void {
  insertScreenStmt.run({
    sx: screen.sx,
    sy: screen.sy,
    tiles: JSON.stringify(screen.tiles),
    monsters: JSON.stringify(screen.monsters),
    items: JSON.stringify(screen.items),
    exoticTier: screen.exoticTier,
    biome: screen.biome,
    biomeSource: screen.biomeSource,
    biomeBlend: screen.biomeBlend ? JSON.stringify(screen.biomeBlend) : null,
    code: screen.code,
  });
}

export function listScreenCoords(): Array<{ sx: number; sy: number; biome: string; code: string }> {
  return listScreenCoordsStmt.all() as Array<{ sx: number; sy: number; biome: string; code: string }>;
}

export function deleteScreen(sx: number, sy: number): boolean {
  return deleteScreenStmt.run(sx, sy).changes > 0;
}

export function deleteScreens(cells: Array<{ sx: number; sy: number }>): number {
  let deleted = 0;
  db.exec("BEGIN");
  try {
    for (const c of cells) deleted += Number(deleteScreenStmt.run(c.sx, c.sy).changes);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return deleted;
}

// ---- Terreno pintado (world_paint) ----

const getPaintStmt = db.prepare("SELECT biome FROM world_paint WHERE sx = ? AND sy = ?");
const getPaintRangeStmt = db.prepare(
  "SELECT sx, sy, biome FROM world_paint WHERE sx BETWEEN ? AND ? AND sy BETWEEN ? AND ?"
);
const upsertPaintStmt = db.prepare(`
  INSERT INTO world_paint (sx, sy, biome) VALUES (@sx, @sy, @biome)
  ON CONFLICT(sx, sy) DO UPDATE SET biome = @biome
`);
const deletePaintStmt = db.prepare("DELETE FROM world_paint WHERE sx = ? AND sy = ?");
const deleteScreenStmt = db.prepare("DELETE FROM screens WHERE sx = ? AND sy = ?");

export function getPaint(sx: number, sy: number): BiomeId | undefined {
  const row = getPaintStmt.get(sx, sy) as { biome: BiomeId } | undefined;
  return row?.biome;
}

export function getPaintRange(minX: number, maxX: number, minY: number, maxY: number): Map<string, BiomeId> {
  const rows = getPaintRangeStmt.all(minX, maxX, minY, maxY) as Array<{ sx: number; sy: number; biome: BiomeId }>;
  const map = new Map<string, BiomeId>();
  for (const r of rows) map.set(`${r.sx},${r.sy}`, r.biome);
  return map;
}

export function listPaint(): Array<{ sx: number; sy: number; biome: BiomeId }> {
  return db.prepare("SELECT sx, sy, biome FROM world_paint").all() as Array<{
    sx: number;
    sy: number;
    biome: BiomeId;
  }>;
}

// Pintado en lote (spraybrush): una sola transacción para no bloquear el event
// loop con N escrituras síncronas sueltas, igual que nos pasaría con el autosave
// si guardásemos jugador a jugador en vez de en bloque.
export function paintCells(cells: Array<{ sx: number; sy: number }>, biome: BiomeId): void {
  db.exec("BEGIN");
  try {
    for (const c of cells) upsertPaintStmt.run({ sx: c.sx, sy: c.sy, biome });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function unpaintCells(cells: Array<{ sx: number; sy: number }>): void {
  db.exec("BEGIN");
  try {
    for (const c of cells) deletePaintStmt.run(c.sx, c.sy);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const getPlayerStmt = db.prepare("SELECT * FROM players WHERE username = ?");
const upsertPlayerStmt = db.prepare(`
  INSERT INTO players (username, sx, sy, x, y, hp, max_hp, level, xp, facing, inventory)
  VALUES (@username, @sx, @sy, @x, @y, @hp, @maxHp, @level, @xp, @facing, @inventory)
  ON CONFLICT(username) DO UPDATE SET
    sx=@sx, sy=@sy, x=@x, y=@y, hp=@hp, max_hp=@maxHp, level=@level, xp=@xp, facing=@facing, inventory=@inventory
`);
const deletePlayerStmt = db.prepare("DELETE FROM players WHERE username = ?");

export function getPlayer(username: string): PlayerPrivateState | undefined {
  const row = getPlayerStmt.get(username) as
    | {
        username: string;
        sx: number;
        sy: number;
        x: number;
        y: number;
        hp: number;
        max_hp: number;
        level: number;
        xp: number;
        facing: string;
        inventory: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    username: row.username,
    sx: row.sx,
    sy: row.sy,
    x: row.x,
    y: row.y,
    hp: row.hp,
    maxHp: row.max_hp,
    level: row.level,
    xp: row.xp,
    facing: row.facing as Direction,
    inventory: JSON.parse(row.inventory),
  };
}

export function savePlayer(state: PlayerPrivateState): void {
  upsertPlayerStmt.run({
    username: state.username,
    sx: state.sx,
    sy: state.sy,
    x: state.x,
    y: state.y,
    hp: state.hp,
    maxHp: state.maxHp,
    level: state.level,
    xp: state.xp,
    facing: state.facing,
    inventory: JSON.stringify(state.inventory),
  });
}

export function deletePlayer(username: string): void {
  deletePlayerStmt.run(username);
}
