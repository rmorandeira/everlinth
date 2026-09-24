// Fase 1 de la migración a 3D (ver plan): el suelo pasa de una malla por tile
// a un único THREE.InstancedMesh (obligatorio por rendimiento: cientos de
// tiles visibles a la vez entre la sala activa y las vecinas), con variación
// de color por celda igual que hacía GRASS_VARIANTS/WATER_VARIANTS en el
// scene.ts 2D. Los obstáculos (Rock/Building/Fence/Cactus) son pocos por
// pantalla, así que se quedan como objetos normales (ver obstacles3d.ts).
//
// Mapeo de coordenadas: igual que el servidor las manda, sin reproyectar nada
// — columna de tile = X de mundo, fila de tile = Z de mundo, altura = Y. El
// aspecto de rombo isométrico sale solo del ángulo de la cámara (isoCamera.ts).
import * as THREE from "three";
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, type PlacedTree, type ScreenData, type NeighborTiles, type TreeDef, type VisionFogSettings } from "@roi/shared";
import { createIsoCamera, CAMERA_RIGHT, CAMERA_UP, type IsoCamera } from "./isoCamera.js";
import { buildObstacle } from "./obstacles3d.js";
import { buildTreeResources, instantiateTree, resolveTreeInstances, type TreeResources } from "./proceduralTree3d.js";
import { buildBuilding, disposeBuildings } from "./buildings3d.js";
import { createFigureManager, type FigureEntity } from "./figures3d.js";
import { createLighting3D, type FlashlightParams } from "./lighting3d.js";
import { createCameraRig, type CameraMood } from "./cameraRig.js";
import { createPostFx3D } from "./postfx3d.js";
import { buildCityProps } from "./city3d.js";

// Cuánto de más se acerca la cámara respecto al ajuste exacto de la sala —
// igual que el "overscan" de computeLayout() en el scene.ts 2D: recorta un
// pelín el margen decorativo para que nunca se vea una franja vacía, sin
// llegar a cortar la rejilla jugable.
const OVERSCAN = 1.1;

