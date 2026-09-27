// Dimensiones de una pantalla: rejilla plana en proporción 16:9, la cámara isométrica
// es solo una transformación de render, no cambia la forma lógica del mundo.
// 1 tile ≈ 1,5 m. Una sala son 48×27 tiles (72×40 m). TILE_SIZE = unidades de
// render (1 unidad = 3 m) que mide un tile: solo lo usa el cliente para pintar.
export const SCREEN_WIDTH = 48;
export const SCREEN_HEIGHT = 27;
export const TILE_SIZE = 0.5;

// Tamaño actual del mundo (nº de estancias por lado). Es un límite provisional
// pensado para crecer más adelante hacia un mundo persistente mucho mayor, no un
// tope definitivo — por eso vive aquí como una única constante fácil de subir.
export const WORLD_SIZE = 400;
export const WORLD_MIN = -Math.floor(WORLD_SIZE / 2);
export const WORLD_MAX = Math.ceil(WORLD_SIZE / 2) - 1;

// Ajustes visuales globales editables desde el backoffice (afectan a todos los
// jugadores, solo a la escena del juego, nunca al HUD). El cliente los pide una
// vez al arrancar; si el servidor no responde o no hay nada guardado aún, usa
// DEFAULT_VISION_SETTINGS.
export interface VisionFogSettings {
  ellipseScale: number; // tamaño de la propia elipse de niebla, relativo a la pantalla (1 = inscrita justo en el borde)
  sharpFraction: number; // 0..1: fracción del radio elíptico (ya escalado por ellipseScale) que queda nítida
  blurStrength: number; // 0..2: intensidad (radio en px) del desenfoque fuera de la zona nítida; 0 = casi sin difuminar, 1 = normal
  vibration: number; // 0..1: cuánto varía el difuminado (0 = estático, un valor de niebla fijo; más alto = más "respira"/tiembla)
  chromaticAberration: number; // 0..1: separación de canales de color en los bordes de la escena (0 = desactivada)
}

export const DEFAULT_VISION_SETTINGS: VisionFogSettings = {
  ellipseScale: 1,
  sharpFraction: 0.72,
  blurStrength: 1,
  vibration: 1,
  chromaticAberration: 0,
};

export type Direction = "N" | "S" | "E" | "W";

export const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

// Movimiento continuo (no por casillas): el servidor simula a este tick fijo.
export const TICK_MS = 50;
export const PLAYER_SPEED = 10.2; // tiles/segundo
export const ATTACK_RANGE = 1.8; // tiles
export const PICKUP_RANGE = 1.5; // tiles

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
  Road = 8,
  Sidewalk = 9,
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
  // Solo los coloca el bioma "city" (ver cityCell), nunca el reparto aleatorio.
  [TileType.Road]: { blocking: false, placement: "base" },
  [TileType.Sidewalk]: { blocking: false, placement: "base" },
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
export type BiomeId = "classic" | "grimdark" | "badlands" | "cyberpunk" | "ega" | "cga" | "sea" | "city";

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
  city: { id: "city", label: "Ciudad", temp: 0.15, tech: 0.8, debugColor: "#8a8f98" },
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

// Un árbol generado (ver TreeDef) plantado en el mundo: solo guarda QUÉ árbol y
// DÓNDE, igual que un TreeDef en el backoffice — la forma real (con sus
// countPerTile copias e instanceOffsets) se recalcula al dibujar, tanto en el
// cliente del juego como en la vista previa del backoffice, a partir del mismo
// TreeDef. Puramente decorativo por ahora: no bloquea movimiento.
export interface PlacedTree {
  treeDefId: string;
  x: number;
  y: number;
}

export interface ScreenData {
  sx: number;
  sy: number;
  tiles: TileType[][]; // [y][x]
  monsters: MonsterState[];
  items: ItemState[];
  placedTrees: PlacedTree[];
  exoticTier: ExoticTier;
  biome: BiomeId;
  biomeSource: BiomeSource;
  biomeBlend: BiomeBlend | null;
  code: string; // huella alfanumérica del contenido de la estancia (tiles + elementos)
  /** Solo bioma city: geometría vectorial de calles y edificios (no se guarda, se regenera). */
  city?: CityData;
}

// Terreno (solo tiles, sin monstruos/objetos/entidades) de una estancia vecina a
// la actual: se manda junto al "screen" para que el cliente pueda dibujar terreno
// REAL, generado y persistido igual que la sala activa, en vez de relleno falso,
// en el margen que hace falta para cubrir toda la pantalla en la vista isométrica.
export interface NeighborTiles {
  sx: number;
  sy: number;
  tiles: TileType[][];
  placedTrees: PlacedTree[];
  city?: CityData;
}

