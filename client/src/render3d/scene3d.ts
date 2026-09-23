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
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, type ScreenData, type NeighborTiles } from "@roi/shared";
import { createIsoCamera, type IsoCamera } from "./isoCamera.js";
import { buildObstacle } from "./obstacles3d.js";

const VIEW_HALF_HEIGHT = 9; // unidades de mundo visibles verticalmente (ajustable, ver Fase 5: zoom dinámico)

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

function groundColor(tile: TileType, n: number, out: THREE.Color): THREE.Color {
  if (tile === TileType.Water) return out.set(pick(WATER_SHADES, n));
  if (tile === TileType.Path) return out.set(DIRT_COLOR);
  return out.set(pick(GRASS_SHADES, n)); // Grass y cualquier obstáculo (llevan grama debajo)
}

export interface Scene3D {
  renderer: THREE.WebGLRenderer;
  resize(width: number, height: number): void;
  updateGround(screen: ScreenData, neighbors: NeighborTiles[]): void;
  render(playerX: number, playerZ: number, time: number): void;
  dispose(): void;
}

export function createScene3D(canvas: HTMLCanvasElement): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181f);

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 12, 4);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const iso = createIsoCamera();

  const tileGeo = new THREE.BoxGeometry(0.98, 0.1, 0.98);
  const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  let groundMesh: THREE.InstancedMesh | null = null;
  let obstacleGroup: THREE.Group | null = null;
  let waterInstances: number[] = []; // índices dentro de groundMesh que son agua, para el brillo animado
  let lastKey = "";

  function collectGrid(
    tiles: TileType[][],
    offsetX: number,
    offsetZ: number,
    positions: Array<{ x: number; z: number; tile: TileType }>,
    obstacles: THREE.Group
  ): void {
    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const tile = tiles[row][col];
        const x = col + offsetX;
        const z = row + offsetZ;
        positions.push({ x, z, tile });

        const obstacle = buildObstacle(tile, hash2(x + 0.5, z + 0.5));
        if (obstacle) {
          obstacle.position.set(x, 0, z);
          obstacles.add(obstacle);
        }
      }
    }
  }

  function updateGround(screen: ScreenData, neighbors: NeighborTiles[]): void {
    const key = `${screen.sx},${screen.sy}`;
    if (key === lastKey) return;
    lastKey = key;

    if (groundMesh) scene.remove(groundMesh);
    if (obstacleGroup) scene.remove(obstacleGroup);

    const positions: Array<{ x: number; z: number; tile: TileType }> = [];
    const obstacles = new THREE.Group();
    collectGrid(screen.tiles, 0, 0, positions, obstacles);
    for (const n of neighbors) {
      collectGrid(n.tiles, (n.sx - screen.sx) * SCREEN_WIDTH, (n.sy - screen.sy) * SCREEN_HEIGHT, positions, obstacles);
    }

    const mesh = new THREE.InstancedMesh(tileGeo, tileMat, positions.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const newWaterInstances: number[] = [];
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, 0, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, groundColor(p.tile, hash2(p.x, p.z), c));
      if (p.tile === TileType.Water) newWaterInstances.push(i);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    scene.add(mesh);
    scene.add(obstacles);
    groundMesh = mesh;
    obstacleGroup = obstacles;
    waterInstances = newWaterInstances;
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
    iso.setViewSize(VIEW_HALF_HEIGHT, width / height);
  }

  function render(playerX: number, playerZ: number, time: number): void {
    iso.setTarget(playerX, playerZ);
    animateWater(time);
    renderer.render(scene, iso.camera);
  }

  function dispose(): void {
    tileGeo.dispose();
    tileMat.dispose();
  }

  return { renderer, resize, updateGround, render, dispose };
}
