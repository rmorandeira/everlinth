// Dimensiones de una pantalla (estilo Zelda NES): 16 columnas x 11 filas de tiles.
export const SCREEN_WIDTH = 16;
export const SCREEN_HEIGHT = 11;
export const TILE_SIZE = 32; // px lógicos, la proyección isométrica se calcula a partir de esto en el cliente

export type Direction = "N" | "S" | "E" | "W";

export const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

export enum TileType {
  Grass = 0,
  Path = 1,
  Water = 2,
  Tree = 3,
  Rock = 4,
  Building = 5,
}

// Todo el mapeado es exterior; estos tiles bloquean el movimiento.
export const BLOCKING_TILES = new Set<TileType>([
  TileType.Water,
  TileType.Tree,
  TileType.Rock,
  TileType.Building,
]);

export type ExoticTier = "common" | "uncommon" | "rare" | "epic";

export interface ScreenCoord {
  sx: number;
  sy: number;
}

export function screenKey(c: ScreenCoord): string {
  return `${c.sx},${c.sy}`;
}

export interface MonsterState {
  id: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface ItemState {
  id: string;
  kind: string;
  x: number;
  y: number;
  takenBy: string | null;
}

export interface ScreenData {
  sx: number;
  sy: number;
  tiles: TileType[][]; // [y][x]
  monsters: MonsterState[];
  items: ItemState[];
  exoticTier: ExoticTier;
}

export interface PlayerPublicState {
  username: string;
  sx: number;
  sy: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  facing: Direction;
}

export interface PlayerPrivateState extends PlayerPublicState {
  inventory: string[];
}

// ---- Mensajes cliente -> servidor ----
export type ClientMessage =
  | { type: "join"; username: string }
  | { type: "move"; dir: Direction }
  | { type: "pickup" };

// ---- Mensajes servidor -> cliente ----
export type ServerMessage =
  | { type: "joined"; you: PlayerPrivateState }
  | { type: "screen"; screen: ScreenData; players: PlayerPublicState[] }
  | { type: "playerUpdate"; player: PlayerPublicState }
  | { type: "youUpdate"; you: PlayerPrivateState }
  | { type: "playerLeft"; username: string }
  | { type: "monsterUpdate"; monster: MonsterState }
  | { type: "itemUpdate"; item: ItemState }
  | { type: "discovery"; tier: ExoticTier; xp: number }
  | { type: "died" }
  | { type: "error"; message: string };
