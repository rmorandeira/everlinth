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
import { SCREEN_WIDTH, SCREEN_HEIGHT, TILE_SIZE, TileType, type PlacedTree, type ScreenData, type NeighborTiles, type TreeDef, type VisionFogSettings } from "@roi/shared";
import { createIsoCamera, type IsoCamera } from "./isoCamera.js";
import { buildObstacle } from "./obstacles3d.js";
import { buildTreeResources, instantiateTree, resolveTreeInstances, type TreeResources } from "./proceduralTree3d.js";
import { buildBuilding, disposeBuildings } from "./buildings3d.js";
import { createFigureManager, type FigureEntity } from "./figures3d.js";
import { createLighting3D, type FlashlightParams } from "./lighting3d.js";
import { createOcclusion3D } from "./occlusion3d.js";
import { createPostFx3D } from "./postfx3d.js";
import { buildCityProps } from "./city3d.js";

// Zoom FIJO: mitad de alto del frustum ortográfico, en unidades de render
// (1 unidad = 3 m). Con 14, una persona de 1,8 m ocupa ~16 px a 720p: la escena
// se ve como una maqueta y el jugador es pequeño.
const VIEW_HALF_HEIGHT = 14;

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
  /** Punto del suelo (plano y=0) bajo el cursor, en coordenadas de mundo. */
  cursorToGround(ndcX: number, ndcY: number): { x: number; z: number } | null;
  /** Trazador de bala efímero entre dos puntos del suelo. */
  addTracer(x0: number, z0: number, x1: number, z1: number): void;
  render(playerX: number, playerZ: number, time: number, dt: number, vision: VisionFogSettings, flashlight: FlashlightParams, heat: number): void;
  dispose(): void;
}