// Geometría vectorial de la ciudad (coordenadas GLOBALES de tile): el servidor la
// genera con MapGenerator (server/src/citygen) y el cliente dibuja las calles como
// cintas y los edificios como polígonos extruidos, así las diagonales salen limpias
// (los tiles solo sirven para colisión). kind: 0 calle menor, 1 mayor, 2 avenida.
export interface CityRoad {
  id: string;
  kind: 0 | 1 | 2;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Distancia a lo largo de su calle (tiles) en (x0, y0): los discontinuos casan entre segmentos. */
  s0: number;
  /** Sentido único real (OSM): 1 en el sentido x0→x1, -1 al revés. */
  ow?: 1 | -1;
}
export interface CityBuilding {
  id: string;
  floors: number;
  pts: Array<[number, number]>;
  /** Tipo de edificio de OSM (apartments, church…) y nombre, si lo tiene. */
  t?: string;
  name?: string;
  /** Daño (solo si ha recibido alguno): vida actual y máxima; 0 = derrumbado. */
  hp?: number;
  maxHp?: number;
}
/** Tramo de autovía elevada o de rampa (tiles globales; z en unidades de render). */
export interface CityHighway {
  id: string;
  /** 0 autovía, 1 rampa / ramal de enlace */
  kind: 0 | 1;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  half: number;
  s0: number;
}
export interface CityData {
  roads: CityRoad[];
  buildings: CityBuilding[];
  /** Autovías elevadas y rampas que pasan por la sala. */
  highways?: CityHighway[];
  /** Pilares: [x, y, altura bajo el tablero, anchura del cabezal, ángulo]. */
  pillars?: Array<[number, number, number, number, number]>;
  /** Césped (círculos [x, y, radio]) en el interior de los enlaces. */
  greens?: Array<[number, number, number]>;
  /** Ciudad real (OpenStreetMap): edificios con su planta, costa, playas, hitos. */
  osm?: boolean;
  /** Tramos de costa [x0, y0, x1, y1] (el mar queda a su derecha, con la y hacia el sur). */
  coast?: Array<[number, number, number, number]>;
  /** Playas (polígonos de arena). */
  sand?: Array<Array<[number, number]>>;
  /** Muelles y diques [x0, y0, x1, y1] (tierra transitable de ~2 tiles de semiancho sobre el mar). */
  piers?: Array<[number, number, number, number]>;
  /** Relieve de la sala: alturas (unidades de render, 1 = 3 m) en una rejilla de w × h
   * puntos cada `step` tiles desde la esquina de la sala (esquinas incluidas). */
  elev?: { step: number; w: number; h: number; z: number[] };
  /** Hitos modelados (estadio…): centro, largo y ancho (tiles), ángulo del eje largo. */
  landmarks?: Array<{ kind: string; name: string; x: number; y: number; len: number; wid: number; ang: number }>;
  /** Cruces de calles (para pasos de cebra y cortar las marcas). */
  nodes: Array<[number, number]>;
}
export const CITY_ROAD_HALF = [1.6, 2.4, 3.4];
export const CITY_SIDEWALK_W = 1.5;

// Definición de un "árbol" generado proceduralmente desde el backoffice (ver
// /admin/trees): un tronco con varias ramas principales terminadas en racimos
// de hojas. El mismo objeto se usa para generar la vista previa en el backoffice
// y, más adelante, para dibujar el árbol en el juego — por eso vive en shared.
// Silueta plana de la hoja individual (no un punto redondo): cada instancia se
// dibuja con su propio ángulo aleatorio, para que no queden todas "de cara" al
// espectador como una calcomanía repetida.
export type LeafShape = "round" | "oval" | "pointed" | "needle";
export const LEAF_SHAPES: LeafShape[] = ["round", "oval", "pointed", "needle"];

// Silueta general que forman las ramas principales: cónica (conífera), redonda
// (la más "genérica"), o ancha/extendida (copa abierta, poco alta).
export type CanopyShape = "round" | "triangular" | "wide";
export const CANOPY_SHAPES: CanopyShape[] = ["round", "triangular", "wide"];

