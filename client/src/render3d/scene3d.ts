// Fase 0 de la migración a 3D (ver plan): solo pinta el suelo como cajas
// planas coloreadas por TileType, sin decoración todavía (árboles, rocas,
// edificios, jugadores llegan en fases siguientes). El objetivo aquí es
// validar cámara + mapeo de coordenadas + movimiento de extremo a extremo.
//
// Mapeo de coordenadas: igual que el servidor las manda, sin reproyectar nada
// — columna de tile = X de mundo, fila de tile = Z de mundo, altura = Y. El
// aspecto de rombo isométrico sale solo del ángulo de la cámara (isoCamera.ts),
// no de transformar las coordenadas como hacía toScreen() en 2D.
import * as THREE from "three";
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, type ScreenData, type NeighborTiles } from "@roi/shared";
import { createIsoCamera, type IsoCamera } from "./isoCamera.js";

const TILE_COLORS: Record<TileType, number> = {
  [TileType.Grass]: 0x5cb85c,
  [TileType.Path]: 0xb8a06a,
  [TileType.Water]: 0x2e6fc4,
  [TileType.Tree]: 0x5cb85c,
  [TileType.Rock]: 0x5cb85c,
  [TileType.Building]: 0x5cb85c,
  [TileType.Fence]: 0x5cb85c,
  [TileType.Cactus]: 0x5cb85c,
};

const VIEW_HALF_HEIGHT = 9; // unidades de mundo visibles verticalmente (ajustable, ver Fase 5: zoom dinámico)

export interface Scene3D {
  renderer: THREE.WebGLRenderer;
  resize(width: number, height: number): void;
  updateGround(screen: ScreenData, neighbors: NeighborTiles[]): void;
  render(playerX: number, playerZ: number): void;
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
  const materialCache = new Map<number, THREE.MeshLambertMaterial>();
  function materialFor(color: number): THREE.MeshLambertMaterial {
    let m = materialCache.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      materialCache.set(color, m);
    }
    return m;
  }

  function buildGrid(tiles: TileType[][], offsetX: number, offsetZ: number, group: THREE.Group): void {
    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const color = TILE_COLORS[tiles[row][col]] ?? 0x888888;
        const mesh = new THREE.Mesh(tileGeo, materialFor(color));
        mesh.position.set(col + offsetX, 0, row + offsetZ);
        group.add(mesh);
      }
    }
  }

  let groundGroup: THREE.Group | null = null;
  let lastKey = "";

  function updateGround(screen: ScreenData, neighbors: NeighborTiles[]): void {
    const key = `${screen.sx},${screen.sy}`;
    if (key === lastKey) return;
    lastKey = key;

    if (groundGroup) scene.remove(groundGroup);

    const group = new THREE.Group();
    buildGrid(screen.tiles, 0, 0, group);
    for (const n of neighbors) {
      buildGrid(n.tiles, (n.sx - screen.sx) * SCREEN_WIDTH, (n.sy - screen.sy) * SCREEN_HEIGHT, group);
    }
    scene.add(group);
    groundGroup = group;
  }

  function resize(width: number, height: number): void {
    renderer.setSize(width, height, false);
    iso.setViewSize(VIEW_HALF_HEIGHT, width / height);
  }

  function render(playerX: number, playerZ: number): void {
    iso.setTarget(playerX, playerZ);
    renderer.render(scene, iso.camera);
  }

  function dispose(): void {
    tileGeo.dispose();
    for (const m of materialCache.values()) m.dispose();
  }

  return { renderer, resize, updateGround, render, dispose };
}