// Equivalente 3D de computeLayout() (scene.ts 2D): calcula cuánto hay que
// alejar la cámara (half-height del frustum ortográfico) para que la sala
// SCREEN_WIDTH×SCREEN_HEIGHT entera quepa en la ventana, sea cual sea su
// proporción — proyectando las 4 esquinas de la rejilla sobre los ejes
// propios de la cámara (CAMERA_RIGHT/CAMERA_UP), igual que 2D usaba toScreen()
// para las mismas 4 esquinas. Se recalcula solo cuando cambia el aspecto de
// la ventana (ver resize()), no cada frame.
const GRID_CORNERS = [
  [0, 0],
  [SCREEN_WIDTH - 1, 0],
  [0, SCREEN_HEIGHT - 1],
  [SCREEN_WIDTH - 1, SCREEN_HEIGHT - 1],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

function fitHalfHeightToGrid(aspect: number): number {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const corner of GRID_CORNERS) {
    const u = corner.dot(CAMERA_RIGHT);
    const v = corner.dot(CAMERA_UP);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const gridW = maxU - minU + 1; // +1 tile de margen total, como el TILE_W/2 a cada lado del 2D
  const gridH = maxV - minV + 1;
  return Math.max(gridH / 2, gridW / (2 * aspect)) / OVERSCAN;
}

// Ruido determinista barato por celda (mismo criterio que hash2 en scene.ts 2D):
// decide la variante de color del suelo y la rotación/variante de un obstáculo.
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function pick<T>(arr: T[], n: number): T {
  return arr[Math.floor(n * arr.length) % arr.length];
}

const GRASS_SHADES = [0x5cb85c, 0x4fa350, 0x66c266];
const WATER_SHADES = [0x2e6fc4, 0x3a7fd4];
const DIRT_COLOR = 0xb8a06a;
const ROAD_COLOR = 0x3a3d42;
const SIDEWALK_COLOR = 0xbdb8ac;
const SIDEWALK_RAISE = 0.04; // acera algo más alta que la calzada: bordillo

function groundColor(tile: TileType, n: number, out: THREE.Color): THREE.Color {
  if (tile === TileType.Water) return out.set(pick(WATER_SHADES, n));
  if (tile === TileType.Path) return out.set(DIRT_COLOR);
  if (tile === TileType.Road) return out.set(ROAD_COLOR);
  if (tile === TileType.Sidewalk) return out.set(SIDEWALK_COLOR);
  return out.set(pick(GRASS_SHADES, n)); // Grass y cualquier obstáculo (llevan grama debajo)
}

export interface Scene3D {
  renderer: THREE.WebGLRenderer;
  resize(width: number, height: number): void;
  updateGround(screen: ScreenData, neighbors: NeighborTiles[], treeDefs: Map<string, TreeDef>): void;
  updateFigures(entities: FigureEntity[], time: number): void;
  setCameraMood(mood: CameraMood, holdSeconds: number): void;
  render(playerX: number, playerZ: number, time: number, dt: number, vision: VisionFogSettings, flashlight: FlashlightParams, heat: number): void;
  dispose(): void;
}

export function createScene3D(canvas: HTMLCanvasElement): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();

  const lighting = createLighting3D(scene);

  const iso = createIsoCamera();
  const cameraRig = createCameraRig();
  const postfx = createPostFx3D(renderer);
  let aspect = 1;
  let restHalfHeight = fitHalfHeightToGrid(aspect);

  const figures = createFigureManager();
  scene.add(figures.group);

  const tileGeo = new THREE.BoxGeometry(0.98, 0.1, 0.98);
  const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  let groundMesh: THREE.InstancedMesh | null = null;
  let obstacleGroup: THREE.Group | null = null;
  let treeGroup: THREE.Group | null = null;
  let waterInstances: number[] = []; // índices dentro de groundMesh que son agua, para el brillo animado
  let treeUpdaters: Array<{ update: (time: number, def: TreeDef) => void; def: TreeDef }> = [];
  let lastKey = "";

  // Geometría por (treeDefId + índice de instancia): 100% determinista, se
  // construye una única vez y sobrevive a los cambios de pantalla — igual
  // que las variantes de obstáculos, solo se reconstruye si se pierde el def.
  const treeResourceCache = new Map<string, TreeResources>();
  function treeResourcesFor(defId: string, index: number, instanceDef: TreeDef): TreeResources {
    const key = `${defId}:${index}`;
    let r = treeResourceCache.get(key);
    if (!r) {
      r = buildTreeResources(instanceDef);
      treeResourceCache.set(key, r);
    }
    return r;
  }

  // Un edificio ocupa varias celdas Building contiguas (ver BUILDING_FOOTPRINT
  // en worldgen.ts): solo se planta la torre una vez, en la esquina superior-
  // izquierda del grupo, para no clonarla en cada una de sus celdas.
  function isBuildingAnchor(tiles: TileType[][], row: number, col: number): boolean {
    if (col > 0 && tiles[row][col - 1] === TileType.Building) return false;
    if (row > 0 && tiles[row - 1][col] === TileType.Building) return false;
    return true;
  }
  function buildingFootprint(tiles: TileType[][], row: number, col: number): number {
    let size = 0;
    while (col + size < tiles[row].length && tiles[row][col + size] === TileType.Building) size++;
    return size;
  }

  function collectGrid(
    tiles: TileType[][],
    offsetX: number,
    offsetZ: number,
    positions: Array<{ x: number; z: number; tile: TileType }>,
    obstacles: THREE.Group
  ): void {
    const cityProps = buildCityProps(tiles, offsetX, offsetZ);
    if (cityProps) obstacles.add(cityProps);
    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const tile = tiles[row][col];
        const x = col + offsetX;
        const z = row + offsetZ;
        positions.push({ x, z, tile });

        if (tile === TileType.Building) {
          if (isBuildingAnchor(tiles, row, col)) {
            const size = buildingFootprint(tiles, row, col);
            const building = buildBuilding(x, z, size);
            building.position.set(x + (size - 1) / 2, 0, z + (size - 1) / 2);
            obstacles.add(building);
          }
          continue;
        }

        const obstacle = buildObstacle(tile, hash2(x + 0.5, z + 0.5));
        if (obstacle) {
          obstacle.position.set(x, 0, z);
          obstacles.add(obstacle);
        }
      }
    }
  }

  // Árboles generados (ver TreeDef/admin/trees): puramente decorativos. Si el
  // catálogo aún no ha llegado (fetch en curso) o el id ya no existe, se
  // omiten en silencio — se resuelve solo en el siguiente cambio de pantalla.
  function collectTrees(
    placedTrees: PlacedTree[],
    offsetX: number,
    offsetZ: number,
    treeDefs: Map<string, TreeDef>,
    group: THREE.Group,
    updaters: Array<{ update: (time: number, def: TreeDef) => void; def: TreeDef }>
  ): void {
    for (const pt of placedTrees) {
      const def = treeDefs.get(pt.treeDefId);
      if (!def) continue;
      for (const inst of resolveTreeInstances(def)) {
        const resources = treeResourcesFor(def.id, inst.index, inst.instanceDef);
        const handle = instantiateTree(resources);
        handle.root.position.set(pt.x + offsetX + inst.offsetX, 0, pt.y + offsetZ + inst.offsetZ);
        group.add(handle.root);
        updaters.push({ update: handle.update, def: inst.instanceDef });
      }
    }
  }

  function updateGround(screen: ScreenData, neighbors: NeighborTiles[], treeDefs: Map<string, TreeDef>): void {
    const key = `${screen.sx},${screen.sy}`;
    if (key === lastKey) return;
    lastKey = key;

    if (groundMesh) scene.remove(groundMesh);
    if (obstacleGroup) scene.remove(obstacleGroup);
    if (treeGroup) scene.remove(treeGroup);
    disposeBuildings();

    const positions: Array<{ x: number; z: number; tile: TileType }> = [];
    const obstacles = new THREE.Group();
    const trees = new THREE.Group();
    const updaters: Array<{ update: (time: number, def: TreeDef) => void; def: TreeDef }> = [];

    collectGrid(screen.tiles, 0, 0, positions, obstacles);
    collectTrees(screen.placedTrees, 0, 0, treeDefs, trees, updaters);
    for (const n of neighbors) {
      const offsetX = (n.sx - screen.sx) * SCREEN_WIDTH;
      const offsetZ = (n.sy - screen.sy) * SCREEN_HEIGHT;
      collectGrid(n.tiles, offsetX, offsetZ, positions, obstacles);
      collectTrees(n.placedTrees, offsetX, offsetZ, treeDefs, trees, updaters);
    }

    const mesh = new THREE.InstancedMesh(tileGeo, tileMat, positions.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const newWaterInstances: number[] = [];
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, p.tile === TileType.Sidewalk ? SIDEWALK_RAISE : 0, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, groundColor(p.tile, hash2(p.x, p.z), c));
      if (p.tile === TileType.Water) newWaterInstances.push(i);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    scene.add(mesh);
    scene.add(obstacles);
    scene.add(trees);
    groundMesh = mesh;
    obstacleGroup = obstacles;
    treeGroup = trees;
    waterInstances = newWaterInstances;
    treeUpdaters = updaters;
  }

  // Brillo del agua: como no hay textura ni shader propio, se simula
  // aclarando/oscureciendo el color de instancia con una onda por celda —
  // mismo efecto percibido que el reflejo 2D, sin escribir GLSL a medida.
  const waterColor = new THREE.Color();
  function animateWater(time: number): void {
    if (!groundMesh || waterInstances.length === 0 || !groundMesh.instanceColor) return;
    for (const i of waterInstances) {
      const shimmer = 0.5 + 0.5 * Math.sin(time * 2 + i * 0.7);
      waterColor.set(WATER_SHADES[0]).lerp(new THREE.Color(0xbfe0ff), shimmer * 0.35);
      groundMesh.setColorAt(i, waterColor);
    }
    groundMesh.instanceColor.needsUpdate = true;
  }

  function resize(width: number, height: number): void {
    renderer.setSize(width, height, false);
    postfx.resize(width, height, renderer.getPixelRatio());
    aspect = width / height;
    restHalfHeight = fitHalfHeightToGrid(aspect);
  }

  function updateFigures(entities: FigureEntity[], time: number): void {
    figures.update(entities, time);
  }

  function setCameraMood(mood: CameraMood, holdSeconds: number): void {
    cameraRig.pulse(mood, holdSeconds);
  }

  function render(playerX: number, playerZ: number, time: number, dt: number, vision: VisionFogSettings, flashlight: FlashlightParams, heat: number): void {
    const halfHeight = cameraRig.update(restHalfHeight, dt);
    iso.setViewSize(halfHeight, aspect);
    iso.setTarget(playerX, playerZ);
    // El raycast de la linterna (dentro de lighting.update) necesita la
    // matriz de mundo YA actualizada — normalmente eso lo hace
    // renderer.render() al recorrer la escena, pero eso ocurre DESPUÉS, así
    // que sin esto el rayo se calcularía con la posición de cámara del frame
    // anterior (o ninguna, en el primer frame).
    iso.camera.updateMatrixWorld();
    animateWater(time);
    for (const t of treeUpdaters) t.update(time, t.def);
    lighting.update(playerX, playerZ, time, vision, flashlight, iso.camera);
    postfx.render(scene, iso.camera, time, vision.chromaticAberration, heat);
  }

  function dispose(): void {
    tileGeo.dispose();
    tileMat.dispose();
  }

  return { renderer, resize, updateGround, updateFigures, setCameraMood, render, dispose };
}
