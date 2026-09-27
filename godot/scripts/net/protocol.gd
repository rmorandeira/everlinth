# GENERADO por tools/godot/gen-protocol.mjs a partir de shared/src/index.ts.
# No editar a mano: cambia shared y vuelve a generar.
class_name Protocol

const ASSET_CATEGORIES = ["edificio", "rascacielos", "casa", "pieza de edificio", "mobiliario", "farola", "semáforo", "vegetación", "vehículo", "decoración", "terreno", "personaje", "otro"]
const ATTACK_RANGE = 1.8
const BIOME_CATALOG = {"classic": {"id": "classic", "label": "Clásico", "temp": 0, "tech": -0.2, "debugColor": "#4caf6d"}, "grimdark": {"id": "grimdark", "label": "Grimdark", "temp": -0.1, "tech": -0.1, "debugColor": "#4a3f4f"}, "badlands": {"id": "badlands", "label": "Badlands", "temp": 0.8, "tech": -0.1, "debugColor": "#b8894a"}, "cyberpunk": {"id": "cyberpunk", "label": "Cyberpunk", "temp": 0, "tech": 1, "debugColor": "#c026d3"}, "ega": {"id": "ega", "label": "EGA", "temp": -0.3, "tech": 0.6, "debugColor": "#5555ff"}, "cga": {"id": "cga", "label": "CGA", "temp": -0.2, "tech": 0.55, "debugColor": "#55ffff"}, "city": {"id": "city", "label": "Ciudad", "temp": 0.15, "tech": 0.8, "debugColor": "#8a8f98"}, "sea": {"id": "sea", "label": "Mar", "temp": 0, "tech": -0.2, "blocking": true, "debugColor": "#1f5fa8"}}
const BIOME_IDS = ["classic", "grimdark", "badlands", "cyberpunk", "ega", "cga", "city", "sea"]
const BLOCKING_TILES = [2, 3, 4, 5, 6, 7]
const CANOPY_SHAPES = ["round", "triangular", "wide"]
const CITY_ROAD_HALF = [1.6, 2.4, 3.4]
const CITY_SIDEWALK_W = 1.5
const DEFAULT_TEXTURE_PARAMS = {"texture": null, "mapping": "uv", "repeatX": 1, "repeatY": 1, "offsetX": 0, "offsetY": 0, "rotation": 0, "tile": 3}
const DEFAULT_TREE_DEF = {"height": 90, "trunkWidth": 10, "branchCount": 4, "leafCount": 24, "leafShape": "oval", "canopyShape": "round", "branchStartHeight": 0.55, "tileSpan": 1, "countPerTile": 1, "instanceOffsets": [], "lean": 0, "branchFlexibility": 0.7, "allowedBiomes": [], "leafColorSun": "#7bc95e", "leafColorShade": "#2f6b34", "trunkColor": "#6b4a2f", "windSway": 0.4, "trunkTwist": 0.2, "branchTwist": 0.35, "canopyWidth": 0.5, "seed": 1}
const DEFAULT_VISION_SETTINGS = {"ellipseScale": 1, "sharpFraction": 0.72, "blurStrength": 1, "vibration": 1, "chromaticAberration": 0}
const DIRECTION_DELTA = {"N": {"dx": 0, "dy": -1}, "S": {"dx": 0, "dy": 1}, "E": {"dx": 1, "dy": 0}, "W": {"dx": -1, "dy": 0}}
const GIANT_HP = 40
const GIANT_SCALE = 2.4
const GUN_FIRE_MS = 45
const GUN_RANGE = 36
const LEAF_SHAPES = ["round", "oval", "pointed", "needle"]
const LOCATIONS = [{"id": "coruna", "name": "A Coruña", "sx": 0, "sy": 0}, {"id": "generada", "name": "Ciudad generada", "sx": 120, "sy": 0}, {"id": "nueva", "name": "Otra ciudad generada (aleatoria)", "sx": 0, "sy": 0}]
const OSM_REGION = [-70, -50, 40, 135]
const PICKUP_RANGE = 1.5
const PLAYER_SPEED = 10.2
const RANDOM_CITY_REGION = [60, -190, 190, 190]
const SCREEN_HEIGHT = 27
const SCREEN_WIDTH = 48
const SOCKET_TYPES = ["tejado", "fachada", "puerta", "esquina", "suelo", "poste", "anclaje"]
const TICK_MS = 50
const TILE_DEFS = {"0": {"blocking": false, "placement": "base"}, "1": {"blocking": false, "placement": "base"}, "2": {"blocking": true, "placement": "blob", "chance": 0.5, "exoticBonus": 5}, "3": {"blocking": true, "placement": "scatter", "weight": 0.05, "cluster": 0.15}, "4": {"blocking": true, "placement": "scatter", "weight": 0.03, "cluster": 0.2}, "5": {"blocking": true, "placement": "rare", "chance": 0.12, "exoticBonus": 15}, "6": {"blocking": true, "placement": "segment", "chance": 0.3, "exoticBonus": 3}, "7": {"blocking": true, "placement": "scatter", "weight": 0.025, "cluster": 0.05}, "8": {"blocking": false, "placement": "base"}, "9": {"blocking": false, "placement": "base"}}
const TILE_SIZE = 0.5
enum TileType { Grass = 0, Path = 1, Water = 2, Tree = 3, Rock = 4, Building = 5, Fence = 6, Cactus = 7, Road = 8, Sidewalk = 9 }
const WORLD_MAX = 199
const WORLD_MIN = -200
const WORLD_SIZE = 400
const ZOMBIE_MAX_HP = 3
const ZOMBIE_VIEW_RANGE = 60
