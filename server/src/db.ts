import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenData, PlayerPrivateState, Direction, BiomeId, TreeDef } from "@roi/shared";

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
    placed_trees TEXT NOT NULL DEFAULT '[]',
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

  -- Ajustes globales del juego editables desde el backoffice (p.ej. la niebla de
  -- visión): clave/valor genérico para no tener que migrar el esquema cada vez
  -- que se añade un ajuste nuevo.
  CREATE TABLE IF NOT EXISTS world_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Árboles generados proceduralmente desde /admin/trees. Guarda solo los
  -- parámetros (ver TreeDef en shared): la forma se recalcula a partir de ellos
  -- tanto en la vista previa del backoffice como donde se acabe dibujando en el
  -- mundo, así que no hay imágenes que versionar aquí.
  CREATE TABLE IF NOT EXISTS tree_defs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    height REAL NOT NULL,
    trunk_width REAL NOT NULL,
    branch_count INTEGER NOT NULL,
    leaf_count INTEGER NOT NULL,
    leaf_shape TEXT NOT NULL DEFAULT 'oval',
    canopy_shape TEXT NOT NULL DEFAULT 'round',
    branch_start_height REAL NOT NULL DEFAULT 0.55,
    tile_span INTEGER NOT NULL DEFAULT 1,
    count_per_tile INTEGER NOT NULL DEFAULT 1,
    instance_offsets TEXT NOT NULL DEFAULT '[]',
    allowed_biomes TEXT NOT NULL DEFAULT '[]',
    lean REAL NOT NULL DEFAULT 0,
    branch_flexibility REAL NOT NULL DEFAULT 0.7,
    leaf_color_sun TEXT NOT NULL,
    leaf_color_shade TEXT NOT NULL,
    trunk_color TEXT NOT NULL,
    wind_sway REAL NOT NULL,
    trunk_twist REAL NOT NULL DEFAULT 0.2,
    branch_twist REAL NOT NULL DEFAULT 0.35,
    canopy_width REAL NOT NULL DEFAULT 0.5,
    seed INTEGER NOT NULL
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
ensureColumn("screens", "placed_trees", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("tree_defs", "trunk_twist", "REAL NOT NULL DEFAULT 0.2");
ensureColumn("tree_defs", "branch_twist", "REAL NOT NULL DEFAULT 0.35");
ensureColumn("tree_defs", "canopy_width", "REAL NOT NULL DEFAULT 0.5");
ensureColumn("tree_defs", "leaf_shape", "TEXT NOT NULL DEFAULT 'oval'");
ensureColumn("tree_defs", "canopy_shape", "TEXT NOT NULL DEFAULT 'round'");
ensureColumn("tree_defs", "branch_start_height", "REAL NOT NULL DEFAULT 0.55");
ensureColumn("tree_defs", "tile_span", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("tree_defs", "count_per_tile", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("tree_defs", "instance_offsets", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("tree_defs", "allowed_biomes", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("tree_defs", "lean", "REAL NOT NULL DEFAULT 0");
ensureColumn("tree_defs", "branch_flexibility", "REAL NOT NULL DEFAULT 0.7");

const getScreenStmt = db.prepare("SELECT * FROM screens WHERE sx = ? AND sy = ?");
const insertScreenStmt = db.prepare(`
  INSERT OR REPLACE INTO screens (sx, sy, tiles, monsters, items, placed_trees, exotic_tier, biome, biome_source, biome_blend, code)
  VALUES (@sx, @sy, @tiles, @monsters, @items, @placedTrees, @exoticTier, @biome, @biomeSource, @biomeBlend, @code)
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
        placed_trees: string;
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
    placedTrees: JSON.parse(row.placed_trees || "[]"),
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
    placedTrees: JSON.stringify(screen.placedTrees),
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

// ---- Ajustes globales (world_settings) ----

const getSettingStmt = db.prepare("SELECT value FROM world_settings WHERE key = ?");
const upsertSettingStmt = db.prepare(`
  INSERT INTO world_settings (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = @value
`);

export function getSetting(key: string): string | undefined {
  const row = getSettingStmt.get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  upsertSettingStmt.run({ key, value });
}

// ---- Árboles generados (tree_defs) ----

const listTreeDefsStmt = db.prepare("SELECT * FROM tree_defs ORDER BY name");
const getTreeDefStmt = db.prepare("SELECT * FROM tree_defs WHERE id = ?");
const upsertTreeDefStmt = db.prepare(`
  INSERT INTO tree_defs (
    id, name, height, trunk_width, branch_count, leaf_count, leaf_shape, canopy_shape, branch_start_height,
    tile_span, count_per_tile, instance_offsets, lean, branch_flexibility, allowed_biomes,
    leaf_color_sun, leaf_color_shade, trunk_color, wind_sway, trunk_twist, branch_twist, canopy_width, seed
  )
  VALUES (
    @id, @name, @height, @trunkWidth, @branchCount, @leafCount, @leafShape, @canopyShape, @branchStartHeight,
    @tileSpan, @countPerTile, @instanceOffsets, @lean, @branchFlexibility, @allowedBiomes,
    @leafColorSun, @leafColorShade, @trunkColor, @windSway, @trunkTwist, @branchTwist, @canopyWidth, @seed
  )
  ON CONFLICT(id) DO UPDATE SET
    name=@name, height=@height, trunk_width=@trunkWidth, branch_count=@branchCount, leaf_count=@leafCount, leaf_shape=@leafShape,
    canopy_shape=@canopyShape, branch_start_height=@branchStartHeight,
    tile_span=@tileSpan, count_per_tile=@countPerTile, instance_offsets=@instanceOffsets, lean=@lean, branch_flexibility=@branchFlexibility,
    allowed_biomes=@allowedBiomes,
    leaf_color_sun=@leafColorSun, leaf_color_shade=@leafColorShade, trunk_color=@trunkColor, wind_sway=@windSway,
    trunk_twist=@trunkTwist, branch_twist=@branchTwist, canopy_width=@canopyWidth, seed=@seed
`);
const deleteTreeDefStmt = db.prepare("DELETE FROM tree_defs WHERE id = ?");

interface TreeDefRow {
  id: string;
  name: string;
  height: number;
  trunk_width: number;
  branch_count: number;
  leaf_count: number;
  leaf_shape: TreeDef["leafShape"];
  canopy_shape: TreeDef["canopyShape"];
  branch_start_height: number;
  tile_span: TreeDef["tileSpan"];
  count_per_tile: number;
  instance_offsets: string;
  lean: number;
  branch_flexibility: number;
  allowed_biomes: string;
  leaf_color_sun: string;
  leaf_color_shade: string;
  trunk_color: string;
  wind_sway: number;
  trunk_twist: number;
  branch_twist: number;
  canopy_width: number;
  seed: number;
}

function rowToTreeDef(row: TreeDefRow): TreeDef {
  return {
    id: row.id,
    name: row.name,
    height: row.height,
    trunkWidth: row.trunk_width,
    branchCount: row.branch_count,
    leafCount: row.leaf_count,
    leafShape: row.leaf_shape,
    canopyShape: row.canopy_shape,
    branchStartHeight: row.branch_start_height,
    tileSpan: row.tile_span,
    countPerTile: row.count_per_tile,
    instanceOffsets: JSON.parse(row.instance_offsets || "[]"),
    lean: row.lean,
    branchFlexibility: row.branch_flexibility,
    allowedBiomes: JSON.parse(row.allowed_biomes || "[]"),
    leafColorSun: row.leaf_color_sun,
    leafColorShade: row.leaf_color_shade,
    trunkColor: row.trunk_color,
    windSway: row.wind_sway,
    trunkTwist: row.trunk_twist,
    branchTwist: row.branch_twist,
    canopyWidth: row.canopy_width,
    seed: row.seed,
  };
}

export function listTreeDefs(): TreeDef[] {
  return (listTreeDefsStmt.all() as unknown as TreeDefRow[]).map(rowToTreeDef);
}

// Árboles que se pueden plantar en un bioma dado: los que tienen ese bioma
// marcado, o los que no tienen ninguno marcado (sirven para cualquiera).
export function listTreeDefsForBiome(biome: BiomeId): TreeDef[] {
  return listTreeDefs().filter((d) => d.allowedBiomes.length === 0 || d.allowedBiomes.includes(biome));
}

export function getTreeDef(id: string): TreeDef | undefined {
  const row = getTreeDefStmt.get(id) as unknown as TreeDefRow | undefined;
  return row ? rowToTreeDef(row) : undefined;
}

export function saveTreeDef(def: TreeDef): void {
  upsertTreeDefStmt.run({
    id: def.id,
    name: def.name,
    height: def.height,
    trunkWidth: def.trunkWidth,
    branchCount: def.branchCount,
    leafCount: def.leafCount,
    leafShape: def.leafShape,
    canopyShape: def.canopyShape,
    branchStartHeight: def.branchStartHeight,
    tileSpan: def.tileSpan,
    countPerTile: def.countPerTile,
    instanceOffsets: JSON.stringify(def.instanceOffsets),
    lean: def.lean,
    branchFlexibility: def.branchFlexibility,
    allowedBiomes: JSON.stringify(def.allowedBiomes),
    leafColorSun: def.leafColorSun,
    leafColorShade: def.leafColorShade,
    trunkColor: def.trunkColor,
    windSway: def.windSway,
    trunkTwist: def.trunkTwist,
    branchTwist: def.branchTwist,
    canopyWidth: def.canopyWidth,
    seed: def.seed,
  });
}

export function deleteTreeDef(id: string): boolean {
  return deleteTreeDefStmt.run(id).changes > 0;
}
