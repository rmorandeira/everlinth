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
import { SCREEN_WIDTH, SCREEN_HEIGHT, TILE_SIZE, GUN_RANGE, TileType, type PlacedTree, type ScreenData, type NeighborTiles, type CityData, type TreeDef, type VisionFogSettings } from "@roi/shared";
import { createIsoCamera, BASE_YAW, type IsoCamera } from "./isoCamera.js";
import { buildObstacle } from "./obstacles3d.js";
import { buildTreeResources, instantiateTree, resolveTreeInstances, type TreeResources } from "./proceduralTree3d.js";
import { buildBuilding, disposeBuildings, initBuildingTextures, buildingTexturesReady } from "./buildings3d.js";
import { createFigureManager, type FigureEntity } from "./figures3d.js";
import { createLighting3D, type FlashlightParams } from "./lighting3d.js";
import { applyCutaway, applyCutawayToMaterial, updateCutaway } from "./cutaway3d.js";
import { createGunFx } from "./gunfx3d.js";
import { updateSignals } from "./streetFurniture3d.js";
import { createPostFx3D } from "./postfx3d.js";
import { buildCityLayer } from "./city3d.js";
import { initModels, modelsReady, windowUniforms } from "./models3d.js";
import { getDayNight } from "../render/daynight.js";

// Zoom FIJO: mitad de alto del frustum ortográfico, en unidades de render
// (1 unidad = 3 m). Con 7, una persona de 1,8 m ocupa ~32 px a 720p: la escena
// se ve como una maqueta y el jugador es pequeño.
const VIEW_HALF_HEIGHT = 7;

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
const SIDEWALK_COLOR = 0xbdb8ac;

function groundColor(tile: TileType, n: number, out: THREE.Color): THREE.Color {
  if (tile === TileType.Water) return out.set(pick(WATER_SHADES, n));
  if (tile === TileType.Path) return out.set(DIRT_COLOR);
  // Ciudad: todo el suelo es pavimento; el asfalto lo dibuja city3d como cintas
  // vectoriales encima (los tiles solo sirven para colisión y saldrían en escalera).
  if (tile === TileType.Road || tile === TileType.Sidewalk) return out.set(SIDEWALK_COLOR);
  return out.set(pick(GRASS_SHADES, n)); // Grass y cualquier obstáculo (llevan grama debajo)
}

export interface Scene3D {
  renderer: THREE.WebGLRenderer;
  resize(width: number, height: number): void;
  updateGround(screen: ScreenData, neighbors: NeighborTiles[], treeDefs: Map<string, TreeDef>): void;
  updateFigures(entities: FigureEntity[], time: number): void;
  /** Gira la cámara 90° (+1 / -1). */
  rotateCamera(step: number): void;
  /** Paso de giro actual (0..3): cuántos cuartos de vuelta respecto a la vista base. */
  cameraStep(): number;
  /** Yaw actual (animado) de la cámara, para el minimapa. */
  cameraYaw(): number;
  /** Punto del suelo (plano y=0) bajo el cursor, en coordenadas de mundo. */
  cursorToGround(ndcX: number, ndcY: number): { x: number; z: number } | null;
  /** Fogonazo, luz y humo de un disparo desde (tileX,tileZ) en la dirección (dx,dz) (tiles, locales a la sala). */
  gunFire(tileX: number, tileZ: number, dx: number, dz: number): void;
  /** Chispa y luz del impacto de una bala (tiles, locales a la sala). */
  gunImpact(tileX: number, tileZ: number): void;
  /**
   * Rebote de una trazadora en (tileX,tileZ) que venía en la dirección (dx,dz):
   * far = el impacto fue lejos del tirador (sale en parábola) o cerca (rebota).
   */
  gunRicochet(tileX: number, tileZ: number, dx: number, dz: number, far: boolean): void;
  /** Trazador de bala efímero entre dos puntos del suelo. */
  addTracer(x0: number, z0: number, x1: number, z1: number): void;
  render(playerX: number, playerZ: number, time: number, dt: number, vision: VisionFogSettings, flashlight: FlashlightParams, heat: number): void;
  dispose(): void;
  /** Depuración: nº de mallas en escena y de instancias. */
  stats(): Record<string, number>;
}

