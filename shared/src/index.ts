// Dimensiones de una pantalla: rejilla plana en proporción 16:9, la cámara isométrica
// es solo una transformación de render, no cambia la forma lógica del mundo.
export const SCREEN_WIDTH = 16;
export const SCREEN_HEIGHT = 9;
export const TILE_SIZE = 32; // px lógicos, la proyección isométrica se calcula a partir de esto en el cliente

// Tamaño actual del mundo (nº de estancias por lado). Es un límite provisional
// pensado para crecer más adelante hacia un mundo persistente mucho mayor, no un
// tope definitivo — por eso vive aquí como una única constante fácil de subir.
export const WORLD_SIZE = 400;
export const WORLD_MIN = -Math.floor(WORLD_SIZE / 2);
export const WORLD_MAX = Math.ceil(WORLD_SIZE / 2) - 1;

export type Direction = "N" | "S" | "E" | "W";

export const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

// Movimiento continuo (no por casillas): el servidor simula a este tick fijo.
export const TICK_MS = 50;
export const PLAYER_SPEED = 4.2; // tiles/segundo
export const ATTACK_RANGE = 0.9; // tiles
export const PICKUP_RANGE = 0.75; // tiles

export interface InputState {
  N: boolean;
  S: boolean;
  E: boolean;
  W: boolean;
}

export enum TileType {
  Grass = 0,
  Path = 1,
  Water = 2,
  Tree = 3,
  Rock = 4,
  Building = 5,
  Fence = 6,
  Cactus = 7,
}

// Cómo se coloca un tile proceduralmente sobre la hierba base al generar una pantalla:
// - "base": el propio suelo (hierba/camino), no se coloca, ya está ahí por defecto.
// - "scatter": disperso por celda suelta, compitiendo por "weight" contra los demás.
// - "blob": una o dos manchas orgánicas (charcos/lagos), con "chance" de aparecer.
// - "rare": como mucho una unidad por pantalla, con "chance" de aparecer.
// - "segment": un tramo corto en línea, con "chance" de aparecer.
export type TilePlacement = "base" | "scatter" | "blob" | "rare" | "segment";

export interface TileDef {
  blocking: boolean;
  placement: TilePlacement;
  weight?: number; // "scatter": probabilidad base por celda (0..1)
  cluster?: number; // "scatter": cuánto sube la probabilidad en celdas vecinas al colocarse (agrupa en manchas, p.ej. colinas/bosques)
  chance?: number; // "blob"/"rare"/"segment": probabilidad de aparecer en la pantalla
  exoticBonus?: number; // XP extra de descubrimiento si el tile aparece en la pantalla
}

// Todo el mapeado es exterior. Añadir un tile nuevo al mundo es solo darlo de alta
// aquí: la generación procedural y el bloqueo de movimiento salen de esta tabla.
export const TILE_DEFS: Record<TileType, TileDef> = {
  [TileType.Grass]: { blocking: false, placement: "base" },
  [TileType.Path]: { blocking: false, placement: "base" },
  [TileType.Water]: { blocking: true, placement: "blob", chance: 0.5, exoticBonus: 5 },
  [TileType.Tree]: { blocking: true, placement: "scatter", weight: 0.05, cluster: 0.15 },
  [TileType.Rock]: { blocking: true, placement: "scatter", weight: 0.03, cluster: 0.2 },
  [TileType.Building]: { blocking: true, placement: "rare", chance: 0.12, exoticBonus: 15 },
  [TileType.Fence]: { blocking: true, placement: "segment", chance: 0.3, exoticBonus: 3 },
  [TileType.Cactus]: { blocking: true, placement: "scatter", weight: 0.025, cluster: 0.05 },
};

export const BLOCKING_TILES = new Set<TileType>(
  Object.entries(TILE_DEFS)
    .filter(([, def]) => def.blocking)
    .map(([key]) => Number(key) as TileType)
);

export type ExoticTier = "common" | "uncommon" | "rare" | "epic";

export interface ScreenCoord {
  sx: number;
  sy: number;
}