export interface TreeDef {
  id: string;
  name: string;
  height: number; // alto total, px lógicos
  trunkWidth: number; // ancho del tronco en la base, px lógicos
  branchCount: number; // nº de ramas principales que salen del tronco
  leafCount: number; // nº total de racimos de hoja, repartidos entre ramas
  leafShape: LeafShape;
  canopyShape: CanopyShape;
  branchStartHeight: number; // 0..1: a qué altura del tronco arranca la primera rama (1 = todas nacen de la copa, como antes)
  tileSpan: 1 | 2 | 4; // cuántos tiles de lado ocupa (1x1, 2x2 o 4x4) — para árboles grandes que no caben en un solo tile
  countPerTile: number; // cuántas copias de este árbol se colocan en una misma estancia al plantarlo (1 = una sola)
  // Posición de cada copia dentro del área tileSpan×tileSpan, relativa al centro
  // (arrastrable una a una en el backoffice). Si hay menos entradas que
  // countPerTile, las que faltan se reparten solas de forma determinista.
  instanceOffsets: Array<{ x: number; y: number }>;
  lean: number; // -1..1: inclinación fija de todo el árbol hacia un lado (forma, no viento) — negativo = izquierda
  branchFlexibility: number; // 0..1: cuánto responden las ramas al viento, independiente de windSway
  allowedBiomes: BiomeId[]; // en qué biomas puede plantarse este árbol al generar el mundo; [] = cualquiera
  leafColorSun: string; // hex: hojas más expuestas (más claras)
  leafColorShade: string; // hex: hojas menos expuestas (más oscuras)
  trunkColor: string; // hex
  windSway: number; // 0..1: amplitud del balanceo con el viento — sobre todo hojas, algo ramas, casi nada tronco
  trunkTwist: number; // 0..1: cuánto se curva/retuerce el tronco (forma, no animación)
  branchTwist: number; // 0..1: cuánto se curva/retuerce cada rama, independiente del tronco
  canopyWidth: number; // 0..1: abanico de las ramas principales y ángulo de sus bifurcaciones (más ancho = copa más abierta)
  seed: number; // fija la forma (ramas/hojas) para que sea reproducible
}

export const DEFAULT_TREE_DEF: Omit<TreeDef, "id" | "name"> = {
  height: 90,
  trunkWidth: 10,
  branchCount: 4,
  leafCount: 24,
  leafShape: "oval",
  canopyShape: "round",
  branchStartHeight: 0.55,
  tileSpan: 1,
  countPerTile: 1,
  instanceOffsets: [],
  lean: 0,
  branchFlexibility: 0.7,
  allowedBiomes: [],
  leafColorSun: "#7bc95e",
  leafColorShade: "#2f6b34",
  trunkColor: "#6b4a2f",
  windSway: 0.4,
  trunkTwist: 0.2,
  branchTwist: 0.35,
  canopyWidth: 0.5,
  seed: 1,
};

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

// ---- Horda de zombis ----
// Coordenadas GLOBALES del mundo (sx*SCREEN_WIDTH + x, sy*SCREEN_HEIGHT + y): los
// zombis no pertenecen a una sala, cruzan bordes con total libertad.
export interface ZombieState {
  id: number;
  gx: number;
  gy: number;
  hp: number;
  /** Zombi gigante: más grande, lento y resistente (solo aparece con hordas grandes). */
  giant?: boolean;
}
/** Paseante (población civil): deambula, huye de la horda y, si le muerden, se convierte. */
export interface CivilianState {
  id: number;
  gx: number;
  gy: number;
  /** 0 tranquilo, 1 huyendo, 2 mordido (se está convirtiendo), 3 caído, 4 ayudando a levantarse */
  s: 0 | 1 | 2 | 3 | 4;
  /** variante de ropa */
  v: number;
}
export const GIANT_SCALE = 2.4;
export const GIANT_HP = 40;
export const ZOMBIE_MAX_HP = 3;
export const ZOMBIE_VIEW_RANGE = 60;
export const GUN_RANGE = 36;
export const GUN_FIRE_MS = 45;

// ---- Mensajes cliente -> servidor ----
export type ClientMessage =
  | { type: "join"; username: string }
  | { type: "input"; dirs: InputState }
  | { type: "attack" }
  | { type: "pickup" }
  // Ametralladora: dirección de disparo en el plano del mundo (x = columna, z = fila).
  | { type: "shoot"; dx: number; dz: number }
  // Interruptor de zombis del jugador (arriba a la derecha): sin zombis, la horda le ignora.
  | { type: "setZombies"; enabled: boolean }
  // Prueba de explosiones en (gx, gy) (tiles globales); el servidor solo la acepta con DEBUG_WEAPONS=1.
  | { type: "debugExplode"; gx: number; gy: number }
  | { type: "debugTeleport"; gx: number; gy: number };