export function createScene3D(canvas: HTMLCanvasElement): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();

  const lighting = createLighting3D(scene);

  const iso = createIsoCamera();
  // Área del personaje que se ve siempre sin obstrucciones (lo que la tapa se vuelve
  // translúcido, ver cutaway3d.ts): franja desde su línea horizontal hacia abajo.
  const CHAR_AREA_WIDTH = 0.7; // fracción del ancho de pantalla
  const cutBuf = new THREE.Vector2();
  const gunFx = createGunFx(scene);
  const T = TILE_SIZE;
  const postfx = createPostFx3D(renderer);
  let aspect = 1;

  const figures = createFigureManager();
  scene.add(figures.group);

  // Suelo: un plano por tile (2 triángulos) en vez de una caja (12).
  const tileGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE).rotateX(-Math.PI / 2).translate(0, 0.05, 0);
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
    obstacles: THREE.Group,
    city: CityData | undefined
  ): void {
    const gx0 = roomX * SCREEN_WIDTH;
    const gz0 = roomY * SCREEN_HEIGHT;
    // Ciudad vectorial: los edificios los levanta buildCityLayer a partir de sus
    // polígonos; aquí sus celdas Building solo aportan suelo (pavimento).
    const urban = city !== undefined;
    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const tile = tiles[row][col];
        const x = col + offsetX;
        const z = row + offsetZ;
        positions.push({ x, z, tile: urban && tile === TileType.Building ? TileType.Sidewalk : tile });
        if (urban) continue;

        if (tile === TileType.Building) {
          if (isBuildingAnchor(tiles, row, col)) {
            const { w, d } = buildingSize(tiles, row, col);
            const building = buildBuilding(gx0 + col, gz0 + row, w, d, urban);
            building.position.set((x + (w - 1) / 2) * T, 0, (z + (d - 1) / 2) * T);
            obstacles.add(building);
            applyCutaway(building);
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

  void initBuildingTextures();
  void initModels();

  function updateGround(screen: ScreenData, neighbors: NeighborTiles[], treeDefs: Map<string, TreeDef>): void {
    // Sin el manifest de texturas los edificios saldrían vacíos: se reintenta en el siguiente frame.
    if (!buildingTexturesReady() || !modelsReady()) return;
    const key = `${screen.sx},${screen.sy}`;
    if (key === lastKey) return;
    lastKey = key;

    if (groundMesh) scene.remove(groundMesh);
    if (obstacleGroup) {
      scene.remove(obstacleGroup);
      obstacleGroup.traverse((o) => {
        if (o.userData.ownGeometry) (o as THREE.Mesh).geometry.dispose();
      });
    }
    if (treeGroup) scene.remove(treeGroup);
    disposeBuildings();

    const positions: Array<{ x: number; z: number; tile: TileType }> = [];
    const obstacles = new THREE.Group();
    const trees = new THREE.Group();
    const updaters: Array<{ update: (time: number, def: TreeDef) => void; def: TreeDef }> = [];

    collectGrid(screen.tiles, 0, 0, screen.sx, screen.sy, positions, obstacles, screen.city);
    collectTrees(screen.placedTrees, 0, 0, treeDefs, trees, updaters);
    for (const n of neighbors) {
      const offsetX = (n.sx - screen.sx) * SCREEN_WIDTH;
      const offsetZ = (n.sy - screen.sy) * SCREEN_HEIGHT;
      collectGrid(n.tiles, offsetX, offsetZ, n.sx, n.sy, positions, obstacles, n.city);
      // Los árboles procedurales son caros (cientos de mallas animadas): solo en la sala actual y las contiguas.
      if (Math.abs(n.sx - screen.sx) <= 1 && Math.abs(n.sy - screen.sy) <= 1) {
        collectTrees(n.placedTrees, offsetX, offsetZ, treeDefs, trees, updaters);
      }
    }

    const cityDatas = [screen.city, ...neighbors.map((n) => n.city)].filter((c): c is CityData => c !== undefined);
    const cityLayer = cityDatas.length > 0 ? buildCityLayer(cityDatas, screen.sx * SCREEN_WIDTH, screen.sy * SCREEN_HEIGHT) : null;
    if (cityLayer) {
      obstacles.add(cityLayer.group);
      for (const bg of cityLayer.buildings) applyCutaway(bg);
      // Mobiliario alto de los kits de Kenney (farolas, semáforos, árboles, camiones):
      // sus materiales vienen marcados en models3d. El suelo y las marcas no se recortan.
      cityLayer.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) if (mm.userData.cutaway) applyCutawayToMaterial(mm);
      });
    }

    const mesh = new THREE.InstancedMesh(tileGeo, tileMat, positions.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const newWaterInstances: number[] = [];
    positions.forEach((p, i) => {
      m.makeTranslation(p.x * T, 0, p.z * T);
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

  // Trazadoras: un trazo corto y FINO que viaja a gran velocidad desde la boca del
  // cañón hasta el impacto (no una línea continua). Como en la munición real, solo
  // una de cada pocas balas es trazadora: la ráfaga se ve discontinua.
  const tracerGeo = new THREE.BoxGeometry(1, 0.012, 0.012).translate(-0.5, 0, 0); // la cola queda detrás
  const tracers: Array<{ mesh: THREE.Mesh; x0: number; z0: number; ux: number; uz: number; len: number; d: number; streak: number }> = [];
  const TRACER_SPEED = 95; // unidades de render por segundo (≈285 m/s: se ve el trazo avanzar)
  const TRACER_EVERY = 3; // una de cada N balas
  let tracerCount = 0;
  const TRACER_COLORS = [0xffe08a, 0xfff0b8, 0xffd060, 0xffb347, 0xffc978, 0xff8f4a];
  function addTracer(tx0: number, tz0: number, tx1: number, tz1: number): void {
    if (tracerCount++ % TRACER_EVERY !== 0) return;
    const x0 = tx0 * T, z0 = tz0 * T, x1 = tx1 * T, z1 = tz1 * T;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) return;
    // Color algo distinto en cada trazadora (del amarillo pálido al naranja, alguna rojiza).
    const color = TRACER_COLORS[Math.floor(Math.random() * TRACER_COLORS.length)];
    const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    mesh.position.set(x0, 0.4, z0);
    mesh.scale.x = 0.001;
    scene.add(mesh);
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    tracers.push({ mesh, x0, z0, ux, uz, len, d: 0.35, streak: 0.45 + Math.random() * 0.3 });
  }
  function updateTracers(dt: number): void {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.d += TRACER_SPEED * dt;
      const head = Math.min(t.d, t.len);
      const tail = Math.max(0, t.d - t.streak);
      if (tail >= t.len) {
        scene.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        tracers.splice(i, 1);
        continue;
      }
      t.mesh.position.set(t.x0 + t.ux * head, 0.4, t.z0 + t.uz * head);
      t.mesh.scale.x = Math.max(0.001, head - tail);
    }
  }

  // Cámara: giro en pasos de 90° animado. El jugador queda siempre centrado en
  // horizontal y al 40 % de la altura desde abajo (se ve más de lo que tiene delante
  // en pantalla que de lo que queda a su espalda).
  let camStep = 0;
  let yaw = BASE_YAW;
  const PLAYER_SCREEN_Y = 0.4; // fracción de la altura desde el borde inferior
  function gunFire(tileX: number, tileZ: number, dx: number, dz: number): void {
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return;
    gunFx.fire(tileX * T, tileZ * T, dx / l, dz / l);
  }
  function gunImpact(tileX: number, tileZ: number): void {
    gunFx.impact(tileX * T, tileZ * T);
  }
  function gunRicochet(tileX: number, tileZ: number, dx: number, dz: number, far: boolean): void {
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return;
    gunFx.ricochet(tileX * T, tileZ * T, dx / l, dz / l, far);
  }

  function rotateCamera(step: number): void {
    camStep = (((camStep + step) % 4) + 4) % 4;
  }
  function cameraStep(): number {
    return camStep;
  }
  function cameraYaw(): number {
    return yaw;
  }

  function render(playerTileX: number, playerTileZ: number, time: number, dt: number, vision: VisionFogSettings, flashlight: FlashlightParams, heat: number): void {
    const playerX = playerTileX * T;
    const playerZ = playerTileZ * T;
    iso.setViewSize(VIEW_HALF_HEIGHT, aspect);
    // yaw objetivo por el camino más corto (el paso 3 → 0 no da la vuelta entera)
    let goal = BASE_YAW + camStep * (Math.PI / 2);
    while (goal - yaw > Math.PI) goal -= Math.PI * 2;
    while (goal - yaw < -Math.PI) goal += Math.PI * 2;
    yaw += (goal - yaw) * (1 - Math.exp(-8 * dt));
    // Deriva: balanceo lento de orientación y posición (varias senoides de periodos
    // largos y distintos, así nunca se repite de forma evidente) para que la cámara
    // no se sienta clavada, como un dron que mantiene la posición.
    const drift = Math.sin(time * 0.13) * 0.018 + Math.sin(time * 0.071 + 1.3) * 0.012;
    iso.setYaw(yaw + drift);
    const driftX = Math.sin(time * 0.11 + 0.4) * 0.22 + Math.sin(time * 0.043) * 0.12;
    const driftZ = Math.cos(time * 0.093 + 2.1) * 0.22 + Math.sin(time * 0.057 + 0.7) * 0.12;
    iso.setTarget(playerX + driftX, playerZ + driftZ, 0, (0.5 - PLAYER_SCREEN_Y) * 2 * VIEW_HALF_HEIGHT);
    // El raycast de la linterna (dentro de lighting.update) necesita la
    // matriz de mundo YA actualizada (normalmente lo hace renderer.render(),
    // pero eso ocurre después).
    iso.camera.updateMatrixWorld();
    animateWater(time);
    updateTracers(dt);
    gunFx.update(dt);
    updateSignals(time);
    // Ventanas encendidas: aparecen al atardecer y a pleno de noche.
    const dn = getDayNight();
    windowUniforms.uWinGlow.value = THREE.MathUtils.smoothstep(dn.darkness, 0.15, 0.85) * 0.45 + dn.glow * 0.08;
    for (const t of treeUpdaters) t.update(time, t.def);
    lighting.update(playerX, playerZ, time, vision, flashlight, iso.camera);
    // Área del personaje sin obstrucciones (ver cutaway3d.ts).
    renderer.getDrawingBufferSize(cutBuf);
    updateCutaway(iso.camera, playerX, playerZ, cutBuf.x, cutBuf.y, CHAR_AREA_WIDTH);
    postfx.render(scene, iso.camera, time, vision.chromaticAberration, heat);
  }

  function stats(): Record<string, number> {
    let treeMeshes = 0;
    treeGroup?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) treeMeshes++;
    });
    let meshes = 0;
    let textured = 0;
    let owned = 0;
    let instances = 0;
    scene.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (m.isInstancedMesh) instances += m.count;
      else if ((o as THREE.Mesh).isMesh) {
        meshes++;
        if (((o as THREE.Mesh).material as THREE.MeshLambertMaterial).map) textured++;
        if (o.userData.ownGeometry) owned++;
      }
    });
    return { meshes, instances, textured, owned, treeMeshes };
  }

  function dispose(): void {
    tileGeo.dispose();
    tileMat.dispose();
  }

  return { renderer, resize, updateGround, updateFigures, rotateCamera, cameraStep, cameraYaw, cursorToGround, addTracer, gunFire, gunImpact, gunRicochet, render, dispose, stats };
}