export function screenKey(c: ScreenCoord): string {
  return `${c.sx},${c.sy}`;
}

// ---- Biomas ----
// Cada bioma vive en un espacio de 2 ejes (temperatura, artificialidad) en vez de
// una tabla de distancias por pareja: así añadir un bioma nuevo es dar de alta un
// punto más, no O(n^2) relaciones que mantener a mano. La distancia entre dos
// biomas en ese espacio decide cuántas estancias mínimas de transición hacen
// falta para pasar de uno a otro sin salto brusco (ver minTransitionScreens).
export type BiomeId = "classic" | "grimdark" | "badlands" | "cyberpunk" | "ega" | "cga" | "sea";

export interface BiomeDef {
  id: BiomeId;
  label: string;
  temp: number; // -1 frío .. +1 cálido
  tech: number; // -1 natural .. +1 artificial/tecnológico
  blocking?: boolean; // p.ej. mar: la estancia es mayoritariamente intransitable
  debugColor: string; // solo para el mapa admin, no es arte de juego
}

export const BIOME_CATALOG: Record<BiomeId, BiomeDef> = {
  classic: { id: "classic", label: "Clásico", temp: 0, tech: -0.2, debugColor: "#4caf6d" },
  grimdark: { id: "grimdark", label: "Grimdark", temp: -0.1, tech: -0.1, debugColor: "#4a3f4f" },
  badlands: { id: "badlands", label: "Badlands", temp: 0.8, tech: -0.1, debugColor: "#b8894a" },
  cyberpunk: { id: "cyberpunk", label: "Cyberpunk", temp: 0, tech: 1, debugColor: "#c026d3" },
  ega: { id: "ega", label: "EGA", temp: -0.3, tech: 0.6, debugColor: "#5555ff" },
  cga: { id: "cga", label: "CGA", temp: -0.2, tech: 0.55, debugColor: "#55ffff" },
  sea: { id: "sea", label: "Mar", temp: 0, tech: -0.2, blocking: true, debugColor: "#1f5fa8" },
};

export const BIOME_IDS = Object.keys(BIOME_CATALOG) as BiomeId[];

export function biomeDistance(a: BiomeId, b: BiomeId): number {
  if (a === b) return 0;
  const da = BIOME_CATALOG[a];
  const db = BIOME_CATALOG[b];
  return Math.hypot(da.temp - db.temp, da.tech - db.tech);
}

// Cuántas estancias mínimas de transición hacen falta entre dos biomas: biomas
// cercanos en el espacio (temp, tech) se resuelven en 1-2 estancias; biomas muy
// distintos (p.ej. cyberpunk junto a badlands) exigen un pasillo más largo.
const TRANSITION_SCALE = 4;
export function minTransitionScreens(a: BiomeId, b: BiomeId): number {
  if (a === b) return 0;
  return Math.max(1, Math.round(biomeDistance(a, b) * TRANSITION_SCALE));
}

// De dónde viene el bioma resuelto para una estancia: "paint" = decretado por el
// super admin (autoritativo, obliga transición en su borde); "procedural" = solo
// cálculo natural (el motor puede decidir no forzar transición).
export type BiomeSource = "paint" | "procedural";

export interface ResolvedBiome {
  biome: BiomeId;
  source: BiomeSource;
}

// Mezcla en una estancia de transición: bioma dominante (screen.biome) + de dónde
// viene, más el bioma vecino hacia el que se está mezclando y en qué proporción.
// factor = 0 -> puro dominante, factor = 1 -> puro "from" (solo llega a 1 justo en
// el borde con el bioma vecino). El cliente usa el mismo factor tanto para mezclar
// tiles como para la intensidad del efecto gráfico del bioma vecino.
export interface BiomeBlend {
  from: BiomeId;
  factor: number;
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
  biome: BiomeId;
  biomeSource: BiomeSource;
  biomeBlend: BiomeBlend | null;
  code: string; // huella alfanumérica del contenido de la estancia (tiles + elementos)
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
  | { type: "input"; dirs: InputState }
  | { type: "attack" }
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
