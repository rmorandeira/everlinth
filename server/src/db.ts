import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScreenData, PlayerPrivateState, Direction } from "@roi/shared";

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
    biome TEXT NOT NULL DEFAULT 'Badlands',
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
`);

// Migra bases de datos ya existentes (p.ej. en el volumen de producción) que se
// crearon antes de añadir estas columnas.
function ensureColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn("screens", "biome", "TEXT NOT NULL DEFAULT 'Badlands'");
ensureColumn("screens", "code", "TEXT NOT NULL DEFAULT ''");

const getScreenStmt = db.prepare("SELECT * FROM screens WHERE sx = ? AND sy = ?");
const insertScreenStmt = db.prepare(`
  INSERT OR REPLACE INTO screens (sx, sy, tiles, monsters, items, exotic_tier, biome, code)
  VALUES (@sx, @sy, @tiles, @monsters, @items, @exoticTier, @biome, @code)
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
        biome: string;
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
    code: screen.code,
  });
}

export function listScreenCoords(): Array<{ sx: number; sy: number; biome: string; code: string }> {
  return listScreenCoordsStmt.all() as Array<{ sx: number; sy: number; biome: string; code: string }>;
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