// ---- Mensajes servidor -> cliente ----
export type ServerMessage =
  | { type: "joined"; you: PlayerPrivateState }
  | { type: "screen"; screen: ScreenData; players: PlayerPublicState[]; neighbors: NeighborTiles[] }
  | { type: "playerUpdate"; player: PlayerPublicState }
  | { type: "youUpdate"; you: PlayerPrivateState }
  | { type: "playerLeft"; username: string }
  | { type: "monsterUpdate"; monster: MonsterState }
  | { type: "itemUpdate"; item: ItemState }
  | { type: "discovery"; tier: ExoticTier; xp: number }
  | { type: "died" }
  | { type: "error"; message: string }
  | { type: "visionSettings"; settings: VisionFogSettings }
  | { type: "zombies"; zombies: ZombieState[] }
  | { type: "civilians"; civilians: CivilianState[] }
  // hit: qué detuvo la bala (un zombi, un obstáculo, o nada: fin del alcance).
  | { type: "shot"; from: { gx: number; gy: number }; to: { gx: number; gy: number }; hit: "zombie" | "wall" | "none" }
  // Al tirador, cada vez que mata un zombi.
  | { type: "kill" }
  // A los jugadores cercanos: un zombi ha muerto ahí (su cadáver queda en el suelo).
  | { type: "zombieDied"; gx: number; gy: number; giant: boolean }
  // Un asset del catálogo se ha guardado o borrado desde /admin/assets: recargarlo.
  | { type: "assetsChanged"; id: string }
  // Un edificio ha cambiado de escalón de daño (cada 10 %) o se ha derrumbado (hp 0).
  | { type: "buildingDamaged"; id: string; hp: number; maxHp: number }
  // Explosión (tiles globales): destello, onda y polvo en los clientes.
  | { type: "explosion"; gx: number; gy: number; radius: number };

// ---- Catálogo de assets (herramienta /admin/assets) ----
// Un asset es cualquier cosa del juego con representación 3D: un modelo GLB (kits de
// Kenney), un generador procedural (farola, semáforo…) o una composición de
// primitivas (cajas, cilindros, tejados…) creada en la propia herramienta o por IA.
// Se le asigna categoría y biomas, se le pueden aplicar texturas (con escala,
// desplazamiento, rotación y repetición) y se le definen puntos de unión donde
// encajar otros assets.

/** Parámetros de una textura aplicada a un material o a una primitiva. */
export interface TextureParams {
  /** URL de la textura (p. ej. /textures/buildings/x.jpg) o null = material original. */
  texture: string | null;
  /** "uv": las UV del modelo; "box": proyección por caras (para fotos de fachada). */
  mapping: "uv" | "box";
  repeatX: number;
  repeatY: number;
  offsetX: number;
  offsetY: number;
  /** grados */
  rotation: number;
  /** "box": tamaño (unidades de render, 1 = 3 m) de una repetición de la textura. */
  tile: number;
}
export const DEFAULT_TEXTURE_PARAMS: TextureParams = { texture: null, mapping: "uv", repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0, rotation: 0, tile: 3 };

/** Punto de unión: donde encaja otro asset (posición/rotación locales al asset). */
export interface AssetSocket {
  id: string;
  name: string;
  type: string;
  pos: [number, number, number];
  /** grados */
  rot: [number, number, number];
}
export const SOCKET_TYPES = ["tejado", "fachada", "puerta", "esquina", "suelo", "poste", "anclaje"];

export type PrimitiveKind = "box" | "cylinder" | "cone" | "sphere" | "gable" | "pyramid";
/** Pieza de un asset de primitivas (unidades de render; rotación en grados). */
export interface PrimitivePart {
  id: string;
  kind: PrimitiveKind;
  pos: [number, number, number];
  rot: [number, number, number];
  size: [number, number, number];
  color: string;
  texture?: TextureParams;
}

export type AssetSource =
  | { type: "glb"; path: string } // p. ej. "commercial/building-a" → /models/commercial/building-a.glb
  | { type: "procedural"; generator: string }
  | { type: "primitives"; parts: PrimitivePart[] };

export interface AssetDef {
  id: string;
  name: string;
  source: AssetSource;
  category: string;
  biomes: BiomeId[];
  /** Multiplicador de escala sobre la natural del asset. */
  scale: number;
  /** Texturas por ranura de material (nombre del material del modelo). */
  textures: Record<string, TextureParams>;
  sockets: AssetSocket[];
  notes?: string;
  updatedAt?: number;
}

export const ASSET_CATEGORIES = [
  "edificio",
  "rascacielos",
  "casa",
  "pieza de edificio",
  "mobiliario",
  "farola",
  "semáforo",
  "vegetación",
  "vehículo",
  "decoración",
  "terreno",
  "personaje",
  "otro",
];