export function createScene3D(canvas: HTMLCanvasElement): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();

  const lighting = createLighting3D(scene);

  const iso = createIsoCamera();
  const occlusion = createOcclusion3D();
  const T = TILE_SIZE;
  const postfx = createPostFx3D(renderer);
  let aspect = 1;

  const figures = createFigureManager();
  scene.add(figures.group);

  const tileGeo = new THREE.BoxGeometry(0.98 * TILE_SIZE, 0.1, 0.98 * TILE_SIZE);
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

  // Un edificio son celdas Building contiguas formando un rectángulo (ver worldgen.ts):
  // solo se levanta una vez, en la esquina superior-izquierda del grupo; el ancho
  // y el fondo se miden contando celdas contiguas hacia la derecha y hacia abajo.
  function isBuildingAnchor(tiles: TileType[][], row: number, col: number): boolean {
    if (col > 0 && tiles[row][col - 1] === TileType.Building) return false;
    if (row > 0 && tiles[row - 1][col] === TileType.Building) return false;
    return true;
  }
  function buildingSize(tiles: TileType[][], row: number, col: number): { w: number; d: number } {
    let w = 0;
    while (col + w < tiles[row].length && tiles[row][col + w] === TileType.Building) w++;
    let d = 0;
    while (row + d < tiles.length && tiles[row + d][col] === TileType.Building) d++;
    return { w, d };
  }

  // roomX/roomY: coordenadas de la sala; los hashes usan tiles GLOBALES para que
  // cada edificio/obstáculo salga idéntico visto desde su sala o desde una vecina.
  function collectGrid(
    tiles: TileType[][],
    offsetX: number,
    offsetZ: number,
    roomX: number,
    roomY: number,
    positions: Array<{ x: number; z: number; tile: TileType }>,
    obstacles: THREE.Group
  ): void {
    const gx0 = roomX * SCREEN_WIDTH;
    const gz0 = roomY * SCREEN_HEIGHT;
    const cityProps = buildCityProps(tiles, offsetX, offsetZ, gx0, gz0);
    if (cityProps) obstacles.add(cityProps);
    const urban = cityProps !== null;
    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const tile = tiles[row][col];
        const x = col + offsetX;
        const z = row + offsetZ;
        positions.push({ x, z, tile });

        if (tile === TileType.Building) {
          if (isBuildingAnchor(tiles, row, col)) {
            const { w, d } = buildingSize(tiles, row, col);
            const building = buildBuilding(gx0 + col, gz0 + row, w, d, urban);
            building.position.set((x + (w - 1) / 2) * T, 0, (z + (d - 1) / 2) * T);
            obstacles.add(building);
            occlusion.register(building);
          }
          continue;
        }

        const obstacle = buildObstacle(tile, hash2(gx0 + col + 0.5, gz0 + row + 0.5));
        if (obstacle) {
          obstacle.position.set(x * T, 0, z * T);
          obstacle.scale.multiplyScalar(T);
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
        handle.root.position.set((pt.x + offsetX + inst.offsetX) * T, 0, (pt.y + offsetZ + inst.offsetZ) * T);
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
    occlusion.clear();

    const positions: Array<{ x: number; z: number; tile: TileType }> = [];
    const obstacles = new THREE.Group();
    const trees = new THREE.Group();
    const updaters: Array<{ update: (time: number, def: TreeDef) => void; def: TreeDef }> = [];

    collectGrid(screen.tiles, 0, 0, screen.sx, screen.sy, positions, obstacles);
    collectTrees(screen.placedTrees, 0, 0, treeDefs, trees, updaters);
    for (const n of neighbors) {
      const offsetX = (n.sx - screen.sx) * SCREEN_WIDTH;
      const offsetZ = (n.sy - screen.sy) * SCREEN_HEIGHT;
      collectGrid(n.tiles, offsetX, offsetZ, n.sx, n.sy, positions, obstacles);
      collectTrees(n.placedTrees, offsetX, offsetZ, treeDefs, trees, updaters);
    }

    const mesh = new THREE.InstancedMesh(tileGeo, tileMat, positions.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const newWaterInstances: number[] = [];
    positions.forEach((p, i) => {
      m.makeTranslation(p.x * T, p.tile === TileType.Sidewalk ? SIDEWALK_RAISE : 0, p.z * T);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, groundColor(p.tile, hash2(p.x, p.z), c));
      if (p.tile === TileType.Water) newWaterInstances.push(i);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    mesh.receiveShadow = true;
    for (const grp of [obstacles, trees]) {
      grp.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    }
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
  }

  function updateFigures(entities: FigureEntity[], time: number): void {
    figures.update(
      entities.map((e) => ({ ...e, x: e.x * T, z: e.z * T })),
      time
    );
  }

  const groundRaycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundHit = new THREE.Vector3();
  const ndcTmp = new THREE.Vector2();
  function cursorToGround(ndcX: number, ndcY: number): { x: number; z: number } | null {
    iso.camera.updateMatrixWorld();
    groundRaycaster.setFromCamera(ndcTmp.set(ndcX, ndcY), iso.camera);
    if (!groundRaycaster.ray.intersectPlane(groundPlane, groundHit)) return null;
    return { x: groundHit.x / T, z: groundHit.z / T };
  }

  const tracerGeo = new THREE.BoxGeometry(1, 0.035, 0.035);
  const tracers: Array<{ mesh: THREE.Mesh; life: number }> = [];
  const TRACER_LIFE = 0.11;
  function addTracer(tx0: number, tz0: number, tx1: number, tz1: number): void {
    const x0 = tx0 * T, z0 = tz0 * T, x1 = tx1 * T, z1 = tz1 * T;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) return;
    const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, fog: false }));
    mesh.scale.x = len;
    mesh.position.set((x0 + x1) / 2, 0.38, (z0 + z1) / 2);
    mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    scene.add(mesh);
    tracers.push({ mesh, life: TRACER_LIFE });
  }
  function updateTracers(dt: number): void {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        scene.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        tracers.splice(i, 1);
      } else {
        (t.mesh.material as THREE.MeshBasicMaterial).opacity = t.life / TRACER_LIFE;
      }
    }
  }

  const towardCamera = new THREE.Vector3();
  const playerVec = new THREE.Vector3();
  function render(playerTileX: number, playerTileZ: number, time: number, dt: number, vision: VisionFogSettings, flashlight: FlashlightParams, heat: number): void {
    const playerX = playerTileX * T;
    const playerZ = playerTileZ * T;
    iso.setViewSize(VIEW_HALF_HEIGHT, aspect);
    iso.setTarget(playerX, playerZ);
    // El raycast de la linterna (dentro de lighting.update) necesita la
    // matriz de mundo YA actualizada (normalmente lo hace renderer.render(),
    // pero eso ocurre después).
    iso.camera.updateMatrixWorld();
    animateWater(time);
    updateTracers(dt);
    for (const t of treeUpdaters) t.update(time, t.def);
    lighting.update(playerX, playerZ, time, vision, flashlight, iso.camera);
    playerVec.set(playerX, 0, playerZ);
    towardCamera.copy(iso.camera.position).sub(playerVec).normalize();
    occlusion.update(playerVec, towardCamera, dt);
    postfx.render(scene, iso.camera, time, vision.chromaticAberration, heat);
  }

  function dispose(): void {
    tileGeo.dispose();
    tileMat.dispose();
  }

  return { renderer, resize, updateGround, updateFigures, cursorToGround, addTracer, render, dispose };
}
